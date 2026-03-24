// Phase 4: Search Config Generation — tiered queries, scoring weights, enrichment, anti-filters

import type {
  ConversationNode,
  IntakeContext,
  ParsedResponse,
  SearchConfig,
  SearchQueryTier,
  ScoringWeights,
  TierThresholds,
  EnrichmentPriority,
  AntiFilter,
  TalentProfile,
  AIProvider,
  RoleParameters,
  CompanyIntel,
  CompetitorMap,
  CareerStep,
} from '@sourcerer/core';

import { TERMINAL_NODE } from '../conversation-engine.js';
import { SearchQueryTierArraySchema, ScoringWeightsSchema, AdjustmentsSchema } from '../schemas.js';

/**
 * Generates tiered search queries from the intake context.
 * Tier 1: High-precision queries (exact skill + company matches)
 * Tier 2: Broader skill-based queries
 * Tier 3: Domain/trajectory-based queries
 * Tier 4: Exploratory / similarity-based queries
 */
export async function generateSearchQueries(
  context: IntakeContext,
  aiProvider: AIProvider,
): Promise<SearchQueryTier[]> {
  const role = context.roleParameters;
  const company = context.companyIntel;
  const competitors = context.competitorMap;

  if (!role) {
    throw new Error('Cannot generate search queries without role parameters');
  }

  const messages = [
    {
      role: 'system' as const,
      content: `You are a talent sourcing strategist. Generate tiered search queries for finding candidates. Return a JSON array of tier objects, each with:
- priority: 1 (highest precision) to 4 (exploratory)
- queries: array of {text, targetCompanies?, includeDomains?, excludeDomains?, maxResults?}

Guidelines:
- Tier 1: Exact role + company combinations (e.g., "senior backend engineer at Coinbase")
- Tier 2: Skill-focused queries (e.g., "Go distributed systems engineer")
- Tier 3: Domain/trajectory queries (e.g., "DeFi infrastructure engineer")
- Tier 4: Exploratory queries (e.g., "protocol engineer open source contributor")

Target 2-4 queries per tier. Use the provided context to craft highly specific queries.`,
    },
    {
      role: 'user' as const,
      content: `Role: ${JSON.stringify(role)}
Company: ${company ? JSON.stringify(company) : 'Not available'}
Competitors/Target companies: ${competitors ? JSON.stringify(competitors) : 'Not specified'}
Team profiles: ${context.teamProfiles ? `${context.teamProfiles.length} analyzed` : 'None'}`,
    },
  ];

  return aiProvider.structuredOutput<SearchQueryTier[]>(
    messages,
    { schema: SearchQueryTierArraySchema },
  );
}

/**
 * Proposes scoring weights based on the role and company context.
 */
export async function proposeScoringWeights(
  context: IntakeContext,
  aiProvider: AIProvider,
): Promise<ScoringWeights> {
  const messages = [
    {
      role: 'system' as const,
      content: `You are a talent scoring strategist. Propose scoring weights for evaluating candidates. The weights must sum to 1.0. Return a JSON object with these dimensions and their weights:
- technicalDepth: how important is deep technical expertise
- domainRelevance: how important is experience in this specific domain
- trajectoryMatch: how important is a matching career trajectory
- cultureFit: how important is cultural alignment
- reachability: how important is being contactable/recruitable

Consider the role requirements and company context when weighting.`,
    },
    {
      role: 'user' as const,
      content: `Role: ${JSON.stringify(context.roleParameters)}
Company culture: ${JSON.stringify(context.companyIntel?.cultureSignals ?? [])}
Must-have skills: ${JSON.stringify(context.roleParameters?.mustHaveSkills ?? [])}`,
    },
  ];

  return aiProvider.structuredOutput<ScoringWeights>(
    messages,
    { schema: ScoringWeightsSchema },
  );
}

/**
 * Generates anti-filters from the context.
 */
