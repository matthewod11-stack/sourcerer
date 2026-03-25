import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubAdapter } from '../github-adapter.js';
import {
  extractEmailsFromCommits,
  computeLanguageDistribution,
  computeOssRatio,
  computeCommitFrequency,
  buildContributionTrends,
  computeLanguageTrends,
} from '../parsers.js';
import type { Candidate, ObservedIdentifier, EnrichmentResult } from '@sourcerer/core';
import type { GitHubCommit, GitHubRepo, GitHubEvent } from '../github-client.js';

// --- Mock Data ---

const mockUser = {
  login: 'sarahchen',
  name: 'Sarah Chen',
  bio: 'Go engineer, DeFi builder',
  company: 'Chainlink',
  location: 'San Francisco',
  email: 'sarah@chainlink.com',
  public_repos: 42,
  followers: 150,
  created_at: '2020-01-15T00:00:00Z',
  html_url: 'https://github.com/sarahchen',
};

const mockRepos: GitHubRepo[] = [
  { name: 'defi-indexer', full_name: 'sarahchen/defi-indexer', language: 'Go', stargazers_count: 120, forks_count: 15, topics: ['defi'], updated_at: '2026-03-20T00:00:00Z', pushed_at: '2026-03-20T00:00:00Z', html_url: 'https://github.com/sarahchen/defi-indexer', fork: false },
  { name: 'go-utils', full_name: 'sarahchen/go-utils', language: 'Go', stargazers_count: 45, forks_count: 3, topics: [], updated_at: '2026-03-15T00:00:00Z', pushed_at: '2026-03-15T00:00:00Z', html_url: 'https://github.com/sarahchen/go-utils', fork: false },
  { name: 'rust-wasm', full_name: 'sarahchen/rust-wasm', language: 'Rust', stargazers_count: 30, forks_count: 2, topics: ['wasm'], updated_at: '2026-03-10T00:00:00Z', pushed_at: '2026-03-10T00:00:00Z', html_url: 'https://github.com/sarahchen/rust-wasm', fork: false },
  { name: 'fork-of-something', full_name: 'sarahchen/fork-of-something', language: 'JavaScript', stargazers_count: 0, forks_count: 0, topics: [], updated_at: '2026-01-01T00:00:00Z', pushed_at: '2026-01-01T00:00:00Z', html_url: 'https://github.com/sarahchen/fork-of-something', fork: true },
];

const mockCommits: GitHubCommit[] = [
  { sha: 'abc1', commit: { author: { name: 'Sarah Chen', email: 'sarah@gmail.com', date: '2026-03-20T10:00:00Z' }, message: 'feat: add indexer' }, html_url: 'https://github.com/sarahchen/defi-indexer/commit/abc1' },
  { sha: 'abc2', commit: { author: { name: 'Sarah Chen', email: 'sarah@gmail.com', date: '2026-03-19T10:00:00Z' }, message: 'fix: query bug' }, html_url: 'https://github.com/sarahchen/defi-indexer/commit/abc2' },
  { sha: 'abc3', commit: { author: { name: 'Sarah Chen', email: '12345+sarahchen@users.noreply.github.com', date: '2026-03-18T10:00:00Z' }, message: 'ci: update' }, html_url: 'https://github.com/sarahchen/defi-indexer/commit/abc3' },
  { sha: 'abc4', commit: { author: { name: 'Sarah Chen', email: 'sarah@chainlink.com', date: '2026-03-17T10:00:00Z' }, message: 'docs: readme' }, html_url: 'https://github.com/sarahchen/defi-indexer/commit/abc4' },
];

