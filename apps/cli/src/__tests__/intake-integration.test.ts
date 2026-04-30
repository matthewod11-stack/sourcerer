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
  IntakeContext,
} from '@sourcerer/core';

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  model: 'mock',
};
import {
  createIntakeEngine,
  restoreIntakeEngine,
  extractIntakeResult,
  ContentResearchEngine,
  type UrlCrawler,
  type GitHubAnalyzer,
  type SimilaritySearcher,
} from '@sourcerer/intake';

// --- Mock AIProvider ---

function createMockAIProvider(): AIProvider {
  let callCount = 0;

  function pickStructuredData<T>(messages: Message[]): T {
    callCount++;
    const systemMsg = messages[0]?.content ?? '';

    // Route based on what the system prompt asks for
    if (systemMsg.includes('role') || systemMsg.includes('job')) {
      return {
        title: 'Senior Backend Engineer',
        level: 'Senior',
        scope: 'Backend infrastructure',
        mustHaveSkills: ['Go', 'distributed systems'],
        niceToHaveSkills: ['Rust'],
      } as T;
    }

    if (systemMsg.includes('company') || systemMsg.includes('Company')) {
      return {
        name: 'TestCorp',
        techStack: ['Go', 'PostgreSQL'],
        teamSize: '10-50',
        fundingStage: 'Series A',
        productCategory: 'DeFi',
        cultureSignals: ['remote-first'],
        pitch: 'Building DeFi infrastructure',
        competitors: ['Chainlink'],
      } as T;
    }

    if (systemMsg.includes('talent') || systemMsg.includes('profile') || systemMsg.includes('team')) {
      return {
        careerTrajectory: [
          { company: 'Stripe', role: 'Engineer', signals: ['payments'] },
        ],
        skillSignatures: ['Go', 'blockchain'],
        seniorityLevel: 'senior',
        cultureSignals: ['remote'],
      } as T;
    }

    if (systemMsg.includes('anti-pattern') || systemMsg.includes('red flag')) {
      return [] as unknown as T;
    }

    if (systemMsg.includes('search queries') || systemMsg.includes('tiered search')) {
      return [
        { priority: 1, queries: [{ text: 'senior backend engineer DeFi Go', maxResults: 10 }] },
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
      result: 'ok',
    } as T;
  }

  return {
    name: 'mock',
    async chat(_messages: Message[], _options?: ChatOptions): Promise<ChatResult> {
      return { content: 'Mock AI response', usage: ZERO_USAGE };
    },
    async structuredOutput<T>(
      messages: Message[],
      _options: StructuredOutputOptions,
    ): Promise<StructuredOutputResult<T>> {
      return { data: pickStructuredData<T>(messages), usage: ZERO_USAGE };
    },
  };
}

function createMockContentResearchDeps() {
  const urlCrawler: UrlCrawler = {
    async crawl(url: string) {
      return {
        url,
        title: 'Test Page',
        text: 'TestCorp builds DeFi infrastructure. Tech stack: Go, PostgreSQL. Team of 30.',
        crawledAt: new Date().toISOString(),
        adapter: 'mock',
      };
    },
  };

  const githubAnalyzer: GitHubAnalyzer = {
    async analyzeProfile(_url: string) {
      return {
        inputType: 'github_url' as const,
        name: 'Test Dev',
        careerTrajectory: [
          { company: 'Stripe', role: 'Engineer', signals: ['payments'] },
        ],
        skillSignatures: ['Go', 'Rust'],
        cultureSignals: ['open-source'],
        urls: ['https://github.com/testdev'],
        analyzedAt: new Date().toISOString(),
      };
    },
  };

  const similaritySearcher: SimilaritySearcher = {
    async findSimilar(_urls: string[]) {
      return [
        { url: 'https://similar-dev.com', title: 'Similar Dev', similarity: 0.85 },
      ];
    },
  };

  return { urlCrawler, githubAnalyzer, similaritySearcher };
}

// --- Tests ---

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'sourcerer-intake-int-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('Intake Integration', () => {
  it('intake conversation produces SearchConfig and TalentProfile', async () => {
    const ai = createMockAIProvider();
    const crDeps = createMockContentResearchDeps();
    const contentResearch = new ContentResearchEngine({
      aiProvider: ai,
      ...crDeps,
    });

    const engine = createIntakeEngine({ aiProvider: ai, contentResearch });

    // Walk through conversation with scripted responses
    // Flow: role_jd → role_confirm → company_url → company_analysis → company_confirm → team → anti → config
    const responses = [
      'Senior Backend Engineer for DeFi startup, must know Go and distributed systems.',
      'yes', // role_parse_confirm
      'https://testcorp.com', // company_url_input
      'yes', // company_analysis (falls through to AI)
      'looks good', // company_confirm
      'skip', // team_input (skip)
      'skip', // anti_patterns (skip)
      'yes', // config_generate (approve)
    ];

    for (const response of responses) {
      if (engine.isDone()) break;
      const prompt = await engine.getPrompt();
      if (prompt === null) break;
      await engine.submitResponse(response);
    }

    // Engine may or may not be done depending on exact node count
    // What matters is that the context has been populated

    const result = await extractIntakeResult(engine.getContext(), ai);
    expect(result.searchConfig).toBeDefined();
    expect(result.searchConfig.roleName).toBeTruthy();
    expect(result.talentProfile).toBeDefined();
    expect(result.talentProfile.role.title).toBeTruthy();
  });

  it('intake saves and restores conversation state', async () => {
    const ai = createMockAIProvider();
    const crDeps = createMockContentResearchDeps();
    const contentResearch = new ContentResearchEngine({
      aiProvider: ai,
      ...crDeps,
    });
    const deps = { aiProvider: ai, contentResearch };

    const engine = createIntakeEngine(deps);

    // Submit first response
    await engine.getPrompt();
    await engine.submitResponse('Backend Engineer role at DeFi startup');

    // Save state
    const stateJson = engine.serializeState();

    // Restore
    const restored = restoreIntakeEngine(deps, stateJson);
    expect(restored.isDone()).toBe(false);

    // Should be on the confirmation node
    const prompt = await restored.getPrompt();
    expect(prompt).toBeTruthy();
  });

  it('content research engine routes profile inputs correctly', async () => {
    const ai = createMockAIProvider();
    const crDeps = createMockContentResearchDeps();
    const contentResearch = new ContentResearchEngine({
      aiProvider: ai,
      ...crDeps,
    });

    // Test GitHub URL routing
    const profile = await contentResearch.analyzeProfile({
      type: 'github_url',
      url: 'https://github.com/testdev',
    });
    expect(profile.inputType).toBe('github_url');
    expect(profile.skillSignatures.length).toBeGreaterThan(0);
  });

  it('content research crawls and analyzes company URL', async () => {
    const ai = createMockAIProvider();
    const crDeps = createMockContentResearchDeps();
    const contentResearch = new ContentResearchEngine({
      aiProvider: ai,
      ...crDeps,
    });

    const content = await contentResearch.crawlUrl('https://testcorp.com');
    expect(content.text).toContain('TestCorp');

    const intel = await contentResearch.analyzeCompany(content);
    expect(intel.name).toBeTruthy();
    expect(intel.url).toBe('https://testcorp.com');
  });

  it('handles empty team profiles gracefully', async () => {
    const ai = createMockAIProvider();
    const crDeps = createMockContentResearchDeps();
    const contentResearch = new ContentResearchEngine({
      aiProvider: ai,
      ...crDeps,
    });

    const engine = createIntakeEngine({ aiProvider: ai, contentResearch });

    // Walk to team input and skip it
    const responses = [
      'Senior Backend Engineer, Go, DeFi',
      'yes',
      'https://testcorp.com',
      'yes', // company_analysis
      'yes', // company_confirm
      'done', // skip team profiles
      'none', // no anti-patterns
      'yes', // approve config
    ];

    for (const response of responses) {
      if (engine.isDone()) break;
      const prompt = await engine.getPrompt();
      if (prompt === null) break;
      await engine.submitResponse(response);
    }

    // Should complete without error even with no team profiles
    const context = engine.getContext();
    expect(context).toBeDefined();
  });
});
