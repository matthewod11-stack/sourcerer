// config show — display current config YAML

import chalk from 'chalk';
import yaml from 'js-yaml';
import { CONFIG_PATH } from '@sourcerer/core';
import { configFileExists, loadConfigFromDisk } from '../config-io.js';

export async function configShow(): Promise<void> {
  if (!(await configFileExists())) {
    console.log(`No config found at ${CONFIG_PATH}`);
    console.log('Run `sourcerer init` to get started.');
    return;
  }

  try {
    const config = await loadConfigFromDisk();
    console.log(chalk.bold(`Config: ${CONFIG_PATH}`));
    console.log(chalk.dim('━'.repeat(30)));
    console.log('');
    // Redact API keys for display
    const display = JSON.parse(JSON.stringify(config));
    if (display.adapters) {
      for (const [name, adapter] of Object.entries(display.adapters)) {
        if (adapter && typeof adapter === 'object' && 'apiKey' in adapter) {
          (adapter as Record<string, unknown>).apiKey = '***redacted***';
        }
      }
    }
    if (display.aiProvider?.apiKey) {
      display.aiProvider.apiKey = '***redacted***';
    }
    console.log(yaml.dump(display, { indent: 2, lineWidth: 120 }));
  } catch (err) {
    console.error(chalk.red(`Failed to read config: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
