// Config file I/O — reads/writes ~/.sourcerer/config.yaml

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import yaml from 'js-yaml';
import {
  CONFIG_PATH,
  CONFIG_DIR,
  validateConfig,
  type SourcererConfig,
} from '@sourcerer/core';

export async function configFileExists(path?: string): Promise<boolean> {
  try {
    await access(path ?? CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfigFromDisk(path?: string): Promise<SourcererConfig> {
  const configPath = path ?? CONFIG_PATH;
  const content = await readFile(configPath, 'utf-8');
  const raw = yaml.load(content);
  return validateConfig(raw);
}

export async function saveConfigToDisk(
  config: SourcererConfig,
  path?: string,
): Promise<void> {
  const configPath = path ?? CONFIG_PATH;
  await mkdir(dirname(configPath), { recursive: true });
  const content = yaml.dump(config, { indent: 2, lineWidth: 120 });
  await writeFile(configPath, content, 'utf-8');
}
