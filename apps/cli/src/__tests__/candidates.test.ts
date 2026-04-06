import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RunMeta, ScoredCandidate, PIIField } from '@sourcerer/core';
import { findCandidateAcrossRuns, writeCandidates, loadCandidates } from '../run-loader.js';
import { candidatesCommand } from '../commands/candidates.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-candidates-test-'));
  process.exitCode = undefined;
});

afterEach(async () => {
  process.exitCode = undefined;
  await rm(testDir, { recursive: true, force: true });
});

function makeRunMeta(overrides?: Partial<RunMeta>): RunMeta {
  return {
    runId: 'run-001',
    roleName: 'Senior Backend Engineer',
    runDir: '/tmp/runs/2026-04-06-senior-backend-engineer',
    startedAt: '2026-04-06T10:00:00Z',
    completedAt: '2026-04-06T10:01:00Z',
    totalDurationMs: 45000,
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
  piiFields: PIIField[] = [],
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
    pii: { fields: piiFields, retentionPolicy: 'default' },
  };
}

async function createRun(
  runsDir: string,
  dirName: string,
  candidates: ScoredCandidate[],
  metaOverrides?: Partial<RunMeta>,
): Promise<string> {
  const runDir = join(runsDir, dirName);
  await mkdir(runDir, { recursive: true });
  const meta = makeRunMeta({
    runDir,
    candidateCount: candidates.length,
    ...metaOverrides,
  });
  await writeFile(join(runDir, 'run-meta.json'), JSON.stringify(meta), 'utf-8');
  const envelope = {
    version: 1,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates,
  };
  await writeFile(join(runDir, 'candidates.json'), JSON.stringify(envelope), 'utf-8');
  return runDir;
}

function captureConsole(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => output.push(args.join(' '));
  console.error = (...args: unknown[]) => output.push(args.join(' '));
  return {
    output,
    restore: () => {
      console.log = origLog;
      console.error = origError;
    },
  };
}

describe('findCandidateAcrossRuns', () => {
  it('finds candidate by ID across runs', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(runsDir, '2026-04-06-run-a', [
      makeMinimalCandidate('c1', 'Alice'),
      makeMinimalCandidate('c2', 'Bob'),
    ], { startedAt: '2026-04-06T10:00:00Z' });
    await createRun(runsDir, '2026-04-05-run-b', [
      makeMinimalCandidate('c3', 'Carol'),
    ], { startedAt: '2026-04-05T10:00:00Z' });

    const result = await findCandidateAcrossRuns('c3', runsDir);
    expect(result).not.toBeNull();
    expect(result!.candidate.name).toBe('Carol');
    expect(result!.index).toBe(0);
  });

  it('returns null for unknown ID', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(runsDir, '2026-04-06-run-a', [
      makeMinimalCandidate('c1', 'Alice'),
    ], { startedAt: '2026-04-06T10:00:00Z' });

    const result = await findCandidateAcrossRuns('nonexistent', runsDir);
    expect(result).toBeNull();
  });
});

