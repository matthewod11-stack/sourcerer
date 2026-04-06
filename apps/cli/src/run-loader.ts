// Run loader — load run data from disk

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunMeta, ScoredCandidate } from '@sourcerer/core';

export interface RunSummary {
  runDir: string;
  dirName: string;
  meta: RunMeta;
}

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

export async function listAllRuns(runsBaseDir?: string): Promise<RunSummary[]> {
  const base = runsBaseDir ?? DEFAULT_RUNS_DIR;
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = dirents.filter((d) => d.isDirectory());

  const summaries: RunSummary[] = [];
  for (const dir of dirs) {
    const runDir = join(base, dir.name);
    try {
      const meta = await loadRunMeta(runDir);
      summaries.push({ runDir, dirName: dir.name, meta });
    } catch {
      console.error(`Warning: skipping ${dir.name} (no valid run-meta.json)`);
    }
  }

  // Sort by startedAt descending
  summaries.sort((a, b) => b.meta.startedAt.localeCompare(a.meta.startedAt));
  return summaries;
}

export async function findCandidateAcrossRuns(
  candidateId: string,
  runsBaseDir?: string,
): Promise<{ runDir: string; candidate: ScoredCandidate; index: number } | null> {
  const runs = await listAllRuns(runsBaseDir);
  for (const run of runs) {
    let candidates: ScoredCandidate[];
    try {
      candidates = await loadCandidates(run.runDir);
    } catch {
      continue;
    }
    const index = candidates.findIndex((c) => c.id === candidateId);
    if (index !== -1) {
      return { runDir: run.runDir, candidate: candidates[index], index };
    }
  }
  return null;
}

export async function writeCandidates(
  runDir: string,
  candidates: ScoredCandidate[],
): Promise<void> {
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates,
  };
  await writeFile(join(runDir, 'candidates.json'), JSON.stringify(payload, null, 2), 'utf-8');
}
