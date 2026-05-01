import type {
  Candidate,
  EvidenceItem,
  ExtractedSignals,
  SearchConfig,
  SignalDimension,
  TalentProfile,
} from '@sourcerer/core';
import type { GoldenCandidate, GoldenSet, ScoreDimension } from '../types.js';

const now = '2026-05-01T00:00:00.000Z';

export const GOLDEN_SEARCH_CONFIG: SearchConfig = {
  roleName: 'Senior ML Infrastructure Engineer',
  tiers: [],
  scoringWeights: {
    technicalDepth: 0.3,
    domainRelevance: 0.25,
    trajectoryMatch: 0.2,
    cultureFit: 0.15,
    reachability: 0.1,
  },
  tierThresholds: { tier1MinScore: 72, tier2MinScore: 48 },
  enrichmentPriority: [],
  antiFilters: [],
  maxCandidates: 20,
  createdAt: now,
  version: 1,
};

export const GOLDEN_TALENT_PROFILE: TalentProfile = {
  role: {
    title: 'Senior ML Infrastructure Engineer',
    level: 'Senior',
    scope: 'Own distributed model training and inference infrastructure',
    mustHaveSkills: ['Python', 'Kubernetes', 'distributed systems', 'ML infrastructure'],
    niceToHaveSkills: ['CUDA', 'PyTorch', 'Rust', 'observability'],
  },
  company: {
    name: 'Northstar AI',
    url: 'https://northstar.example',
    techStack: ['Python', 'TypeScript', 'Kubernetes', 'PyTorch', 'Postgres'],
    cultureSignals: ['high ownership', 'clear writing', 'production reliability'],
    analyzedAt: now,
  },
  successPatterns: {
    careerTrajectories: [
      [
        {
          company: 'Infrastructure company',
          role: 'Backend or infra engineer',
          signals: ['moved into ML systems'],
        },
      ],
      [
        {
          company: 'AI company',
          role: 'Research platform engineer',
          signals: ['production ownership'],
        },
      ],
    ],
    skillSignatures: [
      'distributed training',
      'GPU scheduling',
      'model-serving reliability',
      'developer tooling for ML teams',
    ],
    seniorityCalibration: 'Senior+ engineer who can own ambiguous systems work',
    cultureSignals: ['debugs from evidence', 'writes operational docs'],
  },
  antiPatterns: ['only notebook experimentation', 'pure data analysis without systems ownership'],
  competitorMap: {
    targetCompanies: ['OpenAI', 'Anthropic', 'Scale AI', 'Databricks', 'Stripe'],
    avoidCompanies: [],
    competitorReason: {},
  },
  createdAt: now,
};

const DIMENSIONS: readonly ScoreDimension[] = [
  'technicalDepth',
  'domainRelevance',
  'trajectoryMatch',
  'cultureFit',
  'reachability',
] as const;

function evidence(id: string, adapter: string, claim: string): EvidenceItem {
  return {
    id,
    adapter,
    source: `${adapter}-fixture`,
    claim,
    retrievedAt: now,
    confidence: 'high',
    url: `https://example.com/${id}`,
  };
}

function candidate(id: string, name: string, claims: string[]): Candidate {
  const evidenceItems = claims.map((claim, index) =>
    evidence(`ev-${id}${String(index + 1).padStart(2, '0')}`, 'golden', claim),
  );
  return {
    id: `golden-${id}`,
    identity: {
      canonicalId: `golden-${id}`,
      observedIdentifiers: [
        {
          type: 'name_company',
          value: `${name} @ fixture`,
          source: 'golden',
          observedAt: now,
          confidence: 'high',
        },
      ],
      mergeConfidence: 1,
    },
    name,
    sources: {
      golden: {
        adapter: 'golden',
        retrievedAt: now,
        urls: [`https://example.com/${id}`],
      },
    },
    evidence: evidenceItems,
    enrichments: {},
    pii: { fields: [], retentionPolicy: 'default' },
  };
}

function dimension(score: number, ids: string[], confidence = 0.9): SignalDimension {
  return { score, evidenceIds: ids, confidence };
}

function expected(
  c: Candidate,
  scores: Record<ScoreDimension, number>,
  confidence = 0.9,
): ExtractedSignals {
  const ids = c.evidence.map((item) => item.id);
  const byDimension = Object.fromEntries(
    DIMENSIONS.map((name, index) => [
      name,
      dimension(scores[name], [ids[index % ids.length]], confidence),
    ]),
  ) as Record<ScoreDimension, SignalDimension>;
  return {
    ...byDimension,
    redFlags: [],
  };
}

