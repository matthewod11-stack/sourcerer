import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  AIProvider,
  Candidate,
  Checkpoint,
  ExtractedSignals,
  RunMeta,
  SearchConfig,
  StructuredOutputOptions,
  StructuredOutputResult,
  TalentProfile,
  TokenUsage,
} from '@sourcerer/core';
import { parseReplayArgs, replayRun } from '../commands/replay.js';
import { loadCandidates, type RunSummary } from '../run-loader.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-replay-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

const searchConfig: SearchConfig = {
  roleName: 'Senior Backend Engineer',
  tiers: [],
  scoringWeights: {
    technicalDepth: 0.3,
    domainRelevance: 0.25,
    trajectoryMatch: 0.2,
    cultureFit: 0.15,
    reachability: 0.1,
  },
  tierThresholds: { tier1MinScore: 70, tier2MinScore: 40 },
  enrichmentPriority: [],
  antiFilters: [],
  createdAt: '2026-05-01T00:00:00.000Z',
  version: 1,
};

const talentProfile: TalentProfile = {
  role: {
    title: 'Senior Backend Engineer',
    level: 'Senior',
    scope: 'Backend systems',
    mustHaveSkills: ['TypeScript'],
    niceToHaveSkills: [],
  },
  company: {
    name: 'Acme',
    url: 'https://example.com',
    techStack: ['Node.js'],
    cultureSignals: [],
    analyzedAt: '2026-05-01T00:00:00.000Z',
  },
  successPatterns: {
    careerTrajectories: [],
    skillSignatures: [],
    seniorityCalibration: '',
    cultureSignals: [],
  },
  antiPatterns: [],
  competitorMap: {
    targetCompanies: [],
    avoidCompanies: [],
    competitorReason: {},
  },
  createdAt: '2026-05-01T00:00:00.000Z',
};

