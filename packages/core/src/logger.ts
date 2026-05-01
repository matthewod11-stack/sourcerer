// Structured logger abstraction for pipeline telemetry.

import pino from 'pino';

import type { PIIFieldType } from './candidate.js';
import { redactPII } from './pii-redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface SourcererLogger {
  debug(event: string, fields: LogFields): void;
  info(event: string, fields: LogFields): void;
  warn(event: string, fields: LogFields): void;
  error(event: string, fields: LogFields): void;
}

export interface JsonLoggerOptions {
  sink?: (line: string) => void;
  now?: () => Date;
  minLevel?: LogLevel;
  redact?: boolean;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createNoopLogger(): SourcererLogger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

export function createJsonLogger(
  options: JsonLoggerOptions = {},
): SourcererLogger {
  const sink = options.sink ?? ((line: string) => console.error(line));
  const now = options.now ?? (() => new Date());
  const minLevel = options.minLevel ?? 'info';
  const shouldRedact = options.redact ?? true;

  const logger = pino(
    {
      base: null,
      level: minLevel,
      timestamp: false,
    },
    {
      write(line: string) {
        sink(line.endsWith('\n') ? line.slice(0, -1) : line);
      },
    },
  );

  const emit = (level: LogLevel, event: string, fields: LogFields): void => {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) return;
    const safeFields = shouldRedact ? redactLogFields(fields) : fields;
    logger[level]({
      ...safeFields,
      event,
      timestamp: now().toISOString(),
    });
  };

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}

export function redactLogFields(fields: LogFields): LogFields {
  return redactRecord(fields);
}

function redactRecord(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      redactValue(key, value),
    ]),
  );
}

function redactValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    return redactStringByKey(key, value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(key, item));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fieldType = normalizePIIFieldType(record.type);
    if (fieldType && typeof record.value === 'string') {
      return {
        ...redactRecord(record),
        value: redactPII(record.value, fieldType),
      };
    }
    return redactRecord(record);
  }

  return value;
}

function redactStringByKey(key: string, value: string): string {
  const normalized = key.toLowerCase();
  if (normalized.includes('email')) return redactPII(value, 'email');
  if (normalized.includes('phone')) return redactPII(value, 'phone');
  if (normalized.includes('address')) return redactPII(value, 'address');
  if (normalized.includes('pii')) return '[REDACTED]';
  return value;
}

function normalizePIIFieldType(value: unknown): PIIFieldType | undefined {
  return value === 'email' || value === 'phone' || value === 'address'
    ? value
    : undefined;
}
