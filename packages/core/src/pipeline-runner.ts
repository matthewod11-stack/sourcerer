// Pipeline runner — phase-based orchestration with checkpoint/resume

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type {
  PipelinePhaseName,
  PipelineHandlers,
  PipelineRunConfig,
  PipelineContext,
  PhaseResult,
  PhaseOutputMap,
  RunMeta,
  PhaseTimingEntry,
  ProgressEvent,
  Checkpoint,
  DiscoverPhaseOutput,
  DedupPhaseOutput,
  PhaseHandler,
} from './pipeline-types.js';
import { PHASE_ORDER } from './pipeline-types.js';
import { saveCheckpoint, loadCheckpoint, createCheckpoint } from './checkpoint.js';
import { createRunDirectory, writeRunMeta } from './run-artifacts.js';
import { CostTracker } from './cost-tracker.js';
import { IdentityResolver } from './identity-resolver.js';

// Map each phase to the previous phase whose output it needs
const PHASE_INPUT_MAP: Record<PipelinePhaseName, PipelinePhaseName | null> = {
  intake: null,
  discover: 'intake',
  dedup: 'discover',
  enrich: 'dedup',
  score: 'enrich',
  output: 'score',
};

export class PipelineRunner {
  private handlers: PipelineHandlers;

  constructor(handlers: PipelineHandlers) {
    this.handlers = handlers;
  }

