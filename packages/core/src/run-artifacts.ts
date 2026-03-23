// Run artifact management — directory creation and file writing

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunMeta } from './pipeline-types.js';

export function generateRunDirName(roleName: string, date?: Date): string {
  const d = date ?? new Date();
  const dateStr = d.toISOString().slice(0, 10);
  const sanitized = roleName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return `${dateStr}-${sanitized}`;
}

export async function createRunDirectory(
  runsBaseDir: string,
  roleName: string,
): Promise<string> {
  await mkdir(runsBaseDir, { recursive: true });

  const baseName = generateRunDirName(roleName);
  let runDirName = baseName;
  let counter = 1;

  const existing = await readdir(runsBaseDir).catch(() => [] as string[]);
  while (existing.includes(runDirName)) {
    counter++;
    runDirName = `${baseName}-${counter}`;
  }

  const runDir = join(runsBaseDir, runDirName);
  await mkdir(runDir, { recursive: true });
  await mkdir(join(runDir, 'evidence'), { recursive: true });

  return runDir;
}

export async function writeRunMeta(
  runDir: string,
  meta: RunMeta,
): Promise<void> {
  await writeFile(join(runDir, 'run-meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
}

export async function writeArtifact(
  runDir: string,
  filename: string,
  content: string,
): Promise<void> {
  await writeFile(join(runDir, filename), content, 'utf-8');
}
