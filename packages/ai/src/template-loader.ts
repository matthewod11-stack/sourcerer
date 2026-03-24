// Template loader — reads .md prompt templates and interpolates variables

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** Context map for template interpolation */
export type TemplateContext = Record<string, string>;

/**
 * Interpolate `{{variableName}}` placeholders in a template string.
 * Throws if any placeholder has no corresponding value in the context.
 */
export function interpolate(template: string, context: TemplateContext): string {
  const missing: string[] = [];

  const result = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (key in context) {
      return context[key];
    }
    missing.push(key);
    return `{{${key}}}`;
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing template variables: ${missing.join(', ')}`,
    );
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
 * Reads `packages/ai/prompts/{name}.md` and returns the raw template string.
 */
export async function loadTemplate(name: string): Promise<string> {
  const promptsDir = getPromptsDir();
  const filePath = join(promptsDir, `${name}.md`);

  try {
    return await readFile(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`Prompt template not found: ${name} (looked at ${filePath})`);
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
): Promise<string> {
  const template = await loadTemplate(name);
  return interpolate(template, context);
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
