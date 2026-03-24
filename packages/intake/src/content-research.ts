// Content research subsystem — implements ContentResearch with dependency injection

import type {
  ContentResearch,
  CrawledContent,
  CompanyIntel,
  ProfileInput,
  ProfileAnalysis,
  SimilarResult,
  AIProvider,
} from '@sourcerer/core';
import { CompanyIntelPartialSchema, ProfileAnalysisPartialSchema } from './schemas.js';

// --- Dependency Interfaces ---

/**
 * Interface for URL crawling — will be implemented by Exa adapter in integration.
 */
export interface UrlCrawler {
  crawl(url: string): Promise<CrawledContent>;
}

/**
 * Interface for GitHub profile analysis — will be implemented by adapter-github.
 */
export interface GitHubAnalyzer {
  analyzeProfile(url: string): Promise<ProfileAnalysis>;
}

/**
 * Interface for similarity search — will be implemented by Exa adapter.
 */
export interface SimilaritySearcher {
  findSimilar(urls: string[]): Promise<SimilarResult[]>;
}

// --- Content Research Implementation ---

export interface ContentResearchDeps {
  aiProvider: AIProvider;
  urlCrawler: UrlCrawler;
  githubAnalyzer: GitHubAnalyzer;
  similaritySearcher: SimilaritySearcher;
}

/**
 * Implements the ContentResearch interface with dependency injection.
 * All external API calls are delegated to injected dependencies.
 * AI-powered analysis uses the injected AIProvider.
 */
export class ContentResearchEngine implements ContentResearch {
  private readonly ai: AIProvider;
  private readonly crawler: UrlCrawler;
  private readonly github: GitHubAnalyzer;
  private readonly similarity: SimilaritySearcher;

  constructor(deps: ContentResearchDeps) {
    this.ai = deps.aiProvider;
    this.crawler = deps.urlCrawler;
    this.github = deps.githubAnalyzer;
    this.similarity = deps.similaritySearcher;
  }

  /**
   * Crawls a URL and returns its content.
   * Delegates to the injected UrlCrawler.
   */
  async crawlUrl(url: string): Promise<CrawledContent> {
    return this.crawler.crawl(url);
  }

