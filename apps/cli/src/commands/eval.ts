// sourcerer eval - run the golden-set scoring evaluation harness

import chalk from 'chalk';
import { createAIProvider, getDefaultModel } from '@sourcerer/ai';
import {
  createGoldenFixtureProvider,
  runGoldenEvaluation,
  writeEvalReports,
} from '@sourcerer/eval';
import { configFileExists, loadConfigFromDisk } from '../config-io.js';

interface ParsedEvalArgs {
  outputDir?: string;
  mock: boolean;
  json: boolean;
  help: boolean;
}

export function parseEvalArgs(args: string[]): ParsedEvalArgs {
  let outputDir: string | undefined;
  let mock = false;
  let json = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output-dir' && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === '--mock') {
      mock = true;
    } else if (args[i] === '--json') {
      json = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      help = true;
    }
  }

  return { outputDir, mock, json, help };
}

function printUsage(): void {
  console.log('Usage: sourcerer eval [options]');
  console.log('');
  console.log('Options:');
  console.log('  --output-dir <path>  Report directory (default: eval-results)');
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
  let modelLabel = 'fixture';

  if (!parsed.mock) {
    if (!(await configFileExists())) {
      console.error(chalk.red('No config found. Run `sourcerer init` first, or use --mock.'));
      process.exitCode = 1;
      return;
    }
    const config = await loadConfigFromDisk();
    provider = () => createAIProvider(config);
    modelLabel = config.aiProvider.model ?? getDefaultModel(config.aiProvider.name);
  }

  const report = await runGoldenEvaluation({ provider, modelLabel });
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
