// HunterAdapter — enrichment-only DataSource wrapping the Hunter.io REST API

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
import { HunterClient, HunterApiError } from './hunter-client.js';
import {
  buildEmailEvidence,
  buildVerificationEvidence,
  buildPiiFields,
} from './parsers.js';

export class HunterAdapter implements DataSource {
  readonly name = 'hunter';
  readonly capabilities: DataSourceCapability[] = ['enrichment'];
  readonly rateLimits: RateLimitConfig;

  private client: HunterClient;
  private delayMs: number;
  private costPerSearch: number;

  constructor(apiKey: string, rateLimits?: Partial<RateLimitConfig>, costPerSearch = 0.03) {
    this.client = new HunterClient(apiKey);
    this.rateLimits = {
      requestsPerSecond: 0.5,
      ...rateLimits,
    };
    this.delayMs = 1000 / (this.rateLimits.requestsPerSecond ?? 0.5);
    this.costPerSearch = costPerSearch;
  }

  async *search(_config: SearchConfig): AsyncGenerator<SearchPage> {
    throw new Error('HunterAdapter is enrichment-only. Use enrich() or enrichBatch() instead.');
  }

  async enrich(candidate: Candidate): Promise<EnrichmentResult> {
    const now = new Date().toISOString();

    // Extract first/last name from candidate
    const { firstName, lastName } = this.extractName(candidate);
    if (!firstName || !lastName) {
      return this.emptyResult(candidate.id, now);
    }

    // Extract domain from candidate sources
    const domain = this.extractDomain(candidate);
    if (!domain) {
      return this.emptyResult(candidate.id, now);
    }

    try {
      // Find email via Hunter
      const emailResult = await this.client.findEmail(domain, firstName, lastName);
      if (!emailResult) {
        return this.emptyResult(candidate.id, now);
      }

      const candidateUrl = `https://hunter.io/find/${domain}`;
      let evidence = buildEmailEvidence(emailResult, candidateUrl);
      const piiFields = buildPiiFields(emailResult, now);

      // Verify the found email
      try {
        const verification = await this.client.verifyEmail(emailResult.email);
        const verifyEvidence = buildVerificationEvidence(verification, candidateUrl);
        evidence = [...evidence, ...verifyEvidence];
      } catch {
        // Verification is best-effort — don't fail the whole enrichment
      }

      return {
        adapter: 'hunter',
        candidateId: candidate.id,
        evidence,
        piiFields,
        sourceData: {
          adapter: 'hunter',
          retrievedAt: now,
          urls: [`https://hunter.io/find/${domain}`],
          rawProfile: {
            email: emailResult.email,
            score: emailResult.score,
            type: emailResult.type,
            position: emailResult.position,
            sourcesCount: emailResult.sources.length,
          },
        },
        enrichedAt: now,
      };
    } catch (err) {
      if (err instanceof HunterApiError && err.status === 404) {
        return this.emptyResult(candidate.id, now);
      }
      throw err;
    }
  }

  async enrichBatch(candidates: Candidate[]): Promise<BatchResult<EnrichmentResult>> {
    const succeeded: { candidateId: string; result: EnrichmentResult }[] = [];
    const failed: { candidateId: string; error: Error; retryable: boolean }[] = [];
    let apiCallCount = 0;

    // Pre-fetch account info to know quota if not already loaded
    if (this.client.getRemainingQuota() === null) {
      try {
        const info = await this.client.getAccountInfo();
        this.client.setQuota(
          info.requests.searches.available - info.requests.searches.used,
        );
      } catch {
        // If we can't get account info, proceed without quota tracking
      }
    }

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      // Check quota before each enrichment
      const remaining = this.client.getRemainingQuota();
      if (remaining !== null && remaining <= 0) {
        // Mark ALL remaining candidates as retryable failures
        for (let j = i; j < candidates.length; j++) {
          failed.push({
            candidateId: candidates[j].id,
            error: new Error(
              `Hunter.io quota exhausted (${remaining} searches remaining)`,
            ),
            retryable: true,
          });
        }
        break;
      }

      await this.delay();

      try {
        // Check if this candidate will actually hit the API
        // (enrich returns early with empty result for missing name/domain)
        const { firstName, lastName } = this.extractName(candidate);
        const domain = this.extractDomain(candidate);
        const willCallApi = !!(firstName && lastName && domain);

        const result = await this.enrich(candidate);
        succeeded.push({ candidateId: candidate.id, result });
        if (willCallApi) apiCallCount++;
      } catch (err) {
        const isRateLimit =
          err instanceof HunterApiError && (err.status === 429 || err.status === 401);
        failed.push({
          candidateId: candidate.id,
          error: err instanceof Error ? err : new Error(String(err)),
          retryable: isRateLimit,
        });
        apiCallCount++; // Failed API calls still cost
      }
    }

    // Only charge for candidates that actually hit the Hunter API
    return { succeeded, failed, costIncurred: apiCallCount * this.costPerSearch };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const info = await this.client.getAccountInfo();
      const remaining = info.requests.searches.available - info.requests.searches.used;
      return remaining > 0;
    } catch {
      return false;
    }
  }

  estimateCost(config: SearchConfig): CostEstimate {
    const enrichCount = config.maxCandidates ?? 0;
    return {
      estimatedCost: enrichCount * this.costPerSearch,
      breakdown: { email_search: enrichCount * this.costPerSearch },
      searchCount: 0,
      enrichCount,
      currency: 'USD',
    };
  }

  // --- Private ---

  private extractName(candidate: Candidate): { firstName: string; lastName: string } {
    const name = candidate.name?.trim();
    if (!name) {
      return { firstName: '', lastName: '' };
    }
    const spaceIdx = name.indexOf(' ');
    if (spaceIdx === -1) {
      return { firstName: name, lastName: '' };
    }
    return {
      firstName: name.slice(0, spaceIdx),
      lastName: name.slice(spaceIdx + 1),
    };
  }

  private extractDomain(candidate: Candidate): string | undefined {
    // Strategy 1: Check sources for rawProfile.company
    for (const sourceData of Object.values(candidate.sources)) {
      const company = sourceData.rawProfile?.company;
      if (typeof company === 'string' && company.includes('.')) {
        // Looks like a domain already
        return company.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      }
    }

    // Strategy 2: Check enrichments for rawProfile.company
    for (const enrichment of Object.values(candidate.enrichments)) {
      const company = enrichment.sourceData.rawProfile?.company;
      if (typeof company === 'string' && company.includes('.')) {
        return company.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      }
    }

    // Strategy 3: Check observed identifiers for linkedin_url and try to extract domain
    const linkedinId = candidate.identity.observedIdentifiers.find(
      (id) => id.type === 'linkedin_url',
    );
    if (linkedinId) {
      // LinkedIn URLs contain company info in some cases, but we can't reliably
      // extract a domain from a personal LinkedIn URL. Skip this.
    }

    return undefined;
  }

  private emptyResult(candidateId: string, now: string): EnrichmentResult {
    return {
      adapter: 'hunter',
      candidateId,
      evidence: [],
      piiFields: [],
      sourceData: { adapter: 'hunter', retrievedAt: now, urls: [] },
      enrichedAt: now,
    };
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
}
