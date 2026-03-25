import { describe, it, expect } from 'vitest';
import type { ExtractedSignals, ScoringWeights } from '@sourcerer/core';
import { calculateScore, assignTier } from '../score-calculator.js';

// --- Fixtures ---

const weights: ScoringWeights = {
  technicalDepth: 0.3,
  domainRelevance: 0.25,
  trajectoryMatch: 0.2,
  cultureFit: 0.15,
  reachability: 0.1,
};

function makeSignals(overrides?: Partial<ExtractedSignals>): ExtractedSignals {
  return {
    technicalDepth: { score: 80, evidenceIds: ['ev-aaa001'], confidence: 0.9 },
    domainRelevance: { score: 70, evidenceIds: ['ev-aaa002'], confidence: 0.8 },
    trajectoryMatch: { score: 60, evidenceIds: ['ev-aaa003'], confidence: 0.7 },
    cultureFit: { score: 50, evidenceIds: ['ev-aaa004'], confidence: 0.6 },
    reachability: { score: 90, evidenceIds: ['ev-aaa005'], confidence: 0.95 },
    redFlags: [],
    ...overrides,
  };
}

// --- Tests ---

describe('calculateScore', () => {
  it('computes weighted total from dimension scores', () => {
    const signals = makeSignals();
    const score = calculateScore(signals, weights);

    // Manual: 80*0.3*10 + 70*0.25*10 + 60*0.2*10 + 50*0.15*10 + 90*0.1*10
    //       = 240 + 175 + 120 + 75 + 90 = 700 → clamped to 100
    // Wait — these exceed 100. The scale factor means weights summing to 1.0
    // produce raw = score * weight * 10, and if all scores are ~70 with weights=1.0:
    // 70 * 1.0 * 10 = 700 → way over. Let me recalculate:
    // Actually with weights summing to 1.0, a uniform score of X gives total = X * 10 * sum(weights) = X * 10
    // That's by design — score 10 maps to total 100 when all weights sum to 1.
    // But the dimension scores are 0-100, not 0-10. So the formula is:
    // total = sum(score_i * weight_i * 10) which with score=80 and weight=0.3 gives 240.
    // This gets clamped to 100. Let me use smaller scores.

    // Recalculate with the actual values:
    // 80*0.3*10=240, 70*0.25*10=175, 60*0.2*10=120, 50*0.15*10=75, 90*0.1*10=90
    // rawTotal = 700, clamped to 100
    expect(score.total).toBe(100);
  });

  it('produces correct total for moderate scores', () => {
    const signals = makeSignals({
      technicalDepth: { score: 7, evidenceIds: [], confidence: 0.5 },
      domainRelevance: { score: 6, evidenceIds: [], confidence: 0.5 },
      trajectoryMatch: { score: 5, evidenceIds: [], confidence: 0.5 },
      cultureFit: { score: 4, evidenceIds: [], confidence: 0.5 },
      reachability: { score: 8, evidenceIds: [], confidence: 0.5 },
    });
    const score = calculateScore(signals, weights);

    // 7*0.3*10=21, 6*0.25*10=15, 5*0.2*10=10, 4*0.15*10=6, 8*0.1*10=8
    // rawTotal = 60
    expect(score.total).toBe(60);
    expect(score.breakdown).toHaveLength(5);
  });

  it('builds ScoreComponent with correct fields per dimension', () => {
    const signals = makeSignals({
      technicalDepth: { score: 7, evidenceIds: ['ev-001', 'ev-002'], confidence: 0.85 },
    });
    const score = calculateScore(signals, weights);

    const td = score.breakdown.find((c) => c.dimension === 'technicalDepth');
    expect(td).toBeDefined();
    expect(td!.raw).toBe(7);
    expect(td!.weight).toBe(0.3);
    expect(td!.weighted).toBe(21); // 7 * 0.3 * 10
    expect(td!.evidenceIds).toEqual(['ev-001', 'ev-002']);
    expect(td!.confidence).toBe(0.85);
  });

  it('treats missing weight as 0', () => {
    const signals = makeSignals({
      technicalDepth: { score: 50, evidenceIds: [], confidence: 0.5 },
    });
    // Weights missing technicalDepth
    const partialWeights: ScoringWeights = {
      domainRelevance: 0.5,
      trajectoryMatch: 0.5,
    };
    const score = calculateScore(signals, partialWeights);

    const td = score.breakdown.find((c) => c.dimension === 'technicalDepth');
    expect(td!.weight).toBe(0);
    expect(td!.weighted).toBe(0);
  });

  it('deducts red flag penalties from total', () => {
    const signals = makeSignals({
      technicalDepth: { score: 7, evidenceIds: [], confidence: 0.5 },
      domainRelevance: { score: 6, evidenceIds: [], confidence: 0.5 },
      trajectoryMatch: { score: 5, evidenceIds: [], confidence: 0.5 },
      cultureFit: { score: 4, evidenceIds: [], confidence: 0.5 },
      reachability: { score: 8, evidenceIds: [], confidence: 0.5 },
      redFlags: [
        { signal: 'Frequent job hopping', evidenceId: 'ev-001', severity: 'medium' },
        { signal: 'No public repos', evidenceId: 'ev-002', severity: 'low' },
      ],
    });
    const score = calculateScore(signals, weights);

    // rawTotal = 60, penalties = 5 (medium) + 2 (low) = 7
    expect(score.total).toBe(53);
    expect(score.redFlags).toHaveLength(2);
  });

  it('clamps total to 0 with heavy penalties', () => {
    const signals = makeSignals({
      technicalDepth: { score: 1, evidenceIds: [], confidence: 0.1 },
      domainRelevance: { score: 1, evidenceIds: [], confidence: 0.1 },
      trajectoryMatch: { score: 1, evidenceIds: [], confidence: 0.1 },
      cultureFit: { score: 1, evidenceIds: [], confidence: 0.1 },
      reachability: { score: 1, evidenceIds: [], confidence: 0.1 },
      redFlags: [
        { signal: 'Critical issue 1', evidenceId: 'ev-001', severity: 'high' },
        { signal: 'Critical issue 2', evidenceId: 'ev-002', severity: 'high' },
        { signal: 'Critical issue 3', evidenceId: 'ev-003', severity: 'high' },
      ],
    });
    const score = calculateScore(signals, weights);

    // rawTotal = 10, penalties = 30 → -20 → clamped to 0
    expect(score.total).toBe(0);
  });

  it('accepts custom red flag penalty overrides', () => {
    const signals = makeSignals({
      technicalDepth: { score: 5, evidenceIds: [], confidence: 0.5 },
      domainRelevance: { score: 5, evidenceIds: [], confidence: 0.5 },
      trajectoryMatch: { score: 5, evidenceIds: [], confidence: 0.5 },
      cultureFit: { score: 5, evidenceIds: [], confidence: 0.5 },
      reachability: { score: 5, evidenceIds: [], confidence: 0.5 },
      redFlags: [
        { signal: 'Issue', evidenceId: 'ev-001', severity: 'high' },
      ],
    });
    const score = calculateScore(signals, weights, {
      redFlagPenalties: { low: 1, medium: 3, high: 20 },
    });

    // rawTotal = 50, penalty = 20
    expect(score.total).toBe(30);
  });

  it('preserves weights in the Score output', () => {
    const score = calculateScore(makeSignals(), weights);
    expect(score.weights).toBe(weights);
  });
});

describe('assignTier', () => {
  const thresholds = { tier1MinScore: 70, tier2MinScore: 40 };

  it('assigns Tier 1 at or above tier1MinScore', () => {
    expect(assignTier(70, thresholds)).toBe(1);
    expect(assignTier(100, thresholds)).toBe(1);
  });

  it('assigns Tier 2 between tier2MinScore and tier1MinScore', () => {
    expect(assignTier(40, thresholds)).toBe(2);
    expect(assignTier(69, thresholds)).toBe(2);
  });

  it('assigns Tier 3 below tier2MinScore', () => {
    expect(assignTier(39, thresholds)).toBe(3);
    expect(assignTier(0, thresholds)).toBe(3);
  });
});
