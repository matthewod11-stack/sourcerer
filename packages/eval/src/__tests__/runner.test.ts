import { describe, expect, it } from 'vitest';
import {
  GOLDEN_SET,
  createGoldenBatchFixtureProvider,
  createGoldenFixtureProvider,
  runBatchGoldenEvaluation,
  runGoldenEvaluationComparison,
  runGoldenEvaluation,
} from '../index.js';

describe('golden eval runner', () => {
  it('ships at least 15 golden fixtures', () => {
    expect(GOLDEN_SET.candidates.length).toBeGreaterThanOrEqual(15);
  });

  it('computes perfect metrics with the deterministic fixture provider', async () => {
    const report = await runGoldenEvaluation({
      provider: createGoldenFixtureProvider,
      modelLabel: 'fixture',
    });

    expect(report.metrics.candidateCount).toBe(GOLDEN_SET.candidates.length);
    expect(report.metrics.exactTierAccuracy).toBe(1);
    expect(report.metrics.tierProximityAccuracy).toBe(1);
    expect(report.metrics.hallucinationRate).toBe(0);
    expect(report.metrics.totalCostUsd).toBe(0);
    expect(report.metrics.meanAbsoluteErrorByDimension.technicalDepth).toBe(0);
  });

  it('computes perfect batch metrics with the deterministic batch provider', async () => {
    const report = await runBatchGoldenEvaluation({
      provider: createGoldenBatchFixtureProvider(),
      modelLabel: 'fixture',
    });

    expect(report.mode).toBe('batch');
    expect(report.metrics.candidateCount).toBe(GOLDEN_SET.candidates.length);
    expect(report.metrics.exactTierAccuracy).toBe(1);
    expect(report.metrics.hallucinationRate).toBe(0);
    expect(report.batchRanking).toHaveLength(GOLDEN_SET.candidates.length);
  });

  it('compares per-candidate and batch evaluation metrics', async () => {
    const comparison = await runGoldenEvaluationComparison({
      baselineProvider: createGoldenFixtureProvider,
      batchProvider: createGoldenBatchFixtureProvider(),
      modelLabel: 'fixture',
    });

    expect(comparison.baseline.mode).toBe('per-candidate');
    expect(comparison.batch.mode).toBe('batch');
    expect(comparison.deltas.exactTierAccuracy).toBe(0);
    expect(comparison.deltas.totalCostUsd).toBe(0);
  });
});
