import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  AIProvider,
  Message,
  ChatOptions,
  ChatResult,
  StructuredOutputOptions,
  StructuredOutputResult,
  TokenUsage,
  RawCandidate,
  PhaseHandler,
  IntakePhaseOutput,
  DiscoverPhaseOutput,
  DedupPhaseOutput,
  EnrichPhaseOutput,
} from '@sourcerer/core';

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  model: 'mock',
};
import {
  PipelineRunner,
  createDedupHandler,
  generateEvidenceId,
} from '@sourcerer/core';
import {
  createIntakeEngine,
  extractIntakeResult,
  ContentResearchEngine,
  type UrlCrawler,
  type GitHubAnalyzer,
  type SimilaritySearcher,
} from '@sourcerer/intake';
import { JsonOutputAdapter } from '@sourcerer/output-json';
import { createStubScoreHandler, createOutputHandler } from '../handlers.js';

// --- Mocks ---

function createMockAI(): AIProvider {
  function pickStructuredData<T>(messages: Message[]): T {
    const systemMsg = messages[0]?.content ?? '';
    if (systemMsg.includes('role') || systemMsg.includes('job')) {
      return {
        title: 'Backend Engineer',
        level: 'Senior',
        scope: 'Backend',
        mustHaveSkills: ['Go'],
        niceToHaveSkills: [],
      } as T;
    }
    if (systemMsg.includes('competitor')) {
      return {
        targetCompanies: ['Chainlink'],
        avoidCompanies: [],
        competitorReason: { Chainlink: 'Similar infra' },
      } as T;
    }
    if (systemMsg.includes('company') || systemMsg.includes('Company')) {
      return {
        name: 'TestCorp',
        techStack: ['Go'],
        cultureSignals: ['remote'],
      } as T;
    }
    if (systemMsg.includes('anti-pattern') || systemMsg.includes('red flag')) {
      return [] as unknown as T;
    }
    if (systemMsg.includes('search queries') || systemMsg.includes('tiered search')) {
      return [
        { priority: 1, queries: [{ text: 'backend engineer Go', maxResults: 5 }] },
      ] as unknown as T;
    }
    if (systemMsg.includes('scoring weight') || systemMsg.includes('scoring strateg')) {
      return {
        technicalDepth: 0.3,
        domainRelevance: 0.25,
        trajectoryMatch: 0.2,
        cultureFit: 0.15,
        reachability: 0.1,
      } as T;
    }
    return {
      title: 'Engineer',
      level: 'Senior',
      scope: 'Engineering',
      mustHaveSkills: [],
      niceToHaveSkills: [],
      careerTrajectory: [],
      skillSignatures: [],
      cultureSignals: [],
      queries: [],
      scoringWeights: {},
      antiFilters: [],
      antiPatterns: [],
      targetCompanies: [],
      avoidCompanies: [],
      competitorReason: {},
    } as T;
  }

  return {
    name: 'mock',
    async chat(): Promise<ChatResult> {
      return { content: 'ok', usage: ZERO_USAGE };
    },
    async structuredOutput<T>(messages: Message[]): Promise<StructuredOutputResult<T>> {
      return { data: pickStructuredData<T>(messages), usage: ZERO_USAGE };
    },
  };
}

