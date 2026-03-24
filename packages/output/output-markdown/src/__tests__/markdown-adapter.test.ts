import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ScoredCandidate,
  EvidenceItem,
  Score,
  ExtractedSignals,
  OutputConfig,
} from '@sourcerer/core';
import { generateEvidenceId } from '@sourcerer/core';
import { MarkdownOutputAdapter } from '../markdown-adapter.js';
import { renderReport } from '../renderer.js';

// --- Test Factories ---

function makeEvidence(overrides?: Partial<EvidenceItem>): EvidenceItem {
  const base = {
    adapter: 'exa',
    source: 'https://example.com/profile',
    claim: 'Senior engineer at Acme Corp',
    retrievedAt: '2026-03-24T00:00:00Z',
  };
  return {
    id: generateEvidenceId(base),
    ...base,
    confidence: 'high',
    url: 'https://example.com/profile',
    ...overrides,
  };
}

function makeSignals(): ExtractedSignals {
  const dim = { score: 8, evidenceIds: [], confidence: 0.9 };
  return {
    technicalDepth: dim,
    domainRelevance: dim,
    trajectoryMatch: dim,
    cultureFit: dim,
    reachability: dim,
    redFlags: [],
  };
}

function makeScore(
  total: number,
  evidence: EvidenceItem[],
  redFlags: Score['redFlags'] = [],
): Score {
  return {
    total,
    breakdown: [
      {
        dimension: 'technicalDepth',
        raw: 8,
        weight: 0.3,
        weighted: 24,
        evidenceIds: evidence.map((e) => e.id),
        confidence: 0.9,
      },
      {
        dimension: 'domainRelevance',
        raw: 7,
        weight: 0.25,
        weighted: 17.5,
        evidenceIds: [],
        confidence: 0.85,
      },
    ],
    weights: { technicalDepth: 0.3, domainRelevance: 0.25 },
    redFlags,
  };
}

