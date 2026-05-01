import { describe, expect, it } from 'vitest';
import type {
  ExtractedSignals,
  RedFlag,
  SignalDimension,
} from '@sourcerer/core';
import {
  computeHallucinationPenalty,
  HALLUCINATION_PENALTY_FLOOR,
  validateGrounding,
} from '../grounding-validator.js';

const DIMENSIONS = [
  'technicalDepth',
  'domainRelevance',
  'trajectoryMatch',
  'cultureFit',
  'reachability',
] as const;

type DimensionName = (typeof DIMENSIONS)[number];

const canonicalIds = new Set([
  'ev-valid-1',
  'ev-valid-2',
  'ev-valid-3',
  'ev-valid-4',
  'ev-valid-5',
]);

function dimension(overrides?: Partial<SignalDimension>): SignalDimension {
  return {
    score: 80,
    evidenceIds: ['ev-valid-1', 'ev-valid-2'],
    confidence: 0.8,
    ...overrides,
  };
}

function signals(
  overrides?: Partial<Record<DimensionName, SignalDimension>> & {
    redFlags?: RedFlag[];
  },
): ExtractedSignals {
  return {
    technicalDepth: dimension(),
    domainRelevance: dimension(),
    trajectoryMatch: dimension(),
    cultureFit: dimension(),
    reachability: dimension(),
    redFlags: [],
    ...overrides,
  };
}

function oneDimensionSignals(
  name: DimensionName,
  value: SignalDimension,
): ExtractedSignals {
  return signals({ [name]: value });
}

