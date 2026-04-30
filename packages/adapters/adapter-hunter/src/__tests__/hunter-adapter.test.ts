import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HunterAdapter } from '../hunter-adapter.js';
import { buildPiiFields, buildEmailEvidence, buildVerificationEvidence } from '../parsers.js';
import type { Candidate, ObservedIdentifier, SourceData } from '@sourcerer/core';
import type { HunterEmailResult, HunterVerification, HunterAccountInfo } from '../hunter-client.js';

// --- Mock Data ---

const mockEmailResult: HunterEmailResult = {
  email: 'jane.smith@example.com',
  score: 92,
  domain: 'example.com',
  position: 'Senior Engineer',
  first_name: 'Jane',
  last_name: 'Smith',
  type: 'personal',
  confidence: 92,
  sources: [
    { domain: 'blog.example.com', uri: 'https://blog.example.com/team', extracted_on: '2026-01-15' },
    { domain: 'conference.io', uri: 'https://conference.io/speakers', extracted_on: '2025-11-20' },
    { domain: 'github.com', uri: 'https://github.com/janesmith', extracted_on: '2025-09-01' },
  ],
};

const mockVerification: HunterVerification = {
  email: 'jane.smith@example.com',
  result: 'deliverable',
  score: 95,
  smtp_server: 'mx.example.com',
  smtp_check: true,
};

const mockUndeliverableVerification: HunterVerification = {
  email: 'jane.smith@example.com',
  result: 'undeliverable',
  score: 10,
  smtp_server: 'mx.example.com',
  smtp_check: false,
};

const mockAccountInfo: HunterAccountInfo = {
  email: 'user@mycompany.com',
  plan_name: 'free',
  plan_level: 0,
  requests: {
    searches: {
      used: 10,
      available: 25,
    },
  },
};

const mockExhaustedAccountInfo: HunterAccountInfo = {
  email: 'user@mycompany.com',
  plan_name: 'free',
  plan_level: 0,
  requests: {
    searches: {
      used: 25,
      available: 25,
    },
  },
};

// --- Mock fetch ---

let mockFetch: ReturnType<typeof vi.fn>;

function hunterUrl(path: string): boolean {
  return path.startsWith('https://api.hunter.io/v2');
}

function extractEndpoint(url: string): string {
  const u = new URL(url);
  return u.pathname.replace('/v2', '');
}

