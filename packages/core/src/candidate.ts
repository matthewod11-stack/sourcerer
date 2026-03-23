// Candidate types — the canonical entity flowing through the pipeline

import type { PersonIdentity, ObservedIdentifier } from './identity.js';
import type { EvidenceItem } from './evidence.js';
import type { ExtractedSignals, Score } from './scoring.js';

// --- PII Tracking ---

export type PIIFieldType = 'email' | 'phone' | 'address';

export interface PIIField {
  value: string;
  type: PIIFieldType;
  adapter: string;
  collectedAt: string;
  retentionExpiresAt?: string;
}

export interface PIIMetadata {
  fields: PIIField[];
  retentionPolicy: 'default' | 'custom';
}

// --- Source Data ---

/** Per-adapter raw data attached to a candidate */
export interface SourceData {
  adapter: string;
  retrievedAt: string;
  rawProfile?: Record<string, unknown>;
  urls: string[];
  metadata?: Record<string, unknown>;
}

// --- Candidate Lifecycle ---

/** Pre-identity-resolution candidate as returned by adapters */
export interface RawCandidate {
  name: string;
  identifiers: ObservedIdentifier[];
  sourceData: SourceData;
  evidence: EvidenceItem[];
  piiFields: PIIField[];
}

/** The canonical candidate flowing through the pipeline */
export interface Candidate {
  /** Stable UUID — always === identity.canonicalId */
  id: string;
  identity: PersonIdentity;
  name: string;
  sources: Record<string, SourceData>;
  evidence: EvidenceItem[];
  enrichments: Record<string, EnrichmentResult>;
  signals?: ExtractedSignals;
  score?: Score;
  narrative?: string;
  tier?: 1 | 2 | 3;
  pii: PIIMetadata;
}

/** Candidate with all scoring fields populated, ready for output */
export interface ScoredCandidate extends Candidate {
  signals: ExtractedSignals;
  score: Score;
  narrative: string;
  tier: 1 | 2 | 3;
}

// Forward-declared here to avoid circular imports — used by Candidate.enrichments
// Full definition lives in pipeline.ts but the shape is needed here
/** Result of enriching a candidate from a single adapter */
export interface EnrichmentResult {
  adapter: string;
  candidateId: string;
  evidence: EvidenceItem[];
  piiFields: PIIField[];
  sourceData: SourceData;
  enrichedAt: string;
}
