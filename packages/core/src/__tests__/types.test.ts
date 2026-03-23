import { describe, it, expect } from 'vitest';
import {
  generateEvidenceId,
  type IdentifierType,
  type ConfidenceLevel,
  type ObservedIdentifier,
  type PersonIdentity,
  type EvidenceItem,
  type EvidenceIdInput,
  type RedFlag,
  type SignalDimension,
  type ScoreComponent,
  type Score,
  type ExtractedSignals,
  type PIIFieldType,
  type PIIField,
  type PIIMetadata,
  type SourceData,
  type RawCandidate,
  type Candidate,
  type ScoredCandidate,
  type EnrichmentResult,
  type RateLimitConfig,
  type CostEstimate,
  type SearchPage,
  type BatchResult,
  type DataSourceCapability,
  type DataSource,
  type SearchQuery,
  type SearchQueryTier,
  type ScoringWeights,
  type TierThresholds,
  type EnrichmentPriority,
  type AntiFilter,
  type SearchConfig,
  type OutputConfig,
  type PushResult,
  type UpsertResult,
  type OutputAdapter,
  type MessageRole,
  type Message,
  type ChatOptions,
  type StructuredOutputOptions,
  type AIProvider,
  type ConversationPhase,
  type IntakeContext,
  type ParsedResponse,
  type ConversationNode,
  type ProfileInput,
  type CrawledContent,
  type CompanyIntel,
  type CareerStep,
  type ProfileAnalysis,
  type SimilarResult,
  type ContentResearch,
  type RoleParameters,
  type CompetitorMap,
  type TalentProfile,
} from '../index.js';

// --- Helpers ---

/** Verify all evidenceIds in a score reference valid evidence items */
function validateEvidenceGrounding(
  evidence: EvidenceItem[],
  components: ScoreComponent[],
  redFlags: RedFlag[],
): string[] {
  const validIds = new Set(evidence.map((e) => e.id));
  const invalid: string[] = [];
  for (const c of components) {
    for (const id of c.evidenceIds) {
      if (!validIds.has(id)) invalid.push(id);
    }
  }
  for (const rf of redFlags) {
    if (!validIds.has(rf.evidenceId)) invalid.push(rf.evidenceId);
  }
  return invalid;
}

// --- Test Data Factories ---

const now = '2026-03-23T12:00:00Z';

function makeObservedIdentifier(overrides?: Partial<ObservedIdentifier>): ObservedIdentifier {
  return {
    type: 'github_username',
    value: 'sarahchen',
    source: 'github',
    observedAt: now,
    confidence: 'high',
    ...overrides,
  };
}

function makePersonIdentity(overrides?: Partial<PersonIdentity>): PersonIdentity {
  return {
    canonicalId: '550e8400-e29b-41d4-a716-446655440000',
    observedIdentifiers: [makeObservedIdentifier()],
    mergeConfidence: 1.0,
    ...overrides,
  };
}

function makeEvidenceItem(overrides?: Partial<EvidenceItem>): EvidenceItem {
  const base: EvidenceIdInput = {
    adapter: 'github',
    source: 'repo_analysis',
    claim: '847 Go commits in last 12mo',
    retrievedAt: now,
  };
  return {
    id: generateEvidenceId(base),
    claim: base.claim,
    source: base.source,
    adapter: base.adapter,
    retrievedAt: base.retrievedAt,
    confidence: 'high',
    ...overrides,
  };
}

// --- Tests ---

describe('Identity types', () => {
  it('constructs ObservedIdentifier with all identifier types', () => {
    const types: IdentifierType[] = [
      'linkedin_url', 'github_username', 'twitter_handle',
      'email', 'name_company', 'personal_url',
    ];
    for (const type of types) {
      const id = makeObservedIdentifier({ type, value: `test-${type}` });
      expect(id.type).toBe(type);
    }
  });

  it('constructs PersonIdentity with merge history', () => {
    const identity = makePersonIdentity({
      mergedFrom: ['id-a', 'id-b'],
      mergeConfidence: 0.95,
    });
    expect(identity.mergedFrom).toHaveLength(2);
    expect(identity.mergeConfidence).toBe(0.95);
  });
});

