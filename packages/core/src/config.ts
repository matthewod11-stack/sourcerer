// Config system — types, validation, and defaults for ~/.sourcerer/config.yaml

import { join } from 'node:path';
import { homedir } from 'node:os';

// --- Types ---

export interface AdapterKeyConfig {
  apiKey: string;
}

export interface GitHubAdapterConfig {
  enabled: boolean;
}

export type AIProviderName = 'anthropic' | 'openai';
export type OutputFormat = 'json' | 'csv' | 'markdown' | 'notion';

export interface SourcererConfig {
  version: 1;

  adapters: {
    exa: AdapterKeyConfig;
    pearch?: AdapterKeyConfig;
    github?: GitHubAdapterConfig;
    x?: AdapterKeyConfig;
    hunter?: AdapterKeyConfig;
    contactout?: AdapterKeyConfig;
    pdl?: AdapterKeyConfig;
  };

  aiProvider: {
    name: AIProviderName;
    apiKey: string;
    model?: string;
  };

  retention: {
    ttlDays: number;
  };

  defaultOutput?: OutputFormat;
  maxCostUsd?: number;
}

// --- Constants ---

export const CONFIG_DIR = join(homedir(), '.sourcerer');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.yaml');

export const KNOWN_ADAPTERS = [
  'exa', 'pearch', 'github', 'x', 'hunter', 'contactout', 'pdl',
] as const;

export const AI_PROVIDER_NAMES: readonly AIProviderName[] = ['anthropic', 'openai'];

export const DEFAULT_RETENTION_TTL_DAYS = 90;
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'json';

// --- Validation Error ---

export class ConfigValidationError extends Error {
  errors: string[];

  constructor(errors: string[]) {
    super(`Invalid config\n  - ${errors.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

// --- Validation ---

export function validateConfig(raw: unknown): SourcererConfig {
  const errors: string[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    throw new ConfigValidationError(['Config must be a non-null object']);
  }

  const obj = raw as Record<string, unknown>;

  // Version
  if (obj.version !== undefined && obj.version !== 1) {
    errors.push(`Unsupported config version: ${String(obj.version)}. Expected 1.`);
  }

  // Adapters
  if (!obj.adapters || typeof obj.adapters !== 'object') {
    errors.push('Missing required field: adapters');
  } else {
    const adapters = obj.adapters as Record<string, unknown>;

    // Exa is required
    if (!adapters.exa || typeof adapters.exa !== 'object') {
      errors.push('Missing required field: adapters.exa');
    } else {
      const exa = adapters.exa as Record<string, unknown>;
      if (!exa.apiKey || typeof exa.apiKey !== 'string' || exa.apiKey.trim() === '') {
        errors.push('adapters.exa.apiKey must be a non-empty string');
      }
    }

    // Validate optional adapter keys
    for (const name of ['pearch', 'x', 'hunter', 'contactout', 'pdl'] as const) {
      if (adapters[name] && typeof adapters[name] === 'object') {
        const adapter = adapters[name] as Record<string, unknown>;
        if ('apiKey' in adapter && (typeof adapter.apiKey !== 'string' || adapter.apiKey.trim() === '')) {
          errors.push(`adapters.${name}.apiKey must be a non-empty string`);
        }
      }
    }
  }

  // AI Provider
  if (!obj.aiProvider || typeof obj.aiProvider !== 'object') {
    errors.push('Missing required field: aiProvider');
  } else {
    const ai = obj.aiProvider as Record<string, unknown>;
    if (!ai.name || !AI_PROVIDER_NAMES.includes(ai.name as AIProviderName)) {
      errors.push(
        `aiProvider.name must be one of: ${AI_PROVIDER_NAMES.join(', ')}` +
        (ai.name ? ` (got: "${String(ai.name)}")` : ''),
      );
    }
    if (!ai.apiKey || typeof ai.apiKey !== 'string' || ai.apiKey.trim() === '') {
      errors.push('aiProvider.apiKey must be a non-empty string');
    }
  }

  // Retention
  if (obj.retention && typeof obj.retention === 'object') {
    const ret = obj.retention as Record<string, unknown>;
    if (ret.ttlDays !== undefined && (typeof ret.ttlDays !== 'number' || ret.ttlDays <= 0)) {
      errors.push('retention.ttlDays must be a positive number');
    }
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }

  return applyDefaults(obj as Partial<SourcererConfig>);
}

// --- Defaults ---

export function applyDefaults(partial: Partial<SourcererConfig>): SourcererConfig {
  const adapters = (partial.adapters ?? {}) as SourcererConfig['adapters'];

  return {
    version: 1,
    adapters: {
      ...adapters,
      github: adapters.github ?? { enabled: true },
    },
    aiProvider: partial.aiProvider!,
    retention: {
      ttlDays: partial.retention?.ttlDays ?? DEFAULT_RETENTION_TTL_DAYS,
    },
    defaultOutput: partial.defaultOutput ?? DEFAULT_OUTPUT_FORMAT,
    maxCostUsd: partial.maxCostUsd,
  };
}

// --- Utilities ---

export function getConfiguredAdapters(config: SourcererConfig): string[] {
  const configured: string[] = [];
  const adapters = config.adapters as Record<string, unknown>;
  for (const name of KNOWN_ADAPTERS) {
    const adapter = adapters[name];
    if (!adapter) continue;
    if (typeof adapter === 'object' && adapter !== null) {
      const a = adapter as Record<string, unknown>;
      if ('apiKey' in a && a.apiKey) {
        configured.push(name);
      } else if ('enabled' in a && a.enabled) {
        configured.push(name);
      }
    }
  }
  return configured;
}

export function getAdapterApiKey(
  config: SourcererConfig,
  adapter: string,
): string | undefined {
  const adapters = config.adapters as Record<string, unknown>;
  const a = adapters[adapter];
  if (a && typeof a === 'object' && a !== null && 'apiKey' in a) {
    return (a as AdapterKeyConfig).apiKey;
  }
  return undefined;
}
