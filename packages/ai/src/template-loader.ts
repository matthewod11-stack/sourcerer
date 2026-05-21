// Template loader — reads .md prompt templates and interpolates variables

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** Context map for template interpolation */
export type TemplateContext = Record<string, string>;

export interface PromptMetadata {
  name: string;
  version: number;
  changelog: string;
}

export interface PromptTemplate {
  metadata: PromptMetadata;
  content: string;
}

export interface RenderedTemplate {
  metadata: PromptMetadata;
  content: string;
}

/**
 * Interpolate `{{variableName}}` placeholders in a template string.
 * Throws if any placeholder has no corresponding value in the context.
 */
export function interpolate(
  template: string,
  context: TemplateContext,
): string {
  const missing: string[] = [];

  const result = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (key in context) {
      return context[key];
    }
    missing.push(key);
    return `{{${key}}}`;
  });

  if (missing.length > 0) {
    throw new Error(`Missing template variables: ${missing.join(', ')}`);
  }

  return result;
}

/**
 * Resolve the absolute path to the prompts directory.
 * Located at `packages/ai/prompts/` relative to this file's package root.
 */
export function getPromptsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const srcDir = dirname(thisFile);
  const packageRoot = dirname(srcDir);
  return join(packageRoot, 'prompts');
}

/**
 * Load a prompt template by name (without extension).
 * Reads `packages/ai/prompts/{name}.md` and returns front-matter plus content.
 */
export async function loadTemplate(name: string): Promise<PromptTemplate> {
  const promptsDir = getPromptsDir();
  const filePath = join(promptsDir, `${name}.md`);

  try {
    return parsePromptTemplate(name, await readFile(filePath, 'utf-8'));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `Prompt template not found: ${name} (looked at ${filePath})`,
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * Load a prompt template by name and interpolate with the given context.
 */
export async function renderTemplate(
  name: string,
  context: TemplateContext,
): Promise<RenderedTemplate> {
  const template = await loadTemplate(name);
  return {
    metadata: template.metadata,
    content: interpolate(template.content, context),
  };
}

/**
 * List all available template names (without extension).
 */
export async function listTemplates(): Promise<string[]> {
  const promptsDir = getPromptsDir();
  try {
    const files = await readdir(promptsDir);
    return files
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort();
  } catch {
    return [];
  }
}

export function parsePromptTemplate(name: string, raw: string): PromptTemplate {
  if (!raw.startsWith('---\n')) {
    throw new Error(`Prompt template ${name} is missing YAML front-matter`);
  }

  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error(
      `Prompt template ${name} has unterminated YAML front-matter`,
    );
  }

  const metadata = parseFrontMatter(name, raw.slice(4, end));
  const content = raw.slice(end + '\n---\n'.length).replace(/^\n/, '');
  return { metadata, content };
}

function parseFrontMatter(name: string, frontMatter: string): PromptMetadata {
  const values: Record<string, string> = {};
  for (const line of frontMatter.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      throw new Error(
        `Invalid front-matter line in prompt template ${name}: ${line}`,
      );
    }
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    values[key] = value.replace(/^['"]|['"]$/g, '');
  }

  const version = Number(values.version);
  if (!values.name || values.name !== name) {
    throw new Error(
      `Prompt template ${name} front-matter name must be "${name}"`,
    );
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(
      `Prompt template ${name} front-matter version must be a positive integer`,
    );
  }
  if (!values.changelog) {
    throw new Error(
      `Prompt template ${name} front-matter changelog is required`,
    );
  }

  return {
    name: values.name,
    version,
    changelog: values.changelog,
  };
}