describe('Evidence types', () => {
  it('generates deterministic evidence IDs', () => {
    const input: EvidenceIdInput = {
      adapter: 'exa',
      source: 'web_search',
      claim: 'Senior Backend Engineer at Chainlink',
      retrievedAt: now,
    };
    const id1 = generateEvidenceId(input);
    const id2 = generateEvidenceId(input);
    expect(id1).toBe(id2);
  });

  it('generates different IDs for different inputs', () => {
    const id1 = generateEvidenceId({
      adapter: 'exa', source: 'search', claim: 'claim A', retrievedAt: now,
    });
    const id2 = generateEvidenceId({
      adapter: 'exa', source: 'search', claim: 'claim B', retrievedAt: now,
    });
    expect(id1).not.toBe(id2);
  });

  it('produces IDs matching ev-XXXXXX format', () => {
    const id = generateEvidenceId({
      adapter: 'github', source: 'commits', claim: 'test', retrievedAt: now,
    });
    expect(id).toMatch(/^ev-[0-9a-f]{6}$/);
  });

  it('constructs EvidenceItem with optional url', () => {
    const item = makeEvidenceItem({ url: 'https://github.com/sarahchen' });
    expect(item.url).toBe('https://github.com/sarahchen');
    expect(item.id).toMatch(/^ev-/);
  });
});

describe('Scoring types', () => {
  it('constructs Score with full breakdown', () => {
    const ev1 = makeEvidenceItem({ claim: 'Go commits' });
    const ev2 = makeEvidenceItem({ claim: 'DeFi libraries' });
    const ev3 = makeEvidenceItem({ claim: 'Job-hopped 3x' });

    const component: ScoreComponent = {
      dimension: 'technicalDepth',
      raw: 8,
      weight: 0.3,
      weighted: 24,
      evidenceIds: [ev1.id, ev2.id],
      confidence: 0.9,
    };

    const redFlag: RedFlag = {
      signal: 'Frequent job changes',
      evidenceId: ev3.id,
      severity: 'medium',
    };

    const score: Score = {
      total: 76.5,
      breakdown: [component],
      weights: { technicalDepth: 0.3 },
      redFlags: [redFlag],
    };

    expect(score.total).toBe(76.5);
    expect(score.breakdown[0].evidenceIds).toHaveLength(2);
  });

  it('constructs ExtractedSignals with all dimensions', () => {
    const dim: SignalDimension = { score: 7, evidenceIds: ['ev-abc123'], confidence: 0.8 };
    const signals: ExtractedSignals = {
      technicalDepth: dim,
      domainRelevance: dim,
      trajectoryMatch: dim,
      cultureFit: dim,
      reachability: dim,
      redFlags: [],
    };
    expect(Object.keys(signals)).toHaveLength(6);
  });
});

