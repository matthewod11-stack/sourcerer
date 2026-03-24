import { describe, it, expect } from 'vitest';
import {
  interpolate,
  loadTemplate,
  renderTemplate,
  listTemplates,
  getPromptsDir,
} from '../template-loader.js';
import { join } from 'node:path';

describe('interpolate', () => {
  it('replaces single variable', () => {
    const result = interpolate('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('replaces multiple variables', () => {
    const result = interpolate(
      '{{greeting}} {{name}}, you are {{adjective}}.',
      { greeting: 'Hello', name: 'Alice', adjective: 'great' },
    );
    expect(result).toBe('Hello Alice, you are great.');
  });

  it('replaces same variable multiple times', () => {
    const result = interpolate('{{x}} and {{x}} again', { x: 'yes' });
    expect(result).toBe('yes and yes again');
  });

  it('throws on missing variables', () => {
    expect(() => interpolate('Hello {{name}} {{age}}!', { name: 'Alice' })).toThrow(
      'Missing template variables: age',
    );
  });

  it('throws listing all missing variables', () => {
    expect(() => interpolate('{{a}} {{b}} {{c}}', {})).toThrow(
      'Missing template variables: a, b, c',
    );
  });

  it('returns template unchanged when no placeholders', () => {
    const template = 'No variables here.';
    expect(interpolate(template, {})).toBe(template);
  });

  it('handles empty context with no placeholders', () => {
    expect(interpolate('plain text', {})).toBe('plain text');
  });

  it('handles multiline templates', () => {
    const template = 'Line 1: {{a}}\nLine 2: {{b}}\nLine 3: {{a}}';
    const result = interpolate(template, { a: 'X', b: 'Y' });
    expect(result).toBe('Line 1: X\nLine 2: Y\nLine 3: X');
  });
});

describe('getPromptsDir', () => {
  it('returns a path ending in packages/ai/prompts', () => {
    const dir = getPromptsDir();
    expect(dir).toContain(join('packages', 'ai', 'prompts'));
  });
});

describe('loadTemplate', () => {
  it('loads an existing template', async () => {
    const content = await loadTemplate('intake-role-parse');
    expect(content).toContain('job description');
    expect(content).toContain('{{jobDescription}}');
  });

  it('throws for non-existent template', async () => {
    await expect(loadTemplate('nonexistent-template')).rejects.toThrow(
      'Prompt template not found: nonexistent-template',
    );
  });
});

describe('renderTemplate', () => {
  it('loads and interpolates a template', async () => {
    const result = await renderTemplate('intake-role-parse', {
      jobDescription: 'Senior TypeScript Engineer at Acme Corp',
    });
    expect(result).toContain('Senior TypeScript Engineer at Acme Corp');
    expect(result).not.toContain('{{jobDescription}}');
  });

  it('throws on missing variables', async () => {
    await expect(renderTemplate('intake-role-parse', {})).rejects.toThrow(
      'Missing template variables',
    );
  });
});

describe('listTemplates', () => {
  it('lists all 6 templates', async () => {
    const templates = await listTemplates();
    expect(templates).toContain('intake-role-parse');
    expect(templates).toContain('intake-company-analyze');
    expect(templates).toContain('intake-success-profile');
    expect(templates).toContain('intake-config-generate');
    expect(templates).toContain('scoring-signal-extract');
    expect(templates).toContain('scoring-narrative');
    expect(templates).toHaveLength(6);
  });

  it('returns sorted names', async () => {
    const templates = await listTemplates();
    const sorted = [...templates].sort();
    expect(templates).toEqual(sorted);
  });
});
