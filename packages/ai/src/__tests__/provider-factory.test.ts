import { describe, it, expect, vi } from 'vitest';
import { createAIProvider } from '../provider-factory.js';
import type { SourcererConfig } from '@sourcerer/core';

// Mock providers
vi.mock('../provider-anthropic.js', () => ({
  AnthropicProvider: vi.fn().mockImplementation((config) => ({
    name: 'anthropic',
    _config: config,
  })),
}));

vi.mock('../provider-openai.js', () => ({
  OpenAIProvider: vi.fn().mockImplementation((config) => ({
    name: 'openai',
    _config: config,
  })),
}));

// Mock ResponseCache to avoid file system operations
vi.mock('../response-cache.js', () => ({
  ResponseCache: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
  generateCacheKey: vi.fn().mockReturnValue('mock-key'),
}));

function makeConfig(overrides: Partial<SourcererConfig['aiProvider']> = {}): SourcererConfig {
  return {
    version: 1,
    adapters: {
      exa: { apiKey: 'test-exa-key' },
    },
    aiProvider: {
      name: 'anthropic',
      apiKey: 'test-api-key',
      ...overrides,
    },
    retention: { ttlDays: 90 },
    defaultOutput: 'json',
  };
}

describe('createAIProvider', () => {
  it('creates AnthropicProvider for anthropic config', async () => {
    const { AnthropicProvider } = await import('../provider-anthropic.js');
    const provider = createAIProvider(makeConfig({ name: 'anthropic' }));

    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'test-api-key' }),
    );
    expect(provider.name).toBe('anthropic');
  });

  it('creates OpenAIProvider for openai config', async () => {
    const { OpenAIProvider } = await import('../provider-openai.js');
    const provider = createAIProvider(makeConfig({ name: 'openai' }));

    expect(OpenAIProvider).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'test-api-key' }),
    );
    expect(provider.name).toBe('openai');
  });

  it('passes model override to provider', async () => {
    const { AnthropicProvider } = await import('../provider-anthropic.js');
    createAIProvider(makeConfig({ name: 'anthropic', model: 'claude-opus-4-20250514' }));

    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-api-key',
        model: 'claude-opus-4-20250514',
      }),
    );
  });

  it('throws for unknown provider', () => {
    const config = makeConfig();
    (config.aiProvider as any).name = 'unknown-provider';

    expect(() => createAIProvider(config)).toThrow('Unknown AI provider');
  });

  it('passes cache when noCache is not set', async () => {
    const { AnthropicProvider } = await import('../provider-anthropic.js');
    createAIProvider(makeConfig({ name: 'anthropic' }));

    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({ cache: expect.anything() }),
    );
  });

  it('does not pass cache when noCache is true', async () => {
    const { AnthropicProvider } = await import('../provider-anthropic.js');
    createAIProvider(makeConfig({ name: 'anthropic' }), { noCache: true });

    expect(AnthropicProvider).toHaveBeenCalledWith(
      expect.objectContaining({ cache: undefined }),
    );
  });
});
