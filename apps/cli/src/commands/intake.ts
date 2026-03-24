// sourcerer intake — interactive intake conversation

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import chalk from 'chalk';
import { input } from '@inquirer/prompts';
import yaml from 'js-yaml';
import type { SourcererConfig } from '@sourcerer/core';
import { createAIProvider } from '@sourcerer/ai';
import { ExaAdapter } from '@sourcerer/adapter-exa';
import { GitHubAdapter } from '@sourcerer/adapter-github';
import {
  ContentResearchEngine,
  createIntakeEngine,
  restoreIntakeEngine,
  extractIntakeResult,
} from '@sourcerer/intake';
import { loadConfigFromDisk, configFileExists } from '../config-io.js';
import {
  createUrlCrawler,
  createGitHubAnalyzer,
  createSimilaritySearcher,
} from '../content-research-adapters.js';

function parseArgs(args: string[]): {
  resumePath?: string;
  outputDir: string;
} {
  let resumePath: string | undefined;
  let outputDir = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resume' && args[i + 1]) {
      resumePath = args[++i];
    } else if (args[i] === '--output-dir' && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      return { outputDir };
    }
  }

  return { resumePath, outputDir };
}

function printUsage(): void {
  console.log(
    'Usage: sourcerer intake [--resume <state-file>] [--output-dir <dir>]',
  );
  console.log('');
  console.log('Options:');
  console.log(
    '  --resume <path>      Resume from a saved conversation state file',
  );
  console.log(
    '  --output-dir <dir>   Directory for output artifacts (default: cwd)',
  );
}

export async function intakeCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  // Load config
  if (!(await configFileExists())) {
    console.error(chalk.red('No config found. Run `sourcerer init` first.'));
    process.exitCode = 1;
    return;
  }
  const config = await loadConfigFromDisk();

  // Create dependencies
  const aiProvider = createAIProvider(config);
  const exa = new ExaAdapter(config.adapters.exa.apiKey);
  const github = new GitHubAdapter(process.env.GITHUB_TOKEN);

  const contentResearch = new ContentResearchEngine({
    aiProvider,
    urlCrawler: createUrlCrawler(exa),
    githubAnalyzer: createGitHubAnalyzer(github, aiProvider),
    similaritySearcher: createSimilaritySearcher(exa),
  });

  const deps = { aiProvider, contentResearch };

  // Create or restore engine
  let engine;
  if (parsed.resumePath) {
    try {
      const stateJson = await readFile(parsed.resumePath, 'utf-8');
      engine = restoreIntakeEngine(deps, stateJson);
      console.log(chalk.blue('Resumed conversation from saved state.'));
    } catch (err) {
      console.error(
        chalk.red(
          `Failed to resume: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      process.exitCode = 1;
      return;
    }
  } else {
    engine = createIntakeEngine(deps);
    console.log(chalk.blue('Starting intake conversation...'));
    console.log(
      chalk.gray(
        'Tip: Your progress is saved automatically. Use Ctrl+C to pause.',
      ),
    );
  }

  console.log('');

  // Save state on exit
  const statePath = join(parsed.outputDir, '.sourcerer-intake-state.json');

  // Interactive conversation loop
  while (!engine.isDone()) {
    const prompt = await engine.getPrompt();
    if (prompt === null) break;

    console.log(chalk.bold.cyan(prompt));
    console.log('');

    let response: string;
    try {
      response = await input({ message: '>' });
    } catch {
      // User pressed Ctrl+C — save state and exit
      await saveState(engine.serializeState(), statePath);
      console.log(
        chalk.yellow(`\nConversation saved to ${statePath}`),
      );
      console.log(
        chalk.gray(`Resume with: sourcerer intake --resume ${statePath}`),
      );
      return;
    }

    await engine.submitResponse(response);

    // Auto-save state after each step
    await saveState(engine.serializeState(), statePath);
  }

  // Extract results
  console.log('');
  console.log(chalk.blue('Generating search configuration...'));

  const result = await extractIntakeResult(
    engine.getContext(),
    aiProvider,
  );

  // Write output artifacts
  await mkdir(parsed.outputDir, { recursive: true });

  const configPath = join(parsed.outputDir, 'search-config.yaml');
  await writeFile(
    configPath,
    yaml.dump(result.searchConfig, { indent: 2, lineWidth: 120 }),
    'utf-8',
  );

  const profilePath = join(parsed.outputDir, 'talent-profile.json');
  await writeFile(
    profilePath,
    JSON.stringify(result.talentProfile, null, 2),
    'utf-8',
  );

  const seedsPath = join(parsed.outputDir, 'similarity-seeds.json');
  await writeFile(
    seedsPath,
    JSON.stringify(result.similaritySeeds, null, 2),
    'utf-8',
  );

  // Clean up state file on successful completion
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(statePath);
  } catch {
    // State file may not exist
  }

  console.log('');
  console.log(chalk.bold.green('Intake complete!'));
  console.log(`  Search config: ${configPath}`);
  console.log(`  Talent profile: ${profilePath}`);
  console.log(`  Similarity seeds: ${seedsPath}`);
  console.log('');
  console.log(
    chalk.gray(
      `Run the pipeline: sourcerer run --config ${configPath} --output json,markdown`,
    ),
  );
}

async function saveState(
  stateJson: string,
  path: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stateJson, 'utf-8');
}
