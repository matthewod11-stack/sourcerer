import { describe, it, expect, vi } from 'vitest';
import type { DataSource, SearchConfig, CostEstimate } from '@sourcerer/core';
import { estimateBudget, formatBudgetEstimate, confirmBudget } from '../budget-estimator.js';

// --- Helpers ---

function makeSearchConfig(overrides?: Partial<SearchConfig>): SearchConfig {
  return {
    roleName: 'Senior Backend Engineer',
    tiers: [
      {
        priority: 1,
        queries: [
          { text: 'senior backend engineer', maxResults: 10 },
          { text: 'staff engineer golang', maxResults: 10 },
        ],
      },
    ],
    scoringWeights: { technicalDepth: 0.3 },
    tierThresholds: { tier1MinScore: 80, tier2MinScore: 60 },
    enrichmentPriority: [],
    antiFilters: [],
    maxCandidates: 25,
    createdAt: '2026-04-06T00:00:00Z',
    version: 1,
    ...overrides,
  };
}

function makeMockAdapter(name: string, estimatedCost: number): DataSource {
  return {
    name,
    capabilities: ['discovery'],
    rateLimits: {},
    search: vi.fn() as unknown as DataSource['search'],
    enrich: vi.fn() as unknown as DataSource['enrich'],
    enrichBatch: vi.fn() as unknown as DataSource['enrichBatch'],
    healthCheck: vi.fn() as unknown as DataSource['healthCheck'],
    estimateCost: vi.fn().mockReturnValue({
      estimatedCost,
      breakdown: { search: estimatedCost },
      searchCount: 2,
      enrichCount: 0,
      currency: 'USD',
    } satisfies CostEstimate),
  };
}

// --- Tests ---

describe('estimateBudget', () => {
  it('aggregates costs from multiple adapters correctly', () => {
    const adapters = {
      exa: makeMockAdapter('exa', 0.025),
      github: makeMockAdapter('github', 0),
      x: makeMockAdapter('x', 0.01),
    };
    const config = makeSearchConfig({ maxCandidates: 10 });

    const result = estimateBudget(adapters, config, 10);

    expect(result.perAdapter.exa).toBe(0.025);
    expect(result.perAdapter.github).toBe(0);
    expect(result.perAdapter.x).toBe(0.01);
    expect(result.aiEstimate).toBeCloseTo(0.1); // 10 * 0.01
    expect(result.total).toBeCloseTo(0.135); // 0.025 + 0 + 0.01 + 0.1
    expect(result.currency).toBe('USD');
  });

  it('handles undefined (unconfigured) adapters', () => {
    const adapters = {
      exa: makeMockAdapter('exa', 0.05),
      github: undefined,
      x: undefined,
      hunter: undefined,
    };
    const config = makeSearchConfig({ maxCandidates: 20 });

    const result = estimateBudget(adapters, config, 20);

    expect(result.perAdapter).toEqual({ exa: 0.05 });
    expect(Object.keys(result.perAdapter)).toHaveLength(1);
    expect(result.aiEstimate).toBeCloseTo(0.2); // 20 * 0.01
    expect(result.total).toBeCloseTo(0.25);
  });

  it('includes AI estimate based on candidate count', () => {
    const adapters = { exa: makeMockAdapter('exa', 0) };
    const config = makeSearchConfig();

    const result = estimateBudget(adapters, config, 100);

    expect(result.aiEstimate).toBeCloseTo(1.0); // 100 * 0.01
  });

  it('falls back to maxCandidates from searchConfig when no candidateCount provided', () => {
    const adapters = { exa: makeMockAdapter('exa', 0) };
    const config = makeSearchConfig({ maxCandidates: 30 });

    const result = estimateBudget(adapters, config);

    expect(result.aiEstimate).toBeCloseTo(0.3); // 30 * 0.01
  });

  it('falls back to 50 when neither candidateCount nor maxCandidates provided', () => {
    const adapters = { exa: makeMockAdapter('exa', 0) };
    const config = makeSearchConfig({ maxCandidates: undefined });

    const result = estimateBudget(adapters, config);

    expect(result.aiEstimate).toBeCloseTo(0.5); // 50 * 0.01
  });
});

describe('formatBudgetEstimate', () => {
  it('includes all non-zero adapter costs', () => {
    const estimate = {
      total: 0.135,
      perAdapter: { exa: 0.025, github: 0, x: 0.01 },
      aiEstimate: 0.1,
      aiPerCandidate: 0.01,
      currency: 'USD' as const,
    };

    const result = formatBudgetEstimate(estimate);

    expect(result).toContain('exa: $0.0250');
    expect(result).toContain('x: $0.0100');
    expect(result).not.toContain('github');
  });

  it('always includes AI estimate', () => {
    const estimate = {
      total: 0.5,
      perAdapter: {},
      aiEstimate: 0.5,
      aiPerCandidate: 0.01,
      currency: 'USD' as const,
    };

    const result = formatBudgetEstimate(estimate);

    expect(result).toContain('AI: $0.5000');
  });

  it('formats dollar amounts correctly', () => {
    const estimate = {
      total: 0.035,
      perAdapter: { exa: 0.025 },
      aiEstimate: 0.01,
      aiPerCandidate: 0.01,
      currency: 'USD' as const,
    };

    const result = formatBudgetEstimate(estimate);

    // Should use 4 decimal places for costs < $1
    expect(result).toContain('~$0.0350');
    expect(result).toContain('exa: $0.0250');
    expect(result).toContain('AI: $0.0100');
  });

  it('formats costs >= $1 with 2 decimal places', () => {
    const estimate = {
      total: 2.5,
      perAdapter: { exa: 1.5 },
      aiEstimate: 1.0,
      aiPerCandidate: 0.02,
      currency: 'USD' as const,
    };

    const result = formatBudgetEstimate(estimate);

    expect(result).toContain('~$2.50');
    expect(result).toContain('exa: $1.50');
    expect(result).toContain('AI: $1.00');
  });
});

describe('confirmBudget', () => {
  it('returns true when skipConfirm is true (no prompt needed)', async () => {
    const estimate = {
      total: 0.5,
      perAdapter: { exa: 0.025 },
      aiEstimate: 0.475,
      aiPerCandidate: 0.0095,
      currency: 'USD' as const,
    };

    const result = await confirmBudget(estimate, true);

    expect(result).toBe(true);
  });
});
