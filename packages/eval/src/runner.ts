import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AIProvider,
  Candidate,
  ExtractedSignals,
  ScoredCandidate,
  SignalDimension,
  TokenUsage,
} from '@sourcerer/core';
import {
  ExtractedSignalsSchema,
  extractSignals,
  calculateScore,
  assignTier,
  generateNarrative,
  formatEvidence,
  formatTalentProfile,
  validateGrounding,
} from '@sourcerer/scoring';
import { computeCost, renderTemplate } from '@sourcerer/ai';
import { z } from 'zod';
import { GOLDEN_SET } from './fixtures/golden-set.js';
import {
  SCORE_DIMENSIONS,
  type BatchRankingEntry,
  type CandidateEvalResult,
  type GoldenEvalComparison,
  type GoldenCandidate,
  type GoldenEvalMetrics,
  type GoldenEvalReport,
  type GoldenSet,
  type ScoreDimension,
} from './types.js';

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  model: 'gpt-4o-mini',
};

export interface RunGoldenEvalOptions {
  goldenSet?: GoldenSet;
  provider: AIProvider | ((fixture: GoldenCandidate) => AIProvider);
  modelLabel?: string;
  model?: string;
}

export interface WriteEvalReportOptions {
  outputDir?: string;
}

export interface RunBatchGoldenEvalOptions {
  goldenSet?: GoldenSet;
  provider: AIProvider;
  modelLabel?: string;
  model?: string;
}

export interface WriteEvalComparisonOptions {
  outputDir?: string;
}

const BatchScoredCandidateSchema = z.object({
  candidateId: z.string(),
  signals: ExtractedSignalsSchema,
  narrative: z.string(),
  rankingRationale: z.string().optional(),
});

const BatchScoringOutputSchema = z.object({
  candidates: z.array(BatchScoredCandidateSchema),
  ranking: z.array(
    z.object({
      candidateId: z.string(),
      rank: z.number().int().positive(),
      rationale: z.string(),
    }),
  ),
  summary: z.string(),
});

type BatchScoringOutput = z.infer<typeof BatchScoringOutputSchema>;

function providerFor(
  provider: AIProvider | ((fixture: GoldenCandidate) => AIProvider),
  fixture: GoldenCandidate,
): AIProvider {
  return typeof provider === 'function' ? provider(fixture) : provider;
}

function getDimension(signal: ExtractedSignals, dimension: ScoreDimension): SignalDimension {
  return signal[dimension];
}

function countValidatedCitations(signals: ExtractedSignals): number {
  return (
    SCORE_DIMENSIONS.reduce(
      (sum, dimension) => sum + getDimension(signals, dimension).evidenceIds.length,
      0,
    ) + signals.redFlags.length
  );
}

function sumDimensionDeltas(results: CandidateEvalResult[]): Record<ScoreDimension, number> {
  const sums = Object.fromEntries(SCORE_DIMENSIONS.map((dimension) => [dimension, 0])) as Record<
    ScoreDimension,
    number
  >;
  for (const result of results) {
    for (const dimension of SCORE_DIMENSIONS) {
      sums[dimension] += result.dimensionDeltas[dimension];
    }
  }
  return sums;
}

function computeMetrics(results: CandidateEvalResult[]): GoldenEvalMetrics {
  const candidateCount = results.length;
  const exactMatches = results.filter((result) => result.exactTierMatch).length;
  const proximityMatches = results.filter((result) => result.tierDistance <= 1).length;
  const deltaSums = sumDimensionDeltas(results);
  const totalHallucinations = results.reduce(
    (sum, result) => sum + result.hallucinationCount,
    0,
  );
  const totalCitedEvidence = results.reduce(
    (sum, result) => sum + result.citedEvidenceCount,
    0,
  );
  const totalCostUsd = results.reduce((sum, result) => sum + result.costUsd, 0);

  return {
    candidateCount,
    exactTierAccuracy: candidateCount === 0 ? 0 : exactMatches / candidateCount,
    tierProximityAccuracy: candidateCount === 0 ? 0 : proximityMatches / candidateCount,
    meanAbsoluteErrorByDimension: Object.fromEntries(
      SCORE_DIMENSIONS.map((dimension) => [
        dimension,
        candidateCount === 0 ? 0 : deltaSums[dimension] / candidateCount,
      ]),
    ) as Record<ScoreDimension, number>,
    hallucinationRate:
      totalCitedEvidence === 0 ? 0 : totalHallucinations / totalCitedEvidence,
    totalHallucinations,
    totalCitedEvidence,
    totalCostUsd,
  };
}