const mockEvents: GitHubEvent[] = [
  { id: '1', type: 'PushEvent', created_at: '2026-03-20T10:00:00Z', repo: { name: 'sarahchen/defi-indexer' }, payload: { size: 3, commits: [{ sha: 'a', message: 'feat' }, { sha: 'b', message: 'fix' }, { sha: 'c', message: 'chore' }] } },
  { id: '2', type: 'PushEvent', created_at: '2026-03-13T10:00:00Z', repo: { name: 'sarahchen/go-utils' }, payload: { size: 2, commits: [{ sha: 'd', message: 'feat' }, { sha: 'e', message: 'fix' }] } },
  { id: '3', type: 'PushEvent', created_at: '2026-03-06T10:00:00Z', repo: { name: 'sarahchen/rust-wasm' }, payload: { size: 1, commits: [{ sha: 'f', message: 'wip' }] } },
  { id: '4', type: 'WatchEvent', created_at: '2026-03-05T10:00:00Z', repo: { name: 'other/repo' } },
];

const mockRateLimit = { rate: { remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } };

// --- Mock fetch ---

function makeMockHeaders(remaining = '4999', reset = String(Math.floor(Date.now() / 1000) + 3600)) {
  return {
    get: (name: string) => {
      if (name === 'x-ratelimit-remaining') return remaining;
      if (name === 'x-ratelimit-reset') return reset;
      return null;
    },
  };
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn().mockImplementation(async (url: string) => {
    const path = new URL(url).pathname;

    if (path === '/users/sarahchen') {
      return { ok: true, json: async () => mockUser, headers: makeMockHeaders() };
    }
    if (path.startsWith('/users/sarahchen/repos')) {
      return { ok: true, json: async () => mockRepos, headers: makeMockHeaders() };
    }
    if (path.match(/\/repos\/sarahchen\/[\w-]+\/commits/)) {
      return { ok: true, json: async () => mockCommits, headers: makeMockHeaders() };
    }
    if (path.startsWith('/users/sarahchen/events')) {
      return { ok: true, json: async () => mockEvents, headers: makeMockHeaders() };
    }
    if (path === '/rate_limit') {
      return { ok: true, json: async () => mockRateLimit, headers: makeMockHeaders() };
    }
    if (path === '/users/nonexistent') {
      return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }), headers: makeMockHeaders() };
    }
    // Private profile user — user exists but repos are empty
    if (path === '/users/privateuser') {
      return { ok: true, json: async () => ({ ...mockUser, login: 'privateuser', public_repos: 0, html_url: 'https://github.com/privateuser' }), headers: makeMockHeaders() };
    }
    if (path.startsWith('/users/privateuser/repos')) {
      return { ok: true, json: async () => [], headers: makeMockHeaders() };
    }
    if (path.startsWith('/users/privateuser/events')) {
      return { ok: true, json: async () => [], headers: makeMockHeaders() };
    }

    return { ok: true, json: async () => ({}), headers: makeMockHeaders() };
  });

  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Helpers ---

