// Intake runner — orchestrates the full intake conversation across all 4 phases

import type {
  IntakeContext,
  AIProvider,
  ContentResearch,
  SearchConfig,
  TalentProfile,
} from '@sourcerer/core';

import {
  ConversationEngine,
  buildGraph,
  restoreConversation,
  TERMINAL_NODE,
  type ConversationGraph,
  type ConversationState,
} from './conversation-engine.js';
import { createIntakeContext } from './intake-context.js';
import { createRoleContextNodes } from './phases/role-context.js';
import { createCompanyIntelNodes } from './phases/company-intel.js';
import { createSuccessProfileNodes } from './phases/success-profile.js';
import { createSearchConfigNodes, buildSearchConfig, buildTalentProfile } from './phases/search-config-gen.js';

// --- Intake Result ---

export interface IntakeResult {
  searchConfig: SearchConfig;
  talentProfile: TalentProfile;
  similaritySeeds: string[];
  context: IntakeContext;
}

// --- Intake Runner ---

export interface IntakeRunnerDeps {
  aiProvider: AIProvider;
  contentResearch: ContentResearch;
}

/**
 * Builds the full intake conversation graph connecting all 4 phases.
 *
 * Phase 1 (Role Context) → Phase 2 (Company Intel) → Phase 3 (Success Profile) → Phase 4 (Search Config) → DONE
 */
export function buildIntakeGraph(deps: IntakeRunnerDeps): ConversationGraph {
  const { aiProvider, contentResearch } = deps;

  // Build nodes for each phase, chaining them together
  const roleNodes = createRoleContextNodes(aiProvider, 'company_url_input');
  const companyNodes = createCompanyIntelNodes(aiProvider, contentResearch, 'team_input');
  const successNodes = createSuccessProfileNodes(aiProvider, contentResearch, 'config_generate');
  const configNodes = createSearchConfigNodes(aiProvider);

  return buildGraph([
    ...roleNodes,
    ...companyNodes,
    ...successNodes,
    ...configNodes,
  ]);
}

/**
 * Creates a new ConversationEngine with the full intake graph.
 */
export function createIntakeEngine(
  deps: IntakeRunnerDeps,
  initialContext?: IntakeContext,
): ConversationEngine {
  const graph = buildIntakeGraph(deps);
  return new ConversationEngine({
    graph,
    startNodeId: 'role_jd_input',
    initialContext: initialContext ?? createIntakeContext(),
  });
}

/**
 * Restores an intake engine from a previously saved state.
 */
export function restoreIntakeEngine(
  deps: IntakeRunnerDeps,
  stateJson: string,
): ConversationEngine {
  const graph = buildIntakeGraph(deps);
  return restoreConversation(graph, stateJson);
}

/**
 * Extracts the final IntakeResult from a completed conversation context.
 * Should be called after the engine reports isDone().
 */
export async function extractIntakeResult(
  context: IntakeContext,
  aiProvider: AIProvider,
): Promise<IntakeResult> {
  const searchConfig = await buildSearchConfig(context, aiProvider);
  const talentProfile = buildTalentProfile(context);
  const similaritySeeds = context.similaritySeeds ?? [];

  return {
    searchConfig,
    talentProfile,
    similaritySeeds,
    context,
  };
}
