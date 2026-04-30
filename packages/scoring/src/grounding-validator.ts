// Evidence grounding validation — strips hallucinated IDs, adjusts confidence,
// and (H-9) penalizes the raw score so fabricated citations cost more than
// just a confidence drop.

import type { ExtractedSignals, SignalDimension } from '@sourcerer/core';

export interface GroundingViolation {
  dimension: string;
  invalidId: string;
  action: 'removed' | 'red_flag_dropped';
}

export interface GroundingResult {
  validated: ExtractedSignals;
  violations: GroundingViolation[];
}

const DIMENSION_NAMES = [
  'technicalDepth',
  'domainRelevance',
  'trajectoryMatch',
  'cultureFit',
  'reachability',
] as const;

/**
 * Per-hallucination floor: every fabricated citation reduces the dimension's
 * score by at least this fraction (15% by default), regardless of how many
 * legitimate citations the LLM also provided. Prevents a "padding attack"
 * where the model dilutes hallucination cost by citing many real IDs.
 *
 * Tunable starting point — H-9 design discussion 2026-04-30. Higher = more
 * strict on small slips; lower = closer to pure proportional. Exported so
 * downstream consumers (tests, configurable scoring) can reference the same
 * constant.
 */
export const HALLUCINATION_PENALTY_FLOOR = 0.15;

/**
 * Compute the score-penalty fraction for a dimension whose LLM-cited evidence
 * IDs included some that were not in the canonical set.
 *
 * H-9 formula:
 *   penalty = max(FLOOR × hallucinatedCount, hallucinatedCount / totalCited)
 *
 * The proportional component handles the small-slip case ("1 of 5 fake → 20%
 * off"), and the floor handles the padding case ("1 of 50 fake → still 15%
 * off, not 2%"). Returns 0 when there were no fakes.
 *
 * @returns penalty fraction in [0, 1] — 0 means no reduction, 1 means score
 *   goes to zero. No cap.
 */
export function computeHallucinationPenalty(
  hallucinatedCount: number,
  totalCitedCount: number,
): number {
  if (hallucinatedCount <= 0 || totalCitedCount <= 0) return 0;
  const proportional = hallucinatedCount / totalCitedCount;
  const floor = HALLUCINATION_PENALTY_FLOOR * hallucinatedCount;
  return Math.min(1, Math.max(floor, proportional));
}

/**
 * Validate that all evidence IDs in extracted signals reference canonical IDs.
 * Invalid IDs are stripped (not thrown). Confidence is reduced proportionally
 * to the survival ratio. The raw score is reduced per the H-9 hallucination-
 * penalty formula and `hallucinationPenalty` metadata is attached for
 * downstream renderers.
 */
export function validateGrounding(
  signals: ExtractedSignals,
  canonicalIds: Set<string>,
): GroundingResult {
  const violations: GroundingViolation[] = [];

  const validated: ExtractedSignals = {
    technicalDepth: validateDimension('technicalDepth', signals.technicalDepth, canonicalIds, violations),
    domainRelevance: validateDimension('domainRelevance', signals.domainRelevance, canonicalIds, violations),
    trajectoryMatch: validateDimension('trajectoryMatch', signals.trajectoryMatch, canonicalIds, violations),
    cultureFit: validateDimension('cultureFit', signals.cultureFit, canonicalIds, violations),
    reachability: validateDimension('reachability', signals.reachability, canonicalIds, violations),
    redFlags: signals.redFlags.filter((flag) => {
      if (canonicalIds.has(flag.evidenceId)) return true;
      violations.push({
        dimension: 'redFlags',
        invalidId: flag.evidenceId,
        action: 'red_flag_dropped',
      });
      return false;
    }),
  };

  return { validated, violations };
}

function validateDimension(
  name: string,
  dim: SignalDimension,
  canonicalIds: Set<string>,
  violations: GroundingViolation[],
): SignalDimension {
  const originalCount = dim.evidenceIds.length;
  const validIds = dim.evidenceIds.filter((id) => {
    if (canonicalIds.has(id)) return true;
    violations.push({ dimension: name, invalidId: id, action: 'removed' });
    return false;
  });

  // Confidence drop: proportional to ID survival ratio (existing behavior).
  const ratio = originalCount > 0 ? validIds.length / originalCount : 1;
  const adjustedConfidence = dim.confidence * ratio;

  // Score drop: H-9 hallucination penalty (new). Distinct from confidence:
  // confidence reduction = "we trust this dimension less"; score reduction
  // = "the candidate looks worse for fabricated reasoning".
  const hallucinatedCount = originalCount - validIds.length;
  const penaltyApplied = computeHallucinationPenalty(hallucinatedCount, originalCount);
  const adjustedScore = dim.score * (1 - penaltyApplied);

  return {
    score: adjustedScore,
    evidenceIds: validIds,
    confidence: adjustedConfidence,
    ...(hallucinatedCount > 0
      ? {
          hallucinationPenalty: {
            hallucinatedCount,
            totalCitedCount: originalCount,
            penaltyApplied,
            rawScoreBeforePenalty: dim.score,
          },
        }
      : {}),
  };
}
