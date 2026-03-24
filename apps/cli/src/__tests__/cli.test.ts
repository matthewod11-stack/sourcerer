import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { configFileExists, loadConfigFromDisk, saveConfigToDisk } from '../config-io.js';
import { showHelp, showVersion, showUnknownCommand } from '../commands/help.js';
import { isStubCommand, runStub } from '../commands/stubs.js';
import { configStatus } from '../commands/config-status.js';
import type { SourcererConfig } from '@sourcerer/core';

// --- Helpers ---

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'sourcerer-cli-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeValidConfig(): SourcererConfig {
  return {
    version: 1,
    adapters: {
      exa: { apiKey: 'exa-test-key' },
      github: { enabled: true },
    },
    aiProvider: {
      name: 'anthropic',
      apiKey: 'anthropic-test-key',
      model: 'claude-3-sonnet',
    },
    retention: { ttlDays: 90 },
    defaultOutput: 'json',
  };
}

function makeFullConfig(): SourcererConfig {
  return {
    version: 1,
    adapters: {
      exa: { apiKey: 'exa-key' },
      pearch: { apiKey: 'pearch-key' },
      github: { enabled: true },
      x: { apiKey: 'x-key' },
      hunter: { apiKey: 'hunter-key' },
      contactout: { apiKey: 'contactout-key' },
      pdl: { apiKey: 'pdl-key' },
    },
    aiProvider: {
      name: 'openai',
      apiKey: 'openai-key',
      model: 'gpt-4o',
    },
    retention: { ttlDays: 30 },
    defaultOutput: 'csv',
    maxCostUsd: 10.0,
  };
}

// --- Config I/O Tests ---

describe('Config I/O', () => {
  it('round-trips config through save and load', async () => {
    const configPath = join(tmpDir, 'config.yaml');
    const config = makeValidConfig();

    await saveConfigToDisk(config, configPath);
    const loaded = await loadConfigFromDisk(configPath);

    expect(loaded.adapters.exa.apiKey).toBe('exa-test-key');
    expect(loaded.aiProvider.name).toBe('anthropic');
    expect(loaded.retention.ttlDays).toBe(90);
  });

  it('configFileExists returns false for missing file', async () => {
    const exists = await configFileExists(join(tmpDir, 'nonexistent.yaml'));
    expect(exists).toBe(false);
  });

  it('configFileExists returns true for existing file', async () => {
    const configPath = join(tmpDir, 'config.yaml');
    await saveConfigToDisk(makeValidConfig(), configPath);
    const exists = await configFileExists(configPath);
    expect(exists).toBe(true);
  });

  it('saves full config with all adapters', async () => {
    const configPath = join(tmpDir, 'full-config.yaml');
    await saveConfigToDisk(makeFullConfig(), configPath);
    const loaded = await loadConfigFromDisk(configPath);
    expect(loaded.adapters.hunter?.apiKey).toBe('hunter-key');
    expect(loaded.maxCostUsd).toBe(10.0);
  });
});

// --- Command Routing Tests ---

describe('Help command', () => {
  it('showHelp outputs command list', () => {
    const log: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => log.push(args.join(' '));
    showHelp();
    console.log = orig;

    const output = log.join('\n');
    expect(output).toContain('sourcerer');
    expect(output).toContain('init');
    expect(output).toContain('config');
    expect(output).toContain('run');
    expect(output).toContain('intake');
    expect(output).toContain('results');
  });

  it('showVersion outputs version', () => {
    const log: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => log.push(args.join(' '));
    showVersion();
    console.log = orig;
    expect(log[0]).toContain('0.0.0');
  });
});

describe('Stub commands', () => {
  it('isStubCommand recognizes valid commands', () => {
    expect(isStubCommand('candidates')).toBe(true);
  });

  it('isStubCommand rejects unknown commands', () => {
    expect(isStubCommand('unknown')).toBe(false);
    expect(isStubCommand('config')).toBe(false);
  });

  it('runStub prints not yet implemented', () => {
    const log: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => log.push(args.join(' '));
    runStub('run');
    console.log = orig;
    expect(log[0]).toContain('not yet implemented');
  });
});

// --- Config Status Tests ---

describe('Config status', () => {
  it('displays status for valid config', async () => {
    const configPath = join(tmpDir, 'config.yaml');
    await saveConfigToDisk(makeValidConfig(), configPath);

    const log: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => log.push(args.join(' '));
    await configStatus(configPath);
    console.log = orig;

    const output = log.join('\n');
    expect(output).toContain('Exa');
    expect(output).toContain('configured');
    expect(output).toContain('GitHub');
    expect(output).toContain('anthropic');
    expect(output).toContain('90 days');
  });

  it('shows helpful message when no config exists', async () => {
    const configPath = join(tmpDir, 'missing.yaml');
    const log: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => log.push(args.join(' '));
    await configStatus(configPath);
    console.log = orig;

    const output = log.join('\n');
    expect(output).toContain('No config found');
    expect(output).toContain('sourcerer init');
  });

  it('shows all adapters for full config', async () => {
    const configPath = join(tmpDir, 'full.yaml');
    await saveConfigToDisk(makeFullConfig(), configPath);

    const log: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => log.push(args.join(' '));
    await configStatus(configPath);
    console.log = orig;

    const output = log.join('\n');
    expect(output).toContain('Hunter');
    expect(output).toContain('PDL');
    expect(output).toContain('openai');
    expect(output).toContain('30 days');
    expect(output).toContain('$10');
  });
});
