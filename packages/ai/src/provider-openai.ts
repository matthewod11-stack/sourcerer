// OpenAI provider — implements AIProvider using the openai SDK

import OpenAI from 'openai';
import { z } from 'zod';
import type {
  AIProvider,
  Message,
  ChatOptions,
  StructuredOutputOptions,
} from '@sourcerer/core';

/** Default model for the OpenAI provider */
const DEFAULT_MODEL = 'gpt-4o';

/** Maximum retries for structured output parse/validation failures */
const MAX_STRUCTURED_RETRIES = 2;

/** Configuration for the OpenAI provider */
export interface OpenAIProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
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

  constructor(config: OpenAIProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.defaultModel = config.model ?? DEFAULT_MODEL;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const model = options?.model ?? this.defaultModel;

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

    return response.choices[0]?.message?.content ?? '';
  }

  async structuredOutput<T>(
    messages: Message[],
    options: StructuredOutputOptions,
  ): Promise<T> {
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
    for (let attempt = 0; attempt <= MAX_STRUCTURED_RETRIES; attempt++) {
      try {
        const raw = await this.chat(augmentedMessages, {
          ...options,
          temperature: options.temperature ?? 0,
        });

        // Parse JSON — handle potential markdown fences
        let jsonStr = raw.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const parsed: unknown = JSON.parse(jsonStr);

        // Validate with Zod
        const validated = schema.parse(parsed);
        return validated;
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
