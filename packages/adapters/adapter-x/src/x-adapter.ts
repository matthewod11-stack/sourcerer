// XAdapter — enrichment-only DataSource wrapping the X/Twitter REST API v2

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
import { XClient, XApiError, type XTier } from './x-client.js';
import { buildProfileEvidence, buildTweetEvidence } from './parsers.js';

export class XAdapter implements DataSource {
  readonly name = 'x';
  readonly capabilities: DataSourceCapability[] = ['enrichment'];
  readonly rateLimits: RateLimitConfig;

  private client: XClient;
  private delayMs: number;
  private tier: XTier;

  constructor(apiKey: string, tier: XTier = 'basic', rateLimits?: Partial<RateLimitConfig>) {
    this.tier = tier;
    this.client = new XClient(apiKey, tier);
    this.rateLimits = {
      requestsPerMinute: this.client.requestsPerMinute,
      maxConcurrent: tier === 'basic' ? 1 : 3,
      ...rateLimits,
    };
    this.delayMs = 60_000 / (this.rateLimits.requestsPerMinute ?? this.client.requestsPerMinute);
  }

  async *search(_config: SearchConfig): AsyncGenerator<SearchPage> {
    throw new Error('XAdapter is enrichment-only. Use enrich() or enrichBatch() instead.');
  }

  async enrich(candidate: Candidate): Promise<EnrichmentResult> {
    const now = new Date().toISOString();
    const handle = this.extractHandle(candidate);

    if (!handle) {
      return this.emptyResult(candidate.id, now);
    }

    try {
      const user = await this.client.fetchUser(handle);
      const profileUrl = `https://x.com/${user.username}`;
      const profileEvidence = buildProfileEvidence(user, profileUrl);

      // If protected, we can still get profile data (bio/followers are public)
      // but tweets are not accessible
      let tweetEvidence: ReturnType<typeof buildTweetEvidence> = [];
      if (!user.protected) {
        try {
          const tweets = await this.client.fetchRecentTweets(user.id, 50);
          tweetEvidence = buildTweetEvidence(tweets, profileUrl, user.public_metrics.followers_count);
        } catch {
          // Tweet fetch may fail (e.g., rate limit on second call); still return profile evidence
        }
      }

      const evidence = [...profileEvidence, ...tweetEvidence];

      return {
        adapter: 'x',
        candidateId: candidate.id,
        evidence,
        piiFields: [],
        sourceData: {
          adapter: 'x',
          retrievedAt: now,
          urls: [profileUrl],
          rawProfile: {
            id: user.id,
            username: user.username,
            name: user.name,
            description: user.description,
            location: user.location,
            followers_count: user.public_metrics.followers_count,
            following_count: user.public_metrics.following_count,
            tweet_count: user.public_metrics.tweet_count,
            protected: user.protected,
          },
        },
        enrichedAt: now,
      };
    } catch (err) {
      if (err instanceof XApiError && err.isNotFound) {
        return this.emptyResult(candidate.id, now);
      }
      throw err;
    }
  }

  async enrichBatch(candidates: Candidate[]): Promise<BatchResult<EnrichmentResult>> {
    const succeeded: { candidateId: string; result: EnrichmentResult }[] = [];
    const failed: { candidateId: string; error: Error; retryable: boolean }[] = [];

    const maxConcurrent = this.tier === 'basic' ? 1 : (this.rateLimits.maxConcurrent ?? 3);
    let rateLimitHit = false;

    if (maxConcurrent <= 1) {
      // Sequential processing for basic tier
      for (const candidate of candidates) {
        if (rateLimitHit) {
          failed.push({
            candidateId: candidate.id,
            error: new Error('Skipped: rate limit hit on earlier request'),
            retryable: true,
          });
          continue;
        }

        await this.delay();
        try {
          const result = await this.enrich(candidate);
          succeeded.push({ candidateId: candidate.id, result });
        } catch (err) {
          const isRateLimit = err instanceof XApiError && err.isRateLimit;
          if (isRateLimit) {
            rateLimitHit = true;
          }
          failed.push({
            candidateId: candidate.id,
            error: err instanceof Error ? err : new Error(String(err)),
            retryable: isRateLimit,
          });
        }
      }
    } else {
      // Semaphore-based concurrency for pro/enterprise
      let running = 0;
      const queue = [...candidates];

      const processNext = async (): Promise<void> => {
        while (queue.length > 0 && !rateLimitHit) {
          const candidate = queue.shift()!;
          await this.delay();
          try {
            const result = await this.enrich(candidate);
            succeeded.push({ candidateId: candidate.id, result });
          } catch (err) {
            const isRateLimit = err instanceof XApiError && err.isRateLimit;
            if (isRateLimit) {
              rateLimitHit = true;
              // Mark remaining as retryable
              for (const remaining of queue) {
                failed.push({
                  candidateId: remaining.id,
                  error: new Error('Skipped: rate limit hit on earlier request'),
                  retryable: true,
                });
              }
              queue.length = 0;
            }
            failed.push({
              candidateId: candidate.id,
              error: err instanceof Error ? err : new Error(String(err)),
              retryable: isRateLimit,
            });
          }
        }
      };

      const workers: Promise<void>[] = [];
      for (let i = 0; i < maxConcurrent; i++) {
        workers.push(processNext());
      }
      await Promise.all(workers);
    }

    return { succeeded, failed, costIncurred: 0 };
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Attempt to look up the known public account 'X'
      await this.client.fetchUser('X');
      return true;
    } catch {
      return false;
    }
  }

  estimateCost(config: SearchConfig): CostEstimate {
    // X API pricing is tier-based subscription, not per-request
    // Rough estimate: Basic ~$100/mo, Pro ~$5000/mo, Enterprise custom
    const candidateCount = config.maxCandidates ?? 50;
    const requestsPerCandidate = 2; // user lookup + tweets
    const totalRequests = candidateCount * requestsPerCandidate;

    // Approximate cost per request based on tier subscription amortization
    const costPerRequest: Record<XTier, number> = {
      basic: 0.02,
      pro: 0.005,
      enterprise: 0.001,
    };

    const estimated = totalRequests * costPerRequest[this.tier];

    return {
      estimatedCost: Math.round(estimated * 100) / 100,
      breakdown: {
        userLookups: candidateCount * costPerRequest[this.tier],
        tweetFetches: candidateCount * costPerRequest[this.tier],
      },
      searchCount: 0,
      enrichCount: candidateCount,
      currency: 'USD',
    };
  }

  // --- Private ---

  private extractHandle(candidate: Candidate): string | undefined {
    const twitterId = candidate.identity.observedIdentifiers.find(
      (id) => id.type === 'twitter_handle',
    );
    if (twitterId) {
      let val = twitterId.value.trim().toLowerCase();
      // Strip URL patterns: https://x.com/user or https://twitter.com/user
      val = val.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//, '');
      // Strip @ prefix
      val = val.replace(/^@/, '');
      // Strip trailing slashes or query params
      val = val.replace(/[/?#].*$/, '');
      return val || undefined;
    }
    return undefined;
  }

  private emptyResult(candidateId: string, now: string): EnrichmentResult {
    return {
      adapter: 'x',
      candidateId,
      evidence: [],
      piiFields: [],
      sourceData: { adapter: 'x', retrievedAt: now, urls: [] },
      enrichedAt: now,
    };
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
}
