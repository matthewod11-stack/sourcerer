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

    expect(AnthropicProvider).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      model: undefined,
    });
    expect(provider.name).toBe('anthropic');
  });

  it('creates OpenAIProvider for openai config', async () => {
    const { OpenAIProvider } = await import('../provider-openai.js');
    const provider = createAIProvider(makeConfig({ name: 'openai' }));

    expect(OpenAIProvider).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      model: undefined,
    });
    expect(provider.name).toBe('openai');
  });

  it('passes model override to provider', async () => {
    const { AnthropicProvider } = await import('../provider-anthropic.js');
    createAIProvider(makeConfig({ name: 'anthropic', model: 'claude-opus-4-20250514' }));

    expect(AnthropicProvider).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      model: 'claude-opus-4-20250514',
    });
  });

  it('throws for unknown provider', () => {
    const config = makeConfig();
    (config.aiProvider as any).name = 'unknown-provider';

    expect(() => createAIProvider(config)).toThrow('Unknown AI provider');
  });
});
