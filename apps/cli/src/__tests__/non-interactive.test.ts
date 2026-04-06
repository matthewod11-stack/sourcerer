import { describe, it, expect } from 'vitest';
import { parseArgs } from '../commands/run.js';

describe('parseArgs — new flags', () => {
  it('recognizes --yes', () => {
    const result = parseArgs(['--config', 'search.yaml', '--yes']);
    expect(result.yes).toBe(true);
    expect(result.configPath).toBe('search.yaml');
  });

  it('recognizes -y', () => {
    const result = parseArgs(['--config', 'search.yaml', '-y']);
    expect(result.yes).toBe(true);
  });

  it('recognizes --no-interactive', () => {
    const result = parseArgs(['--config', 'search.yaml', '--no-interactive']);
    expect(result.noInteractive).toBe(true);
  });

  it('recognizes --quiet', () => {
    const result = parseArgs(['--config', 'search.yaml', '--quiet']);
    expect(result.quiet).toBe(true);
  });

  it('recognizes -q', () => {
    const result = parseArgs(['--config', 'search.yaml', '-q']);
    expect(result.quiet).toBe(true);
  });

  it('defaults new flags to false', () => {
    const result = parseArgs(['--config', 'search.yaml']);
    expect(result.yes).toBe(false);
    expect(result.noInteractive).toBe(false);
    expect(result.quiet).toBe(false);
  });

  it('combines multiple new flags', () => {
    const result = parseArgs(['--config', 'search.yaml', '--no-interactive', '-q']);
    expect(result.noInteractive).toBe(true);
    expect(result.quiet).toBe(true);
  });
});

describe('runCommand validation — non-interactive', () => {
  // We test the validation logic indirectly through runCommand by capturing console output.
  // These tests verify the error messages for invalid flag combinations.

  function captureConsole(): { output: string[]; restore: () => void } {
    const output: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => output.push(args.join(' '));
    console.error = (...args: unknown[]) => output.push(args.join(' '));
    return {
      output,
      restore: () => {
        console.log = origLog;
        console.error = origError;
      },
    };
  }

  it('--no-interactive with --intake and no --config errors', async () => {
    const { runCommand } = await import('../commands/run.js');
    const { output, restore } = captureConsole();
    const prevExitCode = process.exitCode;
    try {
      await runCommand(['--no-interactive', '--intake']);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('--no-interactive with --intake requires --config');
    expect(process.exitCode).toBe(1);
    process.exitCode = prevExitCode;
  });

  it('--no-interactive without --config or --resume errors', async () => {
    const { runCommand } = await import('../commands/run.js');
    const { output, restore } = captureConsole();
    const prevExitCode = process.exitCode;
    try {
      await runCommand(['--no-interactive']);
    } finally {
      restore();
    }

    const fullOutput = output.join('\n');
    expect(fullOutput).toContain('--no-interactive requires --config');
    expect(process.exitCode).toBe(1);
    process.exitCode = prevExitCode;
  });

  it('--no-interactive with --config passes validation', () => {
    // Just verify parseArgs doesn't error — the actual pipeline needs real config
    const result = parseArgs(['--no-interactive', '--config', 'search.yaml']);
    expect(result.noInteractive).toBe(true);
    expect(result.configPath).toBe('search.yaml');
  });

  it('--no-interactive with --resume passes validation', () => {
    const result = parseArgs(['--no-interactive', '--resume', '/tmp/runs/some-run']);
    expect(result.noInteractive).toBe(true);
    expect(result.resumeFrom).toBe('/tmp/runs/some-run');
  });
});
