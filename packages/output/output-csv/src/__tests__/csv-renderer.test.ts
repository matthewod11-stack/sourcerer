import { describe, it, expect } from 'vitest';
import type {
  ScoredCandidate,
  EvidenceItem,
  Score,
  ExtractedSignals,
} from '@sourcerer/core';
import { generateEvidenceId } from '@sourcerer/core';
import { renderCsv } from '../csv-renderer.js';

// --- Test Factories ---

function makeEvidence(overrides?: Partial<EvidenceItem>): EvidenceItem {
  const base = {
    adapter: 'exa',
    source: 'https://example.com/profile',
    claim: 'Senior engineer at Acme Corp',
    retrievedAt: '2026-03-24T00:00:00Z',
  };
  return {
    id: generateEvidenceId(base),
    ...base,
    confidence: 'high',
    url: 'https://example.com/profile',
    ...overrides,
  };
}

function makeSignals(): ExtractedSignals {
  const dim = { score: 8, evidenceIds: [], confidence: 0.9 };
  return {
    technicalDepth: dim,
    domainRelevance: dim,
    trajectoryMatch: dim,
    cultureFit: dim,
    reachability: dim,
    redFlags: [],
  };
}

function makeScore(evidence: EvidenceItem[]): Score {
  return {
    total: 78,
    breakdown: [
      {
        dimension: 'technicalDepth',
        raw: 8,
        weight: 0.3,
        weighted: 24,
        evidenceIds: evidence.map((e) => e.id),
        confidence: 0.9,
      },
      {
        dimension: 'domainRelevance',
        raw: 7,
        weight: 0.25,
        weighted: 17.5,
        evidenceIds: [],
        confidence: 0.85,
      },
      {
        dimension: 'cultureFit',
        raw: 6,
        weight: 0.2,
        weighted: 12,
        evidenceIds: [],
        confidence: 0.8,
      },
      {
        dimension: 'trajectoryMatch',
        raw: 5,
        weight: 0.15,
        weighted: 7.5,
        evidenceIds: [],
        confidence: 0.75,
      },
    ],
    weights: {
      technicalDepth: 0.3,
      domainRelevance: 0.25,
      cultureFit: 0.2,
      trajectoryMatch: 0.15,
    },
    redFlags: [],
  };
}

