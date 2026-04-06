import { describe, it, expect } from 'vitest';
import type {
  ScoredCandidate,
  EvidenceItem,
  Score,
  ExtractedSignals,
  SourceData,
} from '@sourcerer/core';
import { generateEvidenceId } from '@sourcerer/core';
import {
  buildPageProperties,
  buildPageBlocks,
} from '../page-builder.js';

// ---- Test Factories ----

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

function makeScore(evidence: EvidenceItem[], redFlags: Score['redFlags'] = []): Score {
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
    ],
    weights: { technicalDepth: 0.3, domainRelevance: 0.25 },
    redFlags,
  };
}

function makeScoredCandidate(
  id: string,
  name: string,
  overrides?: Partial<ScoredCandidate>,
): ScoredCandidate {
  const evidence = [makeEvidence({ claim: `${name} has deep expertise` })];
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
      ],
      mergeConfidence: 1,
    },
    name,
    sources: {},
    evidence,
    enrichments: {},
    signals: makeSignals(),
    score: makeScore(evidence),
    narrative: `${name} is a strong candidate with relevant experience.`,
    tier: 2,
    pii: { fields: [], retentionPolicy: 'default' },
    ...overrides,
  };
}

// ---- Tests ----

describe('buildPageProperties()', () => {
  it('returns correct Name, Score, Tier, CandidateId', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', { tier: 1 });
    const props = buildPageProperties(candidate);

    expect(props.Name.title[0].text.content).toBe('Alice');
    expect(props.Score.number).toBe(78);
    expect(props.Tier.select.name).toBe('Tier 1');
    expect(props.CandidateId.rich_text[0].text.content).toBe('c1');
  });

  it('extracts Role from sources rawProfile', () => {
    const sources: Record<string, SourceData> = {
      exa: {
        adapter: 'exa',
        retrievedAt: '2026-03-24T00:00:00Z',
        rawProfile: { title: 'Staff Engineer' },
        urls: [],
      },
    };
    const candidate = makeScoredCandidate('c1', 'Alice', { sources });
    const props = buildPageProperties(candidate);

    expect(props.Role.rich_text[0].text.content).toBe('Staff Engineer');
  });

  it('extracts Company from sources rawProfile', () => {
    const sources: Record<string, SourceData> = {
      exa: {
        adapter: 'exa',
        retrievedAt: '2026-03-24T00:00:00Z',
        rawProfile: { company: 'Acme Inc' },
        urls: [],
      },
    };
    const candidate = makeScoredCandidate('c1', 'Alice', { sources });
    const props = buildPageProperties(candidate);

    expect(props.Company.rich_text[0].text.content).toBe('Acme Inc');
  });

  it('extracts email from PII fields', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', {
      pii: {
        fields: [
          {
            value: 'alice@real.com',
            type: 'email',
            adapter: 'hunter',
            collectedAt: '2026-03-24T00:00:00Z',
          },
        ],
        retentionPolicy: 'default',
      },
    });
    const props = buildPageProperties(candidate);

    expect(props.Email.email).toBe('alice@real.com');
  });

  it('falls back to email from observedIdentifiers', () => {
    const candidate = makeScoredCandidate('c1', 'Alice');
    const props = buildPageProperties(candidate);

    expect(props.Email.email).toBe('alice@test.com');
  });

  it('returns null email when no email available', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', {
      identity: {
        canonicalId: 'c1',
        observedIdentifiers: [
          {
            type: 'github_username',
            value: 'alice',
            source: 'github',
            observedAt: '2026-03-24T00:00:00Z',
            confidence: 'high',
          },
        ],
        mergeConfidence: 1,
      },
      pii: { fields: [], retentionPolicy: 'default' },
    });
    const props = buildPageProperties(candidate);

    expect(props.Email.email).toBeNull();
  });

  it('sets Status to New', () => {
    const candidate = makeScoredCandidate('c1', 'Alice');
    const props = buildPageProperties(candidate);

    expect(props.Status.select.name).toBe('New');
  });

  it('includes PushedAt date', () => {
    const candidate = makeScoredCandidate('c1', 'Alice');
    const props = buildPageProperties(candidate);

    expect(props.PushedAt.date.start).toBeTruthy();
    expect(new Date(props.PushedAt.date.start).toISOString()).toBe(
      props.PushedAt.date.start,
    );
  });
});

