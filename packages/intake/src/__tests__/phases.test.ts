import { describe, it, expect } from 'vitest';
import type { ConversationNode, ParsedResponse, IntakeContext, RoleParameters } from '@sourcerer/core';
import { createRoleContextNodes } from '../phases/role-context.js';
import { createCompanyIntelNodes } from '../phases/company-intel.js';
import { createSuccessProfileNodes, parseProfileInputs, buildCompositeProfile } from '../phases/success-profile.js';
import {
  createSearchConfigNodes,
  generateAntiFilters,
  defaultEnrichmentPriority,
  defaultTierThresholds,
  buildTalentProfile,
  buildSearchConfig,
} from '../phases/search-config-gen.js';
import {
  createMockAIProvider,
  createMockContentResearch,
  makeRoleParameters,
  makeCompanyIntel,
  makeProfileAnalysis,
  makeCompetitorMap,
  makeIntakeContext,
  makeFullIntakeContext,
} from './helpers.js';
import { TERMINAL_NODE } from '../conversation-engine.js';

// --- Phase 1: Role Context ---

describe('Phase 1: Role Context', () => {
  const aiProvider = createMockAIProvider({
    structuredOutputHandler: () => makeRoleParameters(),
  });

  it('creates 3 conversation nodes', () => {
    const nodes = createRoleContextNodes(aiProvider, 'next_phase');
    expect(nodes).toHaveLength(3);
    expect(nodes[0].id).toBe('role_jd_input');
    expect(nodes[1].id).toBe('role_parse_confirm');
    expect(nodes[2].id).toBe('role_refine');
  });

  it('all nodes are in the "role" phase', () => {
    const nodes = createRoleContextNodes(aiProvider, 'next_phase');
    for (const node of nodes) {
      expect(node.phase).toBe('role');
    }
  });

  describe('role_jd_input', () => {
    it('generates an initial prompt for empty context', async () => {
      const nodes = createRoleContextNodes(aiProvider, 'next_phase');
      const node = nodes[0];
      const prompt = typeof node.prompt === 'function'
        ? await node.prompt(makeIntakeContext())
        : node.prompt;
      expect(prompt).toContain('job description');
    });

    it('generates a follow-up prompt when role description exists', async () => {
      const nodes = createRoleContextNodes(aiProvider, 'next_phase');
      const node = nodes[0];
      const ctx = makeIntakeContext({ roleDescription: 'Senior Engineer at Lunar Labs' });
      const prompt = typeof node.prompt === 'function'
        ? await node.prompt(ctx)
        : node.prompt;
      expect(prompt).toContain('already provided');
    });

    it('parses JD input into role parameters', async () => {
      const nodes = createRoleContextNodes(aiProvider, 'next_phase');
      const node = nodes[0];
      const result = await node.parse('Senior Backend Engineer for DeFi protocol', makeIntakeContext());
      expect(result.contextUpdates.roleParameters).toBeDefined();
      expect(result.contextUpdates.roleDescription).toBe('Senior Backend Engineer for DeFi protocol');
    });

    it('navigates to role_parse_confirm', async () => {
      const nodes = createRoleContextNodes(aiProvider, 'next_phase');
      const node = nodes[0];
      const result = await node.parse('test', makeIntakeContext());
      expect(node.next(result, makeIntakeContext())).toBe('role_parse_confirm');
    });
  });

  describe('role_parse_confirm', () => {
    it('generates a confirmation prompt with role parameters', async () => {
      const nodes = createRoleContextNodes(aiProvider, 'next_phase');
      const node = nodes[1];
      const ctx = makeIntakeContext({ roleParameters: makeRoleParameters() });
      const prompt = typeof node.prompt === 'function'
        ? await node.prompt(ctx)
        : node.prompt;
      expect(prompt).toContain('Senior Backend Engineer');
      expect(prompt).toContain('Must-have skills');
      expect(prompt).toContain('look right');
    });

    it('confirms and advances to next phase', async () => {
      const nodes = createRoleContextNodes(aiProvider, 'next_phase');
      const node = nodes[1];
      const result = await node.parse('yes', makeIntakeContext());
      expect(result.structured.confirmed).toBe(true);
      expect(node.next(result, makeIntakeContext())).toBe('next_phase');
    });

    it('routes to refine on non-confirmation', async () => {
      const nodes = createRoleContextNodes(aiProvider, 'next_phase');
      const node = nodes[1];
      const result = await node.parse('actually change the title to Staff Engineer', makeIntakeContext());
      expect(result.structured.confirmed).toBe(false);
      expect(result.followUpNeeded).toBe(true);
      expect(node.next(result, makeIntakeContext())).toBe('role_refine');
    });
  });

  describe('role_refine', () => {
    it('applies refinements and returns to confirm', async () => {
      const nodes = createRoleContextNodes(aiProvider, 'next_phase');
      const node = nodes[2];
      const ctx = makeIntakeContext({ roleParameters: makeRoleParameters() });
      const result = await node.parse('Change title to Staff Engineer', ctx);
      expect(result.contextUpdates.roleParameters).toBeDefined();
      expect(node.next(result, ctx)).toBe('role_parse_confirm');
    });
  });
});

