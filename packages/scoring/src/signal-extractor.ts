// Signal extraction — LLM-driven scoring signal extraction with evidence grounding

import type {
  Candidate,
  TalentProfile,
  AIProvider,
  ExtractedSignals,
  EvidenceItem,
} from '@sourcerer/core';
import { renderTemplate } from '@sourcerer/ai';
import { ExtractedSignalsSchema } from './schemas.js';
import { validateGrounding, type GroundingResult } from './grounding-validator.js';

export interface ExtractSignalsOptions {
  /** Override model for the LLM call */
  model?: string;
  /** Temperature for the LLM call (default: 0.2 for consistency) */
  temperature?: number;
}

export interface SignalExtractionResult {
  signals: ExtractedSignals;
  grounding: GroundingResult;
}

/**
 * Format evidence items into a readable string for the LLM prompt.
 * Each item: [ev-XXXXXX] (adapter, confidence): claim
 */
export function formatEvidence(evidence: EvidenceItem[]): string {
  if (evidence.length === 0) return '(no evidence available)';
  return evidence
    .map((e) => `[${e.id}] (${e.adapter}, ${e.confidence}): ${e.claim}`)
    .join('\n');
}

/**
 * Format the talent profile into a readable string for the LLM prompt.
 */
export function formatTalentProfile(profile: TalentProfile): string {
  return JSON.stringify(
    {
      role: profile.role,
      company: {
        name: profile.company.name,
        techStack: profile.company.techStack,
        cultureSignals: profile.company.cultureSignals,
      },
      successPatterns: profile.successPatterns,
      antiPatterns: profile.antiPatterns,
    },
    null,
    2,
  );
}

/**
 * Extract scoring signals from a candidate's evidence using an LLM.
 *
 * The LLM analyzes evidence against the talent profile and returns
 * per-dimension scores with evidence ID citations. Evidence grounding
 * is validated post-hoc — hallucinated IDs are stripped, not thrown.
 */
export async function extractSignals(
  candidate: Candidate,
  talentProfile: TalentProfile,
  provider: AIProvider,
  options?: ExtractSignalsOptions,
): Promise<SignalExtractionResult> {
  const evidence = candidate.evidence;
  const canonicalIds = new Set(evidence.map((e) => e.id));

  // Format template variables
  const templateVars = {
    talentProfile: formatTalentProfile(talentProfile),
    evidence: formatEvidence(evidence),
    evidenceIds: evidence.map((e) => e.id).join('\n'),
  };

  // Render prompt from template
  const prompt = await renderTemplate('scoring-signal-extract', templateVars);

  // Call LLM with structured output
  const rawSignals = await provider.structuredOutput<ExtractedSignals>(
    [{ role: 'user', content: prompt }],
    {
      schema: ExtractedSignalsSchema,
      temperature: options?.temperature ?? 0.2,
      model: options?.model,
    },
  );

  // Validate evidence grounding
  const grounding = validateGrounding(rawSignals, canonicalIds);

  return {
    signals: grounding.validated,
    grounding,
  };
}
