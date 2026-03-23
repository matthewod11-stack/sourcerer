// Pipeline types — adapter interfaces, search config, and orchestration primitives

import type { EvidenceItem } from './evidence.js';
import type {
  Candidate,
  RawCandidate,
  ScoredCandidate,
  EnrichmentResult,
} from './candidate.js';

// --- Rate Limiting ---

export interface RateLimitConfig {
  requestsPerSecond?: number;
  requestsPerMinute?: number;
  requestsPerHour?: number;
  maxConcurrent?: number;
  retryAfterMs?: number;
}

// --- Cost Tracking ---

export interface CostEstimate {
  estimatedCost: number;
  breakdown: Record<string, number>;
  searchCount: number;
  enrichCount: number;
  currency: 'USD';
}

// --- Search & Discovery ---

export interface SearchPage {
  candidates: RawCandidate[];
  cursor?: string;
  hasMore: boolean;
  costIncurred: number;
}

export interface BatchResult<T> {
  succeeded: { candidateId: string; result: T }[];
  failed: { candidateId: string; error: Error; retryable: boolean }[];
  costIncurred: number;
}

export type DataSourceCapability = 'discovery' | 'enrichment';

export interface DataSource {
  name: string;
  capabilities: DataSourceCapability[];
  rateLimits: RateLimitConfig;
  search(config: SearchConfig): AsyncGenerator<SearchPage>;
  enrich(candidate: Candidate): Promise<EnrichmentResult>;
  enrichBatch(candidates: Candidate[]): Promise<BatchResult<EnrichmentResult>>;
  healthCheck(): Promise<boolean>;
  estimateCost(config: SearchConfig): CostEstimate;
}

// --- Search Config (bridge between intake and discovery) ---

export interface SearchQuery {
  text: string;
  targetCompanies?: string[];
  includeDomains?: string[];
  excludeDomains?: string[];
  maxResults?: number;
}

export interface SearchQueryTier {
  priority: 1 | 2 | 3 | 4;
  queries: SearchQuery[];
}

export type ScoringWeights = Record<string, number>;

export interface TierThresholds {
  tier1MinScore: number;
  tier2MinScore: number;
}

export interface EnrichmentPriority {
  adapter: string;
  required: boolean;
  runCondition?: 'always' | 'if_cheap_insufficient';
}

export interface AntiFilter {
  type:
    | 'exclude_company'
    | 'exclude_seniority'
    | 'exclude_signal'
    | 'min_experience_years'
    | 'max_experience_years';
  value: string | number;
  reason?: string;
}

export interface SearchConfig {
  roleName: string;
  tiers: SearchQueryTier[];
  scoringWeights: ScoringWeights;
  tierThresholds: TierThresholds;
  enrichmentPriority: EnrichmentPriority[];
  antiFilters: AntiFilter[];
  similaritySeeds?: string[];
  maxCandidates?: number;
  maxCostUsd?: number;
  createdAt: string;
  version: number;
}

// --- Output ---

export interface OutputConfig {
  outputDir: string;
  format?: string;
  overwrite?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PushResult {
  adapter: string;
  candidatesPushed: number;
  outputLocation: string;
  pushedAt: string;
}

export interface UpsertResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  failed: { candidateId: string; error: Error }[];
}

export interface OutputAdapter {
  name: string;
  requiresAuth: boolean;
  push(candidates: ScoredCandidate[], config: OutputConfig): Promise<PushResult>;
  upsert(candidates: ScoredCandidate[], config: OutputConfig): Promise<UpsertResult>;
  testConnection(): Promise<boolean>;
}

// Re-export EnrichmentResult from candidate.ts for convenience
export type { EnrichmentResult } from './candidate.js';
