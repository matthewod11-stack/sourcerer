import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ScoredCandidate,
  EvidenceItem,
  Score,
  ExtractedSignals,
  OutputConfig,
} from '@sourcerer/core';
import { generateEvidenceId } from '@sourcerer/core';
import { CsvOutputAdapter } from '../csv-adapter.js';

// --- Test Factories ---

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
      {
        dimension: 'domainRelevance',
        raw: 7,
        weight: 0.25,
        weighted: 17.5,
        evidenceIds: [],
        confidence: 0.85,
      },
    ],
    weights: { technicalDepth: 0.3, domainRelevance: 0.25 },
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

// --- Tests ---

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-csv-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('CsvOutputAdapter', () => {
  const adapter = new CsvOutputAdapter();

  describe('push()', () => {
    it('writes candidates.csv to outputDir', async () => {
      const candidates = [makeScoredCandidate('c1', 'Alice')];
      const config: OutputConfig = { outputDir: testDir };
      await adapter.push(candidates, config);

      const content = await readFile(join(testDir, 'candidates.csv'), 'utf-8');
      expect(content).toContain('Alice');
      expect(content.charCodeAt(0)).toBe(0xfeff); // BOM
    });

    it('creates outputDir if it does not exist', async () => {
      const nested = join(testDir, 'deep', 'nested', 'dir');
      const config: OutputConfig = { outputDir: nested };
      await adapter.push([], config);

      const s = await stat(join(nested, 'candidates.csv'));
      expect(s.isFile()).toBe(true);
    });

    it('returns correct PushResult', async () => {
      const candidates = [
        makeScoredCandidate('c1', 'Alice'),
        makeScoredCandidate('c2', 'Bob'),
      ];
      const config: OutputConfig = { outputDir: testDir };
      const result = await adapter.push(candidates, config);

      expect(result.adapter).toBe('csv');
      expect(result.candidatesPushed).toBe(2);
      expect(result.outputLocation).toBe(join(testDir, 'candidates.csv'));
      expect(result.pushedAt).toBeTruthy();
    });

    it('uses custom filename from config.metadata.filename', async () => {
      const config: OutputConfig = {
        outputDir: testDir,
        metadata: { filename: 'results.csv' },
      };
      await adapter.push([], config);

      const s = await stat(join(testDir, 'results.csv'));
      expect(s.isFile()).toBe(true);
    });

    it('handles empty candidate array', async () => {
      const config: OutputConfig = { outputDir: testDir };
      await adapter.push([], config);

      const content = await readFile(join(testDir, 'candidates.csv'), 'utf-8');
      // Should have BOM + header only
      const lines = content.split('\n').filter((l) => l.length > 0);
      expect(lines).toHaveLength(1); // header only (BOM is part of first line)
    });

    it('writes valid CSV content with header', async () => {
      const candidates = [makeScoredCandidate('c1', 'Alice')];
      const config: OutputConfig = { outputDir: testDir };
      await adapter.push(candidates, config);

      const content = await readFile(join(testDir, 'candidates.csv'), 'utf-8');
      const headerLine = content.slice(1).split('\n')[0]; // skip BOM
      expect(headerLine).toContain('Name');
      expect(headerLine).toContain('Score');
      expect(headerLine).toContain('LinkedIn URL');
    });
  });

  describe('upsert()', () => {
    it('returns all candidate IDs in created when file does not exist', async () => {
      const candidates = [
        makeScoredCandidate('c1', 'Alice'),
        makeScoredCandidate('c2', 'Bob'),
      ];
      const config: OutputConfig = { outputDir: testDir };
      const result = await adapter.upsert(candidates, config);

      expect(result.created).toEqual(['c1', 'c2']);
      expect(result.updated).toEqual([]);
    });

    it('returns all candidate IDs in updated when file already exists', async () => {
      const config: OutputConfig = { outputDir: testDir };
      await writeFile(join(testDir, 'candidates.csv'), 'old content', 'utf-8');

      const candidates = [makeScoredCandidate('c1', 'Alice')];
      const result = await adapter.upsert(candidates, config);

      expect(result.created).toEqual([]);
      expect(result.updated).toEqual(['c1']);
    });

    it('unchanged is always empty', async () => {
      const config: OutputConfig = { outputDir: testDir };
      const result = await adapter.upsert(
        [makeScoredCandidate('c1', 'Alice')],
        config,
      );
      expect(result.unchanged).toEqual([]);
    });

    it('failed is empty on success', async () => {
      const config: OutputConfig = { outputDir: testDir };
      const result = await adapter.upsert(
        [makeScoredCandidate('c1', 'Alice')],
        config,
      );
      expect(result.failed).toEqual([]);
    });

    it('overwrites existing file content', async () => {
      const config: OutputConfig = { outputDir: testDir };

      await adapter.push([makeScoredCandidate('c1', 'Alice')], config);
      await adapter.upsert([makeScoredCandidate('c2', 'Bob')], config);

      const content = await readFile(join(testDir, 'candidates.csv'), 'utf-8');
      expect(content).toContain('Bob');
      // Alice should no longer be present (full overwrite)
      expect(content).not.toContain('Alice');
    });
  });

  describe('testConnection()', () => {
    it('returns true', async () => {
      expect(await adapter.testConnection()).toBe(true);
    });
  });
});
