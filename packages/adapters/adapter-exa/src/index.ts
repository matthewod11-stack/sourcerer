// @sourcerer/adapter-exa — Exa search adapter (discovery + enrichment)

export { ExaAdapter } from './exa-adapter.js';
export { parseExaResult, extractIdentifiers, extractEmails, type ExaResult } from './parsers.js';
export { RateLimiter } from './rate-limiter.js';