export function generateAntiFilters(context: IntakeContext): AntiFilter[] {
  const filters: AntiFilter[] = [];

  // Add avoid companies as exclude filters
  const avoidCompanies = context.competitorMap?.avoidCompanies ?? [];
  for (const company of avoidCompanies) {
    filters.push({
      type: 'exclude_company',
      value: company,
      reason: context.competitorMap?.competitorReason[company] ?? 'User excluded',
    });
  }

  // Add anti-patterns as signal exclusions
  const antiPatterns = context.antiPatterns ?? [];
  for (const pattern of antiPatterns) {
    filters.push({
      type: 'exclude_signal',
      value: pattern,
      reason: 'Anti-pattern identified during intake',
    });
  }

  return filters;
}

/**
 * Default enrichment priorities.
 * GitHub is always run; Hunter is conditional.
 */
export function defaultEnrichmentPriority(): EnrichmentPriority[] {
  return [
    { adapter: 'github', required: true, runCondition: 'always' },
    { adapter: 'exa', required: true, runCondition: 'always' },
    { adapter: 'hunter', required: false, runCondition: 'if_cheap_insufficient' },
  ];
}

/**
 * Default tier thresholds.
 */
export function defaultTierThresholds(): TierThresholds {
  return {
    tier1MinScore: 70,
    tier2MinScore: 40,
  };
}

/**
 * Builds a complete TalentProfile from the accumulated IntakeContext.
 */
