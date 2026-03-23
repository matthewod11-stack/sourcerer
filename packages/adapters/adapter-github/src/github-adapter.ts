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
} from './parsers.js';

export class GitHubAdapter implements DataSource {
  readonly name = 'github';
  readonly capabilities: DataSourceCapability[] = ['enrichment'];
  readonly rateLimits: RateLimitConfig;

  private client: GitHubClient;
  private delayMs: number;

  constructor(token?: string, rateLimits?: Partial<RateLimitConfig>) {
    this.client = new GitHubClient(token);
    this.rateLimits = {
      requestsPerSecond: token ? 1.4 : 0.5,
      requestsPerHour: token ? 5000 : 60,
      ...rateLimits,
    };
    this.delayMs = 1000 / (this.rateLimits.requestsPerSecond ?? 1);
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
      // Fetch profile and repos in parallel
      const [user, repos] = await Promise.all([
        this.client.fetchUser(username),
        this.client.fetchRepos(username, 20),
      ]);

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

      const emails = extractEmailsFromCommits(allCommits);
      const languages = computeLanguageDistribution(repos);
      const { evidence, piiFields, sourceData } = buildProfileEvidence(
        user,
        repos,
        languages,
        emails,
        allCommits.length,
      );

      return {
        adapter: 'github',
        candidateId: candidate.id,
        evidence,
        piiFields,
        sourceData,
        enrichedAt: now,
      };
    } catch (err) {
      if (err instanceof GitHubApiError && err.status === 404) {
        return this.emptyResult(candidate.id, now);
      }
      throw err;
    }
  }

  async enrichBatch(candidates: Candidate[]): Promise<BatchResult<EnrichmentResult>> {
    const succeeded: { candidateId: string; result: EnrichmentResult }[] = [];
    const failed: { candidateId: string; error: Error; retryable: boolean }[] = [];

    for (const candidate of candidates) {
      await this.delay();
      try {
        const result = await this.enrich(candidate);
        succeeded.push({ candidateId: candidate.id, result });
      } catch (err) {
        const isRateLimit = err instanceof GitHubApiError && (err.status === 429 || err.status === 403);
        failed.push({
          candidateId: candidate.id,
          error: err instanceof Error ? err : new Error(String(err)),
          retryable: isRateLimit,
        });
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
