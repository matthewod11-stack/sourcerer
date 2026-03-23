import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  applyDefaults,
  getConfiguredAdapters,
  getAdapterApiKey,
  ConfigValidationError,
  DEFAULT_RETENTION_TTL_DAYS,
  type SourcererConfig,
} from '../config.js';

// --- Factories ---

function makeMinimalRawConfig(): Record<string, unknown> {
  return {
    version: 1,
    adapters: {
      exa: { apiKey: 'exa-test-key' },
    },
    aiProvider: {
      name: 'anthropic',
      apiKey: 'anthropic-test-key',
    },
  };
}

function makeFullRawConfig(): Record<string, unknown> {
  return {
    version: 1,
    adapters: {
      exa: { apiKey: 'exa-key' },
      pearch: { apiKey: 'pearch-key' },
      github: { enabled: true },
      x: { apiKey: 'x-key' },
      hunter: { apiKey: 'hunter-key' },
      contactout: { apiKey: 'contactout-key' },
      pdl: { apiKey: 'pdl-key' },
    },
    aiProvider: {
      name: 'openai',
      apiKey: 'openai-key',
      model: 'gpt-4o',
    },
    retention: { ttlDays: 30 },
    defaultOutput: 'csv',
    maxCostUsd: 10.0,
  };
}

// --- Tests ---

describe('Config validation', () => {
  describe('valid configs', () => {
    it('accepts minimal valid config', () => {
      const config = validateConfig(makeMinimalRawConfig());
      expect(config.version).toBe(1);
      expect(config.adapters.exa.apiKey).toBe('exa-test-key');
      expect(config.aiProvider.name).toBe('anthropic');
    });

    it('accepts full config with all adapters', () => {
      const config = validateConfig(makeFullRawConfig());
      expect(config.adapters.pearch?.apiKey).toBe('pearch-key');
      expect(config.adapters.x?.apiKey).toBe('x-key');
      expect(config.adapters.hunter?.apiKey).toBe('hunter-key');
      expect(config.aiProvider.model).toBe('gpt-4o');
      expect(config.retention.ttlDays).toBe(30);
      expect(config.defaultOutput).toBe('csv');
      expect(config.maxCostUsd).toBe(10.0);
    });

    it('applies defaults for missing optional fields', () => {
      const config = validateConfig(makeMinimalRawConfig());
      expect(config.retention.ttlDays).toBe(DEFAULT_RETENTION_TTL_DAYS);
      expect(config.adapters.github?.enabled).toBe(true);
      expect(config.defaultOutput).toBe('json');
    });
  });

  describe('validation errors', () => {
    it('rejects non-object input', () => {
      expect(() => validateConfig(null)).toThrow(ConfigValidationError);
      expect(() => validateConfig('string')).toThrow(ConfigValidationError);
      expect(() => validateConfig(42)).toThrow(ConfigValidationError);
    });

    it('rejects missing adapters.exa', () => {
      const raw = makeMinimalRawConfig();
      (raw.adapters as Record<string, unknown>).exa = undefined;
      expect(() => validateConfig(raw)).toThrow('adapters.exa');
    });

    it('rejects empty exa apiKey', () => {
      const raw = makeMinimalRawConfig();
      (raw.adapters as Record<string, unknown>).exa = { apiKey: '' };
      expect(() => validateConfig(raw)).toThrow('adapters.exa.apiKey');
    });

    it('rejects missing aiProvider.name', () => {
      const raw = makeMinimalRawConfig();
      (raw.aiProvider as Record<string, unknown>).name = undefined;
      expect(() => validateConfig(raw)).toThrow('aiProvider.name');
    });

    it('rejects invalid aiProvider.name', () => {
      const raw = makeMinimalRawConfig();
      (raw.aiProvider as Record<string, unknown>).name = 'claude';
      try {
        validateConfig(raw);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigValidationError);
        expect((e as ConfigValidationError).message).toContain('got: "claude"');
      }
    });

    it('rejects missing aiProvider.apiKey', () => {
      const raw = makeMinimalRawConfig();
      (raw.aiProvider as Record<string, unknown>).apiKey = undefined;
      expect(() => validateConfig(raw)).toThrow('aiProvider.apiKey');
    });

    it('rejects empty optional adapter apiKey', () => {
      const raw = makeMinimalRawConfig();
      (raw.adapters as Record<string, unknown>).hunter = { apiKey: '  ' };
      expect(() => validateConfig(raw)).toThrow('adapters.hunter.apiKey');
    });

    it('collects multiple errors in one throw', () => {
      const raw = {
        version: 1,
        adapters: {},
        aiProvider: {},
      };
      try {
        validateConfig(raw);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigValidationError);
        const err = e as ConfigValidationError;
        expect(err.errors.length).toBeGreaterThanOrEqual(2);
        expect(err.errors.some((m) => m.includes('exa'))).toBe(true);
        expect(err.errors.some((m) => m.includes('aiProvider'))).toBe(true);
      }
    });

    it('rejects negative retention TTL', () => {
      const raw = makeMinimalRawConfig();
      raw.retention = { ttlDays: -5 };
      expect(() => validateConfig(raw)).toThrow('retention.ttlDays');
    });
  });
});

describe('applyDefaults', () => {
  it('sets retention.ttlDays to 90 when missing', () => {
    const config = applyDefaults({
      adapters: { exa: { apiKey: 'k' } },
      aiProvider: { name: 'anthropic', apiKey: 'k' },
    } as Partial<SourcererConfig>);
    expect(config.retention.ttlDays).toBe(90);
  });

  it('enables github by default', () => {
    const config = applyDefaults({
      adapters: { exa: { apiKey: 'k' } },
      aiProvider: { name: 'anthropic', apiKey: 'k' },
    } as Partial<SourcererConfig>);
    expect(config.adapters.github?.enabled).toBe(true);
  });

  it('defaults output format to json', () => {
    const config = applyDefaults({
      adapters: { exa: { apiKey: 'k' } },
      aiProvider: { name: 'anthropic', apiKey: 'k' },
    } as Partial<SourcererConfig>);
    expect(config.defaultOutput).toBe('json');
  });
});

describe('Config utilities', () => {
  it('getConfiguredAdapters returns correct list', () => {
    const config = validateConfig(makeFullRawConfig());
    const adapters = getConfiguredAdapters(config);
    expect(adapters).toContain('exa');
    expect(adapters).toContain('github');
    expect(adapters).toContain('hunter');
    expect(adapters).toContain('x');
    expect(adapters).toHaveLength(7);
  });

  it('getConfiguredAdapters returns only configured ones', () => {
    const config = validateConfig(makeMinimalRawConfig());
    const adapters = getConfiguredAdapters(config);
    expect(adapters).toContain('exa');
    expect(adapters).toContain('github'); // auto-enabled
    expect(adapters).toHaveLength(2);
  });

  it('getAdapterApiKey returns key when present', () => {
    const config = validateConfig(makeFullRawConfig());
    expect(getAdapterApiKey(config, 'exa')).toBe('exa-key');
    expect(getAdapterApiKey(config, 'hunter')).toBe('hunter-key');
  });

  it('getAdapterApiKey returns undefined when not configured', () => {
    const config = validateConfig(makeMinimalRawConfig());
    expect(getAdapterApiKey(config, 'hunter')).toBeUndefined();
    expect(getAdapterApiKey(config, 'github')).toBeUndefined(); // github has no apiKey
  });
});
