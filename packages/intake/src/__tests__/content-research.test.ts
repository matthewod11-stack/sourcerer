import { describe, it, expect } from 'vitest';
import type { ProfileAnalysis, CrawledContent, CompanyIntel } from '@sourcerer/core';
import { ContentResearchEngine, extractSimilaritySeeds } from '../content-research.js';
import {
  createMockAIProvider,
  createMockUrlCrawler,
  createMockGitHubAnalyzer,
  createMockSimilaritySearcher,
  makeProfileAnalysis,
  TEST_NOW,
} from './helpers.js';

describe('ContentResearchEngine', () => {
  function createEngine(aiOverrides?: Parameters<typeof createMockAIProvider>[0]) {
    return new ContentResearchEngine({
      aiProvider: createMockAIProvider(aiOverrides),
      urlCrawler: createMockUrlCrawler(),
      githubAnalyzer: createMockGitHubAnalyzer(),
      similaritySearcher: createMockSimilaritySearcher(),
    });
  }

  describe('crawlUrl', () => {
    it('delegates to the URL crawler', async () => {
      const engine = createEngine();
      const result = await engine.crawlUrl('https://example.com');
      expect(result.url).toBe('https://example.com');
      expect(result.adapter).toBe('mock-crawler');
    });
  });

  describe('analyzeCompany', () => {
    it('uses AI to analyze crawled content', async () => {
      const engine = createEngine({
        structuredOutputHandler: () => ({
          name: 'Test Corp',
          techStack: ['TypeScript', 'React'],
          teamSize: '50-100',
          fundingStage: 'Series A',
          productCategory: 'DevTools',
          cultureSignals: ['remote-first'],
          pitch: 'Building developer tools',
          competitors: ['Vercel', 'Netlify'],
        }),
      });

      const content: CrawledContent = {
        url: 'https://testcorp.com',
        title: 'Test Corp',
        text: 'We build developer tools',
        crawledAt: TEST_NOW,
        adapter: 'mock',
      };

      const intel = await engine.analyzeCompany(content);
      expect(intel.name).toBe('Test Corp');
      expect(intel.url).toBe('https://testcorp.com');
      expect(intel.techStack).toContain('TypeScript');
      expect(intel.analyzedAt).toBeTruthy();
    });
  });

  describe('analyzeProfile', () => {
    it('routes github_url to GitHubAnalyzer', async () => {
      const engine = createEngine();
      const result = await engine.analyzeProfile({
        type: 'github_url',
        url: 'https://github.com/testuser',
      });
      expect(result.inputType).toBe('github_url');
      expect(result.urls).toContain('https://github.com/testuser');
    });

    it('routes linkedin_url through crawl + AI extraction', async () => {
      const engine = createEngine({
        structuredOutputHandler: () => ({
          name: 'LinkedIn User',
          careerTrajectory: [{ company: 'Stripe', role: 'Engineer', signals: ['payments'] }],
          skillSignatures: ['Node.js'],
          seniorityLevel: 'senior',
          cultureSignals: ['collaborative'],
        }),
      });

      const result = await engine.analyzeProfile({
        type: 'linkedin_url',
        url: 'https://linkedin.com/in/testuser',
      });
      expect(result.inputType).toBe('linkedin_url');
      expect(result.name).toBe('LinkedIn User');
    });

    it('routes pasted_text through AI extraction', async () => {
      const engine = createEngine({
        structuredOutputHandler: () => ({
          name: 'Paste Person',
          careerTrajectory: [{ company: 'Google', signals: ['search'] }],
          skillSignatures: ['Python', 'ML'],
          seniorityLevel: 'staff',
          cultureSignals: ['research-oriented'],
        }),
      });

      const result = await engine.analyzeProfile({
        type: 'pasted_text',
        text: 'Sarah is a staff engineer at Google working on search ML.',
      });
      expect(result.inputType).toBe('pasted_text');
      expect(result.name).toBe('Paste Person');
      expect(result.urls).toEqual([]);
    });

    it('routes name_company through AI extraction', async () => {
      const engine = createEngine({
        structuredOutputHandler: () => ({
          careerTrajectory: [{ company: 'Coinbase', role: 'Engineer', signals: ['crypto'] }],
          skillSignatures: ['Go'],
          seniorityLevel: 'senior',
          cultureSignals: ['crypto-native'],
        }),
      });

      const result = await engine.analyzeProfile({
        type: 'name_company',
        name: 'Alice Smith',
        company: 'Coinbase',
      });
      expect(result.inputType).toBe('name_company');
      expect(result.name).toBe('Alice Smith');
    });

    it('routes personal_url through crawl + AI extraction', async () => {
      const engine = createEngine({
        structuredOutputHandler: () => ({
          name: 'Blog Author',
          careerTrajectory: [],
          skillSignatures: ['Rust', 'WebAssembly'],
          seniorityLevel: 'mid',
          cultureSignals: ['open-source'],
        }),
      });

      const result = await engine.analyzeProfile({
        type: 'personal_url',
        url: 'https://blogauthor.dev',
      });
      expect(result.inputType).toBe('personal_url');
      expect(result.urls).toContain('https://blogauthor.dev');
    });
  });

  describe('findSimilar', () => {
    it('delegates to SimilaritySearcher', async () => {
      const engine = createEngine();
      const results = await engine.findSimilar(['https://example.com/profile1']);
      expect(results).toHaveLength(1);
      expect(results[0].similarity).toBe(0.9);
    });

    it('handles multiple URLs', async () => {
      const engine = createEngine();
      const results = await engine.findSimilar([
        'https://example.com/profile1',
        'https://example.com/profile2',
      ]);
      expect(results).toHaveLength(2);
    });
  });
});

describe('extractSimilaritySeeds', () => {
  it('extracts URLs from profile analyses', () => {
    const profiles: ProfileAnalysis[] = [
      makeProfileAnalysis({ urls: ['https://github.com/user1'] }),
      makeProfileAnalysis({ urls: ['https://github.com/user2', 'https://user2.dev'] }),
    ];

    const seeds = extractSimilaritySeeds(profiles);
    expect(seeds).toHaveLength(3);
    expect(seeds).toContain('https://github.com/user1');
    expect(seeds).toContain('https://github.com/user2');
    expect(seeds).toContain('https://user2.dev');
  });

  it('deduplicates URLs', () => {
    const profiles: ProfileAnalysis[] = [
      makeProfileAnalysis({ urls: ['https://github.com/user1'] }),
      makeProfileAnalysis({ urls: ['https://github.com/user1'] }),
    ];

    const seeds = extractSimilaritySeeds(profiles);
    expect(seeds).toHaveLength(1);
  });

  it('returns empty array for no profiles', () => {
    expect(extractSimilaritySeeds([])).toEqual([]);
  });
});
