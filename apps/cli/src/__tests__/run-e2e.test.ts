import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PipelineRunner,
  createDedupHandler,
  generateEvidenceId,
  type SearchConfig,
  type TalentProfile,
  type PhaseHandler,
  type IntakePhaseOutput,
  type DiscoverPhaseOutput,
  type DedupPhaseOutput,
  type EnrichPhaseOutput,
  type ScorePhaseOutput,
  type OutputPhaseOutput,
  type RawCandidate,
  type Candidate,
  type PipelineContext,
  type DataSource,
  type BatchResult,
  type EnrichmentResult,
  type CostEstimate,
  type RateLimitConfig,
} from '@sourcerer/core';
import { JsonOutputAdapter } from '@sourcerer/output-json';
import { MarkdownOutputAdapter } from '@sourcerer/output-markdown';
import { createStubScoreHandler, createOutputHandler, createEnrichHandler } from '../handlers.js';

// --- Test Fixtures ---

const searchConfig: SearchConfig = {
  roleName: 'Senior Backend Engineer',
  tiers: [
    {
      priority: 1,
      queries: [
        { text: 'senior backend engineer DeFi', maxResults: 5 },
      ],
    },
  ],
  scoringWeights: {
    technicalDepth: 0.3,
    domainRelevance: 0.25,
    trajectoryMatch: 0.2,
    cultureFit: 0.15,
    reachability: 0.1,
  },
  tierThresholds: { tier1MinScore: 70, tier2MinScore: 40 },
  enrichmentPriority: [],
  antiFilters: [],
  maxCandidates: 10,
  createdAt: '2026-03-24T00:00:00Z',
  version: 1,
};

const talentProfile: TalentProfile = {
  role: {
    title: 'Senior Backend Engineer',
    level: 'Senior',
    scope: 'Backend infrastructure',
    mustHaveSkills: ['Go'],
    niceToHaveSkills: [],
  },
  company: {
    name: 'Test Corp',
    url: 'https://testcorp.com',
    techStack: ['Go'],
    cultureSignals: [],
    analyzedAt: '2026-03-24T00:00:00Z',
  },
  successPatterns: {
    careerTrajectories: [],
    skillSignatures: [],
    seniorityCalibration: '',
    cultureSignals: [],
  },
  antiPatterns: [],
  competitorMap: {
    targetCompanies: [],
    avoidCompanies: [],
    competitorReason: {},
  },
  createdAt: '2026-03-24T00:00:00Z',
};

function makeRawCandidate(
  name: string,
  adapter: string,
  email?: string,
): RawCandidate {
  const now = '2026-03-24T00:00:00Z';
  const evInput = { adapter, source: `https://${name.toLowerCase().replace(' ', '')}.dev`, claim: `${name} is an engineer`, retrievedAt: now };
  return {
    name,
    identifiers: [
      {
        type: 'email' as const,
        value: email ?? `${name.toLowerCase().replace(' ', '.')}@test.com`,
        source: adapter,
        observedAt: now,
        confidence: 'high' as const,
      },
    ],
    sourceData: {
      adapter,
      retrievedAt: now,
      urls: [`https://${name.toLowerCase().replace(' ', '')}.dev`],
    },
    evidence: [
      {
        id: generateEvidenceId(evInput),
        ...evInput,
        confidence: 'medium' as const,
        url: evInput.source,
      },
    ],
    piiFields: email
      ? [{ value: email, type: 'email' as const, adapter, collectedAt: now }]
      : [],
  };
}

// --- Mock Handlers ---

function mockDiscoverHandler(
  candidates: RawCandidate[],
  cost = 0.01,
): PhaseHandler<IntakePhaseOutput, DiscoverPhaseOutput> {
  return {
    async execute() {
      return {
        status: 'completed',
        data: { rawCandidates: candidates, costIncurred: cost },
        costIncurred: cost,
      };
    },
  };
}

function mockEnrichHandler(): PhaseHandler<DedupPhaseOutput, EnrichPhaseOutput> {
  return {
    async execute(input) {
      // Add a mock GitHub evidence item to each candidate
      const now = new Date().toISOString();
      for (const c of input.candidates) {
        const evInput = {
          adapter: 'github',
          source: `https://github.com/${c.name.toLowerCase().replace(' ', '')}`,
          claim: `${c.name} has 15 public repos`,
          retrievedAt: now,
        };
        c.evidence.push({
          id: generateEvidenceId(evInput),
          ...evInput,
          confidence: 'high' as const,
          url: evInput.source,
        });
        c.enrichments['github'] = {
          adapter: 'github',
          candidateId: c.id,
          evidence: [c.evidence[c.evidence.length - 1]],
          piiFields: [],
          sourceData: {
            adapter: 'github',
            retrievedAt: now,
            urls: [evInput.source],
          },
          enrichedAt: now,
        };
      }
      return {
        status: 'completed',
        data: { candidates: input.candidates, costIncurred: 0 },
      };
    },
  };
}

