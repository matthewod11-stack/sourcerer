// Config system — types, validation, and defaults for ~/.sourcerer/config.yaml
//
// H-5: validation backed by a Zod schema (replaces ~70 lines of hand-rolled
// type assertions). `validateConfig` keeps its public signature and the
// `ConfigValidationError` class is unchanged; ZodError issues are mapped to
// path-prefixed strings so existing test substrings ("adapters.exa",
// "aiProvider.name", etc.) keep matching.

import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';

// --- Constants ---

export const CONFIG_DIR = join(homedir(), '.sourcerer');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.yaml');

export const KNOWN_ADAPTERS = [
  'exa', 'pearch', 'github', 'x', 'hunter', 'contactout', 'pdl',
] as const;

export const AI_PROVIDER_NAMES = ['anthropic', 'openai'] as const;
export type AIProviderName = (typeof AI_PROVIDER_NAMES)[number];

export const DEFAULT_RETENTION_TTL_DAYS = 90;
export const DEFAULT_OUTPUT_FORMAT = 'json' as const;

// --- Validation Error ---

export class ConfigValidationError extends Error {
  errors: string[];

  constructor(errors: string[]) {
    super(`Invalid config\n  - ${errors.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

// --- Schema ---

// `apiKey` must be a non-empty, non-whitespace string. Refine instead of
// .min(1) so "  " (whitespace-only) is also rejected, matching the pre-Zod
// behavior.
const ApiKeyString = z
  .string()
  .refine((s) => s.trim().length > 0, {
    message: 'apiKey must be a non-empty string',
  });

const AdapterKeyConfigSchema = z.object({ apiKey: ApiKeyString });
const GitHubAdapterConfigSchema = z.object({ enabled: z.boolean() });

const AIProviderNameSchema = z.enum(AI_PROVIDER_NAMES, {
  errorMap: (issue, ctx) => {
    if (issue.code === 'invalid_enum_value') {
      return {
        message: `must be one of: ${AI_PROVIDER_NAMES.join(', ')} (got: "${String(ctx.data)}")`,
      };
    }
    return { message: ctx.defaultError };
  },
});

const OutputFormatSchema = z.enum(['json', 'csv', 'markdown', 'notion']);

export const SourcererConfigSchema = z.object({
  version: z.literal(1).default(1),

  adapters: z.object({
    exa: AdapterKeyConfigSchema,
    pearch: AdapterKeyConfigSchema.optional(),
    github: GitHubAdapterConfigSchema.default({ enabled: true }),
    x: AdapterKeyConfigSchema.optional(),
    hunter: AdapterKeyConfigSchema.optional(),
    contactout: AdapterKeyConfigSchema.optional(),
    pdl: AdapterKeyConfigSchema.optional(),
  }),

  aiProvider: z.object({
    name: AIProviderNameSchema,
    apiKey: ApiKeyString,
    model: z.string().optional(),
  }),

  retention: z
    .object({
      ttlDays: z
        .number()
        .positive('ttlDays must be a positive number')
        .default(DEFAULT_RETENTION_TTL_DAYS),
    })
    .default({ ttlDays: DEFAULT_RETENTION_TTL_DAYS }),

  defaultOutput: OutputFormatSchema.default(DEFAULT_OUTPUT_FORMAT),
  maxCostUsd: z.number().optional(),
});

// --- Public types (inferred from schema) ---

export type AdapterKeyConfig = z.infer<typeof AdapterKeyConfigSchema>;
export type GitHubAdapterConfig = z.infer<typeof GitHubAdapterConfigSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export type SourcererConfig = z.infer<typeof SourcererConfigSchema>;

// --- Validation ---

export function validateConfig(raw: unknown): SourcererConfig {
  const result = SourcererConfigSchema.safeParse(raw);
  if (result.success) return result.data;

  const messages = result.error.issues.map((issue) =>
    issue.path.length > 0
      ? `${issue.path.join('.')}: ${issue.message}`
      : issue.message,
  );
  throw new ConfigValidationError(messages);
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