export function createGoldenFixtureProvider(fixture: GoldenCandidate): AIProvider {
  return {
    name: 'golden-fixture',
    async structuredOutput<T>(): Promise<{ data: T; usage: TokenUsage }> {
      return {
        data: fixture.expectedSignals as T,
        usage: ZERO_USAGE,
      };
    },
    async chat(): Promise<{ content: string; usage: TokenUsage }> {
      return {
        content: `[Fixture narrative] ${fixture.rationale}`,
        usage: ZERO_USAGE,
      };
    },
  };
}

export function createGoldenBatchFixtureProvider(
  goldenSet: GoldenSet = GOLDEN_SET,
): AIProvider {
  return {
    name: 'golden-batch-fixture',
    async structuredOutput<T>(): Promise<{ data: T; usage: TokenUsage }> {
      const ranking = [...goldenSet.candidates]
        .map((fixture) => ({
          candidateId: fixture.candidate.id,
          expectedTier: fixture.expectedTier,
          score:
            fixture.expectedSignals.technicalDepth.score *
              goldenSet.searchConfig.scoringWeights.technicalDepth +
            fixture.expectedSignals.domainRelevance.score *
              goldenSet.searchConfig.scoringWeights.domainRelevance +
            fixture.expectedSignals.trajectoryMatch.score *
              goldenSet.searchConfig.scoringWeights.trajectoryMatch +
            fixture.expectedSignals.cultureFit.score *
              goldenSet.searchConfig.scoringWeights.cultureFit +
            fixture.expectedSignals.reachability.score *
              goldenSet.searchConfig.scoringWeights.reachability,
        }))
        .sort((a, b) => a.expectedTier - b.expectedTier || b.score - a.score)
        .map((item, index) => ({
          candidateId: item.candidateId,
          rank: index + 1,
          rationale: `Fixture rank ${index + 1}; expected tier ${item.expectedTier}.`,
        }));

      return {
        data: {
          candidates: goldenSet.candidates.map((fixture) => ({
            candidateId: fixture.candidate.id,
            signals: fixture.expectedSignals,
            narrative: `[Batch fixture narrative] ${fixture.rationale}`,
            rankingRationale: fixture.rationale,
          })),
          ranking,
          summary: 'Deterministic fixture batch output.',
        } as T,
        usage: ZERO_USAGE,
      };
    },
    async chat(): Promise<{ content: string; usage: TokenUsage }> {
      return {
        content: '[Batch fixture provider does not use chat]',
        usage: ZERO_USAGE,
      };
    },
  };
}

