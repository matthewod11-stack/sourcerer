// Provider factory — creates AIProvider instances from SourcererConfig

import type { AIProvider, SourcererConfig } from '@sourcerer/core';
import { AnthropicProvider } from './provider-anthropic.js';
import { OpenAIProvider } from './provider-openai.js';

/**
 * Create an AIProvider instance based on the SourcererConfig.
 *
 * Reads `config.aiProvider.name` to determine which provider to instantiate,
 * and passes the API key and optional model override.
 */
export function createAIProvider(config: SourcererConfig): AIProvider {
  const { name, apiKey, model } = config.aiProvider;

  switch (name) {
    case 'anthropic':
      return new AnthropicProvider({ apiKey, model });

    case 'openai':
      return new OpenAIProvider({ apiKey, model });

    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown AI provider: ${String(exhaustive)}`);
    }
  }
}
