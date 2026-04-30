// Model pricing — per-1M-token rates for cost computation (H-7).
//
// All values are USD per 1,000,000 tokens. Pricing for prompt-cache reads is
// charged at the provider's discounted rate (~10% of input rate for both
// Anthropic and OpenAI).
//
// Verified: 2026-04-30. Update this table when provider list-pricing changes.

import type { TokenUsage } from '@sourcerer/core';

export interface ModelPricing {
  /** USD per 1M non-cached input tokens. */
  inputPer1M: number;
  /** USD per 1M generated output tokens. */
  outputPer1M: number;
  /** USD per 1M tokens served from the provider's prompt cache. */
  cacheReadPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4-7': { inputPer1M: 15.0, outputPer1M: 75.0, cacheReadPer1M: 1.5 },
  'claude-sonnet-4-6': { inputPer1M: 3.0, outputPer1M: 15.0, cacheReadPer1M: 0.3 },
  'claude-haiku-4-5': { inputPer1M: 1.0, outputPer1M: 5.0, cacheReadPer1M: 0.1 },

  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0, cacheReadPer1M: 1.25 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, cacheReadPer1M: 0.075 },
};

/**
 * Look up pricing for a model. Returns `undefined` for unknown models so
 * callers can decide between fallback estimates, warnings, or errors.
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  return MODEL_PRICING[model];
}

/**
 * Compute the USD cost of a single LLM call from its `TokenUsage`. Returns
 * `0` if the model is not in the pricing table — the caller is responsible
 * for surfacing missing-pricing warnings.
 *
 * The formula assumes Anthropic-style accounting where `inputTokens` already
 * excludes cached tokens (the providers' `chat`/`structuredOutput` impls
 * normalize OpenAI's response into the same shape).
 */
export function computeCost(usage: TokenUsage): number {
  const pricing = MODEL_PRICING[usage.model];
  if (!pricing) return 0;

  return (
    (usage.inputTokens * pricing.inputPer1M) / 1_000_000 +
    (usage.cachedTokens * pricing.cacheReadPer1M) / 1_000_000 +
    (usage.outputTokens * pricing.outputPer1M) / 1_000_000
  );
}

/**
 * Estimate the AI cost per candidate for budget gating. Two LLM calls per
 * candidate (signal extraction + narrative). Heuristic: ~1K input tokens,
 * ~500 output tokens per call. Returns `0` for unknown models — callers
 * should fall back to a flat constant (`AI_COST_PER_CANDIDATE_FALLBACK`).
 */
export function estimatePerCandidateCost(model: string): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;

  const inputCost = (1000 * pricing.inputPer1M) / 1_000_000;
  const outputCost = (500 * pricing.outputPer1M) / 1_000_000;
  // 2 calls per candidate (extract + narrative)
  return (inputCost + outputCost) * 2;
}

/** Fallback when `estimatePerCandidateCost` returns 0 (unknown model). */
export const AI_COST_PER_CANDIDATE_FALLBACK = 0.01;
