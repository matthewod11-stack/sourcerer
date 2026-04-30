// Parse Hunter.io API responses into Sourcerer evidence and PII types

import {
  computeRetentionExpiresAt,
  generateEvidenceId,
  type EvidenceItem,
  type PIIField,
  type ConfidenceLevel,
} from '@sourcerer/core';
import type { HunterEmailResult, HunterVerification } from './hunter-client.js';

// --- Evidence Builders ---

/**
 * Build evidence items from an email finder result.
 * Produces claims about the email address found and the number of online sources.
 */
export function buildEmailEvidence(
  emailResult: HunterEmailResult,
  candidateUrl: string,
): EvidenceItem[] {
  const now = new Date().toISOString();
  const evidence: EvidenceItem[] = [];

  // Primary email claim
  const emailClaim = `Email found via Hunter.io: ${emailResult.email} (confidence: ${emailResult.score}%)`;
  const confidence: ConfidenceLevel =
    emailResult.score >= 80 ? 'high' : emailResult.score >= 50 ? 'medium' : 'low';

  evidence.push({
    id: generateEvidenceId({
      adapter: 'hunter',
      source: candidateUrl,
      claim: emailClaim,
      retrievedAt: now,
    }),
    claim: emailClaim,
    source: candidateUrl,
    adapter: 'hunter',
    retrievedAt: now,
    confidence,
    url: candidateUrl,
  });

  // Sources count claim
  if (emailResult.sources.length > 0) {
    const sourcesClaim = `Email sourced from ${emailResult.sources.length} online sources`;
    evidence.push({
      id: generateEvidenceId({
        adapter: 'hunter',
        source: candidateUrl,
        claim: sourcesClaim,
        retrievedAt: now,
      }),
      claim: sourcesClaim,
      source: candidateUrl,
      adapter: 'hunter',
      retrievedAt: now,
      confidence: 'medium',
      url: candidateUrl,
    });
  }

  return evidence;
}

/**
 * Build evidence items from an email verification result.
 */
export function buildVerificationEvidence(
  verification: HunterVerification,
  candidateUrl: string,
): EvidenceItem[] {
  const now = new Date().toISOString();
  const evidence: EvidenceItem[] = [];

  const verifyClaim = `Email ${verification.email} verified as ${verification.result} (score: ${verification.score})`;
  const confidence: ConfidenceLevel =
    verification.result === 'deliverable'
      ? 'high'
      : verification.result === 'risky'
        ? 'medium'
        : 'low';

  evidence.push({
    id: generateEvidenceId({
      adapter: 'hunter',
      source: candidateUrl,
      claim: verifyClaim,
      retrievedAt: now,
    }),
    claim: verifyClaim,
    source: candidateUrl,
    adapter: 'hunter',
    retrievedAt: now,
    confidence,
    url: candidateUrl,
  });

  return evidence;
}

// --- PII Builder ---

/**
 * Build PII fields from a Hunter email result.
 * Each found email becomes a PIIField with type 'email' and adapter 'hunter'.
 *
 * @param retentionTtlDays Optional retention window in days. When provided,
 * each PIIField is stamped with `retentionExpiresAt = now + ttlDays`. H-2.
 */
export function buildPiiFields(
  emailResult: HunterEmailResult,
  now: string,
  retentionTtlDays?: number,
): PIIField[] {
  const piiFields: PIIField[] = [];
  const retentionExpiresAt =
    retentionTtlDays !== undefined ? computeRetentionExpiresAt(now, retentionTtlDays) : undefined;

  if (emailResult.email) {
    piiFields.push({
      value: emailResult.email,
      type: 'email',
      adapter: 'hunter',
      collectedAt: now,
      retentionExpiresAt,
    });
  }

  return piiFields;
}
