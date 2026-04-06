/**
 * Build Notion page properties and block children from a ScoredCandidate.
 */

import type {
  ScoredCandidate,
  ScoreComponent,
  EvidenceItem,
  RedFlag,
  SourceData,
  ObservedIdentifier,
} from '@sourcerer/core';

// ---- Page Properties ----

export interface NotionPageProperties {
  Name: { title: Array<{ text: { content: string } }> };
  Score: { number: number };
  Tier: { select: { name: string } };
  Role: { rich_text: Array<{ text: { content: string } }> };
  Company: { rich_text: Array<{ text: { content: string } }> };
  Email: { email: string | null };
  Status: { select: { name: string } };
  'Low Confidence Merge': { checkbox: boolean };
  CandidateId: { rich_text: Array<{ text: { content: string } }> };
  PushedAt: { date: { start: string } };
}

export function buildPageProperties(
  candidate: ScoredCandidate,
): NotionPageProperties {
  return {
    Name: { title: [{ text: { content: candidate.name } }] },
    Score: { number: candidate.score.total },
    Tier: { select: { name: `Tier ${candidate.tier}` } },
    Role: {
      rich_text: [{ text: { content: extractRole(candidate) } }],
    },
    Company: {
      rich_text: [{ text: { content: extractCompany(candidate) } }],
    },
    Email: { email: extractEmail(candidate) },
    Status: { select: { name: 'New' } },
    'Low Confidence Merge': {
      checkbox: candidate.identity.lowConfidenceMerge === true,
    },
    CandidateId: {
      rich_text: [{ text: { content: candidate.id } }],
    },
    PushedAt: { date: { start: new Date().toISOString() } },
  };
}

// ---- Block Children ----

/** A Notion block object (simplified for our use) */
export interface NotionBlock {
  object: 'block';
  type: string;
  [key: string]: unknown;
}

export function buildPageBlocks(candidate: ScoredCandidate): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  // 1. Narrative callout
  blocks.push(buildNarrativeBlock(candidate.narrative));

  // 2. Score breakdown heading + table
  blocks.push(buildHeadingBlock('Score Breakdown'));
  blocks.push(...buildScoreTableBlocks(candidate.score.breakdown));

  // 3. Evidence chain
  if (candidate.evidence.length > 0) {
    blocks.push(buildHeadingBlock('Evidence'));
    blocks.push(...buildEvidenceBlocks(candidate.evidence));
  }

  // 4. Red flags (only if present)
  if (candidate.score.redFlags.length > 0) {
    blocks.push(buildRedFlagsBlock(candidate.score.redFlags));
  }

  // 5. Profile links
  const profileLinks = extractProfileLinks(candidate.identity.observedIdentifiers);
  if (profileLinks.length > 0) {
    blocks.push(buildHeadingBlock('Profile Links'));
    blocks.push(buildProfileLinksBlock(profileLinks));
  }

  return blocks;
}

// ---- Internal Builders ----

function buildNarrativeBlock(narrative: string): NotionBlock {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: narrative } }],
      icon: { type: 'emoji', emoji: '📝' },
    },
  };
}

function buildHeadingBlock(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

function buildScoreTableBlocks(breakdown: ScoreComponent[]): NotionBlock[] {
  const headerRow: NotionBlock = {
    object: 'block',
    type: 'table_row',
    table_row: {
      cells: [
        [{ type: 'text', text: { content: 'Dimension' } }],
        [{ type: 'text', text: { content: 'Raw' } }],
        [{ type: 'text', text: { content: 'Weighted' } }],
        [{ type: 'text', text: { content: 'Confidence' } }],
      ],
    },
  };

  const dataRows: NotionBlock[] = breakdown.map((comp) => ({
    object: 'block',
    type: 'table_row',
    table_row: {
      cells: [
        [{ type: 'text', text: { content: formatDimension(comp.dimension) } }],
        [{ type: 'text', text: { content: String(comp.raw) } }],
        [{ type: 'text', text: { content: comp.weighted.toFixed(1) } }],
        [{ type: 'text', text: { content: comp.confidence.toFixed(2) } }],
      ],
    },
  }));

  const table: NotionBlock = {
    object: 'block',
    type: 'table',
    table: {
      table_width: 4,
      has_column_header: true,
      children: [headerRow, ...dataRows],
    },
  };

  return [table];
}

function buildEvidenceBlocks(evidence: EvidenceItem[]): NotionBlock[] {
  return evidence.map((ev) => {
    const urlSuffix = ev.url ? ` — ${ev.url}` : '';
    const content = `[${ev.id}] ${ev.claim} (${ev.adapter}, ${ev.confidence})${urlSuffix}`;
    return {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content } }],
      },
    };
  });
}

function buildRedFlagsBlock(redFlags: RedFlag[]): NotionBlock {
  const lines = redFlags
    .map((flag) => `${flag.signal} (${flag.severity})`)
    .join('\n');
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: lines } }],
      icon: { type: 'emoji', emoji: '⚠️' },
    },
  };
}

function buildProfileLinksBlock(
  links: Array<{ type: string; url: string }>,
): NotionBlock {
  const content = links.map((l) => `${l.type}: ${l.url}`).join('\n');
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content } }],
    },
  };
}

// ---- Extraction Helpers ----

function extractRole(candidate: ScoredCandidate): string {
  for (const sourceData of Object.values(candidate.sources)) {
    const profile = (sourceData as SourceData).rawProfile;
    if (profile) {
      const title =
        typeof profile['title'] === 'string'
          ? profile['title']
          : typeof profile['role'] === 'string'
            ? profile['role']
            : typeof profile['jobTitle'] === 'string'
              ? profile['jobTitle']
              : null;
      if (title) return title;
    }
  }
  return '';
}

function extractCompany(candidate: ScoredCandidate): string {
  for (const sourceData of Object.values(candidate.sources)) {
    const profile = (sourceData as SourceData).rawProfile;
    if (profile) {
      const company =
        typeof profile['company'] === 'string'
          ? profile['company']
          : typeof profile['organization'] === 'string'
            ? profile['organization']
            : null;
      if (company) return company;
    }
  }
  return '';
}

function extractEmail(candidate: ScoredCandidate): string | null {
  // Try PII fields first
  for (const field of candidate.pii.fields) {
    if (field.type === 'email') return field.value;
  }
  // Fall back to observed identifiers
  for (const id of candidate.identity.observedIdentifiers) {
    if (id.type === 'email') return id.value;
  }
  return null;
}

function extractProfileLinks(
  identifiers: ObservedIdentifier[],
): Array<{ type: string; url: string }> {
  const urlTypes = new Set(['linkedin_url', 'github_username', 'personal_url', 'twitter_handle']);
  const links: Array<{ type: string; url: string }> = [];
  const seen = new Set<string>();

  for (const id of identifiers) {
    if (urlTypes.has(id.type) && !seen.has(id.value)) {
      seen.add(id.value);
      const url =
        id.type === 'github_username'
          ? `https://github.com/${id.value}`
          : id.value;
      links.push({ type: id.type, url });
    }
  }
  return links;
}

function formatDimension(dimension: string): string {
  return dimension
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
