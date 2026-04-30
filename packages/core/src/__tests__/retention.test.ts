// Tests for computeRetentionExpiresAt — H-2 retention TTL helper

import { describe, it, expect } from 'vitest';
import { computeRetentionExpiresAt } from '../candidate.js';

describe('computeRetentionExpiresAt', () => {
  it('adds the requested number of days to the collection time', () => {
    const collectedAt = '2026-01-01T00:00:00.000Z';
    const result = computeRetentionExpiresAt(collectedAt, 90);
    expect(result).toBe('2026-04-01T00:00:00.000Z');
  });

  it('produces a 30-day TTL roughly 30 days after collection', () => {
    const collectedAt = '2026-04-30T12:00:00.000Z';
    const result = computeRetentionExpiresAt(collectedAt, 30);
    const collectedMs = new Date(collectedAt).getTime();
    const resultMs = new Date(result).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    expect(resultMs - collectedMs).toBe(30 * dayMs);
  });

  it('returns the same instant when ttlDays is 0', () => {
    const collectedAt = '2026-04-30T12:00:00.000Z';
    expect(computeRetentionExpiresAt(collectedAt, 0)).toBe(collectedAt);
  });

  it('returns a valid ISO-8601 string that round-trips through Date', () => {
    const collectedAt = '2026-04-30T12:34:56.789Z';
    const result = computeRetentionExpiresAt(collectedAt, 7);
    expect(new Date(result).toISOString()).toBe(result);
    expect(Number.isFinite(new Date(result).getTime())).toBe(true);
  });

  it('handles fractional ttlDays by passing them through (no rounding)', () => {
    // Defensive: callers should pass integers, but the helper shouldn't silently round.
    const collectedAt = '2026-01-01T00:00:00.000Z';
    const result = computeRetentionExpiresAt(collectedAt, 0.5);
    // 0.5 days = 12 hours
    expect(result).toBe('2026-01-01T12:00:00.000Z');
  });

  it('throws on a non-ISO collectedAt rather than silently producing NaN', () => {
    expect(() => computeRetentionExpiresAt('not-a-date', 30)).toThrow();
  });

  it('throws on a negative ttlDays (would produce a date in the past)', () => {
    expect(() => computeRetentionExpiresAt('2026-01-01T00:00:00.000Z', -1)).toThrow();
  });
});
