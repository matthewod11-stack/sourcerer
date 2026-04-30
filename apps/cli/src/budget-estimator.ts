// Budget estimation — pre-run cost forecasting for pipeline execution

import { confirm } from '@inquirer/prompts';
import type { DataSource, SearchConfig, CostEstimate } from '@sourcerer/core';
import { estimatePerCandidateCost, AI_COST_PER_CANDIDATE_FALLBACK } from '@sourcerer/ai';

export interface BudgetEstimate {
  total: number;
  perAdapter: Record<string, number>;
  aiEstimate: number;
  /** Per-candidate AI cost used in the estimate (USD). Surfaced for tests + telemetry. */
  aiPerCandidate: number;
  /** The model used to look up pricing — `undefined` if the caller didn't pass one. */
  aiModel?: string;
  currency: 'USD';
}

export function estimateBudget(
  adapters: Record<string, DataSource | undefined>,
  searchConfig: SearchConfig,
  estimatedCandidateCount?: number,
  aiModel?: string,
): BudgetEstimate {
  const perAdapter: Record<string, number> = {};

  for (const [name, adapter] of Object.entries(adapters)) {
    if (!adapter) continue;
    const estimate: CostEstimate = adapter.estimateCost(searchConfig);
    perAdapter[name] = estimate.estimatedCost;
  }

  const candidateCount = estimatedCandidateCount ?? searchConfig.maxCandidates ?? 50;
  // H-7: per-model pricing replaces the flat $0.01 constant. Falls back to the
  // legacy constant when the model is unknown to the pricing table.
  const aiPerCandidate = aiModel
    ? (estimatePerCandidateCost(aiModel) || AI_COST_PER_CANDIDATE_FALLBACK)
    : AI_COST_PER_CANDIDATE_FALLBACK;
  const aiEstimate = candidateCount * aiPerCandidate;

  const adapterTotal = Object.values(perAdapter).reduce((sum, v) => sum + v, 0);
  const total = adapterTotal + aiEstimate;

  return { total, perAdapter, aiEstimate, aiPerCandidate, aiModel, currency: 'USD' };
}

export function formatBudgetEstimate(estimate: BudgetEstimate): string {
  const parts: string[] = [];

  for (const [name, cost] of Object.entries(estimate.perAdapter)) {
    if (cost > 0) {
      parts.push(`${name}: $${formatCost(cost)}`);
    }
  }

  parts.push(`AI: $${formatCost(estimate.aiEstimate)}`);

  return `Estimated cost: ~$${formatCost(estimate.total)} (${parts.join(', ')})`;
}

function formatCost(value: number): string {
  return value < 1 ? value.toFixed(4) : value.toFixed(2);
}

export async function confirmBudget(
  estimate: BudgetEstimate,
  skipConfirm?: boolean,
): Promise<boolean> {
  if (skipConfirm) return true;

  console.log(formatBudgetEstimate(estimate));

  return confirm({ message: 'Proceed?' });
}
