import { describe, expect, it } from 'vitest';
import { parseEvalArgs } from '../commands/eval.js';

describe('parseEvalArgs', () => {
  it('parses eval command options', () => {
    expect(
      parseEvalArgs(['--mock', '--json', '--output-dir', '/tmp/evals']),
    ).toEqual({
      outputDir: '/tmp/evals',
      model: undefined,
      batch: false,
      mock: true,
      json: true,
      help: false,
    });
  });

  it('parses batch comparison options', () => {
    expect(
      parseEvalArgs(['--batch', '--model', 'claude-opus-4-7']),
    ).toEqual({
      outputDir: undefined,
      model: 'claude-opus-4-7',
      batch: true,
      mock: false,
      json: false,
      help: false,
    });
  });
});
