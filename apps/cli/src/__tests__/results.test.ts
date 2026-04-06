import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RunMeta, ScoredCandidate } from '@sourcerer/core';
import { generateEvidenceId } from '@sourcerer/core';
import type { EvidenceItem, Score, ExtractedSignals } from '@sourcerer/core';

let testDir: string;
let runsDir: string;
let runDir: string;

// --- Test Factories (matching output-json pattern) ---

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

function makeScore(evidence: EvidenceItem[], total = 78): Score {
  return {
    total,
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
  total = 78,
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
    score: makeScore(evidence, total),
    narrative: `${name} is a strong candidate with relevant experience.`,
    tier,
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

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

async function setupRunDirectory(
  candidates: ScoredCandidate[],
  meta?: Partial<RunMeta>,
): Promise<void> {
  runsDir = join(testDir, 'runs');
  runDir = join(runsDir, '2026-04-06-senior-backend-engineer');
  await mkdir(runDir, { recursive: true });

  const envelope = {
    version: 1,
    generatedAt: '2026-04-06T10:00:00Z',
    candidateCount: candidates.length,
    candidates,
  };
  await writeFile(join(runDir, 'candidates.json'), JSON.stringify(envelope), 'utf-8');
  await writeFile(
    join(runDir, 'run-meta.json'),
    JSON.stringify(makeRunMeta({ candidateCount: candidates.length, ...meta })),
    'utf-8',
  );
}

// Capture console.log output
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

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-results-test-'));
  // Reset process.exitCode
  process.exitCode = undefined;
});

afterEach(async () => {
  process.exitCode = undefined;
  await rm(testDir, { recursive: true, force: true });
});

// We need to dynamically import resultsCommand so we can control the working directory
// Since findLatestRunDir defaults to 'runs/' in CWD, we pass --run explicitly

describe('resultsCommand', () => {
  it('shows tier 1 candidates only with --tier 1', async () => {
    const candidates = [
      makeScoredCandidate('c1', 'Alice', 1, 90),
      makeScoredCandidate('c2', 'Bob', 2, 70),
      makeScoredCandidate('c3', 'Carol', 1, 85),
      makeScoredCandidate('c4', 'Dave', 3, 40),
    ];
    await setupRunDirectory(candidates);

    const { resultsCommand } = await import('../commands/results.js');
    const { output, restore } = captureConsole();
    try {
      await resultsCommand(['--run', runDir, '--tier', '1']);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Alice');
    expect(fullOutput).toContain('Carol');
    expect(fullOutput).not.toContain('Bob');
    expect(fullOutput).not.toContain('Dave');
  });

  it('shows error when no runs found', async () => {
    const emptyRunsDir = join(testDir, 'no-runs-here');

    const { resultsCommand } = await import('../commands/results.js');
    const { output, restore } = captureConsole();
    try {
      await resultsCommand(['--run', emptyRunsDir]);
    } finally {
      restore();
    }

    // --run provides a specific dir, but it has no run-meta.json, so it errors
    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Failed to load');
  });

  it('candidates appear sorted by score descending', async () => {
    const candidates = [
      makeScoredCandidate('c1', 'LowScore', 2, 50),
      makeScoredCandidate('c2', 'HighScore', 1, 95),
      makeScoredCandidate('c3', 'MidScore', 2, 75),
    ];
    await setupRunDirectory(candidates);

    const { resultsCommand } = await import('../commands/results.js');
    const { output, restore } = captureConsole();
    try {
      await resultsCommand(['--run', runDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    const highIdx = fullOutput.indexOf('HighScore');
    const midIdx = fullOutput.indexOf('MidScore');
    const lowIdx = fullOutput.indexOf('LowScore');
    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  it('--json outputs parseable JSON', async () => {
    const candidates = [
      makeScoredCandidate('c1', 'Alice', 1, 90),
    ];
    await setupRunDirectory(candidates);

    const { resultsCommand } = await import('../commands/results.js');
    const { output, restore } = captureConsole();
    try {
      await resultsCommand(['--run', runDir, '--json']);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    const parsed = JSON.parse(fullOutput);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Alice');
  });

  it('shows help with --help', async () => {
    const { resultsCommand } = await import('../commands/results.js');
    const { output, restore } = captureConsole();
    try {
      await resultsCommand(['--help']);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Usage: sourcerer results');
    expect(fullOutput).toContain('--tier');
    expect(fullOutput).toContain('--push');
    expect(fullOutput).toContain('--json');
  });

  it('rejects invalid tier value', async () => {
    const candidates = [makeScoredCandidate('c1', 'Alice', 1, 90)];
    await setupRunDirectory(candidates);

    const { resultsCommand } = await import('../commands/results.js');
    const { output, restore } = captureConsole();
    try {
      await resultsCommand(['--run', runDir, '--tier', '5']);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Invalid tier: must be 1, 2, or 3');
    expect(process.exitCode).toBe(1);
  });

  it('rejects unknown adapter in --push', async () => {
    const candidates = [makeScoredCandidate('c1', 'Alice', 1, 90)];
    await setupRunDirectory(candidates);

    const { resultsCommand } = await import('../commands/results.js');
    const { output, restore } = captureConsole();
    try {
      await resultsCommand(['--run', runDir, '--push', 'nonexistent']);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Unknown output adapter: nonexistent');
    expect(process.exitCode).toBe(1);
  });

  it('displays summary header with run metadata', async () => {
    const candidates = [
      makeScoredCandidate('c1', 'Alice', 1, 90),
      makeScoredCandidate('c2', 'Bob', 2, 70),
    ];
    await setupRunDirectory(candidates);

    const { resultsCommand } = await import('../commands/results.js');
    const { output, restore } = captureConsole();
    try {
      await resultsCommand(['--run', runDir]);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('Senior Backend Engineer');
    expect(fullOutput).toContain('2026-04-06');
    expect(fullOutput).toContain('2 candidates');
  });
});
