// Cost tracking — accumulates costs per-phase and per-adapter

import type { CostSnapshot } from './pipeline-types.js';

export class CostTracker {
  private totalCost = 0;
  private perPhase: Record<string, number> = {};
  private perAdapter: Record<string, number> = {};

  recordCost(phase: string, amount: number, adapter?: string): void {
    this.totalCost += amount;
    this.perPhase[phase] = (this.perPhase[phase] ?? 0) + amount;
    if (adapter) {
      this.perAdapter[adapter] = (this.perAdapter[adapter] ?? 0) + amount;
    }
  }

  snapshot(): CostSnapshot {
    return {
      totalCost: this.totalCost,
      perPhase: { ...this.perPhase },
      perAdapter: { ...this.perAdapter },
      currency: 'USD',
    };
  }

  exceedsBudget(maxCostUsd: number): boolean {
    return this.totalCost > maxCostUsd;
  }

  restoreFrom(snapshot: CostSnapshot): void {
    this.totalCost = snapshot.totalCost;
    this.perPhase = { ...snapshot.perPhase };
    this.perAdapter = { ...snapshot.perAdapter };
  }
}
