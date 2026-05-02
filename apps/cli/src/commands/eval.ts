// sourcerer eval - run the golden-set scoring evaluation harness

import chalk from 'chalk';
import { createAIProvider, getDefaultModel } from '@sourcerer/ai';
import {
  createGoldenBatchFixtureProvider,
  createGoldenFixtureProvider,
  runGoldenEvaluationComparison,
  runGoldenEvaluation,
  writeEvalComparisonReports,
  writeEvalReports,
} from '@sourcerer/eval';
import { configFileExists, loadConfigFromDisk } from '../config-io.js';

interface ParsedEvalArgs {
  outputDir?: string;
  model?: string;
  batch: boolean;
  mock: boolean;
  json: boolean;
  help: boolean;
}

export function parseEvalArgs(args: string[]): ParsedEvalArgs {
  let outputDir: string | undefined;
  let model: string | undefined;
  let batch = false;
  let mock = false;
  let json = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output-dir' && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === '--model' && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === '--batch') {
      batch = true;
    } else if (args[i] === '--mock') {
      mock = true;
    } else if (args[i] === '--json') {
      json = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      help = true;
    }
  }

  return { outputDir, model, batch, mock, json, help };
}

function printUsage(): void {
  console.log('Usage: sourcerer eval [options]');
  console.log('');
  console.log('Options:');
  console.log('  --output-dir <path>  Report directory (default: eval-results)');
  console.log('  --batch              Compare per-candidate vs batch scoring');
  console.log('  --model <model>      Override model for live eval calls');
  console.log('  --mock               Use deterministic fixture provider (no API keys)');
  console.log('  --json               Print machine-readable summary JSON');
  console.log('  --help, -h           Show this help message');
}

export async function evalCommand(args: string[]): Promise<void> {
  const parsed = parseEvalArgs(args);
  if (parsed.help) {
    printUsage();
    return;
  }

  let provider = createGoldenFixtureProvider;
  let batchProvider = createGoldenBatchFixtureProvider();
  let modelLabel = 'fixture';

  if (!parsed.mock) {
    if (!(await configFileExists())) {
      console.error(chalk.red('No config found. Run `sourcerer init` first, or use --mock.'));
      process.exitCode = 1;
      return;
    }
    const config = await loadConfigFromDisk();
    provider = () => createAIProvider(config);
    batchProvider = createAIProvider(config);
    modelLabel = config.aiProvider.model ?? getDefaultModel(config.aiProvider.name);
  }

  const effectiveModel = parsed.model;
  if (effectiveModel) {
    modelLabel = effectiveModel;
  }

  if (parsed.batch) {
    const comparison = await runGoldenEvaluationComparison({
      baselineProvider: provider,
      batchProvider,
      modelLabel,
      model: effectiveModel,
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
    console.log(chalk.bold('Golden batch comparison complete'));
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
    return;
  }

  const report = await runGoldenEvaluation({
    provider,
    modelLabel,
    model: effectiveModel,
  });
  const paths = await writeEvalReports(report, { outputDir: parsed.outputDir });

  if (parsed.json) {
    console.log(
      JSON.stringify(
        {
          name: report.name,
          generatedAt: report.generatedAt,
          modelLabel: report.modelLabel,
          metrics: report.metrics,
          reports: paths,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('');
  console.log(chalk.bold('Golden eval complete'));
  console.log(`  Model: ${report.modelLabel}`);
  console.log(`  Candidates: ${report.metrics.candidateCount}`);
  console.log(
    `  Tier accuracy: ${(report.metrics.exactTierAccuracy * 100).toFixed(1)}%`,
  );
  console.log(
    `  Tier proximity (+/-1): ${(report.metrics.tierProximityAccuracy * 100).toFixed(1)}%`,
  );
  console.log(
    `  Hallucination rate: ${(report.metrics.hallucinationRate * 100).toFixed(1)}%`,
  );
  console.log(`  Cost: $${report.metrics.totalCostUsd.toFixed(4)}`);
  console.log(`  JSON: ${paths.jsonPath}`);
  console.log(`  Markdown: ${paths.markdownPath}`);
}
