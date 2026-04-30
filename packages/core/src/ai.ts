// AI provider abstraction — interface only, implementation in @sourcerer/ai

export type MessageRole = 'system' | 'user' | 'assistant';

export interface Message {
  role: MessageRole;
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface StructuredOutputOptions extends ChatOptions {
  /** Zod schema at runtime — typed as unknown since core is zero-dep */
  schema: unknown;
}

/**
 * Token usage from a single LLM call. Threaded through return types so callers
 * can compute real cost via `@sourcerer/ai`'s pricing table (H-7).
 *
 * - `inputTokens`: non-cached input tokens charged at the standard input rate.
 * - `outputTokens`: generated output tokens.
 * - `cachedTokens`: input tokens served from the provider's prompt cache
 *   (Anthropic `cache_read_input_tokens`, OpenAI `prompt_tokens_details.cached_tokens`),
 *   typically billed at ~10% of input rate.
 * - `model`: the model string the provider actually invoked. Recorded so cost
 *   can be looked up later, even when the call site didn't specify a model.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  model: string;
}

export interface ChatResult {
  content: string;
  usage: TokenUsage;
}

export interface StructuredOutputResult<T> {
  data: T;
  usage: TokenUsage;
}

export interface AIProvider {
  name: string;
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResult>;
  structuredOutput<T>(
    messages: Message[],
    options: StructuredOutputOptions,
  ): Promise<StructuredOutputResult<T>>;
}
