import { describe, it, expect } from 'vitest';
import {
  createIntakeContext,
  mergeContextUpdates,
  appendMessage,
  hasRoleData,
  hasCompanyData,
  hasTeamProfiles,
  hasCompetitorMap,
  serializeContext,
  deserializeContext,
} from '../intake-context.js';
import { makeRoleParameters, makeCompanyIntel, makeProfileAnalysis, makeCompetitorMap } from './helpers.js';

describe('IntakeContext', () => {
  describe('createIntakeContext', () => {
    it('creates an empty context with conversation history', () => {
      const ctx = createIntakeContext();
      expect(ctx.conversationHistory).toEqual([]);
      expect(ctx.roleDescription).toBeUndefined();
      expect(ctx.roleParameters).toBeUndefined();
      expect(ctx.companyUrl).toBeUndefined();
      expect(ctx.companyIntel).toBeUndefined();
      expect(ctx.teamProfiles).toBeUndefined();
    });
  });

  describe('mergeContextUpdates', () => {
    it('overwrites scalar fields', () => {
      const ctx = createIntakeContext();
      const updated = mergeContextUpdates(ctx, {
        roleDescription: 'Backend Engineer',
        companyUrl: 'https://example.com',
      });
      expect(updated.roleDescription).toBe('Backend Engineer');
      expect(updated.companyUrl).toBe('https://example.com');
    });

    it('overwrites object fields', () => {
      const ctx = createIntakeContext();
      const params = makeRoleParameters();
      const updated = mergeContextUpdates(ctx, { roleParameters: params });
      expect(updated.roleParameters).toBe(params);
    });

    it('concatenates array fields', () => {
      const profile1 = makeProfileAnalysis({ name: 'Alice' });
      const profile2 = makeProfileAnalysis({ name: 'Bob' });

      const ctx = mergeContextUpdates(createIntakeContext(), { teamProfiles: [profile1] });
      const updated = mergeContextUpdates(ctx, { teamProfiles: [profile2] });

      expect(updated.teamProfiles).toHaveLength(2);
      expect(updated.teamProfiles![0].name).toBe('Alice');
      expect(updated.teamProfiles![1].name).toBe('Bob');
    });

    it('concatenates antiPatterns', () => {
      const ctx = mergeContextUpdates(createIntakeContext(), { antiPatterns: ['no code'] });
      const updated = mergeContextUpdates(ctx, { antiPatterns: ['job hopper'] });

      expect(updated.antiPatterns).toEqual(['no code', 'job hopper']);
    });

    it('concatenates similaritySeeds', () => {
      const ctx = mergeContextUpdates(createIntakeContext(), { similaritySeeds: ['url1'] });
      const updated = mergeContextUpdates(ctx, { similaritySeeds: ['url2'] });

      expect(updated.similaritySeeds).toEqual(['url1', 'url2']);
    });

    it('concatenates conversationHistory', () => {
      const ctx = createIntakeContext();
      const msg1 = { role: 'user' as const, content: 'Hello' };
      const msg2 = { role: 'assistant' as const, content: 'Hi' };

      const updated1 = mergeContextUpdates(ctx, { conversationHistory: [msg1] });
      const updated2 = mergeContextUpdates(updated1, { conversationHistory: [msg2] });

      expect(updated2.conversationHistory).toHaveLength(2);
    });

    it('does not mutate the original context', () => {
      const ctx = createIntakeContext();
      const updated = mergeContextUpdates(ctx, { roleDescription: 'test' });

      expect(ctx.roleDescription).toBeUndefined();
      expect(updated.roleDescription).toBe('test');
    });
  });

  describe('appendMessage', () => {
    it('adds a message to conversation history', () => {
      const ctx = createIntakeContext();
      const updated = appendMessage(ctx, { role: 'user', content: 'Hello' });

      expect(updated.conversationHistory).toHaveLength(1);
      expect(updated.conversationHistory[0].content).toBe('Hello');
    });

    it('preserves existing messages', () => {
      let ctx = createIntakeContext();
      ctx = appendMessage(ctx, { role: 'user', content: 'msg1' });
      ctx = appendMessage(ctx, { role: 'assistant', content: 'msg2' });

      expect(ctx.conversationHistory).toHaveLength(2);
    });
  });

  describe('context checks', () => {
    it('hasRoleData returns false when no role parameters', () => {
      expect(hasRoleData(createIntakeContext())).toBe(false);
    });

    it('hasRoleData returns true when role parameters exist', () => {
      const ctx = mergeContextUpdates(createIntakeContext(), {
        roleParameters: makeRoleParameters(),
      });
      expect(hasRoleData(ctx)).toBe(true);
    });

    it('hasCompanyData returns false/true correctly', () => {
      expect(hasCompanyData(createIntakeContext())).toBe(false);

      const ctx = mergeContextUpdates(createIntakeContext(), {
        companyIntel: makeCompanyIntel(),
      });
      expect(hasCompanyData(ctx)).toBe(true);
    });

    it('hasTeamProfiles returns false for empty/undefined', () => {
      expect(hasTeamProfiles(createIntakeContext())).toBe(false);
    });

    it('hasTeamProfiles returns true when profiles exist', () => {
      const ctx = mergeContextUpdates(createIntakeContext(), {
        teamProfiles: [makeProfileAnalysis()],
      });
      expect(hasTeamProfiles(ctx)).toBe(true);
    });

    it('hasCompetitorMap returns false/true correctly', () => {
      expect(hasCompetitorMap(createIntakeContext())).toBe(false);

      const ctx = mergeContextUpdates(createIntakeContext(), {
        competitorMap: makeCompetitorMap(),
      });
      expect(hasCompetitorMap(ctx)).toBe(true);
    });
  });

  describe('serialization', () => {
    it('serializes and deserializes a context roundtrip', () => {
      const original = mergeContextUpdates(createIntakeContext(), {
        roleDescription: 'Backend Engineer',
        roleParameters: makeRoleParameters(),
        companyUrl: 'https://example.com',
        antiPatterns: ['job hopper'],
      });

      const json = serializeContext(original);
      const restored = deserializeContext(json);

      expect(restored.roleDescription).toBe(original.roleDescription);
      expect(restored.roleParameters?.title).toBe(original.roleParameters?.title);
      expect(restored.companyUrl).toBe(original.companyUrl);
      expect(restored.antiPatterns).toEqual(original.antiPatterns);
      expect(restored.conversationHistory).toEqual(original.conversationHistory);
    });

    it('throws on invalid JSON', () => {
      expect(() => deserializeContext('not json')).toThrow();
    });

    it('throws when conversationHistory is missing', () => {
      expect(() => deserializeContext('{"roleDescription": "test"}')).toThrow(
        'missing conversationHistory',
      );
    });
  });
});
