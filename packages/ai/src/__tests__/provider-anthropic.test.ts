import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '@sourcerer/core';
import { z } from 'zod';

// Shared mock function — must be defined before the vi.mock factory
const mockCreate = vi.fn();

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
    constructor(_config: any) {}
  }

  return { default: MockAnthropic };
});

// Import after mock is set up
import { AnthropicProvider } from '../provider-anthropic.js';

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider({ apiKey: 'test-key' });
  });

  describe('chat', () => {
    it('sends messages and returns text response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello from Claude!' }],
      });

      const messages: Message[] = [
        { role: 'user', content: 'Say hello' },
      ];

      const result = await provider.chat(messages);
      expect(result).toBe('Hello from Claude!');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          messages: [{ role: 'user', content: 'Say hello' }],
        }),
      );
    });

    it('separates system message from user messages', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'OK' }],
      });

      const messages: Message[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
      ];

      await provider.chat(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are helpful',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      );
    });

    it('passes model and temperature options', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'OK' }],
      });

      await provider.chat(
        [{ role: 'user', content: 'test' }],
        { model: 'claude-opus-4-20250514', temperature: 0.5, maxTokens: 1000 },
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-opus-4-20250514',
          temperature: 0.5,
          max_tokens: 1000,
        }),
      );
    });

    it('concatenates multiple text blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Part 1 ' },
          { type: 'text', text: 'Part 2' },
        ],
      });

      const result = await provider.chat([{ role: 'user', content: 'test' }]);
      expect(result).toBe('Part 1 Part 2');
    });
  });

  describe('structuredOutput', () => {
    const testSchema = z.object({
      name: z.string(),
      age: z.number(),
    });

    it('parses valid JSON response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"name": "Alice", "age": 30}' }],
      });

      const result = await provider.structuredOutput(
        [{ role: 'user', content: 'Get user info' }],
        { schema: testSchema },
      );

      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('retries on invalid JSON', async () => {
      // First call: invalid JSON
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'not json' }],
      });
      // Second call: valid JSON
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"name": "Bob", "age": 25}' }],
      });

      const result = await provider.structuredOutput(
        [{ role: 'user', content: 'Get user info' }],
        { schema: testSchema },
      );

      expect(result).toEqual({ name: 'Bob', age: 25 });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('retries on schema validation failure', async () => {
      // First call: wrong schema (missing age)
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"name": "Charlie"}' }],
      });
      // Second call: valid
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"name": "Charlie", "age": 28}' }],
      });

      const result = await provider.structuredOutput(
        [{ role: 'user', content: 'Get user info' }],
        { schema: testSchema },
      );

      expect(result).toEqual({ name: 'Charlie', age: 28 });
    });

    it('throws after max retries', async () => {
      // All 3 attempts return invalid JSON
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'not json at all' }],
      });

      await expect(
        provider.structuredOutput(
          [{ role: 'user', content: 'Get user info' }],
          { schema: testSchema },
        ),
      ).rejects.toThrow('Structured output failed after 3 attempts');
    });

    it('uses temperature 0 by default for structured output', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"name": "Test", "age": 1}' }],
      });

      await provider.structuredOutput(
        [{ role: 'user', content: 'test' }],
        { schema: testSchema },
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0 }),
      );
    });

    // Sonnet 3.5+ reliably wraps structured JSON output in ```json ... ```
    // markdown fences even when instructed otherwise. The parser must strip
    // them — discovered while running the H-1 adversarial eval against
    // claude-sonnet-4-5 (#18). Mirrors the OpenAI provider's behavior.
    it('strips markdown ```json fences before parsing', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '```json\n{"name": "Dana", "age": 42}\n```' }],
      });

      const result = await provider.structuredOutput(
        [{ role: 'user', content: 'Get user info' }],
        { schema: testSchema },
      );

      expect(result).toEqual({ name: 'Dana', age: 42 });
    });

    it('strips bare ``` fences (no language hint) before parsing', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '```\n{"name": "Eve", "age": 33}\n```' }],
      });

      const result = await provider.structuredOutput(
        [{ role: 'user', content: 'Get user info' }],
        { schema: testSchema },
      );

      expect(result).toEqual({ name: 'Eve', age: 33 });
    });

    it('handles fenced response with surrounding whitespace', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '   \n```json\n{"name": "Frank", "age": 50}\n```   ' }],
      });

      const result = await provider.structuredOutput(
        [{ role: 'user', content: 'Get user info' }],
        { schema: testSchema },
      );

      expect(result).toEqual({ name: 'Frank', age: 50 });
    });
  });

  describe('name', () => {
    it('returns "anthropic"', () => {
      expect(provider.name).toBe('anthropic');
    });
  });
});
