// Migration shim for legacy PIIField records that pre-date H-2.
//
// Before H-2 landed, adapter parsers wrote PIIField objects with `collectedAt`
// but no `retentionExpiresAt`, which made `sourcerer candidates purge --expired`
// a silent no-op for any run created before this commit.
//
// This shim backfills `retentionExpiresAt` on legacy fields when candidates are
// loaded from disk. The policy used here directly affects user-visible privacy
// behavior — see the policy enum below.

import type { PIIField, RunMeta } from '@sourcerer/core';
import { computeRetentionExpiresAt } from '@sourcerer/core';

/**
 * Policy for backfilling legacy PIIField records that lack a retentionExpiresAt.
 *
 * - 'expired-now': treat legacy fields as already expired (next purge redacts them).
 *                  Maximally privacy-protective; risks surprise data loss.
 * - 'collected-at': compute expiresAt = collectedAt + ttlDays. Falls back to
 *                   'expired-now' if collectedAt is missing or unparseable.
 * - 'run-started-at': compute expiresAt = run.startedAt + ttlDays. Falls back to
 *                     'expired-now' if startedAt is missing.
 */
export type LegacyRetentionPolicy = 'expired-now' | 'collected-at' | 'run-started-at';

export interface BackfillOptions {
  policy: LegacyRetentionPolicy;
  ttlDays: number;
  /** Required for 'run-started-at' policy. */
  runStartedAt?: string;
}

/**
 * Backfill `retentionExpiresAt` on a single legacy PIIField record.
 * Returns the field unchanged if it already has `retentionExpiresAt`.
 *
 * TODO(H-2): user to choose policy A / B1 / B2 / C.
 */
export function backfillRetentionExpiry(
  field: PIIField,
  opts: BackfillOptions,
): PIIField {
  if (field.retentionExpiresAt) return field;

  // Sentinel timestamp safely in the past — when read back, < now is true,
  // so the next `purge --expired` will redact this field.
  const EXPIRED_NOW = '1970-01-01T00:00:00.000Z';

  let expiresAt: string;
  try {
    switch (opts.policy) {
      case 'expired-now':
        expiresAt = EXPIRED_NOW;
        break;
      case 'collected-at':
        if (!field.collectedAt) {
          expiresAt = EXPIRED_NOW;
        } else {
          expiresAt = computeRetentionExpiresAt(field.collectedAt, opts.ttlDays);
        }
        break;
      case 'run-started-at':
        if (!opts.runStartedAt) {
          expiresAt = EXPIRED_NOW;
        } else {
          expiresAt = computeRetentionExpiresAt(opts.runStartedAt, opts.ttlDays);
        }
        break;
    }
  } catch {
    // computeRetentionExpiresAt throws on bad input — treat as expired.
    expiresAt = EXPIRED_NOW;
  }

  return { ...field, retentionExpiresAt: expiresAt };
}

/**
 * Backfill all PIIField records on every candidate in a run.
 * Mutates in place and returns true if any field was changed (caller may want
 * to persist the migrated form back to disk).
 */
export function backfillRunRetention(
  candidates: { pii: { fields: PIIField[] } }[],
  meta: Pick<RunMeta, 'startedAt'> | undefined,
  policy: LegacyRetentionPolicy,
  ttlDays: number,
): boolean {
  let changed = false;
  const opts: BackfillOptions = {
    policy,
    ttlDays,
    runStartedAt: meta?.startedAt,
  };

  for (const candidate of candidates) {
    for (let i = 0; i < candidate.pii.fields.length; i++) {
      const field = candidate.pii.fields[i];
      if (!field.retentionExpiresAt) {
        candidate.pii.fields[i] = backfillRetentionExpiry(field, opts);
        changed = true;
      }
    }
  }

  return changed;
}
