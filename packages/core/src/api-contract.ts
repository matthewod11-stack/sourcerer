import { z } from 'zod';

const PAYLOAD_SNIPPET_LIMIT = 2_000;
const UNKNOWN_FIELD_LIMIT = 20;

export interface ApiContractWarning {
  adapter: string;
  endpoint: string;
  unknownFields: string[];
}

export class ApiContractError extends Error {
  constructor(
    public readonly adapter: string,
    public readonly endpoint: string,
    public readonly fieldPaths: string[],
    public readonly payloadSnippet: string,
  ) {
    super(`${adapter} API contract mismatch at ${endpoint}: ${fieldPaths.join(', ')}`);
    this.name = 'ApiContractError';
  }
}

export function parseApiContractPayload<T>(
  payload: unknown,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options: {
    adapter: string;
    endpoint: string;
    warn?: (warning: ApiContractWarning) => void;
  },
): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiContractError(
      options.adapter,
      options.endpoint,
      result.error.issues.map((issue) => formatIssuePath(issue.path)),
      truncatePayload(payload),
    );
  }

  const unknownFields = findUnknownFields(payload, schema);
  if (unknownFields.length > 0) {
    options.warn?.({
      adapter: options.adapter,
      endpoint: options.endpoint,
      unknownFields,
    });
  }

  return result.data;
}

export function warnApiContractUnknownFields(warning: ApiContractWarning): void {
  const shown = warning.unknownFields.slice(0, UNKNOWN_FIELD_LIMIT);
  const suffix = warning.unknownFields.length > shown.length ? `, +${warning.unknownFields.length - shown.length} more` : '';
  console.warn(`[WARN] ${warning.adapter} API response at ${warning.endpoint} included unknown fields: ${shown.join(', ')}${suffix}`);
}

function truncatePayload(payload: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    serialized = String(payload);
  }
  if (serialized.length <= PAYLOAD_SNIPPET_LIMIT) return serialized;
  return `${serialized.slice(0, PAYLOAD_SNIPPET_LIMIT)}...<truncated>`;
}

function formatIssuePath(path: (string | number)[]): string {
  if (path.length === 0) return '<root>';
  return path.map((part, index) => (typeof part === 'number' ? `[${part}]` : index === 0 ? part : `.${part}`)).join('');
}

function findUnknownFields(payload: unknown, schema: z.ZodTypeAny, path = ''): string[] {
  const unwrapped = unwrapSchema(schema);

  if (unwrapped instanceof z.ZodArray) {
    if (!Array.isArray(payload)) return [];
    return payload.flatMap((item, index) => findUnknownFields(item, unwrapped.element, `${path}[${index}]`));
  }

  if (!(unwrapped instanceof z.ZodObject) || !isRecord(payload)) {
    return [];
  }

  const shape = unwrapped.shape;
  const unknown: string[] = [];

  for (const key of Object.keys(payload)) {
    const keyPath = path ? `${path}.${key}` : key;
    if (!(key in shape)) {
      unknown.push(keyPath);
      continue;
    }
    unknown.push(...findUnknownFields(payload[key], shape[key], keyPath));
  }

  return unknown;
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrapSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return unwrapSchema(schema._def.innerType);
  }
  return schema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
