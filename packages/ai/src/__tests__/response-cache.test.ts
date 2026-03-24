import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResponseCache, generateCacheKey, CACHE_TTL } from '../response-cache.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('generateCacheKey', () => {
  it('returns a hex string', () => {
    const key = generateCacheKey('hello', 'gpt-4o');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    const key1 = generateCacheKey('hello', 'gpt-4o');
    const key2 = generateCacheKey('hello', 'gpt-4o');
    expect(key1).toBe(key2);
  });

  it('differs for different prompts', () => {
    const key1 = generateCacheKey('hello', 'gpt-4o');
    const key2 = generateCacheKey('world', 'gpt-4o');
    expect(key1).not.toBe(key2);
  });

  it('differs for different models', () => {
    const key1 = generateCacheKey('hello', 'gpt-4o');
    const key2 = generateCacheKey('hello', 'claude-sonnet-4-20250514');
    expect(key1).not.toBe(key2);
  });

  it('includes schema in hash when provided', () => {
    const key1 = generateCacheKey('hello', 'gpt-4o');
    const key2 = generateCacheKey('hello', 'gpt-4o', { type: 'object' });
    expect(key1).not.toBe(key2);
  });

  it('is deterministic with schema', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } } };
    const key1 = generateCacheKey('hello', 'gpt-4o', schema);
    const key2 = generateCacheKey('hello', 'gpt-4o', schema);
    expect(key1).toBe(key2);
  });
});

describe('CACHE_TTL', () => {
  it('has correct enrichment TTL (24 hours)', () => {
    expect(CACHE_TTL.ENRICHMENT).toBe(24 * 60 * 60 * 1000);
  });

  it('has correct scoring TTL (7 days)', () => {
    expect(CACHE_TTL.SCORING).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('ResponseCache', () => {
  let cacheDir: string;
  let cache: ResponseCache;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'sourcerer-cache-test-'));
    cache = new ResponseCache({ cacheDir, defaultTtlMs: 60_000 });
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  describe('get/set', () => {
    it('returns undefined for missing key', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('stores and retrieves a value', async () => {
      const key = 'test-key-1';
      await cache.set(key, '{"result": "hello"}', 'gpt-4o');
      const result = await cache.get(key);
      expect(result).toBe('{"result": "hello"}');
    });

    it('stores multiple values', async () => {
      await cache.set('key-a', 'value-a', 'gpt-4o');
      await cache.set('key-b', 'value-b', 'gpt-4o');
      expect(await cache.get('key-a')).toBe('value-a');
      expect(await cache.get('key-b')).toBe('value-b');
    });

    it('overwrites existing value', async () => {
      await cache.set('key-1', 'old', 'gpt-4o');
      await cache.set('key-1', 'new', 'gpt-4o');
      expect(await cache.get('key-1')).toBe('new');
    });
  });

  describe('TTL expiration', () => {
    it('returns undefined for expired entries', async () => {
      // Create cache with 1ms TTL
      const shortCache = new ResponseCache({ cacheDir, defaultTtlMs: 1 });
      await shortCache.set('expiring', 'data', 'gpt-4o');

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await shortCache.get('expiring');
      expect(result).toBeUndefined();
    });

    it('respects custom TTL per entry', async () => {
      // Set with very short TTL
      await cache.set('short-ttl', 'data', 'gpt-4o', 1);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(await cache.get('short-ttl')).toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('removes an existing entry', async () => {
      await cache.set('to-remove', 'data', 'gpt-4o');
      const removed = await cache.invalidate('to-remove');
      expect(removed).toBe(true);
      expect(await cache.get('to-remove')).toBeUndefined();
    });

    it('returns false for non-existent entry', async () => {
      const removed = await cache.invalidate('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      await cache.set('a', 'data-a', 'gpt-4o');
      await cache.set('b', 'data-b', 'gpt-4o');
      await cache.set('c', 'data-c', 'gpt-4o');

      const removed = await cache.clear();
      expect(removed).toBe(3);

      expect(await cache.get('a')).toBeUndefined();
      expect(await cache.get('b')).toBeUndefined();
      expect(await cache.get('c')).toBeUndefined();
    });

    it('returns 0 for empty cache', async () => {
      const removed = await cache.clear();
      expect(removed).toBe(0);
    });
  });

  describe('stats', () => {
    it('reports correct entry count', async () => {
      await cache.set('a', 'data', 'gpt-4o');
      await cache.set('b', 'data', 'gpt-4o');

      const s = await cache.stats();
      expect(s.entries).toBe(2);
      expect(s.expired).toBe(0);
    });

    it('reports expired entries', async () => {
      await cache.set('expired', 'data', 'gpt-4o', 1);
      await cache.set('valid', 'data', 'gpt-4o', 60_000);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const s = await cache.stats();
      expect(s.entries).toBe(2);
      expect(s.expired).toBe(1);
    });
  });

  describe('disabled cache', () => {
    it('returns undefined on get when disabled', async () => {
      const disabled = new ResponseCache({ cacheDir, enabled: false });
      await disabled.set('key', 'value', 'gpt-4o');
      expect(await disabled.get('key')).toBeUndefined();
    });
  });
});