  async run(config: PipelineRunConfig): Promise<RunMeta> {
    const costTracker = new CostTracker();
    let runId: string;
    let runDir: string;
    let checkpoint: Checkpoint | null = null;
    let phaseOutputs: Partial<PhaseOutputMap> = {};
    let startPhaseIndex = 0;

    // Resume or new run
    if (config.resumeFrom) {
      checkpoint = await loadCheckpoint(config.resumeFrom);
      if (!checkpoint) {
        throw new Error(`No checkpoint found in ${config.resumeFrom}`);
      }
      runId = checkpoint.runId;
      runDir = checkpoint.runDir;
      phaseOutputs = checkpoint.phaseOutputs;
      costTracker.restoreFrom(checkpoint.runMeta.cost);

      // Start after last completed phase
      const lastIdx = PHASE_ORDER.indexOf(checkpoint.lastCompletedPhase);
      startPhaseIndex = lastIdx + 1;
    } else {
      runId = randomUUID();
      const baseDir = config.runsBaseDir ?? join(process.cwd(), 'runs');
      runDir = await createRunDirectory(baseDir, config.roleName);
    }

    // Allow explicit startFromPhase override
    if (config.startFromPhase) {
      const idx = PHASE_ORDER.indexOf(config.startFromPhase);
      if (idx === -1) {
        throw new Error(`Unknown phase: ${config.startFromPhase}`);
      }
      startPhaseIndex = idx;
    }

    // Seed context with pre-provided config/profile
    if (config.searchConfig && !phaseOutputs.intake) {
      phaseOutputs.intake = {
        talentProfile: config.talentProfile!,
        searchConfig: config.searchConfig,
        similaritySeeds: config.searchConfig.similaritySeeds ?? [],
      };
    }

    // Initialize RunMeta
    const runMeta: RunMeta = checkpoint?.runMeta ?? {
      runId,
      roleName: config.roleName,
      runDir,
      startedAt: new Date().toISOString(),
      status: 'running',
      phases: [],
      cost: costTracker.snapshot(),
      version: 1,
    };
    runMeta.status = 'running';

    // Build context
    const context: PipelineContext = {
      runId,
      runDir,
      searchConfig: config.searchConfig ?? phaseOutputs.intake?.searchConfig,
      talentProfile: config.talentProfile ?? phaseOutputs.intake?.talentProfile,
      phaseOutputs,
      costSnapshot: costTracker.snapshot(),
      retentionTtlDays: config.retentionTtlDays,
      onProgress: config.onProgress,
    };

    // Execute phases
    let lastCompletedPhase: PipelinePhaseName | undefined = checkpoint?.lastCompletedPhase;
    let pipelineFailed = false;

    for (let i = startPhaseIndex; i < PHASE_ORDER.length; i++) {
      const phaseName = PHASE_ORDER[i];
      const handler = this.handlers[phaseName];

      if (!handler) {
        this.emitProgress(context, phaseName, 'skipped', `Phase ${phaseName}: no handler, skipping`);
        continue;
      }

      // Resolve input
      const input = this.resolvePhaseInput(phaseName, context);

      // Execute
      this.emitProgress(context, phaseName, 'running', `Phase ${phaseName}: starting`);
      const startTime = Date.now();

      let result: PhaseResult;
      try {
        result = await (handler as PhaseHandler<unknown, unknown>).execute(input, context);
      } catch (err) {
        result = {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const durationMs = Date.now() - startTime;

      // Process result
      const timing: PhaseTimingEntry = {
        phase: phaseName,
        status: result.status,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
        costIncurred: result.costIncurred ?? 0,
        error: result.error,
      };

      if (result.status === 'completed' && result.data) {
        (context.phaseOutputs as Record<string, unknown>)[phaseName] = result.data;
        timing.itemsProcessed = this.countItems(phaseName, result.data);
        lastCompletedPhase = phaseName;
      } else if (result.status === 'partial' && result.partialData) {
        (context.phaseOutputs as Record<string, unknown>)[phaseName] = result.partialData;
        timing.itemsProcessed = this.countItems(phaseName, result.partialData);
        timing.itemsFailed = result.failures?.length ?? 0;
        lastCompletedPhase = phaseName;
      } else if (result.status === 'failed') {
        timing.error = result.error ?? 'Unknown error';
        pipelineFailed = true;
      }

      // Track cost
      if (result.costIncurred) {
        costTracker.recordCost(phaseName, result.costIncurred);
      }

      runMeta.phases.push(timing);
      runMeta.cost = costTracker.snapshot();
      runMeta.lastCompletedPhase = lastCompletedPhase;
      context.costSnapshot = costTracker.snapshot();

      // Save checkpoint and run-meta after each phase
      if (lastCompletedPhase) {
        const cp = createCheckpoint(runId, runDir, lastCompletedPhase, context.phaseOutputs, runMeta);
        await saveCheckpoint(runDir, cp);
      }
      await writeRunMeta(runDir, runMeta);

      this.emitProgress(context, phaseName, result.status, `Phase ${phaseName}: ${result.status}`);

      if (pipelineFailed) break;

      // Budget check
      if (config.maxCostUsd && costTracker.exceedsBudget(config.maxCostUsd)) {
        runMeta.status = 'interrupted';
        runMeta.completedAt = new Date().toISOString();
        runMeta.totalDurationMs = Date.now() - new Date(runMeta.startedAt).getTime();
        await writeRunMeta(runDir, runMeta);
        throw new Error(
          `Budget exceeded: $${costTracker.snapshot().totalCost.toFixed(2)} > $${config.maxCostUsd.toFixed(2)}`,
        );
      }
    }

    // Finalize
    runMeta.status = pipelineFailed ? 'failed' : 'completed';
    runMeta.completedAt = new Date().toISOString();
    runMeta.totalDurationMs = Date.now() - new Date(runMeta.startedAt).getTime();

    // Count final candidates
    const scoreOutput = context.phaseOutputs.score;
    if (scoreOutput) {
      runMeta.candidateCount = scoreOutput.candidates.length;
    } else {
      const dedupOutput = context.phaseOutputs.dedup;
      if (dedupOutput) {
        runMeta.candidateCount = dedupOutput.candidates.length;
      }
    }

    await writeRunMeta(runDir, runMeta);

    return runMeta;
  }

  private resolvePhaseInput(
    phaseName: PipelinePhaseName,
    context: PipelineContext,
  ): unknown {
    const inputPhase = PHASE_INPUT_MAP[phaseName];
    if (inputPhase === null) {
      return context;
    }
    const input = context.phaseOutputs[inputPhase];
    if (!input) {
      throw new Error(
        `Cannot run '${phaseName}' phase: no output from '${inputPhase}' phase. ` +
        `Provide a handler for '${inputPhase}' or resume from a checkpoint that includes it.`,
      );
    }
    return input;
  }

  private countItems(phaseName: PipelinePhaseName, data: unknown): number | undefined {
    const d = data as Record<string, unknown>;
    if ('candidates' in d && Array.isArray(d.candidates)) {
      return d.candidates.length;
    }
    if ('rawCandidates' in d && Array.isArray(d.rawCandidates)) {
      return d.rawCandidates.length;
    }
    return undefined;
  }

  private emitProgress(
    context: PipelineContext,
    phase: PipelinePhaseName,
    status: PhaseTimingEntry['status'],
    message: string,
  ): void {
    context.onProgress?.({
      phase,
      status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}

/** Built-in dedup handler wrapping IdentityResolver */
export function createDedupHandler(): PhaseHandler<DiscoverPhaseOutput, DedupPhaseOutput> {
  const resolver = new IdentityResolver();
  return {
    async execute(input) {
      const resolveResult = resolver.resolve(input.rawCandidates);
      return {
        status: 'completed',
        data: {
          candidates: resolveResult.candidates,
          resolveResult,
        },
      };
    },
  };
}
