// @sourcerer/core — Pipeline engine, interfaces, identity resolution, types

// Identity
export type {
  IdentifierType,
  ConfidenceLevel,
  ObservedIdentifier,
  PersonIdentity,
} from './identity.js';

// Evidence
export type { EvidenceItem, EvidenceIdInput } from './evidence.js';
export { generateEvidenceId } from './evidence.js';

// Scoring
export type {
  RedFlag,
  SignalDimension,
  ScoreComponent,
  Score,
  ExtractedSignals,
} from './scoring.js';

// Candidate
export type {
  PIIFieldType,
  PIIField,
  PIIMetadata,
  SourceData,
  RawCandidate,
  Candidate,
  ScoredCandidate,
  EnrichmentResult,
} from './candidate.js';
export { computeRetentionExpiresAt } from './candidate.js';

// Pipeline
export type {
  RateLimitConfig,
  CostEstimate,
  SearchPage,
  BatchResult,
  DataSourceCapability,
  DataSource,
  SearchQuery,
  SearchQueryTier,
  ScoringWeights,
  TierThresholds,
  EnrichmentPriority,
  AntiFilter,
  SearchConfig,
  OutputConfig,
  PushResult,
  UpsertResult,
  OutputAdapter,
} from './pipeline.js';

// AI
export type {
  MessageRole,
  Message,
  ChatOptions,
  ChatResult,
  StructuredOutputOptions,
  StructuredOutputResult,
  TokenUsage,
  AIProvider,
} from './ai.js';

// Identity Resolution
export type {
  MergeRule,
  MergeReason,
  MergeDecision,
  PendingMerge,
  ResolveResult,
} from './identity-resolver.js';
export { IdentityResolver } from './identity-resolver.js';

// Pipeline Runner
export type {
  PipelinePhaseName,
  PhaseStatus,
  PhaseFailure,
  PhaseResult,
  IntakePhaseOutput,
  DiscoverPhaseOutput,
  DedupPhaseOutput,
  EnrichPhaseOutput,
  ScorePhaseOutput,
  OutputPhaseOutput,
  PhaseOutputMap,
  PhaseHandler,
  PipelineHandlers,
  PipelineContext,
  PipelineRunConfig,
  CostSnapshot,
  ProgressEvent,
  PhaseTimingEntry,
  RunStatus,
  RunMeta,
  Checkpoint,
} from './pipeline-types.js';
export { PHASE_ORDER } from './pipeline-types.js';
export { PipelineRunner, createDedupHandler } from './pipeline-runner.js';
export { CostTracker } from './cost-tracker.js';
export { saveCheckpoint, loadCheckpoint, createCheckpoint } from './checkpoint.js';
export {
  generateRunDirName,
  createRunDirectory,
  writeRunMeta,
  writeArtifact,
} from './run-artifacts.js';

// Config
export type {
  AdapterKeyConfig,
  GitHubAdapterConfig,
  AIProviderName,
  OutputFormat,
  SourcererConfig,
} from './config.js';
export {
  CONFIG_DIR,
  CONFIG_PATH,
  KNOWN_ADAPTERS,
  AI_PROVIDER_NAMES,
  DEFAULT_RETENTION_TTL_DAYS,
  DEFAULT_OUTPUT_FORMAT,
  ConfigValidationError,
  SourcererConfigSchema,
  validateConfig,
  getConfiguredAdapters,
  getAdapterApiKey,
} from './config.js';

// Intake
export type {
  ConversationPhase,
  IntakeContext,
  ParsedResponse,
  ConversationNode,
  ProfileInput,
  CrawledContent,
  CompanyIntel,
  CareerStep,
  ProfileAnalysis,
  SimilarResult,
  ContentResearch,
  RoleParameters,
  CompetitorMap,
  TalentProfile,
} from './intake.js';

// Sanitization (untrusted text crossing into prompts/logs)
export type { SanitizeOptions } from './sanitize.js';
export {
  sanitizeUntrustedText,
  DEFAULT_MAX_LENGTH,
  TRUNCATION_MARKER,
} from './sanitize.js';

// PII redaction (for any value crossing into logs, stdout, or non-storage UI)
export { redactPII } from './pii-redact.js';