export async function runGoldenEvaluation(
  options: RunGoldenEvalOptions,
): Promise<GoldenEvalReport> {
  const goldenSet = options.goldenSet ?? GOLDEN_SET;
  const results: CandidateEvalResult[] = [];

  for (const fixture of goldenSet.candidates) {
    const provider = providerFor(options.provider, fixture);
    const extraction = await extractSignals(
      fixture.candidate,
      goldenSet.talentProfile,
      provider,
      { model: options.model },
    );
    const score = calculateScore(
      extraction.signals,
      goldenSet.searchConfig.scoringWeights,
    );
    score.promptVersions = { ...extraction.signals.promptVersions };
    const tier = assignTier(score.total, goldenSet.searchConfig.tierThresholds);
    const narrative = await generateNarrative(
      fixture.candidate,
      goldenSet.talentProfile,
      extraction.signals,
      score,
      provider,
      { model: options.model },
    );
    score.promptVersions[narrative.prompt.name] = narrative.prompt.version;

    const scoredCandidate: ScoredCandidate = {
      ...fixture.candidate,
      signals: extraction.signals,
      score,
      narrative: narrative.narrative,
      tier,
    };

    const dimensionDeltas = Object.fromEntries(
      SCORE_DIMENSIONS.map((dimension) => [
        dimension,
        Math.abs(
          getDimension(extraction.signals, dimension).score -
            getDimension(fixture.expectedSignals, dimension).score,
        ),
      ]),
    ) as Record<ScoreDimension, number>;
    const hallucinationCount = extraction.grounding.violations.length;
    const citedEvidenceCount =
      hallucinationCount + countValidatedCitations(extraction.signals);
    const costUsd = computeCost(extraction.usage) + computeCost(narrative.usage);

    results.push({
      id: fixture.id,
      name: fixture.candidate.name,
      expectedTier: fixture.expectedTier,
      actualTier: tier,
      exactTierMatch: tier === fixture.expectedTier,
      tierDistance: Math.abs(tier - fixture.expectedTier),
      totalScore: score.total,
      dimensionDeltas,
      hallucinationCount,
      citedEvidenceCount,
      costUsd,
      scoredCandidate,
    });
  }

  return {
    name: goldenSet.name,
    generatedAt: new Date().toISOString(),
    modelLabel: options.modelLabel ?? 'unknown',
    mode: 'per-candidate',
    metrics: computeMetrics(results),
    results,
  };
}

function formatCandidateForBatch(candidate: Candidate): string {
  return `<candidate id="${candidate.id}" name="${candidate.name}">
${formatEvidence(candidate.evidence)}
</candidate>`;
}

function splitUsageAcrossCandidates(usage: TokenUsage, candidateCount: number): TokenUsage {
  if (candidateCount === 0) return usage;
  return {
    inputTokens: usage.inputTokens / candidateCount,
    outputTokens: usage.outputTokens / candidateCount,
    cachedTokens: usage.cachedTokens / candidateCount,
    model: usage.model,
  };
}

function compareMetrics(
  baseline: GoldenEvalMetrics,
  batch: GoldenEvalMetrics,
): GoldenEvalComparison['deltas'] {
  return {
    exactTierAccuracy: batch.exactTierAccuracy - baseline.exactTierAccuracy,
    tierProximityAccuracy:
      batch.tierProximityAccuracy - baseline.tierProximityAccuracy,
    hallucinationRate: batch.hallucinationRate - baseline.hallucinationRate,
    totalCostUsd: batch.totalCostUsd - baseline.totalCostUsd,
    meanAbsoluteErrorByDimension: Object.fromEntries(
      SCORE_DIMENSIONS.map((dimension) => [
        dimension,
        batch.meanAbsoluteErrorByDimension[dimension] -
          baseline.meanAbsoluteErrorByDimension[dimension],
      ]),
    ) as Record<ScoreDimension, number>,
  };
}

