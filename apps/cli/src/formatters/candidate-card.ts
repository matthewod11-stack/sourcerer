// Terminal card rendering for a single candidate

import chalk from 'chalk';
import type { ScoredCandidate } from '@sourcerer/core';

const CARD_WIDTH = 70;
const HORIZONTAL_RULE = '\u2500'.repeat(CARD_WIDTH);
const MAX_NARRATIVE_LENGTH = 160;

function tierColor(tier: 1 | 2 | 3): (text: string) => string {
  switch (tier) {
    case 1:
      return chalk.green;
    case 2:
      return chalk.yellow;
    case 3:
      return chalk.gray;
  }
}

function scoreColor(score: number): (text: string) => string {
  if (score >= 70) return chalk.green;
  if (score >= 40) return chalk.yellow;
  return chalk.red;
}

function extractRoleAndCompany(candidate: ScoredCandidate): string {
  for (const sourceData of Object.values(candidate.sources)) {
    const raw = sourceData.rawProfile;
    if (!raw) continue;
    const title = (raw.title ?? raw.role ?? '') as string;
    const company = (raw.company ?? '') as string;
    if (title || company) {
      if (title && company) return `${title} at ${company}`;
      return title || company;
    }
  }
  return '';
}

function extractLinkedIn(candidate: ScoredCandidate): string | null {
  for (const id of candidate.identity.observedIdentifiers) {
    if (id.type === 'linkedin_url') {
      return id.value;
    }
  }
  return null;
}

function extractGitHub(candidate: ScoredCandidate): string | null {
  for (const id of candidate.identity.observedIdentifiers) {
    if (id.type === 'github_username') {
      return id.value;
    }
  }
  return null;
}

function truncateNarrative(narrative: string): string {
  if (narrative.length <= MAX_NARRATIVE_LENGTH) return narrative;
  return narrative.slice(0, MAX_NARRATIVE_LENGTH - 3) + '...';
}

export function renderCandidateCard(candidate: ScoredCandidate): string {
  const lines: string[] = [];
  const total = candidate.score.total;
  const tier = candidate.tier;
  const colorFn = tierColor(tier);
  const scoreFn = scoreColor(total);

  // Header: Name, score, tier, low-confidence merge warning
  const nameStr = chalk.bold(candidate.name);
  const scoreStr = scoreFn(`${total}/100`);
  const tierStr = colorFn(`Tier ${tier}`);
  const mergeWarn = candidate.identity.lowConfidenceMerge
    ? chalk.yellow(' [Low-Confidence Merge]')
    : '';
  lines.push(`  ${nameStr}  ${scoreStr}  ${tierStr}${mergeWarn}`);

  // Subtitle: role/company
  const subtitle = extractRoleAndCompany(candidate);
  if (subtitle) {
    lines.push(`  ${chalk.dim(subtitle)}`);
  }

  // Horizontal rule
  lines.push(`  ${HORIZONTAL_RULE}`);

  // Top 3 signals from score.breakdown, sorted by weighted descending
  const topSignals = [...candidate.score.breakdown]
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 3);

  if (topSignals.length > 0) {
    const signalParts = topSignals.map(
      (s) => `${s.dimension}: ${s.raw.toFixed(1)}`,
    );
    lines.push(`  ${signalParts.join('   ')}`);
  }

  // Narrative
  lines.push('');
  lines.push(`  ${truncateNarrative(candidate.narrative)}`);

  // Links
  const linkedIn = extractLinkedIn(candidate);
  const github = extractGitHub(candidate);
  const linkParts: string[] = [];
  if (linkedIn) linkParts.push(`LinkedIn: ${linkedIn}`);
  if (github) linkParts.push(`GitHub: ${github}`);
  if (linkParts.length > 0) {
    lines.push('');
    lines.push(`  ${linkParts.join('    ')}`);
  }

  return lines.join('\n');
}
