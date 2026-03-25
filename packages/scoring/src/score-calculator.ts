// Score calculator — weighted scoring math with red flag penalties

import type {
  ExtractedSignals,
  Score,
  ScoreComponent,
  SignalDimension,
  RedFlag,
  ScoringWeights,
  TierThresholds,
} from '@sourcerer/core';

const DIMENSION_NAMES = [
  'technicalDepth',
  'domainRelevance',
  'trajectoryMatch',
  'cultureFit',
  'reachability',
] as const;

const DEFAULT_RED_FLAG_PENALTIES: Record<RedFlag['severity'], number> = {
  low: 2,
  medium: 5,
  high: 10,
};

export interface ScoreOptions {
  redFlagPenalties?: { low: number; medium: number; high: number };
}

/**
 * Calculate a weighted score from extracted signals.
 *
 * For each dimension: weighted = raw * weight * 10
 * (scale factor of 10 maps weights summing to ~1 into the 0-100 total range)
 *
 * Red flags deduct from the total: low=-2, medium=-5, high=-10 (configurable).
 * Total is clamped to [0, 100].
 */
export function calculateScore(
  signals: ExtractedSignals,
  weights: ScoringWeights,
  options?: ScoreOptions,
): Score {
  const penalties = options?.redFlagPenalties ?? DEFAULT_RED_FLAG_PENALTIES;

  const breakdown: ScoreComponent[] = DIMENSION_NAMES.map((dim) => {
    const signal: SignalDimension = signals[dim];
    const weight = weights[dim] ?? 0;
    const weighted = signal.score * weight * 10;

    return {
      dimension: dim,
      raw: signal.score,
      weight,
      weighted,
      evidenceIds: signal.evidenceIds,
      confidence: signal.confidence,
    };
  });

  const rawTotal = breakdown.reduce((sum, c) => sum + c.weighted, 0);

  // Apply red flag penalties
  const totalPenalty = signals.redFlags.reduce(
    (sum, flag) => sum + (penalties[flag.severity] ?? 0),
    0,
  );

  const total = Math.max(0, Math.min(100, rawTotal - totalPenalty));

  return {
    total,
    breakdown,
    weights,
    redFlags: signals.redFlags,
  };
}

/**
 * Assign a tier based on total score and thresholds.
 */
export function assignTier(
  total: number,
  thresholds: TierThresholds,
): 1 | 2 | 3 {
  if (total >= thresholds.tier1MinScore) return 1;
  if (total >= thresholds.tier2MinScore) return 2;
  return 3;
}