beforeEach(() => {
  mockFetch = vi.fn().mockImplementation(async (url: string) => {
    if (!hunterUrl(url)) {
      return { ok: false, status: 404, json: async () => ({}) };
    }

    const endpoint = extractEndpoint(url);

    if (endpoint === '/email-finder') {
      return {
        ok: true,
        json: async () => ({ data: mockEmailResult }),
      };
    }
    if (endpoint === '/email-verifier') {
      return {
        ok: true,
        json: async () => ({ data: mockVerification }),
      };
    }
    if (endpoint === '/domain-search') {
      return {
        ok: true,
        json: async () => ({ data: { domain: 'example.com', emails: [mockEmailResult] } }),
      };
    }
    if (endpoint === '/account') {
      return {
        ok: true,
        json: async () => ({ data: mockAccountInfo }),
      };
    }

    return { ok: false, status: 404, json: async () => ({ errors: [{ details: 'Not found' }] }) };
  });

  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Helpers ---

function makeCandidate(
  opts: { name?: string; company?: string; identifiers?: ObservedIdentifier[] } = {},
): Candidate {
  const sources: Record<string, SourceData> = {};
  if (opts.company) {
    sources['exa'] = {
      adapter: 'exa',
      retrievedAt: '2026-03-25T00:00:00Z',
      urls: ['https://example.com'],
      rawProfile: { company: opts.company },
    };
  }

  return {
    id: 'test-candidate-1',
    identity: {
      canonicalId: 'test-candidate-1',
      observedIdentifiers: opts.identifiers ?? [],
      mergeConfidence: 1,
    },
    name: opts.name ?? 'Jane Smith',
    sources,
    evidence: [],
    enrichments: {},
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

// --- Tests ---

describe('HunterAdapter', () => {
  let adapter: HunterAdapter;

  beforeEach(() => {
    adapter = new HunterAdapter('test-api-key', { requestsPerSecond: 1000 });
  });

  describe('enrich()', () => {
    it('returns email evidence and PII when name + domain available', async () => {
      const candidate = makeCandidate({ name: 'Jane Smith', company: 'example.com' });
      const result = await adapter.enrich(candidate);

      expect(result.adapter).toBe('hunter');
      expect(result.candidateId).toBe('test-candidate-1');
      expect(result.evidence.length).toBeGreaterThanOrEqual(2); // email found + sources + verification
      expect(result.piiFields.length).toBe(1);
      expect(result.piiFields[0].value).toBe('jane.smith@example.com');
      expect(result.piiFields[0].type).toBe('email');
      expect(result.piiFields[0].adapter).toBe('hunter');
      expect(result.sourceData.adapter).toBe('hunter');
    });

    it('returns empty result when no domain is extractable', async () => {
      const candidate = makeCandidate({ name: 'Jane Smith' }); // no company
      const result = await adapter.enrich(candidate);

      expect(result.evidence).toHaveLength(0);
      expect(result.piiFields).toHaveLength(0);
      expect(result.sourceData.urls).toHaveLength(0);
    });

    it('returns empty result when candidate has no name', async () => {
      const candidate = makeCandidate({ name: '', company: 'example.com' });
      const result = await adapter.enrich(candidate);

      expect(result.evidence).toHaveLength(0);
      expect(result.piiFields).toHaveLength(0);
    });

    it('returns empty result when Hunter finds no email', async () => {
      // Override fetch to return empty email
      mockFetch.mockImplementation(async (url: string) => {
        const endpoint = extractEndpoint(url);
        if (endpoint === '/email-finder') {
          return {
            ok: true,
            json: async () => ({
              data: { ...mockEmailResult, email: '' },
            }),
          };
        }
        if (endpoint === '/account') {
          return { ok: true, json: async () => ({ data: mockAccountInfo }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const candidate = makeCandidate({ name: 'Jane Smith', company: 'example.com' });
      const result = await adapter.enrich(candidate);

      expect(result.evidence).toHaveLength(0);
      expect(result.piiFields).toHaveLength(0);
    });

    it('includes verification evidence with undeliverable status', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        const endpoint = extractEndpoint(url);
        if (endpoint === '/email-finder') {
          return { ok: true, json: async () => ({ data: mockEmailResult }) };
        }
        if (endpoint === '/email-verifier') {
          return { ok: true, json: async () => ({ data: mockUndeliverableVerification }) };
        }
        if (endpoint === '/account') {
          return { ok: true, json: async () => ({ data: mockAccountInfo }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const candidate = makeCandidate({ name: 'Jane Smith', company: 'example.com' });
      const result = await adapter.enrich(candidate);

      const verifyClaim = result.evidence.find((e) => e.claim.includes('undeliverable'));
      expect(verifyClaim).toBeDefined();
      expect(verifyClaim!.claim).toContain('undeliverable');
    });

    it('evidence IDs all match ev-XXXXXX pattern', async () => {
      const candidate = makeCandidate({ name: 'Jane Smith', company: 'example.com' });
      const result = await adapter.enrich(candidate);

      for (const ev of result.evidence) {
        expect(ev.id).toMatch(/^ev-[0-9a-f]{6}$/);
      }
    });

    it('handles domain as full URL in rawProfile.company', async () => {
      const candidate = makeCandidate({
        name: 'Jane Smith',
        company: 'https://www.example.com/about',
      });
      const result = await adapter.enrich(candidate);

      // Should have extracted "www.example.com" from the URL
      expect(result.evidence.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('enrichBatch()', () => {
    it('enriches multiple candidates successfully', async () => {
      const candidates = [
        makeCandidate({ name: 'Jane Smith', company: 'example.com' }),
        makeCandidate({ name: 'John Doe', company: 'example.com' }),
      ];
      // Give each a unique ID
      candidates[1].id = 'test-candidate-2';
      candidates[1].identity.canonicalId = 'test-candidate-2';

      const result = await adapter.enrichBatch(candidates);

      expect(result.succeeded).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it('marks remaining candidates as retryable when quota exhausted', async () => {
      // Set up mock to return exhausted quota on account check
      mockFetch.mockImplementation(async (url: string) => {
        const endpoint = extractEndpoint(url);
        if (endpoint === '/account') {
          return { ok: true, json: async () => ({ data: mockExhaustedAccountInfo }) };
        }
        if (endpoint === '/email-finder') {
          return { ok: true, json: async () => ({ data: mockEmailResult }) };
        }
        if (endpoint === '/email-verifier') {
          return { ok: true, json: async () => ({ data: mockVerification }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const candidates = [
        makeCandidate({ name: 'Jane Smith', company: 'example.com' }),
        makeCandidate({ name: 'John Doe', company: 'example.com' }),
        makeCandidate({ name: 'Alice Wonderland', company: 'example.com' }),
      ];
      candidates[0].id = 'candidate-1';
      candidates[1].id = 'candidate-2';
      candidates[2].id = 'candidate-3';

      const result = await adapter.enrichBatch(candidates);

      // All 3 should fail because quota is exhausted (0 remaining) from the start
      expect(result.failed.length).toBe(3);
      for (const f of result.failed) {
        expect(f.retryable).toBe(true);
        expect(f.error.message).toContain('quota exhausted');
      }
    });

    it('continues to next candidate on API error for one', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async (url: string) => {
        const endpoint = extractEndpoint(url);
        if (endpoint === '/account') {
          return { ok: true, json: async () => ({ data: mockAccountInfo }) };
        }
        if (endpoint === '/email-finder') {
          callCount++;
          if (callCount === 1) {
            // First candidate fails with 500
            return {
              ok: false,
              status: 500,
              json: async () => ({ errors: [{ details: 'Internal error' }] }),
            };
          }
          return { ok: true, json: async () => ({ data: mockEmailResult }) };
        }
        if (endpoint === '/email-verifier') {
          return { ok: true, json: async () => ({ data: mockVerification }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const candidates = [
        makeCandidate({ name: 'Jane Smith', company: 'example.com' }),
        makeCandidate({ name: 'John Doe', company: 'example.com' }),
      ];
      candidates[0].id = 'candidate-1';
      candidates[1].id = 'candidate-2';

      const result = await adapter.enrichBatch(candidates);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].candidateId).toBe('candidate-1');
      expect(result.succeeded).toHaveLength(1);
      expect(result.succeeded[0].candidateId).toBe('candidate-2');
    });
  });

  describe('healthCheck()', () => {
    it('returns true when quota is available', async () => {
      const healthy = await adapter.healthCheck();
      expect(healthy).toBe(true);
    });

    it('returns false when API key is invalid', async () => {
      mockFetch.mockImplementation(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ errors: [{ details: 'Invalid API key' }] }),
      }));

      const healthy = await adapter.healthCheck();
      expect(healthy).toBe(false);
    });

    it('returns false when quota is exhausted', async () => {
      mockFetch.mockImplementation(async () => ({
        ok: true,
        json: async () => ({ data: mockExhaustedAccountInfo }),
      }));

      const healthy = await adapter.healthCheck();
      expect(healthy).toBe(false);
    });
  });

  describe('estimateCost()', () => {
    it('returns per-candidate cost estimate', () => {
      const estimate = adapter.estimateCost({
        roleName: 'Backend Engineer',
        tiers: [],
        scoringWeights: {},
        tierThresholds: { tier1MinScore: 70, tier2MinScore: 40 },
        enrichmentPriority: [],
        antiFilters: [],
        maxCandidates: 20,
        createdAt: '2026-03-25T00:00:00Z',
        version: 1,
      });

      expect(estimate.estimatedCost).toBeCloseTo(0.6); // 20 * 0.03
      expect(estimate.enrichCount).toBe(20);
      expect(estimate.currency).toBe('USD');
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
  describe('buildPiiFields()', () => {
    it('creates correct PIIField structure', () => {
      const now = '2026-03-25T12:00:00Z';
      const fields = buildPiiFields(mockEmailResult, now);

      expect(fields).toHaveLength(1);
      expect(fields[0].value).toBe('jane.smith@example.com');
      expect(fields[0].type).toBe('email');
      expect(fields[0].adapter).toBe('hunter');
      expect(fields[0].collectedAt).toBe(now);
    });

    it('omits retentionExpiresAt when no ttlDays is supplied', () => {
      const now = '2026-03-25T12:00:00Z';
      const fields = buildPiiFields(mockEmailResult, now);
      expect(fields[0].retentionExpiresAt).toBeUndefined();
    });

    // H-2: parsers must stamp retentionExpiresAt at collection time when a
    // ttlDays is threaded through, so that `candidates purge --expired` is
    // not a no-op for newly collected PII.
    it('stamps retentionExpiresAt ~30 days out when ttlDays=30', () => {
      const now = '2026-03-25T12:00:00.000Z';
      const fields = buildPiiFields(mockEmailResult, now, 30);

      expect(fields[0].retentionExpiresAt).toBeDefined();
      const collectedMs = new Date(fields[0].collectedAt).getTime();
      const expiryMs = new Date(fields[0].retentionExpiresAt!).getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      expect(expiryMs - collectedMs).toBe(30 * dayMs);
    });

    it('uses the same now snapshot for both collectedAt and retentionExpiresAt', () => {
      const now = '2026-04-30T07:00:00.000Z';
      const fields = buildPiiFields(mockEmailResult, now, 90);
      // collectedAt MUST equal the `now` we passed in, and expiresAt must
      // derive from that exact same instant — no clock drift between fields.
      expect(fields[0].collectedAt).toBe(now);
      expect(fields[0].retentionExpiresAt).toBe('2026-07-29T07:00:00.000Z');
    });
  });

  describe('buildEmailEvidence()', () => {
    it('generates evidence with correct adapter and ev-XXXXXX IDs', () => {
      const evidence = buildEmailEvidence(mockEmailResult, 'https://hunter.io/find/example.com');

      expect(evidence.length).toBe(2); // email claim + sources claim
      for (const ev of evidence) {
        expect(ev.adapter).toBe('hunter');
        expect(ev.id).toMatch(/^ev-[0-9a-f]{6}$/);
      }
      expect(evidence[0].claim).toContain('jane.smith@example.com');
      expect(evidence[0].claim).toContain('92%');
      expect(evidence[1].claim).toContain('3 online sources');
    });
  });

  describe('buildVerificationEvidence()', () => {
    it('generates deliverable verification evidence', () => {
      const evidence = buildVerificationEvidence(
        mockVerification,
        'https://hunter.io/find/example.com',
      );

      expect(evidence).toHaveLength(1);
      expect(evidence[0].claim).toContain('deliverable');
      expect(evidence[0].confidence).toBe('high');
    });

    it('generates undeliverable verification evidence with low confidence', () => {
      const evidence = buildVerificationEvidence(
        mockUndeliverableVerification,
        'https://hunter.io/find/example.com',
      );

      expect(evidence).toHaveLength(1);
      expect(evidence[0].claim).toContain('undeliverable');
      expect(evidence[0].confidence).toBe('low');
    });
  });
});