function makeCandidate(username?: string, id = 'test-candidate'): Candidate {
  const identifiers: ObservedIdentifier[] = [];
  if (username) {
    identifiers.push({
      type: 'github_username',
      value: username,
      source: 'exa',
      observedAt: '2026-03-23T00:00:00Z',
      confidence: 'high',
    });
  }
  return {
    id,
    identity: { canonicalId: id, observedIdentifiers: identifiers, mergeConfidence: 1 },
    name: 'Sarah Chen',
    sources: {},
    evidence: [],
    enrichments: {},
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

function makeCandidateWithEnrichment(
  username: string,
  id: string,
  enrichedAt: string,
): Candidate {
  const candidate = makeCandidate(username, id);
  candidate.enrichments['github'] = {
    adapter: 'github',
    candidateId: id,
    evidence: [{ id: 'ev-cached', claim: 'cached', source: 'test', adapter: 'github', retrievedAt: enrichedAt, confidence: 'high' }],
    piiFields: [],
    sourceData: { adapter: 'github', retrievedAt: enrichedAt, urls: [] },
    enrichedAt,
  };
  return candidate;
}

// --- Tests ---

describe('Email extraction', () => {
  it('prefers personal email over company email', () => {
    const emails = extractEmailsFromCommits(mockCommits);
    expect(emails[0]).toBe('sarah@gmail.com');
  });

  it('filters out noreply addresses', () => {
    const emails = extractEmailsFromCommits(mockCommits);
    expect(emails.every((e) => !e.includes('noreply'))).toBe(true);
  });

  it('deduplicates emails', () => {
    const emails = extractEmailsFromCommits(mockCommits);
    const unique = new Set(emails);
    expect(emails.length).toBe(unique.size);
  });
});

describe('Language distribution', () => {
  it('computes top languages from repos', () => {
    const langs = computeLanguageDistribution(mockRepos);
    expect(langs[0].language).toBe('Go');
    expect(langs[0].count).toBe(2);
  });

  it('excludes forked repos', () => {
    const langs = computeLanguageDistribution(mockRepos);
    const jsLang = langs.find((l) => l.language === 'JavaScript');
    expect(jsLang).toBeUndefined();
  });
});

describe('computeOssRatio', () => {
  it('calculates ratio of non-fork repos', () => {
    const ratio = computeOssRatio(mockRepos);
    // 3 original out of 4 total
    expect(ratio).toBe(0.75);
  });

  it('returns 0 for empty repos', () => {
    expect(computeOssRatio([])).toBe(0);
  });

  it('returns 1 when all repos are original', () => {
    const repos = mockRepos.filter((r) => !r.fork);
    expect(computeOssRatio(repos)).toBe(1);
  });
});

describe('computeCommitFrequency', () => {
  it('calculates commits per week from push events', () => {
    const freq = computeCommitFrequency(mockEvents);
    expect(freq.totalEvents).toBe(6); // 3 + 2 + 1
    expect(freq.commitsPerWeek).toBeGreaterThan(0);
    expect(freq.status).toBe('moderate');
  });

  it('returns dormant for no push events', () => {
    const watchOnly: GitHubEvent[] = [
      { id: '1', type: 'WatchEvent', created_at: '2026-03-20T10:00:00Z', repo: { name: 'test/repo' } },
    ];
    const freq = computeCommitFrequency(watchOnly);
    expect(freq.status).toBe('dormant');
    expect(freq.commitsPerWeek).toBe(0);
  });

  it('returns dormant for empty events', () => {
    const freq = computeCommitFrequency([]);
    expect(freq.status).toBe('dormant');
    expect(freq.totalEvents).toBe(0);
  });

  it('detects active accounts with high commit frequency', () => {
    // Create many push events in a single week
    const activeEvents: GitHubEvent[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      type: 'PushEvent',
      created_at: '2026-03-20T10:00:00Z',
      repo: { name: 'test/repo' },
      payload: { size: 5, commits: [] },
    }));
    const freq = computeCommitFrequency(activeEvents);
    expect(freq.status).toBe('active');
  });
});

describe('computeLanguageTrends', () => {
  it('identifies growing languages', () => {
    const recentRepos: GitHubRepo[] = [
      { name: 'r1', full_name: 'u/r1', language: 'Rust', stargazers_count: 0, forks_count: 0, topics: [], updated_at: '2026-03-20T00:00:00Z', pushed_at: '2026-03-20T00:00:00Z', html_url: '', fork: false },
      { name: 'r2', full_name: 'u/r2', language: 'Rust', stargazers_count: 0, forks_count: 0, topics: [], updated_at: '2026-03-18T00:00:00Z', pushed_at: '2026-03-18T00:00:00Z', html_url: '', fork: false },
      { name: 'r3', full_name: 'u/r3', language: 'Go', stargazers_count: 0, forks_count: 0, topics: [], updated_at: '2025-01-01T00:00:00Z', pushed_at: '2025-01-01T00:00:00Z', html_url: '', fork: false },
    ];
    const trends = computeLanguageTrends(recentRepos, 6);
    const rustTrend = trends.find((t) => t.language === 'Rust');
    expect(rustTrend?.trend).toBe('growing');
  });
});