export async function runBatchGoldenEvaluation(
  options: RunBatchGoldenEvalOptions,
): Promise<GoldenEvalReport> {
  const goldenSet = options.goldenSet ?? GOLDEN_SET;
  const template = await renderTemplate('scoring-batch', {
    talentProfile: formatTalentProfile(goldenSet.talentProfile),
    scoringWeights: JSON.stringify(goldenSet.searchConfig.scoringWeights, null, 2),
    tierThresholds: JSON.stringify(goldenSet.searchConfig.tierThresholds, null, 2),
    candidates: goldenSet.candidates
      .map((fixture) => formatCandidateForBatch(fixture.candidate))
      .join('\n\n'),
  });
  const { data: batchOutput, usage } =
    await options.provider.structuredOutput<BatchScoringOutput>(
      [{ role: 'user', content: template.content }],
      {
        schema: BatchScoringOutputSchema,
        temperature: 0.2,
        model: options.model,
        maxTokens: 24000,
      },
    );

  const outputsByCandidateId = new Map(
    batchOutput.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const usageShare = splitUsageAcrossCandidates(
    usage,
    goldenSet.candidates.length,
  );
  const results: CandidateEvalResult[] = [];

  for (const fixture of goldenSet.candidates) {
    const output = outputsByCandidateId.get(fixture.candidate.id);
    if (!output) {
      throw new Error(
        `Batch scoring output missing candidate ${fixture.candidate.id}`,
      );
    }

    const grounding = validateGrounding(
      output.signals,
      new Set(fixture.candidate.evidence.map((evidence) => evidence.id)),
    );
    const signals: ExtractedSignals = {
      ...grounding.validated,
      promptVersions: {
        [template.metadata.name]: template.metadata.version,
      },
    };
    const score = calculateScore(
      signals,
      goldenSet.searchConfig.scoringWeights,
    );
    score.promptVersions = { ...signals.promptVersions };
    const tier = assignTier(score.total, goldenSet.searchConfig.tierThresholds);

    const scoredCandidate: ScoredCandidate = {
      ...fixture.candidate,
      signals,
      score,
      narrative: output.narrative,
      tier,
    };

    const dimensionDeltas = Object.fromEntries(
      SCORE_DIMENSIONS.map((dimension) => [
        dimension,
        Math.abs(
          getDimension(signals, dimension).score -
            getDimension(fixture.expectedSignals, dimension).score,
        ),
      ]),
    ) as Record<ScoreDimension, number>;
    const hallucinationCount = grounding.violations.length;
    const citedEvidenceCount = hallucinationCount + countValidatedCitations(signals);

    results.push({
      id: fixture.id,
      name: fixture.candidate.name,
      expectedTier: fixture.expectedTier,
      actualTier: tier,
      exactTierMatch: tier === fixture.expectedTier,
      tierDistance: Math.abs(tier - fixture.expectedTier),
      totalScore: score.total,
      dimensionDeltas,
      hallucinationCount,
      citedEvidenceCount,
      costUsd: computeCost(usageShare),
      scoredCandidate,
    });
  }

  return {
    name: goldenSet.name,
    generatedAt: new Date().toISOString(),
    modelLabel: options.modelLabel ?? options.model ?? 'unknown',
    mode: 'batch',
    metrics: computeMetrics(results),
    results,
    batchRanking: batchOutput.ranking,
  };
}

export async function runGoldenEvaluationComparison(options: {
  goldenSet?: GoldenSet;
  baselineProvider: AIProvider | ((fixture: GoldenCandidate) => AIProvider);
  batchProvider: AIProvider;
  modelLabel?: string;
  model?: string;
}): Promise<GoldenEvalComparison> {
  const baseline = await runGoldenEvaluation({
    goldenSet: options.goldenSet,
    provider: options.baselineProvider,
    modelLabel: options.modelLabel,
    model: options.model,
  });
  const batch = await runBatchGoldenEvaluation({
    goldenSet: options.goldenSet,
    provider: options.batchProvider,
    modelLabel: options.modelLabel,
    model: options.model,
  });

  return {
    name: baseline.name,
    generatedAt: new Date().toISOString(),
    modelLabel: options.modelLabel ?? options.model ?? 'unknown',
    baseline,
    batch,
    deltas: compareMetrics(baseline.metrics, batch.metrics),
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMarkdown(report: GoldenEvalReport): string {
  const mae = report.metrics.meanAbsoluteErrorByDimension;
  const rows = report.results
    .map(
      (result) =>
        `| ${result.name} | ${result.expectedTier} | ${result.actualTier} | ${result.totalScore.toFixed(1)} | ${result.hallucinationCount} |`,
    )
    .join('\n');

  return `# Sourcerer Golden Eval

- Generated: ${report.generatedAt}
- Golden set: ${report.name}
- Model: ${report.modelLabel}
- Mode: ${report.mode ?? 'per-candidate'}
- Candidates: ${report.metrics.candidateCount}
- Tier accuracy: ${pct(report.metrics.exactTierAccuracy)}
- Tier proximity (+/-1): ${pct(report.metrics.tierProximityAccuracy)}
- Hallucination rate: ${pct(report.metrics.hallucinationRate)}
- Total cost: $${report.metrics.totalCostUsd.toFixed(4)}

## Mean Absolute Error

| Dimension | MAE |
|---|---:|
${SCORE_DIMENSIONS.map((dimension) => `| ${dimension} | ${mae[dimension].toFixed(2)} |`).join('\n')}

## Candidates

| Candidate | Expected tier | Actual tier | Score | Hallucinations |
|---|---:|---:|---:|---:|
${rows}
`;
}

function signedPct(value: number): string {
  const pctValue = value * 100;
  return `${pctValue >= 0 ? '+' : ''}${pctValue.toFixed(1)}%`;
}

function signedUsd(value: number): string {
  return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(4)}`;
}

function formatComparisonMarkdown(comparison: GoldenEvalComparison): string {
  const maeRows = SCORE_DIMENSIONS.map((dimension) => {
    const baseline =
      comparison.baseline.metrics.meanAbsoluteErrorByDimension[dimension];
    const batch = comparison.batch.metrics.meanAbsoluteErrorByDimension[dimension];
    const delta = comparison.deltas.meanAbsoluteErrorByDimension[dimension];
    return `| ${dimension} | ${baseline.toFixed(2)} | ${batch.toFixed(2)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} |`;
  }).join('\n');

  const rankingRows = (comparison.batch.batchRanking ?? [])
    .sort((a, b) => a.rank - b.rank)
    .map((entry: BatchRankingEntry) => {
      const fixture = comparison.batch.results.find(
        (result) => result.scoredCandidate.id === entry.candidateId,
      );
      return `| ${entry.rank} | ${fixture?.name ?? entry.candidateId} | ${entry.rationale} |`;
    })
    .join('\n');

  return `# Sourcerer Batch Scoring Comparison

- Generated: ${comparison.generatedAt}
- Golden set: ${comparison.name}
- Model: ${comparison.modelLabel}

## Summary

| Metric | Per-candidate | Batch | Delta |
|---|---:|---:|---:|
| Tier accuracy | ${pct(comparison.baseline.metrics.exactTierAccuracy)} | ${pct(comparison.batch.metrics.exactTierAccuracy)} | ${signedPct(comparison.deltas.exactTierAccuracy)} |
| Tier proximity (+/-1) | ${pct(comparison.baseline.metrics.tierProximityAccuracy)} | ${pct(comparison.batch.metrics.tierProximityAccuracy)} | ${signedPct(comparison.deltas.tierProximityAccuracy)} |
| Hallucination rate | ${pct(comparison.baseline.metrics.hallucinationRate)} | ${pct(comparison.batch.metrics.hallucinationRate)} | ${signedPct(comparison.deltas.hallucinationRate)} |
| Cost | $${comparison.baseline.metrics.totalCostUsd.toFixed(4)} | $${comparison.batch.metrics.totalCostUsd.toFixed(4)} | ${signedUsd(comparison.deltas.totalCostUsd)} |

## Mean Absolute Error

| Dimension | Per-candidate | Batch | Delta |
|---|---:|---:|---:|
${maeRows}

## Batch Ranking

| Rank | Candidate | Rationale |
|---:|---|---|
${rankingRows || '| n/a | n/a | n/a |'}
`;
}

export async function writeEvalReports(
  report: GoldenEvalReport,
  options: WriteEvalReportOptions = {},
): Promise<{ jsonPath: string; markdownPath: string }> {
  const outputDir = options.outputDir ?? 'eval-results';
  await mkdir(outputDir, { recursive: true });
  const timestamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(outputDir, `${timestamp}.json`);
  const markdownPath = join(outputDir, `${timestamp}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  await writeFile(markdownPath, formatMarkdown(report), 'utf-8');
  return { jsonPath, markdownPath };
}

export async function writeEvalComparisonReports(
  comparison: GoldenEvalComparison,
  options: WriteEvalComparisonOptions = {},
): Promise<{ jsonPath: string; markdownPath: string }> {
  const outputDir = options.outputDir ?? 'eval-results';
  await mkdir(outputDir, { recursive: true });
  const timestamp = comparison.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(outputDir, `${timestamp}-batch-comparison.json`);
  const markdownPath = join(outputDir, `${timestamp}-batch-comparison.md`);
  await writeFile(jsonPath, JSON.stringify(comparison, null, 2), 'utf-8');
  await writeFile(
    markdownPath,
    formatComparisonMarkdown(comparison),
    'utf-8',
  );
  return { jsonPath, markdownPath };
}
