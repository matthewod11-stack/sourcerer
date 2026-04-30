// Tests for redactPII — H-3 PII redaction helper.
//
// Contract (per CLAUDE.md security conventions and the H-3 issue spec):
//   email   → first 2 chars of local + "***" + "@" + domain
//   phone   → "***-" + last 4 digits
//   address → "[REDACTED]" (no structured address data exists yet; can be
//             refined when an adapter starts producing it)
//
// The helper is meant for terminal logging, console output, and any place
// where raw PII would otherwise leak. NOT for storage — storage uses the
// raw value with retentionExpiresAt, then `purge --expired` redacts.

import { describe, it, expect } from 'vitest';
import { redactPII } from '../pii-redact.js';

describe('redactPII — email', () => {
  it('keeps the first 2 characters of the local part and the full domain', () => {
    expect(redactPII('alice@example.com', 'email')).toBe('al***@example.com');
  });

  it('preserves subdomain and TLD structure', () => {
    expect(redactPII('jane.doe@mail.acme.io', 'email')).toBe('ja***@mail.acme.io');
  });

  it('lowercases nothing — preserves casing of input (caller normalises)', () => {
    // The helper does not normalise; it redacts what it was given. This
    // matches sourcerer's pattern of normalising at adapter boundaries.
    expect(redactPII('Alice@Example.com', 'email')).toBe('Al***@Example.com');
  });

  it('redacts the whole local part when local is 1 character', () => {
    // "a***@..." would leak that the local is a single character.
    // Better to redact the whole local for very short inputs.
    expect(redactPII('a@example.com', 'email')).toBe('***@example.com');
  });

  it('redacts the whole local part when local is exactly 2 characters', () => {
    // Same reasoning as above — "ab***@..." leaks that the local was exactly 2 chars.
    expect(redactPII('ab@example.com', 'email')).toBe('***@example.com');
  });

  it('returns "***" for an email with no @ sign', () => {
    expect(redactPII('not-an-email', 'email')).toBe('***');
  });

  it('returns "***" for an empty string', () => {
    expect(redactPII('', 'email')).toBe('***');
  });

  it('returns "***" for an email with empty local part', () => {
    expect(redactPII('@example.com', 'email')).toBe('***');
  });

  it('returns "***" for an email with empty domain', () => {
    expect(redactPII('alice@', 'email')).toBe('***');
  });
});

describe('redactPII — phone', () => {
  it('keeps last 4 digits of a US-formatted number', () => {
    expect(redactPII('(415) 555-1234', 'phone')).toBe('***-1234');
  });

  it('keeps last 4 digits of a +country-prefixed number', () => {
    expect(redactPII('+1 415 555 1234', 'phone')).toBe('***-1234');
  });

  it('keeps last 4 digits of a digits-only number', () => {
    expect(redactPII('4155551234', 'phone')).toBe('***-1234');
  });

  it('strips non-digits before taking last 4 (extension digits count)', () => {
    // Non-digit chars are stripped, then last 4 of the remaining digit string.
    // For "415-555-1234x99" the digit sequence is "415555123499" → last 4 = "3499".
    // The helper deliberately does NOT try to parse extensions; that would
    // require ambiguous heuristics and risk leaking format clues.
    expect(redactPII('415-555-1234x99', 'phone')).toBe('***-3499');
  });

  it('returns "***" when input has fewer than 4 digits', () => {
    expect(redactPII('123', 'phone')).toBe('***');
  });

  it('returns "***" when input has no digits at all', () => {
    expect(redactPII('not a phone', 'phone')).toBe('***');
  });

  it('returns "***" for empty input', () => {
    expect(redactPII('', 'phone')).toBe('***');
  });
});

describe('redactPII — address', () => {
  // No adapter produces structured address PII today. Until one does, the
  // safe default is to redact the whole value rather than leak fragments.
  it('returns "[REDACTED]" for any non-empty address', () => {
    expect(redactPII('123 Main St, Springfield, IL 62701', 'address')).toBe('[REDACTED]');
  });

  it('returns "[REDACTED]" for empty address', () => {
    expect(redactPII('', 'address')).toBe('[REDACTED]');
  });
});

describe('redactPII — defensive', () => {
  // Defense against future PIIFieldType additions: if the type isn't one
  // we know how to redact, we MUST NOT leak the raw value. Default to ***.
  it('returns "***" for an unknown type', () => {
    expect(redactPII('something-secret', 'unknown' as 'email')).toBe('***');
  });
});
