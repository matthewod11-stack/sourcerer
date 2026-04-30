// GitHubAdapter — enrichment-only DataSource wrapping the GitHub REST API

import type {
  DataSource,
  DataSourceCapability,
  RateLimitConfig,
  SearchConfig,
  SearchPage,
  Candidate,
  EnrichmentResult,
  BatchResult,
  CostEstimate,
} from '@sourcerer/core';
import { GitHubClient, GitHubApiError } from './github-client.js';
import {
  extractEmailsFromCommits,
  computeLanguageDistribution,
  buildProfileEvidence,
  buildContributionTrends,
} from './parsers.js';

/** Options for enrichBatch() */
export interface EnrichBatchOptions {
  /** How long (ms) before a cached enrichment is considered stale. Default: 24h */
  staleTtlMs?: number;
}

const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class GitHubAdapter implements DataSource {
  readonly name = 'github';
  readonly capabilities: DataSourceCapability[] = ['enrichment'];
  readonly rateLimits: RateLimitConfig;

  private client: GitHubClient;
  private delayMs: number;
  /** PII retention window in days; forwarded into PIIField.retentionExpiresAt. H-2. */
  private retentionTtlDays?: number;

  constructor(
    token?: string,
    rateLimits?: Partial<RateLimitConfig>,
    retentionTtlDays?: number,
  ) {
    this.client = new GitHubClient(token);
    this.rateLimits = {
      requestsPerSecond: token ? 1.4 : 0.5,
      requestsPerHour: token ? 5000 : 60,
      ...rateLimits,
    };
    this.delayMs = 1000 / (this.rateLimits.requestsPerSecond ?? 1);
    this.retentionTtlDays = retentionTtlDays;
  }

  async *search(_config: SearchConfig): AsyncGenerator<SearchPage> {
    throw new Error('GitHubAdapter is enrichment-only. Use enrich() or enrichBatch() instead.');
  }

  async enrich(candidate: Candidate): Promise<EnrichmentResult> {
    const now = new Date().toISOString();
    const username = this.extractUsername(candidate);

    if (!username) {
      return this.emptyResult(candidate.id, now);
    }

    try {
      // Fetch profile and repos sequentially to respect rate limits
      // (parallel would double HTTP requests and burst past declared rate)
      await this.delay();
      const user = await this.client.fetchUser(username);
      await this.delay();
      const repos = await this.client.fetchRepos(username, 20);

      // Fetch commits from top 3 repos by stars (for email extraction)
      const topRepos = repos
        .filter((r) => !r.fork)
        .sort((a, b) => b.stargazers_count - a.stargazers_count)
        .slice(0, 3);

      let allCommits: Awaited<ReturnType<GitHubClient['fetchCommits']>> = [];
      for (const repo of topRepos) {
        await this.delay();
        try {
          const commits = await this.client.fetchCommits(username, repo.name, 30);
          allCommits = allCommits.concat(commits);
        } catch {
          // Skip repos where commits fail (e.g., empty repos)
        }
      }

      // Fetch events for contribution trends (best-effort)
      let events: Awaited<ReturnType<GitHubClient['fetchUserEvents']>> = [];
      try {
        await this.delay();
        events = await this.client.fetchUserEvents(username);
      } catch {
        // Events endpoint may fail for various reasons; continue without
      }

      const emails = extractEmailsFromCommits(allCommits);
      const languages = computeLanguageDistribution(repos);
      const { evidence, piiFields, sourceData } = buildProfileEvidence(
        user,
        repos,
        languages,
        emails,
        allCommits.length,
        this.retentionTtlDays,
      );

      // Add contribution trend evidence
      const trendEvidence = buildContributionTrends(repos, events, user.html_url);
      evidence.push(...trendEvidence);

      return {
        adapter: 'github',
        candidateId: candidate.id,
        evidence,
        piiFields,
        sourceData,
        enrichedAt: now,
      };
    } catch (err) {
      if (err instanceof GitHubApiError && err.isNotFound) {
        return this.emptyResult(candidate.id, now);
      }
      throw err;
    }
  }

  async enrichBatch(
    candidates: Candidate[],
    options?: EnrichBatchOptions,
  ): Promise<BatchResult<EnrichmentResult>> {
    const staleTtlMs = options?.staleTtlMs ?? DEFAULT_STALE_TTL_MS;

    const succeeded: { candidateId: string; result: EnrichmentResult }[] = [];
    const failed: { candidateId: string; error: Error; retryable: boolean }[] = [];

    // Separate candidates into cached (skip) vs needs-enrichment
    const toEnrich: Candidate[] = [];
    const now = Date.now();

    for (const candidate of candidates) {
      const existing = candidate.enrichments['github'];
      if (existing && existing.enrichedAt) {
        const enrichedAtMs = new Date(existing.enrichedAt).getTime();
        if (now - enrichedAtMs < staleTtlMs) {
          succeeded.push({ candidateId: candidate.id, result: existing });
          continue;
        }
      }
      toEnrich.push(candidate);
    }

    // Sequential processing: each enrich() call has its own internal delays.
    // Running sequentially ensures the shared rate limit is respected —
    // concurrent candidates would multiply actual request rate.
    let rateLimited = false;

    for (const candidate of toEnrich) {
      if (rateLimited) {
        failed.push({
          candidateId: candidate.id,
          error: new Error('Rate limit exhausted — skipped'),
          retryable: true,
        });
        continue;
      }

      try {
        const result = await this.enrich(candidate);
        succeeded.push({ candidateId: candidate.id, result });
      } catch (err) {
        const isRateLimit = err instanceof GitHubApiError && err.isRateLimit;

        if (isRateLimit) {
          rateLimited = true;
          failed.push({
            candidateId: candidate.id,
            error: err instanceof Error ? err : new Error(String(err)),
            retryable: true,
          });
        } else {
          failed.push({
            candidateId: candidate.id,
            error: err instanceof Error ? err : new Error(String(err)),
            retryable: false,
          });
        }
      }
    }

    return { succeeded, failed, costIncurred: 0 };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const info = await this.client.checkRateLimit();
      return info.remaining > 0;
    } catch {
      return false;
    }
  }

  estimateCost(_config: SearchConfig): CostEstimate {
    return {
      estimatedCost: 0,
      breakdown: {},
      searchCount: 0,
      enrichCount: 0,
      currency: 'USD',
    };
  }

  // --- Private ---

  private extractUsername(candidate: Candidate): string | undefined {
    const githubId = candidate.identity.observedIdentifiers.find(
      (id) => id.type === 'github_username',
    );
    if (githubId) {
      // Normalize: strip URL prefix, @, etc.
      let val = githubId.value.toLowerCase().trim();
      val = val.replace(/^https?:\/\/(www\.)?github\.com\//, '');
      val = val.replace(/^@/, '');
      val = val.replace(/\/+$/, '');
      return val || undefined;
    }
    return undefined;
  }

  private emptyResult(candidateId: string, now: string): EnrichmentResult {
    return {
      adapter: 'github',
      candidateId,
      evidence: [],
      piiFields: [],
      sourceData: { adapter: 'github', retrievedAt: now, urls: [] },
      enrichedAt: now,
    };
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
}
