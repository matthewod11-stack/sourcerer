import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubAdapter } from '../github-adapter.js';
import { extractEmailsFromCommits, computeLanguageDistribution } from '../parsers.js';
import type { Candidate, ObservedIdentifier } from '@sourcerer/core';
import type { GitHubCommit, GitHubRepo } from '../github-client.js';

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
  { name: 'defi-indexer', full_name: 'sarahchen/defi-indexer', language: 'Go', stargazers_count: 120, forks_count: 15, topics: ['defi'], updated_at: '2026-03-20T00:00:00Z', html_url: 'https://github.com/sarahchen/defi-indexer', fork: false },
  { name: 'go-utils', full_name: 'sarahchen/go-utils', language: 'Go', stargazers_count: 45, forks_count: 3, topics: [], updated_at: '2026-03-15T00:00:00Z', html_url: 'https://github.com/sarahchen/go-utils', fork: false },
  { name: 'rust-wasm', full_name: 'sarahchen/rust-wasm', language: 'Rust', stargazers_count: 30, forks_count: 2, topics: ['wasm'], updated_at: '2026-03-10T00:00:00Z', html_url: 'https://github.com/sarahchen/rust-wasm', fork: false },
  { name: 'fork-of-something', full_name: 'sarahchen/fork-of-something', language: 'JavaScript', stargazers_count: 0, forks_count: 0, topics: [], updated_at: '2026-01-01T00:00:00Z', html_url: 'https://github.com/sarahchen/fork-of-something', fork: true },
];

const mockCommits: GitHubCommit[] = [
  { sha: 'abc1', commit: { author: { name: 'Sarah Chen', email: 'sarah@gmail.com', date: '2026-03-20T10:00:00Z' }, message: 'feat: add indexer' }, html_url: 'https://github.com/sarahchen/defi-indexer/commit/abc1' },
  { sha: 'abc2', commit: { author: { name: 'Sarah Chen', email: 'sarah@gmail.com', date: '2026-03-19T10:00:00Z' }, message: 'fix: query bug' }, html_url: 'https://github.com/sarahchen/defi-indexer/commit/abc2' },
  { sha: 'abc3', commit: { author: { name: 'Sarah Chen', email: '12345+sarahchen@users.noreply.github.com', date: '2026-03-18T10:00:00Z' }, message: 'ci: update' }, html_url: 'https://github.com/sarahchen/defi-indexer/commit/abc3' },
  { sha: 'abc4', commit: { author: { name: 'Sarah Chen', email: 'sarah@chainlink.com', date: '2026-03-17T10:00:00Z' }, message: 'docs: readme' }, html_url: 'https://github.com/sarahchen/defi-indexer/commit/abc4' },
];

const mockRateLimit = { rate: { remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 } };

// --- Mock fetch ---

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn().mockImplementation(async (url: string) => {
    const path = new URL(url).pathname;

    if (path === '/users/sarahchen') {
      return { ok: true, json: async () => mockUser };
    }
    if (path.startsWith('/users/sarahchen/repos')) {
      return { ok: true, json: async () => mockRepos };
    }
    if (path.match(/\/repos\/sarahchen\/[\w-]+\/commits/)) {
      return { ok: true, json: async () => mockCommits };
    }
    if (path === '/rate_limit') {
      return { ok: true, json: async () => mockRateLimit };
    }
    if (path === '/users/nonexistent') {
      return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    }

    return { ok: true, json: async () => ({}) };
  });

  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Helpers ---

function makeCandidate(username?: string): Candidate {
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
    id: 'test-candidate',
    identity: { canonicalId: 'test-candidate', observedIdentifiers: identifiers, mergeConfidence: 1 },
    name: 'Sarah Chen',
    sources: {},
    evidence: [],
    enrichments: {},
    pii: { fields: [], retentionPolicy: 'default' },
  };
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