// --- Phase 2: Company Intelligence ---

describe('Phase 2: Company Intelligence', () => {
  const aiProvider = createMockAIProvider({
    structuredOutputHandler: () => ({
      name: 'Test Corp',
      techStack: ['Go'],
      cultureSignals: ['remote'],
      targetCompanies: ['Coinbase'],
      avoidCompanies: [],
      competitorReason: {},
    }),
  });
  const contentResearch = createMockContentResearch();

  it('creates 3 conversation nodes', () => {
    const nodes = createCompanyIntelNodes(aiProvider, contentResearch, 'next_phase');
    expect(nodes).toHaveLength(3);
    expect(nodes[0].id).toBe('company_url_input');
    expect(nodes[1].id).toBe('company_analysis');
    expect(nodes[2].id).toBe('company_confirm');
  });

  it('all nodes are in the "company" phase', () => {
    const nodes = createCompanyIntelNodes(aiProvider, contentResearch, 'next_phase');
    for (const node of nodes) {
      expect(node.phase).toBe('company');
    }
  });

  describe('company_url_input', () => {
    it('skips when company data already exists', () => {
      const nodes = createCompanyIntelNodes(aiProvider, contentResearch, 'next_phase');
      const node = nodes[0];
      const ctx = makeIntakeContext({ companyIntel: makeCompanyIntel() });
      expect(node.skipIf?.(ctx)).toBe(true);
    });

    it('does not skip when no company data', () => {
      const nodes = createCompanyIntelNodes(aiProvider, contentResearch, 'next_phase');
      const node = nodes[0];
      expect(node.skipIf?.(makeIntakeContext())).toBe(false);
    });

    it('extracts URL from response', async () => {
      const nodes = createCompanyIntelNodes(aiProvider, contentResearch, 'next_phase');
      const node = nodes[0];
      const result = await node.parse('Check out https://lunarlabs.xyz', makeIntakeContext());
      expect(result.contextUpdates.companyUrl).toBe('https://lunarlabs.xyz');
    });
  });

  describe('company_confirm', () => {
    it('navigates to next phase', () => {
      const nodes = createCompanyIntelNodes(aiProvider, contentResearch, 'next_phase');
      const node = nodes[2];
      const result: ParsedResponse = {
        structured: { confirmed: true },
        contextUpdates: {},
        followUpNeeded: false,
      };
      expect(node.next(result, makeIntakeContext())).toBe('next_phase');
    });
  });
});

// --- Phase 3: Success Profile ---

