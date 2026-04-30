// @sourcerer/ai — LLM abstraction layer, prompt templates, response caching

import type { AIProviderName } from '@sourcerer/core';
import { DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL } from './provider-anthropic.js';
import { DEFAULT_MODEL as OPENAI_DEFAULT_MODEL } from './provider-openai.js';

// Provider implementations
export { AnthropicProvider } from './provider-anthropic.js';
export type { AnthropicProviderConfig } from './provider-anthropic.js';
export { OpenAIProvider } from './provider-openai.js';
export type { OpenAIProviderConfig } from './provider-openai.js';

// Provider factory
export { createAIProvider } from './provider-factory.js';

/**
 * Resolve the default model string for a given AI provider. Used by
 * `sourcerer config status` to display the effective model when the user
 * hasn't set `aiProvider.model` (H-4).
 */
export function getDefaultModel(provider: AIProviderName): string {
  switch (provider) {
    case 'anthropic':
      return ANTHROPIC_DEFAULT_MODEL;
    case 'openai':
      return OPENAI_DEFAULT_MODEL;
  }
}

// Template loader
export {
  interpolate,
  loadTemplate,
  renderTemplate,
  listTemplates,
  getPromptsDir,
} from './template-loader.js';
export type { TemplateContext } from './template-loader.js';

// Response cache
export { ResponseCache, generateCacheKey, CACHE_TTL } from './response-cache.js';
export type { CacheEntry, CacheConfig } from './response-cache.js';
