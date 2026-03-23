import { describe, it, expect } from 'vitest';
import {
  IdentityResolver,
  normalizeLinkedInUrl,
  normalizeEmail,
  normalizeGitHubUsername,
  normalizeTwitterHandle,
  namesMatch,
  namesSimilar,
  levenshtein,
} from '../identity-resolver.js';
import type { RawCandidate, ObservedIdentifier } from '../index.js';

// --- Factories ---

const now = '2026-03-23T12:00:00Z';

function makeRawCandidate(overrides: Partial<RawCandidate> & { name: string; adapter?: string }): RawCandidate {
  return {
    identifiers: [],
    sourceData: {
      adapter: overrides.adapter ?? 'exa',
      retrievedAt: now,
      urls: [],
    },
    evidence: [],
    piiFields: [],
    ...overrides,
  };
}

function makeId(type: ObservedIdentifier['type'], value: string, source = 'exa'): ObservedIdentifier {
  return { type, value, source, observedAt: now, confidence: 'high' };
}

// --- Tests ---

const resolver = new IdentityResolver();

describe('Normalization', () => {
  describe('LinkedIn URL', () => {
    it('strips protocol, www, and trailing slash', () => {
      expect(normalizeLinkedInUrl('https://www.linkedin.com/in/sarah-chen/')).toBe('linkedin.com/in/sarahchen');
    });

    it('handles http and no www', () => {
      expect(normalizeLinkedInUrl('http://linkedin.com/in/sarah-chen')).toBe('linkedin.com/in/sarahchen');
    });

    it('strips hyphens from slug', () => {
      expect(normalizeLinkedInUrl('https://linkedin.com/in/sarah-chen-abc123')).toBe('linkedin.com/in/sarahchenabc123');
    });

    it('strips query parameters', () => {
      expect(normalizeLinkedInUrl('https://linkedin.com/in/sarah-chen?locale=en')).toBe('linkedin.com/in/sarahchen');
    });

    it('lowercases', () => {
      expect(normalizeLinkedInUrl('https://LinkedIn.com/in/Sarah-Chen')).toBe('linkedin.com/in/sarahchen');
    });
  });

  describe('Email', () => {
    it('lowercases', () => {
      expect(normalizeEmail('Sarah@Example.com')).toBe('sarah@example.com');
    });

    it('strips Gmail dots', () => {
      expect(normalizeEmail('sarah.chen@gmail.com')).toBe('sarahchen@gmail.com');
    });

    it('strips Gmail plus suffix', () => {
      expect(normalizeEmail('sarah+work@gmail.com')).toBe('sarah@gmail.com');
    });

    it('strips Gmail dots AND plus suffix', () => {
      expect(normalizeEmail('sarah.chen+work@gmail.com')).toBe('sarahchen@gmail.com');
    });

    it('normalizes googlemail.com to gmail.com', () => {
      expect(normalizeEmail('sarah@googlemail.com')).toBe('sarah@gmail.com');
    });

    it('does not strip dots for non-Gmail', () => {
      expect(normalizeEmail('sarah.chen@company.com')).toBe('sarah.chen@company.com');
    });
  });

  describe('GitHub username', () => {
    it('strips @ prefix', () => {
      expect(normalizeGitHubUsername('@sarahchen')).toBe('sarahchen');
    });

    it('strips GitHub URL prefix', () => {
      expect(normalizeGitHubUsername('https://github.com/SarahChen')).toBe('sarahchen');
    });

    it('strips www GitHub URL', () => {
      expect(normalizeGitHubUsername('https://www.github.com/SarahChen/')).toBe('sarahchen');
    });

    it('lowercases', () => {
      expect(normalizeGitHubUsername('SarahChen')).toBe('sarahchen');
    });
  });

  describe('Twitter handle', () => {
    it('strips @ prefix', () => {
      expect(normalizeTwitterHandle('@sarahchen')).toBe('sarahchen');
    });

    it('strips twitter.com URL', () => {
      expect(normalizeTwitterHandle('https://twitter.com/sarahchen')).toBe('sarahchen');
    });

    it('strips x.com URL', () => {
      expect(normalizeTwitterHandle('https://x.com/SarahChen/')).toBe('sarahchen');
    });
  });
});

