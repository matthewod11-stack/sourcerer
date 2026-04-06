import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RunMeta, ScoredCandidate } from '@sourcerer/core';
import { listAllRuns } from '../run-loader.js';
import { parseDuration, runsCommand } from '../commands/runs.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-runs-test-'));
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
      totalCost: 0.42,
      perPhase: {},
      perAdapter: {},
      currency: 'USD',
    },
    candidateCount: 12,
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

async function createRun(
  runsDir: string,
  dirName: string,
  metaOverrides?: Partial<RunMeta>,
  candidates?: ScoredCandidate[],
): Promise<string> {
  const runDir = join(runsDir, dirName);
  await mkdir(runDir, { recursive: true });
  const meta = makeRunMeta({
    runDir,
    ...metaOverrides,
  });
  await writeFile(join(runDir, 'run-meta.json'), JSON.stringify(meta), 'utf-8');
  if (candidates) {
    const envelope = {
      version: 1,
      generatedAt: new Date().toISOString(),
      candidateCount: candidates.length,
      candidates,
    };
    await writeFile(join(runDir, 'candidates.json'), JSON.stringify(envelope), 'utf-8');
  }
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

describe('listAllRuns', () => {
  it('returns runs sorted by startedAt descending', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(runsDir, '2026-04-04-role-a', {
      startedAt: '2026-04-04T10:00:00Z',
      roleName: 'Role A',
    });
    await createRun(runsDir, '2026-04-06-role-b', {
      startedAt: '2026-04-06T10:00:00Z',
      roleName: 'Role B',
    });
    await createRun(runsDir, '2026-04-05-role-c', {
      startedAt: '2026-04-05T10:00:00Z',
      roleName: 'Role C',
    });

    const runs = await listAllRuns(runsDir);
    expect(runs).toHaveLength(3);
    expect(runs[0].meta.roleName).toBe('Role B');
    expect(runs[1].meta.roleName).toBe('Role C');
    expect(runs[2].meta.roleName).toBe('Role A');
  });

  it('returns empty array when no runs', async () => {
    const runsDir = join(testDir, 'runs');
    await mkdir(runsDir, { recursive: true });
    const runs = await listAllRuns(runsDir);
    expect(runs).toHaveLength(0);
  });

  it('skips directories without valid run-meta.json', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(runsDir, '2026-04-06-valid', {
      startedAt: '2026-04-06T10:00:00Z',
      roleName: 'Valid Run',
    });
    // Create a directory without run-meta.json
    await mkdir(join(runsDir, '2026-04-05-invalid'), { recursive: true });

    const { output, restore } = captureConsole();
    try {
      const runs = await listAllRuns(runsDir);
      expect(runs).toHaveLength(1);
      expect(runs[0].meta.roleName).toBe('Valid Run');
      // Should have warned about the invalid directory
      const warnings = output.filter((o) => o.includes('Warning'));
      expect(warnings.length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });
});

describe('parseDuration', () => {
  it("parses '30d' correctly", () => {
    expect(parseDuration('30d')).toBe(30 * 86400000);
  });

  it("parses '2w' correctly", () => {
    expect(parseDuration('2w')).toBe(14 * 86400000);
  });

  it('throws on invalid format', () => {
    expect(() => parseDuration('invalid')).toThrow();
    expect(() => parseDuration('30h')).toThrow();
    expect(() => parseDuration('')).toThrow();
  });
});

describe('runsCommand', () => {
  it('displays formatted output with runs', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(runsDir, '2026-04-06-senior-backend-engineer', {
      startedAt: '2026-04-06T10:00:00Z',
      roleName: 'Senior Backend Engineer',
      status: 'completed',
      totalDurationMs: 45000,
      candidateCount: 12,
    });

    const { output, restore } = captureConsole();
    try {
      await runsCommand(['--runs-dir', runsDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Sourcerer Runs');
    expect(fullOutput).toContain('Senior Backend Engineer');
    expect(fullOutput).toContain('2026-04-06');
    expect(fullOutput).toContain('completed');
    expect(fullOutput).toContain('12');
    expect(fullOutput).toContain('$0.42');
    expect(fullOutput).toContain('45s');
  });

  it('outputs parseable JSON with --json', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(runsDir, '2026-04-06-role', {
      startedAt: '2026-04-06T10:00:00Z',
      roleName: 'Test Role',
    });

    const { output, restore } = captureConsole();
    try {
      await runsCommand(['--json', '--runs-dir', runsDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    const parsed = JSON.parse(fullOutput);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].meta.roleName).toBe('Test Role');
  });

  it('clean --older-than 0d --yes deletes runs', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(runsDir, '2026-04-01-old-run', {
      startedAt: '2026-04-01T10:00:00Z',
      roleName: 'Old Run',
    });

    const { output, restore } = captureConsole();
    try {
      await runsCommand(['clean', '--older-than', '0d', '--yes', '--runs-dir', runsDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Deleted');

    // Verify the run directory is gone
    const remaining = await listAllRuns(runsDir);
    expect(remaining).toHaveLength(0);
  });

  it('clean --older-than 999d with recent runs says nothing to clean', async () => {
    const runsDir = join(testDir, 'runs');
    await createRun(runsDir, '2026-04-06-recent', {
      startedAt: new Date().toISOString(),
      roleName: 'Recent Run',
    });

    const { output, restore } = captureConsole();
    try {
      await runsCommand(['clean', '--older-than', '999d', '--runs-dir', runsDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('No runs older than 999d');
  });

  it('prints "No runs found." when empty', async () => {
    const runsDir = join(testDir, 'runs');
    await mkdir(runsDir, { recursive: true });

    const { output, restore } = captureConsole();
    try {
      await runsCommand(['--runs-dir', runsDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('No runs found.');
  });

  it('shows help with --help', async () => {
    const { output, restore } = captureConsole();
    try {
      await runsCommand(['--help']);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Usage: sourcerer runs');
    expect(fullOutput).toContain('--older-than');
    expect(fullOutput).toContain('--json');
  });
});