function golden(
  id: string,
  name: string,
  claims: string[],
  scores: Record<ScoreDimension, number>,
  expectedTier: 1 | 2 | 3,
  rationale: string,
  confidence = 1,
): GoldenCandidate {
  const c = candidate(id, name, claims);
  return {
    id: c.id,
    candidate: c,
    expectedTier,
    expectedSignals: expected(c, scores, confidence),
    rationale,
  };
}

export const GOLDEN_CANDIDATES: GoldenCandidate[] = [
  golden(
    'ml001',
    'Asha Raman',
    [
      'Led Kubernetes GPU scheduler work for multi-node PyTorch training.',
      'Reduced model-serving p95 latency by 38% through batching and cache tuning.',
      'Authored incident reviews and production runbooks for inference outages.',
      'Maintains open-source operators for distributed training workloads.',
      'Current staff engineer on a platform team serving 80 ML researchers.',
    ],
    { technicalDepth: 94, domainRelevance: 92, trajectoryMatch: 90, cultureFit: 86, reachability: 72 },
    1,
    'Direct senior ML infrastructure match with production ownership.',
  ),
  golden(
    'ml002',
    'Marco Silva',
    [
      'Built feature-store ingestion pipelines in Python and Spark.',
      'Owns batch data reliability but has limited model-serving exposure.',
      'Writes clear postmortems for data quality incidents.',
      'Has Kubernetes deployment experience for internal data jobs.',
      'Public profile lists data platform leadership at mid-stage startup.',
    ],
    { technicalDepth: 70, domainRelevance: 63, trajectoryMatch: 64, cultureFit: 78, reachability: 60 },
    2,
    'Strong infra-adjacent candidate but lighter on ML serving and GPUs.',
  ),
  golden(
    'ml003',
    'Nina Patel',
    [
      'Research scientist focused on notebook experimentation and model quality.',
      'Published papers on recommendation models without platform ownership.',
      'Uses PyTorch daily but does not mention production infrastructure.',
      'No evidence of Kubernetes, serving, or distributed systems ownership.',
      'Likely prefers research roadmap over infra roadmap.',
    ],
    { technicalDepth: 50, domainRelevance: 38, trajectoryMatch: 32, cultureFit: 45, reachability: 50 },
    3,
    'Good ML knowledge, but misses the infrastructure ownership bar.',
  ),
  golden(
    'ml004',
    'Ethan Brooks',
    [
      'Principal backend engineer who built distributed job orchestration services.',
      'No direct ML platform role, but deep queueing and scheduling background.',
      'Led migration from VMs to Kubernetes for production workloads.',
      'Mentors senior engineers and writes detailed design docs.',
      'Open-source Rust and Go repositories show systems depth.',
    ],
    { technicalDepth: 78, domainRelevance: 58, trajectoryMatch: 72, cultureFit: 80, reachability: 58 },
    2,
    'High systems depth with plausible ML infra transition, but domain gap remains.',
  ),
  golden(
    'ml005',
    'Priya Chen',
    [
      'Owned inference platform at a foundation-model startup.',
      'Built autoscaling for GPU-backed endpoints and model rollout tooling.',
      'Improved deploy safety with canarying, SLO dashboards, and rollback automation.',
      'Frequent talks on ML platform reliability and developer experience.',
      'Profile includes clear contact path through GitHub and personal site.',
    ],
    { technicalDepth: 96, domainRelevance: 96, trajectoryMatch: 94, cultureFit: 90, reachability: 82 },
    1,
    'Ideal candidate across ML infra, reliability, seniority, and reachability.',
  ),
  golden(
    'ml006',
    'Owen Walker',
    [
      'Frontend platform engineer focused on design systems and build tooling.',
      'Some TypeScript infrastructure work but no ML systems evidence.',
      'Strong collaboration and documentation signals.',
      'No Python, GPU, Kubernetes, or model-serving claims found.',
      'Career trajectory points toward web platform leadership.',
    ],
    { technicalDepth: 42, domainRelevance: 24, trajectoryMatch: 30, cultureFit: 70, reachability: 65 },
    3,
    'Strong engineer, but the evidence is outside the target domain.',
  ),
  golden(
    'ml007',
    'Leah Kim',
    [
      'Built distributed training observability for JAX workloads.',
      'Implemented GPU utilization tracing and automated failed-run triage.',
      'Partnered with researchers to reduce training waste by 21%.',
      'Operates production Kubernetes clusters for ML experimentation.',
      'Writes clear docs and has active conference talks.',
    ],
    { technicalDepth: 91, domainRelevance: 93, trajectoryMatch: 88, cultureFit: 88, reachability: 74 },
    1,
    'Excellent training-platform match with strong operating signals.',
  ),
  golden(
    'ml008',
    'Samir Haddad',
    [
      'SRE lead for high-traffic payment APIs with deep incident experience.',
      'Kubernetes and observability expert, but no ML workload evidence.',
      'Has built capacity planning systems and autoscaling policies.',
      'Writes excellent runbooks and incident retrospectives.',
      'May need ramp-up on PyTorch and GPU-specific failure modes.',
    ],
    { technicalDepth: 82, domainRelevance: 50, trajectoryMatch: 66, cultureFit: 86, reachability: 68 },
    2,
    'Strong reliability hire with domain ramp risk.',
  ),
  golden(
    'ml009',
    'Camila Ortiz',
    [
      'Data analyst building dashboards and SQL models for marketing teams.',
      'No production software ownership beyond scheduled dbt jobs.',
      'Uses Python notebooks for analysis, not platform engineering.',
      'No distributed systems, Kubernetes, or service reliability signals.',
      'Public profile suggests analytics IC path.',
    ],
    { technicalDepth: 28, domainRelevance: 18, trajectoryMatch: 22, cultureFit: 48, reachability: 60 },
    3,
    'Clear non-match for senior ML infrastructure.',
  ),
  golden(
    'ml010',
    'Iris Novak',
    [
      'Created internal model registry and deployment approvals workflow.',
      'Built Python services that connect training artifacts to production rollout.',
      'Less evidence of low-level GPU work, but strong ML lifecycle ownership.',
      'Collaborates closely with infra, research, and compliance teams.',
      'Maintains detailed architecture docs.',
    ],
    { technicalDepth: 80, domainRelevance: 84, trajectoryMatch: 82, cultureFit: 88, reachability: 64 },
    1,
    'Strong ML platform lifecycle candidate, slightly lighter on systems internals.',
  ),
  golden(
    'ml011',
    'Theo Martin',
    [
      'Security engineer specializing in IAM, audit logging, and threat modeling.',
      'Built policy enforcement services in Go and Kubernetes.',
      'No ML platform or model-serving evidence.',
      'Strong seniority and operational discipline.',
      'Likely better fit for security platform roles.',
    ],
    { technicalDepth: 60, domainRelevance: 28, trajectoryMatch: 35, cultureFit: 60, reachability: 52 },
    3,
    'Good systems engineer, but not enough ML infrastructure relevance.',
  ),
  golden(
    'ml012',
    'Maya Singh',
    [
      'Led migration of model-serving workloads from bespoke scripts to Kubernetes.',
      'Built cost attribution for GPU inference teams.',
      'Introduced load testing and SLOs for recommender-system endpoints.',
      'Mentors engineers across ML platform and backend teams.',
      'Profile has strong public writing on platform tradeoffs.',
    ],
    { technicalDepth: 90, domainRelevance: 90, trajectoryMatch: 89, cultureFit: 91, reachability: 76 },
    1,
    'Senior ML serving and cost-control match with strong leadership evidence.',
  ),
  golden(
    'ml013',
    'Ben Carter',
    [
      'Machine learning engineer shipping ranking models in a product team.',
      'Owns feature iteration and offline evaluation, not shared infrastructure.',
      'Some Airflow and Python service experience.',
      'No evidence of Kubernetes ownership or multi-team platform work.',
      'Good collaborator with product analytics teams.',
    ],
    { technicalDepth: 62, domainRelevance: 58, trajectoryMatch: 52, cultureFit: 74, reachability: 70 },
    2,
    'Reasonable ML engineer, but only partial platform match.',
  ),
  golden(
    'ml014',
    'Hannah Weiss',
    [
      'Built CUDA kernels and optimized training throughput for vision models.',
      'Strong GPU performance work but limited production service ownership.',
      'Collaborates with research teams on profiling and bottleneck analysis.',
      'No evidence of model-serving reliability or incident ownership.',
      'Deep technical profile with niche systems focus.',
    ],
    { technicalDepth: 82, domainRelevance: 70, trajectoryMatch: 66, cultureFit: 72, reachability: 52 },
    2,
    'Exceptional low-level depth, but narrower than full infra ownership.',
  ),
  golden(
    'ml015',
    'Jon Bell',
    [
      'Engineering manager for enterprise SaaS integrations.',
      'Mostly people management and roadmap coordination.',
      'No current hands-on ML, infra, or distributed systems evidence.',
      'Strong stakeholder management but weak technical match.',
      'Profile indicates low likelihood of returning to hands-on infra IC work.',
    ],
    { technicalDepth: 30, domainRelevance: 20, trajectoryMatch: 18, cultureFit: 62, reachability: 54 },
    3,
    'Seniority is not enough; evidence misses the role requirements.',
  ),
];

export const GOLDEN_SET: GoldenSet = {
  name: 'senior-ml-infra-v1',
  description: 'Synthetic, sanitized fixtures for senior ML infrastructure scoring quality.',
  searchConfig: GOLDEN_SEARCH_CONFIG,
  talentProfile: GOLDEN_TALENT_PROFILE,
  candidates: GOLDEN_CANDIDATES,
};
