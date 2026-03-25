// Narrative generation — LLM-driven candidate narrative with evidence citations

import type {
  Candidate,
  TalentProfile,
  AIProvider,
  ExtractedSignals,
  Score,
} from '@sourcerer/core';
import { renderTemplate } from '@sourcerer/ai';
import { formatEvidence, formatTalentProfile } from './signal-extractor.js';

export interface NarrativeOptions {
  model?: string;
  temperature?: number;
}

/**
 * Format a Score into a readable breakdown for the LLM prompt.
 */
export function formatScoreBreakdown(score: Score): string {
  const lines = [`Total: ${score.total}/100`];

  for (const comp of score.breakdown) {
    lines.push(
      `- ${comp.dimension}: ${comp.raw} × ${comp.weight.toFixed(2)} = ${comp.weighted.toFixed(1)} (confidence: ${comp.confidence})`,
    );
  }

  if (score.redFlags.length > 0) {
    const flagSummary = score.redFlags
      .map((f) => `${f.severity}: "${f.signal}"`)
      .join(', ');
    lines.push(`Red flags: ${score.redFlags.length} (${flagSummary})`);
  } else {
    lines.push('Red flags: none');
  }

  return lines.join('\n');
}

/**
 * Generate a narrative assessment of a candidate using an LLM.
 *
 * The LLM receives the talent profile, candidate evidence, extracted signals,
 * and score breakdown, then writes a 3-5 paragraph assessment with evidence
 * citations (ev-XXXXXX).
 */
export async function generateNarrative(
  candidate: Candidate,
  talentProfile: TalentProfile,
  signals: ExtractedSignals,
  score: Score,
  provider: AIProvider,
  options?: NarrativeOptions,
): Promise<string> {
  const evidence = candidate.evidence;

  const templateVars = {
    talentProfile: formatTalentProfile(talentProfile),
    candidateName: candidate.name,
    evidence: formatEvidence(evidence),
    signals: JSON.stringify(signals, null, 2),
    scoreBreakdown: formatScoreBreakdown(score),
    evidenceIds: evidence.map((e) => e.id).join('\n'),
  };

  const prompt = await renderTemplate('scoring-narrative', templateVars);

  const narrative = await provider.chat(
    [{ role: 'user', content: prompt }],
    {
      temperature: options?.temperature ?? 0.3,
      model: options?.model,
    },
  );

  return narrative;
}
