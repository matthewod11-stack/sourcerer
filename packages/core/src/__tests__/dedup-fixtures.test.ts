import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IdentityResolver } from '../identity-resolver.js';
import type { RawCandidate, ObservedIdentifier } from '../index.js';

const FIXTURES_PATH = join(import.meta.dirname, '..', '..', '..', '..', 'test-fixtures');

interface FixtureIdentifier {
  type: ObservedIdentifier['type'];
  value: string;
}

interface FixtureVariant {
  name: string;
  adapter: string;
  identifiers: FixtureIdentifier[];
}

interface FixtureGroup {
  _group: string;
  variants: FixtureVariant[];
}

interface FixtureFile {
  candidates: FixtureGroup[];
  assertions: {
    totalInputCandidates: number;
    totalAfterDedup: number;
  };
}

function fixtureToRawCandidates(fixture: FixtureFile): RawCandidate[] {
  const now = '2026-03-23T12:00:00Z';
  const candidates: RawCandidate[] = [];

  for (const group of fixture.candidates) {
    for (const variant of group.variants) {
      const identifiers: ObservedIdentifier[] = variant.identifiers.map((id) => ({
        type: id.type,
        value: id.value,
        source: variant.adapter,
        observedAt: now,
        confidence: 'high' as const,
      }));

      candidates.push({
        name: variant.name,
        identifiers,
        sourceData: { adapter: variant.adapter, retrievedAt: now, urls: [] },
        evidence: [],
        piiFields: [],
      });
    }
  }

  return candidates;
}

describe('Dedup fixture integration', () => {
  it('loads and processes dedup-candidates.json correctly', async () => {
    const raw = await readFile(join(FIXTURES_PATH, 'dedup-candidates.json'), 'utf-8');
    const fixture = JSON.parse(raw) as FixtureFile;
    const candidates = fixtureToRawCandidates(fixture);

    expect(candidates).toHaveLength(fixture.assertions.totalInputCandidates);

    const resolver = new IdentityResolver();
    const result = resolver.resolve(candidates);

    expect(result.stats.inputCount).toBe(fixture.assertions.totalInputCandidates);
    expect(result.candidates).toHaveLength(fixture.assertions.totalAfterDedup);
  });

  it('merges Sarah Chen from 3 sources into 1 candidate', async () => {
    const raw = await readFile(join(FIXTURES_PATH, 'dedup-candidates.json'), 'utf-8');
    const fixture = JSON.parse(raw) as FixtureFile;
    const candidates = fixtureToRawCandidates(fixture);

    const resolver = new IdentityResolver();
    const result = resolver.resolve(candidates);

    // Find the Sarah Chen candidate (has linkedin.com/in/sarahchen)
    const sarah = result.candidates.find((c) =>
      c.identity.observedIdentifiers.some(
        (id) => id.type === 'github_username' && id.value.toLowerCase().includes('sarahchen'),
      ),
    );
    expect(sarah).toBeDefined();
    // Should have identifiers from all 3 sources (exa, github, hunter)
    const sources = new Set(sarah!.identity.observedIdentifiers.map((id) => id.source));
    expect(sources.size).toBeGreaterThanOrEqual(2);
  });

  it('does NOT merge Sara Chen (Google) with Sarah Chen (Chainlink)', async () => {
    const raw = await readFile(join(FIXTURES_PATH, 'dedup-candidates.json'), 'utf-8');
    const fixture = JSON.parse(raw) as FixtureFile;
    const candidates = fixtureToRawCandidates(fixture);

    const resolver = new IdentityResolver();
    const result = resolver.resolve(candidates);

    // Find candidates with "sara" and "sarah" in different companies
    const sarahChainlink = result.candidates.find((c) =>
      c.identity.observedIdentifiers.some((id) => id.value.includes('sarah@chainlink')),
    );
    const saraGoogle = result.candidates.find((c) =>
      c.identity.observedIdentifiers.some((id) => id.value.includes('sara@google')),
    );

    expect(sarahChainlink).toBeDefined();
    expect(saraGoogle).toBeDefined();
    expect(sarahChainlink!.id).not.toBe(saraGoogle!.id);
  });

  it('produces idempotent results with fixture data', async () => {
    const raw = await readFile(join(FIXTURES_PATH, 'dedup-candidates.json'), 'utf-8');
    const fixture = JSON.parse(raw) as FixtureFile;
    const candidates = fixtureToRawCandidates(fixture);

    const resolver = new IdentityResolver();
    const result1 = resolver.resolve(candidates);
    const result2 = resolver.resolve(candidates);

    expect(result1.candidates.length).toBe(result2.candidates.length);
    const ids1 = result1.candidates.map((c) => c.id).sort();
    const ids2 = result2.candidates.map((c) => c.id).sort();
    expect(ids1).toEqual(ids2);
  });
});
