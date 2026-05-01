import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AIProvider,
  ExtractedSignals,
  ScoredCandidate,
  SignalDimension,
  TokenUsage,
} from '@sourcerer/core';
import {
  extractSignals,
  calculateScore,
  assignTier,
  generateNarrative,
} from '@sourcerer/scoring';
import { computeCost } from '@sourcerer/ai';
import { GOLDEN_SET } from './fixtures/golden-set.js';
import {
  SCORE_DIMENSIONS,
  type CandidateEvalResult,
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
}

export interface WriteEvalReportOptions {
  outputDir?: string;
}

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
    metrics: computeMetrics(results),
    results,
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