describe('Phase 3: Success Profile', () => {
  describe('parseProfileInputs', () => {
    it('parses GitHub URLs', () => {
      const inputs = parseProfileInputs('https://github.com/sarahchen');
      expect(inputs).toHaveLength(1);
      expect(inputs[0].type).toBe('github_url');
    });

    it('parses LinkedIn URLs', () => {
      const inputs = parseProfileInputs('https://linkedin.com/in/sarahchen');
      expect(inputs).toHaveLength(1);
      expect(inputs[0].type).toBe('linkedin_url');
    });

    it('parses personal URLs', () => {
      const inputs = parseProfileInputs('https://sarahchen.dev');
      expect(inputs).toHaveLength(1);
      expect(inputs[0].type).toBe('personal_url');
    });

    it('parses name @ company', () => {
      const inputs = parseProfileInputs('Sarah Chen at Chainlink');
      expect(inputs).toHaveLength(1);
      expect(inputs[0].type).toBe('name_company');
      if (inputs[0].type === 'name_company') {
        expect(inputs[0].name).toBe('Sarah Chen');
        expect(inputs[0].company).toBe('Chainlink');
      }
    });

    it('parses name @ company with @ symbol', () => {
      const inputs = parseProfileInputs('Sarah Chen @ Chainlink');
      expect(inputs).toHaveLength(1);
      expect(inputs[0].type).toBe('name_company');
    });

    it('parses pasted text (long lines)', () => {
      const inputs = parseProfileInputs('Sarah is a senior backend engineer with 5 years of Go experience');
      expect(inputs).toHaveLength(1);
      expect(inputs[0].type).toBe('pasted_text');
    });

    it('parses mixed multi-line input', () => {
      const inputs = parseProfileInputs(
        `https://github.com/sarahchen
https://linkedin.com/in/bobsmith
Alice at Coinbase`,
      );
      expect(inputs).toHaveLength(3);
      expect(inputs[0].type).toBe('github_url');
      expect(inputs[1].type).toBe('linkedin_url');
      expect(inputs[2].type).toBe('name_company');
    });

    it('skips short lines that are not URLs or name@company', () => {
      const inputs = parseProfileInputs('hi\ntest');
      expect(inputs).toHaveLength(0);
    });

    it('skips empty lines', () => {
      const inputs = parseProfileInputs('\n\nhttps://github.com/user\n\n');
      expect(inputs).toHaveLength(1);
    });
  });

  describe('buildCompositeProfile', () => {
    it('returns empty profile for no inputs', async () => {
      const ai = createMockAIProvider();
      const result = await buildCompositeProfile([], ai);
      expect(result.skillSignatures).toEqual([]);
      expect(result.careerTrajectories).toEqual([]);
      expect(result.seniorityCalibration).toBe('unknown');
    });

    it('builds composite from profiles using AI', async () => {
      const ai = createMockAIProvider({
        structuredOutputHandler: () => ({
          careerTrajectories: [[{ company: 'Stripe', signals: ['payments'] }]],
          skillSignatures: ['Go', 'Kubernetes'],
          seniorityCalibration: '4-7 years',
          cultureSignals: ['OSS'],
        }),
      });

      const result = await buildCompositeProfile([makeProfileAnalysis()], ai);
      expect(result.skillSignatures).toContain('Go');
      expect(result.seniorityCalibration).toBe('4-7 years');
    });
  });

  describe('success profile nodes', () => {
    const aiProvider = createMockAIProvider({
      structuredOutputHandler: () => ['no public code', 'job hopper'],
    });
    const contentResearch = createMockContentResearch();

    it('creates 3 conversation nodes', () => {
      const nodes = createSuccessProfileNodes(aiProvider, contentResearch, 'next_phase');
      expect(nodes).toHaveLength(3);
      expect(nodes[0].id).toBe('team_input');
      expect(nodes[1].id).toBe('team_analysis');
      expect(nodes[2].id).toBe('anti_patterns');
    });

    it('team_input handles skip responses', async () => {
      const nodes = createSuccessProfileNodes(aiProvider, contentResearch, 'next_phase');
      const node = nodes[0];
      const result = await node.parse('skip', makeIntakeContext());
      expect(result.structured.skipped).toBe(true);
      expect(node.next(result, makeIntakeContext())).toBe('anti_patterns');
    });

    it('anti_patterns parses into context updates', async () => {
      const nodes = createSuccessProfileNodes(aiProvider, contentResearch, 'next_phase');
      const node = nodes[2];
      const result = await node.parse('no public code, job hopper', makeIntakeContext());
      expect(result.contextUpdates.antiPatterns).toBeDefined();
    });

    it('anti_patterns navigates to next phase', () => {
      const nodes = createSuccessProfileNodes(aiProvider, contentResearch, 'next_phase');
      const node = nodes[2];
      const result: ParsedResponse = { structured: {}, contextUpdates: {}, followUpNeeded: false };
      expect(node.next(result, makeIntakeContext())).toBe('next_phase');
    });
  });
});

// --- Phase 4: Search Config Generation ---

