// Phase handler factories — wire adapters into PipelineRunner

import type {
  PhaseHandler,
  IntakePhaseOutput,
  DiscoverPhaseOutput,
  DedupPhaseOutput,
  EnrichPhaseOutput,
  ScorePhaseOutput,
  OutputPhaseOutput,
  PipelineContext,
  SearchConfig,
  Candidate,
  ScoredCandidate,
  ExtractedSignals,
  OutputAdapter,
  RawCandidate,
  DataSource,
  EnrichmentPriority,
  BatchResult,
  EnrichmentResult,
} from '@sourcerer/core';
import type { ExaAdapter } from '@sourcerer/adapter-exa';
import type { GitHubAdapter } from '@sourcerer/adapter-github';
import type { XAdapter } from '@sourcerer/adapter-x';
import type { HunterAdapter } from '@sourcerer/adapter-hunter';

export function createDiscoverHandler(
  exa: ExaAdapter,
): PhaseHandler<IntakePhaseOutput, DiscoverPhaseOutput> {
  return {
    async execute(input) {
      const rawCandidates: RawCandidate[] = [];
      let costIncurred = 0;

      for await (const page of exa.search(input.searchConfig)) {
        rawCandidates.push(...page.candidates);
        costIncurred += page.costIncurred;
      }

      return {
        status: 'completed',
        data: { rawCandidates, costIncurred },
        costIncurred,
      };
    },
  };
}

// Default priority: free/fast first, expensive/quota-limited last
const DEFAULT_ADAPTER_ORDER = ['github', 'x', 'exa', 'hunter'];
const EXPENSIVE_ADAPTERS = new Set(['hunter']);
const MIN_CHEAP_EVIDENCE = 3;
const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface EnrichOrchestratorOptions {
  enrichmentPriority?: EnrichmentPriority[];
  maxCostUsd?: number;
  staleTtlMs?: number;
}

