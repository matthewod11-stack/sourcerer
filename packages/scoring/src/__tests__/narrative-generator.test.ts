import { describe, it, expect, vi } from 'vitest';
import type {
  AIProvider,
  Candidate,
  TalentProfile,
  ExtractedSignals,
  Score,
  EvidenceItem,
} from '@sourcerer/core';
import { generateEvidenceId } from '@sourcerer/core';
import { generateNarrative, formatScoreBreakdown } from '../narrative-generator.js';

// --- Fixtures ---

const now = '2026-03-25T00:00:00Z';

function makeEvidence(adapter: string, claim: string): EvidenceItem {
  const input = { adapter, source: `https://${adapter}.test`, claim, retrievedAt: now };
  return { id: generateEvidenceId(input), ...input, confidence: 'medium' };
}

const evidence: EvidenceItem[] = [
  makeEvidence('github', '50 public repos with 1200+ stars'),
  makeEvidence('github', 'Primary: TypeScript (60%), Rust (25%)'),
  makeEvidence('x', 'Bio: Staff Engineer at Acme Corp'),
];

const talentProfile: TalentProfile = {
  role: { title: 'Senior Backend Engineer', level: 'Senior', scope: 'Backend', mustHaveSkills: ['TypeScript'], niceToHaveSkills: [] },
  company: { name: 'Test Corp', url: '', techStack: ['TypeScript'], cultureSignals: [], analyzedAt: now },
  successPatterns: { careerTrajectories: [], skillSignatures: [], seniorityCalibration: '', cultureSignals: [] },
  antiPatterns: [],
  competitorMap: { targetCompanies: [], avoidCompanies: [], competitorReason: {} },
  createdAt: now,
};

const signals: ExtractedSignals = {
  technicalDepth: { score: 82, evidenceIds: [evidence[0].id], confidence: 0.9 },
  domainRelevance: { score: 75, evidenceIds: [evidence[1].id], confidence: 0.8 },
  trajectoryMatch: { score: 68, evidenceIds: [evidence[2].id], confidence: 0.7 },
  cultureFit: { score: 60, evidenceIds: [], confidence: 0.5 },
  reachability: { score: 90, evidenceIds: [], confidence: 0.95 },
  redFlags: [],
};

const score: Score = {
  total: 72,
  breakdown: [
    { dimension: 'technicalDepth', raw: 82, weight: 0.3, weighted: 24.6, evidenceIds: [evidence[0].id], confidence: 0.9 },
    { dimension: 'domainRelevance', raw: 75, weight: 0.25, weighted: 18.75, evidenceIds: [evidence[1].id], confidence: 0.8 },
    { dimension: 'trajectoryMatch', raw: 68, weight: 0.2, weighted: 13.6, evidenceIds: [evidence[2].id], confidence: 0.7 },
    { dimension: 'cultureFit', raw: 60, weight: 0.15, weighted: 9.0, evidenceIds: [], confidence: 0.5 },
    { dimension: 'reachability', raw: 90, weight: 0.1, weighted: 9.0, evidenceIds: [], confidence: 0.95 },
  ],
  weights: { technicalDepth: 0.3, domainRelevance: 0.25, trajectoryMatch: 0.2, cultureFit: 0.15, reachability: 0.1 },
  redFlags: [],
};

const candidate: Candidate = {
  id: 'cand-001',
  identity: { canonicalId: 'cand-001', observedIdentifiers: [], mergedFrom: [], mergeConfidence: 1 },
  name: 'Jane Doe',
  sources: {},
  evidence,
  enrichments: {},
  pii: { fields: [], retentionPolicy: 'default' },
};

const MOCK_NARRATIVE = `Jane Doe is a strong candidate for the Senior Backend Engineer role. Her extensive GitHub presence (${evidence[0].id}) demonstrates deep technical expertise.`;

function makeMockProvider(): AIProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(MOCK_NARRATIVE),
    structuredOutput: vi.fn(),
  };
}

// --- Tests ---

describe('generateNarrative', () => {
  it('returns narrative text from LLM', async () => {
    const provider = makeMockProvider();
    const result = await generateNarrative(candidate, talentProfile, signals, score, provider);

    expect(result).toBe(MOCK_NARRATIVE);
    expect(result).toContain('Jane Doe');
  });

  it('calls provider.chat (not structuredOutput)', async () => {
    const provider = makeMockProvider();
    await generateNarrative(candidate, talentProfile, signals, score, provider);

    expect(provider.chat).toHaveBeenCalledOnce();
    expect(provider.structuredOutput).not.toHaveBeenCalled();
  });

  it('passes all template variables in the prompt', async () => {
    const provider = makeMockProvider();
    await generateNarrative(candidate, talentProfile, signals, score, provider);

    const prompt = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0][0].content as string;
    // Prompt should contain all key sections from the template
    expect(prompt).toContain('Jane Doe'); // candidateName
    expect(prompt).toContain(evidence[0].id); // evidenceIds
    expect(prompt).toContain('50 public repos'); // evidence content
    expect(prompt).toContain('technicalDepth'); // signals
    expect(prompt).toContain('Total: 72/100'); // scoreBreakdown
    expect(prompt).toContain('Senior Backend Engineer'); // talentProfile
  });

  it('uses default temperature 0.3', async () => {
    const provider = makeMockProvider();
    await generateNarrative(candidate, talentProfile, signals, score, provider);

    const opts = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.temperature).toBe(0.3);
  });

  it('accepts custom temperature', async () => {
    const provider = makeMockProvider();
    await generateNarrative(candidate, talentProfile, signals, score, provider, { temperature: 0.7 });

    const opts = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.temperature).toBe(0.7);
  });

  it('works with empty evidence', async () => {
    const provider = makeMockProvider();
    const emptyCandidate: Candidate = { ...candidate, evidence: [] };

    const result = await generateNarrative(emptyCandidate, talentProfile, signals, score, provider);
    expect(result).toBe(MOCK_NARRATIVE);

    const prompt = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0][0].content as string;
    expect(prompt).toContain('(no evidence available)');
  });
});

describe('formatScoreBreakdown', () => {
  it('produces readable breakdown with all dimensions', () => {
    const formatted = formatScoreBreakdown(score);

    expect(formatted).toContain('Total: 72/100');
    expect(formatted).toContain('technicalDepth: 82 × 0.30 = 24.6');
    expect(formatted).toContain('reachability: 90 × 0.10 = 9.0');
    expect(formatted).toContain('Red flags: none');
  });

  it('includes red flag summary when present', () => {
    const scoreWithFlags: Score = {
      ...score,
      redFlags: [
        { signal: 'Job hopping', evidenceId: 'ev-001', severity: 'medium' },
        { signal: 'No OSS', evidenceId: 'ev-002', severity: 'low' },
      ],
    };
    const formatted = formatScoreBreakdown(scoreWithFlags);

    expect(formatted).toContain('Red flags: 2');
    expect(formatted).toContain('medium: "Job hopping"');
    expect(formatted).toContain('low: "No OSS"');
  });
});
