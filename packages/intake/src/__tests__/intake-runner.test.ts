import { describe, it, expect } from 'vitest';
import {
  buildIntakeGraph,
  createIntakeEngine,
  restoreIntakeEngine,
  extractIntakeResult,
} from '../intake-runner.js';
import { TERMINAL_NODE } from '../conversation-engine.js';
import {
  createMockAIProvider,
  createMockContentResearch,
  makeRoleParameters,
  makeCompanyIntel,
  makeProfileAnalysis,
  makeCompetitorMap,
  makeFullIntakeContext,
} from './helpers.js';

describe('IntakeRunner', () => {
  function createDeps() {
    return {
      aiProvider: createMockAIProvider({
        structuredOutputHandler: (messages) => {
          const systemContent = messages[0]?.content ?? '';

          // Route based on the system prompt content
          if (systemContent.includes('Parse the provided role description')) {
            return makeRoleParameters();
          }
          if (systemContent.includes('apply refinements') || systemContent.includes('refine the role parameters')) {
            return makeRoleParameters({ title: 'Staff Engineer' });
          }
          if (systemContent.includes('company intelligence') || systemContent.includes('company analyst')) {
            return {
              name: 'Lunar Labs',
              techStack: ['Go'],
              cultureSignals: ['remote'],
              targetCompanies: ['Coinbase'],
              avoidCompanies: [],
              competitorReason: {},
            };
          }
          if (systemContent.includes('competitor')) {
            return makeCompetitorMap();
          }
          if (systemContent.includes('talent analyst') && systemContent.includes('red flags')) {
            return ['no public code'];
          }
          if (systemContent.includes('composite') || systemContent.includes('success profile')) {
            return {
              careerTrajectories: [],
              skillSignatures: ['Go'],
              seniorityCalibration: 'senior',
              cultureSignals: ['remote'],
            };
          }
          if (systemContent.includes('tiered search queries')) {
            return [{ priority: 1, queries: [{ text: 'senior backend engineer', maxResults: 20 }] }];
          }
          if (systemContent.includes('scoring weights')) {
            return { technicalDepth: 0.3, domainRelevance: 0.25, trajectoryMatch: 0.2, cultureFit: 0.15, reachability: 0.1 };
          }
          if (systemContent.includes('adjustment')) {
            return {};
          }

          return {};
        },
      }),
      contentResearch: createMockContentResearch(),
    };
  }

  describe('buildIntakeGraph', () => {
    it('builds a graph with all phase nodes', () => {
      const deps = createDeps();
      const graph = buildIntakeGraph(deps);

      // Should have nodes from all 4 phases
      expect(graph.has('role_jd_input')).toBe(true);
      expect(graph.has('role_parse_confirm')).toBe(true);
      expect(graph.has('role_refine')).toBe(true);
      expect(graph.has('company_url_input')).toBe(true);
      expect(graph.has('company_analysis')).toBe(true);
      expect(graph.has('company_confirm')).toBe(true);
      expect(graph.has('team_input')).toBe(true);
      expect(graph.has('team_analysis')).toBe(true);
      expect(graph.has('anti_patterns')).toBe(true);
      expect(graph.has('config_generate')).toBe(true);
      expect(graph.has('config_review')).toBe(true);

      expect(graph.size).toBe(11);
    });
  });

  describe('createIntakeEngine', () => {
    it('creates an engine starting at role_jd_input', async () => {
      const deps = createDeps();
      const engine = createIntakeEngine(deps);

      expect(engine.isDone()).toBe(false);
      const prompt = await engine.getPrompt();
      expect(prompt).toContain('job description');
    });

    it('accepts initial context', async () => {
      const deps = createDeps();
      const ctx = makeFullIntakeContext();
      const engine = createIntakeEngine(deps, ctx);

      // Should still start at role_jd_input but with existing context
      expect(engine.getContext().roleDescription).toBe(ctx.roleDescription);
    });
  });

  describe('restoreIntakeEngine', () => {
    it('restores from saved state', async () => {
      const deps = createDeps();
      const engine = createIntakeEngine(deps);

      // Answer first question
      await engine.submitResponse('Senior Backend Engineer for DeFi');
      const stateJson = engine.serializeState();

      // Restore
      const restored = restoreIntakeEngine(deps, stateJson);
      expect(restored.isDone()).toBe(false);
      expect(restored.getCompletedNodes()).toContain('role_jd_input');
    });
  });

  describe('extractIntakeResult', () => {
    it('extracts search config, talent profile, and seeds', async () => {
      const deps = createDeps();
      const ctx = makeFullIntakeContext();
      const result = await extractIntakeResult(ctx, deps.aiProvider);

      expect(result.searchConfig).toBeDefined();
      expect(result.searchConfig.roleName).toBe('Senior Backend Engineer');
      expect(result.talentProfile).toBeDefined();
      expect(result.talentProfile.role.title).toBe('Senior Backend Engineer');
      expect(result.similaritySeeds).toContain('https://github.com/sarahchen');
      expect(result.context).toBe(ctx);
    });
  });

  describe('full conversation flow', () => {
    it('executes phase 1 through confirmation', async () => {
      const deps = createDeps();
      const engine = createIntakeEngine(deps);

      // Phase 1: Role input
      const p1 = await engine.getPrompt();
      expect(p1).toBeTruthy();
      await engine.submitResponse('We need a Senior Backend Engineer who knows Go and distributed systems');

      // Phase 1: Confirm
      const p2 = await engine.getPrompt();
      expect(p2).toContain('Senior Backend Engineer');
      await engine.submitResponse('yes');

      // Should be at Phase 2 now (company_url_input)
      const currentNode = engine.getCurrentNode();
      expect(currentNode?.id).toBe('company_url_input');
      expect(currentNode?.phase).toBe('company');
    });
  });
});