  /**
   * Analyzes crawled company content to extract structured intelligence.
   * Uses the AIProvider to parse and extract signals from crawled content.
   */
  async analyzeCompany(content: CrawledContent): Promise<CompanyIntel> {
    const messages = [
      {
        role: 'system' as const,
        content: `You are a company intelligence analyst. Analyze the provided website content and extract structured company information. Return a JSON object with the following fields:
- name: company name
- techStack: array of technologies used
- teamSize: estimated team size (e.g., "10-50", "50-200")
- fundingStage: funding stage if detectable (e.g., "Seed", "Series A", "Series B", "Public")
- productCategory: what the company does in 1-3 words
- cultureSignals: array of culture indicators (e.g., "remote-first", "open-source", "move-fast")
- pitch: one-sentence company pitch/value prop
- competitors: array of likely competitor company names`,
      },
      {
        role: 'user' as const,
        content: `Analyze this company website content:\n\nURL: ${content.url}\nTitle: ${content.title ?? 'Unknown'}\n\nContent:\n${content.text}`,
      },
    ];

    const result = await this.ai.structuredOutput<Omit<CompanyIntel, 'url' | 'analyzedAt'>>(
      messages,
      { schema: CompanyIntelPartialSchema },
    );

    return {
      ...result,
      url: content.url,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Analyzes a profile based on input type.
   * Routes to the appropriate analysis method for each ProfileInput variant.
   */
  async analyzeProfile(input: ProfileInput): Promise<ProfileAnalysis> {
    switch (input.type) {
      case 'github_url':
        return this.analyzeGitHubProfile(input.url);
      case 'linkedin_url':
        return this.analyzeLinkedInProfile(input.url);
      case 'pasted_text':
        return this.analyzePastedText(input.text);
      case 'name_company':
        return this.analyzeNameCompany(input.name, input.company);
      case 'personal_url':
        return this.analyzePersonalUrl(input.url);
    }
  }

  /**
   * Finds similar profiles/pages given a set of seed URLs.
   * Delegates to the injected SimilaritySearcher.
   */
  async findSimilar(urls: string[]): Promise<SimilarResult[]> {
    return this.similarity.findSimilar(urls);
  }

  // --- Private analysis methods ---

  /**
   * Analyzes a GitHub profile using the injected GitHubAnalyzer.
   */
  private async analyzeGitHubProfile(url: string): Promise<ProfileAnalysis> {
    return this.github.analyzeProfile(url);
  }

  /**
   * Analyzes a LinkedIn profile by crawling the URL and using AI extraction.
   */
  private async analyzeLinkedInProfile(url: string): Promise<ProfileAnalysis> {
    const content = await this.crawler.crawl(url);
    return this.extractProfileFromContent(content, 'linkedin_url');
  }

  /**
   * Extracts structured profile data from pasted text using AI.
   */
  private async analyzePastedText(text: string): Promise<ProfileAnalysis> {
    const messages = [
      {
        role: 'system' as const,
        content: `You are a talent analyst. Extract structured profile information from the provided text. Return a JSON object with:
- name: person's name if found
- careerTrajectory: array of {company, role, duration, signals} objects
- skillSignatures: array of key skills
- seniorityLevel: estimated seniority (junior, mid, senior, staff, principal)
- cultureSignals: array of culture/work-style indicators`,
      },
      {
        role: 'user' as const,
        content: `Extract profile information from:\n\n${text}`,
      },
    ];

    const result = await this.ai.structuredOutput<{
      name?: string;
      careerTrajectory: Array<{ company: string; role?: string; duration?: string; signals: string[] }>;
      skillSignatures: string[];
      seniorityLevel?: string;
      cultureSignals: string[];
    }>(messages, { schema: ProfileAnalysisPartialSchema });

    return {
      inputType: 'pasted_text',
      name: result.name,
      careerTrajectory: result.careerTrajectory,
      skillSignatures: result.skillSignatures,
      seniorityLevel: result.seniorityLevel,
      cultureSignals: result.cultureSignals,
      urls: [],
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Discovers profile information given a name and company.
   * Uses the URL crawler to search for the person and AI to extract data.
   */
  private async analyzeNameCompany(name: string, company: string): Promise<ProfileAnalysis> {
    // Use AI to synthesize what we can infer from the name+company combination
    const messages = [
      {
        role: 'system' as const,
        content: `You are a talent analyst. Given a person's name and company, suggest likely profile attributes. Return a JSON object with:
- careerTrajectory: array of {company, role, duration, signals} objects (use the known company)
- skillSignatures: array of likely key skills based on the company
- seniorityLevel: estimated seniority if inferrable
- cultureSignals: array of likely culture indicators based on the company`,
      },
      {
        role: 'user' as const,
        content: `Person: ${name}\nCompany: ${company}`,
      },
    ];

    const result = await this.ai.structuredOutput<{
      careerTrajectory: Array<{ company: string; role?: string; duration?: string; signals: string[] }>;
      skillSignatures: string[];
      seniorityLevel?: string;
      cultureSignals: string[];
    }>(messages, { schema: ProfileAnalysisPartialSchema });

    return {
      inputType: 'name_company',
      name,
      careerTrajectory: result.careerTrajectory,
      skillSignatures: result.skillSignatures,
      seniorityLevel: result.seniorityLevel,
      cultureSignals: result.cultureSignals,
      urls: [],
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Analyzes a personal URL by crawling and AI extraction.
   */
  private async analyzePersonalUrl(url: string): Promise<ProfileAnalysis> {
    const content = await this.crawler.crawl(url);
    return this.extractProfileFromContent(content, 'personal_url');
  }

  /**
   * Generic profile extraction from crawled content using AI.
   */
  private async extractProfileFromContent(
    content: CrawledContent,
    inputType: ProfileInput['type'],
  ): Promise<ProfileAnalysis> {
    const messages = [
      {
        role: 'system' as const,
        content: `You are a talent analyst. Analyze the provided webpage content to extract structured profile information. Return a JSON object with:
- name: person's name if found
- careerTrajectory: array of {company, role, duration, signals} objects
- skillSignatures: array of key skills
- seniorityLevel: estimated seniority (junior, mid, senior, staff, principal)
- cultureSignals: array of culture/work-style indicators`,
      },
      {
        role: 'user' as const,
        content: `Analyze this profile page:\n\nURL: ${content.url}\nTitle: ${content.title ?? 'Unknown'}\n\nContent:\n${content.text}`,
      },
    ];

    const result = await this.ai.structuredOutput<{
      name?: string;
      careerTrajectory: Array<{ company: string; role?: string; duration?: string; signals: string[] }>;
      skillSignatures: string[];
      seniorityLevel?: string;
      cultureSignals: string[];
    }>(messages, { schema: ProfileAnalysisPartialSchema });

    return {
      inputType,
      name: result.name,
      careerTrajectory: result.careerTrajectory,
      skillSignatures: result.skillSignatures,
      seniorityLevel: result.seniorityLevel,
      cultureSignals: result.cultureSignals,
      urls: [content.url],
      analyzedAt: new Date().toISOString(),
    };
  }
}

/**
 * Extracts similarity seed URLs from team member profile analyses.
 * Returns URLs that are most useful for finding similar candidates.
 */
export function extractSimilaritySeeds(profiles: ProfileAnalysis[]): string[] {
  const seeds: string[] = [];
  for (const profile of profiles) {
    // Add all discovered URLs as potential similarity seeds
    for (const url of profile.urls) {
      if (!seeds.includes(url)) {
        seeds.push(url);
      }
    }
  }
  return seeds;
}