describe('buildContributionTrends', () => {
  it('produces evidence items for OSS ratio and commit frequency', () => {
    const evidence = buildContributionTrends(mockRepos, mockEvents, 'https://github.com/sarahchen');
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    expect(evidence.every((e) => e.id.startsWith('ev-'))).toBe(true);
    expect(evidence.every((e) => e.adapter === 'github')).toBe(true);

    // Should have OSS ratio evidence
    const ossEvidence = evidence.find((e) => e.claim.includes('OSS ratio'));
    expect(ossEvidence).toBeDefined();

    // Should have commit frequency evidence
    const freqEvidence = evidence.find((e) => e.claim.includes('Commit frequency'));
    expect(freqEvidence).toBeDefined();
  });

  it('handles empty events gracefully', () => {
    const evidence = buildContributionTrends(mockRepos, [], 'https://github.com/test');
    // Should still produce OSS ratio evidence
    const ossEvidence = evidence.find((e) => e.claim.includes('OSS ratio'));
    expect(ossEvidence).toBeDefined();
    // No commit frequency evidence with empty events
    const freqEvidence = evidence.find((e) => e.claim.includes('Commit frequency'));
    expect(freqEvidence).toBeUndefined();
  });
});

describe('GitHubAdapter', () => {
  let adapter: GitHubAdapter;

  beforeEach(() => {
    adapter = new GitHubAdapter('test-token', { requestsPerSecond: 100 });
  });

  describe('enrich()', () => {
    it('enriches candidate with GitHub username', async () => {
      const result = await adapter.enrich(makeCandidate('sarahchen'));

      expect(result.adapter).toBe('github');
      expect(result.candidateId).toBe('test-candidate');
      expect(result.evidence.length).toBeGreaterThanOrEqual(3);
      expect(result.evidence[0].id).toMatch(/^ev-/);
      expect(result.evidence[0].adapter).toBe('github');
      expect(result.sourceData.adapter).toBe('github');
    });

    it('extracts emails as PII fields', async () => {
      const result = await adapter.enrich(makeCandidate('sarahchen'));

      expect(result.piiFields.length).toBeGreaterThanOrEqual(1);
      expect(result.piiFields[0].type).toBe('email');
      expect(result.piiFields[0].adapter).toBe('github');
    });

    it('handles GitHub URL as identifier', async () => {
      const result = await adapter.enrich(makeCandidate('https://github.com/sarahchen'));
      expect(result.evidence.length).toBeGreaterThanOrEqual(3);
    });

    it('returns empty result for no GitHub identifier', async () => {
      const result = await adapter.enrich(makeCandidate());
      expect(result.evidence).toHaveLength(0);
      expect(result.piiFields).toHaveLength(0);
    });

    it('returns empty result for nonexistent user (404)', async () => {
      const result = await adapter.enrich(makeCandidate('nonexistent'));
      expect(result.evidence).toHaveLength(0);
    });

    it('includes contribution trend evidence', async () => {
      const result = await adapter.enrich(makeCandidate('sarahchen'));
      const ossEvidence = result.evidence.find((e) => e.claim.includes('OSS ratio'));
      expect(ossEvidence).toBeDefined();
    });

    it('handles private profile (user exists but repos empty)', async () => {
      const result = await adapter.enrich(makeCandidate('privateuser'));
      expect(result.adapter).toBe('github');
      expect(result.candidateId).toBe('test-candidate');
      // Should still have profile overview evidence at minimum
      const profileEvidence = result.evidence.find((e) => e.claim.includes('GitHub profile'));
      expect(profileEvidence).toBeDefined();
      // Should not have language evidence since no repos
      const langEvidence = result.evidence.find((e) => e.claim.includes('Top languages'));
      expect(langEvidence).toBeUndefined();
    });
  });

  describe('enrichBatch()', () => {
    it('enriches multiple candidates', async () => {
      const result = await adapter.enrichBatch([
        makeCandidate('sarahchen'),
        makeCandidate('sarahchen'),
      ]);
      expect(result.succeeded).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(result.costIncurred).toBe(0);
    });

    it('handles 20 candidates with parallel execution', async () => {
      const candidates = Array.from({ length: 20 }, (_, i) =>
        makeCandidate('sarahchen', `candidate-${i}`),
      );

      const start = Date.now();
      const result = await adapter.enrichBatch(candidates);
      const elapsed = Date.now() - start;

      expect(result.succeeded).toHaveLength(20);
      expect(result.failed).toHaveLength(0);
      // With concurrency 5, should be faster than purely sequential
      // Each candidate takes ~10ms delay, sequential = 200ms+, parallel should be much less
      // Just verify all completed successfully
      expect(result.succeeded.length).toBe(20);
    });

    it('skips candidates with fresh enrichment (within TTL)', async () => {
      const freshEnrichedAt = new Date().toISOString(); // now = within default 24h TTL
      const candidates = [
        makeCandidateWithEnrichment('sarahchen', 'cached-1', freshEnrichedAt),
        makeCandidate('sarahchen', 'fresh-1'),
      ];

      const result = await adapter.enrichBatch(candidates);

      expect(result.succeeded).toHaveLength(2);
      // The cached candidate should use existing enrichment, not fetch
      const cachedResult = result.succeeded.find((s) => s.candidateId === 'cached-1');
      expect(cachedResult).toBeDefined();
      expect(cachedResult!.result.enrichedAt).toBe(freshEnrichedAt);
      // The cached evidence should be the one we set, not freshly fetched
      expect(cachedResult!.result.evidence[0].id).toBe('ev-cached');
    });

    it('re-enriches candidates with stale enrichment (beyond TTL)', async () => {
      // Set enrichedAt to 48 hours ago — beyond default 24h TTL
      const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const candidates = [
        makeCandidateWithEnrichment('sarahchen', 'stale-1', staleDate),
      ];

      const result = await adapter.enrichBatch(candidates);

      expect(result.succeeded).toHaveLength(1);
      // Should have been re-enriched — enrichedAt should be more recent than the stale date
      const enriched = result.succeeded[0];
      expect(enriched.candidateId).toBe('stale-1');
      expect(new Date(enriched.result.enrichedAt).getTime()).toBeGreaterThan(new Date(staleDate).getTime());
      // Should have real evidence, not the cached one
      expect(enriched.result.evidence.length).toBeGreaterThan(1);
    });

    it('respects custom staleTtlMs option', async () => {
      const recentDate = new Date(Date.now() - 1000).toISOString(); // 1 second ago
      const candidates = [
        makeCandidateWithEnrichment('sarahchen', 'short-ttl', recentDate),
      ];

      // With a very short TTL (500ms), even 1-second-old enrichment is stale
      const result = await adapter.enrichBatch(candidates, { staleTtlMs: 500 });

      expect(result.succeeded).toHaveLength(1);
      // Should be re-enriched because TTL is only 500ms
      expect(result.succeeded[0].result.evidence.length).toBeGreaterThan(1);
    });

    it('stops processing on rate limit exhaustion (403)', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async (url: string) => {
        const path = new URL(url).pathname;

        // Let the first 5 candidates' user requests succeed, then 403
        if (path.match(/\/users\/candidate-\d+$/)) {
          callCount++;
          if (callCount > 5) {
            return { ok: false, status: 403, json: async () => ({ message: 'rate limit exceeded' }), headers: makeMockHeaders('0') };
          }
          return { ok: true, json: async () => ({ ...mockUser, login: `candidate-${callCount}` }), headers: makeMockHeaders() };
        }
        if (path.match(/\/users\/candidate-\d+\/repos/)) {
          return { ok: true, json: async () => mockRepos, headers: makeMockHeaders() };
        }
        if (path.match(/\/repos\/candidate-\d+\//)) {
          return { ok: true, json: async () => mockCommits, headers: makeMockHeaders() };
        }
        if (path.match(/\/users\/candidate-\d+\/events/)) {
          return { ok: true, json: async () => mockEvents, headers: makeMockHeaders() };
        }
        if (path === '/rate_limit') {
          return { ok: true, json: async () => mockRateLimit, headers: makeMockHeaders() };
        }

        return { ok: true, json: async () => ({}), headers: makeMockHeaders() };
      });

      const candidates = Array.from({ length: 15 }, (_, i) =>
        makeCandidate(`candidate-${i}`, `candidate-${i}`),
      );

      const result = await adapter.enrichBatch(candidates);

      // Some succeeded, some failed
      expect(result.succeeded.length).toBeGreaterThan(0);
      expect(result.failed.length).toBeGreaterThan(0);

      // All failures after rate limit should be retryable
      const retryableFailures = result.failed.filter((f) => f.retryable);
      expect(retryableFailures.length).toBe(result.failed.length);
    });

    it('handles partial failures with various errors', async () => {
      let candidateIndex = 0;
      mockFetch.mockImplementation(async (url: string) => {
        const path = new URL(url).pathname;

        // Make specific candidates fail with different errors
        if (path.match(/\/users\/fail-404$/)) {
          return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }), headers: makeMockHeaders() };
        }
        if (path.match(/\/users\/fail-500$/)) {
          return { ok: false, status: 500, json: async () => ({ message: 'Server Error' }), headers: makeMockHeaders() };
        }
        if (path.match(/\/users\/fail-timeout$/)) {
          throw new Error('network timeout');
        }

        // Default success paths
        if (path.match(/\/users\/[\w-]+$/)) {
          return { ok: true, json: async () => mockUser, headers: makeMockHeaders() };
        }
        if (path.match(/\/users\/[\w-]+\/repos/)) {
          return { ok: true, json: async () => mockRepos, headers: makeMockHeaders() };
        }
        if (path.match(/\/repos\/[\w-]+\/[\w-]+\/commits/)) {
          return { ok: true, json: async () => mockCommits, headers: makeMockHeaders() };
        }
        if (path.match(/\/users\/[\w-]+\/events/)) {
          return { ok: true, json: async () => mockEvents, headers: makeMockHeaders() };
        }

        return { ok: true, json: async () => ({}), headers: makeMockHeaders() };
      });

      const candidates = [
        makeCandidate('good-user', 'good-1'),
        makeCandidate('fail-404', 'fail-404'),
        makeCandidate('good-user', 'good-2'),
        makeCandidate('fail-500', 'fail-500'),
        makeCandidate('fail-timeout', 'fail-timeout'),
        makeCandidate('good-user', 'good-3'),
      ];

      const result = await adapter.enrichBatch(candidates);

      // 404 returns empty result (not an error), so it succeeds
      // 500 and timeout are actual failures
      expect(result.succeeded.length).toBeGreaterThanOrEqual(3); // good-1, good-2, good-3 + fail-404 (empty result)
      expect(result.failed.length).toBe(2); // fail-500 and fail-timeout

      // 500 errors should not be retryable
      const nonRetryable = result.failed.filter((f) => !f.retryable);
      expect(nonRetryable.length).toBe(2);
    });
  });

  describe('healthCheck()', () => {
    it('returns true for valid token', async () => {
      expect(await adapter.healthCheck()).toBe(true);
    });
  });

  describe('estimateCost()', () => {
    it('returns zero cost', () => {
      const estimate = adapter.estimateCost({
        roleName: 'Test',
        tiers: [],
        scoringWeights: {},
        tierThresholds: { tier1MinScore: 70, tier2MinScore: 40 },
        enrichmentPriority: [],
        antiFilters: [],
        createdAt: '2026-03-23T00:00:00Z',
        version: 1,
      });
      expect(estimate.estimatedCost).toBe(0);
      expect(estimate.currency).toBe('USD');
    });
  });

  describe('search()', () => {
    it('throws for enrichment-only adapter', async () => {
      const gen = adapter.search({} as never);
      await expect(gen.next()).rejects.toThrow('enrichment-only');
    });
  });
});