describe('Name matching', () => {
  it('matches exact names (case-insensitive)', () => {
    expect(namesMatch('Sarah Chen', 'sarah chen')).toBe(true);
  });

  it('matches first/last reorder', () => {
    expect(namesMatch('Sarah Chen', 'Chen Sarah')).toBe(true);
  });

  it('rejects different names', () => {
    expect(namesMatch('Sarah Chen', 'John Smith')).toBe(false);
  });

  it('levenshtein distance 0 for identical strings', () => {
    expect(levenshtein('sarah', 'sarah')).toBe(0);
  });

  it('levenshtein distance 1 for single edit', () => {
    expect(levenshtein('sarah', 'sarab')).toBe(1);
  });

  it('levenshtein distance 2 for two edits', () => {
    expect(levenshtein('sarah', 'sarab!')).toBe(2);
  });

  it('namesSimilar returns true for distance <= 2', () => {
    expect(namesSimilar('sarah chen', 'sara chen')).toBe(true);
  });

  it('namesSimilar returns false for distance > 2', () => {
    expect(namesSimilar('sarah chen', 'john smith')).toBe(false);
  });
});

describe('High-confidence merges', () => {
  it('merges candidates with matching LinkedIn URL', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('linkedin_url', 'https://linkedin.com/in/sarah-chen', 'exa')],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [makeId('linkedin_url', 'https://www.linkedin.com/in/sarah-chen/', 'github')],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.stats.highConfidenceMerges).toBeGreaterThanOrEqual(1);
    expect(result.candidates[0].identity.observedIdentifiers).toHaveLength(2);
  });

  it('merges candidates with matching email', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('email', 'sarah@gmail.com', 'exa')],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'hunter',
        identifiers: [makeId('email', 'Sarah@Gmail.com', 'hunter')],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
  });

  it('merges candidates with matching GitHub username', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('github_username', 'sarahchen', 'exa')],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [makeId('github_username', 'https://github.com/SarahChen', 'github')],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
  });

  it('merges via Gmail dot normalization', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [makeId('email', 'sarahchen@gmail.com', 'github')],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'hunter',
        identifiers: [makeId('email', 'sarah.chen@gmail.com', 'hunter')],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
  });
});

describe('Cross-source email linking', () => {
  it('merges when same email observed from different adapters', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [
          makeId('github_username', 'sarahchen', 'github'),
          makeId('email', 'sarah@company.com', 'github'),
        ],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'hunter',
        identifiers: [makeId('email', 'sarah@company.com', 'hunter')],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.stats.highConfidenceMerges).toBeGreaterThanOrEqual(1);
  });
});

describe('Medium-confidence merges', () => {
  it('merges same name + same company from different sources', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('name_company', 'Sarah Chen|Chainlink', 'exa')],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [makeId('name_company', 'Sarah Chen|Chainlink', 'github')],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.stats.mediumConfidenceMerges).toBeGreaterThanOrEqual(1);
  });

  it('does NOT merge same name + different company', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('name_company', 'Sarah Chen|Chainlink', 'exa')],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [makeId('name_company', 'Sarah Chen|Google', 'github')],
      }),
    ]);
    expect(result.candidates).toHaveLength(2);
  });

  it('does NOT merge same name + same company from same adapter', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('name_company', 'Sarah Chen|Chainlink', 'exa')],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('name_company', 'Sarah Chen|Chainlink', 'exa')],
      }),
    ]);
    expect(result.candidates).toHaveLength(2);
  });

  it('handles first/last name reorder in medium-confidence', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('name_company', 'Sarah Chen|Chainlink', 'exa')],
      }),
      makeRawCandidate({
        name: 'Chen Sarah',
        adapter: 'github',
        identifiers: [makeId('name_company', 'Chen Sarah|Chainlink', 'github')],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
  });
});

