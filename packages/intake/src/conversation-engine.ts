// Conversation engine — graph-based conversation flow with branching, save/resume

import type {
  ConversationNode,
  ConversationPhase,
  IntakeContext,
  ParsedResponse,
  AIProvider,
  Message,
} from '@sourcerer/core';

import {
  mergeContextUpdates,
  appendMessage,
  serializeContext,
  deserializeContext,
} from './intake-context.js';

// --- Conversation Graph ---

/**
 * A conversation graph is a map of node IDs to ConversationNode objects.
 * Navigation is driven by each node's `next()` function.
 */
export type ConversationGraph = Map<string, ConversationNode>;

/**
 * Serializable snapshot of a conversation's progress.
 * Used for --resume functionality.
 */
export interface ConversationState {
  /** The node ID where the conversation was paused */
  currentNodeId: string;
  /** Accumulated context */
  context: IntakeContext;
  /** IDs of nodes that have been completed */
  completedNodes: string[];
  /** Timestamp when the state was saved */
  savedAt: string;
  /** Version for forward compatibility */
  version: 1;
}

/**
 * Result of running a single conversation step.
 */
export interface StepResult {
  /** The parsed response from the user */
  parsed: ParsedResponse;
  /** Updated context after applying the response */
  context: IntakeContext;
  /** The ID of the next node to execute */
  nextNodeId: string;
  /** Whether the conversation is complete (next points to a terminal) */
  done: boolean;
}

/** Sentinel node ID indicating the conversation is complete */
export const TERMINAL_NODE = '__done__';

// --- Graph Builder ---

/**
 * Builds a ConversationGraph from an array of ConversationNodes.
 * Validates that all `next()` targets exist in the graph or are TERMINAL_NODE.
 */
export function buildGraph(nodes: ConversationNode[]): ConversationGraph {
  const graph: ConversationGraph = new Map();
  for (const node of nodes) {
    if (graph.has(node.id)) {
      throw new Error(`Duplicate node ID: ${node.id}`);
    }
    graph.set(node.id, node);
  }
  return graph;
}

/**
 * Validates that a graph is well-formed:
 * - At least one node
 * - All referenced node IDs exist (checked at runtime via next())
 */
export function validateGraph(graph: ConversationGraph): string[] {
  const errors: string[] = [];
  if (graph.size === 0) {
    errors.push('Graph has no nodes');
  }
  return errors;
}

// --- Conversation Engine ---

export interface ConversationEngineOptions {
  /** The conversation graph to traverse */
  graph: ConversationGraph;
  /** The ID of the first node to execute */
  startNodeId: string;
  /** Optional initial context (for resume) */
  initialContext?: IntakeContext;
  /** Optional set of already-completed node IDs (for resume) */
  completedNodes?: string[];
}

/**
 * Stateful conversation engine that traverses a ConversationGraph.
 *
 * Usage:
 * 1. Create with buildGraph() + startNodeId
 * 2. Call getPrompt() to get the current question
 * 3. Call submitResponse() with the user's answer
 * 4. Repeat until isDone() returns true
 * 5. Call getContext() to retrieve accumulated data
 */
export class ConversationEngine {
  private readonly graph: ConversationGraph;
  private currentNodeId: string;
  private context: IntakeContext;
  private completedNodes: Set<string>;

  constructor(options: ConversationEngineOptions) {
    this.graph = options.graph;
    this.currentNodeId = options.startNodeId;
    this.context = options.initialContext ?? { conversationHistory: [] };
    this.completedNodes = new Set(options.completedNodes ?? []);

    // Validate start node exists
    if (!this.graph.has(this.currentNodeId) && this.currentNodeId !== TERMINAL_NODE) {
      throw new Error(`Start node "${this.currentNodeId}" not found in graph`);
    }
  }

  /**
   * Returns the current node, or null if the conversation is done.
   */
  getCurrentNode(): ConversationNode | null {
    if (this.isDone()) return null;
    return this.graph.get(this.currentNodeId) ?? null;
  }

  /**
   * Generates the prompt for the current node.
   * Handles both static strings and dynamic prompt functions.
   * If the current node should be skipped, advances to the next node.
   */
  async getPrompt(): Promise<string | null> {
    // Skip nodes whose skipIf condition is met
    await this.skipEligibleNodes();

    if (this.isDone()) return null;

    const node = this.getCurrentNode();
    if (!node) return null;

    if (typeof node.prompt === 'function') {
      return node.prompt(this.context);
    }
    return node.prompt;
  }

  /**
   * Processes a user response for the current node.
   * Parses the response, updates context, and advances to the next node.
   */
  async submitResponse(response: string): Promise<StepResult> {
    const node = this.getCurrentNode();
    if (!node) {
      throw new Error('Cannot submit response: conversation is done');
    }

    // Record the user message
    this.context = appendMessage(this.context, { role: 'user', content: response });

    // Parse the response
    const parsed = await node.parse(response, this.context);

    // Apply context updates
    this.context = mergeContextUpdates(this.context, parsed.contextUpdates);

    // Mark node as completed
    this.completedNodes.add(node.id);

    // Determine next node
    const nextNodeId = node.next(parsed, this.context);
    this.currentNodeId = nextNodeId;

    return {
      parsed,
      context: this.context,
      nextNodeId,
      done: nextNodeId === TERMINAL_NODE,
    };
  }

  /**
   * Whether the conversation has reached a terminal state.
   */
  isDone(): boolean {
    return this.currentNodeId === TERMINAL_NODE;
  }

  /**
   * Returns the current accumulated context.
   */
  getContext(): IntakeContext {
    return this.context;
  }

  /**
   * Returns the IDs of all completed nodes.
   */
  getCompletedNodes(): string[] {
    return [...this.completedNodes];
  }

  /**
   * Serializes the current conversation state for save/resume.
   */
  saveState(): ConversationState {
    return {
      currentNodeId: this.currentNodeId,
      context: this.context,
      completedNodes: [...this.completedNodes],
      savedAt: new Date().toISOString(),
      version: 1,
    };
  }

  /**
   * Serializes the conversation state to a JSON string.
   */
  serializeState(): string {
    return JSON.stringify(this.saveState(), null, 2);
  }

  /**
   * Skips nodes whose skipIf condition is met, advancing through the graph.
   * Prevents infinite loops by tracking visited nodes in this skip cycle.
   */
  private async skipEligibleNodes(): Promise<void> {
    const visited = new Set<string>();
    while (!this.isDone()) {
      if (visited.has(this.currentNodeId)) {
        // Prevent infinite skip loops
        break;
      }
      visited.add(this.currentNodeId);

      const node = this.graph.get(this.currentNodeId);
      if (!node) break;

      if (node.skipIf && node.skipIf(this.context)) {
        // Create a synthetic empty parsed response to navigate
        const emptyParsed: ParsedResponse = {
          structured: {},
          contextUpdates: {},
          followUpNeeded: false,
        };
        this.completedNodes.add(node.id);
        this.currentNodeId = node.next(emptyParsed, this.context);
      } else {
        break;
      }
    }
  }
}

/**
 * Restores a ConversationEngine from a serialized state.
 */
export function restoreConversation(
  graph: ConversationGraph,
  stateJson: string,
): ConversationEngine {
  const state = JSON.parse(stateJson) as ConversationState;

  if (state.version !== 1) {
    throw new Error(`Unsupported conversation state version: ${state.version}`);
  }

  return new ConversationEngine({
    graph,
    startNodeId: state.currentNodeId,
    initialContext: state.context,
    completedNodes: state.completedNodes,
  });
}
