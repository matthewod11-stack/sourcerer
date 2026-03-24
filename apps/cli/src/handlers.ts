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
} from '@sourcerer/core';
import type { ExaAdapter } from '@sourcerer/adapter-exa';
import type { GitHubAdapter } from '@sourcerer/adapter-github';

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

export function createEnrichHandler(adapters: {
  exa?: ExaAdapter;
  github?: GitHubAdapter;
}): PhaseHandler<DedupPhaseOutput, EnrichPhaseOutput> {
  return {
    async execute(input) {
      const candidates = [...input.candidates];
      let costIncurred = 0;

      for (const adapter of Object.values(adapters)) {
        if (!adapter) continue;

        const batch = await adapter.enrichBatch(candidates);
        costIncurred += batch.costIncurred;

        for (const { candidateId, result } of batch.succeeded) {
          const candidate = candidates.find((c) => c.id === candidateId);
          if (!candidate) continue;

          candidate.enrichments[result.adapter] = result;
          candidate.evidence.push(...result.evidence);
          candidate.pii.fields.push(...result.piiFields);
          if (!candidate.sources[result.adapter]) {
            candidate.sources[result.adapter] = result.sourceData;
          }
        }
      }

      return {
        status: 'completed',
        data: { candidates, costIncurred },
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