function makeScoredCandidate(
  id: string,
  name: string,
  tier: 1 | 2 | 3,
  total = 70,
): ScoredCandidate {
  const evidence = [makeEvidence({ claim: `${name} has deep expertise` })];
  return {
    id,
    identity: {
      canonicalId: id,
      observedIdentifiers: [
        {
          type: 'github_username',
          value: name.toLowerCase().replace(' ', ''),
          source: 'exa',
          observedAt: '2026-03-24T00:00:00Z',
          confidence: 'high',
        },
      ],
      mergeConfidence: 1,
    },
    name,
    sources: {},
    evidence,
    enrichments: {},
    signals: makeSignals(),
    score: makeScore(total, evidence),
    narrative: `${name} is a strong candidate with relevant experience.`,
    tier,
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

// --- Tests ---

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-md-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('renderReport()', () => {
  it('includes report header with date and candidate count', () => {
    const report = renderReport([makeScoredCandidate('c1', 'Alice', 1, 85)]);
    expect(report).toContain('# Sourcerer Report');
    expect(report).toContain('**Candidates:** 1 total');
  });

  it('groups candidates by tier', () => {
    const candidates = [
      makeScoredCandidate('c1', 'Alice', 1, 85),
      makeScoredCandidate('c2', 'Bob', 2, 60),
      makeScoredCandidate('c3', 'Carol', 1, 90),
    ];
    const report = renderReport(candidates);
    expect(report).toContain('Tier 1 — Strong Match (2 candidates)');
    expect(report).toContain('Tier 2 — Moderate Match (1 candidate)');
  });

  it('sorts candidates by score descending within tier', () => {
    const candidates = [
      makeScoredCandidate('c1', 'Alice', 1, 75),
      makeScoredCandidate('c2', 'Bob', 1, 90),
    ];
    const report = renderReport(candidates);
    const bobPos = report.indexOf('Bob');
    const alicePos = report.indexOf('Alice');
    expect(bobPos).toBeLessThan(alicePos);
  });

  it('omits tier sections with no candidates', () => {
    const candidates = [makeScoredCandidate('c1', 'Alice', 2, 60)];
    const report = renderReport(candidates);
    expect(report).not.toContain('Tier 1');
    expect(report).toContain('Tier 2');
    expect(report).not.toContain('Tier 3');
  });

  it('includes narrative as blockquote', () => {
    const report = renderReport([makeScoredCandidate('c1', 'Alice', 1, 85)]);
    expect(report).toContain('> Alice is a strong candidate');
  });

  it('includes score breakdown table with all dimensions', () => {
    const report = renderReport([makeScoredCandidate('c1', 'Alice', 1, 85)]);
    expect(report).toContain('| Dimension |');
    expect(report).toContain('Technical Depth');
    expect(report).toContain('Domain Relevance');
    expect(report).toContain('0.30');
    expect(report).toContain('24.0');
  });

  it('includes red flags with severity and evidence ID', () => {
    const ev = makeEvidence({ claim: 'Frequent job changes' });
    const candidate = makeScoredCandidate('c1', 'Alice', 1, 80);
    candidate.score.redFlags = [
      { signal: 'Frequent job changes', evidenceId: ev.id, severity: 'medium' },
    ];
    const report = renderReport([candidate]);
    expect(report).toContain('**Red Flags:**');
    expect(report).toContain('Frequent job changes');
    expect(report).toContain('(medium)');
    expect(report).toContain(ev.id);
  });

  it('handles candidates with no red flags', () => {
    const report = renderReport([makeScoredCandidate('c1', 'Alice', 1, 85)]);
    expect(report).not.toContain('**Red Flags:**');
  });

  it('includes evidence items with IDs, claims, and URLs', () => {
    const report = renderReport([makeScoredCandidate('c1', 'Alice', 1, 85)]);
    expect(report).toContain('**Evidence:**');
    expect(report).toMatch(/\\?\[ev-[a-f0-9]+\\?\]/);
    expect(report).toContain('Alice has deep expertise');
    expect(report).toContain('[link](https://example.com/profile)');
  });

  it('handles evidence items with no URL', () => {
    const candidate = makeScoredCandidate('c1', 'Alice', 1, 85);
    candidate.evidence = [makeEvidence({ url: undefined })];
    const report = renderReport([candidate]);
    expect(report).toContain('**Evidence:**');
    expect(report).not.toContain('[link]');
  });

  it('handles empty candidate array', () => {
    const report = renderReport([]);
    expect(report).toContain('# Sourcerer Report');
    expect(report).toContain('**Candidates:** 0 total');
    expect(report).not.toContain('Tier 1');
    expect(report).toContain('Generated by Sourcerer');
  });

  it('includes footer with generation timestamp', () => {
    const report = renderReport([]);
    expect(report).toContain('*Generated by Sourcerer on');
  });

  it('renders 10 scored candidates correctly (acceptance test)', () => {
    const candidates: ScoredCandidate[] = [];
    for (let i = 0; i < 10; i++) {
      const tier = (i < 3 ? 1 : i < 7 ? 2 : 3) as 1 | 2 | 3;
      candidates.push(
        makeScoredCandidate(`c${i}`, `Candidate ${i}`, tier, 90 - i * 5),
      );
    }
    const report = renderReport(candidates);
    expect(report).toContain('10 total');
    expect(report).toContain('3 Tier 1');
    expect(report).toContain('4 Tier 2');
    expect(report).toContain('3 Tier 3');
    // All candidate names present
    for (let i = 0; i < 10; i++) {
      expect(report).toContain(`Candidate ${i}`);
    }
    // Score tables present
    expect(report.match(/\| Dimension \|/g)?.length).toBe(10);
  });

  it('includes tier breakdown in header', () => {
    const candidates = [
      makeScoredCandidate('c1', 'Alice', 1, 85),
      makeScoredCandidate('c2', 'Bob', 3, 30),
    ];
    const report = renderReport(candidates);
    expect(report).toContain('(1 Tier 1, 1 Tier 3)');
  });
});

describe('MarkdownOutputAdapter', () => {
  const adapter = new MarkdownOutputAdapter();

  describe('push()', () => {
    it('writes report.md to outputDir', async () => {
      const candidates = [makeScoredCandidate('c1', 'Alice', 1, 85)];
      const config: OutputConfig = { outputDir: testDir };
      await adapter.push(candidates, config);

      const content = await readFile(join(testDir, 'report.md'), 'utf-8');
      expect(content).toContain('# Sourcerer Report');
      expect(content).toContain('Alice');
    });

    it('creates outputDir if it does not exist', async () => {
      const nested = join(testDir, 'deep', 'nested');
      const config: OutputConfig = { outputDir: nested };
      await adapter.push([], config);

      const s = await stat(join(nested, 'report.md'));
      expect(s.isFile()).toBe(true);
    });

    it('returns correct PushResult', async () => {
      const candidates = [makeScoredCandidate('c1', 'Alice', 1, 85)];
      const config: OutputConfig = { outputDir: testDir };
      const result = await adapter.push(candidates, config);

      expect(result.adapter).toBe('markdown');
      expect(result.candidatesPushed).toBe(1);
      expect(result.outputLocation).toBe(join(testDir, 'report.md'));
    });

    it('uses custom filename from config.metadata.filename', async () => {
      const config: OutputConfig = {
        outputDir: testDir,
        metadata: { filename: 'summary.md' },
      };
      await adapter.push([], config);

      const s = await stat(join(testDir, 'summary.md'));
      expect(s.isFile()).toBe(true);
    });
  });

  describe('upsert()', () => {
    it('returns created when file does not exist', async () => {
      const config: OutputConfig = { outputDir: testDir };
      const result = await adapter.upsert(
        [makeScoredCandidate('c1', 'Alice', 1, 85)],
        config,
      );
      expect(result.created).toEqual(['c1']);
      expect(result.updated).toEqual([]);
    });

    it('returns updated when file already exists', async () => {
      const config: OutputConfig = { outputDir: testDir };
      await writeFile(join(testDir, 'report.md'), 'old', 'utf-8');

      const result = await adapter.upsert(
        [makeScoredCandidate('c1', 'Alice', 1, 85)],
        config,
      );
      expect(result.created).toEqual([]);
      expect(result.updated).toEqual(['c1']);
    });
  });

  describe('testConnection()', () => {
    it('returns true', async () => {
      expect(await adapter.testConnection()).toBe(true);
    });
  });
});
