// sourcerer score - experimental scoring utilities

import chalk from 'chalk';
import { createAIProvider } from '@sourcerer/ai';
import {
  createGoldenBatchFixtureProvider,
  createGoldenFixtureProvider,
  runGoldenEvaluationComparison,
  writeEvalComparisonReports,
} from '@sourcerer/eval';
import { configFileExists, loadConfigFromDisk } from '../config-io.js';

const DEFAULT_BATCH_MODEL = 'claude-opus-4-7';

interface ParsedScoreArgs {
  batch: boolean;
  mock: boolean;
  json: boolean;
  help: boolean;
  outputDir?: string;
  model?: string;
}

export function parseScoreArgs(args: string[]): ParsedScoreArgs {
  let batch = false;
  let mock = false;
  let json = false;
  let help = false;
  let outputDir: string | undefined;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch') {
      batch = true;
    } else if (args[i] === '--mock') {
      mock = true;
    } else if (args[i] === '--json') {
      json = true;
    } else if (args[i] === '--output-dir' && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === '--model' && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      help = true;
    }
  }

  return { batch, mock, json, help, outputDir, model };
}

function printUsage(): void {
  console.log('Usage: sourcerer score --batch [options]');
  console.log('');
  console.log('Options:');
  console.log('  --batch              Run the Phase 6 batch-scoring spike comparison');
  console.log('  --output-dir <path>  Report directory (default: eval-results)');
  console.log(
    `  --model <model>      Live batch model (default: ${DEFAULT_BATCH_MODEL})`,
  );
  console.log('  --mock               Use deterministic fixture providers (no API keys)');
  console.log('  --json               Print machine-readable summary JSON');
  console.log('  --help, -h           Show this help message');
}

export async function scoreCommand(args: string[]): Promise<void> {
  const parsed = parseScoreArgs(args);
  if (parsed.help) {
    printUsage();
    return;
  }

  if (!parsed.batch) {
    console.error(
      chalk.red('Standalone scoring is not implemented. Use `sourcerer score --batch`.'),
    );
    process.exitCode = 1;
    return;
  }

  let baselineProvider = createGoldenFixtureProvider;
  let batchProvider = createGoldenBatchFixtureProvider();
  let model: string | undefined;
  let modelLabel = 'fixture';

  if (!parsed.mock) {
    if (!(await configFileExists())) {
      console.error(
        chalk.red('No config found. Run `sourcerer init` first, or use --mock.'),
      );
      process.exitCode = 1;
      return;
    }
    const config = await loadConfigFromDisk();
    baselineProvider = () => createAIProvider(config);
    batchProvider = createAIProvider(config);
    model = parsed.model ?? DEFAULT_BATCH_MODEL;
    modelLabel = model;
  } else if (parsed.model) {
    modelLabel = parsed.model;
  }

  const comparison = await runGoldenEvaluationComparison({
    baselineProvider,
    batchProvider,
    modelLabel,
    model,
  });
  const paths = await writeEvalComparisonReports(comparison, {
    outputDir: parsed.outputDir,
  });

  if (parsed.json) {
    console.log(
      JSON.stringify(
        {
          name: comparison.name,
          generatedAt: comparison.generatedAt,
          modelLabel: comparison.modelLabel,
          baseline: comparison.baseline.metrics,
          batch: comparison.batch.metrics,
          deltas: comparison.deltas,
          reports: paths,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('');
  console.log(chalk.bold('Batch scoring spike complete'));
  console.log(`  Model: ${comparison.modelLabel}`);
  console.log(`  Candidates: ${comparison.batch.metrics.candidateCount}`);
  console.log(
    `  Per-candidate tier accuracy: ${(comparison.baseline.metrics.exactTierAccuracy * 100).toFixed(1)}%`,
  );
  console.log(
    `  Batch tier accuracy: ${(comparison.batch.metrics.exactTierAccuracy * 100).toFixed(1)}%`,
  );
  console.log(`  Cost delta: $${comparison.deltas.totalCostUsd.toFixed(4)}`);
  console.log(`  JSON: ${paths.jsonPath}`);
  console.log(`  Markdown: ${paths.markdownPath}`);
}
