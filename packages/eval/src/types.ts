import type {
  Candidate,
  ExtractedSignals,
  ScoredCandidate,
  SearchConfig,
  TalentProfile,
} from '@sourcerer/core';

export type ScoreDimension =
  | 'technicalDepth'
  | 'domainRelevance'
  | 'trajectoryMatch'
  | 'cultureFit'
  | 'reachability';

export const SCORE_DIMENSIONS: readonly ScoreDimension[] = [
  'technicalDepth',
  'domainRelevance',
  'trajectoryMatch',
  'cultureFit',
  'reachability',
] as const;

export interface GoldenCandidate {
  id: string;
  candidate: Candidate;
  expectedTier: 1 | 2 | 3;
  expectedSignals: Pick<ExtractedSignals, ScoreDimension | 'redFlags'>;
  rationale: string;
}

export interface GoldenSet {
  name: string;
  description: string;
  searchConfig: SearchConfig;
  talentProfile: TalentProfile;
  candidates: GoldenCandidate[];
}

export interface CandidateEvalResult {
  id: string;
  name: string;
  expectedTier: 1 | 2 | 3;
  actualTier: 1 | 2 | 3;
  exactTierMatch: boolean;
  tierDistance: number;
  totalScore: number;
  dimensionDeltas: Record<ScoreDimension, number>;
  hallucinationCount: number;
  citedEvidenceCount: number;
  costUsd: number;
  scoredCandidate: ScoredCandidate;
}

export interface GoldenEvalMetrics {
  candidateCount: number;
  exactTierAccuracy: number;
  tierProximityAccuracy: number;
  meanAbsoluteErrorByDimension: Record<ScoreDimension, number>;
  hallucinationRate: number;
  totalHallucinations: number;
  totalCitedEvidence: number;
  totalCostUsd: number;
}

export interface GoldenEvalReport {
  name: string;
  generatedAt: string;
  modelLabel: string;
  mode?: 'per-candidate' | 'batch';
  metrics: GoldenEvalMetrics;
  results: CandidateEvalResult[];
  batchRanking?: BatchRankingEntry[];
}

export interface BatchRankingEntry {
  candidateId: string;
  rank: number;
  rationale: string;
}

export interface GoldenEvalComparison {
  name: string;
  generatedAt: string;
  modelLabel: string;
  baseline: GoldenEvalReport;
  batch: GoldenEvalReport;
  deltas: {
    exactTierAccuracy: number;
    tierProximityAccuracy: number;
    hallucinationRate: number;
    totalCostUsd: number;
    meanAbsoluteErrorByDimension: Record<ScoreDimension, number>;
  };
}
