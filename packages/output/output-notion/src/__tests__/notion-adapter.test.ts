import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ScoredCandidate,
  EvidenceItem,
  Score,
  ExtractedSignals,
  OutputConfig,
} from '@sourcerer/core';
import { generateEvidenceId } from '@sourcerer/core';

// ---- Mock @notionhq/client ----

const mockDatabasesCreate = vi.fn();
const mockDatabasesQuery = vi.fn();
const mockPagesCreate = vi.fn();
const mockPagesUpdate = vi.fn();
const mockBlocksChildrenAppend = vi.fn();
const mockBlocksChildrenList = vi.fn();
const mockBlocksDelete = vi.fn();
const mockUsersMe = vi.fn();
const mockSearch = vi.fn();

vi.mock('@notionhq/client', () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      databases: {
        create: mockDatabasesCreate,
        query: mockDatabasesQuery,
      },
      pages: {
        create: mockPagesCreate,
        update: mockPagesUpdate,
      },
      blocks: {
        children: {
          append: mockBlocksChildrenAppend,
          list: mockBlocksChildrenList,
        },
        delete: mockBlocksDelete,
      },
      users: {
        me: mockUsersMe,
      },
      search: mockSearch,
    })),
    isNotionClientError: vi.fn().mockReturnValue(false),
    APIErrorCode: { RateLimited: 'rate_limited' },
  };
});

// ---- Test Factories ----

function makeEvidence(overrides?: Partial<EvidenceItem>): EvidenceItem {
  const base = {
    adapter: 'exa',
    source: 'https://example.com/profile',
    claim: 'Senior engineer at Acme Corp',
    retrievedAt: '2026-03-24T00:00:00Z',
  };
  return {
    id: generateEvidenceId(base),
    ...base,
    confidence: 'high',
    url: 'https://example.com/profile',
    ...overrides,
  };
}

function makeSignals(): ExtractedSignals {
  const dim = { score: 8, evidenceIds: [], confidence: 0.9 };
  return {
    technicalDepth: dim,
    domainRelevance: dim,
    trajectoryMatch: dim,
    cultureFit: dim,
    reachability: dim,
    redFlags: [],
  };
}

function makeScore(evidence: EvidenceItem[]): Score {
  return {
    total: 78,
    breakdown: [
      {
        dimension: 'technicalDepth',
        raw: 8,
        weight: 0.3,
        weighted: 24,
        evidenceIds: evidence.map((e) => e.id),
        confidence: 0.9,
      },
    ],
    weights: { technicalDepth: 0.3 },
    redFlags: [],
  };
}

