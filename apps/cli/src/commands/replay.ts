// sourcerer replay - re-score a saved run without re-running discovery/enrichment

import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import {
  createCheckpoint,
  createJsonLogger,
  createRunDirectory,
  loadCheckpoint,
  saveCheckpoint,
  writeRunMeta,
  type AIProvider,
  type Candidate,
  type CostSnapshot,
  type IntakePhaseOutput,
  type OutputAdapter,
  type PhaseResult,
  type PhaseTimingEntry,
  type PipelineContext,
  type RunMeta,
} from '@sourcerer/core';
import { createAIProvider } from '@sourcerer/ai';
import { resolveOutputAdapter } from '../adapter-registry.js';
import { loadConfigFromDisk, configFileExists } from '../config-io.js';
import { createOutputHandler, createScoreHandler } from '../handlers.js';
import { listAllRuns, loadCandidates, type RunSummary } from '../run-loader.js';

interface ParsedReplayArgs {
  runId?: string;
  runsDir?: string;
  promptVersion?: string;
  noCache: boolean;
  quiet: boolean;
  jsonLogs: boolean;
  help: boolean;
}

export interface ReplayRunOptions {
  sourceRun: RunSummary;
  runsDir?: string;
  provider: AIProvider;
  outputAdapters?: OutputAdapter[];
  promptVersion?: string;
  quiet?: boolean;
  jsonLogs?: boolean;
}

export function parseReplayArgs(args: string[]): ParsedReplayArgs {
  let runId: string | undefined;
  let runsDir: string | undefined;
  let promptVersion: string | undefined;
  let noCache = false;
  let quiet = false;
  let jsonLogs = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runs-dir' && args[i + 1]) {
      runsDir = args[++i];
    } else if (args[i] === '--prompt-version' && args[i + 1]) {
      promptVersion = args[++i];
    } else if (args[i] === '--no-cache') {
      noCache = true;
    } else if (args[i] === '--quiet' || args[i] === '-q') {
      quiet = true;
    } else if (args[i] === '--json-logs') {
      jsonLogs = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      help = true;
    } else if (!args[i].startsWith('--') && !runId) {
      runId = args[i];
    }
  }

  return { runId, runsDir, promptVersion, noCache, quiet, jsonLogs, help };
}

function printUsage(): void {
  console.log('Usage: sourcerer replay <run-id-or-dir> [options]');
  console.log('');
  console.log('Options:');
  console.log(
    '  --prompt-version <v>  Add a scoring cache namespace for prompt iteration',
  );
  console.log('  --runs-dir <path>     Custom runs directory (default: runs)');
  console.log('  --no-cache            Disable AI response caching');
  console.log('  --quiet, -q           Suppress progress output');
  console.log(
    '  --json-logs           Emit structured replay telemetry as JSON lines',
  );
  console.log('  --help, -h            Show this help message');
}

function emptyCost(): CostSnapshot {
  return {
    totalCost: 0,
    perPhase: {},
    perAdapter: {},
    currency: 'USD',
  };
}

function addPhaseCost(cost: CostSnapshot, phase: string, amount: number): void {
  cost.totalCost += amount;
  cost.perPhase[phase] = (cost.perPhase[phase] ?? 0) + amount;
}

function countCandidates(result: PhaseResult<unknown>): number | undefined {
  const data = result.data ?? result.partialData;
  if (
    data &&
    typeof data === 'object' &&
    'candidates' in data &&
    Array.isArray((data as { candidates: unknown }).candidates)
  ) {
    return (data as { candidates: unknown[] }).candidates.length;
  }
  return undefined;
}

async function loadReplayInputs(sourceRun: RunSummary): Promise<{
  intake: IntakePhaseOutput;
  candidates: Candidate[];
}> {
  const checkpoint = await loadCheckpoint(sourceRun.runDir);
  const intake = checkpoint?.phaseOutputs.intake;
  if (
    !intake ||
    typeof intake !== 'object' ||
    !('searchConfig' in intake) ||
    !('talentProfile' in intake)
  ) {
    throw new Error(
      `Run ${sourceRun.dirName} cannot be replayed: checkpoint is missing intake search config and talent profile.`,
    );
  }

  const candidates = await loadCandidates(sourceRun.runDir);
  return {
    intake: intake as IntakePhaseOutput,
    candidates,
  };
}

