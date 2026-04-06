// Header summary block for results display

import chalk from 'chalk';
import type { RunMeta, ScoredCandidate } from '@sourcerer/core';

const DOUBLE_RULE = '\u2550'.repeat(70);

export function renderSummary(meta: RunMeta, candidates: ScoredCandidate[]): string {
  const lines: string[] = [];

  const tier1 = candidates.filter((c) => c.tier === 1).length;
  const tier2 = candidates.filter((c) => c.tier === 2).length;
  const tier3 = candidates.filter((c) => c.tier === 3).length;

  // Title
  lines.push(`  ${chalk.bold(`Sourcerer Results \u2014 ${meta.roleName}`)}`);

  // Run info line
  const runDate = meta.startedAt.slice(0, 10);
  const totalCandidates = candidates.length;
  const tierSummary = `${tier1} Tier 1  |  ${tier2} Tier 2  |  ${tier3} Tier 3`;
  lines.push(
    `  Run: ${runDate}  |  ${totalCandidates} candidates  |  ${tierSummary}`,
  );

  // Cost and duration
  const cost = `$${meta.cost.totalCost.toFixed(2)}`;
  const durationSec = meta.totalDurationMs
    ? `${Math.round(meta.totalDurationMs / 1000)}s`
    : 'N/A';
  lines.push(`  Cost: ${cost}  |  Duration: ${durationSec}`);

  // Double rule
  lines.push(`  ${DOUBLE_RULE}`);

  return lines.join('\n');
}
