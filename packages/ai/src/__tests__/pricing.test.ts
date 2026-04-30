// Tests for the H-7 pricing table and cost-computation helpers.

import { describe, it, expect } from 'vitest';
import type { TokenUsage } from '@sourcerer/core';
import {
  MODEL_PRICING,
  AI_COST_PER_CANDIDATE_FALLBACK,
  computeCost,
  estimatePerCandidateCost,
  getModelPricing,
} from '../pricing.js';

const SONNET = 'claude-sonnet-4-6';
const UNKNOWN = 'claude-future-99';

describe('MODEL_PRICING', () => {
  it('seeds the five expected production models', () => {
    expect(MODEL_PRICING).toMatchObject({
      'claude-opus-4-7': expect.any(Object),
      'claude-sonnet-4-6': expect.any(Object),
      'claude-haiku-4-5': expect.any(Object),
      'gpt-4o': expect.any(Object),
      'gpt-4o-mini': expect.any(Object),
    });
  });

  it('charges cache reads less than uncached input for every model', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.cacheReadPer1M).toBeLessThan(pricing.inputPer1M);
      expect(pricing.cacheReadPer1M).toBeGreaterThan(0);
      // sanity: output is more expensive than input across all current models
      expect(pricing.outputPer1M).toBeGreaterThanOrEqual(pricing.inputPer1M);
      // sanity-tag the model so the assertion message points at the bad row
      expect({ model, ok: true }).toEqual({ model, ok: true });
    }
  });
});

describe('getModelPricing', () => {
  it('returns the entry for a known model', () => {
    expect(getModelPricing(SONNET)).toEqual({
      inputPer1M: 3.0,
      outputPer1M: 15.0,
      cacheReadPer1M: 0.3,
    });
  });

  it('returns undefined for an unknown model', () => {
    expect(getModelPricing(UNKNOWN)).toBeUndefined();
  });
});

describe('computeCost', () => {
  it('computes cost for known model with no cache', () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 0,
      model: SONNET,
    };
    // 1000 * 3.0 / 1e6 + 500 * 15.0 / 1e6 = 0.003 + 0.0075 = 0.0105
    expect(computeCost(usage)).toBeCloseTo(0.0105, 6);
  });

  it('discounts cached tokens at the cacheReadPer1M rate', () => {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 100,
      cachedTokens: 1000,
      model: SONNET,
    };
    // 100 * 3.0 / 1e6 + 1000 * 0.3 / 1e6 + 100 * 15.0 / 1e6
    // = 0.0003 + 0.0003 + 0.0015 = 0.0021
    expect(computeCost(usage)).toBeCloseTo(0.0021, 6);
  });

  it('returns 0 for unknown model (caller decides fallback)', () => {
    const usage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 0,
      model: UNKNOWN,
    };
    expect(computeCost(usage)).toBe(0);
  });

  it('zero usage = zero cost (cache-hit case)', () => {
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      model: SONNET,
    };
    expect(computeCost(usage)).toBe(0);
  });
});

describe('estimatePerCandidateCost', () => {
  it('returns 2× per-call estimate (extract + narrative) using known pricing', () => {
    // Sonnet: 1000 in × 3/1e6 + 500 out × 15/1e6 = 0.003 + 0.0075 = 0.0105 per call
    // 2 calls per candidate
    expect(estimatePerCandidateCost(SONNET)).toBeCloseTo(0.021, 6);
  });

  it('returns 0 for unknown model so callers can fall back', () => {
    expect(estimatePerCandidateCost(UNKNOWN)).toBe(0);
  });

  it('Haiku is meaningfully cheaper than Opus per candidate', () => {
    const haiku = estimatePerCandidateCost('claude-haiku-4-5');
    const opus = estimatePerCandidateCost('claude-opus-4-7');
    expect(haiku).toBeGreaterThan(0);
    expect(opus).toBeGreaterThan(haiku);
    // Opus should be at least 10× more expensive per candidate
    expect(opus / haiku).toBeGreaterThan(10);
  });
});

describe('AI_COST_PER_CANDIDATE_FALLBACK', () => {
  it('matches the legacy flat rate so behavior is preserved when model is unknown', () => {
    expect(AI_COST_PER_CANDIDATE_FALLBACK).toBe(0.01);
  });
});