describe('Candidate types', () => {
  it('enforces Candidate.id === identity.canonicalId', () => {
    const identity = makePersonIdentity();
    const candidate: Candidate = {
      id: identity.canonicalId,
      identity,
      name: 'Sarah Chen',
      sources: {
        exa: {
          adapter: 'exa',
          retrievedAt: now,
          urls: ['https://sarahchen.dev'],
        },
      },
      evidence: [makeEvidenceItem()],
      enrichments: {},
      pii: { fields: [], retentionPolicy: 'default' },
    };
    expect(candidate.id).toBe(candidate.identity.canonicalId);
  });

  it('constructs RawCandidate from adapter output', () => {
    const raw: RawCandidate = {
      name: 'Sarah Chen',
      identifiers: [makeObservedIdentifier()],
      sourceData: {
        adapter: 'exa',
        retrievedAt: now,
        urls: ['https://sarahchen.dev'],
      },
      evidence: [makeEvidenceItem()],
      piiFields: [{
        value: 'sarah@gmail.com',
        type: 'email',
        adapter: 'github',
        collectedAt: now,
      }],
    };
    expect(raw.identifiers).toHaveLength(1);
    expect(raw.piiFields[0].type).toBe('email');
  });

  it('constructs ScoredCandidate with required score fields', () => {
    const identity = makePersonIdentity();
    const dim: SignalDimension = { score: 8, evidenceIds: [], confidence: 0.9 };
    const scored: ScoredCandidate = {
      id: identity.canonicalId,
      identity,
      name: 'Sarah Chen',
      sources: {},
      evidence: [],
      enrichments: {},
      pii: { fields: [], retentionPolicy: 'default' },
      signals: {
        technicalDepth: dim,
        domainRelevance: dim,
        trajectoryMatch: dim,
        cultureFit: dim,
        reachability: dim,
        redFlags: [],
      },
      score: {
        total: 76.5,
        breakdown: [],
        weights: {},
        redFlags: [],
      },
      narrative: 'Sarah is a strong backend engineer...',
      tier: 1,
    };
    expect(scored.tier).toBe(1);
    expect(scored.narrative).toBeTruthy();
    expect(scored.score.total).toBe(76.5);
    expect(scored.signals.technicalDepth.score).toBe(8);
  });

  it('constructs EnrichmentResult', () => {
    const result: EnrichmentResult = {
      adapter: 'github',
      candidateId: '550e8400-e29b-41d4-a716-446655440000',
      evidence: [makeEvidenceItem()],
      piiFields: [],
      sourceData: { adapter: 'github', retrievedAt: now, urls: [] },
      enrichedAt: now,
    };
    expect(result.adapter).toBe('github');
  });
});

describe('Evidence grounding constraint', () => {
  it('validates that all evidenceIds reference real evidence items', () => {
    const ev1 = makeEvidenceItem({ claim: 'claim 1' });
    const ev2 = makeEvidenceItem({ claim: 'claim 2' });
    const evidence = [ev1, ev2];

    const validComponent: ScoreComponent = {
      dimension: 'technicalDepth',
      raw: 8,
      weight: 0.3,
      weighted: 24,
      evidenceIds: [ev1.id, ev2.id],
      confidence: 0.9,
    };

    const validFlag: RedFlag = {
      signal: 'test',
      evidenceId: ev1.id,
      severity: 'low',
    };

    // All valid — should return empty array
    expect(validateEvidenceGrounding(evidence, [validComponent], [validFlag])).toHaveLength(0);

    // Invalid reference — should catch it
    const badComponent: ScoreComponent = {
      ...validComponent,
      evidenceIds: [ev1.id, 'ev-fake00'],
    };
    const invalid = validateEvidenceGrounding(evidence, [badComponent], []);
    expect(invalid).toContain('ev-fake00');
  });
});

describe('Pipeline types', () => {
  it('constructs SearchConfig', () => {
    const config: SearchConfig = {
      roleName: 'Senior Backend Engineer',
      tiers: [{
        priority: 1,
        queries: [{
          text: 'senior backend engineer at Coinbase',
          targetCompanies: ['Coinbase', 'Alchemy'],
          maxResults: 20,
        }],
      }],
      scoringWeights: {
        technicalDepth: 0.3,
        domainRelevance: 0.25,
        trajectoryMatch: 0.2,
        cultureFit: 0.15,
        reachability: 0.1,
      },
      tierThresholds: { tier1MinScore: 70, tier2MinScore: 40 },
      enrichmentPriority: [
        { adapter: 'github', required: true, runCondition: 'always' },
        { adapter: 'hunter', required: false, runCondition: 'if_cheap_insufficient' },
      ],
      antiFilters: [
        { type: 'exclude_company', value: 'OldCorp', reason: 'culture mismatch' },
        { type: 'min_experience_years', value: 3 },
      ],
      similaritySeeds: ['https://sarahchen.dev'],
      maxCandidates: 100,
      maxCostUsd: 5.0,
      createdAt: now,
      version: 1,
    };
    expect(config.tiers[0].priority).toBe(1);
    expect(config.scoringWeights.technicalDepth).toBe(0.3);
  });

  it('constructs CostEstimate', () => {
    const estimate: CostEstimate = {
      estimatedCost: 3.50,
      breakdown: { exa_search: 2.00, ai_extraction: 1.50 },
      searchCount: 40,
      enrichCount: 25,
      currency: 'USD',
    };
    expect(estimate.currency).toBe('USD');
  });

  it('constructs UpsertResult', () => {
    const result: UpsertResult = {
      created: ['id-1', 'id-2'],
      updated: ['id-3'],
      unchanged: ['id-4'],
      failed: [{ candidateId: 'id-5', error: new Error('Notion API timeout') }],
    };
    expect(result.created).toHaveLength(2);
    expect(result.failed[0].error.message).toContain('Notion');
  });
});

