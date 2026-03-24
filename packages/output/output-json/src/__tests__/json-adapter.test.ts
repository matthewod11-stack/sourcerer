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
import { JsonOutputAdapter } from '../json-adapter.js';
import { serializeCandidates } from '../serializer.js';
import type { JsonOutputPayload } from '../serializer.js';

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
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-json-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('serializeCandidates()', () => {
  it('produces valid JSON', () => {
    const candidates = [makeScoredCandidate('c1', 'Alice')];
    const json = serializeCandidates(candidates);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('includes version field as 1', () => {
    const result: JsonOutputPayload = JSON.parse(serializeCandidates([]));
    expect(result.version).toBe(1);
  });

  it('includes generatedAt as ISO string', () => {
    const result: JsonOutputPayload = JSON.parse(serializeCandidates([]));
    expect(new Date(result.generatedAt).toISOString()).toBe(
      result.generatedAt,
    );
  });

  it('includes candidateCount matching array length', () => {
    const candidates = [
      makeScoredCandidate('c1', 'Alice'),
      makeScoredCandidate('c2', 'Bob'),
    ];
    const result: JsonOutputPayload = JSON.parse(
      serializeCandidates(candidates),
    );
    expect(result.candidateCount).toBe(2);
    expect(result.candidates).toHaveLength(2);
  });

  it('preserves all candidate fields', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    const result: JsonOutputPayload = JSON.parse(
      serializeCandidates([candidate]),
    );
    const parsed = result.candidates[0];
    expect(parsed.id).toBe('c1');
    expect(parsed.name).toBe('Alice');
    expect(parsed.tier).toBe(1);
    expect(parsed.narrative).toContain('Alice');
    expect(parsed.score.total).toBe(78);
    expect(parsed.evidence).toHaveLength(1);
  });

  it('omits metadata key when metadata is undefined', () => {
    const json = serializeCandidates([]);
    const result = JSON.parse(json);
    expect(result).not.toHaveProperty('metadata');
  });

  it('includes metadata when provided', () => {
    const json = serializeCandidates([], { runId: 'run-123' });
    const result: JsonOutputPayload = JSON.parse(json);
    expect(result.metadata).toEqual({ runId: 'run-123' });
  });
});

describe('JsonOutputAdapter', () => {
  const adapter = new JsonOutputAdapter();

  describe('push()', () => {
    it('writes candidates.json to outputDir', async () => {
      const candidates = [makeScoredCandidate('c1', 'Alice')];
      const config: OutputConfig = { outputDir: testDir };
      await adapter.push(candidates, config);

      const content = await readFile(join(testDir, 'candidates.json'), 'utf-8');
      const parsed: JsonOutputPayload = JSON.parse(content);
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0].name).toBe('Alice');
    });

    it('creates outputDir if it does not exist', async () => {
      const nested = join(testDir, 'deep', 'nested', 'dir');
      const config: OutputConfig = { outputDir: nested };
      await adapter.push([], config);

      const s = await stat(join(nested, 'candidates.json'));
      expect(s.isFile()).toBe(true);
    });

    it('returns correct PushResult', async () => {
      const candidates = [
        makeScoredCandidate('c1', 'Alice'),
        makeScoredCandidate('c2', 'Bob'),
      ];
      const config: OutputConfig = { outputDir: testDir };
      const result = await adapter.push(candidates, config);

      expect(result.adapter).toBe('json');
      expect(result.candidatesPushed).toBe(2);
      expect(result.outputLocation).toBe(join(testDir, 'candidates.json'));
      expect(result.pushedAt).toBeTruthy();
    });

    it('uses custom filename from config.metadata.filename', async () => {
      const config: OutputConfig = {
        outputDir: testDir,
        metadata: { filename: 'results.json' },
      };
      await adapter.push([], config);

      const s = await stat(join(testDir, 'results.json'));
      expect(s.isFile()).toBe(true);
    });

    it('handles empty candidate array', async () => {
      const config: OutputConfig = { outputDir: testDir };
      await adapter.push([], config);

      const content = await readFile(join(testDir, 'candidates.json'), 'utf-8');
      const parsed: JsonOutputPayload = JSON.parse(content);
      expect(parsed.candidateCount).toBe(0);
      expect(parsed.candidates).toHaveLength(0);
    });

    it('passes through config.metadata into output payload', async () => {
      const config: OutputConfig = {
        outputDir: testDir,
        metadata: { role: 'Backend Engineer', runId: 'run-42' },
      };
      await adapter.push([], config);

      const content = await readFile(join(testDir, 'candidates.json'), 'utf-8');
      const parsed: JsonOutputPayload = JSON.parse(content);
      expect(parsed.metadata).toEqual({
        role: 'Backend Engineer',
        runId: 'run-42',
      });
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
      await writeFile(join(testDir, 'candidates.json'), '{}', 'utf-8');

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

      const content = await readFile(join(testDir, 'candidates.json'), 'utf-8');
      const parsed: JsonOutputPayload = JSON.parse(content);
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0].name).toBe('Bob');
    });
  });

  describe('testConnection()', () => {
    it('returns true', async () => {
      expect(await adapter.testConnection()).toBe(true);
    });
  });
});
