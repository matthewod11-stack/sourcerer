// Budget estimation — pre-run cost forecasting for pipeline execution

import { confirm } from '@inquirer/prompts';
import type { DataSource, SearchConfig, CostEstimate } from '@sourcerer/core';

export interface BudgetEstimate {
  total: number;
  perAdapter: Record<string, number>;
  aiEstimate: number;
  currency: 'USD';
}

// AI scoring: ~$0.005 per LLM call, 2 calls per candidate (signal extraction + narrative)
const AI_COST_PER_CANDIDATE = 0.01;

export function estimateBudget(
  adapters: Record<string, DataSource | undefined>,
  searchConfig: SearchConfig,
  estimatedCandidateCount?: number,
): BudgetEstimate {
  const perAdapter: Record<string, number> = {};

  for (const [name, adapter] of Object.entries(adapters)) {
    if (!adapter) continue;
    const estimate: CostEstimate = adapter.estimateCost(searchConfig);
    perAdapter[name] = estimate.estimatedCost;
  }

  const candidateCount = estimatedCandidateCount ?? searchConfig.maxCandidates ?? 50;
  const aiEstimate = candidateCount * AI_COST_PER_CANDIDATE;

  const adapterTotal = Object.values(perAdapter).reduce((sum, v) => sum + v, 0);
  const total = adapterTotal + aiEstimate;

  return { total, perAdapter, aiEstimate, currency: 'USD' };
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