describe('writeCandidates', () => {
  it('writes envelope format with correct count', async () => {
    const runDir = join(testDir, 'run');
    await mkdir(runDir, { recursive: true });

    const candidates = [
      makeMinimalCandidate('c1', 'Alice'),
      makeMinimalCandidate('c2', 'Bob'),
    ];
    await writeCandidates(runDir, candidates);

    const content = await readFile(join(runDir, 'candidates.json'), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(1);
    expect(parsed.candidateCount).toBe(2);
    expect(parsed.generatedAt).toBeDefined();
    expect(parsed.candidates).toHaveLength(2);
  });

  it('output is parseable by loadCandidates', async () => {
    const runDir = join(testDir, 'run');
    await mkdir(runDir, { recursive: true });

    const candidates = [
      makeMinimalCandidate('c1', 'Alice'),
      makeMinimalCandidate('c2', 'Bob'),
    ];
    await writeCandidates(runDir, candidates);

    const loaded = await loadCandidates(runDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe('Alice');
    expect(loaded[1].name).toBe('Bob');
  });
});

describe('candidatesCommand — delete', () => {
  it('removes candidate from candidates.json', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(runsDir, '2026-04-06-run', [
      makeMinimalCandidate('c1', 'Alice'),
      makeMinimalCandidate('c2', 'Bob'),
      makeMinimalCandidate('c3', 'Carol'),
    ], { startedAt: '2026-04-06T10:00:00Z' });

    const { output, restore } = captureConsole();
    try {
      await candidatesCommand(['delete', 'c2', '--yes', '--runs-dir', runsDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Deleted candidate Bob');

    // Verify candidate was removed
    const remaining = await loadCandidates(join(runsDir, '2026-04-06-run'));
    expect(remaining).toHaveLength(2);
    expect(remaining.find((c) => c.id === 'c2')).toBeUndefined();

    // Verify run-meta.json was updated
    const metaContent = await readFile(
      join(runsDir, '2026-04-06-run', 'run-meta.json'),
      'utf-8',
    );
    const meta = JSON.parse(metaContent) as RunMeta;
    expect(meta.candidateCount).toBe(2);
  });

  it('prints error for nonexistent ID', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(runsDir, '2026-04-06-run', [
      makeMinimalCandidate('c1', 'Alice'),
    ], { startedAt: '2026-04-06T10:00:00Z' });

    const { output, restore } = captureConsole();
    try {
      await candidatesCommand(['delete', 'nonexistent', '--yes', '--runs-dir', runsDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('not found in any run');
    expect(process.exitCode).toBe(1);
  });
});

describe('candidatesCommand — purge', () => {
  it('redacts expired PII fields', async () => {
    const runsDir = join(testDir, 'runs');
    const expiredPII: PIIField = {
      value: 'alice@secret.com',
      type: 'email',
      adapter: 'hunter',
      collectedAt: '2026-01-01T00:00:00Z',
      retentionExpiresAt: '2026-02-01T00:00:00Z', // well in the past
    };
    const validPII: PIIField = {
      value: 'bob@public.com',
      type: 'email',
      adapter: 'hunter',
      collectedAt: '2026-01-01T00:00:00Z',
      retentionExpiresAt: '2099-12-31T23:59:59Z', // far in the future
    };
    const noPII: PIIField = {
      value: 'carol@nope.com',
      type: 'email',
      adapter: 'hunter',
      collectedAt: '2026-01-01T00:00:00Z',
      // no retentionExpiresAt — should not be redacted
    };

    await createRun(
      runsDir,
      '2026-04-06-run',
      [
        makeMinimalCandidate('c1', 'Alice', 1, 90, [expiredPII]),
        makeMinimalCandidate('c2', 'Bob', 2, 70, [validPII]),
        makeMinimalCandidate('c3', 'Carol', 2, 60, [noPII]),
      ],
      { startedAt: '2026-04-06T10:00:00Z' },
    );

    const { output, restore } = captureConsole();
    try {
      await candidatesCommand(['purge', '--expired', '--runs-dir', runsDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Purged 1 PII field');
    expect(fullOutput).toContain('1 candidate');
    expect(fullOutput).toContain('1 run');

    // Verify the expired field was redacted
    const candidates = await loadCandidates(join(runsDir, '2026-04-06-run'));
    const alice = candidates.find((c) => c.id === 'c1')!;
    expect(alice.pii.fields[0].value).toBe('[REDACTED]');

    // Verify non-expired fields were NOT redacted
    const bob = candidates.find((c) => c.id === 'c2')!;
    expect(bob.pii.fields[0].value).toBe('bob@public.com');

    const carol = candidates.find((c) => c.id === 'c3')!;
    expect(carol.pii.fields[0].value).toBe('carol@nope.com');
  });

  it('leaves non-expired PII untouched', async () => {
    const runsDir = join(testDir, 'runs');
    const futurePII: PIIField = {
      value: 'future@test.com',
      type: 'email',
      adapter: 'hunter',
      collectedAt: '2026-01-01T00:00:00Z',
      retentionExpiresAt: '2099-12-31T23:59:59Z',
    };

    await createRun(
      runsDir,
      '2026-04-06-run',
      [makeMinimalCandidate('c1', 'Alice', 1, 90, [futurePII])],
      { startedAt: '2026-04-06T10:00:00Z' },
    );

    const { output, restore } = captureConsole();
    try {
      await candidatesCommand(['purge', '--expired', '--runs-dir', runsDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('No expired PII fields found.');

    // Verify value is unchanged
    const candidates = await loadCandidates(join(runsDir, '2026-04-06-run'));
    expect(candidates[0].pii.fields[0].value).toBe('future@test.com');
  });

  it('prints "nothing to purge" when no expired fields', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(
      runsDir,
      '2026-04-06-run',
      [makeMinimalCandidate('c1', 'Alice')],
      { startedAt: '2026-04-06T10:00:00Z' },
    );

    const { output, restore } = captureConsole();
    try {
      await candidatesCommand(['purge', '--expired', '--runs-dir', runsDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('No expired PII fields found.');
  });

  it('shows help with --help', async () => {
    const { output, restore } = captureConsole();
    try {
      await candidatesCommand(['--help']);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Usage: sourcerer candidates');
    expect(fullOutput).toContain('delete');
    expect(fullOutput).toContain('purge');
    expect(fullOutput).toContain('--expired');
  });
});
