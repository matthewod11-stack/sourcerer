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

// --- Retention Helpers ---

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the retention expiry timestamp for a PII field.
 *
 * H-2: every PIIField MUST set retentionExpiresAt at collection time so that
 * `sourcerer candidates purge --expired` actually purges anything. Without this
 * helper, parsers tend to produce PIIField objects with collectedAt but no
 * retentionExpiresAt, making the purge command a no-op.
 *
 * @param collectedAt ISO-8601 timestamp of when the PII was collected.
 * @param ttlDays Number of days the PII may be retained. Pass `config.retention.ttlDays`.
 * @returns ISO-8601 timestamp at which the PII becomes eligible for redaction.
 * @throws If `collectedAt` is not a valid ISO-8601 timestamp, or `ttlDays` is negative.
 */
export function computeRetentionExpiresAt(collectedAt: string, ttlDays: number): string {
  const baseMs = new Date(collectedAt).getTime();
  if (!Number.isFinite(baseMs)) {
    throw new Error(
      `computeRetentionExpiresAt: collectedAt is not a valid ISO-8601 timestamp: ${String(collectedAt)}`,
    );
  }
  if (ttlDays < 0) {
    throw new Error(
      `computeRetentionExpiresAt: ttlDays must be non-negative (got ${ttlDays}). ` +
        'A negative TTL would make PII expire before it was collected.',
    );
  }
  return new Date(baseMs + ttlDays * MS_PER_DAY).toISOString();
}