describe('buildPageBlocks()', () => {
  it('starts with a narrative callout block', () => {
    const candidate = makeScoredCandidate('c1', 'Alice');
    const blocks = buildPageBlocks(candidate);

    expect(blocks[0].type).toBe('callout');
    const callout = blocks[0].callout as {
      rich_text: Array<{ text: { content: string } }>;
    };
    expect(callout.rich_text[0].text.content).toContain('Alice');
  });

  it('includes score breakdown table with correct rows', () => {
    const candidate = makeScoredCandidate('c1', 'Alice');
    const blocks = buildPageBlocks(candidate);

    // heading_2 "Score Breakdown" then table
    const tableBlock = blocks.find((b) => b.type === 'table');
    expect(tableBlock).toBeDefined();

    const table = tableBlock!.table as {
      table_width: number;
      has_column_header: boolean;
      children: Array<{ table_row: { cells: unknown[][] } }>;
    };
    expect(table.table_width).toBe(4);
    expect(table.has_column_header).toBe(true);
    // header + 2 data rows (technicalDepth + domainRelevance)
    expect(table.children).toHaveLength(3);
  });

  it('includes evidence items as bulleted list', () => {
    const candidate = makeScoredCandidate('c1', 'Alice');
    const blocks = buildPageBlocks(candidate);

    const bulletBlocks = blocks.filter(
      (b) => b.type === 'bulleted_list_item',
    );
    expect(bulletBlocks.length).toBeGreaterThan(0);

    const firstBullet = bulletBlocks[0].bulleted_list_item as {
      rich_text: Array<{ text: { content: string } }>;
    };
    expect(firstBullet.rich_text[0].text.content).toContain('Alice has deep expertise');
  });

  it('renders red flags callout when present', () => {
    const evidence = [makeEvidence()];
    const score = makeScore(evidence, [
      { signal: 'Job hopper', evidenceId: evidence[0].id, severity: 'medium' },
    ]);
    const candidate = makeScoredCandidate('c1', 'Alice', { score });
    const blocks = buildPageBlocks(candidate);

    const calloutBlocks = blocks.filter((b) => b.type === 'callout');
    // First callout = narrative, second = red flags
    expect(calloutBlocks).toHaveLength(2);
    const redFlagCallout = calloutBlocks[1].callout as {
      rich_text: Array<{ text: { content: string } }>;
      icon: { emoji: string };
    };
    expect(redFlagCallout.icon.emoji).toBe('⚠️');
    expect(redFlagCallout.rich_text[0].text.content).toContain('Job hopper');
  });

  it('does not render red flags section when empty', () => {
    const candidate = makeScoredCandidate('c1', 'Alice');
    const blocks = buildPageBlocks(candidate);

    const calloutBlocks = blocks.filter((b) => b.type === 'callout');
    // Only narrative callout, no red flags callout
    expect(calloutBlocks).toHaveLength(1);
  });

  it('includes profile links when identifiers have URLs', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', {
      identity: {
        canonicalId: 'c1',
        observedIdentifiers: [
          {
            type: 'linkedin_url',
            value: 'https://linkedin.com/in/alice',
            source: 'exa',
            observedAt: '2026-03-24T00:00:00Z',
            confidence: 'high',
          },
          {
            type: 'github_username',
            value: 'https://github.com/alice',
            source: 'github',
            observedAt: '2026-03-24T00:00:00Z',
            confidence: 'high',
          },
        ],
        mergeConfidence: 1,
      },
    });
    const blocks = buildPageBlocks(candidate);

    const paragraphBlocks = blocks.filter((b) => b.type === 'paragraph');
    expect(paragraphBlocks.length).toBeGreaterThan(0);

    const text = (
      paragraphBlocks[0].paragraph as {
        rich_text: Array<{ text: { content: string } }>;
      }
    ).rich_text[0].text.content;
    expect(text).toContain('linkedin.com/in/alice');
    expect(text).toContain('github.com/alice');
  });

  it('handles candidate with no evidence gracefully', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', { evidence: [] });
    const blocks = buildPageBlocks(candidate);

    // Should still have narrative + score breakdown, no evidence section
    const bulletBlocks = blocks.filter(
      (b) => b.type === 'bulleted_list_item',
    );
    expect(bulletBlocks).toHaveLength(0);
  });

  it('handles candidate with no profile link identifiers', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', {
      identity: {
        canonicalId: 'c1',
        observedIdentifiers: [
          {
            type: 'email',
            value: 'alice@test.com',
            source: 'exa',
            observedAt: '2026-03-24T00:00:00Z',
            confidence: 'high',
          },
        ],
        mergeConfidence: 1,
      },
    });
    const blocks = buildPageBlocks(candidate);

    // No paragraph blocks for profile links (email is not a url type)
    const paragraphBlocks = blocks.filter((b) => b.type === 'paragraph');
    expect(paragraphBlocks).toHaveLength(0);
  });
});
