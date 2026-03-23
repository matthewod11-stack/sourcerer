// config status — read config and display adapter connection status

import chalk from 'chalk';
import {
  CONFIG_PATH,
  ConfigValidationError,
  getConfiguredAdapters,
  type SourcererConfig,
} from '@sourcerer/core';
import { configFileExists, loadConfigFromDisk } from '../config-io.js';

const CHECK = chalk.green('✓');
const EMPTY = chalk.dim('○');

function adapterLine(name: string, configured: boolean, detail?: string): string {
  const icon = configured ? CHECK : EMPTY;
  const status = configured
    ? chalk.green(detail ?? 'configured')
    : chalk.dim('not configured');
  return `  ${icon} ${name.padEnd(14)} ${status}`;
}

function formatStatus(config: SourcererConfig): string {
  const configured = new Set(getConfiguredAdapters(config));
  const lines: string[] = [];

  lines.push(chalk.bold('Sourcerer Config Status'));
  lines.push(chalk.dim('━'.repeat(30)));
  lines.push('');

  // Discovery
  lines.push(chalk.bold('Discovery:'));
  lines.push(adapterLine('Exa', configured.has('exa')));
  lines.push(adapterLine('Pearch', configured.has('pearch')));
  lines.push('');

  // Enrichment
  lines.push(chalk.bold('Enrichment:'));
  lines.push(adapterLine('GitHub', configured.has('github'), 'enabled (free)'));
  lines.push(adapterLine('X/Twitter', configured.has('x')));
  lines.push(adapterLine('Hunter', configured.has('hunter')));
  lines.push(adapterLine('ContactOut', configured.has('contactout')));
  lines.push(adapterLine('PDL', configured.has('pdl')));
  lines.push('');

  // AI Provider
  lines.push(chalk.bold('AI Provider:'));
  const model = config.aiProvider.model ?? 'default';
  lines.push(`  ${CHECK} ${config.aiProvider.name.padEnd(14)} ${chalk.green(`configured (${model})`)}`);
  lines.push('');

  // Defaults
  lines.push(chalk.bold('Defaults:'));
  lines.push(`  Output format: ${config.defaultOutput ?? 'json'}`);
  lines.push(`  Retention TTL: ${config.retention.ttlDays} days`);
  lines.push(`  Budget limit:  ${config.maxCostUsd ? `$${config.maxCostUsd}` : 'none'}`);

  return lines.join('\n');
}

export async function configStatus(configPath?: string): Promise<void> {
  const path = configPath ?? CONFIG_PATH;

  if (!(await configFileExists(path))) {
    console.log(`No config found at ${path}`);
    console.log('Run `sourcerer init` to get started.');
    return;
  }

  try {
    const config = await loadConfigFromDisk(path);
    console.log(formatStatus(config));
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error(chalk.red('Invalid config:'));
      for (const e of err.errors) {
        console.error(chalk.red(`  - ${e}`));
      }
    } else {
      console.error(chalk.red(`Failed to read config: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exitCode = 1;
  }
}