// --- Tests ---

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-e2e-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

const testCandidates = [
  makeRawCandidate('Sarah Chen', 'exa', 'sarah@chainlink.com'),
  makeRawCandidate('Marcus Rivera', 'exa', 'marcus@alchemy.io'),
];

function buildPipeline(
  rawCandidates: RawCandidate[] = testCandidates,
  outputAdapters: import('@sourcerer/core').OutputAdapter[] = [new JsonOutputAdapter()],
) {
  return new PipelineRunner({
    discover: mockDiscoverHandler(rawCandidates),
    dedup: createDedupHandler(),
    enrich: mockEnrichHandler(),
    score: createStubScoreHandler(searchConfig),
    output: createOutputHandler(outputAdapters),
  });
}

describe('End-to-End Pipeline', () => {
  it('runs full pipeline: discover → dedup → enrich → score → output', async () => {
    const runner = buildPipeline();
    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    expect(meta.status).toBe('completed');
    const phaseNames = meta.phases.map((p) => p.phase);
    expect(phaseNames).toContain('discover');
    expect(phaseNames).toContain('dedup');
    expect(phaseNames).toContain('enrich');
    expect(phaseNames).toContain('score');
    expect(phaseNames).toContain('output');
  });

  it('produces candidates.json with scored candidates', async () => {
    const runner = buildPipeline();
    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    const jsonPath = join(meta.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.version).toBe(1);
    expect(parsed.candidateCount).toBe(2);
    expect(parsed.candidates.length).toBe(2);
    for (const c of parsed.candidates) {
      expect(c.score).toBeDefined();
      expect(c.tier).toBeDefined();
      expect(c.narrative).toContain('[Stub scoring]');
    }
  });

  it('produces report.md when markdown output configured', async () => {
    const runner = buildPipeline(testCandidates, [
      new JsonOutputAdapter(),
      new MarkdownOutputAdapter(),
    ]);
    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    const mdPath = join(meta.runDir, 'report.md');
    const content = await readFile(mdPath, 'utf-8');
    expect(content).toContain('# Sourcerer Report');
    expect(content).toContain('2 total');
  });

  it('creates run-meta.json with timing and cost', async () => {
    const runner = buildPipeline();
    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    const metaPath = join(meta.runDir, 'run-meta.json');
    const content = await readFile(metaPath, 'utf-8');
    const runMeta = JSON.parse(content);

    expect(runMeta.status).toBe('completed');
    expect(runMeta.cost.totalCost).toBeGreaterThanOrEqual(0);
    expect(runMeta.phases.length).toBeGreaterThan(0);
    expect(runMeta.candidateCount).toBe(2);
  });

  it('creates checkpoint.json after phases', async () => {
    const runner = buildPipeline();
    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    const cpPath = join(meta.runDir, 'checkpoint.json');
    const s = await stat(cpPath);
    expect(s.isFile()).toBe(true);

    const content = await readFile(cpPath, 'utf-8');
    const checkpoint = JSON.parse(content);
    expect(checkpoint.lastCompletedPhase).toBe('output');
  });

  it('can resume from checkpoint', async () => {
    // First run: discover + dedup only
    const partialRunner = new PipelineRunner({
      discover: mockDiscoverHandler(testCandidates),
      dedup: createDedupHandler(),
    });

    const meta1 = await partialRunner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });
    expect(meta1.lastCompletedPhase).toBe('dedup');

    // Second run: resume with remaining phases
    const fullRunner = new PipelineRunner({
      discover: mockDiscoverHandler(testCandidates),
      dedup: createDedupHandler(),
      enrich: mockEnrichHandler(),
      score: createStubScoreHandler(searchConfig),
      output: createOutputHandler([new JsonOutputAdapter()]),
    });

    const meta2 = await fullRunner.run({
      roleName: 'Senior Backend Engineer',
      resumeFrom: meta1.runDir,
    });

    expect(meta2.status).toBe('completed');
    expect(meta2.lastCompletedPhase).toBe('output');
    const jsonPath = join(meta2.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    expect(JSON.parse(content).candidateCount).toBe(2);
  });

  it('handles empty search results gracefully', async () => {
    const runner = buildPipeline([]);  // empty candidates
    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    expect(meta.status).toBe('completed');
    const jsonPath = join(meta.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    expect(JSON.parse(content).candidateCount).toBe(0);
  });

  it('stub scoring assigns tiers based on evidence count', async () => {
    const runner = buildPipeline();
    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    const jsonPath = join(meta.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(content);

    for (const c of parsed.candidates) {
      const expectedTotal = Math.min(100, 20 + c.evidence.length * 5);
      expect(c.score.total).toBe(expectedTotal);
      if (expectedTotal >= 70) expect(c.tier).toBe(1);
      else if (expectedTotal >= 40) expect(c.tier).toBe(2);
      else expect(c.tier).toBe(3);
    }
  });

  it('enrichment adds evidence to candidates', async () => {
    const runner = buildPipeline();
    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    const jsonPath = join(meta.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Each candidate should have enrichment evidence added
    for (const c of parsed.candidates) {
      // Original evidence (1) + GitHub enrichment evidence (1) = 2
      expect(c.evidence.length).toBeGreaterThanOrEqual(2);
      expect(c.enrichments).toHaveProperty('github');
    }
  });

  it('dedup merges duplicate candidates', async () => {
    // Two candidates with same email = should merge into 1
    const dupes = [
      makeRawCandidate('Sarah Chen', 'exa', 'sarah@test.com'),
      makeRawCandidate('Sarah Chen', 'github', 'sarah@test.com'),
    ];
    const runner = buildPipeline(dupes);
    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    const jsonPath = join(meta.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.candidateCount).toBe(1);
  });
});

// --- Enrichment Orchestrator Tests ---

function makeMockAdapter(
  name: string,
  options?: { shouldFail?: boolean; costPerCandidate?: number; evidenceCount?: number },
): DataSource {
  const { shouldFail = false, costPerCandidate = 0, evidenceCount = 1 } = options ?? {};
  const now = '2026-03-25T00:00:00Z';

  return {
    name,
    capabilities: ['enrichment'],
    rateLimits: { requestsPerSecond: 10 },
    async *search() {
      throw new Error(`${name} is enrichment-only`);
    },
    async enrich(candidate: Candidate): Promise<EnrichmentResult> {
      if (shouldFail) throw new Error(`${name} failed`);
      const evidence = Array.from({ length: evidenceCount }, (_, i) => ({
        id: generateEvidenceId({ adapter: name, source: `https://${name}.test`, claim: `claim-${i}`, retrievedAt: now }),
        claim: `${name} claim ${i} for ${candidate.name}`,
        source: `https://${name}.test`,
        adapter: name,
        retrievedAt: now,
        confidence: 'medium' as const,
      }));
      return {
        adapter: name,
        candidateId: candidate.id,
        evidence,
        piiFields: name === 'hunter' ? [{ value: `${candidate.name.toLowerCase().replace(' ', '.')}@test.com`, type: 'email' as const, adapter: 'hunter', collectedAt: now }] : [],
        sourceData: { adapter: name, retrievedAt: now, urls: [`https://${name}.test`] },
        enrichedAt: now,
      };
    },
    async enrichBatch(candidates: Candidate[]): Promise<BatchResult<EnrichmentResult>> {
      const succeeded: { candidateId: string; result: EnrichmentResult }[] = [];
      const failed: { candidateId: string; error: Error; retryable: boolean }[] = [];
      for (const c of candidates) {
        try {
          const result = await this.enrich(c);
          succeeded.push({ candidateId: c.id, result });
        } catch (err) {
          failed.push({ candidateId: c.id, error: err instanceof Error ? err : new Error(String(err)), retryable: false });
        }
      }
      return { succeeded, failed, costIncurred: succeeded.length * costPerCandidate };
    },
    async healthCheck() { return !shouldFail; },
    estimateCost(): CostEstimate {
      return { estimatedCost: costPerCandidate, breakdown: {}, searchCount: 0, enrichCount: 1, currency: 'USD' };
    },
  };
}

describe('Enrichment Orchestrator', () => {
  it('runs multiple adapters in parallel and merges results', async () => {
    const github = makeMockAdapter('github', { evidenceCount: 2 });
    const x = makeMockAdapter('x', { evidenceCount: 1 });

    const handler = createEnrichHandler(
      { github, x } as any,
    );

    const runner = new PipelineRunner({
      discover: mockDiscoverHandler(testCandidates),
      dedup: createDedupHandler(),
      enrich: handler,
      score: createStubScoreHandler(searchConfig),
      output: createOutputHandler([new JsonOutputAdapter()]),
    });

    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    expect(meta.status).toBe('completed');
    const jsonPath = join(meta.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(content);

    for (const c of parsed.candidates) {
      // Original exa evidence (1) + github (2) + x (1) = 4
      expect(c.evidence.length).toBeGreaterThanOrEqual(4);
      expect(c.enrichments).toHaveProperty('github');
      expect(c.enrichments).toHaveProperty('x');
    }
  });

  it('skips expensive adapters when cheap adapters provide enough signal', async () => {
    const github = makeMockAdapter('github', { evidenceCount: 3 });
    const hunter = makeMockAdapter('hunter', { costPerCandidate: 0.05 });

    const configWithConditional: SearchConfig = {
      ...searchConfig,
      enrichmentPriority: [
        { adapter: 'github', required: true, runCondition: 'always' },
        { adapter: 'hunter', required: false, runCondition: 'if_cheap_insufficient' },
      ],
    };

    const handler = createEnrichHandler(
      { github, hunter } as any,
      { enrichmentPriority: configWithConditional.enrichmentPriority },
    );

    const runner = new PipelineRunner({
      discover: mockDiscoverHandler(testCandidates),
      dedup: createDedupHandler(),
      enrich: handler,
      score: createStubScoreHandler(searchConfig),
      output: createOutputHandler([new JsonOutputAdapter()]),
    });

    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig: configWithConditional,
      talentProfile,
    });

    expect(meta.status).toBe('completed');
    const jsonPath = join(meta.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(content);

    for (const c of parsed.candidates) {
      expect(c.enrichments).toHaveProperty('github');
      // Hunter should be skipped since github provided 3+ evidence per candidate
      // (1 original exa + 3 github = 4 >= MIN_CHEAP_EVIDENCE=3)
      expect(c.enrichments).not.toHaveProperty('hunter');
    }
  });

  it('skips already-enriched candidates when within staleness TTL', async () => {
    const github = makeMockAdapter('github', { evidenceCount: 1 });

    const handler = createEnrichHandler(
      { github } as any,
      { staleTtlMs: 60 * 60 * 1000 }, // 1 hour TTL
    );

    // First run — should enrich
    const runner1 = new PipelineRunner({
      discover: mockDiscoverHandler(testCandidates),
      dedup: createDedupHandler(),
      enrich: handler,
      score: createStubScoreHandler(searchConfig),
      output: createOutputHandler([new JsonOutputAdapter()]),
    });

    const meta1 = await runner1.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    // Read candidates from first run
    const json1 = JSON.parse(await readFile(join(meta1.runDir, 'candidates.json'), 'utf-8'));
    for (const c of json1.candidates) {
      // Each candidate should have github enrichment
      expect(c.enrichments).toHaveProperty('github');
      // 1 original + 1 github = 2
      expect(c.evidence.length).toBe(2);
    }
  });

  it('handles partial adapter failure gracefully', async () => {
    const github = makeMockAdapter('github', { evidenceCount: 2 });
    const x = makeMockAdapter('x', { shouldFail: true });

    const handler = createEnrichHandler(
      { github, x } as any,
    );

    const runner = new PipelineRunner({
      discover: mockDiscoverHandler(testCandidates),
      dedup: createDedupHandler(),
      enrich: handler,
      score: createStubScoreHandler(searchConfig),
      output: createOutputHandler([new JsonOutputAdapter()]),
    });

    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig,
      talentProfile,
    });

    // Pipeline still completes — partial enrichment is OK
    expect(meta.status).toBe('completed');
    const jsonPath = join(meta.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(content);

    for (const c of parsed.candidates) {
      // GitHub succeeded, X failed — candidates still have github enrichment
      expect(c.enrichments).toHaveProperty('github');
    }
  });

  it('runs expensive adapters when cheap signal is insufficient', async () => {
    // GitHub provides only 1 evidence item (insufficient — need 3)
    const github = makeMockAdapter('github', { evidenceCount: 1 });
    const hunter = makeMockAdapter('hunter', { costPerCandidate: 0.05, evidenceCount: 1 });

    const configWithConditional: SearchConfig = {
      ...searchConfig,
      enrichmentPriority: [
        { adapter: 'github', required: true, runCondition: 'always' },
        { adapter: 'hunter', required: false, runCondition: 'if_cheap_insufficient' },
      ],
    };

    const handler = createEnrichHandler(
      { github, hunter } as any,
      { enrichmentPriority: configWithConditional.enrichmentPriority },
    );

    const runner = new PipelineRunner({
      discover: mockDiscoverHandler(testCandidates),
      dedup: createDedupHandler(),
      enrich: handler,
      score: createStubScoreHandler(searchConfig),
      output: createOutputHandler([new JsonOutputAdapter()]),
    });

    const meta = await runner.run({
      roleName: 'Senior Backend Engineer',
      runsBaseDir: testDir,
      searchConfig: configWithConditional,
      talentProfile,
    });

    expect(meta.status).toBe('completed');
    const jsonPath = join(meta.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(content);

    for (const c of parsed.candidates) {
      // Not enough cheap evidence, so hunter should have run
      expect(c.enrichments).toHaveProperty('github');
      expect(c.enrichments).toHaveProperty('hunter');
    }
  });
});