export function buildTalentProfile(context: IntakeContext): TalentProfile {
  const role = context.roleParameters;
  const company = context.companyIntel;
  const competitors = context.competitorMap;

  if (!role) {
    throw new Error('Cannot build talent profile without role parameters');
  }
  if (!company) {
    throw new Error('Cannot build talent profile without company intel');
  }

  const profiles = context.teamProfiles ?? [];
  const composite = context.compositeProfile;

  return {
    role,
    company,
    successPatterns: composite ?? {
      careerTrajectories: profiles.map(p => p.careerTrajectory),
      skillSignatures: dedupeStrings(profiles.flatMap(p => p.skillSignatures)),
      seniorityCalibration: profiles[0]?.seniorityLevel ?? role.level,
      cultureSignals: dedupeStrings(profiles.flatMap(p => p.cultureSignals)),
    },
    antiPatterns: context.antiPatterns ?? [],
    competitorMap: competitors ?? {
      targetCompanies: [],
      avoidCompanies: [],
      competitorReason: {},
    },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Builds a complete SearchConfig from the accumulated IntakeContext.
 */
export async function buildSearchConfig(
  context: IntakeContext,
  aiProvider: AIProvider,
): Promise<SearchConfig> {
  const role = context.roleParameters;
  if (!role) {
    throw new Error('Cannot build search config without role parameters');
  }

  const [tiers, weights] = await Promise.all([
    generateSearchQueries(context, aiProvider),
    proposeScoringWeights(context, aiProvider),
  ]);

  return {
    roleName: role.title,
    tiers,
    scoringWeights: weights,
    tierThresholds: defaultTierThresholds(),
    enrichmentPriority: defaultEnrichmentPriority(),
    antiFilters: generateAntiFilters(context),
    similaritySeeds: context.similaritySeeds,
    maxCandidates: 100,
    maxCostUsd: 5.0,
    createdAt: new Date().toISOString(),
    version: 1,
  };
}

/**
 * Creates Phase 4 conversation nodes for search config generation.
 *
 * Flow:
 *   config_generate → config_review → TERMINAL
 */
export function createSearchConfigNodes(
  aiProvider: AIProvider,
): ConversationNode[] {
  return [
    // Node 1: Generate search config and present for review
    {
      id: 'config_generate',
      phase: 'strategy',
      prompt: async (context: IntakeContext) => {
        try {
          const config = await buildSearchConfig(context, aiProvider);
          const profile = buildTalentProfile(context);

          const lines = [
            `I've generated your search configuration:\n`,
            `**Role:** ${config.roleName}`,
            `**Search tiers:** ${config.tiers.length} tiers, ${config.tiers.reduce((sum, t) => sum + t.queries.length, 0)} queries total`,
            `**Scoring weights:**`,
          ];

          for (const [dim, weight] of Object.entries(config.scoringWeights)) {
            lines.push(`  - ${dim}: ${(weight * 100).toFixed(0)}%`);
          }

          lines.push(`**Anti-filters:** ${config.antiFilters.length}`);
          if (config.similaritySeeds && config.similaritySeeds.length > 0) {
            lines.push(`**Similarity seeds:** ${config.similaritySeeds.length} URLs`);
          }
          lines.push(`**Max candidates:** ${config.maxCandidates}`);
          lines.push(`**Budget cap:** $${config.maxCostUsd}`);

          lines.push(`\nWould you like to adjust anything, or shall we proceed?`);

          // Encode config and profile for the parse function
          return `__CONFIG__${JSON.stringify(config)}__CONFIG__\n__PROFILE__${JSON.stringify(profile)}__PROFILE__\n${lines.join('\n')}`;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return `I wasn't able to generate the search config: ${msg}. Let me know what information is missing.`;
        }
      },
      parse: async (response: string, context: IntakeContext): Promise<ParsedResponse> => {
        const normalized = response.trim().toLowerCase();
        const isConfirmed = ['yes', 'looks good', 'proceed', 'lgtm', 'good', 'confirmed'].some(
          phrase => normalized.includes(phrase),
        ) || /^y$/i.test(normalized);

        if (isConfirmed) {
          // Build final config and profile
          const config = await buildSearchConfig(context, aiProvider);
          const profile = buildTalentProfile(context);

          return {
            structured: {
              confirmed: true,
              searchConfig: config,
              talentProfile: profile,
            },
            contextUpdates: {
              talentProfile: profile,
            },
            followUpNeeded: false,
          };
        }

        // User wants adjustments — go to review node
        return {
          structured: { confirmed: false, adjustment: response },
          contextUpdates: {},
          followUpNeeded: true,
          followUpReason: 'User wants to adjust search config',
        };
      },
      next: (parsed: ParsedResponse, _context: IntakeContext) => {
        if (parsed.structured.confirmed) {
          return TERMINAL_NODE;
        }
        return 'config_review';
      },
    },

    // Node 2: Handle adjustments to the config
    {
      id: 'config_review',
      phase: 'strategy',
      prompt: 'What would you like to adjust? I can change scoring weights, add/remove queries, adjust filters, or change the budget.',
      parse: async (response: string, context: IntakeContext): Promise<ParsedResponse> => {
        // Use AI to interpret the adjustment request
        // The actual adjustments will be applied when we regenerate in config_generate
        const messages = [
          {
            role: 'system' as const,
            content: `The user wants to adjust search configuration. Interpret their request and determine what changes to make. Return a JSON object indicating the adjustments. Valid adjustment types:
- maxCandidates: new number
- maxCostUsd: new number
- addAntiPattern: string to add
- removeAntiPattern: string to remove
- adjustWeight: {dimension: string, weight: number}
- other: free-text description of the change

If their request relates to role parameters, company info, or team data, indicate that we should revisit that phase.`,
          },
          {
            role: 'user' as const,
            content: response,
          },
        ];

        const adjustments = await aiProvider.structuredOutput<Record<string, unknown>>(
          messages,
          { schema: AdjustmentsSchema },
        );

        // Apply simple adjustments to context
        const updates: Partial<IntakeContext> = {};
        if (adjustments.addAntiPattern && typeof adjustments.addAntiPattern === 'string') {
          updates.antiPatterns = [adjustments.addAntiPattern];
        }

        return {
          structured: { adjustments },
          contextUpdates: updates,
          followUpNeeded: false,
        };
      },
      next: (_parsed: ParsedResponse, _context: IntakeContext) => 'config_generate',
    },
  ];
}

// --- Helpers ---

function dedupeStrings(arr: string[]): string[] {
  return [...new Set(arr)];
}
