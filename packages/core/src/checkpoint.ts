// Checkpoint — serialize/deserialize pipeline state to disk

import { writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Checkpoint,
  PipelinePhaseName,
  PhaseOutputMap,
  RunMeta,
} from './pipeline-types.js';

const CHECKPOINT_FILENAME = 'checkpoint.json';

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
  const parsed = JSON.parse(content) as Checkpoint;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported checkpoint version: ${parsed.version}. Expected 1.`);
  }
  return parsed;
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
    version: 1,
  };
}
