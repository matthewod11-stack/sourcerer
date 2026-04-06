// CSV rendering — transforms ScoredCandidate[] into an RFC 4180 CSV string

import { stringify } from 'csv-stringify/sync';
import type { ScoredCandidate } from '@sourcerer/core';
import {
  extractCurrentRole,
  extractCompany,
  extractEmail,
  extractTopSignals,
  truncateNarrative,
  extractLinkedInUrl,
  extractGitHubUrl,
} from './field-extractors.js';

const CSV_HEADERS = [
  'Name',
  'Score',
  'Tier',
  'Current Role',
  'Company',
  'Email',
  'Signal 1',
  'Signal 2',
  'Signal 3',
  'Narrative',
  'LinkedIn URL',
  'GitHub URL',
  'Low Confidence Merge',
] as const;

const UTF8_BOM = '\uFEFF';

/**
 * Render an array of ScoredCandidates as an RFC 4180 CSV string.
 * Candidates are sorted by score descending.
 * Includes UTF-8 BOM for Excel compatibility.
 */
export function renderCsv(candidates: ScoredCandidate[]): string {
  const sorted = [...candidates].sort(
    (a, b) => b.score.total - a.score.total,
  );

  const rows: string[][] = sorted.map((candidate) => {
    const signals = extractTopSignals(candidate, 3);
    return [
      candidate.name,
      String(candidate.score.total),
      String(candidate.tier),
      extractCurrentRole(candidate.sources),
      extractCompany(candidate.sources),
      extractEmail(candidate),
      signals[0] ?? '',
      signals[1] ?? '',
      signals[2] ?? '',
      truncateNarrative(candidate.narrative, 200),
      extractLinkedInUrl(candidate),
      extractGitHubUrl(candidate),
      candidate.identity.lowConfidenceMerge ? 'Yes' : '',
    ];
  });

  const csv = stringify([Array.from(CSV_HEADERS), ...rows]);
  return UTF8_BOM + csv;
}
