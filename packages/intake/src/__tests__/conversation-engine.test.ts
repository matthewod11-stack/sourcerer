import { describe, it, expect } from 'vitest';
import type { ConversationNode, IntakeContext, ParsedResponse } from '@sourcerer/core';
import {
  ConversationEngine,
  buildGraph,
  validateGraph,
  restoreConversation,
  TERMINAL_NODE,
  type ConversationGraph,
} from '../conversation-engine.js';
import { createIntakeContext } from '../intake-context.js';

// --- Test Node Factories ---

function makeSimpleNode(
  id: string,
  nextNodeId: string,
  overrides?: Partial<ConversationNode>,
): ConversationNode {
  return {
    id,
    phase: 'role',
    prompt: `Question for ${id}`,
    parse: async (response: string): Promise<ParsedResponse> => ({
      structured: { answer: response },
      contextUpdates: {},
      followUpNeeded: false,
    }),
    next: () => nextNodeId,
    ...overrides,
  };
}

function makeDynamicNode(
  id: string,
  nextNodeId: string,
): ConversationNode {
  return {
    id,
    phase: 'role',
    prompt: async (context: IntakeContext) => {
      const historyLength = context.conversationHistory.length;
      return `Dynamic question (${historyLength} messages so far)`;
    },
    parse: async (response: string): Promise<ParsedResponse> => ({
      structured: { answer: response },
      contextUpdates: { roleDescription: response },
      followUpNeeded: false,
    }),
    next: () => nextNodeId,
  };
}

function makeBranchingNode(
  id: string,
  yesNodeId: string,
  noNodeId: string,
): ConversationNode {
  return {
    id,
    phase: 'role',
    prompt: 'Yes or no?',
    parse: async (response: string): Promise<ParsedResponse> => {
      const isYes = response.toLowerCase().includes('yes');
      return {
        structured: { answer: isYes },
        contextUpdates: {},
        followUpNeeded: false,
      };
    },
    next: (parsed: ParsedResponse) => {
      return parsed.structured.answer ? yesNodeId : noNodeId;
    },
  };
}

function makeSkippableNode(
  id: string,
  nextNodeId: string,
  skipCondition: (ctx: IntakeContext) => boolean,
): ConversationNode {
  return {
    id,
    phase: 'role',
    prompt: `Question for ${id}`,
    skipIf: skipCondition,
    parse: async (response: string): Promise<ParsedResponse> => ({
      structured: { answer: response },
      contextUpdates: {},
      followUpNeeded: false,
    }),
    next: () => nextNodeId,
  };
}

// --- Tests ---

describe('ConversationGraph', () => {
  describe('buildGraph', () => {
    it('builds a graph from an array of nodes', () => {
      const nodes = [
        makeSimpleNode('q1', 'q2'),
        makeSimpleNode('q2', TERMINAL_NODE),
      ];
      const graph = buildGraph(nodes);
      expect(graph.size).toBe(2);
      expect(graph.has('q1')).toBe(true);
      expect(graph.has('q2')).toBe(true);
    });

    it('throws on duplicate node IDs', () => {
      const nodes = [
        makeSimpleNode('q1', 'q2'),
        makeSimpleNode('q1', TERMINAL_NODE),
      ];
      expect(() => buildGraph(nodes)).toThrow('Duplicate node ID: q1');
    });
  });

  describe('validateGraph', () => {
    it('returns no errors for a valid graph', () => {
      const graph = buildGraph([
        makeSimpleNode('q1', 'q2'),
        makeSimpleNode('q2', TERMINAL_NODE),
      ]);
      expect(validateGraph(graph)).toHaveLength(0);
    });

    it('returns error for empty graph', () => {
      const graph = new Map() as ConversationGraph;
      const errors = validateGraph(graph);
      expect(errors).toContain('Graph has no nodes');
    });
  });
});

