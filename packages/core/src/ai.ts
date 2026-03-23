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

export interface AIProvider {
  name: string;
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
  structuredOutput<T>(messages: Message[], options: StructuredOutputOptions): Promise<T>;
}
