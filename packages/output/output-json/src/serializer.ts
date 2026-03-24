import type { ScoredCandidate } from '@sourcerer/core';

export interface JsonOutputPayload {
  version: 1;
  generatedAt: string;
  candidateCount: number;
  candidates: ScoredCandidate[];
  metadata?: Record<string, unknown>;
}

export function serializeCandidates(
  candidates: ScoredCandidate[],
  metadata?: Record<string, unknown>,
): string {
  const payload: JsonOutputPayload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates,
    ...(metadata ? { metadata } : {}),
  };
  return JSON.stringify(payload, null, 2);
}
