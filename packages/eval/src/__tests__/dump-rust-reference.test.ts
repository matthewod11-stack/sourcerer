// Set SOURCERER_DUMP_RUST_REFERENCE=1 to refresh tmp/golden-ts-reference.json.
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { calculateScore, assignTier } from '@sourcerer/scoring';
import type { ExtractedSignals, ScoringWeights, TierThresholds } from '@sourcerer/core';
import { GOLDEN_SET } from '../fixtures/golden-set.js';

const WEIGHTS = GOLDEN_SET.searchConfig.scoringWeights;
const THRESHOLDS = GOLDEN_SET.searchConfig.tierThresholds; // { tier1MinScore: 72, tier2MinScore: 48 }
const PENALTIES = { low: 2, medium: 5, high: 10 };

function dim(score: number, confidence: number) {
  return { score, evidenceIds: [] as string[], confidence };
}
function sig(
  td: number, dr: number, tm: number, cf: number, re: number,
  conf: number,
  redFlags: { signal: string; evidenceId: string; severity: 'low' | 'medium' | 'high' }[] = [],
): ExtractedSignals {
  return {
    technicalDepth: dim(td, conf), domainRelevance: dim(dr, conf), trajectoryMatch: dim(tm, conf),
    cultureFit: dim(cf, conf), reachability: dim(re, conf), redFlags,
  };
}
const flag = (severity: 'low' | 'medium' | 'high') => ({ signal: 's', evidenceId: 'ev-x', severity });

interface Adversarial {
  name: string;
  signals: ExtractedSignals;
  weights: ScoringWeights;
  thresholds: TierThresholds;
  penalties: { low: number; medium: number; high: number };
}
const EVEN_HEAVY: ScoringWeights = { technicalDepth: 0.3, domainRelevance: 0.3, trajectoryMatch: 0.3, cultureFit: 0.3, reachability: 0.3 }; // sum 1.5 → enables >100 raw

const ADVERSARIAL: Adversarial[] = [
  { name: 'redflag-low',        signals: sig(80,80,80,80,80, 1, [flag('low')]),    weights: WEIGHTS, thresholds: THRESHOLDS, penalties: PENALTIES },
  { name: 'redflag-medium',     signals: sig(80,80,80,80,80, 1, [flag('medium')]), weights: WEIGHTS, thresholds: THRESHOLDS, penalties: PENALTIES },
  { name: 'redflag-high',       signals: sig(80,80,80,80,80, 1, [flag('high')]),   weights: WEIGHTS, thresholds: THRESHOLDS, penalties: PENALTIES },
  { name: 'redflag-mixed-sum',  signals: sig(80,80,80,80,80, 1, [flag('low'), flag('medium'), flag('high')]), weights: WEIGHTS, thresholds: THRESHOLDS, penalties: PENALTIES },
  { name: 'confidence-zero',    signals: sig(80,80,80,80,80, 0),                    weights: WEIGHTS, thresholds: THRESHOLDS, penalties: PENALTIES },
  { name: 'confidence-partial', signals: sig(80,80,80,80,80, 0.5),                  weights: WEIGHTS, thresholds: THRESHOLDS, penalties: PENALTIES },
  // Per-dimension confidence gating: only techDepth (conf 1.0) contributes; the
  // other four (conf 0.0) gate to zero → total 100*0.30 = 30, tier 3. Proves
  // confidence is applied per-dimension, not as a single global factor.
  {
    name: 'confidence-mixed',
    signals: {
      technicalDepth: { score: 100, evidenceIds: [], confidence: 1.0 },
      domainRelevance: { score: 100, evidenceIds: [], confidence: 0.0 },
      trajectoryMatch: { score: 100, evidenceIds: [], confidence: 0.0 },
      cultureFit: { score: 100, evidenceIds: [], confidence: 0.0 },
      reachability: { score: 100, evidenceIds: [], confidence: 0.0 },
      redFlags: [],
    },
    weights: WEIGHTS, thresholds: THRESHOLDS, penalties: PENALTIES,
  },
  { name: 'clamp-low',          signals: sig(0,0,0,0,0, 1, [flag('high')]),         weights: WEIGHTS, thresholds: THRESHOLDS, penalties: PENALTIES },
  { name: 'clamp-high',         signals: sig(100,100,100,100,100, 1),               weights: EVEN_HEAVY, thresholds: THRESHOLDS, penalties: PENALTIES },
  { name: 'boundary-tier1',     signals: sig(72,72,72,72,72, 1),                    weights: WEIGHTS, thresholds: THRESHOLDS, penalties: PENALTIES },
  { name: 'boundary-tier2',     signals: sig(48,48,48,48,48, 1),                    weights: WEIGHTS, thresholds: THRESHOLDS, penalties: PENALTIES },
];

describe('dump-rust-reference', () => {
  it('captures TS scorer output for the Rust differential oracle', () => {
    const golden = GOLDEN_SET.candidates.map((g) => {
      const score = calculateScore(g.expectedSignals, WEIGHTS);
      const tier = assignTier(score.total, THRESHOLDS);
      return {
        id: g.id,
        name: g.candidate.name,
        evidence: g.candidate.evidence,
        expectedSignals: g.expectedSignals,
        expectedTier: g.expectedTier,
        ts: {
          total: score.total,
          breakdown: score.breakdown.map((c) => ({
            dimension: c.dimension, raw: c.raw, weight: c.weight, weighted: c.weighted, confidence: c.confidence,
          })),
          tier,
        },
      };
    });

    const adversarial = ADVERSARIAL.map((a) => {
      const score = calculateScore(a.signals, a.weights, { redFlagPenalties: a.penalties });
      const tier = assignTier(score.total, a.thresholds);
      return {
        name: a.name,
        signals: a.signals,
        config: { weights: a.weights, tierThresholds: a.thresholds, redFlagPenalties: a.penalties },
        ts: { total: score.total, tier },
      };
    });

    const commit = execSync('git rev-parse --short HEAD').toString().trim();
    const out = {
      meta: {
        capturedAt: new Date().toISOString(),
        sourcererCommit: commit,
        config: { weights: WEIGHTS, tierThresholds: THRESHOLDS, redFlagPenalties: PENALTIES },
      },
      golden,
      adversarial,
    };

    if (process.env.SOURCERER_DUMP_RUST_REFERENCE === '1') {
      mkdirSync('tmp', { recursive: true });
      writeFileSync('tmp/golden-ts-reference.json', JSON.stringify(out, null, 2));
    }

    expect(golden).toHaveLength(15);
    expect(adversarial).toHaveLength(11);
    // Sanity: ml001 = 94*.3 + 92*.25 + 90*.2 + 86*.15 + 72*.1 = 89.3
    expect(golden[0].ts.total).toBeCloseTo(89.3, 6);
    expect(golden[0].ts.tier).toBe(1);
  });
});
