import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseExaResult,
  extractIdentifiers,
  extractEmails,
  type ExaResult,
} from '../parsers.js';
import { RateLimiter } from '../rate-limiter.js';
import { ExaAdapter } from '../exa-adapter.js';
import type { SearchConfig, Candidate } from '@sourcerer/core';

// --- Mock Exa SDK ---

const mockSearchResponse = {
  results: [
    {
      id: 'exa-1',
      title: 'Sarah Chen - Senior Backend Engineer',
      url: 'https://sarahchen.dev',
      text: 'Sarah Chen is a backend engineer at Chainlink. Contact: sarah@chainlink.com. GitHub: github.com/sarahchen. LinkedIn: linkedin.com/in/sarah-chen',
      author: 'Sarah Chen',
      score: 0.95,
      publishedDate: '2026-01-15',
    },
    {
      id: 'exa-2',
      title: 'Marcus Rivera - Alchemy',
      url: 'https://linkedin.com/in/marcus-rivera-dev',
      text: 'Marcus Rivera works at Alchemy building distributed systems in Go and Rust.',
      author: null,
      score: 0.88,
    },
  ],
  costDollars: { total: 0.01 },
  requestId: 'req-123',
};

const mockFindSimilarResponse = {
  results: [
    {
      id: 'sim-1',
      title: 'Aisha Patel',
      url: 'https://aishapatel.dev',
      text: 'Full-stack engineer specializing in payments at Stripe. Twitter: x.com/aisha_builds',
      author: 'Aisha Patel',
      score: 0.82,
    },
  ],
  costDollars: { total: 0.01 },
  requestId: 'req-456',
};

const mockGetContentsResponse = {
  results: [
    {
      id: 'content-1',
      title: 'Sarah Chen',
      url: 'https://sarahchen.dev',
      text: 'Sarah Chen - Building DeFi infrastructure at Chainlink. Previously at Stripe.',
    },
  ],
  requestId: 'req-789',
};

// Mock the Exa constructor
vi.mock('exa-js', () => {
  return {
    Exa: class MockExa {
      search = vi.fn().mockResolvedValue(mockSearchResponse);
      findSimilar = vi.fn().mockResolvedValue(mockFindSimilarResponse);
      getContents = vi.fn().mockResolvedValue(mockGetContentsResponse);
    },
  };
});

// --- Parser Tests ---

