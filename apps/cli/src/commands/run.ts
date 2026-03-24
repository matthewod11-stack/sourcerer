// sourcerer run — execute pipeline from a hand-written search config

import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import chalk from 'chalk';
import {
  PipelineRunner,
  createDedupHandler,
  loadCheckpoint,
  type SearchConfig,
  type TalentProfile,
  type OutputAdapter,
} from '@sourcerer/core';
import { ExaAdapter } from '@sourcerer/adapter-exa';
import { GitHubAdapter } from '@sourcerer/adapter-github';
import { JsonOutputAdapter } from '@sourcerer/output-json';
import { MarkdownOutputAdapter } from '@sourcerer/output-markdown';
import { loadConfigFromDisk, configFileExists } from '../config-io.js';
import {
  createDiscoverHandler,
  createEnrichHandler,
  createStubScoreHandler,
  createOutputHandler,
} from '../handlers.js';

function parseArgs(args: string[]): {
  configPath?: string;
  outputFormats: string[];
  resumeFrom?: string;
  useIntake: boolean;
  noCache: boolean;
} {
  let configPath: string | undefined;
  let resumeFrom: string | undefined;
  let useIntake = false;
  let noCache = false;
  const outputFormats: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      outputFormats.push(...args[++i].split(','));
    } else if (args[i] === '--resume' && args[i + 1]) {
      resumeFrom = args[++i];
    } else if (args[i] === '--intake') {
      useIntake = true;
    } else if (args[i] === '--no-cache') {
      noCache = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      return { outputFormats: [], useIntake: false, noCache: false };
    }
  }

  return { configPath, outputFormats, resumeFrom, useIntake, noCache };
}

function printUsage(): void {
  console.log('Usage: sourcerer run --config <path> [--output json,markdown] [--resume <dir>]');
  console.log('');
  console.log('Options:');
  console.log('  --config <path>     Path to search config YAML file (required)');
  console.log('  --output <formats>  Output formats, comma-separated (default: json)');
  console.log('  --resume <dir>      Resume from a previous run directory');
  console.log('  --intake            Run interactive intake before pipeline');
}

export async function runCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (!parsed.configPath && !parsed.resumeFrom && !parsed.useIntake) {
    printUsage();
    return;
  }

  // If --intake, run intake first then use its output
  if (parsed.useIntake) {
    const { intakeCommand } = await import('./intake.js');
    await intakeCommand([]);
    // After intake completes, the config is in CWD
    parsed.configPath = 'search-config.yaml';
  }

  // Load sourcerer config for API keys
  if (!(await configFileExists())) {
    console.error(chalk.red('No config found. Run `sourcerer init` first.'));
    process.exitCode = 1;
    return;
  }
  const sourcererConfig = await loadConfigFromDisk();

  // Load search config from YAML
  let searchConfig: SearchConfig | undefined;
  let talentProfile: TalentProfile | undefined;

  if (parsed.configPath) {
    const configContent = await readFile(parsed.configPath, 'utf-8');
    searchConfig = yaml.load(configContent) as SearchConfig;

    // Load companion talent profile if it exists
    const profilePath = parsed.configPath.replace(
      /search-config\.yaml$/,
      'talent-profile.json',
    );
    try {
      const profileContent = await readFile(profilePath, 'utf-8');
      talentProfile = JSON.parse(profileContent) as TalentProfile;
    } catch {
      // Build minimal talent profile from search config
      talentProfile = {
        role: {
          title: searchConfig.roleName,
          level: 'Senior',
          scope: searchConfig.roleName,
          mustHaveSkills: [],
          niceToHaveSkills: [],
        },
        company: {
          name: 'Unknown',
          url: '',
          techStack: [],
          cultureSignals: [],
          analyzedAt: new Date().toISOString(),
        },
        successPatterns: {
          careerTrajectories: [],
          skillSignatures: [],
          seniorityCalibration: '',
          cultureSignals: [],
        },
        antiPatterns: [],
        competitorMap: {
          targetCompanies: [],
          avoidCompanies: [],
          competitorReason: {},
        },
        createdAt: new Date().toISOString(),
      };
    }
  }

  // When resuming without --config, try loading searchConfig from checkpoint
  if (parsed.resumeFrom && !searchConfig) {
    const checkpoint = await loadCheckpoint(parsed.resumeFrom);
    if (checkpoint?.phaseOutputs.intake) {
      searchConfig = checkpoint.phaseOutputs.intake.searchConfig;
      talentProfile = checkpoint.phaseOutputs.intake.talentProfile;
    }
    if (!searchConfig) {
      console.error(chalk.red('Resume requires --config <path> when no intake phase was run previously.'));
      process.exitCode = 1;
      return;
    }
  }

  // Instantiate adapters
  const exa = new ExaAdapter(sourcererConfig.adapters.exa.apiKey);

  const githubToken = process.env.GITHUB_TOKEN;
  const github = new GitHubAdapter(githubToken);

  // Determine output formats
  const formats =
    parsed.outputFormats.length > 0
      ? parsed.outputFormats
      : [sourcererConfig.defaultOutput ?? 'json'];

  const outputAdapters: OutputAdapter[] = [];
  for (const fmt of formats) {
    if (fmt === 'json') outputAdapters.push(new JsonOutputAdapter());
    else if (fmt === 'markdown') outputAdapters.push(new MarkdownOutputAdapter());
    else console.warn(chalk.yellow(`Unknown output format: ${fmt}, skipping`));
  }

  if (outputAdapters.length === 0) {
    outputAdapters.push(new JsonOutputAdapter());
  }

  // Build pipeline
  const runner = new PipelineRunner({
    discover: createDiscoverHandler(exa),
    dedup: createDedupHandler(),
    enrich: createEnrichHandler({ exa, github }),
    score: createStubScoreHandler(searchConfig!),
    output: createOutputHandler(outputAdapters),
  });

  console.log(chalk.blue(`Starting pipeline: ${searchConfig?.roleName ?? 'resumed run'}`));

  const meta = await runner.run({
    roleName: searchConfig?.roleName ?? 'unknown',
    searchConfig,
    talentProfile,
    resumeFrom: parsed.resumeFrom,
    maxCostUsd: searchConfig?.maxCostUsd,
    onProgress: (event) => {
      const icon =
        event.status === 'completed'
          ? chalk.green('done')
          : event.status === 'running'
            ? chalk.blue('...')
            : event.status === 'skipped'
              ? chalk.gray('skip')
              : chalk.red('fail');
      console.log(`  [${icon}] ${event.message}`);
    },
  });

  // Print summary
  console.log('');
  console.log(chalk.bold('Pipeline complete'));
  console.log(`  Status: ${meta.status}`);
  console.log(`  Candidates: ${meta.candidateCount ?? 0}`);
  console.log(`  Cost: $${meta.cost.totalCost.toFixed(4)}`);
  console.log(`  Duration: ${meta.totalDurationMs ?? 0}ms`);
  console.log(`  Run dir: ${meta.runDir}`);
}
