// Phase 3: Success Profile — team member analysis, composite profile, anti-patterns

import type {
  ConversationNode,
  IntakeContext,
  ParsedResponse,
  ProfileInput,
  ProfileAnalysis,
  CareerStep,
  AIProvider,
  ContentResearch,
} from '@sourcerer/core';

import { hasTeamProfiles } from '../intake-context.js';
import { extractSimilaritySeeds } from '../content-research.js';
import { CompositeProfileSchema, AntiPatternsSchema } from '../schemas.js';

/**
 * Parses a multi-line input of team member references into ProfileInput objects.
 * Supports URLs (GitHub, LinkedIn, personal), pasted text, and name+company.
 */
export function parseProfileInputs(text: string): ProfileInput[] {
  const inputs: ProfileInput[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    // Check for GitHub URL
    if (line.match(/github\.com\/[a-zA-Z0-9_-]+/i)) {
      inputs.push({ type: 'github_url', url: line });
      continue;
    }

    // Check for LinkedIn URL
    if (line.match(/linkedin\.com\/in\//i)) {
      inputs.push({ type: 'linkedin_url', url: line });
      continue;
    }

    // Check for general URL
    if (line.match(/^https?:\/\//i)) {
      inputs.push({ type: 'personal_url', url: line });
      continue;
    }

    // Check for "Name at/@ Company" pattern
    const nameCompanyMatch = line.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (nameCompanyMatch) {
      inputs.push({
        type: 'name_company',
        name: nameCompanyMatch[1].trim(),
        company: nameCompanyMatch[2].trim(),
      });
      continue;
    }

    // Treat as pasted text if nothing else matches
    if (line.length > 20) {
      inputs.push({ type: 'pasted_text', text: line });
    }
  }

  return inputs;
}

/**
 * Builds a composite success profile from multiple ProfileAnalysis results.
 * Identifies common patterns across successful team members.
 */
export async function buildCompositeProfile(
  profiles: ProfileAnalysis[],
  aiProvider: AIProvider,
): Promise<{
  careerTrajectories: CareerStep[][];
  skillSignatures: string[];
  seniorityCalibration: string;
  cultureSignals: string[];
}> {
  if (profiles.length === 0) {
    return {
      careerTrajectories: [],
      skillSignatures: [],
      seniorityCalibration: 'unknown',
      cultureSignals: [],
    };
  }

  const messages = [
    {
      role: 'system' as const,
      content: `You are a talent analyst building a success profile from existing team members. Analyze the provided profiles and identify common patterns. Return a JSON object with:
- careerTrajectories: the career trajectories from the profiles (array of arrays of {company, role, duration, signals})
- skillSignatures: array of the most common/important skills across all profiles
- seniorityCalibration: a description of the typical seniority range (e.g., "4-7 years, owns subsystems")
- cultureSignals: array of common culture indicators across profiles`,
    },
    {
      role: 'user' as const,
      content: `Team member profiles:\n${JSON.stringify(profiles, null, 2)}`,
    },
  ];

  const { data } = await aiProvider.structuredOutput<{
    careerTrajectories: CareerStep[][];
    skillSignatures: string[];
    seniorityCalibration: string;
    cultureSignals: string[];
  }>(messages, { schema: CompositeProfileSchema });
  return data;
}

/**
 * Creates Phase 3 conversation nodes for success profile building.
 *
 * Flow:
 *   team_input → team_analysis → anti_patterns → next phase
 *
 * Users provide team member references (URLs, names, descriptions).
 * Each is analyzed and a composite success profile is built.
 */
export function createSuccessProfileNodes(
  aiProvider: AIProvider,
  contentResearch: ContentResearch,
  nextPhaseNodeId: string,
): ConversationNode[] {
  return [
    // Node 1: Ask for team member references
    {
      id: 'team_input',
      phase: 'success_profile',
      prompt: async (context: IntakeContext) => {
        const roleName = context.roleParameters?.title ?? 'this role';
        return `Now let's build a success profile for ${roleName}.\n\nShare references for 1-3 people who are great at this role (current team members, past hires, or role models). For each person, provide any of:\n- GitHub URL\n- LinkedIn URL\n- Personal website\n- Name @ Company\n- A description of their background\n\n(One per line, or paste a paragraph about them)`;
      },
      optional: true,
      parse: async (response: string, context: IntakeContext): Promise<ParsedResponse> => {
        const normalized = response.trim().toLowerCase();
        const isSkip = ['skip', 'none', 'n/a', 'no one', 'not sure'].some(
          phrase => normalized.includes(phrase),
        );

        if (isSkip) {
          return {
            structured: { skipped: true },
            contextUpdates: {},
            followUpNeeded: false,
          };
        }

        // Parse the input into ProfileInput objects
        const profileInputs = parseProfileInputs(response);

        if (profileInputs.length === 0) {
          return {
            structured: { noProfiles: true },
            contextUpdates: {},
            followUpNeeded: true,
            followUpReason: 'Could not parse any profile references from input',
          };
        }

        // Analyze each profile
        const analyses: ProfileAnalysis[] = [];
        for (const input of profileInputs) {
          try {
            const analysis = await contentResearch.analyzeProfile(input);
            analyses.push(analysis);
          } catch {
            // Skip profiles that fail to analyze
          }
        }

        // Extract similarity seeds from analyzed profiles
        const seeds = extractSimilaritySeeds(analyses);

        return {
          structured: { profileCount: analyses.length, profiles: analyses },
          contextUpdates: {
            teamProfiles: analyses,
            similaritySeeds: seeds,
          },
          followUpNeeded: false,
        };
      },
      next: (parsed: ParsedResponse, _context: IntakeContext) => {
        if (parsed.structured.skipped || parsed.structured.noProfiles) {
          return 'anti_patterns';
        }
        return 'team_analysis';
      },
    },

    // Node 2: Show analysis results, build composite profile
    {
      id: 'team_analysis',
      phase: 'success_profile',
      prompt: async (context: IntakeContext) => {
        const profiles = context.teamProfiles ?? [];
        if (profiles.length === 0) {
          return 'No team profiles to analyze. Let\'s move on to anti-patterns.';
        }

        const lines = [`I analyzed ${profiles.length} team member(s):\n`];

        for (const profile of profiles) {
          lines.push(`**${profile.name ?? 'Unknown'}** (${profile.inputType})`);
          if (profile.skillSignatures.length > 0) {
            lines.push(`  Skills: ${profile.skillSignatures.join(', ')}`);
          }
          if (profile.seniorityLevel) {
            lines.push(`  Seniority: ${profile.seniorityLevel}`);
          }
          if (profile.careerTrajectory.length > 0) {
            const trajectory = profile.careerTrajectory
              .map(step => `${step.company}${step.role ? ` (${step.role})` : ''}`)
              .join(' → ');
            lines.push(`  Trajectory: ${trajectory}`);
          }
          lines.push('');
        }

        lines.push('Does this capture the team accurately? Anything to add or correct?');

        return lines.join('\n');
      },
      parse: async (response: string, context: IntakeContext): Promise<ParsedResponse> => {
        // Build composite profile from team analyses
        const profiles = context.teamProfiles ?? [];
        const composite = await buildCompositeProfile(profiles, aiProvider);

        return {
          structured: { compositeProfile: composite },
          contextUpdates: { compositeProfile: composite },
          followUpNeeded: false,
        };
      },
      next: (_parsed: ParsedResponse, _context: IntakeContext) => 'anti_patterns',
    },

    // Node 3: Anti-pattern extraction
    {
      id: 'anti_patterns',
      phase: 'success_profile',
      prompt: async (context: IntakeContext) => {
        return `What are some red flags or anti-patterns for this role? What would make someone a bad fit?\n\n(e.g., "no public code", "job-hopping", "only large-company experience", "no distributed systems experience")`;
      },
      optional: true,
      parse: async (response: string, _context: IntakeContext): Promise<ParsedResponse> => {
        const normalized = response.trim().toLowerCase();
        const isSkip = ['skip', 'none', 'n/a', 'not sure'].some(
          phrase => normalized.includes(phrase),
        );

        if (isSkip) {
          return {
            structured: { skipped: true },
            contextUpdates: {},
            followUpNeeded: false,
          };
        }

        // Parse anti-patterns from user input using AI
        const messages = [
          {
            role: 'system' as const,
            content: `Parse the user's red flags/anti-patterns into a JSON array of strings. Each string should be a concise anti-pattern description (e.g., "frequent job-hopper", "no public code", "only enterprise experience").`,
          },
          {
            role: 'user' as const,
            content: response,
          },
        ];

        const { data: patterns } = await aiProvider.structuredOutput<string[]>(
          messages,
          { schema: AntiPatternsSchema },
        );

        return {
          structured: { antiPatterns: patterns },
          contextUpdates: { antiPatterns: patterns },
          followUpNeeded: false,
        };
      },
      next: (_parsed: ParsedResponse, _context: IntakeContext) => nextPhaseNodeId,
    },
  ];
}
