// Phase 1: Role Context — JD parsing, role parameter extraction, confirmation loop

import type {
  ConversationNode,
  IntakeContext,
  ParsedResponse,
  RoleParameters,
  AIProvider,
} from '@sourcerer/core';

import { TERMINAL_NODE } from '../conversation-engine.js';
import { hasRoleData } from '../intake-context.js';

/**
 * Creates Phase 1 conversation nodes for role context gathering.
 *
 * Flow:
 *   role_jd_input → role_parse_confirm → role_refine (if needed) → next phase
 *
 * If the user pastes a JD, it's parsed into RoleParameters.
 * If the user describes the role freeform, AI extracts parameters.
 * The user is asked to confirm or refine the extracted parameters.
 */
export function createRoleContextNodes(
  aiProvider: AIProvider,
  nextPhaseNodeId: string,
): ConversationNode[] {
  return [
    // Node 1: Ask for role description / JD
    {
      id: 'role_jd_input',
      phase: 'role',
      prompt: async (context: IntakeContext) => {
        if (context.roleDescription) {
          return `I see you've already provided some role information. Would you like to add more detail, or shall we proceed with what we have?\n\nCurrent info: ${context.roleDescription.substring(0, 200)}...`;
        }
        return `Let's start by understanding the role you're hiring for.\n\nYou can:\n1. Paste a job description (JD)\n2. Describe the role in your own words\n3. Share a link to the job posting\n\nWhat do you have?`;
      },
      parse: async (response: string, context: IntakeContext): Promise<ParsedResponse> => {
        // Use AI to extract structured role parameters from freeform text
        const messages = [
          {
            role: 'system' as const,
            content: `You are a recruiter's assistant. Parse the provided role description or job posting into structured parameters. Return a JSON object with:
- title: job title
- level: seniority level (junior, mid, senior, staff, principal, lead, director)
- scope: what this person will own/do (one sentence)
- location: location if mentioned
- remotePolicy: one of "remote", "hybrid", "in_person", "negotiable" if mentioned
- compensationRange: {min, max, currency} if mentioned
- mustHaveSkills: array of required skills
- niceToHaveSkills: array of preferred skills
- teamSize: team size if mentioned
- reportingTo: who this person reports to if mentioned

If information is not available, omit the field. Be thorough in extracting skills.`,
          },
          {
            role: 'user' as const,
            content: response,
          },
        ];

        const roleParams = await aiProvider.structuredOutput<RoleParameters>(
          messages,
          { schema: {} as unknown },
        );

        return {
          structured: { roleParameters: roleParams },
          contextUpdates: {
            roleDescription: response,
            roleParameters: roleParams,
          },
          followUpNeeded: false,
        };
      },
      next: (_parsed: ParsedResponse, _context: IntakeContext) => 'role_parse_confirm',
    },

    // Node 2: Confirm parsed parameters
    {
      id: 'role_parse_confirm',
      phase: 'role',
      prompt: async (context: IntakeContext) => {
        const params = context.roleParameters;
        if (!params) {
          return 'I wasn\'t able to extract role parameters. Could you describe the role again?';
        }

        const lines = [
          `Here's what I extracted:\n`,
          `**Title:** ${params.title}`,
          `**Level:** ${params.level}`,
          `**Scope:** ${params.scope}`,
        ];

        if (params.location) lines.push(`**Location:** ${params.location}`);
        if (params.remotePolicy) lines.push(`**Remote policy:** ${params.remotePolicy}`);
        if (params.compensationRange) {
          const comp = params.compensationRange;
          lines.push(`**Compensation:** ${comp.min ? `${comp.currency} ${comp.min}` : '?'} - ${comp.max ? `${comp.currency} ${comp.max}` : '?'}`);
        }
        if (params.mustHaveSkills.length > 0) {
          lines.push(`**Must-have skills:** ${params.mustHaveSkills.join(', ')}`);
        }
        if (params.niceToHaveSkills.length > 0) {
          lines.push(`**Nice-to-have skills:** ${params.niceToHaveSkills.join(', ')}`);
        }
        if (params.teamSize) lines.push(`**Team size:** ${params.teamSize}`);
        if (params.reportingTo) lines.push(`**Reports to:** ${params.reportingTo}`);

        lines.push(`\nDoes this look right? You can say "yes" to proceed, or tell me what to change.`);

        return lines.join('\n');
      },
      parse: async (response: string, _context: IntakeContext): Promise<ParsedResponse> => {
        const normalized = response.trim().toLowerCase();
        const isConfirmed = ['yes', 'looks good', 'correct', 'confirmed', 'proceed', 'lgtm', 'looks right'].some(
          phrase => normalized.includes(phrase),
        ) || /^y$/i.test(normalized);

        if (isConfirmed) {
          return {
            structured: { confirmed: true },
            contextUpdates: {},
            followUpNeeded: false,
          };
        }

        // User wants refinements — they'll be processed in the refine node
        return {
          structured: { confirmed: false, refinement: response },
          contextUpdates: {},
          followUpNeeded: true,
          followUpReason: 'User wants to refine role parameters',
        };
      },
      next: (parsed: ParsedResponse, _context: IntakeContext) => {
        if (parsed.structured.confirmed) {
          return nextPhaseNodeId;
        }
        return 'role_refine';
      },
    },

    // Node 3: Refine parameters based on user feedback
    {
      id: 'role_refine',
      phase: 'role',
      prompt: 'What would you like to change? I\'ll update the role parameters.',
      skipIf: (context: IntakeContext) => false, // Never auto-skip — only reached via branching
      parse: async (response: string, context: IntakeContext): Promise<ParsedResponse> => {
        const currentParams = context.roleParameters;
        if (!currentParams) {
          return {
            structured: {},
            contextUpdates: {},
            followUpNeeded: true,
            followUpReason: 'No existing parameters to refine',
          };
        }

        // Use AI to apply refinements to existing parameters
        const messages = [
          {
            role: 'system' as const,
            content: `You are a recruiter's assistant. The user wants to refine the role parameters. Apply their changes to the existing parameters and return the complete updated JSON object with all fields:
- title, level, scope, location, remotePolicy, compensationRange, mustHaveSkills, niceToHaveSkills, teamSize, reportingTo

Current parameters:
${JSON.stringify(currentParams, null, 2)}`,
          },
          {
            role: 'user' as const,
            content: response,
          },
        ];

        const updatedParams = await aiProvider.structuredOutput<RoleParameters>(
          messages,
          { schema: {} as unknown },
        );

        return {
          structured: { roleParameters: updatedParams },
          contextUpdates: { roleParameters: updatedParams },
          followUpNeeded: false,
        };
      },
      next: (_parsed: ParsedResponse, _context: IntakeContext) => 'role_parse_confirm',
    },
  ];
}