export function createEnrichHandler(
  adapters: {
    exa?: ExaAdapter;
    github?: GitHubAdapter;
    x?: XAdapter;
    hunter?: HunterAdapter;
  },
  options?: EnrichOrchestratorOptions,
): PhaseHandler<DedupPhaseOutput, EnrichPhaseOutput> {
  return {
    async execute(input) {
      const candidates = [...input.candidates];
      let costIncurred = 0;
      const allFailures: { item: string; error: string; retryable: boolean }[] = [];
      const staleTtlMs = options?.staleTtlMs ?? DEFAULT_STALE_TTL_MS;

      // Build ordered adapter list from priority config or defaults
      const adapterMap = adapters as Record<string, DataSource | undefined>;
      const priorityConfig = options?.enrichmentPriority;
      const orderedNames = priorityConfig?.length
        ? priorityConfig.map((p) => p.adapter)
        : DEFAULT_ADAPTER_ORDER;

      const activeAdapters: { name: string; adapter: DataSource; priority: EnrichmentPriority | undefined }[] = [];
      for (const name of orderedNames) {
        const adapter = adapterMap[name];
        if (!adapter) continue;
        const prio = priorityConfig?.find((p) => p.adapter === name);
        activeAdapters.push({ name, adapter, priority: prio });
      }

      // Also include any configured adapters not in the priority list
      for (const [name, adapter] of Object.entries(adapterMap)) {
        if (!adapter) continue;
        if (activeAdapters.some((a) => a.name === name)) continue;
        activeAdapters.push({ name, adapter, priority: undefined });
      }

      if (activeAdapters.length === 0) {
        return {
          status: 'completed',
          data: { candidates, costIncurred: 0 },
        };
      }

      // Partition into cheap and expensive
      const cheapAdapters = activeAdapters.filter((a) => !EXPENSIVE_ADAPTERS.has(a.name));
      const expensiveAdapters = activeAdapters.filter((a) => EXPENSIVE_ADAPTERS.has(a.name));

      // Budget gate: estimate total cost per adapter and skip those that would exceed budget
      let budgetRemaining = options?.maxCostUsd ?? Infinity;
      const budgetedAdapters = new Set<string>();
      if (options?.maxCostUsd !== undefined) {
        for (const { name, adapter } of activeAdapters) {
          const estimate = adapter.estimateCost({ ...({} as SearchConfig), maxCandidates: candidates.length } as SearchConfig);
          if (estimate.estimatedCost <= budgetRemaining) {
            budgetRemaining -= estimate.estimatedCost;
            budgetedAdapters.add(name);
          } else {
            console.warn(`[enrich] Skipping ${name}: estimated cost $${estimate.estimatedCost.toFixed(4)} exceeds remaining budget $${budgetRemaining.toFixed(4)}`);
          }
        }
      }

      // Helper: filter candidates that need enrichment from a given adapter
      const candidatesNeedingEnrichment = (adapterName: string): Candidate[] => {
        const now = Date.now();
        return candidates.filter((c) => {
          const existing = c.enrichments[adapterName];
          if (!existing) return true;
          return now - new Date(existing.enrichedAt).getTime() > staleTtlMs;
        });
      };

      // Helper: merge batch results into candidates
      const mergeBatchResults = (batch: BatchResult<EnrichmentResult>) => {
        costIncurred += batch.costIncurred;

        for (const { candidateId, result } of batch.succeeded) {
          const candidate = candidates.find((c) => c.id === candidateId);
          if (!candidate) continue;

          const adapterName = result.adapter;
          const isReEnrich = !!candidate.enrichments[adapterName];

          if (isReEnrich) {
            // Remove old evidence/PII from this adapter before adding new
            const oldEvIds = new Set(candidate.enrichments[adapterName].evidence.map((e) => e.id));
            candidate.evidence = candidate.evidence.filter((e) => !oldEvIds.has(e.id));
            const oldPiiValues = new Set(
              candidate.enrichments[adapterName].piiFields.map((p) => `${p.adapter}:${p.value}`),
            );
            candidate.pii.fields = candidate.pii.fields.filter(
              (p) => !oldPiiValues.has(`${p.adapter}:${p.value}`),
            );
          }

          candidate.enrichments[adapterName] = result;
          candidate.evidence.push(...result.evidence);
          candidate.pii.fields.push(...result.piiFields);
          candidate.sources[adapterName] = result.sourceData;
        }

        for (const failure of batch.failed) {
          allFailures.push({
            item: failure.candidateId,
            error: failure.error.message,
            retryable: failure.retryable,
          });
        }
      };

      // Run cheap adapters in parallel (respecting budget gate)
      const budgetFilteredCheap = options?.maxCostUsd !== undefined
        ? cheapAdapters.filter((a) => budgetedAdapters.has(a.name))
        : cheapAdapters;

      if (budgetFilteredCheap.length > 0) {
        const cheapResults = await Promise.allSettled(
          budgetFilteredCheap.map(({ name, adapter }) => {
            const toEnrich = candidatesNeedingEnrichment(name);
            if (toEnrich.length === 0) return Promise.resolve(null);
            return adapter.enrichBatch(toEnrich);
          }),
        );

        for (const result of cheapResults) {
          if (result.status === 'fulfilled' && result.value) {
            mergeBatchResults(result.value);
          } else if (result.status === 'rejected') {
            allFailures.push({
              item: 'adapter-batch',
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
              retryable: true,
            });
          }
        }
      }

      // Run expensive adapters conditionally (respecting budget gate)
      for (const { name, adapter, priority } of expensiveAdapters) {
        // Budget gate: skip if this adapter was excluded by budget
        if (options?.maxCostUsd !== undefined && !budgetedAdapters.has(name)) continue;

        // Check conditional execution
        if (priority?.runCondition === 'if_cheap_insufficient') {
          const allHaveEnoughEvidence = candidates.every(
            (c) => c.evidence.length >= MIN_CHEAP_EVIDENCE,
          );
          if (allHaveEnoughEvidence) continue;
        }

        const toEnrich = candidatesNeedingEnrichment(name);
        if (toEnrich.length === 0) continue;

        try {
          const batch = await adapter.enrichBatch(toEnrich);
          mergeBatchResults(batch);
        } catch (err) {
          allFailures.push({
            item: `adapter-${name}`,
            error: err instanceof Error ? err.message : String(err),
            retryable: true,
          });
        }
      }

      // Post-enrichment cross-candidate identity linking:
      // If two different candidates now share a PII email (discovered during enrichment),
      // merge the duplicate into the primary and remove it from the list.
      const emailToCandidate = new Map<string, number>();
      const indicesToRemove = new Set<number>();

      for (let i = 0; i < candidates.length; i++) {
        for (const pii of candidates[i].pii.fields) {
          if (pii.type !== 'email') continue;
          const email = pii.value.toLowerCase();
          const existingIdx = emailToCandidate.get(email);

          if (existingIdx !== undefined && existingIdx !== i && !indicesToRemove.has(i)) {
            // Merge candidate[i] into candidate[existingIdx]
            const primary = candidates[existingIdx];
            const duplicate = candidates[i];
            console.log(`[enrich] Merging duplicate: ${duplicate.name} → ${primary.name} (shared email: ${email})`);

            // Merge evidence (deduplicate by ID)
            const existingEvIds = new Set(primary.evidence.map((e) => e.id));
            for (const ev of duplicate.evidence) {
              if (!existingEvIds.has(ev.id)) primary.evidence.push(ev);
            }

            // Merge PII (deduplicate by adapter:value)
            const existingPii = new Set(primary.pii.fields.map((p) => `${p.adapter}:${p.value}`));
            for (const p of duplicate.pii.fields) {
              if (!existingPii.has(`${p.adapter}:${p.value}`)) primary.pii.fields.push(p);
            }

            // Merge enrichments and sources
            for (const [k, v] of Object.entries(duplicate.enrichments)) {
              if (!primary.enrichments[k]) primary.enrichments[k] = v;
            }
            for (const [k, v] of Object.entries(duplicate.sources)) {
              if (!primary.sources[k]) primary.sources[k] = v;
            }

            indicesToRemove.add(i);
          } else if (existingIdx === undefined) {
            emailToCandidate.set(email, i);
          }
        }
      }

      // Remove merged duplicates (iterate in reverse to preserve indices)
      if (indicesToRemove.size > 0) {
        const sorted = [...indicesToRemove].sort((a, b) => b - a);
        for (const idx of sorted) {
          candidates.splice(idx, 1);
        }
      }

      const hasFailures = allFailures.length > 0;
      const output = { candidates, costIncurred };

      return {
        status: hasFailures ? 'partial' : 'completed',
        data: hasFailures ? undefined : output,
        partialData: hasFailures ? output : undefined,
        failures: hasFailures ? allFailures : undefined,
        costIncurred,
      };
    },
  };
}

