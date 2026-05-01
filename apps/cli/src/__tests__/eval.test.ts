import { describe, expect, it } from 'vitest';
import { parseEvalArgs } from '../commands/eval.js';

describe('parseEvalArgs', () => {
  it('parses eval command options', () => {
    expect(
      parseEvalArgs(['--mock', '--json', '--output-dir', '/tmp/evals']),
    ).toEqual({
      outputDir: '/tmp/evals',
      mock: true,
      json: true,
      help: false,
    });
  });
});
