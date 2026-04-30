// Test helpers — mock factories and shared test utilities

import type {
  AIProvider,
  Message,
  ChatOptions,
  ChatResult,
  StructuredOutputOptions,
  StructuredOutputResult,
  TokenUsage,
  ContentResearch,
  CrawledContent,
  CompanyIntel,
  ProfileInput,
  ProfileAnalysis,
  SimilarResult,
  IntakeContext,
  RoleParameters,
  CompetitorMap,
  CareerStep,
} from '@sourcerer/core';

const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  model: 'mock',
};

import type { UrlCrawler, GitHubAnalyzer, SimilaritySearcher } from '../content-research.js';

// --- Timestamp ---

export const TEST_NOW = '2026-03-24T12:00:00Z';

// --- Mock AI Provider ---

export type StructuredOutputHandler = (messages: Message[], options: StructuredOutputOptions) => unknown;

/**
 * Creates a mock AIProvider that returns configurable responses.
 */
export function createMockAIProvider(overrides?: {
  chatResponse?: string;
  structuredOutputHandler?: StructuredOutputHandler;
}): AIProvider {
  return {
    name: 'mock',
    async chat(_messages: Message[], _options?: ChatOptions): Promise<ChatResult> {
      return {
        content: overrides?.chatResponse ?? 'mock response',
        usage: ZERO_USAGE,
      };
    },
    async structuredOutput<T>(
      messages: Message[],
      options: StructuredOutputOptions,
    ): Promise<StructuredOutputResult<T>> {
      const data = overrides?.structuredOutputHandler
        ? (overrides.structuredOutputHandler(messages, options) as T)
        : ({} as T);
      return { data, usage: ZERO_USAGE };
    },
  };
}

// --- Mock Content Research ---

export function createMockContentResearch(overrides?: Partial<ContentResearch>): ContentResearch {
  return {
    async crawlUrl(url: string): Promise<CrawledContent> {
      return {
        url,
        title: 'Mock Page',
        text: 'Mock content for ' + url,
        crawledAt: TEST_NOW,
        adapter: 'mock',
      };
    },
    async analyzeCompany(content: CrawledContent): Promise<CompanyIntel> {
      return makeCompanyIntel({ url: content.url });
    },
    async analyzeProfile(input: ProfileInput): Promise<ProfileAnalysis> {
      return makeProfileAnalysis({ inputType: input.type });
    },
    async findSimilar(urls: string[]): Promise<SimilarResult[]> {
      return urls.map(url => ({
        url: `https://similar.example.com/${url.split('/').pop()}`,
        title: 'Similar result',
        similarity: 0.85,
      }));
    },
    ...overrides,
  };
}

// --- Mock Dependency Interfaces ---

export function createMockUrlCrawler(): UrlCrawler {
  return {
    async crawl(url: string): Promise<CrawledContent> {
      return {
        url,
        title: 'Mock Page',
        text: 'Mock crawled content',
        crawledAt: TEST_NOW,
        adapter: 'mock-crawler',
      };
    },
  };
}

export function createMockGitHubAnalyzer(): GitHubAnalyzer {
  return {
    async analyzeProfile(url: string): Promise<ProfileAnalysis> {
      return makeProfileAnalysis({
        inputType: 'github_url',
        name: 'github-user',
        urls: [url],
        skillSignatures: ['TypeScript', 'Go', 'Kubernetes'],
      });
    },
  };
}

export function createMockSimilaritySearcher(): SimilaritySearcher {
  return {
    async findSimilar(urls: string[]): Promise<SimilarResult[]> {
      return urls.map(url => ({
        url: `https://similar.example.com/${url.split('/').pop()}`,
        title: 'Similar profile',
        similarity: 0.9,
      }));
    },
  };
}

// --- Data Factories ---

export function makeRoleParameters(overrides?: Partial<RoleParameters>): RoleParameters {
  return {
    title: 'Senior Backend Engineer',
    level: 'senior',
    scope: 'Own backend infrastructure for DeFi protocol',
    location: 'San Francisco',
    remotePolicy: 'hybrid',
    mustHaveSkills: ['Go', 'distributed systems'],
    niceToHaveSkills: ['Rust', 'DeFi'],
    teamSize: '10-15',
    reportingTo: 'VP Engineering',
    ...overrides,
  };
}

export function makeCompanyIntel(overrides?: Partial<CompanyIntel>): CompanyIntel {
  return {
    name: 'Lunar Labs',
    url: 'https://lunarlabs.xyz',
    techStack: ['Go', 'Kubernetes', 'PostgreSQL'],
    teamSize: '10-50',
    fundingStage: 'Series B',
    productCategory: 'DeFi Infrastructure',
    cultureSignals: ['OSS-friendly', 'async-first'],
    pitch: 'Building the infrastructure layer for DeFi',
    competitors: ['Alchemy', 'Infura'],
    analyzedAt: TEST_NOW,
    ...overrides,
  };
}

export function makeCareerStep(overrides?: Partial<CareerStep>): CareerStep {
  return {
    company: 'Stripe',
    role: 'Backend Engineer',
    duration: '2 years',
    signals: ['payments infrastructure', 'high-scale systems'],
    ...overrides,
  };
}

export function makeProfileAnalysis(overrides?: Partial<ProfileAnalysis>): ProfileAnalysis {
  return {
    inputType: 'github_url',
    name: 'Sarah Chen',
    careerTrajectory: [
      makeCareerStep(),
      makeCareerStep({ company: 'Chainlink', role: 'Senior Backend Engineer', duration: '3 years', signals: ['DeFi', 'indexing'] }),
    ],
    skillSignatures: ['Go', 'distributed systems', 'DeFi'],
    seniorityLevel: 'senior',
    cultureSignals: ['OSS contributor', 'heads-down builder'],
    urls: ['https://github.com/sarahchen'],
    analyzedAt: TEST_NOW,
    ...overrides,
  };
}

export function makeCompetitorMap(overrides?: Partial<CompetitorMap>): CompetitorMap {
  return {
    targetCompanies: ['Chainlink', 'Alchemy', 'Compound'],
    avoidCompanies: ['OldCorp'],
    competitorReason: {
      Chainlink: 'DeFi infra, similar tech stack',
      OldCorp: 'Culture mismatch',
    },
    ...overrides,
  };
}

export function makeIntakeContext(overrides?: Partial<IntakeContext>): IntakeContext {
  return {
    conversationHistory: [],
    ...overrides,
  };
}

export function makeFullIntakeContext(): IntakeContext {
  return {
    roleDescription: 'Senior Backend Engineer for DeFi protocol',
    roleParameters: makeRoleParameters(),
    companyUrl: 'https://lunarlabs.xyz',
    companyIntel: makeCompanyIntel(),
    teamProfiles: [makeProfileAnalysis()],
    antiPatterns: ['frequent job-hopper', 'no public code'],
    competitorMap: makeCompetitorMap(),
    similaritySeeds: ['https://github.com/sarahchen'],
    conversationHistory: [
      { role: 'user', content: 'test message' },
    ],
  };
}