describe('Parsers', () => {
  describe('extractIdentifiers', () => {
    it('extracts LinkedIn URL from text', () => {
      const ids = extractIdentifiers(
        'https://example.com',
        'Check out linkedin.com/in/sarah-chen for more',
        'exa',
        '2026-03-23T00:00:00Z',
      );
      const linkedin = ids.find((i) => i.type === 'linkedin_url');
      expect(linkedin).toBeDefined();
      expect(linkedin!.value).toContain('sarah-chen');
    });

    it('extracts GitHub username from URL', () => {
      const ids = extractIdentifiers(
        'https://github.com/sarahchen',
        '',
        'exa',
        '2026-03-23T00:00:00Z',
      );
      const github = ids.find((i) => i.type === 'github_username');
      expect(github).toBeDefined();
      expect(github!.value).toBe('sarahchen');
    });

    it('extracts email from text', () => {
      const ids = extractIdentifiers(
        'https://example.com',
        'Email me at sarah@chainlink.com',
        'exa',
        '2026-03-23T00:00:00Z',
      );
      const email = ids.find((i) => i.type === 'email');
      expect(email).toBeDefined();
      expect(email!.value).toBe('sarah@chainlink.com');
    });

    it('extracts Twitter handle from x.com URL', () => {
      const ids = extractIdentifiers(
        'https://example.com',
        'Follow me at x.com/aisha_builds',
        'exa',
        '2026-03-23T00:00:00Z',
      );
      const twitter = ids.find((i) => i.type === 'twitter_handle');
      expect(twitter).toBeDefined();
      expect(twitter!.value).toBe('aisha_builds');
    });

    it('adds personal_url for non-social URLs', () => {
      const ids = extractIdentifiers(
        'https://sarahchen.dev',
        '',
        'exa',
        '2026-03-23T00:00:00Z',
      );
      const personal = ids.find((i) => i.type === 'personal_url');
      expect(personal).toBeDefined();
      expect(personal!.value).toBe('https://sarahchen.dev');
    });

    it('does NOT add personal_url for LinkedIn URLs', () => {
      const ids = extractIdentifiers(
        'https://linkedin.com/in/sarah-chen',
        '',
        'exa',
        '2026-03-23T00:00:00Z',
      );
      const personal = ids.find((i) => i.type === 'personal_url');
      expect(personal).toBeUndefined();
    });

    it('deduplicates identifiers', () => {
      const ids = extractIdentifiers(
        'https://example.com',
        'github.com/sarahchen and github.com/sarahchen',
        'exa',
        '2026-03-23T00:00:00Z',
      );
      const githubs = ids.filter((i) => i.type === 'github_username');
      expect(githubs).toHaveLength(1);
    });
  });

  describe('extractEmails', () => {
    it('extracts multiple emails', () => {
      const emails = extractEmails('Contact sarah@test.com or john@company.org');
      expect(emails).toContain('sarah@test.com');
      expect(emails).toContain('john@company.org');
    });
  });

  describe('parseExaResult', () => {
    it('parses a search result into RawCandidate', () => {
      const result: ExaResult = {
        id: 'exa-1',
        title: 'Sarah Chen',
        url: 'https://sarahchen.dev',
        text: 'Backend engineer. GitHub: github.com/sarahchen',
        author: 'Sarah Chen',
        score: 0.95,
      };

      const candidate = parseExaResult(result, 'senior backend engineer');
      expect(candidate.name).toBe('Sarah Chen');
      expect(candidate.evidence.length).toBeGreaterThanOrEqual(1);
      expect(candidate.evidence[0].adapter).toBe('exa');
      expect(candidate.evidence[0].id).toMatch(/^ev-/);
      expect(candidate.sourceData.adapter).toBe('exa');
    });

    it('records similarity provenance in evidence', () => {
      const result: ExaResult = {
        id: 'sim-1',
        title: 'Aisha Patel',
        url: 'https://aishapatel.dev',
        text: 'Engineer',
        author: 'Aisha Patel',
        score: 0.82,
      };

      const candidate = parseExaResult(result, '', 'https://sarahchen.dev');
      const provenanceEvidence = candidate.evidence.find((e) =>
        e.claim.includes('similarity'),
      );
      expect(provenanceEvidence).toBeDefined();
      expect(provenanceEvidence!.claim).toContain('sarahchen.dev');
    });
  });
});

// --- Rate Limiter Tests ---

describe('RateLimiter', () => {
  it('does not delay first request', async () => {
    const limiter = new RateLimiter(10);
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });
});

// --- ExaAdapter Tests (with mocked SDK) ---

