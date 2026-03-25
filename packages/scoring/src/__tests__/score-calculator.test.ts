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
  it('computes weighted total from dimension scores scaled by confidence', () => {
    const signals = makeSignals();
    const score = calculateScore(signals, weights);

    // Formula: raw * weight * confidence
    // 80*0.3*0.9=21.6, 70*0.25*0.8=14, 60*0.2*0.7=8.4, 50*0.15*0.6=4.5, 90*0.1*0.95=8.55
    // rawTotal = 57.05
    expect(score.total).toBeCloseTo(57.05);
  });

  it('produces correct total with uniform confidence', () => {
    const signals = makeSignals({
      technicalDepth: { score: 80, evidenceIds: [], confidence: 1 },
      domainRelevance: { score: 70, evidenceIds: [], confidence: 1 },
      trajectoryMatch: { score: 60, evidenceIds: [], confidence: 1 },
      cultureFit: { score: 50, evidenceIds: [], confidence: 1 },
      reachability: { score: 90, evidenceIds: [], confidence: 1 },
    });
    const score = calculateScore(signals, weights);

    // 80*0.3*1=24, 70*0.25*1=17.5, 60*0.2*1=12, 50*0.15*1=7.5, 90*0.1*1=9
    // rawTotal = 70
    expect(score.total).toBe(70);
    expect(score.breakdown).toHaveLength(5);
  });

  it('builds ScoreComponent with correct fields per dimension', () => {
    const signals = makeSignals({
      technicalDepth: { score: 70, evidenceIds: ['ev-001', 'ev-002'], confidence: 0.85 },
    });
    const score = calculateScore(signals, weights);

    const td = score.breakdown.find((c) => c.dimension === 'technicalDepth');
    expect(td).toBeDefined();
    expect(td!.raw).toBe(70);
    expect(td!.weight).toBe(0.3);
    expect(td!.weighted).toBeCloseTo(17.85); // 70 * 0.3 * 0.85
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
      technicalDepth: { score: 80, evidenceIds: [], confidence: 1 },
      domainRelevance: { score: 70, evidenceIds: [], confidence: 1 },
      trajectoryMatch: { score: 60, evidenceIds: [], confidence: 1 },
      cultureFit: { score: 50, evidenceIds: [], confidence: 1 },
      reachability: { score: 90, evidenceIds: [], confidence: 1 },
      redFlags: [
        { signal: 'Frequent job hopping', evidenceId: 'ev-001', severity: 'medium' },
        { signal: 'No public repos', evidenceId: 'ev-002', severity: 'low' },
      ],
    });
    const score = calculateScore(signals, weights);

    // rawTotal = 70, penalties = 5 (medium) + 2 (low) = 7
    expect(score.total).toBe(63);
    expect(score.redFlags).toHaveLength(2);
  });

  it('clamps total to 0 with heavy penalties', () => {
    const signals = makeSignals({
      technicalDepth: { score: 10, evidenceIds: [], confidence: 1 },
      domainRelevance: { score: 10, evidenceIds: [], confidence: 1 },
      trajectoryMatch: { score: 10, evidenceIds: [], confidence: 1 },
      cultureFit: { score: 10, evidenceIds: [], confidence: 1 },
      reachability: { score: 10, evidenceIds: [], confidence: 1 },
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
      technicalDepth: { score: 50, evidenceIds: [], confidence: 1 },
      domainRelevance: { score: 50, evidenceIds: [], confidence: 1 },
      trajectoryMatch: { score: 50, evidenceIds: [], confidence: 1 },
      cultureFit: { score: 50, evidenceIds: [], confidence: 1 },
      reachability: { score: 50, evidenceIds: [], confidence: 1 },
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

  it('zeros contribution when confidence is 0 (all evidence stripped)', () => {
    const signals = makeSignals({
      technicalDepth: { score: 90, evidenceIds: [], confidence: 0 },
      domainRelevance: { score: 80, evidenceIds: ['ev-001'], confidence: 1 },
      trajectoryMatch: { score: 0, evidenceIds: [], confidence: 0 },
      cultureFit: { score: 0, evidenceIds: [], confidence: 0 },
      reachability: { score: 0, evidenceIds: [], confidence: 0 },
    });
    const score = calculateScore(signals, weights);

    // Only domainRelevance contributes: 80 * 0.25 * 1 = 20
    // technicalDepth has score 90 but confidence 0 → contributes 0
    expect(score.total).toBe(20);
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