describe('Phase 4: Search Config Generation', () => {
  describe('generateAntiFilters', () => {
    it('generates filters from avoid companies', () => {
      const ctx = makeIntakeContext({
        competitorMap: makeCompetitorMap(),
      });
      const filters = generateAntiFilters(ctx);
      const companyFilters = filters.filter(f => f.type === 'exclude_company');
      expect(companyFilters).toHaveLength(1);
      expect(companyFilters[0].value).toBe('OldCorp');
    });

    it('generates filters from anti-patterns', () => {
      const ctx = makeIntakeContext({
        antiPatterns: ['no public code', 'job hopper'],
      });
      const filters = generateAntiFilters(ctx);
      const signalFilters = filters.filter(f => f.type === 'exclude_signal');
      expect(signalFilters).toHaveLength(2);
    });

    it('generates empty filters for empty context', () => {
      const filters = generateAntiFilters(makeIntakeContext());
      expect(filters).toEqual([]);
    });
  });

  describe('defaultEnrichmentPriority', () => {
    it('returns github, exa, hunter in order', () => {
      const priorities = defaultEnrichmentPriority();
      expect(priorities).toHaveLength(3);
      expect(priorities[0].adapter).toBe('github');
      expect(priorities[0].required).toBe(true);
      expect(priorities[2].adapter).toBe('hunter');
      expect(priorities[2].required).toBe(false);
    });
  });

  describe('defaultTierThresholds', () => {
    it('returns default thresholds', () => {
      const thresholds = defaultTierThresholds();
      expect(thresholds.tier1MinScore).toBe(70);
      expect(thresholds.tier2MinScore).toBe(40);
    });
  });

  describe('buildTalentProfile', () => {
    it('builds a complete talent profile from full context', () => {
      const ctx = makeFullIntakeContext();
      const profile = buildTalentProfile(ctx);

      expect(profile.role.title).toBe('Senior Backend Engineer');
      expect(profile.company.name).toBe('Lunar Labs');
      expect(profile.antiPatterns).toContain('frequent job-hopper');
      expect(profile.competitorMap.targetCompanies).toContain('Chainlink');
      expect(profile.createdAt).toBeTruthy();
    });

    it('throws without role parameters', () => {
      expect(() => buildTalentProfile(makeIntakeContext())).toThrow('role parameters');
    });

    it('throws without company intel', () => {
      const ctx = makeIntakeContext({ roleParameters: makeRoleParameters() });
      expect(() => buildTalentProfile(ctx)).toThrow('company intel');
    });

    it('handles empty team profiles', () => {
      const ctx = makeIntakeContext({
        roleParameters: makeRoleParameters(),
        companyIntel: makeCompanyIntel(),
      });
      const profile = buildTalentProfile(ctx);
      expect(profile.successPatterns.careerTrajectories).toEqual([]);
      expect(profile.successPatterns.skillSignatures).toEqual([]);
    });

    it('deduplicates skill signatures from multiple profiles', () => {
      const ctx = makeIntakeContext({
        roleParameters: makeRoleParameters(),
        companyIntel: makeCompanyIntel(),
        teamProfiles: [
          makeProfileAnalysis({ skillSignatures: ['Go', 'Rust'] }),
          makeProfileAnalysis({ skillSignatures: ['Go', 'Python'] }),
        ],
      });
      const profile = buildTalentProfile(ctx);
      const goCount = profile.successPatterns.skillSignatures.filter(s => s === 'Go').length;
      expect(goCount).toBe(1);
    });
  });

  describe('buildSearchConfig', () => {
    it('builds a complete search config', async () => {
      const ai = createMockAIProvider({
        structuredOutputHandler: (messages) => {
          const content = messages[0].content;
          if (content.includes('tiered search queries')) {
            return [
              { priority: 1, queries: [{ text: 'senior backend engineer at Coinbase', maxResults: 20 }] },
              { priority: 2, queries: [{ text: 'Go distributed systems', maxResults: 30 }] },
            ];
          }
          if (content.includes('scoring weights')) {
            return {
              technicalDepth: 0.3,
              domainRelevance: 0.25,
              trajectoryMatch: 0.2,
              cultureFit: 0.15,
              reachability: 0.1,
            };
          }
          return {};
        },
      });

      const ctx = makeFullIntakeContext();
      const config = await buildSearchConfig(ctx, ai);

      expect(config.roleName).toBe('Senior Backend Engineer');
      expect(config.tiers).toHaveLength(2);
      expect(config.scoringWeights.technicalDepth).toBe(0.3);
      expect(config.tierThresholds.tier1MinScore).toBe(70);
      expect(config.enrichmentPriority).toHaveLength(3);
      expect(config.version).toBe(1);
    });

    it('throws without role parameters', async () => {
      const ai = createMockAIProvider();
      await expect(buildSearchConfig(makeIntakeContext(), ai)).rejects.toThrow('role parameters');
    });

    it('includes anti-filters from context', async () => {
      const ai = createMockAIProvider({
        structuredOutputHandler: () => [],
      });

      const ctx = makeFullIntakeContext();
      const config = await buildSearchConfig(ctx, ai);
      const companyFilters = config.antiFilters.filter(f => f.type === 'exclude_company');
      expect(companyFilters.length).toBeGreaterThan(0);
    });

    it('includes similarity seeds from context', async () => {
      const ai = createMockAIProvider({
        structuredOutputHandler: () => [],
      });

      const ctx = makeFullIntakeContext();
      const config = await buildSearchConfig(ctx, ai);
      expect(config.similaritySeeds).toContain('https://github.com/sarahchen');
    });
  });

  describe('search config nodes', () => {
    it('creates 2 conversation nodes', () => {
      const ai = createMockAIProvider();
      const nodes = createSearchConfigNodes(ai);
      expect(nodes).toHaveLength(2);
      expect(nodes[0].id).toBe('config_generate');
      expect(nodes[1].id).toBe('config_review');
    });

    it('config nodes are in the "strategy" phase', () => {
      const ai = createMockAIProvider();
      const nodes = createSearchConfigNodes(ai);
      for (const node of nodes) {
        expect(node.phase).toBe('strategy');
      }
    });
  });
});
