// Checkpoint — serialize/deserialize pipeline state to disk

import { writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  Checkpoint,
  PipelinePhaseName,
  PhaseOutputMap,
  RunMeta,
} from './pipeline-types.js';

const CHECKPOINT_FILENAME = 'checkpoint.json';

export const CHECKPOINT_VERSION = 1;

const PipelinePhaseNameSchema = z.enum([
  'intake',
  'discover',
  'dedup',
  'enrich',
  'score',
  'output',
]);

const PhaseStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'partial',
]);

const RunStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'partial',
  'interrupted',
]);

const CostSnapshotSchema = z.object({
  totalCost: z.number(),
  perPhase: z.record(z.string(), z.number()),
  perAdapter: z.record(z.string(), z.number()),
  currency: z.literal('USD'),
});

const PhaseTimingEntrySchema = z.object({
  phase: PipelinePhaseNameSchema,
  status: PhaseStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  durationMs: z.number().optional(),
  costIncurred: z.number(),
  itemsProcessed: z.number().optional(),
  itemsFailed: z.number().optional(),
  error: z.string().optional(),
});

const RunMetaSchema = z.object({
  runId: z.string(),
  roleName: z.string(),
  runDir: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  totalDurationMs: z.number().optional(),
  status: RunStatusSchema,
  phases: z.array(PhaseTimingEntrySchema),
  lastCompletedPhase: PipelinePhaseNameSchema.optional(),
  cost: CostSnapshotSchema,
  estimatedCost: z.number().optional(),
  candidateCount: z.number().optional(),
  version: z.literal(CHECKPOINT_VERSION),
});

/**
 * H-6: validates the wrapper of a checkpoint at load time. The nested
 * `phaseOutputs` is left as `z.record(z.unknown())` because each phase has
 * a different output shape and authoring six recursive schemas was out of
 * scope; phase handlers still fail loudly on bad data, but the wrapper
 * (runId, version, runMeta, lastCompletedPhase, etc.) is fully checked.
 */
export const CheckpointSchema = z.object({
  runId: z.string(),
  runDir: z.string(),
  lastCompletedPhase: PipelinePhaseNameSchema,
  phaseOutputs: z.record(z.string(), z.unknown()),
  runMeta: RunMetaSchema,
  createdAt: z.string(),
  version: z.literal(CHECKPOINT_VERSION),
});

export async function saveCheckpoint(
  runDir: string,
  checkpoint: Checkpoint,
): Promise<void> {
  const path = join(runDir, CHECKPOINT_FILENAME);
  await writeFile(path, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

export async function loadCheckpoint(
  runDir: string,
): Promise<Checkpoint | null> {
  const path = join(runDir, CHECKPOINT_FILENAME);
  try {
    await access(path);
  } catch {
    return null;
  }

  const content = await readFile(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `Invalid checkpoint JSON at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Version mismatch gets a tailored upgrade message before generic shape
  // validation, so users see a useful instruction instead of a Zod literal
  // error like "Invalid literal value, expected 1".
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    (parsed as { version: unknown }).version !== CHECKPOINT_VERSION
  ) {
    const seen = (parsed as { version: unknown }).version;
    throw new Error(
      `Incompatible checkpoint version: ${JSON.stringify(seen)}. Expected ${CHECKPOINT_VERSION}. ` +
        `This checkpoint was written by a different version of Sourcerer; restart the run from scratch.`,
    );
  }

  const result = CheckpointSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) =>
        `  ${issue.path.length > 0 ? issue.path.join('.') : '<root>'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Invalid checkpoint at ${path}:\n${issues}`);
  }
  return result.data as Checkpoint;
}

export function createCheckpoint(
  runId: string,
  runDir: string,
  lastCompletedPhase: PipelinePhaseName,
  phaseOutputs: Partial<PhaseOutputMap>,
  runMeta: RunMeta,
): Checkpoint {
  return {
    runId,
    runDir,
    lastCompletedPhase,
    phaseOutputs,
    runMeta,
    createdAt: new Date().toISOString(),
    version: CHECKPOINT_VERSION,
  };
}
