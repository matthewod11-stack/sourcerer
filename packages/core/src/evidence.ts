// Evidence types — first-class evidence items with stable ID generation

import type { ConfidenceLevel } from './identity.js';

/** A sourced claim with a stable, deterministic ID */
export interface EvidenceItem {
  id: string;
  claim: string;
  source: string;
  adapter: string;
  retrievedAt: string;
  confidence: ConfidenceLevel;
  url?: string;
}

/** Input for deterministic evidence ID generation */
export interface EvidenceIdInput {
  adapter: string;
  source: string;
  claim: string;
  retrievedAt: string;
}

/**
 * Generate a deterministic evidence ID in `ev-XXXXXX` format.
 * Uses djb2 hash — no external dependencies.
 */
export function generateEvidenceId(input: EvidenceIdInput): string {
  const raw = `${input.adapter}:${input.source}:${input.claim}:${input.retrievedAt}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
  }
  const hex = (hash >>> 0).toString(16).padStart(6, '0').slice(-6);
  return `ev-${hex}`;
}