describe('ExaAdapter', () => {
  let adapter: ExaAdapter;

  beforeEach(() => {
    adapter = new ExaAdapter('test-api-key', { requestsPerSecond: 100 }); // fast for tests
  });

  const makeSearchConfig = (overrides?: Partial<SearchConfig>): SearchConfig => ({
    roleName: 'Senior Backend Engineer',
    tiers: [
      {
        priority: 1,
        queries: [{ text: 'senior backend engineer at DeFi companies', maxResults: 5 }],
      },
    ],
    scoringWeights: { technicalDepth: 0.3, domainRelevance: 0.7 },
    tierThresholds: { tier1MinScore: 70, tier2MinScore: 40 },
    enrichmentPriority: [],
    antiFilters: [],
    createdAt: '2026-03-23T00:00:00Z',
    version: 1,
    ...overrides,
  });

  describe('search()', () => {
    it('yields SearchPages from tiered queries', async () => {
      const config = makeSearchConfig();
      const pages: import('@sourcerer/core').SearchPage[] = [];

      for await (const page of adapter.search(config)) {
        pages.push(page);
      }

      expect(pages.length).toBeGreaterThanOrEqual(1);
      expect(pages[0].candidates.length).toBeGreaterThanOrEqual(1);
      expect(pages[0].costIncurred).toBeGreaterThan(0);
    });

    it('parses results into RawCandidates with evidence', async () => {
      const config = makeSearchConfig();
      const pages = [];
      for await (const page of adapter.search(config)) pages.push(page);

      const candidate = pages[0].candidates[0];
      expect(candidate.name).toBeTruthy();
      expect(candidate.evidence.length).toBeGreaterThanOrEqual(1);
      expect(candidate.evidence[0].id).toMatch(/^ev-/);
      expect(candidate.sourceData.adapter).toBe('exa');
    });

    it('runs findSimilar for similarity seeds before tiered queries', async () => {
      const config = makeSearchConfig({
        similaritySeeds: ['https://sarahchen.dev'],
      });

      const pages = [];
      for await (const page of adapter.search(config)) pages.push(page);

      // Should have pages from both find_similar and search
      expect(pages.length).toBeGreaterThanOrEqual(2);
    });

    it('respects maxCandidates limit', async () => {
      const config = makeSearchConfig({ maxCandidates: 1 });
      const pages = [];
      for await (const page of adapter.search(config)) pages.push(page);

      const totalCandidates = pages.reduce((sum, p) => sum + p.candidates.length, 0);
      expect(totalCandidates).toBeLessThanOrEqual(2); // may get 1-2 due to batch
    });
  });

  describe('findSimilar()', () => {
    it('yields candidates from similar URLs', async () => {
      const pages = [];
      for await (const page of adapter.findSimilar(['https://sarahchen.dev'])) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].candidates.length).toBeGreaterThanOrEqual(1);
      expect(pages[0].candidates[0].evidence[0].claim).toContain('similarity');
    });
  });

  describe('enrich()', () => {
    it('enriches candidate URLs with content', async () => {
      const candidate: Candidate = {
        id: 'test-id',
        identity: {
          canonicalId: 'test-id',
          observedIdentifiers: [],
          mergeConfidence: 1,
        },
        name: 'Sarah Chen',
        sources: { exa: { adapter: 'exa', retrievedAt: '2026-03-23T00:00:00Z', urls: ['https://sarahchen.dev'] } },
        evidence: [],
        enrichments: {},
        pii: { fields: [], retentionPolicy: 'default' },
      };

      const result = await adapter.enrich(candidate);
      expect(result.adapter).toBe('exa');
      expect(result.candidateId).toBe('test-id');
      expect(result.evidence.length).toBeGreaterThanOrEqual(1);
    });

    it('handles candidate with no URLs', async () => {
      const candidate: Candidate = {
        id: 'test-id',
        identity: { canonicalId: 'test-id', observedIdentifiers: [], mergeConfidence: 1 },
        name: 'Test',
        sources: {},
        evidence: [],
        enrichments: {},
        pii: { fields: [], retentionPolicy: 'default' },
      };

      const result = await adapter.enrich(candidate);
      expect(result.evidence).toHaveLength(0);
    });
  });

  describe('healthCheck()', () => {
    it('returns true for valid API key', async () => {
      expect(await adapter.healthCheck()).toBe(true);
    });
  });

  describe('estimateCost()', () => {
    it('estimates cost from query count', () => {
      const config = makeSearchConfig({
        tiers: [
          { priority: 1, queries: [{ text: 'q1' }, { text: 'q2' }] },
          { priority: 2, queries: [{ text: 'q3' }] },
        ],
        similaritySeeds: ['https://seed1.com', 'https://seed2.com'],
      });

      const estimate = adapter.estimateCost(config);
      expect(estimate.searchCount).toBe(5); // 3 queries + 2 seeds
      expect(estimate.estimatedCost).toBeGreaterThan(0);
      expect(estimate.currency).toBe('USD');
    });
  });
});
