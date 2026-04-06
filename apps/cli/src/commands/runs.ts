// sourcerer runs — list and manage pipeline runs

import chalk from 'chalk';
import { rm } from 'node:fs/promises';
import { confirm } from '@inquirer/prompts';
import { listAllRuns } from '../run-loader.js';
import type { RunSummary } from '../run-loader.js';
import type { RunStatus } from '@sourcerer/core';

interface ParsedRunsArgs {
  subcommand: 'list' | 'clean';
  olderThan?: string;
  yes: boolean;
  json: boolean;
  help: boolean;
  runsDir?: string;
}

function parseArgs(args: string[]): ParsedRunsArgs {
  let subcommand: 'list' | 'clean' = 'list';
  let olderThan: string | undefined;
  let yes = false;
  let json = false;
  let help = false;
  let runsDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--older-than' && args[i + 1]) {
      olderThan = args[++i];
    } else if (args[i] === '--yes' || args[i] === '-y') {
      yes = true;
    } else if (args[i] === '--json') {
      json = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      help = true;
    } else if (args[i] === '--runs-dir' && args[i + 1]) {
      runsDir = args[++i];
    } else if (!args[i].startsWith('--')) {
      if (args[i] === 'list' || args[i] === 'clean') {
        subcommand = args[i] as 'list' | 'clean';
      }
    }
  }

  return { subcommand, olderThan, yes, json, help, runsDir };
}

function printUsage(): void {
  console.log('Usage: sourcerer runs [subcommand] [options]');
  console.log('');
  console.log('Subcommands:');
  console.log('  list                  List all runs (default)');
  console.log('  clean                 Delete old runs');
  console.log('');
  console.log('Options:');
  console.log('  --older-than <dur>    For clean: duration (e.g., 30d, 2w)');
  console.log('  --yes, -y             Skip confirmation prompts');
  console.log('  --json                Output machine-readable JSON');
  console.log('  --runs-dir <path>     Custom runs directory (default: runs)');
  console.log('  --help, -h            Show this help message');
}

function statusColor(status: RunStatus): (text: string) => string {
  switch (status) {
    case 'completed':
      return chalk.green;
    case 'partial':
      return chalk.yellow;
    case 'failed':
    case 'interrupted':
      return chalk.red;
    case 'running':
      return chalk.blue;
    default:
      return chalk.white;
  }
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined) return '-';
  return `$${cost.toFixed(2)}`;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

export function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(d|w)$/);
  if (!match) {
    throw new Error(`Invalid duration format: "${input}". Use e.g. 30d or 2w.`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'd') return value * 86400000;
  if (unit === 'w') return value * 7 * 86400000;
  throw new Error(`Invalid duration unit: ${unit}`);
}

function padRight(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + ' '.repeat(len - str.length);
}

function renderRunsTable(runs: RunSummary[]): void {
  console.log('');
  console.log(chalk.bold('  Sourcerer Runs'));
  console.log(`  ${'═'.repeat(85)}`);
  console.log(
    `  ${padRight('Date', 12)}${padRight('Role', 28)}${padRight('Status', 14)}${padRight('Candidates', 12)}${padRight('Cost', 10)}Duration`,
  );

  for (const run of runs) {
    const date = formatDate(run.meta.startedAt);
    const role = run.meta.roleName;
    const status = run.meta.status;
    const candidates = run.meta.candidateCount ?? 0;
    const cost = run.meta.cost.totalCost;
    const duration = formatDuration(run.meta.totalDurationMs);
    const colorFn = statusColor(status);

    console.log(
      `  ${padRight(date, 12)}${padRight(role, 28)}${padRight(colorFn(status), 14 + (colorFn(status).length - status.length))}${padRight(String(candidates), 12)}${padRight(formatCost(cost), 10)}${duration}`,
    );
  }
}

export async function runsCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    printUsage();
    return;
  }

  const runs = await listAllRuns(parsed.runsDir);

  if (parsed.subcommand === 'list') {
    if (runs.length === 0) {
      console.log('No runs found.');
      return;
    }

    if (parsed.json) {
      console.log(JSON.stringify(runs, null, 2));
      return;
    }

    renderRunsTable(runs);
    console.log('');
    return;
  }

  if (parsed.subcommand === 'clean') {
    if (!parsed.olderThan) {
      console.error(chalk.red('--older-than is required for clean. Example: sourcerer runs clean --older-than 30d'));
      process.exitCode = 1;
      return;
    }

    let durationMs: number;
    try {
      durationMs = parseDuration(parsed.olderThan);
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exitCode = 1;
      return;
    }

    const cutoff = Date.now() - durationMs;
    const toDelete = runs.filter(
      (r) => new Date(r.meta.startedAt).getTime() < cutoff,
    );

    if (toDelete.length === 0) {
      console.log(`No runs older than ${parsed.olderThan}.`);
      return;
    }

    console.log(`Found ${toDelete.length} run${toDelete.length !== 1 ? 's' : ''} to delete:`);
    for (const run of toDelete) {
      console.log(`  ${formatDate(run.meta.startedAt)}  ${run.meta.roleName}  (${run.dirName})`);
    }

    if (!parsed.yes) {
      const confirmed = await confirm({ message: 'Delete these runs?' });
      if (!confirmed) {
        console.log('Cancelled.');
        return;
      }
    }

    for (const run of toDelete) {
      await rm(run.runDir, { recursive: true, force: true });
    }

    console.log(`Deleted ${toDelete.length} run${toDelete.length !== 1 ? 's' : ''}.`);
  }
}
