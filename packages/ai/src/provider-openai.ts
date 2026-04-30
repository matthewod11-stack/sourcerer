// OpenAI provider — implements AIProvider using the openai SDK

import OpenAI from 'openai';
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

/** Default model for the OpenAI provider */
export const DEFAULT_MODEL = 'gpt-4o';

/** Maximum retries for structured output parse/validation failures */
const MAX_STRUCTURED_RETRIES = 2;

/** Configuration for the OpenAI provider */
export interface OpenAIProviderConfig {
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
 * Convert core Message format to OpenAI chat completion format.
 */
function toOpenAIMessages(
  messages: Message[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

/**
 * OpenAI provider implementation of AIProvider.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly cache?: ResponseCache;

  constructor(config: OpenAIProviderConfig) {
    this.client = new OpenAI({
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

    const response = await withRetry(
      () =>
        this.client.chat.completions.create({
          model,
          messages: toOpenAIMessages(messages),
          ...(options?.maxTokens !== undefined
            ? { max_tokens: options.maxTokens }
            : {}),
          ...(options?.temperature !== undefined
            ? { temperature: options.temperature }
            : {}),
          ...(options?.stopSequences?.length
            ? { stop: options.stopSequences }
            : {}),
        }),
      3,
    );

    const result = response.choices[0]?.message?.content ?? '';

    // Store in cache
    if (this.cache) {
      const promptText = messages.map((m) => `${m.role}:${m.content}`).join('\n');
      const cacheKey = generateCacheKey(promptText, model);
      await this.cache.set(cacheKey, result, model);
    }

    // OpenAI accounting: `prompt_tokens` includes cached tokens; subtract to
    // get the non-cached portion that gets charged at the standard input rate.
    const apiUsage = response.usage;
    const cachedTokens = apiUsage?.prompt_tokens_details?.cached_tokens ?? 0;
    const totalPrompt = apiUsage?.prompt_tokens ?? 0;
    const usage: TokenUsage = {
      inputTokens: Math.max(0, totalPrompt - cachedTokens),
      outputTokens: apiUsage?.completion_tokens ?? 0,
      cachedTokens,
      model,
    };

    return { content: result, usage };
  }

  async structuredOutput<T>(
    messages: Message[],
    options: StructuredOutputOptions,
  ): Promise<StructuredOutputResult<T>> {
    const schema = options.schema as z.ZodType<T>;

    // Append JSON instruction to the last user message
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

        // Parse JSON — handle potential markdown fences
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
