// Provider factory — creates AIProvider instances from SourcererConfig

import type { AIProvider, SourcererConfig } from '@sourcerer/core';
import { AnthropicProvider } from './provider-anthropic.js';
import { OpenAIProvider } from './provider-openai.js';
import { ResponseCache } from './response-cache.js';

export interface CreateAIProviderOptions {
  noCache?: boolean;
}

/**
 * Create an AIProvider instance based on the SourcererConfig.
 *
 * Reads `config.aiProvider.name` to determine which provider to instantiate,
 * and passes the API key and optional model override.
 * Creates a ResponseCache unless `options.noCache` is true.
 */
export function createAIProvider(
  config: SourcererConfig,
  options?: CreateAIProviderOptions,
): AIProvider {
  const { name, apiKey, model } = config.aiProvider;
  const cache = options?.noCache
    ? undefined
    : new ResponseCache({ enabled: true });

  switch (name) {
    case 'anthropic':
      return new AnthropicProvider({ apiKey, model, cache });

    case 'openai':
      return new OpenAIProvider({ apiKey, model, cache });

    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown AI provider: ${String(exhaustive)}`);
    }
  }
}
