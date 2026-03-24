import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '@sourcerer/core';
import { z } from 'zod';

// Shared mock function — must be defined before the vi.mock factory
const mockCreate = vi.fn();

// Mock the OpenAI SDK
vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
    constructor(_config: any) {}
  }

  return { default: MockOpenAI };
});

// Import after mock is set up
import { OpenAIProvider } from '../provider-openai.js';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider({ apiKey: 'test-key' });
  });

  describe('chat', () => {
    it('sends messages and returns text response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hello from GPT!' } }],
      });

      const messages: Message[] = [
        { role: 'user', content: 'Say hello' },
      ];

      const result = await provider.chat(messages);
      expect(result).toBe('Hello from GPT!');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Say hello' }],
        }),
      );
    });

    it('includes system message in messages array', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'OK' } }],
      });

      const messages: Message[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
      ];

      await provider.chat(messages);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hi' },
          ],
        }),
      );
    });

    it('passes model and temperature options', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'OK' } }],
      });

      await provider.chat(
        [{ role: 'user', content: 'test' }],
        { model: 'gpt-4-turbo', temperature: 0.7, maxTokens: 2000 },
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4-turbo',
          temperature: 0.7,
          max_tokens: 2000,
        }),
      );
    });

    it('handles empty response content', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      const result = await provider.chat([{ role: 'user', content: 'test' }]);
      expect(result).toBe('');
    });
  });

  describe('structuredOutput', () => {
    const testSchema = z.object({
      title: z.string(),
      count: z.number(),
    });

    it('parses valid JSON response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"title": "Test", "count": 5}' } }],
      });

      const result = await provider.structuredOutput(
        [{ role: 'user', content: 'Get data' }],
        { schema: testSchema },
      );

      expect(result).toEqual({ title: 'Test', count: 5 });
    });

    it('strips markdown fences from JSON response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '```json\n{"title": "Fenced", "count": 10}\n```',
            },
          },
        ],
      });

      const result = await provider.structuredOutput(
        [{ role: 'user', content: 'Get data' }],
        { schema: testSchema },
      );

      expect(result).toEqual({ title: 'Fenced', count: 10 });
    });

    it('retries on invalid JSON', async () => {
      mockCreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Not JSON' } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"title": "Retry", "count": 1}' } }],
        });

      const result = await provider.structuredOutput(
        [{ role: 'user', content: 'Get data' }],
        { schema: testSchema },
      );

      expect(result).toEqual({ title: 'Retry', count: 1 });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('retries on schema validation failure', async () => {
      mockCreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"title": "Missing count"}' } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"title": "Fixed", "count": 42}' } }],
        });

      const result = await provider.structuredOutput(
        [{ role: 'user', content: 'Get data' }],
        { schema: testSchema },
      );

      expect(result).toEqual({ title: 'Fixed', count: 42 });
    });

    it('throws after max retries', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'never valid json' } }],
      });

      await expect(
        provider.structuredOutput(
          [{ role: 'user', content: 'Get data' }],
          { schema: testSchema },
        ),
      ).rejects.toThrow('Structured output failed after 3 attempts');
    });
  });

  describe('name', () => {
    it('returns "openai"', () => {
      expect(provider.name).toBe('openai');
    });
  });
});
