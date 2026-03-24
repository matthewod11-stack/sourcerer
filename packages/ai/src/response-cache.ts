// Response cache — file-based caching of LLM responses keyed by SHA-256 hash

import { createHash } from 'node:crypto';
import { readFile, writeFile, unlink, readdir, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Cache entry stored on disk */
export interface CacheEntry {
  key: string;
  response: string;
  model: string;
  createdAt: string;
  ttlMs: number;
}

/** Options for configuring the response cache */
export interface CacheConfig {
  /** Base directory for cache files. Defaults to `~/.sourcerer/cache/` */
  cacheDir?: string;
  /** Default TTL in milliseconds. Defaults to 24 hours. */
  defaultTtlMs?: number;
  /** Whether caching is enabled. Defaults to true. */
  enabled?: boolean;
}

/** Predefined TTL constants */
export const CACHE_TTL = {
  /** 24 hours — for enrichment-derived responses */
  ENRICHMENT: 24 * 60 * 60 * 1000,
  /** 7 days — for scoring responses */
  SCORING: 7 * 24 * 60 * 60 * 1000,
} as const;

const DEFAULT_CACHE_DIR = join(homedir(), '.sourcerer', 'cache');
const DEFAULT_TTL_MS = CACHE_TTL.ENRICHMENT;

/**
 * Generate a SHA-256 cache key from the input components.
 */
export function generateCacheKey(
  promptText: string,
  model: string,
  schema?: unknown,
): string {
  const hash = createHash('sha256');
  hash.update(promptText);
  hash.update(model);
  if (schema !== undefined) {
    hash.update(JSON.stringify(schema));
  }
  return hash.digest('hex');
}

/**
 * File-based response cache for LLM outputs.
 */
export class ResponseCache {
  private readonly cacheDir: string;
  private readonly defaultTtlMs: number;
  private readonly enabled: boolean;

  constructor(config: CacheConfig = {}) {
    this.cacheDir = config.cacheDir ?? DEFAULT_CACHE_DIR;
    this.defaultTtlMs = config.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.enabled = config.enabled ?? true;
  }

  /**
   * Get a cached response by key. Returns undefined if not found or expired.
   */
  async get(key: string): Promise<string | undefined> {
    if (!this.enabled) return undefined;

    const filePath = this.keyToPath(key);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(raw);

      // Check TTL
      const createdAt = new Date(entry.createdAt).getTime();
      const now = Date.now();
      if (now - createdAt > entry.ttlMs) {
        // Expired — remove async, don't await
        void unlink(filePath).catch(() => {});
        return undefined;
      }

      return entry.response;
    } catch {
      return undefined;
    }
  }

  /**
   * Store a response in the cache.
   */
  async set(
    key: string,
    response: string,
    model: string,
    ttlMs?: number,
  ): Promise<void> {
    if (!this.enabled) return;

    const entry: CacheEntry = {
      key,
      response,
      model,
      createdAt: new Date().toISOString(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    };

    await this.ensureDir();
    const filePath = this.keyToPath(key);
    await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  }

  /**
   * Invalidate (remove) a specific cache entry.
   */
  async invalidate(key: string): Promise<boolean> {
    const filePath = this.keyToPath(key);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear all cache entries.
   */
  async clear(): Promise<number> {
    try {
      const files = await readdir(this.cacheDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      let removed = 0;
      for (const file of jsonFiles) {
        try {
          await unlink(join(this.cacheDir, file));
          removed++;
        } catch {
          // Skip files that can't be removed
        }
      }
      return removed;
    } catch {
      return 0;
    }
  }

  /**
   * Get cache statistics (number of entries, total size in bytes).
   */
  async stats(): Promise<{ entries: number; expired: number }> {
    try {
      const files = await readdir(this.cacheDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      let expired = 0;
      const now = Date.now();

      for (const file of jsonFiles) {
        try {
          const raw = await readFile(join(this.cacheDir, file), 'utf-8');
          const entry: CacheEntry = JSON.parse(raw);
          const createdAt = new Date(entry.createdAt).getTime();
          if (now - createdAt > entry.ttlMs) {
            expired++;
          }
        } catch {
          // Skip invalid files
        }
      }

      return { entries: jsonFiles.length, expired };
    } catch {
      return { entries: 0, expired: 0 };
    }
  }

  private keyToPath(key: string): string {
    return join(this.cacheDir, `${key}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }
}
