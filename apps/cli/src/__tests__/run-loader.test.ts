import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RunMeta, ScoredCandidate } from '@sourcerer/core';
import { findLatestRunDir, loadRunMeta, loadCandidates } from '../run-loader.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-run-loader-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function makeRunMeta(overrides?: Partial<RunMeta>): RunMeta {
  return {
    runId: 'run-001',
    roleName: 'Senior Backend Engineer',
    runDir: '/tmp/runs/2026-04-06-senior-backend-engineer',
    startedAt: '2026-04-06T10:00:00Z',
    completedAt: '2026-04-06T10:01:00Z',
    totalDurationMs: 60000,
    status: 'completed',
    phases: [],
    lastCompletedPhase: 'output',
    cost: {
      totalCost: 0.08,
      perPhase: {},
      perAdapter: {},
      currency: 'USD',
    },
    candidateCount: 3,
    version: 1,
    ...overrides,
  };
}

function makeMinimalCandidate(
  id: string,
  name: string,
  tier: 1 | 2 | 3 = 2,
  total = 78,
): ScoredCandidate {
  return {
    id,
    identity: {
      canonicalId: id,
      observedIdentifiers: [],
      mergeConfidence: 1,
    },
    name,
    sources: {},
    evidence: [],
    enrichments: {},
    signals: {
      technicalDepth: { score: 8, evidenceIds: [], confidence: 0.9 },
      domainRelevance: { score: 7, evidenceIds: [], confidence: 0.85 },
      trajectoryMatch: { score: 7, evidenceIds: [], confidence: 0.8 },
      cultureFit: { score: 6, evidenceIds: [], confidence: 0.7 },
      reachability: { score: 5, evidenceIds: [], confidence: 0.6 },
      redFlags: [],
    },
    score: {
      total,
      breakdown: [
        {
          dimension: 'technicalDepth',
          raw: 8,
          weight: 0.3,
          weighted: 24,
          evidenceIds: [],
          confidence: 0.9,
        },
      ],
      weights: { technicalDepth: 0.3 },
      redFlags: [],
    },
    narrative: `${name} is a strong candidate.`,
    tier,
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

describe('findLatestRunDir', () => {
  it('returns most recent run by name sort', async () => {
    const runsDir = join(testDir, 'runs');
    await mkdir(join(runsDir, '2026-04-05-role-a'), { recursive: true });
    await mkdir(join(runsDir, '2026-04-06-role-b'), { recursive: true });
    await mkdir(join(runsDir, '2026-04-04-role-c'), { recursive: true });

    const result = await findLatestRunDir(runsDir);
    expect(result).toBe(join(runsDir, '2026-04-06-role-b'));
  });

  it('returns null when runs/ is empty', async () => {
    const runsDir = join(testDir, 'runs');
    await mkdir(runsDir, { recursive: true });

    const result = await findLatestRunDir(runsDir);
    expect(result).toBeNull();
  });

  it("returns null when runs/ doesn't exist", async () => {
    const result = await findLatestRunDir(join(testDir, 'nonexistent'));
    expect(result).toBeNull();
  });

  it('ignores files, only considers directories', async () => {
    const runsDir = join(testDir, 'runs');
    await mkdir(join(runsDir, '2026-04-05-role-a'), { recursive: true });
    // Create a file that would sort after the directory
    await writeFile(join(runsDir, 'z-readme.txt'), 'not a run dir');

    const result = await findLatestRunDir(runsDir);
    expect(result).toBe(join(runsDir, '2026-04-05-role-a'));
  });
});

describe('loadCandidates', () => {
  it('parses envelope format { version: 1, candidates: [...] }', async () => {
    const runDir = join(testDir, 'run');
    await mkdir(runDir, { recursive: true });

    const envelope = {
      version: 1,
      generatedAt: '2026-04-06T10:00:00Z',
      candidateCount: 2,
      candidates: [
        makeMinimalCandidate('c1', 'Alice', 1),
        makeMinimalCandidate('c2', 'Bob', 2),
      ],
    };
    await writeFile(join(runDir, 'candidates.json'), JSON.stringify(envelope), 'utf-8');

    const candidates = await loadCandidates(runDir);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe('Alice');
    expect(candidates[1].name).toBe('Bob');
  });

  it('parses raw array format [...]', async () => {
    const runDir = join(testDir, 'run');
    await mkdir(runDir, { recursive: true });

    const arr = [
      makeMinimalCandidate('c1', 'Alice', 1),
    ];
    await writeFile(join(runDir, 'candidates.json'), JSON.stringify(arr), 'utf-8');

    const candidates = await loadCandidates(runDir);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe('Alice');
  });
});

describe('loadRunMeta', () => {
  it('parses valid run-meta.json', async () => {
    const runDir = join(testDir, 'run');
    await mkdir(runDir, { recursive: true });

    const meta = makeRunMeta();
    await writeFile(join(runDir, 'run-meta.json'), JSON.stringify(meta), 'utf-8');

    const loaded = await loadRunMeta(runDir);
    expect(loaded.runId).toBe('run-001');
    expect(loaded.roleName).toBe('Senior Backend Engineer');
    expect(loaded.status).toBe('completed');
    expect(loaded.cost.totalCost).toBe(0.08);
    expect(loaded.candidateCount).toBe(3);
  });
});
