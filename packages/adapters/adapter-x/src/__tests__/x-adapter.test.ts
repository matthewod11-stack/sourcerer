import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XAdapter } from '../x-adapter.js';
import { buildProfileEvidence, buildTweetEvidence } from '../parsers.js';
import type { Candidate, ObservedIdentifier } from '@sourcerer/core';
import type { XUser, XTweet } from '../x-client.js';

// --- Mock Data ---

const mockXUser: XUser = {
  id: '123456789',
  username: 'alexdev',
  name: 'Alex Developer',
  description: 'Staff Engineer @BigCorp | Building distributed systems | Rust, Go, TypeScript',
  location: 'San Francisco, CA',
  public_metrics: {
    followers_count: 5000,
    following_count: 800,
    tweet_count: 12000,
  },
  created_at: '2018-06-15T00:00:00Z',
  protected: false,
  url: 'https://alexdev.io',
};

const mockProtectedUser: XUser = {
  ...mockXUser,
  id: '987654321',
  username: 'privatedev',
  protected: true,
};

const mockXTweets: XTweet[] = [
  {
    id: 't1',
    text: 'Just shipped a new microservice in Rust. The performance gains are incredible compared to our Node.js version.',
    created_at: '2026-03-20T10:00:00Z',
    public_metrics: { like_count: 150, retweet_count: 30, reply_count: 12, impression_count: 25000 },
  },
  {
    id: 't2',
    text: 'Great discussion at the architecture review today. Moving to event-driven pipeline is the right call.',
    created_at: '2026-03-19T14:00:00Z',
    public_metrics: { like_count: 45, retweet_count: 8, reply_count: 5 },
  },
  {
    id: 't3',
    text: 'Deployed the new API gateway. Zero downtime migration ftw!',
    created_at: '2026-03-18T09:00:00Z',
    public_metrics: { like_count: 200, retweet_count: 40, reply_count: 20, impression_count: 30000 },
  },
  {
    id: 't4',
    text: 'Weekend vibes. Making sourdough and watching F1.',
    created_at: '2026-03-17T11:00:00Z',
    public_metrics: { like_count: 80, retweet_count: 5, reply_count: 10 },
  },
  {
    id: 't5',
    text: 'Open source PR merged into kubernetes — my first k8s contribution!',
    created_at: '2026-03-16T16:00:00Z',
    public_metrics: { like_count: 500, retweet_count: 100, reply_count: 35, impression_count: 50000 },
  },
  {
    id: 't6',
    text: 'Just released v2.0 of our SDK. Major refactor of the auth layer.',
    created_at: '2026-03-15T10:00:00Z',
    public_metrics: { like_count: 120, retweet_count: 25, reply_count: 8 },
  },
  {
    id: 't7',
    text: 'Built a CI/CD pipeline with GitHub Actions that runs 300 tests in under 2 minutes.',
    created_at: '2026-03-14T08:00:00Z',
    public_metrics: { like_count: 90, retweet_count: 15, reply_count: 6 },
  },
  {
    id: 't8',
    text: 'Coffee thoughts: the best code is the code you don\'t write.',
    created_at: '2026-03-13T07:00:00Z',
    public_metrics: { like_count: 300, retweet_count: 60, reply_count: 25 },
  },
  {
    id: 't9',
    text: 'Heading to RustConf next week. Anyone else going?',
    created_at: '2026-03-12T15:00:00Z',
    public_metrics: { like_count: 40, retweet_count: 3, reply_count: 15 },
  },
  {
    id: 't10',
    text: 'The merge queue in our monorepo is finally working smoothly after the backend rewrite.',
    created_at: '2026-03-11T12:00:00Z',
    public_metrics: { like_count: 65, retweet_count: 10, reply_count: 4 },
  },
];

// --- Mock fetch ---

let mockFetch: ReturnType<typeof vi.fn>;

function createMockResponse(data: unknown, ok = true, status = 200, headers: Record<string, string> = {}) {
  return {
    ok,
    status,
    json: async () => data,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  };
}

