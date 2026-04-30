// Pipeline runner types — phases, handlers, context, run metadata, checkpoints

import type { RawCandidate, Candidate, ScoredCandidate } from './candidate.js';
import type { SearchConfig, OutputConfig, CostEstimate } from './pipeline.js';
import type { TalentProfile } from './intake.js';
import type { ResolveResult } from './identity-resolver.js';

// --- Phase Definitions ---

export type PipelinePhaseName =
  | 'intake'
  | 'discover'
  | 'dedup'
  | 'enrich'
  | 'score'
  | 'output';

export const PHASE_ORDER: readonly PipelinePhaseName[] = [
  'intake',
  'discover',
  'dedup',
  'enrich',
  'score',
  'output',
] as const;

export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'partial';

export interface PhaseFailure {
  item: string;
  error: string;
  retryable: boolean;
}

export interface PhaseResult<T = unknown> {
  status: Extract<PhaseStatus, 'completed' | 'failed' | 'partial'>;
  data?: T;
  partialData?: T;
  failures?: PhaseFailure[];
  error?: string;
  costIncurred?: number;
}

// --- Phase Output Types ---

export interface IntakePhaseOutput {
  talentProfile: TalentProfile;
  searchConfig: SearchConfig;
  similaritySeeds: string[];
}

export interface DiscoverPhaseOutput {
  rawCandidates: RawCandidate[];
  costIncurred: number;
}

export interface DedupPhaseOutput {
  candidates: Candidate[];
  resolveResult: ResolveResult;
}

export interface EnrichPhaseOutput {
  candidates: Candidate[];
  costIncurred: number;
}

export interface ScorePhaseOutput {
  candidates: ScoredCandidate[];
  costIncurred: number;
}

export interface OutputPhaseOutput {
  outputLocations: Record<string, string>;
  candidatesPushed: number;
}

export interface PhaseOutputMap {
  intake: IntakePhaseOutput;
  discover: DiscoverPhaseOutput;
  dedup: DedupPhaseOutput;
  enrich: EnrichPhaseOutput;
  score: ScorePhaseOutput;
  output: OutputPhaseOutput;
}

// --- Phase Handlers ---

export interface PhaseHandler<TInput, TOutput> {
  execute(input: TInput, context: PipelineContext): Promise<PhaseResult<TOutput>>;
}

export interface PipelineHandlers {
  intake?: PhaseHandler<PipelineContext, IntakePhaseOutput>;
  discover?: PhaseHandler<IntakePhaseOutput, DiscoverPhaseOutput>;
  dedup?: PhaseHandler<DiscoverPhaseOutput, DedupPhaseOutput>;
  enrich?: PhaseHandler<DedupPhaseOutput, EnrichPhaseOutput>;
  score?: PhaseHandler<EnrichPhaseOutput, ScorePhaseOutput>;
  output?: PhaseHandler<ScorePhaseOutput, OutputPhaseOutput>;
}

// --- Cost Tracking ---

export interface CostSnapshot {
  totalCost: number;
  perPhase: Record<string, number>;
  perAdapter: Record<string, number>;
  currency: 'USD';
}

// --- Progress Events ---

export interface ProgressEvent {
  phase: PipelinePhaseName;
  status: PhaseStatus;
  message: string;
  timestamp: string;
}

// --- Pipeline Context ---

export interface PipelineContext {
  runId: string;
  runDir: string;
  searchConfig?: SearchConfig;
  talentProfile?: TalentProfile;
  phaseOutputs: Partial<PhaseOutputMap>;
  costSnapshot: CostSnapshot;
  /**
   * Days that PII collected during this run may be retained before becoming
   * eligible for redaction by `sourcerer candidates purge --expired`.
   * Sourced from `config.retention.ttlDays` (default 90). H-2.
   */
  retentionTtlDays?: number;
  onProgress?: (event: ProgressEvent) => void;
}

// --- Pipeline Run Configuration ---

export interface PipelineRunConfig {
  roleName: string;
  runsBaseDir?: string;
  searchConfig?: SearchConfig;
  talentProfile?: TalentProfile;
  resumeFrom?: string;
  startFromPhase?: PipelinePhaseName;
  outputConfig?: OutputConfig;
  maxCostUsd?: number;
  /** PII retention window in days. Forwarded to adapters via PipelineContext. H-2. */
  retentionTtlDays?: number;
  onProgress?: (event: ProgressEvent) => void;
}

// --- Run Metadata ---

export interface PhaseTimingEntry {
  phase: PipelinePhaseName;
  status: PhaseStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  costIncurred: number;
  itemsProcessed?: number;
  itemsFailed?: number;
  error?: string;
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'partial' | 'interrupted';

export interface RunMeta {
  runId: string;
  roleName: string;
  runDir: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  status: RunStatus;
  phases: PhaseTimingEntry[];
  lastCompletedPhase?: PipelinePhaseName;
  cost: CostSnapshot;
  estimatedCost?: number;
  candidateCount?: number;
  version: 1;
}

// --- Checkpoint ---

export interface Checkpoint {
  runId: string;
  runDir: string;
  lastCompletedPhase: PipelinePhaseName;
  phaseOutputs: Partial<PhaseOutputMap>;
  runMeta: RunMeta;
  createdAt: string;
  version: 1;
}