function makeScoredCandidate(
  id: string,
  name: string,
  tier: 1 | 2 | 3 = 2,
): ScoredCandidate {
  const evidence = [makeEvidence({ claim: `${name} has deep expertise` })];
  return {
    id,
    identity: {
      canonicalId: id,
      observedIdentifiers: [
        {
          type: 'email',
          value: `${name.toLowerCase().replace(' ', '.')}@test.com`,
          source: 'exa',
          observedAt: '2026-03-24T00:00:00Z',
          confidence: 'high',
        },
      ],
      mergeConfidence: 1,
    },
    name,
    sources: {},
    evidence,
    enrichments: {},
    signals: makeSignals(),
    score: makeScore(evidence),
    narrative: `${name} is a strong candidate with relevant experience.`,
    tier,
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

// ---- Setup ----

const TEST_TOKEN = 'ntn_test_token';
const TEST_PARENT_PAGE_ID = 'parent-page-id-123';

// Import after mocking
import { NotionOutputAdapter } from '../notion-adapter.js';

describe('NotionOutputAdapter', () => {
  let adapter: NotionOutputAdapter;

  beforeEach(() => {
    vi.clearAllMocks();

    adapter = new NotionOutputAdapter({
      token: TEST_TOKEN,
      parentPageId: TEST_PARENT_PAGE_ID,
    });

    // Default: no existing DB found
    mockSearch.mockResolvedValue({ results: [] });

    // Default: database creation returns an id
    mockDatabasesCreate.mockResolvedValue({
      id: 'db-new-123',
    });

    // Default: page creation returns an id
    mockPagesCreate.mockResolvedValue({ id: 'page-new-1' });

    // Default: page update returns
    mockPagesUpdate.mockResolvedValue({ id: 'page-existing-1' });

    // Default: block operations
    mockBlocksChildrenList.mockResolvedValue({ results: [] });
    mockBlocksChildrenAppend.mockResolvedValue({});
    mockBlocksDelete.mockResolvedValue({});

    // Default: database query (for upsert lookup) returns no results
    mockDatabasesQuery.mockResolvedValue({ results: [] });
  });

  describe('push()', () => {
    it('creates a new DB when none exists and creates pages', async () => {
      const candidates = [
        makeScoredCandidate('c1', 'Alice'),
        makeScoredCandidate('c2', 'Bob'),
      ];
      const config: OutputConfig = {
        outputDir: '/tmp',
        metadata: { databaseTitle: 'Backend Engineers' },
      };

      const result = await adapter.push(candidates, config);

      // Should search for existing DB
      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'Backend Engineers',
          filter: { property: 'object', value: 'database' },
        }),
      );

      // Should create a new DB
      expect(mockDatabasesCreate).toHaveBeenCalledTimes(1);
      expect(mockDatabasesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { type: 'page_id', page_id: TEST_PARENT_PAGE_ID },
        }),
      );

      // Should create 2 pages
      expect(mockPagesCreate).toHaveBeenCalledTimes(2);

      // Result
      expect(result.adapter).toBe('notion');
      expect(result.candidatesPushed).toBe(2);
      expect(result.outputLocation).toContain('dbnew123');
      expect(result.pushedAt).toBeTruthy();
    });

    it('uses existing DB when search finds a match', async () => {
      mockSearch.mockResolvedValue({
        results: [
          {
            object: 'database',
            id: 'db-existing-456',
            title: [{ plain_text: 'Sourcerer Candidates' }],
            parent: { type: 'page_id', page_id: TEST_PARENT_PAGE_ID },
          },
        ],
      });

      const candidates = [makeScoredCandidate('c1', 'Alice')];
      const config: OutputConfig = { outputDir: '/tmp' };

      await adapter.push(candidates, config);

      // Should NOT create a new DB
      expect(mockDatabasesCreate).not.toHaveBeenCalled();

      // Should create page in the existing DB
      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
      expect(mockPagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'db-existing-456' },
        }),
      );
    });

    it('uses default DB title when no metadata provided', async () => {
      const config: OutputConfig = { outputDir: '/tmp' };
      await adapter.push([], config);

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'Sourcerer Candidates' }),
      );
    });

    it('uses roleName from metadata as DB title', async () => {
      const config: OutputConfig = {
        outputDir: '/tmp',
        metadata: { roleName: 'Senior Frontend Engineer' },
      };
      await adapter.push([], config);

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'Senior Frontend Engineer' }),
      );
    });

    it('returns correct PushResult with database URL', async () => {
      const candidates = [makeScoredCandidate('c1', 'Alice')];
      const config: OutputConfig = { outputDir: '/tmp' };

      const result = await adapter.push(candidates, config);

      expect(result.adapter).toBe('notion');
      expect(result.candidatesPushed).toBe(1);
      expect(result.outputLocation).toMatch(/https:\/\/notion\.so\//);
      expect(result.pushedAt).toBeTruthy();
    });
  });

  describe('upsert()', () => {
    it('creates all candidates when none exist in DB', async () => {
      const candidates = [
        makeScoredCandidate('c1', 'Alice'),
        makeScoredCandidate('c2', 'Bob'),
      ];
      const config: OutputConfig = { outputDir: '/tmp' };

      const result = await adapter.upsert(candidates, config);

      expect(result.created).toEqual(['c1', 'c2']);
      expect(result.updated).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(mockPagesCreate).toHaveBeenCalledTimes(2);
    });

    it('updates existing pages and creates new ones', async () => {
      // First query returns a match for c1, second returns nothing for c2
      mockDatabasesQuery
        .mockResolvedValueOnce({
          results: [{ id: 'page-existing-c1' }],
        })
        .mockResolvedValueOnce({
          results: [],
        });

      const candidates = [
        makeScoredCandidate('c1', 'Alice'),
        makeScoredCandidate('c2', 'Bob'),
      ];
      const config: OutputConfig = { outputDir: '/tmp' };

      const result = await adapter.upsert(candidates, config);

      expect(result.updated).toEqual(['c1']);
      expect(result.created).toEqual(['c2']);

      // c1 should be updated (page update + block operations)
      expect(mockPagesUpdate).toHaveBeenCalledTimes(1);
      expect(mockPagesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ page_id: 'page-existing-c1' }),
      );

      // c2 should be created
      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
    });

    it('archives old blocks and appends new ones on update', async () => {
      mockDatabasesQuery.mockResolvedValue({
        results: [{ id: 'page-existing-c1' }],
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [{ id: 'old-block-1' }, { id: 'old-block-2' }],
      });

      const candidates = [makeScoredCandidate('c1', 'Alice')];
      const config: OutputConfig = { outputDir: '/tmp' };

      await adapter.upsert(candidates, config);

      // Should delete old blocks
      expect(mockBlocksDelete).toHaveBeenCalledTimes(2);
      expect(mockBlocksDelete).toHaveBeenCalledWith(
        expect.objectContaining({ block_id: 'old-block-1' }),
      );
      expect(mockBlocksDelete).toHaveBeenCalledWith(
        expect.objectContaining({ block_id: 'old-block-2' }),
      );

      // Should append new blocks
      expect(mockBlocksChildrenAppend).toHaveBeenCalledTimes(1);
      expect(mockBlocksChildrenAppend).toHaveBeenCalledWith(
        expect.objectContaining({ block_id: 'page-existing-c1' }),
      );
    });

    it('puts errors in the failed array', async () => {
      // First candidate lookup succeeds but update throws
      mockDatabasesQuery.mockResolvedValue({
        results: [{ id: 'page-existing-c1' }],
      });
      mockPagesUpdate.mockRejectedValue(new Error('Notion API error'));

      const candidates = [makeScoredCandidate('c1', 'Alice')];
      const config: OutputConfig = { outputDir: '/tmp' };

      const result = await adapter.upsert(candidates, config);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].candidateId).toBe('c1');
      expect(result.failed[0].error.message).toBe('Notion API error');
      expect(result.created).toEqual([]);
      expect(result.updated).toEqual([]);
    });
  });

  describe('testConnection()', () => {
    it('returns true on success', async () => {
      mockUsersMe.mockResolvedValue({ id: 'user-123', type: 'bot' });

      const result = await adapter.testConnection();

      expect(result).toBe(true);
      expect(mockUsersMe).toHaveBeenCalledTimes(1);
    });

    it('returns false on API error', async () => {
      mockUsersMe.mockRejectedValue(new Error('Unauthorized'));

      const result = await adapter.testConnection();

      expect(result).toBe(false);
    });
  });
});
