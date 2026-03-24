// @sourcerer/intake — Interactive intake engine, conversation, content research

// Conversation Engine
export {
  ConversationEngine,
  buildGraph,
  validateGraph,
  restoreConversation,
  TERMINAL_NODE,
  type ConversationGraph,
  type ConversationState,
  type ConversationEngineOptions,
  type StepResult,
} from './conversation-engine.js';

// Intake Context
export {
  createIntakeContext,
  mergeContextUpdates,
  appendMessage,
  hasRoleData,
  hasCompanyData,
  hasTeamProfiles,
  hasCompetitorMap,
  serializeContext,
  deserializeContext,
} from './intake-context.js';

// Content Research
export {
  ContentResearchEngine,
  extractSimilaritySeeds,
  type ContentResearchDeps,
  type UrlCrawler,
  type GitHubAnalyzer,
  type SimilaritySearcher,
} from './content-research.js';

// Phases
export { createRoleContextNodes } from './phases/role-context.js';
export { createCompanyIntelNodes } from './phases/company-intel.js';
export {
  createSuccessProfileNodes,
  parseProfileInputs,
  buildCompositeProfile,
} from './phases/success-profile.js';
export {
  createSearchConfigNodes,
  generateSearchQueries,
  proposeScoringWeights,
  generateAntiFilters,
  defaultEnrichmentPriority,
  defaultTierThresholds,
  buildTalentProfile,
  buildSearchConfig,
} from './phases/search-config-gen.js';

// Schemas (for use by CLI content-research adapters)
export { ProfileAnalysisPartialSchema } from './schemas.js';

// Intake Runner
export {
  buildIntakeGraph,
  createIntakeEngine,
  restoreIntakeEngine,
  extractIntakeResult,
  type IntakeResult,
  type IntakeRunnerDeps,
} from './intake-runner.js';
