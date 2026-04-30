// sourcerer candidates — manage individual candidates across runs

import chalk from 'chalk';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { confirm } from '@inquirer/prompts';
import type { RunMeta, ScoredCandidate } from '@sourcerer/core';
import {
  findCandidateAcrossRuns,
  loadCandidates,
  writeCandidates,
  listAllRuns,
} from '../run-loader.js';
import { backfillRunRetention } from '../retention-migration.js';
import { configFileExists, loadConfigFromDisk } from '../config-io.js';
import { DEFAULT_RETENTION_TTL_DAYS } from '@sourcerer/core';

interface ParsedCandidatesArgs {
  subcommand: 'delete' | 'purge' | null;
  candidateId?: string;
  expired: boolean;
  yes: boolean;
  help: boolean;
  runsDir?: string;
}

function parseArgs(args: string[]): ParsedCandidatesArgs {
  let subcommand: 'delete' | 'purge' | null = null;
  let candidateId: string | undefined;
  let expired = false;
  let yes = false;
  let help = false;
  let runsDir: string | undefined;
  let subcommandSeen = false;
  let idSeen = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--expired') {
      expired = true;
    } else if (args[i] === '--yes' || args[i] === '-y') {
      yes = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      help = true;
    } else if (args[i] === '--runs-dir' && args[i + 1]) {
      runsDir = args[++i];
    } else if (!args[i].startsWith('--')) {
      if (!subcommandSeen) {
        if (args[i] === 'delete' || args[i] === 'purge') {
          subcommand = args[i] as 'delete' | 'purge';
          subcommandSeen = true;
        }
      } else if (!idSeen && subcommand === 'delete') {
        candidateId = args[i];
        idSeen = true;
      }
    }
  }

  return { subcommand, candidateId, expired, yes, help, runsDir };
}

function printUsage(): void {
  console.log('Usage: sourcerer candidates <subcommand> [options]');
  console.log('');
  console.log('Subcommands:');
  console.log('  delete <id>           Delete a candidate by ID');
  console.log('  purge --expired       Redact expired PII fields');
  console.log('');
  console.log('Options:');
  console.log('  --expired             For purge: only redact expired PII');
  console.log('  --yes, -y             Skip confirmation prompts');
  console.log('  --runs-dir <path>     Custom runs directory (default: runs)');
  console.log('  --help, -h            Show this help message');
}

export async function candidatesCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    printUsage();
    return;
  }

  if (!parsed.subcommand) {
    printUsage();
    return;
  }

  if (parsed.subcommand === 'delete') {
    await handleDelete(parsed);
    return;
  }

  if (parsed.subcommand === 'purge') {
    await handlePurge(parsed);
    return;
  }
}

async function handleDelete(parsed: ParsedCandidatesArgs): Promise<void> {
  if (!parsed.candidateId) {
    console.error(chalk.red('Candidate ID is required. Usage: sourcerer candidates delete <id>'));
    process.exitCode = 1;
    return;
  }

  const result = await findCandidateAcrossRuns(parsed.candidateId, parsed.runsDir);
  if (!result) {
    console.error(chalk.red(`Candidate ${parsed.candidateId} not found in any run.`));
    process.exitCode = 1;
    return;
  }

  const { runDir, candidate, index } = result;
  console.log(`Found candidate: ${chalk.bold(candidate.name)}`);
  console.log(`  Tier: ${candidate.tier}  Score: ${candidate.score.total}/100`);
  console.log(`  Run: ${runDir}`);

  if (!parsed.yes) {
    const confirmed = await confirm({ message: `Delete ${candidate.name}?` });
    if (!confirmed) {
      console.log('Cancelled.');
      return;
    }
  }

  // Load, remove, save
  const candidates = await loadCandidates(runDir);
  candidates.splice(index, 1);
  await writeCandidates(runDir, candidates);

  // Update run-meta.json candidateCount
  const metaPath = join(runDir, 'run-meta.json');
  const metaContent = await readFile(metaPath, 'utf-8');
  const meta = JSON.parse(metaContent) as RunMeta;
  meta.candidateCount = candidates.length;
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  console.log(chalk.green(`Deleted candidate ${candidate.name} from ${runDir}`));
  console.log(chalk.dim('Note: Remote copies (e.g., Notion) are not affected.'));
}

async function handlePurge(parsed: ParsedCandidatesArgs): Promise<void> {
  if (!parsed.expired) {
    console.error(chalk.red('--expired flag is required. Usage: sourcerer candidates purge --expired'));
    process.exitCode = 1;
    return;
  }

  const runs = await listAllRuns(parsed.runsDir);
  if (runs.length === 0) {
    console.log('No runs found.');
    return;
  }

  // H-2 migration: legacy runs (pre-this-commit) may have PIIField records
  // without `retentionExpiresAt`. Without the backfill below, those fields
  // would be ignored by the comparison and live forever. Resolve TTL from
  // config, falling back to the package default if no config is present.
  let retentionTtlDays = DEFAULT_RETENTION_TTL_DAYS;
  try {
    if (await configFileExists()) {
      const config = await loadConfigFromDisk();
      retentionTtlDays = config.retention.ttlDays;
    }
  } catch {
    // Bad/missing config — fall back to default rather than blocking purge.
  }

  const now = new Date().toISOString();
  let totalFieldsRedacted = 0;
  let candidatesAffected = 0;
  let runsModified = 0;

  for (const run of runs) {
    let candidates: ScoredCandidate[];
    try {
      candidates = await loadCandidates(run.runDir);
    } catch {
      continue;
    }

    // B2 policy: backfill legacy fields using collectedAt + ttlDays. If a
    // legacy field has no usable collectedAt, it gets stamped expired-now,
    // so the redaction loop below will catch it on this same pass.
    const migrated = backfillRunRetention(
      candidates,
      run.meta,
      'collected-at',
      retentionTtlDays,
    );

    let runModified = migrated;
    for (const candidate of candidates) {
      let candidateModified = false;
      for (const field of candidate.pii.fields) {
        if (
          field.retentionExpiresAt &&
          field.retentionExpiresAt < now &&
          field.value !== '[REDACTED]'
        ) {
          field.value = '[REDACTED]';
          totalFieldsRedacted++;
          candidateModified = true;
        }
      }
      if (candidateModified) {
        candidatesAffected++;
        runModified = true;
      }
    }

    if (runModified) {
      await writeCandidates(run.runDir, candidates);
      runsModified++;
    }
  }

  if (totalFieldsRedacted === 0) {
    console.log('No expired PII fields found.');
    return;
  }

  console.log(
    chalk.green(
      `Purged ${totalFieldsRedacted} PII field${totalFieldsRedacted !== 1 ? 's' : ''} from ${candidatesAffected} candidate${candidatesAffected !== 1 ? 's' : ''} across ${runsModified} run${runsModified !== 1 ? 's' : ''}`,
    ),
  );
}
