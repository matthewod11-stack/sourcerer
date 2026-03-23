import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PipelineRunner, createDedupHandler } from '../pipeline-runner.js';
import { CostTracker } from '../cost-tracker.js';
import {
  generateRunDirName,
  createRunDirectory,
  writeRunMeta,
  writeArtifact,
} from '../run-artifacts.js';
import { saveCheckpoint, loadCheckpoint, createCheckpoint } from '../checkpoint.js';
import type {
  PipelineHandlers,
  PipelineRunConfig,
  PipelineContext,
  PhaseResult,
  IntakePhaseOutput,
  DiscoverPhaseOutput,
  DedupPhaseOutput,
  EnrichPhaseOutput,
  ScorePhaseOutput,
  OutputPhaseOutput,
  RunMeta,
  ProgressEvent,
} from '../pipeline-types.js';
import type { RawCandidate, ScoredCandidate } from '../candidate.js';
import type { ObservedIdentifier } from '../identity.js';

// --- Helpers ---

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'sourcerer-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const now = '2026-03-23T12:00:00Z';

function makeRawCandidate(name: string, adapter: string, email: string): RawCandidate {
  return {
    name,
    identifiers: [
      { type: 'email', value: email, source: adapter, observedAt: now, confidence: 'high' } as ObservedIdentifier,
    ],
    sourceData: { adapter, retrievedAt: now, urls: [] },
    evidence: [],
    piiFields: [],
  };
}

function makeMockIntakeOutput(): IntakePhaseOutput {
  return {
    talentProfile: {
      role: {
        title: 'Senior Backend Engineer',
        level: 'senior',
        scope: 'Backend infra',
        mustHaveSkills: ['Go'],
        niceToHaveSkills: [],
      },
      company: {
        name: 'TestCo',
        url: 'https://testco.com',
        techStack: ['Go'],
        cultureSignals: [],
        analyzedAt: now,
      },
      successPatterns: {
        careerTrajectories: [],
        skillSignatures: ['Go'],
        seniorityCalibration: 'senior',
        cultureSignals: [],
      },
      antiPatterns: [],
      competitorMap: {
        targetCompanies: [],
        avoidCompanies: [],
        competitorReason: {},
      },
      createdAt: now,
    },
    searchConfig: {
      roleName: 'Senior Backend Engineer',
      tiers: [{ priority: 1, queries: [{ text: 'senior backend engineer' }] }],
      scoringWeights: { technicalDepth: 0.5, domainRelevance: 0.5 },
      tierThresholds: { tier1MinScore: 70, tier2MinScore: 40 },
      enrichmentPriority: [],
      antiFilters: [],
      createdAt: now,
      version: 1,
    },
    similaritySeeds: [],
  };
}

function makeMockDiscoverOutput(): DiscoverPhaseOutput {
  return {
    rawCandidates: [
      makeRawCandidate('Sarah Chen', 'exa', 'sarah@test.com'),
      makeRawCandidate('John Smith', 'exa', 'john@test.com'),
    ],
    costIncurred: 1.50,
  };
}

function makeSimpleHandlers(): PipelineHandlers {
  const intake = makeMockIntakeOutput();
  const discover = makeMockDiscoverOutput();
  return {
    intake: {
      async execute() {
        return { status: 'completed', data: intake };
      },
    },
    discover: {
      async execute() {
        return { status: 'completed', data: discover, costIncurred: 1.50 };
      },
    },
    dedup: createDedupHandler(),
    enrich: {
      async execute(input: DedupPhaseOutput) {
        return {
          status: 'completed',
          data: { candidates: input.candidates, costIncurred: 0.50 },
          costIncurred: 0.50,
        };
      },
    },
    score: {
      async execute(input: EnrichPhaseOutput) {
        const scored: ScoredCandidate[] = input.candidates.map((c) => ({
          ...c,
          signals: {
            technicalDepth: { score: 8, evidenceIds: [], confidence: 0.9 },
            domainRelevance: { score: 7, evidenceIds: [], confidence: 0.8 },
            trajectoryMatch: { score: 6, evidenceIds: [], confidence: 0.7 },
            cultureFit: { score: 5, evidenceIds: [], confidence: 0.6 },
            reachability: { score: 4, evidenceIds: [], confidence: 0.5 },
            redFlags: [],
          },
          score: { total: 75, breakdown: [], weights: {}, redFlags: [] },
          narrative: 'Test narrative.',
          tier: 1 as const,
        }));
        return { status: 'completed', data: { candidates: scored, costIncurred: 0.25 }, costIncurred: 0.25 };
      },
    },
    output: {
      async execute() {
        return {
          status: 'completed',
          data: { outputLocations: { json: 'candidates.json' }, candidatesPushed: 2 },
        };
      },
    },
  };
}

