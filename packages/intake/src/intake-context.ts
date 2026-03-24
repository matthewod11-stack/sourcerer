// IntakeContext accumulator — builds up structured data across conversation phases

import type {
  IntakeContext,
  CompanyIntel,
  ProfileAnalysis,
  RoleParameters,
  CompetitorMap,
  TalentProfile,
  Message,
} from '@sourcerer/core';

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
 * Deserializes IntakeContext from JSON string.
 * Throws if the JSON is invalid or missing required fields.
 */
export function deserializeContext(json: string): IntakeContext {
  const parsed = JSON.parse(json) as Record<string, unknown>;

  // Validate required field
  if (!Array.isArray(parsed.conversationHistory)) {
    throw new Error('Invalid IntakeContext: missing conversationHistory array');
  }

  return parsed as unknown as IntakeContext;
}
