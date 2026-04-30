// Scoring types — transparent, decomposable scoring with evidence grounding

/** A risk signal linked to evidence */
export interface RedFlag {
  signal: string;
  evidenceId: string;
  severity: 'low' | 'medium' | 'high';
}

/**
 * H-9: metadata describing how a hallucinated citation reduced the score for
 * this dimension. Set by `validateGrounding` when at least one cited evidence
 * ID was not in the canonical set; absent on dimensions with clean grounding.
 */
export interface HallucinationPenalty {
  /** Number of cited IDs that did not match a real evidence item. */
  hallucinatedCount: number;
  /** Total cited IDs the LLM provided for this dimension (clean + fabricated). */
  totalCitedCount: number;
  /** Fraction of the raw score deducted (0–1). e.g. 0.20 = 20% off. */
  penaltyApplied: number;
  /** The raw score the LLM produced before the penalty was applied. */
  rawScoreBeforePenalty: number;
}

/** A single scoring dimension with evidence references */
export interface SignalDimension {
  score: number;
  evidenceIds: string[];
  confidence: number;
  /** Set by `validateGrounding` when score was reduced for hallucinated IDs. H-9. */
  hallucinationPenalty?: HallucinationPenalty;
}

/** A weighted score component in the final breakdown */
export interface ScoreComponent {
  dimension: string;
  raw: number;
  weight: number;
  weighted: number;
  evidenceIds: string[];
  confidence: number;
  /** Forwarded from the SignalDimension when set; surfaces in the breakdown. H-9. */
  hallucinationPenalty?: HallucinationPenalty;
}

/** Aggregate score with full breakdown and evidence chain */
export interface Score {
  total: number;
  breakdown: ScoreComponent[];
  weights: Record<string, number>;
  redFlags: RedFlag[];
}

/** LLM-extracted signals per scoring dimension, grounded in evidence */
export interface ExtractedSignals {
  technicalDepth: SignalDimension;
  domainRelevance: SignalDimension;
  trajectoryMatch: SignalDimension;
  cultureFit: SignalDimension;
  reachability: SignalDimension;
  redFlags: RedFlag[];
}