// --- CostTracker Tests ---

describe('CostTracker', () => {
  it('accumulates per-phase costs', () => {
    const tracker = new CostTracker();
    tracker.recordCost('discover', 1.50);
    tracker.recordCost('enrich', 0.50);
    const snap = tracker.snapshot();
    expect(snap.totalCost).toBe(2.00);
    expect(snap.perPhase.discover).toBe(1.50);
    expect(snap.perPhase.enrich).toBe(0.50);
  });

  it('accumulates per-adapter costs', () => {
    const tracker = new CostTracker();
    tracker.recordCost('discover', 1.00, 'exa');
    tracker.recordCost('enrich', 0.30, 'github');
    tracker.recordCost('enrich', 0.20, 'hunter');
    const snap = tracker.snapshot();
    expect(snap.perAdapter.exa).toBe(1.00);
    expect(snap.perAdapter.github).toBe(0.30);
    expect(snap.perAdapter.hunter).toBe(0.20);
  });

  it('detects budget exceeded', () => {
    const tracker = new CostTracker();
    tracker.recordCost('discover', 4.00);
    expect(tracker.exceedsBudget(5.00)).toBe(false);
    tracker.recordCost('enrich', 2.00);
    expect(tracker.exceedsBudget(5.00)).toBe(true);
  });

  it('restores from snapshot', () => {
    const tracker = new CostTracker();
    tracker.restoreFrom({
      totalCost: 3.00,
      perPhase: { discover: 2.00, enrich: 1.00 },
      perAdapter: { exa: 2.00 },
      currency: 'USD',
    });
    expect(tracker.snapshot().totalCost).toBe(3.00);
    tracker.recordCost('score', 0.50);
    expect(tracker.snapshot().totalCost).toBe(3.50);
  });
});

// --- Run Artifacts Tests ---

describe('Run Artifacts', () => {
  it('generates run dir name in correct format', () => {
    const name = generateRunDirName('Senior Backend Engineer', new Date('2026-03-23'));
    expect(name).toBe('2026-03-23-senior-backend-engineer');
  });

  it('sanitizes special characters in role name', () => {
    const name = generateRunDirName('VP of Eng @ StartupCo!!!');
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-vp-of-eng-startupco$/);
  });

  it('creates run directory with evidence subdirectory', async () => {
    const runDir = await createRunDirectory(tmpDir, 'Test Role');
    const contents = await readdir(runDir);
    expect(contents).toContain('evidence');
  });

  it('deduplicates directory names', async () => {
    const dir1 = await createRunDirectory(tmpDir, 'Same Role');
    const dir2 = await createRunDirectory(tmpDir, 'Same Role');
    expect(dir1).not.toBe(dir2);
    expect(dir2).toMatch(/-2$/);
  });

  it('writes run-meta.json', async () => {
    const runDir = await createRunDirectory(tmpDir, 'Test');
    const meta: RunMeta = {
      runId: 'test-id',
      roleName: 'Test',
      runDir,
      startedAt: now,
      status: 'running',
      phases: [],
      cost: { totalCost: 0, perPhase: {}, perAdapter: {}, currency: 'USD' },
      version: 1,
    };
    await writeRunMeta(runDir, meta);
    const content = JSON.parse(await readFile(join(runDir, 'run-meta.json'), 'utf-8'));
    expect(content.runId).toBe('test-id');
  });

  it('writes artifact files', async () => {
    const runDir = await createRunDirectory(tmpDir, 'Test');
    await writeArtifact(runDir, 'candidates.json', '[]');
    const content = await readFile(join(runDir, 'candidates.json'), 'utf-8');
    expect(content).toBe('[]');
  });
});

