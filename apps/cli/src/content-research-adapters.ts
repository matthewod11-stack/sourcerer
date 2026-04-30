// Content research adapter wrappers — bridge Exa/GitHub adapters to intake interfaces

import type {
  CrawledContent,
  ProfileAnalysis,
  SimilarResult,
  AIProvider,
  Candidate,
} from '@sourcerer/core';
import { ProfileAnalysisPartialSchema } from '@sourcerer/intake';
import type { ExaAdapter } from '@sourcerer/adapter-exa';
import type { GitHubAdapter } from '@sourcerer/adapter-github';
import type {
  UrlCrawler,
  GitHubAnalyzer,
  SimilaritySearcher,
} from '@sourcerer/intake';

/**
 * Creates a UrlCrawler backed by Exa's content enrichment.
 */
export function createUrlCrawler(exa: ExaAdapter): UrlCrawler {
  return {
    async crawl(url: string): Promise<CrawledContent> {
      const dummyCandidate = makeDummyCandidateWithUrl(url);
      const result = await exa.enrich(dummyCandidate);
      const text = result.evidence
        .map((e) => e.claim)
        .join('\n\n');
      return {
        url,
        title: url,
        text: text || `Content from ${url}`,
        crawledAt: new Date().toISOString(),
        adapter: 'exa',
      };
    },
  };
}

/**
 * Creates a GitHubAnalyzer backed by adapter-github + AI extraction.
 */
export function createGitHubAnalyzer(
  github: GitHubAdapter,
  aiProvider: AIProvider,
): GitHubAnalyzer {
  return {
    async analyzeProfile(url: string): Promise<ProfileAnalysis> {
      const username = extractGitHubUsername(url);
      if (!username) {
        return emptyProfile('github_url', url);
      }

      const candidate = makeDummyCandidateWithGitHub(username);
      const result = await github.enrich(candidate);

      if (result.evidence.length === 0) {
        return emptyProfile('github_url', url);
      }

      // Use AI to build a ProfileAnalysis from the evidence
      const evidenceSummary = result.evidence
        .map((e) => `- ${e.claim}`)
        .join('\n');

      const messages = [
        {
          role: 'system' as const,
          content: `You are a talent analyst. Analyze the following GitHub evidence and return a JSON object with:
- name: the person's name
- careerTrajectory: array of {company, role, duration, signals} objects
- skillSignatures: array of key technical skills
- seniorityLevel: estimated seniority (junior, mid, senior, staff, principal)
- cultureSignals: array of work-style indicators`,
        },
        {
          role: 'user' as const,
          content: `GitHub profile evidence for ${username}:\n\n${evidenceSummary}`,
        },
      ];

      const { data: analysis } = await aiProvider.structuredOutput<{
        name?: string;
        careerTrajectory: Array<{
          company: string;
          role?: string;
          duration?: string;
          signals: string[];
        }>;
        skillSignatures: string[];
        seniorityLevel?: string;
        cultureSignals: string[];
      }>(messages, { schema: ProfileAnalysisPartialSchema });

      return {
        inputType: 'github_url',
        name: analysis.name ?? username,
        careerTrajectory: analysis.careerTrajectory,
        skillSignatures: analysis.skillSignatures,
        seniorityLevel: analysis.seniorityLevel,
        cultureSignals: analysis.cultureSignals,
        urls: [`https://github.com/${username}`],
        analyzedAt: new Date().toISOString(),
      };
    },
  };
}

/**
 * Creates a SimilaritySearcher backed by Exa's findSimilar.
 */
export function createSimilaritySearcher(exa: ExaAdapter): SimilaritySearcher {
  return {
    async findSimilar(urls: string[]): Promise<SimilarResult[]> {
      const results: SimilarResult[] = [];
      for await (const page of exa.findSimilar(urls)) {
        for (const candidate of page.candidates) {
          results.push({
            url: candidate.sourceData.urls[0] ?? '',
            title: candidate.name,
            similarity: 0.8,
          });
        }
      }
      return results;
    },
  };
}

// --- Helpers ---

function extractGitHubUsername(url: string): string | null {
  const match = url.match(/github\.com\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function makeDummyCandidateWithUrl(url: string): Candidate {
  return {
    id: 'crawl-dummy',
    identity: {
      canonicalId: 'crawl-dummy',
      observedIdentifiers: [
        {
          type: 'personal_url',
          value: url,
          source: 'intake',
          observedAt: new Date().toISOString(),
          confidence: 'high',
        },
      ],
      mergeConfidence: 1,
    },
    name: 'Crawl Target',
    sources: {
      intake: {
        adapter: 'intake',
        retrievedAt: new Date().toISOString(),
        urls: [url],
      },
    },
    evidence: [],
    enrichments: {},
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

function makeDummyCandidateWithGitHub(username: string): Candidate {
  return {
    id: `github-${username}`,
    identity: {
      canonicalId: `github-${username}`,
      observedIdentifiers: [
        {
          type: 'github_username',
          value: username,
          source: 'intake',
          observedAt: new Date().toISOString(),
          confidence: 'high',
        },
      ],
      mergeConfidence: 1,
    },
    name: username,
    sources: {},
    evidence: [],
    enrichments: {},
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

function emptyProfile(
  inputType: 'github_url',
  url: string,
): ProfileAnalysis {
  return {
    inputType,
    name: undefined,
    careerTrajectory: [],
    skillSignatures: [],
    cultureSignals: [],
    urls: [url],
    analyzedAt: new Date().toISOString(),
  };
}