describe('AI types', () => {
  it('constructs Message with all roles', () => {
    const roles: MessageRole[] = ['system', 'user', 'assistant'];
    for (const role of roles) {
      const msg: Message = { role, content: `Hello from ${role}` };
      expect(msg.role).toBe(role);
    }
  });

  it('constructs ChatOptions', () => {
    const opts: ChatOptions = {
      model: 'claude-sonnet-4-6',
      temperature: 0.7,
      maxTokens: 4096,
      stopSequences: ['###'],
    };
    expect(opts.model).toBe('claude-sonnet-4-6');
  });
});

describe('Intake types', () => {
  it('constructs all ProfileInput variants', () => {
    const inputs: ProfileInput[] = [
      { type: 'github_url', url: 'https://github.com/sarahchen' },
      { type: 'linkedin_url', url: 'https://linkedin.com/in/sarahchen' },
      { type: 'pasted_text', text: 'Sarah is a backend engineer...' },
      { type: 'name_company', name: 'Sarah Chen', company: 'Chainlink' },
      { type: 'personal_url', url: 'https://sarahchen.dev' },
    ];
    expect(inputs).toHaveLength(5);
    expect(inputs[0].type).toBe('github_url');
  });

  it('constructs TalentProfile', () => {
    const profile: TalentProfile = {
      role: {
        title: 'Senior Backend Engineer',
        level: 'senior',
        scope: 'Own backend infrastructure for DeFi protocol',
        location: 'San Francisco',
        remotePolicy: 'hybrid',
        mustHaveSkills: ['Go', 'distributed systems'],
        niceToHaveSkills: ['Rust', 'DeFi'],
      },
      company: {
        name: 'Lunar Labs',
        url: 'https://lunarlabs.xyz',
        techStack: ['Go', 'Kubernetes', 'PostgreSQL'],
        fundingStage: 'Series B',
        cultureSignals: ['OSS-friendly', 'async-first'],
        analyzedAt: now,
      },
      successPatterns: {
        careerTrajectories: [[
          { company: 'Stripe', role: 'Backend Engineer', duration: '2 years', signals: ['payments infra'] },
          { company: 'Chainlink', role: 'Senior Backend Engineer', duration: '3 years', signals: ['indexing infra'] },
        ]],
        skillSignatures: ['Go', 'distributed systems', 'DeFi'],
        seniorityCalibration: '4-7 years, owns subsystems',
        cultureSignals: ['OSS contributor', 'heads-down builder'],
      },
      antiPatterns: ['frequent job-hopper', 'no public code'],
      competitorMap: {
        targetCompanies: ['Chainlink', 'Alchemy', 'Compound'],
        avoidCompanies: ['OldCorp'],
        competitorReason: {
          Chainlink: 'DeFi infra, similar tech stack',
          OldCorp: 'Culture mismatch',
        },
      },
      createdAt: now,
    };
    expect(profile.role.title).toBe('Senior Backend Engineer');
    expect(profile.successPatterns.skillSignatures).toContain('Go');
  });

  it('constructs CompanyIntel', () => {
    const intel: CompanyIntel = {
      name: 'Lunar Labs',
      url: 'https://lunarlabs.xyz',
      techStack: ['Go', 'Kubernetes'],
      teamSize: '10-50',
      fundingStage: 'Series B',
      productCategory: 'DeFi',
      cultureSignals: ['async-first'],
      pitch: 'Building the infrastructure layer for DeFi',
      competitors: ['Alchemy', 'Infura'],
      analyzedAt: now,
    };
    expect(intel.techStack).toContain('Go');
  });
});