function makeRawCandidate(name: string): RawCandidate {
  const now = '2026-03-24T00:00:00Z';
  const evInput = {
    adapter: 'exa',
    source: `https://${name.toLowerCase().replace(' ', '')}.dev`,
    claim: `${name} is an engineer`,
    retrievedAt: now,
  };
  return {
    name,
    identifiers: [
      {
        type: 'email' as const,
        value: `${name.toLowerCase().replace(' ', '.')}@test.com`,
        source: 'exa',
        observedAt: now,
        confidence: 'high' as const,
      },
    ],
    sourceData: {
      adapter: 'exa',
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
    piiFields: [],
  };
}

function mockDiscoverHandler(
  candidates: RawCandidate[],
): PhaseHandler<IntakePhaseOutput, DiscoverPhaseOutput> {
  return {
    async execute() {
      return {
        status: 'completed',
        data: { rawCandidates: candidates, costIncurred: 0.01 },
        costIncurred: 0.01,
      };
    },
  };
}

// --- Tests ---

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-int2pipe-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('Intake → Pipeline Integration', () => {
  it('intake-generated config flows through pipeline to produce candidates.json', async () => {
    const ai = createMockAI();
    const contentResearch = new ContentResearchEngine({
      aiProvider: ai,
      urlCrawler: {
        async crawl(url: string) {
          return {
            url,
            title: 'TestCorp',
            text: 'TestCorp builds Go infrastructure',
            crawledAt: new Date().toISOString(),
            adapter: 'mock',
          };
        },
      } as UrlCrawler,
      githubAnalyzer: {
        async analyzeProfile() {
          return {
            inputType: 'github_url' as const,
            careerTrajectory: [],
            skillSignatures: ['Go'],
            cultureSignals: [],
            urls: [],
            analyzedAt: new Date().toISOString(),
          };
        },
      } as GitHubAnalyzer,
      similaritySearcher: {
        async findSimilar() {
          return [];
        },
      } as SimilaritySearcher,
    });

    // Run intake conversation
    const engine = createIntakeEngine({ aiProvider: ai, contentResearch });
    const responses = [
      'Backend Engineer, Go, DeFi',
      'yes',
      'https://testcorp.com',
      'yes', // company_analysis
      'looks good', // company_confirm
      'done', // team_input
      'none', // anti_patterns
      'yes', // config_generate
    ];
    for (const r of responses) {
      if (engine.isDone()) break;
      await engine.getPrompt();
      await engine.submitResponse(r);
    }

    const intakeResult = await extractIntakeResult(engine.getContext(), ai);

    // Feed into pipeline
    const testCandidates = [
      makeRawCandidate('Alice'),
      makeRawCandidate('Bob'),
    ];

    const passthroughEnrich: PhaseHandler<DedupPhaseOutput, EnrichPhaseOutput> = {
      async execute(input) {
        return { status: 'completed', data: { candidates: input.candidates, costIncurred: 0 } };
      },
    };

    const runner = new PipelineRunner({
      discover: mockDiscoverHandler(testCandidates),
      dedup: createDedupHandler(),
      enrich: passthroughEnrich,
      score: createStubScoreHandler(intakeResult.searchConfig),
      output: createOutputHandler([new JsonOutputAdapter()]),
    });

    const meta = await runner.run({
      roleName: intakeResult.searchConfig.roleName,
      runsBaseDir: testDir,
      searchConfig: intakeResult.searchConfig,
      talentProfile: intakeResult.talentProfile,
    });

    expect(meta.status).toBe('completed');
    const jsonPath = join(meta.runDir, 'candidates.json');
    const content = await readFile(jsonPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.candidateCount).toBe(2);
  });

  it('intake-generated SearchConfig has valid structure', async () => {
    const ai = createMockAI();
    const contentResearch = new ContentResearchEngine({
      aiProvider: ai,
      urlCrawler: {
        async crawl(url: string) {
          return {
            url,
            title: 'Test',
            text: 'Test content',
            crawledAt: new Date().toISOString(),
            adapter: 'mock',
          };
        },
      } as UrlCrawler,
      githubAnalyzer: {
        async analyzeProfile() {
          return {
            inputType: 'github_url' as const,
            careerTrajectory: [],
            skillSignatures: [],
            cultureSignals: [],
            urls: [],
            analyzedAt: new Date().toISOString(),
          };
        },
      } as GitHubAnalyzer,
      similaritySearcher: {
        async findSimilar() {
          return [];
        },
      } as SimilaritySearcher,
    });

    const engine = createIntakeEngine({ aiProvider: ai, contentResearch });
    const responses = ['Backend Engineer Go', 'yes', 'https://test.com', 'yes', 'looks good', 'done', 'none', 'yes'];
    for (const r of responses) {
      if (engine.isDone()) break;
      await engine.getPrompt();
      await engine.submitResponse(r);
    }

    const result = await extractIntakeResult(engine.getContext(), ai);

    // Verify structure
    expect(result.searchConfig.roleName).toBeTruthy();
    expect(result.searchConfig.tiers).toBeDefined();
    expect(result.searchConfig.scoringWeights).toBeDefined();
    expect(result.searchConfig.tierThresholds).toBeDefined();
    expect(result.searchConfig.createdAt).toBeTruthy();
    expect(result.searchConfig.version).toBe(1);
    expect(result.talentProfile.role).toBeDefined();
    expect(result.talentProfile.company).toBeDefined();
    expect(result.talentProfile.createdAt).toBeTruthy();
  });
});
