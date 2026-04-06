// Run loader — load run data from disk

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunMeta, ScoredCandidate } from '@sourcerer/core';

const DEFAULT_RUNS_DIR = 'runs';

export async function findLatestRunDir(runsBaseDir?: string): Promise<string | null> {
  const base = runsBaseDir ?? DEFAULT_RUNS_DIR;
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await readdir(base, { withFileTypes: true });
  } catch {
    return null;
  }

  const dirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);

  if (dirs.length === 0) {
    return null;
  }

  // Run dirs have date prefixes (e.g. 2026-04-06-role-name), sort descending
  dirs.sort((a, b) => b.localeCompare(a));
  return join(base, dirs[0]);
}

export async function loadRunMeta(runDir: string): Promise<RunMeta> {
  const content = await readFile(join(runDir, 'run-meta.json'), 'utf-8');
  return JSON.parse(content) as RunMeta;
}

export async function loadCandidates(runDir: string): Promise<ScoredCandidate[]> {
  const content = await readFile(join(runDir, 'candidates.json'), 'utf-8');
  const parsed = JSON.parse(content) as unknown;

  // Handle envelope format from output-json serializer: { version, candidates }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    'candidates' in parsed
  ) {
    return (parsed as { candidates: ScoredCandidate[] }).candidates;
  }

  // Handle raw array format
  if (Array.isArray(parsed)) {
    return parsed as ScoredCandidate[];
  }

  throw new Error('Invalid candidates.json format: expected envelope or array');
}