describe('ConversationEngine', () => {
  describe('basic flow', () => {
    it('executes a linear 2-node conversation', async () => {
      const graph = buildGraph([
        makeSimpleNode('q1', 'q2'),
        makeSimpleNode('q2', TERMINAL_NODE),
      ]);

      const engine = new ConversationEngine({
        graph,
        startNodeId: 'q1',
      });

      // First question
      expect(engine.isDone()).toBe(false);
      const prompt1 = await engine.getPrompt();
      expect(prompt1).toBe('Question for q1');

      // Answer first question
      const step1 = await engine.submitResponse('answer 1');
      expect(step1.parsed.structured.answer).toBe('answer 1');
      expect(step1.nextNodeId).toBe('q2');
      expect(step1.done).toBe(false);

      // Second question
      const prompt2 = await engine.getPrompt();
      expect(prompt2).toBe('Question for q2');

      // Answer second question
      const step2 = await engine.submitResponse('answer 2');
      expect(step2.nextNodeId).toBe(TERMINAL_NODE);
      expect(step2.done).toBe(true);

      // Engine is done
      expect(engine.isDone()).toBe(true);
      expect(await engine.getPrompt()).toBeNull();
    });

    it('tracks completed nodes', async () => {
      const graph = buildGraph([
        makeSimpleNode('q1', 'q2'),
        makeSimpleNode('q2', TERMINAL_NODE),
      ]);

      const engine = new ConversationEngine({ graph, startNodeId: 'q1' });

      await engine.submitResponse('answer');
      expect(engine.getCompletedNodes()).toContain('q1');

      await engine.submitResponse('answer');
      expect(engine.getCompletedNodes()).toContain('q2');
      expect(engine.getCompletedNodes()).toHaveLength(2);
    });

    it('records user messages in conversation history', async () => {
      const graph = buildGraph([
        makeSimpleNode('q1', TERMINAL_NODE),
      ]);

      const engine = new ConversationEngine({ graph, startNodeId: 'q1' });
      await engine.submitResponse('my answer');

      const ctx = engine.getContext();
      expect(ctx.conversationHistory).toHaveLength(1);
      expect(ctx.conversationHistory[0].role).toBe('user');
      expect(ctx.conversationHistory[0].content).toBe('my answer');
    });
  });

  describe('dynamic prompts', () => {
    it('calls prompt function with current context', async () => {
      const graph = buildGraph([
        makeDynamicNode('q1', TERMINAL_NODE),
      ]);

      const engine = new ConversationEngine({ graph, startNodeId: 'q1' });
      const prompt = await engine.getPrompt();
      expect(prompt).toBe('Dynamic question (0 messages so far)');
    });
  });

  describe('context updates', () => {
    it('applies context updates from parsed responses', async () => {
      const graph = buildGraph([
        makeDynamicNode('q1', TERMINAL_NODE),
      ]);

      const engine = new ConversationEngine({ graph, startNodeId: 'q1' });
      await engine.submitResponse('Backend engineer for DeFi');

      const ctx = engine.getContext();
      expect(ctx.roleDescription).toBe('Backend engineer for DeFi');
    });
  });

  describe('branching', () => {
    it('branches based on parsed response', async () => {
      const graph = buildGraph([
        makeBranchingNode('q1', 'yes_path', 'no_path'),
        makeSimpleNode('yes_path', TERMINAL_NODE),
        makeSimpleNode('no_path', TERMINAL_NODE),
      ]);

      // Test "yes" branch
      const engine1 = new ConversationEngine({ graph, startNodeId: 'q1' });
      const step1 = await engine1.submitResponse('yes please');
      expect(step1.nextNodeId).toBe('yes_path');

      // Test "no" branch
      const engine2 = new ConversationEngine({ graph, startNodeId: 'q1' });
      const step2 = await engine2.submitResponse('no thanks');
      expect(step2.nextNodeId).toBe('no_path');
    });
  });

  describe('skipping', () => {
    it('skips nodes when skipIf returns true', async () => {
      const graph = buildGraph([
        makeSkippableNode('q1', 'q2', (ctx) => ctx.roleDescription !== undefined),
        makeSimpleNode('q2', TERMINAL_NODE),
      ]);

      // Without roleDescription — should NOT skip
      const engine1 = new ConversationEngine({ graph, startNodeId: 'q1' });
      const prompt1 = await engine1.getPrompt();
      expect(prompt1).toBe('Question for q1');

      // With roleDescription — should skip to q2
      const engine2 = new ConversationEngine({
        graph,
        startNodeId: 'q1',
        initialContext: {
          roleDescription: 'already provided',
          conversationHistory: [],
        },
      });
      const prompt2 = await engine2.getPrompt();
      expect(prompt2).toBe('Question for q2');
    });

    it('skips multiple consecutive nodes', async () => {
      const graph = buildGraph([
        makeSkippableNode('q1', 'q2', () => true),
        makeSkippableNode('q2', 'q3', () => true),
        makeSimpleNode('q3', TERMINAL_NODE),
      ]);

      const engine = new ConversationEngine({ graph, startNodeId: 'q1' });
      const prompt = await engine.getPrompt();
      expect(prompt).toBe('Question for q3');
    });

    it('marks skipped nodes as completed', async () => {
      const graph = buildGraph([
        makeSkippableNode('q1', 'q2', () => true),
        makeSimpleNode('q2', TERMINAL_NODE),
      ]);

      const engine = new ConversationEngine({ graph, startNodeId: 'q1' });
      await engine.getPrompt();
      expect(engine.getCompletedNodes()).toContain('q1');
    });
  });

  describe('save/resume', () => {
    it('serializes and restores conversation state', async () => {
      const graph = buildGraph([
        makeSimpleNode('q1', 'q2'),
        makeSimpleNode('q2', 'q3'),
        makeSimpleNode('q3', TERMINAL_NODE),
      ]);

      // Run through first node
      const engine1 = new ConversationEngine({ graph, startNodeId: 'q1' });
      await engine1.submitResponse('answer 1');

      // Save state
      const stateJson = engine1.serializeState();
      const state = JSON.parse(stateJson);
      expect(state.version).toBe(1);
      expect(state.currentNodeId).toBe('q2');
      expect(state.completedNodes).toContain('q1');

      // Restore
      const engine2 = restoreConversation(graph, stateJson);
      expect(engine2.isDone()).toBe(false);

      const prompt = await engine2.getPrompt();
      expect(prompt).toBe('Question for q2');

      // Continue from restored state
      await engine2.submitResponse('answer 2');
      const prompt3 = await engine2.getPrompt();
      expect(prompt3).toBe('Question for q3');
    });

    it('restores completed nodes from state', async () => {
      const graph = buildGraph([
        makeSimpleNode('q1', 'q2'),
        makeSimpleNode('q2', TERMINAL_NODE),
      ]);

      const engine1 = new ConversationEngine({ graph, startNodeId: 'q1' });
      await engine1.submitResponse('answer');
      const stateJson = engine1.serializeState();

      const engine2 = restoreConversation(graph, stateJson);
      expect(engine2.getCompletedNodes()).toContain('q1');
    });

    it('rejects unsupported state versions', () => {
      const graph = buildGraph([makeSimpleNode('q1', TERMINAL_NODE)]);
      const badState = JSON.stringify({
        version: 99,
        currentNodeId: 'q1',
        context: { conversationHistory: [] },
        completedNodes: [],
        savedAt: new Date().toISOString(),
      });
      expect(() => restoreConversation(graph, badState)).toThrow('Unsupported conversation state version');
    });
  });

  describe('error handling', () => {
    it('throws when start node does not exist', () => {
      const graph = buildGraph([makeSimpleNode('q1', TERMINAL_NODE)]);
      expect(() => new ConversationEngine({ graph, startNodeId: 'nonexistent' }))
        .toThrow('Start node "nonexistent" not found');
    });

    it('throws when submitting response after done', async () => {
      const graph = buildGraph([makeSimpleNode('q1', TERMINAL_NODE)]);
      const engine = new ConversationEngine({ graph, startNodeId: 'q1' });
      await engine.submitResponse('answer');

      expect(engine.isDone()).toBe(true);
      await expect(engine.submitResponse('another')).rejects.toThrow('conversation is done');
    });
  });

  describe('5-node acceptance test', () => {
    it('executes a 5-node conversation with branching and context', async () => {
      // Build a 5-node graph:
      // q1 (role) → q2 (company) → q3 (branch: has team?) → q4 (team) → q5 (final) → DONE
      //                                                   └→ q5 (final) → DONE
      const graph = buildGraph([
        {
          id: 'q1',
          phase: 'role',
          prompt: 'Describe the role',
          parse: async (response: string): Promise<ParsedResponse> => ({
            structured: { role: response },
            contextUpdates: { roleDescription: response },
            followUpNeeded: false,
          }),
          next: () => 'q2',
        },
        {
          id: 'q2',
          phase: 'company',
          prompt: async (ctx: IntakeContext) =>
            `Got it: "${ctx.roleDescription}". What company?`,
          parse: async (response: string): Promise<ParsedResponse> => ({
            structured: { company: response },
            contextUpdates: { companyUrl: response },
            followUpNeeded: false,
          }),
          next: () => 'q3',
        },
        {
          id: 'q3',
          phase: 'success_profile',
          prompt: 'Do you have team members to reference? (yes/no)',
          parse: async (response: string): Promise<ParsedResponse> => ({
            structured: { hasTeam: response.toLowerCase().includes('yes') },
            contextUpdates: {},
            followUpNeeded: false,
          }),
          next: (parsed) => parsed.structured.hasTeam ? 'q4' : 'q5',
        },
        {
          id: 'q4',
          phase: 'success_profile',
          prompt: 'Share team member info',
          parse: async (response: string): Promise<ParsedResponse> => ({
            structured: { team: response },
            contextUpdates: { antiPatterns: ['from team analysis'] },
            followUpNeeded: false,
          }),
          next: () => 'q5',
        },
        {
          id: 'q5',
          phase: 'strategy',
          prompt: 'Ready to generate search config?',
          parse: async (): Promise<ParsedResponse> => ({
            structured: { ready: true },
            contextUpdates: {},
            followUpNeeded: false,
          }),
          next: () => TERMINAL_NODE,
        },
      ]);

      const engine = new ConversationEngine({ graph, startNodeId: 'q1' });

      // Step 1: Role
      const p1 = await engine.getPrompt();
      expect(p1).toBe('Describe the role');
      await engine.submitResponse('Senior Backend Engineer');

      // Step 2: Company (uses dynamic prompt with context)
      const p2 = await engine.getPrompt();
      expect(p2).toContain('Senior Backend Engineer');
      await engine.submitResponse('https://lunarlabs.xyz');

      // Step 3: Branch question
      const p3 = await engine.getPrompt();
      expect(p3).toContain('team members');
      const step3 = await engine.submitResponse('yes');
      expect(step3.nextNodeId).toBe('q4');

      // Step 4: Team info
      await engine.submitResponse('Sarah at Chainlink');

      // Step 5: Final
      await engine.submitResponse('yes');

      // Verify
      expect(engine.isDone()).toBe(true);
      expect(engine.getCompletedNodes()).toHaveLength(5);

      const ctx = engine.getContext();
      expect(ctx.roleDescription).toBe('Senior Backend Engineer');
      expect(ctx.companyUrl).toBe('https://lunarlabs.xyz');
      expect(ctx.antiPatterns).toContain('from team analysis');
      expect(ctx.conversationHistory).toHaveLength(5);
    });

    it('takes the skip branch in the 5-node conversation', async () => {
      const graph = buildGraph([
        makeSimpleNode('q1', 'q2'),
        makeSimpleNode('q2', 'q3'),
        makeBranchingNode('q3', 'q4', 'q5'),
        makeSimpleNode('q4', 'q5'),
        makeSimpleNode('q5', TERMINAL_NODE),
      ]);

      const engine = new ConversationEngine({ graph, startNodeId: 'q1' });

      await engine.submitResponse('answer 1');
      await engine.submitResponse('answer 2');
      await engine.submitResponse('no'); // Skip to q5
      await engine.submitResponse('done');

      expect(engine.isDone()).toBe(true);
      expect(engine.getCompletedNodes()).toHaveLength(4); // q1, q2, q3, q5 (q4 skipped)
      expect(engine.getCompletedNodes()).not.toContain('q4');
    });
  });
});
