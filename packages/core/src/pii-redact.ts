// PII redaction for terminal logs and any user-visible output.
//
// H-3: BEFORE this helper existed, `apps/cli/src/handlers.ts:253` logged raw
// emails to stdout during cross-candidate dedup, leaking PII to terminal
// scrollback, CI logs, redirected stdout, and any tail/grep operation. This
// module gives every CLI surface a single, audited path for redacting PII
// before it hits a stream.
//
// Contract:
//   email   → first 2 chars of local + "***" + domain (e.g. "al***@example.com").
//             If local is ≤2 chars or the address is malformed, the whole
//             value collapses to "***".
//   phone   → "***-" + last 4 digits (after stripping non-digits).
//             If <4 digits, the whole value collapses to "***".
//   address → "[REDACTED]". No adapter produces structured address PII today;
//             when one does, refine here.
//   unknown → "***" (defensive default for forward-compat with new PIIFieldType
//             values; never leak raw unknown PII).
//
// The helper is for LOGGING. Storage uses the raw value plus
// `retentionExpiresAt`; `purge --expired` then redacts at TTL.

import type { PIIFieldType } from './candidate.js';

const EMAIL_LOCAL_MIN_VISIBLE_CHARS = 2;
const PHONE_VISIBLE_DIGITS = 4;
const FALLBACK = '***';
const ADDRESS_PLACEHOLDER = '[REDACTED]';

/**
 * Redact a PII value for safe display in logs, terminal output, or
 * non-storage UI. Never use for fields that need to round-trip — use the
 * raw value plus retentionExpiresAt for those.
 */
export function redactPII(value: string, type: PIIFieldType): string {
  if (type === 'address') {
    return ADDRESS_PLACEHOLDER;
  }
  if (type === 'email') {
    return redactEmail(value);
  }
  if (type === 'phone') {
    return redactPhone(value);
  }
  // Forward-compat: unknown types must NOT leak.
  return FALLBACK;
}

function redactEmail(value: string): string {
  if (!value) return FALLBACK;
  const at = value.indexOf('@');
  if (at <= 0) return FALLBACK; // no @ or local part empty

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!domain) return FALLBACK; // empty domain after @

  if (local.length <= EMAIL_LOCAL_MIN_VISIBLE_CHARS) {
    // Showing fewer than 3 chars of the local would leak that the local is
    // very short — collapse to *** to avoid that signal.
    return `${FALLBACK}@${domain}`;
  }
  return `${local.slice(0, EMAIL_LOCAL_MIN_VISIBLE_CHARS)}${FALLBACK}@${domain}`;
}

function redactPhone(value: string): string {
  if (!value) return FALLBACK;
  const digits = value.replace(/\D/g, '');
  if (digits.length < PHONE_VISIBLE_DIGITS) return FALLBACK;
  return `${FALLBACK}-${digits.slice(-PHONE_VISIBLE_DIGITS)}`;
}