function makeCandidate(id: string): Candidate {
  return {
    id,
    identity: {
      canonicalId: id,
      observedIdentifiers: [],
      mergeConfidence: 1,
    },
    name: 'Ada Lovelace',
    sources: {},
    enrichments: {},
    evidence: [
      {
        id: 'ev-aaa001',
        claim: 'Built reliable TypeScript services.',
        source: 'fixture',
        adapter: 'test',
        retrievedAt: '2026-05-01T00:00:00.000Z',
        confidence: 'high',
        url: 'https://example.com/ada',
      },
    ],
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

function makeRunMeta(runDir: string): RunMeta {
  return {
    runId: 'source-run',
    roleName: 'Senior Backend Engineer',
    runDir,
    startedAt: '2026-05-01T00:00:00.000Z',
    completedAt: '2026-05-01T00:01:00.000Z',
    totalDurationMs: 60_000,
    status: 'completed',
    phases: [],
    lastCompletedPhase: 'output',
    cost: {
      totalCost: 0.5,
      perPhase: { score: 0.1 },
      perAdapter: {},
      currency: 'USD',
    },
    candidateCount: 1,
    version: 1,
  };
}

async function createSourceRun(options?: {
  withCheckpoint?: boolean;
}): Promise<RunSummary> {
  const runsDir = join(testDir, 'runs');
  const runDir = join(runsDir, '2026-05-01-senior-backend-engineer');
  await mkdir(runDir, { recursive: true });

  const meta = makeRunMeta(runDir);
  await writeFile(join(runDir, 'run-meta.json'), JSON.stringify(meta), 'utf-8');
  await writeFile(
    join(runDir, 'candidates.json'),
    JSON.stringify({
      version: 1,
      generatedAt: '2026-05-01T00:01:00.000Z',
      candidateCount: 1,
      candidates: [makeCandidate('candidate-1')],
    }),
    'utf-8',
  );

  if (options?.withCheckpoint !== false) {
    const checkpoint: Checkpoint = {
      runId: meta.runId,
      runDir,
      lastCompletedPhase: 'output',
      phaseOutputs: {
        intake: {
          searchConfig,
          talentProfile,
          similaritySeeds: [],
        },
      },
      runMeta: meta,
      createdAt: '2026-05-01T00:01:00.000Z',
      version: 1,
    };
    await writeFile(
      join(runDir, 'checkpoint.json'),
      JSON.stringify(checkpoint),
      'utf-8',
    );
  }

  return {
    runDir,
    dirName: '2026-05-01-senior-backend-engineer',
    meta,
  };
}

class FakeProvider implements AIProvider {
  readonly name = 'fake';
  calls = 0;

  async chat(): Promise<{ content: string; usage: TokenUsage }> {
    this.calls++;
    return {
      content: 'Replay-generated narrative.',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedTokens: 0,
        model: 'gpt-4o',
      },
    };
  }

  async structuredOutput<T>(
    _messages: unknown,
    _options: StructuredOutputOptions,
  ): Promise<StructuredOutputResult<T>> {
    this.calls++;
    const signals: ExtractedSignals = {
      technicalDepth: {
        score: 90,
        evidenceIds: ['ev-aaa001'],
        confidence: 1,
      },
      domainRelevance: {
        score: 80,
        evidenceIds: ['ev-aaa001'],
        confidence: 1,
      },
      trajectoryMatch: {
        score: 70,
        evidenceIds: ['ev-aaa001'],
        confidence: 1,
      },
      cultureFit: {
        score: 60,
        evidenceIds: ['ev-aaa001'],
        confidence: 1,
      },
      reachability: {
        score: 50,
        evidenceIds: ['ev-aaa001'],
        confidence: 1,
      },
      redFlags: [],
    };
    return {
      data: signals as T,
      usage: {
        inputTokens: 200,
        outputTokens: 50,
        cachedTokens: 0,
        model: 'gpt-4o',
      },
    };
  }
}

describe('parseReplayArgs', () => {
  it('parses run id and replay options', () => {
    expect(
      parseReplayArgs([
        'run-1',
        '--runs-dir',
        '/tmp/runs',
        '--prompt-version',
        'v3',
        '--no-cache',
        '--quiet',
      ]),
    ).toEqual({
      runId: 'run-1',
      runsDir: '/tmp/runs',
      promptVersion: 'v3',
      noCache: true,
      quiet: true,
      jsonLogs: false,
      help: false,
    });
  });
});

describe('replayRun', () => {
  it('creates a new run directory and writes re-scored candidates', async () => {
    const sourceRun = await createSourceRun();
    const provider = new FakeProvider();

    const meta = await replayRun({
      sourceRun,
      runsDir: join(testDir, 'runs'),
      provider,
      quiet: true,
    });

    expect(meta.runDir).not.toBe(sourceRun.runDir);
    expect(meta.status).toBe('completed');
    expect(meta.lastCompletedPhase).toBe('output');
    expect(meta.candidateCount).toBe(1);
    expect(meta.phases.map((phase) => phase.phase)).toEqual([
      'score',
      'output',
    ]);
    expect(provider.calls).toBe(2);

    const replayed = await loadCandidates(meta.runDir);
    expect(replayed).toHaveLength(1);
    expect(replayed[0].narrative).toBe('Replay-generated narrative.');
    expect(replayed[0].score.promptVersions).toEqual({
      'scoring-signal-extract': 2,
      'scoring-narrative': 2,
    });

    const checkpoint = JSON.parse(
      await readFile(join(meta.runDir, 'checkpoint.json'), 'utf-8'),
    ) as Checkpoint;
    expect(checkpoint.lastCompletedPhase).toBe('output');
  });

  it('fails when the source run has no replayable checkpoint', async () => {
    const sourceRun = await createSourceRun({ withCheckpoint: false });

    await expect(
      replayRun({
        sourceRun,
        runsDir: join(testDir, 'runs'),
        provider: new FakeProvider(),
        quiet: true,
      }),
    ).rejects.toThrow(/checkpoint is missing intake search config/);
  });
});