// --- Checkpoint Tests ---

describe('Checkpoint', () => {
  it('saves and loads checkpoint', async () => {
    const runDir = await createRunDirectory(tmpDir, 'Test');
    const meta: RunMeta = {
      runId: 'test-id',
      roleName: 'Test',
      runDir,
      startedAt: now,
      status: 'running',
      phases: [],
      cost: { totalCost: 0, perPhase: {}, perAdapter: {}, currency: 'USD' },
      version: 1,
    };
    const cp = createCheckpoint('test-id', runDir, 'discover', {}, meta);
    await saveCheckpoint(runDir, cp);

    const loaded = await loadCheckpoint(runDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe('test-id');
    expect(loaded!.lastCompletedPhase).toBe('discover');
    expect(loaded!.version).toBe(1);
  });

  it('returns null for missing checkpoint', async () => {
    const loaded = await loadCheckpoint(tmpDir);
    expect(loaded).toBeNull();
  });

  it('checkpoint is valid JSON', async () => {
    const runDir = await createRunDirectory(tmpDir, 'Test');
    const meta: RunMeta = {
      runId: 'cp-test',
      roleName: 'Test',
      runDir,
      startedAt: now,
      status: 'running',
      phases: [],
      cost: { totalCost: 1.50, perPhase: { discover: 1.50 }, perAdapter: { exa: 1.50 }, currency: 'USD' },
      version: 1,
    };
    const cp = createCheckpoint('cp-test', runDir, 'dedup', {}, meta);
    await saveCheckpoint(runDir, cp);

    const raw = await readFile(join(runDir, 'checkpoint.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.lastCompletedPhase).toBe('dedup');
  });
});

// --- Pipeline Runner Tests ---

describe('PipelineRunner', () => {
  describe('Phase sequencing', () => {
    it('executes all phases in order with handlers', async () => {
      const phases: string[] = [];
      const handlers: PipelineHandlers = {
        intake: {
          async execute() {
            phases.push('intake');
            return { status: 'completed', data: makeMockIntakeOutput() };
          },
        },
        discover: {
          async execute() {
            phases.push('discover');
            return { status: 'completed', data: makeMockDiscoverOutput() };
          },
        },
        dedup: {
          async execute(input: DiscoverPhaseOutput) {
            phases.push('dedup');
            return { status: 'completed', data: { candidates: [], resolveResult: { candidates: [], mergeLog: [], pendingMerges: [], stats: { inputCount: 0, outputCount: 0, highConfidenceMerges: 0, mediumConfidenceMerges: 0, lowConfidenceSkipped: 0 } } } };
          },
        },
      };

      const runner = new PipelineRunner(handlers);
      const meta = await runner.run({ roleName: 'Test', runsBaseDir: tmpDir });

      expect(phases).toEqual(['intake', 'discover', 'dedup']);
      expect(meta.status).toBe('completed');
    });

    it('skips phases without handlers', async () => {
      const intakeOutput = makeMockIntakeOutput();
      const handlers: PipelineHandlers = {
        intake: {
          async execute() {
            return { status: 'completed', data: intakeOutput };
          },
        },
        // discover, dedup, enrich, score, output all missing
      };

      const runner = new PipelineRunner(handlers);
      const meta = await runner.run({ roleName: 'Test', runsBaseDir: tmpDir });
      expect(meta.status).toBe('completed');
      expect(meta.phases).toHaveLength(1);
    });

    it('starts from explicit startFromPhase', async () => {
      const handlers = makeSimpleHandlers();
      const runner = new PipelineRunner(handlers);

      // Provide intake output to skip intake
      const meta = await runner.run({
        roleName: 'Test',
        runsBaseDir: tmpDir,
        searchConfig: makeMockIntakeOutput().searchConfig,
        talentProfile: makeMockIntakeOutput().talentProfile,
        startFromPhase: 'discover',
      });

      // Should not have run intake
      const phaseNames = meta.phases.map((p) => p.phase);
      expect(phaseNames).not.toContain('intake');
      expect(phaseNames).toContain('discover');
    });

    it('emits progress events', async () => {
      const events: ProgressEvent[] = [];
      const handlers: PipelineHandlers = {
        intake: {
          async execute() {
            return { status: 'completed', data: makeMockIntakeOutput() };
          },
        },
      };

      const runner = new PipelineRunner(handlers);
      await runner.run({
        roleName: 'Test',
        runsBaseDir: tmpDir,
        onProgress: (e) => events.push(e),
      });

      expect(events.length).toBeGreaterThanOrEqual(2); // at least running + completed
      expect(events.some((e) => e.status === 'running')).toBe(true);
    });
  });

  describe('Partial failure', () => {
    it('continues with partialData when phase returns partial', async () => {
      const handlers: PipelineHandlers = {
        intake: {
          async execute() {
            return { status: 'completed', data: makeMockIntakeOutput() };
          },
        },
        discover: {
          async execute() {
            return {
              status: 'partial' as const,
              partialData: { rawCandidates: [makeRawCandidate('Sarah', 'exa', 'sarah@test.com')], costIncurred: 1.00 },
              failures: [{ item: 'query-2', error: 'Exa rate limit', retryable: true }],
              costIncurred: 1.00,
            };
          },
        },
        dedup: createDedupHandler(),
      };

      const runner = new PipelineRunner(handlers);
      const meta = await runner.run({ roleName: 'Test', runsBaseDir: tmpDir });

      expect(meta.status).toBe('completed');
      const discoverPhase = meta.phases.find((p) => p.phase === 'discover');
      expect(discoverPhase?.status).toBe('partial');
      expect(discoverPhase?.itemsFailed).toBe(1);

      // Dedup still ran on the partial data
      const dedupPhase = meta.phases.find((p) => p.phase === 'dedup');
      expect(dedupPhase?.status).toBe('completed');
    });

    it('stops pipeline on failed phase', async () => {
      const handlers: PipelineHandlers = {
        intake: {
          async execute() {
            return { status: 'completed', data: makeMockIntakeOutput() };
          },
        },
        discover: {
          async execute() {
            return { status: 'failed', error: 'All adapters failed' };
          },
        },
        dedup: createDedupHandler(),
      };

      const runner = new PipelineRunner(handlers);
      const meta = await runner.run({ roleName: 'Test', runsBaseDir: tmpDir });

      expect(meta.status).toBe('failed');
      const phaseNames = meta.phases.map((p) => p.phase);
      expect(phaseNames).toContain('discover');
      expect(phaseNames).not.toContain('dedup'); // should not have reached dedup
    });
  });

  describe('Checkpoint and resume', () => {
    it('writes checkpoint after each completed phase', async () => {
      const handlers: PipelineHandlers = {
        intake: {
          async execute() {
            return { status: 'completed', data: makeMockIntakeOutput() };
          },
        },
        discover: {
          async execute() {
            return { status: 'completed', data: makeMockDiscoverOutput() };
          },
        },
      };

      const runner = new PipelineRunner(handlers);
      const meta = await runner.run({ roleName: 'Test', runsBaseDir: tmpDir });

      const cp = await loadCheckpoint(meta.runDir);
      expect(cp).not.toBeNull();
      expect(cp!.lastCompletedPhase).toBe('discover');
    });

    it('resumes from checkpoint at the next phase', async () => {
      // First run: intake + discover
      const firstHandlers: PipelineHandlers = {
        intake: {
          async execute() {
            return { status: 'completed', data: makeMockIntakeOutput() };
          },
        },
        discover: {
          async execute() {
            return { status: 'completed', data: makeMockDiscoverOutput() };
          },
        },
      };

      const runner1 = new PipelineRunner(firstHandlers);
      const meta1 = await runner1.run({ roleName: 'Test', runsBaseDir: tmpDir });

      // Second run: resume with dedup handler added
      const phases: string[] = [];
      const resumeHandlers: PipelineHandlers = {
        intake: {
          async execute() {
            phases.push('intake');
            return { status: 'completed', data: makeMockIntakeOutput() };
          },
        },
        discover: {
          async execute() {
            phases.push('discover');
            return { status: 'completed', data: makeMockDiscoverOutput() };
          },
        },
        dedup: {
          async execute(input: DiscoverPhaseOutput) {
            phases.push('dedup');
            return {
              status: 'completed',
              data: {
                candidates: [],
                resolveResult: {
                  candidates: [], mergeLog: [], pendingMerges: [],
                  stats: { inputCount: 0, outputCount: 0, highConfidenceMerges: 0, mediumConfidenceMerges: 0, lowConfidenceSkipped: 0 },
                },
              },
            };
          },
        },
      };

      const runner2 = new PipelineRunner(resumeHandlers);
      const meta2 = await runner2.run({
        roleName: 'Test',
        runsBaseDir: tmpDir,
        resumeFrom: meta1.runDir,
      });

      // Should NOT have re-run intake or discover
      expect(phases).toEqual(['dedup']);
      expect(meta2.status).toBe('completed');
    });
  });

  describe('Cost tracking', () => {
    it('tracks costs in run-meta.json', async () => {
      const handlers: PipelineHandlers = {
        intake: {
          async execute() {
            return { status: 'completed', data: makeMockIntakeOutput() };
          },
        },
        discover: {
          async execute() {
            return { status: 'completed', data: makeMockDiscoverOutput(), costIncurred: 2.50 };
          },
        },
      };

      const runner = new PipelineRunner(handlers);
      const meta = await runner.run({ roleName: 'Test', runsBaseDir: tmpDir });

      expect(meta.cost.totalCost).toBe(2.50);
      expect(meta.cost.perPhase.discover).toBe(2.50);
    });

    it('aborts when budget exceeded', async () => {
      const handlers: PipelineHandlers = {
        intake: {
          async execute() {
            return { status: 'completed', data: makeMockIntakeOutput() };
          },
        },
        discover: {
          async execute() {
            return { status: 'completed', data: makeMockDiscoverOutput(), costIncurred: 10.00 };
          },
        },
        dedup: createDedupHandler(),
      };

      const runner = new PipelineRunner(handlers);
      await expect(
        runner.run({ roleName: 'Test', runsBaseDir: tmpDir, maxCostUsd: 5.00 }),
      ).rejects.toThrow('Budget exceeded');
    });
  });

  describe('Dedup handler integration', () => {
    it('createDedupHandler wires IdentityResolver correctly', async () => {
      const handler = createDedupHandler();
      const input: DiscoverPhaseOutput = {
        rawCandidates: [
          makeRawCandidate('Sarah Chen', 'exa', 'sarah@test.com'),
          makeRawCandidate('Sarah Chen', 'github', 'sarah@test.com'),
        ],
        costIncurred: 0,
      };

      const result = await handler.execute(input, {} as PipelineContext);
      expect(result.status).toBe('completed');
      expect(result.data!.candidates).toHaveLength(1); // merged
      expect(result.data!.resolveResult.stats.inputCount).toBe(2);
    });

    it('handles empty candidate list', async () => {
      const handler = createDedupHandler();
      const result = await handler.execute(
        { rawCandidates: [], costIncurred: 0 },
        {} as PipelineContext,
      );
      expect(result.status).toBe('completed');
      expect(result.data!.candidates).toHaveLength(0);
    });
  });

  describe('End-to-end with full mock pipeline', () => {
    it('produces correct run-meta.json for a complete run', async () => {
      const runner = new PipelineRunner(makeSimpleHandlers());
      const meta = await runner.run({ roleName: 'Senior Backend Engineer', runsBaseDir: tmpDir });

      expect(meta.status).toBe('completed');
      expect(meta.roleName).toBe('Senior Backend Engineer');
      expect(meta.phases.length).toBeGreaterThanOrEqual(5);
      expect(meta.completedAt).toBeDefined();
      expect(meta.totalDurationMs).toBeDefined();
      expect(meta.cost.totalCost).toBeGreaterThan(0);

      // Verify run-meta.json was written
      const raw = await readFile(join(meta.runDir, 'run-meta.json'), 'utf-8');
      const persisted = JSON.parse(raw) as RunMeta;
      expect(persisted.status).toBe('completed');
      expect(persisted.version).toBe(1);
    });
  });
});
