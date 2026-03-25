// Evidence grounding validation — strips hallucinated IDs and adjusts confidence

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
 * Validate that all evidence IDs in extracted signals reference canonical IDs.
 * Invalid IDs are stripped (not thrown). Confidence is reduced proportionally.
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

  // Adjust confidence proportionally to how many IDs survived
  const ratio = originalCount > 0 ? validIds.length / originalCount : 1;
  const adjustedConfidence = dim.confidence * ratio;

  return {
    score: dim.score,
    evidenceIds: validIds,
    confidence: adjustedConfidence,
  };
}