function makeScoredCandidate(
  id: string,
  name: string,
  tier: 1 | 2 | 3 = 2,
  scoreTotal = 78,
): ScoredCandidate {
  const evidence = [makeEvidence({ claim: `${name} has deep expertise` })];
  const score = makeScore(evidence);
  score.total = scoreTotal;
  return {
    id,
    identity: {
      canonicalId: id,
      observedIdentifiers: [
        {
          type: 'email',
          value: `${name.toLowerCase().replace(' ', '.')}@test.com`,
          source: 'exa',
          observedAt: '2026-03-24T00:00:00Z',
          confidence: 'high',
        },
        {
          type: 'linkedin_url',
          value: `https://linkedin.com/in/${name.toLowerCase().replace(' ', '-')}`,
          source: 'exa',
          observedAt: '2026-03-24T00:00:00Z',
          confidence: 'high',
        },
        {
          type: 'github_username',
          value: name.toLowerCase().replace(' ', ''),
          source: 'github',
          observedAt: '2026-03-24T00:00:00Z',
          confidence: 'high',
        },
      ],
      mergeConfidence: 1,
    },
    name,
    sources: {
      exa: {
        adapter: 'exa',
        retrievedAt: '2026-03-24T00:00:00Z',
        rawProfile: { title: 'Senior Engineer', company: 'Acme Corp' },
        urls: ['https://example.com/profile'],
      },
    },
    evidence,
    enrichments: {},
    signals: makeSignals(),
    score,
    narrative: `${name} is a strong candidate with relevant experience.`,
    tier,
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

// --- Tests ---

describe('renderCsv()', () => {
  it('sorts candidates by score descending', () => {
    const alice = makeScoredCandidate('c1', 'Alice', 1, 90);
    const bob = makeScoredCandidate('c2', 'Bob', 2, 70);
    const carol = makeScoredCandidate('c3', 'Carol', 1, 85);

    const csv = renderCsv([bob, alice, carol]);
    const lines = csv.split('\n').filter((l) => l.length > 0);
    // line 0 = header, line 1 = Alice (90), line 2 = Carol (85), line 3 = Bob (70)
    expect(lines[1]).toContain('Alice');
    expect(lines[2]).toContain('Carol');
    expect(lines[3]).toContain('Bob');
  });

  it('prepends UTF-8 BOM as first character', () => {
    const csv = renderCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('includes correct header row', () => {
    const csv = renderCsv([]);
    const headerLine = csv.slice(1).split('\n')[0]; // skip BOM
    expect(headerLine).toBe(
      'Name,Score,Tier,Current Role,Company,Email,Signal 1,Signal 2,Signal 3,Narrative,LinkedIn URL,GitHub URL,Low Confidence Merge',
    );
  });

  it('quotes fields that contain commas', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    candidate.narrative = 'Expert in AI, ML, and robotics.';

    const csv = renderCsv([candidate]);
    // The narrative field should be quoted because it contains commas
    expect(csv).toContain('"Expert in AI, ML, and robotics."');
  });

  it('double-escapes fields that contain quotes', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    candidate.narrative = 'Known as "The Best" engineer.';

    const csv = renderCsv([candidate]);
    // RFC 4180: quotes inside quoted fields are doubled
    expect(csv).toContain('"Known as ""The Best"" engineer."');
  });

  it('quotes fields that contain newlines', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    candidate.narrative = 'Line one.\nLine two.';

    const csv = renderCsv([candidate]);
    expect(csv).toContain('"Line one.\nLine two."');
  });

  it('returns header-only CSV for empty array', () => {
    const csv = renderCsv([]);
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1); // just the header
  });

  it('truncates narrative at 200 chars with ellipsis', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    candidate.narrative = 'A'.repeat(250);

    const csv = renderCsv([candidate]);
    // Should contain exactly 200 A's followed by ...
    expect(csv).toContain('A'.repeat(200) + '...');
    expect(csv).not.toContain('A'.repeat(201));
  });

  it('does not truncate narrative at exactly 200 chars', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    candidate.narrative = 'B'.repeat(200);

    const csv = renderCsv([candidate]);
    expect(csv).toContain('B'.repeat(200));
    expect(csv).not.toContain('...');
  });

  it('handles missing identifiers with empty cells', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    // Remove all identifiers except email
    candidate.identity.observedIdentifiers = [];
    candidate.pii = { fields: [], retentionPolicy: 'default' };

    // Should not throw
    const csv = renderCsv([candidate]);
    expect(csv).toBeTruthy();
    // The row should exist with empty values for email, linkedin, github
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // header + 1 data row
  });

  it('extracts top 3 signals sorted by weighted score', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    // Our makeScore provides 4 breakdown items:
    // technicalDepth (weighted=24), domainRelevance (17.5), cultureFit (12), trajectoryMatch (7.5)
    const csv = renderCsv([candidate]);

    // Signal 1 should be technicalDepth (highest weighted)
    expect(csv).toContain('technicalDepth: 8');
    // Signal 2 should be domainRelevance
    expect(csv).toContain('domainRelevance: 7');
    // Signal 3 should be cultureFit
    expect(csv).toContain('cultureFit: 6');
  });

  it('extracts email from PII fields first', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    candidate.pii = {
      fields: [
        {
          type: 'email',
          value: 'alice.pii@work.com',
          adapter: 'hunter',
          collectedAt: '2026-03-24T00:00:00Z',
        },
      ],
      retentionPolicy: 'default',
    };

    const csv = renderCsv([candidate]);
    expect(csv).toContain('alice.pii@work.com');
  });

  it('falls back to observed identifiers for email', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    // pii has no email, but observedIdentifiers has one
    candidate.pii = { fields: [], retentionPolicy: 'default' };

    const csv = renderCsv([candidate]);
    expect(csv).toContain('alice@test.com');
  });

  it('extracts LinkedIn URL from observed identifiers', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    const csv = renderCsv([candidate]);
    expect(csv).toContain('https://linkedin.com/in/alice');
  });

  it('formats GitHub URL from username', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    const csv = renderCsv([candidate]);
    expect(csv).toContain('https://github.com/alice');
  });

  it('extracts current role and company from sources', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    const csv = renderCsv([candidate]);
    expect(csv).toContain('Senior Engineer');
    expect(csv).toContain('Acme Corp');
  });

  it('returns empty strings for role/company when rawProfile is missing', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1);
    candidate.sources = {
      exa: {
        adapter: 'exa',
        retrievedAt: '2026-03-24T00:00:00Z',
        urls: [],
      },
    };

    const csv = renderCsv([candidate]);
    // Should not throw, and should have empty fields
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
  });
});
