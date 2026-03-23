// sourcerer init — Interactive onboarding wizard

import { select, input, confirm, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import {
  CONFIG_PATH,
  validateConfig,
  type SourcererConfig,
  type AIProviderName,
  type AdapterKeyConfig,
} from '@sourcerer/core';
import { configFileExists, saveConfigToDisk } from '../config-io.js';
import { configStatus } from './config-status.js';

// --- Adapter metadata ---

interface AdapterMeta {
  key: string;
  name: string;
  description: string;
  cost: string;
  signupUrl: string;
}

const OPTIONAL_ADAPTERS: AdapterMeta[] = [
  { key: 'pearch', name: 'Pearch', description: '810M+ structured profiles', cost: 'credit-based', signupUrl: 'https://pearch.io' },
  { key: 'x', name: 'X/Twitter', description: 'Social signals', cost: '$100/mo basic', signupUrl: 'https://developer.x.com' },
  { key: 'hunter', name: 'Hunter.io', description: 'Email verification', cost: '25 free/mo', signupUrl: 'https://hunter.io/api' },
  { key: 'contactout', name: 'ContactOut', description: 'Emails + phone', cost: 'from $29/mo', signupUrl: 'https://contactout.com/api' },
  { key: 'pdl', name: 'PDL', description: 'Broad professional data', cost: 'from $0.01/rec', signupUrl: 'https://peopledatalabs.com' },
];

// --- Wizard ---

export async function runInit(): Promise<void> {
  console.log('');
  console.log(chalk.bold('Sourcerer Setup'));
  console.log(chalk.dim('━'.repeat(30)));
  console.log('');
  console.log('Configure your data sources and AI provider.');
  console.log('You can change these later with `sourcerer config`.');
  console.log('');

  // Check existing config
  if (await configFileExists()) {
    const overwrite = await confirm({
      message: `A config already exists at ${CONFIG_PATH}. Overwrite?`,
      default: false,
    });
    if (!overwrite) {
      console.log('Run `sourcerer config` to modify your existing config.');
      return;
    }
    console.log('');
  }

  // Step 1: AI Provider (required)
  console.log(chalk.bold('1. AI Provider'));
  console.log(chalk.dim('   Required for intake conversation and scoring.'));
  console.log('');

  const aiName = await select<AIProviderName>({
    message: 'Which AI provider?',
    choices: [
      { value: 'anthropic', name: 'Anthropic (Claude) — recommended' },
      { value: 'openai', name: 'OpenAI (GPT)' },
    ],
  });

  const aiApiKey = await input({
    message: `Paste your ${aiName === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key:`,
    validate: (val) => val.trim().length > 0 || 'API key cannot be empty',
  });

  console.log('');

  // Step 2: Exa (required)
  console.log(chalk.bold('2. Exa — Discovery Engine'));
  console.log(chalk.dim('   Required. AI web search for finding candidates.'));
  console.log(chalk.dim(`   Sign up: https://exa.ai`));
  console.log(chalk.dim('   Cost: ~$5 per 1,000 queries'));
  console.log('');

  const exaApiKey = await input({
    message: 'Paste your Exa API key:',
    validate: (val) => val.trim().length > 0 || 'Exa API key is required',
  });

  console.log('');

  // Step 3: Optional adapters
  console.log(chalk.bold('3. Optional Enrichment Adapters'));
  console.log(chalk.dim('   GitHub is free and auto-enabled. Select any additional sources:'));
  console.log('');

  const selectedAdapters = await checkbox({
    message: 'Enable additional adapters:',
    choices: OPTIONAL_ADAPTERS.map((a) => ({
      value: a.key,
      name: `${a.name.padEnd(14)} ${a.description.padEnd(28)} ${chalk.dim(a.cost)}`,
    })),
  });

  // Collect API keys for selected adapters
  const adapterKeys: Record<string, AdapterKeyConfig> = {};
  for (const adapterKey of selectedAdapters) {
    const meta = OPTIONAL_ADAPTERS.find((a) => a.key === adapterKey)!;
    console.log('');
    console.log(chalk.dim(`   Sign up: ${meta.signupUrl}`));
    const key = await input({
      message: `Paste your ${meta.name} API key:`,
      validate: (val) => val.trim().length > 0 || `${meta.name} API key cannot be empty`,
    });
    adapterKeys[adapterKey] = { apiKey: key.trim() };
  }

  console.log('');

  // Step 4: Defaults
  console.log(chalk.bold('4. Defaults'));
  console.log('');

  const ttlDays = await input({
    message: 'PII retention TTL in days (default 90):',
    default: '90',
    validate: (val) => {
      const n = parseInt(val, 10);
      return (Number.isFinite(n) && n > 0) || 'Must be a positive number';
    },
  });

  const wantBudget = await confirm({
    message: 'Set a per-run budget limit?',
    default: false,
  });

  let maxCostUsd: number | undefined;
  if (wantBudget) {
    const budgetStr = await input({
      message: 'Max cost per run in USD:',
      validate: (val) => {
        const n = parseFloat(val);
        return (Number.isFinite(n) && n > 0) || 'Must be a positive number';
      },
    });
    maxCostUsd = parseFloat(budgetStr);
  }

  // Build config
  const rawConfig: Record<string, unknown> = {
    version: 1,
    adapters: {
      exa: { apiKey: exaApiKey.trim() },
      github: { enabled: true },
      ...adapterKeys,
    },
    aiProvider: {
      name: aiName,
      apiKey: aiApiKey.trim(),
    },
    retention: {
      ttlDays: parseInt(ttlDays, 10),
    },
    defaultOutput: 'json',
    maxCostUsd,
  };

  const config = validateConfig(rawConfig);

  // Save
  await saveConfigToDisk(config);

  console.log('');
  console.log(chalk.green.bold('Setup complete!'));
  console.log('');

  // Show status summary
  await configStatus();

  console.log('');
  console.log(`Run ${chalk.bold('sourcerer intake')} to start your first search.`);
}
