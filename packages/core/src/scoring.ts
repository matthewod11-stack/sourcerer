// Scoring types — transparent, decomposable scoring with evidence grounding

/** A risk signal linked to evidence */
export interface RedFlag {
  signal: string;
  evidenceId: string;
  severity: 'low' | 'medium' | 'high';
}

/** A single scoring dimension with evidence references */
export interface SignalDimension {
  score: number;
  evidenceIds: string[];
  confidence: number;
}

/** A weighted score component in the final breakdown */
export interface ScoreComponent {
  dimension: string;
  raw: number;
  weight: number;
  weighted: number;
  evidenceIds: string[];
  confidence: number;
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