describe('validateGrounding', () => {
  it.each(DIMENSIONS)('keeps all-valid IDs for %s without penalty', (name) => {
    const result = validateGrounding(
      oneDimensionSignals(name, dimension({ score: 91, confidence: 0.73 })),
      canonicalIds,
    );

    expect(result.violations).toHaveLength(0);
    expect(result.validated[name]).toMatchObject({
      score: 91,
      confidence: 0.73,
      evidenceIds: ['ev-valid-1', 'ev-valid-2'],
    });
    expect(result.validated[name].hallucinationPenalty).toBeUndefined();
  });

  it.each(DIMENSIONS)(
    'retains %s but zeros score/confidence when all IDs are invalid',
    (name) => {
      const result = validateGrounding(
        oneDimensionSignals(
          name,
          dimension({
            score: 88,
            confidence: 0.9,
            evidenceIds: ['ev-fake-1', 'ev-fake-2'],
          }),
        ),
        canonicalIds,
      );

      expect(result.validated[name].evidenceIds).toEqual([]);
      expect(result.validated[name].confidence).toBe(0);
      expect(result.validated[name].score).toBe(0);
      expect(result.validated[name].hallucinationPenalty).toEqual({
        hallucinatedCount: 2,
        totalCitedCount: 2,
        penaltyApplied: 1,
        rawScoreBeforePenalty: 88,
      });
      expect(result.violations).toEqual([
        { dimension: name, invalidId: 'ev-fake-1', action: 'removed' },
        { dimension: name, invalidId: 'ev-fake-2', action: 'removed' },
      ]);
    },
  );

  it.each(DIMENSIONS)(
    'applies proportional confidence loss and score penalty for mixed %s IDs',
    (name) => {
      const result = validateGrounding(
        oneDimensionSignals(
          name,
          dimension({
            score: 100,
            confidence: 0.8,
            evidenceIds: ['ev-valid-1', 'ev-fake-1', 'ev-valid-2', 'ev-fake-2'],
          }),
        ),
        canonicalIds,
      );

      expect(result.validated[name].evidenceIds).toEqual([
        'ev-valid-1',
        'ev-valid-2',
      ]);
      expect(result.validated[name].confidence).toBeCloseTo(0.4);
      expect(result.validated[name].score).toBeCloseTo(50);
      expect(result.validated[name].hallucinationPenalty?.penaltyApplied).toBe(
        0.5,
      );
    },
  );

  it.each(DIMENSIONS)('preserves %s when no IDs were cited', (name) => {
    const result = validateGrounding(
      oneDimensionSignals(
        name,
        dimension({ score: 64, confidence: 0.31, evidenceIds: [] }),
      ),
      canonicalIds,
    );

    expect(result.violations).toHaveLength(0);
    expect(result.validated[name]).toMatchObject({
      score: 64,
      confidence: 0.31,
      evidenceIds: [],
    });
    expect(result.validated[name].hallucinationPenalty).toBeUndefined();
  });

  it.each(DIMENSIONS)(
    'uses the per-fake floor for padded %s citations',
    (name) => {
      const result = validateGrounding(
        oneDimensionSignals(
          name,
          dimension({
            score: 80,
            confidence: 1,
            evidenceIds: [
              'ev-valid-1',
              'ev-valid-2',
              'ev-valid-3',
              'ev-valid-4',
              'ev-valid-5',
              'ev-valid-1',
              'ev-valid-2',
              'ev-valid-3',
              'ev-valid-4',
              'ev-fake-1',
            ],
          }),
        ),
        canonicalIds,
      );

      expect(result.validated[name].confidence).toBeCloseTo(0.9);
      expect(result.validated[name].score).toBeCloseTo(80 * 0.85);
      expect(result.validated[name].hallucinationPenalty?.penaltyApplied).toBe(
        HALLUCINATION_PENALTY_FLOOR,
      );
    },
  );

  it('validates every dimension in a single pass', () => {
    const result = validateGrounding(
      signals({
        technicalDepth: dimension({ evidenceIds: ['ev-fake-td'] }),
        domainRelevance: dimension({ evidenceIds: ['ev-fake-domain'] }),
        trajectoryMatch: dimension({ evidenceIds: ['ev-fake-trajectory'] }),
        cultureFit: dimension({ evidenceIds: ['ev-fake-culture'] }),
        reachability: dimension({ evidenceIds: ['ev-fake-reach'] }),
      }),
      canonicalIds,
    );

    expect(result.violations.map((v) => v.dimension)).toEqual(DIMENSIONS);
    for (const name of DIMENSIONS) {
      expect(result.validated[name].score).toBe(0);
    }
  });

  it('keeps valid red flags', () => {
    const result = validateGrounding(
      signals({
        redFlags: [
          {
            signal: 'Valid concern',
            evidenceId: 'ev-valid-1',
            severity: 'low',
          },
        ],
      }),
      canonicalIds,
    );

    expect(result.validated.redFlags).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it('drops red flags that cite invalid evidence IDs', () => {
    const result = validateGrounding(
      signals({
        redFlags: [
          {
            signal: 'Valid concern',
            evidenceId: 'ev-valid-1',
            severity: 'low',
          },
          {
            signal: 'Fake concern',
            evidenceId: 'ev-fake-flag',
            severity: 'high',
          },
        ],
      }),
      canonicalIds,
    );

    expect(result.validated.redFlags).toEqual([
      { signal: 'Valid concern', evidenceId: 'ev-valid-1', severity: 'low' },
    ]);
    expect(result.violations).toContainEqual({
      dimension: 'redFlags',
      invalidId: 'ev-fake-flag',
      action: 'red_flag_dropped',
    });
  });

  it('handles an empty canonical evidence set without crashing', () => {
    const result = validateGrounding(
      signals({
        technicalDepth: dimension({ evidenceIds: ['ev-unknown'] }),
        domainRelevance: dimension({ evidenceIds: [] }),
        trajectoryMatch: dimension({ evidenceIds: [] }),
        cultureFit: dimension({ evidenceIds: [] }),
        reachability: dimension({ evidenceIds: [] }),
        redFlags: [
          {
            signal: 'Unknown evidence',
            evidenceId: 'ev-unknown',
            severity: 'medium',
          },
        ],
      }),
      new Set(),
    );

    expect(result.validated.technicalDepth.evidenceIds).toEqual([]);
    expect(result.validated.technicalDepth.score).toBe(0);
    expect(result.validated.redFlags).toEqual([]);
    expect(result.violations).toHaveLength(2);
  });

  it('does not mutate the input signals object', () => {
    const input = signals({
      technicalDepth: dimension({
        evidenceIds: ['ev-valid-1', 'ev-fake-1'],
      }),
    });

    validateGrounding(input, canonicalIds);

    expect(input.technicalDepth).toEqual({
      score: 80,
      evidenceIds: ['ev-valid-1', 'ev-fake-1'],
      confidence: 0.8,
    });
  });

  it('does not attach hallucination metadata to clean dimensions in mixed results', () => {
    const result = validateGrounding(
      signals({
        technicalDepth: dimension({ evidenceIds: ['ev-fake-1'] }),
        domainRelevance: dimension({ evidenceIds: ['ev-valid-2'] }),
      }),
      canonicalIds,
    );

    expect(result.validated.technicalDepth.hallucinationPenalty).toBeDefined();
    expect(
      result.validated.domainRelevance.hallucinationPenalty,
    ).toBeUndefined();
  });

  it('preserves duplicate valid citations exactly as returned by the model', () => {
    const result = validateGrounding(
      signals({
        technicalDepth: dimension({
          evidenceIds: ['ev-valid-1', 'ev-valid-1'],
        }),
      }),
      canonicalIds,
    );

    expect(result.validated.technicalDepth.evidenceIds).toEqual([
      'ev-valid-1',
      'ev-valid-1',
    ]);
    expect(result.validated.technicalDepth.confidence).toBe(0.8);
  });
});

describe('computeHallucinationPenalty', () => {
  it.each([
    [0, 0, 0],
    [0, 5, 0],
    [1, 5, 0.2],
    [1, 50, 0.15],
    [2, 20, 0.3],
    [5, 10, 0.75],
    [10, 10, 1],
    [20, 100, 1],
    [-1, 10, 0],
    [1, -10, 0],
  ])(
    'returns %s hallucinations over %s cited IDs as penalty %s',
    (hallucinated, total, expected) => {
      expect(computeHallucinationPenalty(hallucinated, total)).toBeCloseTo(
        expected,
      );
    },
  );
});
