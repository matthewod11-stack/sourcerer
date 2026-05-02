import { describe, expect, it } from 'vitest';
import { parseScoreArgs } from '../commands/score.js';

describe('parseScoreArgs', () => {
  it('parses experimental batch scoring options', () => {
    expect(
      parseScoreArgs([
        '--batch',
        '--mock',
        '--json',
        '--model',
        'claude-opus-4-7',
        '--output-dir',
        '/tmp/evals',
      ]),
    ).toEqual({
      batch: true,
      mock: true,
      json: true,
      help: false,
      outputDir: '/tmp/evals',
      model: 'claude-opus-4-7',
    });
  });
});
