// sourcerer results — display pipeline results from the latest (or specified) run

import chalk from 'chalk';
import { findLatestRunDir, loadRunMeta, loadCandidates } from '../run-loader.js';
import { resolveOutputAdapter } from '../adapter-registry.js';
import { renderCandidateCard } from '../formatters/candidate-card.js';
import { renderSummary } from '../formatters/summary-table.js';

interface ParsedResultsArgs {
  tier?: number;
  push?: string;
  runDir?: string;
  json: boolean;
  help: boolean;
}

function parseArgs(args: string[]): ParsedResultsArgs {
  let tier: number | undefined;
  let push: string | undefined;
  let runDir: string | undefined;
  let json = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tier' && args[i + 1]) {
      tier = parseInt(args[++i], 10);
    } else if (args[i] === '--push' && args[i + 1]) {
      push = args[++i];
    } else if (args[i] === '--run' && args[i + 1]) {
      runDir = args[++i];
    } else if (args[i] === '--json') {
      json = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      help = true;
    }
  }

  return { tier, push, runDir, json, help };
}

function printUsage(): void {
  console.log('Usage: sourcerer results [options]');
  console.log('');
  console.log('Display pipeline results from the latest run.');
  console.log('');
  console.log('Options:');
  console.log('  --tier <n>       Filter to tier 1, 2, or 3');
  console.log('  --push <adapter> Re-push results to a different output adapter');
  console.log('  --run <dir>      Specify a run directory (default: latest)');
  console.log('  --json           Output raw JSON (for scripting)');
  console.log('  --help, -h       Show this help message');
}

export async function resultsCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    printUsage();
    return;
  }

  // Find run directory
  const runDir = parsed.runDir ?? (await findLatestRunDir());
  if (!runDir) {
    console.error(chalk.red('No runs found. Run `sourcerer run` first.'));
    process.exitCode = 1;
    return;
  }

  // Load data
  let meta;
  let candidates;
  try {
    meta = await loadRunMeta(runDir);
  } catch {
    console.error(chalk.red(`Failed to load run-meta.json from ${runDir}`));
    process.exitCode = 1;
    return;
  }

  try {
    candidates = await loadCandidates(runDir);
  } catch {
    console.error(chalk.red(`Failed to load candidates.json from ${runDir}`));
    process.exitCode = 1;
    return;
  }

  // --push: re-push to a different adapter
  if (parsed.push) {
    const adapter = resolveOutputAdapter(parsed.push);
    if (!adapter) {
      console.error(chalk.red(`Unknown output adapter: ${parsed.push}`));
      process.exitCode = 1;
      return;
    }

    const result = await adapter.push(candidates, { outputDir: runDir });
    console.log(
      chalk.green(
        `Pushed ${result.candidatesPushed} candidates to ${result.adapter} at ${result.outputLocation}`,
      ),
    );
    return;
  }

  // --tier: filter candidates
  if (parsed.tier !== undefined) {
    if (parsed.tier < 1 || parsed.tier > 3 || !Number.isInteger(parsed.tier)) {
      console.error(chalk.red('Invalid tier: must be 1, 2, or 3'));
      process.exitCode = 1;
      return;
    }
    candidates = candidates.filter((c) => c.tier === parsed.tier);
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score.total - a.score.total);

  // --json: output raw JSON
  if (parsed.json) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }

  // Render summary header
  console.log('');
  console.log(renderSummary(meta, candidates));
  console.log('');

  // Render candidate cards
  if (candidates.length === 0) {
    console.log(chalk.dim('  No candidates found for the given filters.'));
  } else {
    for (const candidate of candidates) {
      console.log(renderCandidateCard(candidate));
      console.log('');
    }
  }

  // Footer
  console.log(chalk.dim(`  ${candidates.length} candidate${candidates.length !== 1 ? 's' : ''} displayed`));
  console.log('');
}