describe('Low-confidence merges (pending)', () => {
  it('flags similar name + similar company as pending', () => {
    // "Sara" vs "Sarah" = Levenshtein 1 (similar name, not exact)
    // "Chainklnk" vs "Chainlink" = Levenshtein 1 (similar company, not exact)
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('name_company', 'Sara Chen|Chainklnk', 'exa')],
      }),
      makeRawCandidate({
        name: 'Sara Chen',
        adapter: 'github',
        identifiers: [makeId('name_company', 'Sarah Chen|Chainlink', 'github')],
      }),
    ]);
    // Should NOT merge (low confidence), but should flag as pending
    expect(result.candidates).toHaveLength(2);
    expect(result.pendingMerges.length).toBeGreaterThanOrEqual(1);
    expect(result.stats.lowConfidenceSkipped).toBeGreaterThanOrEqual(1);
  });
});

describe('Acceptance: 3 sources merge to 1', () => {
  it('merges 3 candidates from exa, github, hunter with overlapping identifiers', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [
          makeId('linkedin_url', 'https://linkedin.com/in/sarah-chen', 'exa'),
          makeId('email', 'sarah@chainlink.com', 'exa'),
        ],
        evidence: [{
          id: 'ev-aaa001', claim: 'Found via Exa search', source: 'web_search',
          adapter: 'exa', retrievedAt: now, confidence: 'high',
        }],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [
          makeId('github_username', 'sarahchen', 'github'),
          makeId('email', 'sarah@chainlink.com', 'github'),
        ],
        evidence: [{
          id: 'ev-bbb002', claim: '847 Go commits', source: 'commits',
          adapter: 'github', retrievedAt: now, confidence: 'high',
        }],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'hunter',
        identifiers: [
          makeId('email', 'sarah@chainlink.com', 'hunter'),
        ],
        piiFields: [{
          value: 'sarah@chainlink.com', type: 'email',
          adapter: 'hunter', collectedAt: now,
        }],
      }),
    ]);

    expect(result.candidates).toHaveLength(1);

    const c = result.candidates[0];
    expect(c.identity.observedIdentifiers.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(c.sources)).toContain('exa');
    expect(Object.keys(c.sources)).toContain('github');
    expect(Object.keys(c.sources)).toContain('hunter');
    expect(c.evidence).toHaveLength(2);
    expect(c.pii.fields).toHaveLength(1);
  });
});

describe('Acceptance: genuinely different people', () => {
  it('does NOT merge two different people with similar names', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [
          makeId('linkedin_url', 'https://linkedin.com/in/sarah-chen', 'exa'),
          makeId('github_username', 'sarahchen', 'exa'),
          makeId('email', 'sarah@chainlink.com', 'exa'),
        ],
      }),
      makeRawCandidate({
        name: 'Sara Chen',
        adapter: 'exa',
        identifiers: [
          makeId('linkedin_url', 'https://linkedin.com/in/sara-chen-google', 'exa'),
          makeId('github_username', 'sarachen', 'exa'),
          makeId('email', 'sara@google.com', 'exa'),
        ],
      }),
    ]);
    expect(result.candidates).toHaveLength(2);
  });
});

describe('Acceptance: idempotent', () => {
  it('produces the same canonicalId on rerun', () => {
    const input: RawCandidate[] = [
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [
          makeId('linkedin_url', 'https://linkedin.com/in/sarah-chen', 'exa'),
          makeId('email', 'sarah@chainlink.com', 'exa'),
        ],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [
          makeId('email', 'sarah@chainlink.com', 'github'),
        ],
      }),
    ];

    const result1 = resolver.resolve(input);
    const result2 = resolver.resolve(input);

    expect(result1.candidates).toHaveLength(1);
    expect(result2.candidates).toHaveLength(1);
    expect(result1.candidates[0].id).toBe(result2.candidates[0].id);
  });
});