export function createStubScoreHandler(
  searchConfig: SearchConfig,
): PhaseHandler<EnrichPhaseOutput, ScorePhaseOutput> {
  return {
    async execute(input) {
      const stubSignals: ExtractedSignals = {
        technicalDepth: { score: 5, evidenceIds: [], confidence: 0.5 },
        domainRelevance: { score: 5, evidenceIds: [], confidence: 0.5 },
        trajectoryMatch: { score: 5, evidenceIds: [], confidence: 0.5 },
        cultureFit: { score: 5, evidenceIds: [], confidence: 0.5 },
        reachability: { score: 5, evidenceIds: [], confidence: 0.5 },
        redFlags: [],
      };

      const candidates: ScoredCandidate[] = input.candidates.map(
        (c: Candidate) => {
          const total = Math.min(100, 20 + c.evidence.length * 5);
          const tier: 1 | 2 | 3 =
            total >= searchConfig.tierThresholds.tier1MinScore
              ? 1
              : total >= searchConfig.tierThresholds.tier2MinScore
                ? 2
                : 3;

          const sources = Object.keys(c.sources).join(', ') || 'unknown';
          return {
            ...c,
            signals: stubSignals,
            score: {
              total,
              breakdown: [],
              weights: searchConfig.scoringWeights,
              redFlags: [],
            },
            narrative: `[Stub scoring] ${c.name} — ${c.evidence.length} evidence items from ${sources}`,
            tier,
          };
        },
      );

      return {
        status: 'completed',
        data: { candidates, costIncurred: 0 },
      };
    },
  };
}

export function createOutputHandler(
  outputAdapters: OutputAdapter[],
): PhaseHandler<ScorePhaseOutput, OutputPhaseOutput> {
  return {
    async execute(input, context: PipelineContext) {
      const outputLocations: Record<string, string> = {};
      let candidatesPushed = 0;

      for (const adapter of outputAdapters) {
        const result = await adapter.push(input.candidates, {
          outputDir: context.runDir,
        });
        outputLocations[adapter.name] = result.outputLocation;
        candidatesPushed = result.candidatesPushed;
      }

      return {
        status: 'completed',
        data: { outputLocations, candidatesPushed },
      };
    },
  };
}
