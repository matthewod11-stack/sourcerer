// ExaAdapter — DataSource implementation wrapping the Exa web search API

import { Exa } from 'exa-js';
import {
  generateEvidenceId,
  type DataSource,
  type DataSourceCapability,
  type RateLimitConfig,
  type SearchConfig,
  type SearchPage,
  type Candidate,
  type EnrichmentResult,
  type BatchResult,
  type CostEstimate,
} from '@sourcerer/core';
import { RateLimiter } from './rate-limiter.js';
import { parseExaResult, type ExaResult } from './parsers.js';

const DEFAULT_NUM_RESULTS = 10;
const COST_PER_SEARCH_ESTIMATE = 0.005;

export class ExaAdapter implements DataSource {
  readonly name = 'exa';
  readonly capabilities: DataSourceCapability[] = ['discovery', 'enrichment'];
  readonly rateLimits: RateLimitConfig;

  private client: InstanceType<typeof Exa>;
  private limiter: RateLimiter;

  constructor(apiKey: string, rateLimits?: Partial<RateLimitConfig>) {
    this.client = new Exa(apiKey);
    this.rateLimits = {
      requestsPerSecond: 1,
      ...rateLimits,
    };
    this.limiter = new RateLimiter(this.rateLimits.requestsPerSecond ?? 1);
  }

  async *search(config: SearchConfig): AsyncGenerator<SearchPage> {
    let totalCandidates = 0;
    const maxCandidates = config.maxCandidates ?? Infinity;

    // P0: Similarity seeds (before any search queries)
    if (config.similaritySeeds && config.similaritySeeds.length > 0) {
      for await (const page of this.findSimilar(config.similaritySeeds)) {
        totalCandidates += page.candidates.length;
        yield page;
        if (totalCandidates >= maxCandidates) return;
      }
    }

    // P1-P4: Tiered queries
    const sortedTiers = [...config.tiers].sort((a, b) => a.priority - b.priority);

    for (const tier of sortedTiers) {
      for (const query of tier.queries) {
        if (totalCandidates >= maxCandidates) return;

        await this.limiter.acquire();

        try {
          const numResults = Math.min(
            query.maxResults ?? DEFAULT_NUM_RESULTS,
            maxCandidates - totalCandidates,
          );

          const response = await this.client.search(query.text, {
            numResults,
            includeDomains: query.includeDomains,
            excludeDomains: query.excludeDomains,
            category: 'people',
          });

          const candidates = response.results.map((r: unknown) =>
            parseExaResult(r as ExaResult, query.text),
          );

          const costIncurred = response.costDollars?.total ?? numResults * COST_PER_SEARCH_ESTIMATE;

          totalCandidates += candidates.length;

          yield {
            candidates,
            hasMore: totalCandidates < maxCandidates && tier !== sortedTiers[sortedTiers.length - 1],
            costIncurred,
          };
        } catch (err) {
          // On error, yield an empty page and continue to next query
          yield {
            candidates: [],
            hasMore: true,
            costIncurred: 0,
          };
        }
      }
    }
  }

  async *findSimilar(urls: string[]): AsyncGenerator<SearchPage> {
    for (const url of urls) {
      await this.limiter.acquire();

      try {
        const response = await this.client.findSimilar(url, {
          numResults: DEFAULT_NUM_RESULTS,
          excludeSourceDomain: true,
        });

        const candidates = response.results.map((r: unknown) =>
          parseExaResult(r as ExaResult, '', url),
        );

        const costIncurred = response.costDollars?.total ?? DEFAULT_NUM_RESULTS * COST_PER_SEARCH_ESTIMATE;

        yield {
          candidates,
          hasMore: false,
          costIncurred,
        };
      } catch {
        yield { candidates: [], hasMore: false, costIncurred: 0 };
      }
    }
  }

  async enrich(candidate: Candidate): Promise<EnrichmentResult> {
    const urls = Object.values(candidate.sources)
      .flatMap((s) => s.urls)
      .filter((u) => u && u.startsWith('http'));

    if (urls.length === 0) {
      return {
        adapter: 'exa',
        candidateId: candidate.id,
        evidence: [],
        piiFields: [],
        sourceData: { adapter: 'exa', retrievedAt: new Date().toISOString(), urls: [] },
        enrichedAt: new Date().toISOString(),
      };
    }

    await this.limiter.acquire();

    try {
      const response = await this.client.getContents(urls.slice(0, 5));
      const now = new Date().toISOString();

      const evidence = response.results.map((r: unknown) => {
        const result = r as ExaResult;
        const text = result.text ?? '';
        const snippet = text.slice(0, 200).replace(/\n/g, ' ').trim();
        const claim = `Content from ${result.url}: ${snippet}`;
        return {
          id: generateEvidenceId({ adapter: 'exa', source: result.url, claim, retrievedAt: now }),
          claim,
          source: result.url,
          adapter: 'exa' as const,
          retrievedAt: now,
          confidence: 'medium' as const,
          url: result.url,
        };
      });

      return {
        adapter: 'exa',
        candidateId: candidate.id,
        evidence,
        piiFields: [],
        sourceData: { adapter: 'exa', retrievedAt: now, urls },
        enrichedAt: now,
      };
    } catch {
      return {
        adapter: 'exa',
        candidateId: candidate.id,
        evidence: [],
        piiFields: [],
        sourceData: { adapter: 'exa', retrievedAt: new Date().toISOString(), urls },
        enrichedAt: new Date().toISOString(),
      };
    }
  }

  async enrichBatch(candidates: Candidate[]): Promise<BatchResult<EnrichmentResult>> {
    const succeeded: { candidateId: string; result: EnrichmentResult }[] = [];
    const failed: { candidateId: string; error: Error; retryable: boolean }[] = [];
    let totalCost = 0;

    for (const candidate of candidates) {
      try {
        const result = await this.enrich(candidate);
        succeeded.push({ candidateId: candidate.id, result });
      } catch (err) {
        const is429 = err instanceof Error && err.message.includes('429');
        failed.push({
          candidateId: candidate.id,
          error: err instanceof Error ? err : new Error(String(err)),
          retryable: is429,
        });
      }
    }

    return { succeeded, failed, costIncurred: totalCost };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.search('test', { numResults: 1, contents: false });
      return true;
    } catch {
      return false;
    }
  }

  estimateCost(config: SearchConfig): CostEstimate {
    let searchCount = 0;

    // Similarity seeds
    if (config.similaritySeeds) {
      searchCount += config.similaritySeeds.length;
    }

    // Tiered queries
    for (const tier of config.tiers) {
      searchCount += tier.queries.length;
    }

    const estimatedCost = searchCount * COST_PER_SEARCH_ESTIMATE;

    return {
      estimatedCost,
      breakdown: { search: estimatedCost },
      searchCount,
      enrichCount: 0,
      currency: 'USD',
    };
  }
}