describe('Acceptance: order-independent', () => {
  it('produces the same canonicalId regardless of input order', () => {
    const exa = makeRawCandidate({
      name: 'Sarah Chen',
      adapter: 'exa',
      identifiers: [
        makeId('linkedin_url', 'https://linkedin.com/in/sarah-chen', 'exa'),
      ],
    });
    const github = makeRawCandidate({
      name: 'Sarah Chen',
      adapter: 'github',
      identifiers: [
        makeId('linkedin_url', 'https://linkedin.com/in/sarah-chen', 'github'),
        makeId('github_username', 'sarahchen', 'github'),
      ],
    });

    const result1 = resolver.resolve([exa, github]);
    const result2 = resolver.resolve([github, exa]);

    expect(result1.candidates).toHaveLength(1);
    expect(result2.candidates).toHaveLength(1);
    expect(result1.candidates[0].id).toBe(result2.candidates[0].id);
  });
});

describe('Edge cases', () => {
  it('handles empty input', () => {
    const result = resolver.resolve([]);
    expect(result.candidates).toHaveLength(0);
    expect(result.stats.inputCount).toBe(0);
  });

  it('handles single candidate (no merges)', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        identifiers: [makeId('email', 'sarah@gmail.com')],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.mergeLog).toHaveLength(0);
    expect(result.candidates[0].identity.mergedFrom).toBeUndefined();
    expect(result.candidates[0].identity.mergeConfidence).toBe(1.0);
  });

  it('handles transitive merges (A↔B, B↔C → all merge)', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('linkedin_url', 'https://linkedin.com/in/sarah-chen', 'exa')],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [
          makeId('linkedin_url', 'https://linkedin.com/in/sarah-chen', 'github'),
          makeId('email', 'sarah@chainlink.com', 'github'),
        ],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'hunter',
        identifiers: [makeId('email', 'sarah@chainlink.com', 'hunter')],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
  });

  it('handles candidate with only name_company identifiers', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        identifiers: [makeId('name_company', 'Sarah Chen|Chainlink')],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
    // canonicalId should still be generated (fallback to name_company)
    expect(result.candidates[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('deduplicates evidence by ID when merging', () => {
    const sharedEvidence = {
      id: 'ev-shared', claim: 'Same claim', source: 'web',
      adapter: 'exa', retrievedAt: now, confidence: 'high' as const,
    };
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('email', 'sarah@test.com', 'exa')],
        evidence: [sharedEvidence],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [makeId('email', 'sarah@test.com', 'github')],
        evidence: [sharedEvidence],
      }),
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].evidence).toHaveLength(1);
  });

  it('produces UUID-formatted canonicalId', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        identifiers: [makeId('email', 'sarah@test.com')],
      }),
    ]);
    expect(result.candidates[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('Merge result metadata', () => {
  it('returns accurate stats', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('email', 'sarah@test.com', 'exa')],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [makeId('email', 'sarah@test.com', 'github')],
      }),
      makeRawCandidate({
        name: 'John Smith',
        adapter: 'exa',
        identifiers: [makeId('email', 'john@test.com', 'exa')],
      }),
    ]);
    expect(result.stats.inputCount).toBe(3);
    expect(result.stats.outputCount).toBe(2);
    expect(result.stats.highConfidenceMerges).toBeGreaterThanOrEqual(1);
  });

  it('returns merge log with reasons', () => {
    const result = resolver.resolve([
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'exa',
        identifiers: [makeId('linkedin_url', 'https://linkedin.com/in/sarah-chen', 'exa')],
      }),
      makeRawCandidate({
        name: 'Sarah Chen',
        adapter: 'github',
        identifiers: [makeId('linkedin_url', 'https://linkedin.com/in/sarah-chen', 'github')],
      }),
    ]);
    expect(result.mergeLog).toHaveLength(1);
    expect(result.mergeLog[0].reason.rule).toBe('linkedin_url');
    expect(result.mergeLog[0].reason.confidence).toBe('high');
    expect(result.mergeLog[0].automatic).toBe(true);
  });
});
