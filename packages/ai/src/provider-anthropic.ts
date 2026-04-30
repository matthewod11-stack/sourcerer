// Anthropic (Claude) provider — implements AIProvider using @anthropic-ai/sdk

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type {
  AIProvider,
  Message,
  ChatOptions,
  ChatResult,
  StructuredOutputOptions,
  StructuredOutputResult,
  TokenUsage,
} from '@sourcerer/core';
import type { ResponseCache } from './response-cache.js';
import { generateCacheKey } from './response-cache.js';

/** Default model for the Anthropic provider — Sonnet 4.6 (H-4) */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Maximum retries for structured output parse/validation failures */
const MAX_STRUCTURED_RETRIES = 2;

/** Configuration for the Anthropic provider */
export interface AnthropicProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
  cache?: ResponseCache;
}

/**
 * Determine if an error is retryable (rate limit, server error, connection error).
 * Uses status-code-based detection to work correctly with both real and mocked SDKs.
 */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Check by error name (works with SDK error classes and mocks)
  const name = err.name ?? '';
  if (name === 'APIConnectionError') return true;

  // Check by HTTP status code
  if ('status' in err) {
    const status = (err as { status: number }).status;
    return status >= 500 || status === 429;
  }

  return false;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries || !isRetryableError(err)) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Convert core Message format to Anthropic API format.
 * Anthropic separates system messages from the messages array.
 */
function splitMessages(messages: Message[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let system: string | undefined;
  const apiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
    } else {
      apiMessages.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: apiMessages };
}

/**
 * Anthropic provider implementation of AIProvider.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly defaultModel: string;
  private readonly cache?: ResponseCache;

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.defaultModel = config.model ?? DEFAULT_MODEL;
    this.cache = config.cache;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResult> {
    const model = options?.model ?? this.defaultModel;

    // Check cache. ResponseCache only stores the string content, so a cache hit
    // reports zero usage (no API call → no current cost). H-7 accepts this
    // simplification; "savings via cache" is a future enhancement.
    if (this.cache) {
      const promptText = messages.map((m) => `${m.role}:${m.content}`).join('\n');
      const cacheKey = generateCacheKey(promptText, model);
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return {
          content: cached,
          usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, model },
        };
      }
    }

    const { system, messages: apiMessages } = splitMessages(messages);

    const response = await withRetry(
      () =>
        this.client.messages.create({
          model,
          max_tokens: options?.maxTokens ?? 4096,
          ...(system ? { system } : {}),
          messages: apiMessages,
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options?.stopSequences?.length ? { stop_sequences: options.stopSequences } : {}),
        }),
      3,
    );

    // Extract text from content blocks
    const textBlocks = response.content.filter(
      (block) => block.type === 'text',
    );
    const result = textBlocks.map((block) => block.text).join('');

    // Store in cache
    if (this.cache) {
      const promptText = messages.map((m) => `${m.role}:${m.content}`).join('\n');
      const cacheKey = generateCacheKey(promptText, model);
      await this.cache.set(cacheKey, result, model);
    }

    const apiUsage = response.usage;
    const usage: TokenUsage = {
      inputTokens: apiUsage?.input_tokens ?? 0,
      outputTokens: apiUsage?.output_tokens ?? 0,
      cachedTokens: apiUsage?.cache_read_input_tokens ?? 0,
      model,
    };

    return { content: result, usage };
  }

  async structuredOutput<T>(
    messages: Message[],
    options: StructuredOutputOptions,
  ): Promise<StructuredOutputResult<T>> {
    const schema = options.schema as z.ZodType<T>;

    // Append JSON instruction to the last user message or add a new one
    const augmentedMessages = [...messages];
    const jsonInstruction =
      '\n\nRespond with valid JSON only. No markdown fences, no explanation — just the JSON object.';

    const lastUserIdx = augmentedMessages.findLastIndex(
      (m) => m.role === 'user',
    );
    if (lastUserIdx >= 0) {
      augmentedMessages[lastUserIdx] = {
        ...augmentedMessages[lastUserIdx],
        content: augmentedMessages[lastUserIdx].content + jsonInstruction,
      };
    }

    let lastError: unknown;
    let lastUsage: TokenUsage | undefined;
    for (let attempt = 0; attempt <= MAX_STRUCTURED_RETRIES; attempt++) {
      try {
        const { content: raw, usage } = await this.chat(augmentedMessages, {
          ...options,
          temperature: options.temperature ?? 0,
        });
        // Accumulate retries: each attempt's tokens are real spend.
        lastUsage = mergeUsage(lastUsage, usage);

        // Parse JSON — handle potential markdown fences. Anthropic models
        // (Sonnet 3.5+) reliably wrap structured JSON in ```json ... ```
        // even when instructed otherwise. Mirrors the OpenAI provider.
        let jsonStr = raw.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const parsed: unknown = JSON.parse(jsonStr);

        // Validate with Zod
        const validated = schema.parse(parsed);
        return { data: validated, usage: lastUsage };
      } catch (err) {
        lastError = err;

        // Don't retry on API errors (those are handled by withRetry in chat())
        if (isRetryableError(err)) throw err;

        // Retry on parse/validation errors
        if (attempt === MAX_STRUCTURED_RETRIES) break;
      }
    }

    throw new Error(
      `Structured output failed after ${MAX_STRUCTURED_RETRIES + 1} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}

/**
 * Sum two `TokenUsage` records, used to accumulate token spend across
 * structured-output retries (every retry is a real API call).
 */
function mergeUsage(a: TokenUsage | undefined, b: TokenUsage): TokenUsage {
  if (!a) return b;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    model: b.model,
  };
}
