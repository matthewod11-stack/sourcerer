// H-6: validates the Zod parser for checkpoint files. Catches version drift,
// shape drift, and corrupt JSON before the resume path touches the data.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadCheckpoint,
  saveCheckpoint,
  createCheckpoint,
  CHECKPOINT_VERSION,
  CheckpointSchema,
} from '../checkpoint.js';
import type { Checkpoint, RunMeta } from '../pipeline-types.js';

const NOW = '2026-04-30T12:00:00Z';

function makeRunMeta(overrides?: Partial<RunMeta>): RunMeta {
  return {
    runId: 'run-123',
    roleName: 'Backend Engineer',
    runDir: '/tmp/run-123',
    startedAt: NOW,
    status: 'running',
    phases: [],
    cost: { totalCost: 0, perPhase: {}, perAdapter: {}, currency: 'USD' },
    version: 1,
    ...overrides,
  };
}

function makeValidCheckpoint(overrides?: Partial<Checkpoint>): Checkpoint {
  return {
    runId: 'run-123',
    runDir: '/tmp/run-123',
    lastCompletedPhase: 'discover',
    phaseOutputs: {},
    runMeta: makeRunMeta(),
    createdAt: NOW,
    version: 1,
    ...overrides,
  };
}

describe('CheckpointSchema', () => {
  it('parses a valid checkpoint', () => {
    const result = CheckpointSchema.safeParse(makeValidCheckpoint());
    expect(result.success).toBe(true);
  });

  it('rejects missing version field', () => {
    const cp = { ...makeValidCheckpoint() } as Record<string, unknown>;
    delete cp.version;
    const result = CheckpointSchema.safeParse(cp);
    expect(result.success).toBe(false);
  });

  it('rejects unknown phase name in lastCompletedPhase', () => {
    const cp = { ...makeValidCheckpoint(), lastCompletedPhase: 'foo' };
    const result = CheckpointSchema.safeParse(cp);
    expect(result.success).toBe(false);
  });

  it('rejects malformed runMeta.cost (missing currency)', () => {
    const bad = makeValidCheckpoint();
    (bad.runMeta as unknown as { cost: unknown }).cost = {
      totalCost: 0,
      perPhase: {},
      perAdapter: {},
    };
    const result = CheckpointSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('accepts arbitrary phase outputs (intentionally permissive at this layer)', () => {
    // Bypass TS narrowing: the schema deliberately accepts anything in
    // phaseOutputs (see comment on CheckpointSchema), but the TS type
    // demands the per-phase shape.
    const cp = {
      ...makeValidCheckpoint(),
      phaseOutputs: {
        discover: { rawCandidates: ['anything goes'], costIncurred: 0.05 },
      },
    } as unknown;
    const result = CheckpointSchema.safeParse(cp);
    expect(result.success).toBe(true);
  });
});

describe('loadCheckpoint', () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'sourcerer-checkpoint-'));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it('returns null when no checkpoint file exists', async () => {
    const result = await loadCheckpoint(runDir);
    expect(result).toBeNull();
  });

  it('round-trips a valid checkpoint', async () => {
    const cp = createCheckpoint('run-x', runDir, 'discover', {}, makeRunMeta({ runId: 'run-x' }));
    await saveCheckpoint(runDir, cp);
    const loaded = await loadCheckpoint(runDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.runId).toBe('run-x');
    expect(loaded?.lastCompletedPhase).toBe('discover');
    expect(loaded?.version).toBe(CHECKPOINT_VERSION);
  });

  it('throws on invalid JSON with a helpful path', async () => {
    await writeFile(join(runDir, 'checkpoint.json'), '{not valid json');
    await expect(loadCheckpoint(runDir)).rejects.toThrow(/Invalid checkpoint JSON/);
  });

  it('throws a tailored error on version mismatch (H-6)', async () => {
    await writeFile(
      join(runDir, 'checkpoint.json'),
      JSON.stringify({ ...makeValidCheckpoint(), version: 2 }),
    );
    await expect(loadCheckpoint(runDir)).rejects.toThrow(/Incompatible checkpoint version: 2/);
    await expect(loadCheckpoint(runDir)).rejects.toThrow(/restart the run from scratch/);
  });

  it('throws a path-specific error on shape drift (H-6)', async () => {
    const bad = makeValidCheckpoint();
    (bad as unknown as { lastCompletedPhase: string }).lastCompletedPhase = 'bogus';
    await writeFile(join(runDir, 'checkpoint.json'), JSON.stringify(bad));
    await expect(loadCheckpoint(runDir)).rejects.toThrow(/lastCompletedPhase/);
  });

  it('reports nested errors inside runMeta (H-6)', async () => {
    const bad = makeValidCheckpoint();
    (bad.runMeta as unknown as { status: string }).status = 'invented';
    await writeFile(join(runDir, 'checkpoint.json'), JSON.stringify(bad));
    await expect(loadCheckpoint(runDir)).rejects.toThrow(/runMeta\.status/);
  });
});