async function runPhase<TOutput>(
  phase: 'score' | 'output',
  runMeta: RunMeta,
  context: PipelineContext,
  execute: () => Promise<PhaseResult<TOutput>>,
): Promise<PhaseResult<TOutput>> {
  context.onProgress?.({
    phase,
    status: 'running',
    message: `Phase ${phase}: starting`,
    timestamp: new Date().toISOString(),
  });
  context.logger?.info('phase.start', {
    runId: context.runId,
    runDir: context.runDir,
    phase,
    startedAt: new Date().toISOString(),
    totalCostUsd: context.costSnapshot.totalCost,
  });

  const startedAtMs = Date.now();
  let result: PhaseResult<TOutput>;
  try {
    result = await execute();
  } catch (err) {
    result = {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const timing: PhaseTimingEntry = {
    phase,
    status: result.status,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    costIncurred: result.costIncurred ?? 0,
    itemsProcessed: countCandidates(result),
    itemsFailed: result.failures?.length,
    error: result.error,
  };

  if (result.costIncurred) {
    addPhaseCost(runMeta.cost, phase, result.costIncurred);
    context.costSnapshot = runMeta.cost;
    context.logger?.info('cost.incurred', {
      runId: context.runId,
      runDir: context.runDir,
      phase,
      amountUsd: result.costIncurred,
      totalCostUsd: context.costSnapshot.totalCost,
    });
  }

  runMeta.phases.push(timing);
  context.logger?.info('phase.end', {
    runId: context.runId,
    runDir: context.runDir,
    phase,
    status: result.status,
    durationMs: timing.durationMs ?? 0,
    costIncurredUsd: timing.costIncurred,
    totalCostUsd: context.costSnapshot.totalCost,
    itemsProcessed: timing.itemsProcessed ?? 0,
    itemsFailed: timing.itemsFailed ?? 0,
    error: timing.error,
  });
  context.onProgress?.({
    phase,
    status: result.status,
    message: `Phase ${phase}: ${result.status}`,
    timestamp: new Date().toISOString(),
  });

  return result;
}

export async function replayRun(options: ReplayRunOptions): Promise<RunMeta> {
  const { intake, candidates } = await loadReplayInputs(options.sourceRun);
  const defaultJsonAdapter = resolveOutputAdapter('json');
  const outputAdapters =
    options.outputAdapters ?? (defaultJsonAdapter ? [defaultJsonAdapter] : []);

  const runId = randomUUID();
  const roleName = `${intake.searchConfig.roleName} replay`;
  const runDir = await createRunDirectory(options.runsDir ?? 'runs', roleName);
  const startedAt = new Date().toISOString();
  const runMeta: RunMeta = {
    runId,
    roleName,
    runDir,
    startedAt,
    status: 'running',
    phases: [],
    cost: emptyCost(),
    version: 1,
  };

  const logger = options.jsonLogs
    ? createJsonLogger({
        sink: (line) => process.stderr.write(`${line}\n`),
      })
    : undefined;

  const context: PipelineContext = {
    runId,
    runDir,
    searchConfig: intake.searchConfig,
    talentProfile: intake.talentProfile,
    phaseOutputs: {
      intake,
      enrich: { candidates, costIncurred: 0 },
    },
    costSnapshot: runMeta.cost,
    logger,
    onProgress:
      options.quiet || options.jsonLogs
        ? undefined
        : (event) => {
            const icon =
              event.status === 'completed'
                ? chalk.green('done')
                : event.status === 'running'
                  ? chalk.blue('...')
                  : event.status === 'partial'
                    ? chalk.yellow('part')
                    : chalk.red('fail');
            console.log(`  [${icon}] ${event.message}`);
          },
  };

  context.logger?.info('run.start', {
    runId,
    runDir,
    roleName,
    replayFromRunId: options.sourceRun.meta.runId,
    replayFromRunDir: options.sourceRun.runDir,
    promptVersion: options.promptVersion,
  });
  await writeRunMeta(runDir, runMeta);

  const scoreHandler = createScoreHandler(
    intake.searchConfig,
    intake.talentProfile,
    options.provider,
  );
  const scoreResult = await runPhase('score', runMeta, context, () =>
    scoreHandler.execute({ candidates, costIncurred: 0 }, context),
  );

  const scoreOutput = scoreResult.data ?? scoreResult.partialData;
  if (!scoreOutput) {
    runMeta.status = 'failed';
    runMeta.completedAt = new Date().toISOString();
    runMeta.totalDurationMs =
      Date.now() - new Date(runMeta.startedAt).getTime();
    await writeRunMeta(runDir, runMeta);
    return runMeta;
  }

  context.phaseOutputs.score = scoreOutput;
  runMeta.lastCompletedPhase = 'score';
  runMeta.candidateCount = scoreOutput.candidates.length;

  const outputHandler = createOutputHandler(outputAdapters);
  const outputResult = await runPhase('output', runMeta, context, () =>
    outputHandler.execute(scoreOutput, context),
  );

  if (outputResult.data ?? outputResult.partialData) {
    context.phaseOutputs.output = outputResult.data ?? outputResult.partialData;
    runMeta.lastCompletedPhase = 'output';
  }

  runMeta.status =
    outputResult.status === 'failed'
      ? 'failed'
      : scoreResult.status === 'partial' || outputResult.status === 'partial'
        ? 'partial'
        : 'completed';
  runMeta.completedAt = new Date().toISOString();
  runMeta.totalDurationMs = Date.now() - new Date(runMeta.startedAt).getTime();

  const checkpoint = createCheckpoint(
    runId,
    runDir,
    runMeta.lastCompletedPhase ?? 'score',
    context.phaseOutputs,
    runMeta,
  );
  await saveCheckpoint(runDir, checkpoint);
  context.logger?.info('checkpoint.saved', {
    runId,
    runDir,
    phase: runMeta.lastCompletedPhase,
    lastCompletedPhase: runMeta.lastCompletedPhase,
  });
  await writeRunMeta(runDir, runMeta);
  context.logger?.info('run.end', {
    runId,
    runDir,
    status: runMeta.status,
    totalDurationMs: runMeta.totalDurationMs,
    totalCostUsd: runMeta.cost.totalCost,
    candidateCount: runMeta.candidateCount ?? 0,
  });

  return runMeta;
}

export async function replayCommand(args: string[]): Promise<void> {
  const parsed = parseReplayArgs(args);
  if (parsed.help) {
    printUsage();
    return;
  }
  if (!parsed.runId) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const runs = await listAllRuns(parsed.runsDir);
  const sourceRun = runs.find(
    (run) => run.meta.runId === parsed.runId || run.dirName === parsed.runId,
  );
  if (!sourceRun) {
    console.error(chalk.red(`Run not found: ${parsed.runId}`));
    process.exitCode = 1;
    return;
  }

  if (!(await configFileExists())) {
    console.error(chalk.red('No config found. Run `sourcerer init` first.'));
    process.exitCode = 1;
    return;
  }

  const sourcererConfig = await loadConfigFromDisk();
  const provider = createAIProvider(sourcererConfig, {
    noCache: parsed.noCache,
    cacheNamespace: parsed.promptVersion
      ? `scoring-prompt-version:${parsed.promptVersion}`
      : undefined,
  });

  if (!parsed.quiet && !parsed.jsonLogs) {
    console.log(chalk.blue(`Replaying run: ${sourceRun.dirName}`));
    if (parsed.promptVersion) {
      console.log(`  Scoring cache namespace: ${parsed.promptVersion}`);
    }
  }

  try {
    const meta = await replayRun({
      sourceRun,
      runsDir: parsed.runsDir,
      provider,
      promptVersion: parsed.promptVersion,
      quiet: parsed.quiet,
      jsonLogs: parsed.jsonLogs,
    });

    console.log('');
    console.log(chalk.bold('Replay complete'));
    console.log(`  Status: ${meta.status}`);
    console.log(`  Source run: ${sourceRun.dirName}`);
    console.log(`  Candidates: ${meta.candidateCount ?? 0}`);
    console.log(`  Cost: $${meta.cost.totalCost.toFixed(4)}`);
    console.log(`  Duration: ${meta.totalDurationMs ?? 0}ms`);
    console.log(`  Run dir: ${meta.runDir}`);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  }
}
