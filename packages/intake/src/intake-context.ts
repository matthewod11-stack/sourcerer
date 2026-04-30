// IntakeContext accumulator — builds up structured data across conversation phases

import { z } from 'zod';
import type {
  IntakeContext,
  CompanyIntel,
  ProfileAnalysis,
  RoleParameters,
  CompetitorMap,
  TalentProfile,
  Message,
} from '@sourcerer/core';
import { IntakeContextSchema } from './schemas.js';

/**
 * Creates a fresh, empty IntakeContext.
 */
export function createIntakeContext(): IntakeContext {
  return {
    conversationHistory: [],
  };
}

/**
 * Merges partial updates into an existing IntakeContext, returning a new object.
 * Array fields (conversationHistory, teamProfiles, antiPatterns, similaritySeeds)
 * are concatenated rather than replaced.
 */
export function mergeContextUpdates(
  context: IntakeContext,
  updates: Partial<IntakeContext>,
): IntakeContext {
  const merged: IntakeContext = { ...context };

  // Scalar / object fields — overwrite if present
  if (updates.roleDescription !== undefined) merged.roleDescription = updates.roleDescription;
  if (updates.roleParameters !== undefined) merged.roleParameters = updates.roleParameters;
  if (updates.companyUrl !== undefined) merged.companyUrl = updates.companyUrl;
  if (updates.companyIntel !== undefined) merged.companyIntel = updates.companyIntel;
  if (updates.competitorMap !== undefined) merged.competitorMap = updates.competitorMap;
  if (updates.compositeProfile !== undefined) merged.compositeProfile = updates.compositeProfile;
  if (updates.talentProfile !== undefined) merged.talentProfile = updates.talentProfile;

  // Array fields — concatenate
  if (updates.teamProfiles) {
    merged.teamProfiles = [...(context.teamProfiles ?? []), ...updates.teamProfiles];
  }
  if (updates.antiPatterns) {
    merged.antiPatterns = [...(context.antiPatterns ?? []), ...updates.antiPatterns];
  }
  if (updates.similaritySeeds) {
    merged.similaritySeeds = [...(context.similaritySeeds ?? []), ...updates.similaritySeeds];
  }
  if (updates.conversationHistory) {
    merged.conversationHistory = [
      ...context.conversationHistory,
      ...updates.conversationHistory,
    ];
  }

  return merged;
}

/**
 * Appends a message to the conversation history.
 */
export function appendMessage(context: IntakeContext, message: Message): IntakeContext {
  return {
    ...context,
    conversationHistory: [...context.conversationHistory, message],
  };
}

/**
 * Checks whether the context has enough data to skip certain questions.
 */
export function hasRoleData(context: IntakeContext): boolean {
  return context.roleParameters !== undefined;
}

export function hasCompanyData(context: IntakeContext): boolean {
  return context.companyIntel !== undefined;
}

export function hasTeamProfiles(context: IntakeContext): boolean {
  return (context.teamProfiles ?? []).length > 0;
}

export function hasCompetitorMap(context: IntakeContext): boolean {
  return context.competitorMap !== undefined;
}

/**
 * Serializes IntakeContext to JSON string for save/resume.
 */
export function serializeContext(context: IntakeContext): string {
  return JSON.stringify(context, null, 2);
}

/**
 * Deserializes IntakeContext from JSON string. H-6: parses the JSON shape
 * with `IntakeContextSchema` so corrupt/drifted files surface a typed
 * error at the boundary rather than crashing later inside a phase.
 */
export function deserializeContext(json: string): IntakeContext {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `Invalid IntakeContext JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = IntakeContextSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(formatIntakeContextErrors(result.error));
  }
  return result.data as IntakeContext;
}

function formatIntakeContextErrors(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `  ${path}: ${issue.message}`;
  });
  return `Invalid IntakeContext:\n${issues.join('\n')}`;
}
