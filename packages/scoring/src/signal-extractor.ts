// Signal extraction — LLM-driven scoring signal extraction with evidence grounding

import type {
  Candidate,
  TalentProfile,
  AIProvider,
  ExtractedSignals,
  EvidenceItem,
  TokenUsage,
} from '@sourcerer/core';
import { sanitizeUntrustedText } from '@sourcerer/core';
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
  usage: TokenUsage;
}

/**
 * Format evidence items into a readable string for the LLM prompt.
 *
 * Each claim is sandboxed: the text comes from untrusted sources (GitHub bios,
 * X posts, Exa snippets) and could attempt prompt injection. We wrap each item
 * in `<evidence>` delimiters and sanitize the payload (strip control chars,
 * defang angle brackets, truncate). The accompanying prompt tells the model to
 * treat tag contents as data, not instructions. See sanitize.ts and §H-1.
 */
export function formatEvidence(evidence: EvidenceItem[]): string {
  if (evidence.length === 0) return '(no evidence available)';
  return evidence
    .map((e) => {
      const safeClaim = sanitizeUntrustedText(e.claim);
      return `<evidence id="${e.id}" adapter="${e.adapter}" confidence="${e.confidence}">${safeClaim}</evidence>`;
    })
    .join('\n');
}

/**
 * Sanitize every string field of an arbitrary value, recursively.
 * Used to defang user-supplied talent-profile fields before they're serialized
 * into the prompt. Non-string leaves (numbers, booleans, dates) pass through.
 */
function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeUntrustedText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeDeep(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeDeep(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Format the talent profile into a readable string for the LLM prompt.
 *
 * Talent-profile text comes from user-typed role/company descriptions and
 * adapter-discovered company intel — both outside the trust boundary. Every
 * string field is sanitized before serialization, and the result is wrapped in
 * `<profile>` delimiters so the prompt can address it explicitly.
 */
export function formatTalentProfile(profile: TalentProfile): string {
  const safe = sanitizeDeep({
    role: profile.role,
    company: {
      name: profile.company.name,
      techStack: profile.company.techStack,
      cultureSignals: profile.company.cultureSignals,
    },
    successPatterns: profile.successPatterns,
    antiPatterns: profile.antiPatterns,
  });
  return `<profile>\n${JSON.stringify(safe, null, 2)}\n</profile>`;
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
  const { data: rawSignals, usage } = await provider.structuredOutput<ExtractedSignals>(
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
    usage,
  };
}
