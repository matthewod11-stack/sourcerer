import { describe, expect, it } from 'vitest';

import { createJsonLogger, redactLogFields } from '../logger.js';

describe('structured logger', () => {
  it('emits one JSON line per event', () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      sink: (line) => lines.push(line),
      now: () => new Date('2026-05-01T12:00:00.000Z'),
    });

    logger.info('phase.start', { phase: 'discover', runId: 'run-1' });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      level: 30,
      event: 'phase.start',
      phase: 'discover',
      runId: 'run-1',
      timestamp: '2026-05-01T12:00:00.000Z',
    });
  });

  it('redacts PII-shaped fields before writing logs', () => {
    const safe = redactLogFields({
      candidateEmail: 'alice@example.com',
      phone: '(415) 555-1234',
      pii: 'sensitive blob',
      piiField: { type: 'email', value: 'bob@example.com' },
    });

    expect(safe.candidateEmail).toBe('al***@example.com');
    expect(safe.phone).toBe('***-1234');
    expect(safe.pii).toBe('[REDACTED]');
    expect(safe.piiField).toMatchObject({
      type: 'email',
      value: 'bo***@example.com',
    });
  });
});
