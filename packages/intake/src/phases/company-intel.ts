// Phase 2: Company Intelligence — company URL analysis, pitch extraction, competitor ID

import type {
  ConversationNode,
  IntakeContext,
  ParsedResponse,
  CompanyIntel,
  CompetitorMap,
  AIProvider,
  ContentResearch,
} from '@sourcerer/core';

import { hasCompanyData } from '../intake-context.js';
import { CompanyIntelPartialSchema, CompetitorMapSchema } from '../schemas.js';

/**
 * Creates Phase 2 conversation nodes for company intelligence gathering.
 *
 * Flow:
 *   company_url_input → company_analysis → company_confirm → competitor_input → next phase
 *
 * If a company URL is provided, it's crawled and analyzed.
 * Competitors are identified from the analysis and user input.
 */
export function createCompanyIntelNodes(
  aiProvider: AIProvider,
  contentResearch: ContentResearch,
  nextPhaseNodeId: string,
): ConversationNode[] {
  // Closure variable to pass crawled intel from prompt() to parse()
  let lastCrawledIntel: CompanyIntel | null = null;

  return [
    // Node 1: Ask for company URL
    {
      id: 'company_url_input',
      phase: 'company',
      prompt: async (context: IntakeContext) => {
        if (context.companyUrl) {
          return `I have the company URL: ${context.companyUrl}. Would you like me to analyze it, or provide a different URL?`;
        }
        return `Now let's learn about the company.\n\nPlease share the company's website URL. I'll analyze it to understand the tech stack, culture, and product.`;
      },
      skipIf: hasCompanyData,
      parse: async (response: string, _context: IntakeContext): Promise<ParsedResponse> => {
        // Extract URL from the response
        const urlMatch = response.match(/https?:\/\/[^\s]+/);
        const url = urlMatch ? urlMatch[0] : response.trim();

        return {
          structured: { companyUrl: url },
          contextUpdates: { companyUrl: url },
          followUpNeeded: false,
        };
      },
      next: (_parsed: ParsedResponse, _context: IntakeContext) => 'company_analysis',
    },

    // Node 2: Analyze company (auto-advancing node)
    {
      id: 'company_analysis',
      phase: 'company',
      prompt: async (context: IntakeContext) => {
        const url = context.companyUrl;
        if (!url) {
          return 'I need a company URL to analyze. Could you provide one?';
        }

        try {
          // Crawl and analyze the company
          const content = await contentResearch.crawlUrl(url);
          const intel = await contentResearch.analyzeCompany(content);

          // Store in closure so parse() can access without re-crawling
          lastCrawledIntel = { ...intel, url, analyzedAt: new Date().toISOString() };
          const lines = [
            `I've analyzed **${intel.name}**:\n`,
            `**Product:** ${intel.productCategory ?? 'Unknown'}`,
          ];

          if (intel.pitch) lines.push(`**Pitch:** ${intel.pitch}`);
          if (intel.techStack.length > 0) lines.push(`**Tech stack:** ${intel.techStack.join(', ')}`);
          if (intel.teamSize) lines.push(`**Team size:** ${intel.teamSize}`);
          if (intel.fundingStage) lines.push(`**Funding:** ${intel.fundingStage}`);
          if (intel.cultureSignals.length > 0) lines.push(`**Culture:** ${intel.cultureSignals.join(', ')}`);
          if (intel.competitors && intel.competitors.length > 0) {
            lines.push(`**Competitors:** ${intel.competitors.join(', ')}`);
          }

          lines.push(`\nDoes this look accurate? Any corrections or additions?`);

          // We encode the intel as a JSON prefix so the parse function can extract it
          return `__INTEL__${JSON.stringify(intel)}__INTEL__\n${lines.join('\n')}`;
        } catch (error) {
          return `I had trouble analyzing that URL. Could you tell me about the company instead? (Name, what they build, tech stack, team size)`;
        }
      },
      parse: async (response: string, context: IntakeContext): Promise<ParsedResponse> => {
        // Check if we have embedded intel from the prompt
        // The prompt may have embedded intel data
        const normalized = response.trim().toLowerCase();
        const isConfirmed = ['yes', 'looks good', 'correct', 'confirmed', 'proceed', 'lgtm', 'looks right', 'accurate'].some(
          phrase => normalized.includes(phrase),
        ) || /^y$/i.test(normalized);

        if (isConfirmed && (lastCrawledIntel || context.companyIntel)) {
          const intel = lastCrawledIntel ?? context.companyIntel!;
          return {
            structured: { confirmed: true },
            contextUpdates: { companyIntel: intel },
            followUpNeeded: false,
          };
        }

        // If no intel yet, or user provided corrections, use AI to construct/update it
        const messages = [
          {
            role: 'system' as const,
            content: `You are a company analyst. Based on the user's input${context.companyIntel ? ' and the existing analysis' : ''}, construct or update the company intelligence. Return a JSON object with:
- name: company name
- techStack: array of technologies
- teamSize: estimated team size
- fundingStage: funding stage if known
- productCategory: what they build
- cultureSignals: array of culture indicators
- pitch: one-sentence value prop
- competitors: array of competitor names

${context.companyIntel ? `Existing analysis:\n${JSON.stringify(context.companyIntel, null, 2)}` : ''}`,
          },
          {
            role: 'user' as const,
            content: response,
          },
        ];

        const { data: intel } = await aiProvider.structuredOutput<Omit<CompanyIntel, 'url' | 'analyzedAt'>>(
          messages,
          { schema: CompanyIntelPartialSchema },
        );

        const fullIntel: CompanyIntel = {
          ...intel,
          url: context.companyUrl ?? '',
          analyzedAt: new Date().toISOString(),
        };

        return {
          structured: { companyIntel: fullIntel },
          contextUpdates: { companyIntel: fullIntel },
          followUpNeeded: false,
        };
      },
      next: (_parsed: ParsedResponse, _context: IntakeContext) => 'company_confirm',
    },

    // Node 3: Confirm company data and ask about competitors
    {
      id: 'company_confirm',
      phase: 'company',
      prompt: async (context: IntakeContext) => {
        if (!context.companyIntel) {
          return 'Let me know more about the company so I can build the intelligence profile.';
        }

        const intel = context.companyIntel;
        const competitors = intel.competitors ?? [];

        if (competitors.length > 0) {
          return `I identified these competitors: ${competitors.join(', ')}.\n\nAre there other companies you'd specifically like to target for sourcing, or companies to avoid? (You can also say "looks good" to proceed.)`;
        }

        return `Which companies would you like to target for sourcing candidates? Also, are there companies to avoid? (e.g., "Target: Stripe, Coinbase. Avoid: OldCorp")`;
      },
      parse: async (response: string, context: IntakeContext): Promise<ParsedResponse> => {
        const normalized = response.trim().toLowerCase();
        const isConfirmed = ['looks good', 'proceed', 'skip', 'none', 'no', 'n/a'].some(
          phrase => normalized.includes(phrase),
        );

        if (isConfirmed) {
          // Use the existing competitors from company intel
          const intel = context.companyIntel;
          const competitorMap: CompetitorMap = {
            targetCompanies: intel?.competitors ?? [],
            avoidCompanies: [],
            competitorReason: {},
          };
          return {
            structured: { confirmed: true },
            contextUpdates: { competitorMap },
            followUpNeeded: false,
          };
        }

        // Parse competitor input with AI
        const messages = [
          {
            role: 'system' as const,
            content: `Parse the user's competitor/company preferences. Return a JSON object with:
- targetCompanies: array of companies to source from
- avoidCompanies: array of companies to avoid
- competitorReason: object mapping company name to reason (e.g., "Stripe": "similar fintech infra")

Existing competitors from analysis: ${JSON.stringify(context.companyIntel?.competitors ?? [])}`,
          },
          {
            role: 'user' as const,
            content: response,
          },
        ];

        const { data: map } = await aiProvider.structuredOutput<CompetitorMap>(
          messages,
          { schema: CompetitorMapSchema },
        );

        return {
          structured: { competitorMap: map },
          contextUpdates: { competitorMap: map },
          followUpNeeded: false,
        };
      },
      next: (_parsed: ParsedResponse, _context: IntakeContext) => nextPhaseNodeId,
    },
  ];
}