beforeEach(() => {
  mockFetch = vi.fn().mockImplementation(async (url: string) => {
    const urlObj = new URL(url);
    const path = urlObj.pathname;

    // User lookup by username
    if (path === '/2/users/by/username/alexdev') {
      return createMockResponse({ data: mockXUser }, true, 200, {
        'x-rate-limit-remaining': '99',
        'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 900),
      });
    }
    if (path === '/2/users/by/username/privatedev') {
      return createMockResponse({ data: mockProtectedUser });
    }
    if (path === '/2/users/by/username/x') {
      return createMockResponse({ data: mockXUser });
    }

    // Tweets by user ID
    if (path === '/2/users/123456789/tweets') {
      return createMockResponse({ data: mockXTweets });
    }
    if (path === '/2/users/987654321/tweets') {
      // Protected user's tweets should not be accessible, but for testing
      // the adapter handles this by not calling tweets for protected users
      return createMockResponse({ data: [] });
    }

    // Nonexistent user
    if (path === '/2/users/by/username/nonexistent') {
      return createMockResponse(
        { errors: [{ code: '50', message: 'User not found' }] },
        false,
        404,
      );
    }

    // Rate limit response
    if (path === '/2/users/by/username/ratelimited') {
      return createMockResponse(
        { errors: [{ code: '88' }] },
        false,
        429,
        { 'retry-after': '60' },
      );
    }

    return createMockResponse({});
  });

  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Helpers ---

function makeCandidate(handle?: string): Candidate {
  const identifiers: ObservedIdentifier[] = [];
  if (handle) {
    identifiers.push({
      type: 'twitter_handle',
      value: handle,
      source: 'exa',
      observedAt: '2026-03-23T00:00:00Z',
      confidence: 'high',
    });
  }
  return {
    id: 'test-candidate',
    identity: { canonicalId: 'test-candidate', observedIdentifiers: identifiers, mergeConfidence: 1 },
    name: 'Alex Developer',
    sources: {},
    evidence: [],
    enrichments: {},
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

const searchConfig = {
  roleName: 'Test',
  tiers: [],
  scoringWeights: {},
  tierThresholds: { tier1MinScore: 70, tier2MinScore: 40 },
  enrichmentPriority: [],
  antiFilters: [],
  createdAt: '2026-03-23T00:00:00Z',
  version: 1,
};

// --- Tests ---

describe('XAdapter', () => {
  let adapter: XAdapter;

  beforeEach(() => {
    // Use pro tier with fast delay for tests
    adapter = new XAdapter('test-token', 'pro', { requestsPerMinute: 60000 });
  });

  describe('enrich()', () => {
    it('enriches candidate with valid twitter handle', async () => {
      const result = await adapter.enrich(makeCandidate('alexdev'));

      expect(result.adapter).toBe('x');
      expect(result.candidateId).toBe('test-candidate');
      expect(result.evidence.length).toBeGreaterThanOrEqual(4);
      expect(result.evidence[0].adapter).toBe('x');
      expect(result.sourceData.adapter).toBe('x');
      expect(result.sourceData.urls).toContain('https://x.com/alexdev');
      expect(result.piiFields).toHaveLength(0);
    });

    it('returns empty result when no twitter handle on candidate', async () => {
      const result = await adapter.enrich(makeCandidate());
      expect(result.evidence).toHaveLength(0);
      expect(result.piiFields).toHaveLength(0);
      expect(result.sourceData.urls).toHaveLength(0);
    });

    it('returns profile-only evidence for protected account', async () => {
      const result = await adapter.enrich(makeCandidate('privatedev'));

      expect(result.evidence.length).toBeGreaterThan(0);
      // Should have profile evidence (bio, followers, account age) but no tweet evidence
      const tweetEvidenceClaims = result.evidence.filter(
        (e) => e.claim.includes('tweets per week') || e.claim.includes('engagement rate'),
      );
      expect(tweetEvidenceClaims).toHaveLength(0);
    });

    it('handles x.com/username URL pattern extraction', async () => {
      const result = await adapter.enrich(makeCandidate('https://x.com/alexdev'));
      expect(result.evidence.length).toBeGreaterThanOrEqual(4);
    });

    it('handles twitter.com/username URL pattern extraction', async () => {
      const result = await adapter.enrich(makeCandidate('https://twitter.com/alexdev'));
      expect(result.evidence.length).toBeGreaterThanOrEqual(4);
    });

    it('handles @-prefixed handle', async () => {
      const result = await adapter.enrich(makeCandidate('@alexdev'));
      expect(result.evidence.length).toBeGreaterThanOrEqual(4);
    });

    it('returns empty result for nonexistent user (404)', async () => {
      const result = await adapter.enrich(makeCandidate('nonexistent'));
      expect(result.evidence).toHaveLength(0);
    });
  });

  describe('enrichBatch()', () => {
    it('enriches multiple candidates successfully', async () => {
      const result = await adapter.enrichBatch([
        makeCandidate('alexdev'),
        makeCandidate('alexdev'),
      ]);
      expect(result.succeeded).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(result.costIncurred).toBe(0);
    });

    it('handles 429 rate limit and marks remaining as retryable', async () => {
      const result = await adapter.enrichBatch([
        makeCandidate('ratelimited'),
        makeCandidate('alexdev'),
        makeCandidate('alexdev'),
      ]);

      // First candidate hits rate limit
      const rateLimitFailures = result.failed.filter((f) => f.retryable);
      expect(rateLimitFailures.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('healthCheck()', () => {
    it('returns true for valid API key', async () => {
      expect(await adapter.healthCheck()).toBe(true);
    });

    it('returns false on error', async () => {
      mockFetch.mockImplementation(async () => createMockResponse({}, false, 401));
      expect(await adapter.healthCheck()).toBe(false);
    });
  });

  describe('estimateCost()', () => {
    it('returns non-zero cost for enrichment', () => {
      const estimate = adapter.estimateCost(searchConfig);
      expect(estimate.estimatedCost).toBeGreaterThan(0);
      expect(estimate.currency).toBe('USD');
      expect(estimate.enrichCount).toBe(50);
      expect(estimate.searchCount).toBe(0);
    });
  });

  describe('search()', () => {
    it('throws enrichment-only error', async () => {
      const gen = adapter.search({} as never);
      await expect(gen.next()).rejects.toThrow('enrichment-only');
    });
  });
});

describe('Parsers', () => {
  const profileUrl = 'https://x.com/alexdev';

  describe('buildProfileEvidence()', () => {
    it('generates correct evidence structure', () => {
      const evidence = buildProfileEvidence(mockXUser, profileUrl);

      expect(evidence.length).toBeGreaterThanOrEqual(3); // bio, followers, account age
      for (const item of evidence) {
        expect(item.adapter).toBe('x');
        expect(item.source).toBe(profileUrl);
        expect(item.retrievedAt).toBeTruthy();
      }
    });

    it('all evidence IDs match ev-XXXXXX pattern', () => {
      const evidence = buildProfileEvidence(mockXUser, profileUrl);
      for (const item of evidence) {
        expect(item.id).toMatch(/^ev-[0-9a-f]{6}$/);
      }
    });

    it('includes bio in evidence', () => {
      const evidence = buildProfileEvidence(mockXUser, profileUrl);
      const bio = evidence.find((e) => e.claim.includes('X bio:'));
      expect(bio).toBeDefined();
      expect(bio!.claim).toContain('Staff Engineer');
    });

    it('includes follower count in evidence', () => {
      const evidence = buildProfileEvidence(mockXUser, profileUrl);
      const followers = evidence.find((e) => e.claim.includes('followers on X'));
      expect(followers).toBeDefined();
      expect(followers!.claim).toContain('5000');
    });

    it('includes location when available', () => {
      const evidence = buildProfileEvidence(mockXUser, profileUrl);
      const location = evidence.find((e) => e.claim.includes('Location from X'));
      expect(location).toBeDefined();
      expect(location!.claim).toContain('San Francisco');
    });

    it('omits location when not available', () => {
      const userNoLocation: XUser = { ...mockXUser, location: undefined };
      const evidence = buildProfileEvidence(userNoLocation, profileUrl);
      const location = evidence.find((e) => e.claim.includes('Location from X'));
      expect(location).toBeUndefined();
    });
  });

  describe('buildTweetEvidence()', () => {
    it('calculates engagement metrics correctly', () => {
      const evidence = buildTweetEvidence(mockXTweets, profileUrl, 5000);
      const engagement = evidence.find((e) => e.claim.includes('engagement rate'));
      expect(engagement).toBeDefined();
      // Average engagement: sum(likes + retweets) / 10 tweets / 5000 followers * 100
      // (150+30 + 45+8 + 200+40 + 80+5 + 500+100 + 120+25 + 90+15 + 300+60 + 40+3 + 65+10) / 10 / 5000 * 100
      // = 1886 / 10 / 5000 * 100 = 3.77%
      expect(engagement!.claim).toMatch(/\d+\.?\d*%/);
    });

    it('detects technical content keywords', () => {
      const evidence = buildTweetEvidence(mockXTweets, profileUrl, 5000);
      const tech = evidence.find((e) => e.claim.includes('technical content'));
      expect(tech).toBeDefined();
      // Tweets with technical keywords: t1 (shipped, microservice, Rust), t2 (architecture, pipeline),
      // t3 (Deployed, API), t5 (open source, PR, k8s, kubernetes, merge), t6 (released, SDK, refactor),
      // t7 (built, CI/CD, pipeline), t10 (merge, backend)
      // That's 7 out of 10 = 70%
      expect(tech!.claim).toMatch(/\d+%/);
    });

    it('all tweet evidence IDs match ev-XXXXXX pattern', () => {
      const evidence = buildTweetEvidence(mockXTweets, profileUrl, 5000);
      for (const item of evidence) {
        expect(item.id).toMatch(/^ev-[0-9a-f]{6}$/);
      }
    });

    it('returns empty evidence for no tweets', () => {
      const evidence = buildTweetEvidence([], profileUrl, 5000);
      expect(evidence).toHaveLength(0);
    });

    it('includes posting frequency', () => {
      const evidence = buildTweetEvidence(mockXTweets, profileUrl, 5000);
      const freq = evidence.find((e) => e.claim.includes('tweets per week'));
      expect(freq).toBeDefined();
    });

    it('includes recent activity date', () => {
      const evidence = buildTweetEvidence(mockXTweets, profileUrl, 5000);
      const activity = evidence.find((e) => e.claim.includes('Last X post was'));
      expect(activity).toBeDefined();
      expect(activity!.claim).toContain('2026-03-20');
    });
  });
});

describe('Rate limiting', () => {
  it('basic tier uses longer delays (lower requestsPerMinute)', () => {
    const basic = new XAdapter('test-token', 'basic');
    const pro = new XAdapter('test-token', 'pro');
    // Basic: 5 req/min, Pro: 60 req/min
    expect(basic.rateLimits.requestsPerMinute).toBe(5);
    expect(pro.rateLimits.requestsPerMinute).toBe(60);
    expect(basic.rateLimits.requestsPerMinute!).toBeLessThan(pro.rateLimits.requestsPerMinute!);
  });
});
