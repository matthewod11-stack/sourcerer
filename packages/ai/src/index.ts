// @sourcerer/ai — LLM abstraction layer, prompt templates, response caching

// Provider implementations
export { AnthropicProvider } from './provider-anthropic.js';
export type { AnthropicProviderConfig } from './provider-anthropic.js';
export { OpenAIProvider } from './provider-openai.js';
export type { OpenAIProviderConfig } from './provider-openai.js';

// Provider factory
export { createAIProvider } from './provider-factory.js';

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
