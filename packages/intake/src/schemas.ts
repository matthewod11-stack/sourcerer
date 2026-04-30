// Zod schemas for structured AI output validation
// These mirror the TypeScript types in @sourcerer/core but provide runtime validation

import { z } from 'zod';

// --- Role Parameters ---

export const RoleParametersSchema = z.object({
  title: z.string(),
  level: z.string(),
  scope: z.string(),
  location: z.string().optional(),
  remotePolicy: z.enum(['remote', 'hybrid', 'in_person', 'negotiable']).optional(),
  compensationRange: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      currency: z.string(),
    })
    .optional(),
  mustHaveSkills: z.array(z.string()).default([]),
  niceToHaveSkills: z.array(z.string()).default([]),
  teamSize: z.string().optional(),
  reportingTo: z.string().optional(),
});

// --- Company Intel (partial — without url and analyzedAt, which are added by the caller) ---

export const CompanyIntelPartialSchema = z.object({
  name: z.string(),
  techStack: z.array(z.string()).default([]),
  teamSize: z.string().optional(),
  fundingStage: z.string().optional(),
  productCategory: z.string().optional(),
  cultureSignals: z.array(z.string()).default([]),
  pitch: z.string().optional(),
  competitors: z.array(z.string()).optional(),
});

// --- Competitor Map ---

export const CompetitorMapSchema = z.object({
  targetCompanies: z.array(z.string()).default([]),
  avoidCompanies: z.array(z.string()).default([]),
  competitorReason: z.record(z.string(), z.string()).default({}),
});

// --- Composite Success Profile ---

const CareerStepSchema = z.object({
  company: z.string(),
  role: z.string().optional(),
  duration: z.string().optional(),
  signals: z.array(z.string()).default([]),
});

export const CompositeProfileSchema = z.object({
  careerTrajectories: z.array(z.array(CareerStepSchema)).default([]),
  skillSignatures: z.array(z.string()).default([]),
  seniorityCalibration: z.string().default(''),
  cultureSignals: z.array(z.string()).default([]),
});

// --- Anti-Patterns ---

export const AntiPatternsSchema = z.array(z.string());

// --- Search Query Tiers ---

const SearchQuerySchema = z.object({
  text: z.string(),
  targetCompanies: z.array(z.string()).optional(),
  includeDomains: z.array(z.string()).optional(),
  excludeDomains: z.array(z.string()).optional(),
  maxResults: z.number().optional(),
});

export const SearchQueryTierArraySchema = z.array(
  z.object({
    priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    queries: z.array(SearchQuerySchema),
  }),
);

// --- Scoring Weights ---

export const ScoringWeightsSchema = z.record(z.string(), z.number());

// --- Config Adjustments (freeform from user) ---

export const AdjustmentsSchema = z.object({
  maxCandidates: z.number().optional(),
  maxCostUsd: z.number().optional(),
  addAntiPattern: z.string().optional(),
  removeAntiPattern: z.string().optional(),
  adjustWeight: z
    .object({ dimension: z.string(), weight: z.number() })
    .optional(),
  other: z.string().optional(),
}).passthrough();

// --- Profile Analysis (partial — without inputType, urls, analyzedAt which are set by caller) ---

export const ProfileAnalysisPartialSchema = z.object({
  name: z.string().optional(),
  careerTrajectory: z
    .array(CareerStepSchema)
    .default([]),
  skillSignatures: z.array(z.string()).default([]),
  seniorityLevel: z.string().optional(),
  cultureSignals: z.array(z.string()).default([]),
});

// --- IntakeContext (H-6: full deserialization validation) ---

const ProfileInputTypeSchema = z.enum([
  'github_url',
  'linkedin_url',
  'pasted_text',
  'name_company',
  'personal_url',
]);

const FullProfileAnalysisSchema = z.object({
  inputType: ProfileInputTypeSchema,
  name: z.string().optional(),
  careerTrajectory: z.array(CareerStepSchema).default([]),
  skillSignatures: z.array(z.string()).default([]),
  seniorityLevel: z.string().optional(),
  cultureSignals: z.array(z.string()).default([]),
  urls: z.array(z.string()).default([]),
  analyzedAt: z.string(),
});

const FullCompanyIntelSchema = z.object({
  name: z.string(),
  url: z.string(),
  techStack: z.array(z.string()).default([]),
  teamSize: z.string().optional(),
  fundingStage: z.string().optional(),
  productCategory: z.string().optional(),
  cultureSignals: z.array(z.string()).default([]),
  pitch: z.string().optional(),
  competitors: z.array(z.string()).optional(),
  analyzedAt: z.string(),
});

const TalentProfileSchema = z.object({
  role: RoleParametersSchema,
  company: FullCompanyIntelSchema,
  successPatterns: CompositeProfileSchema,
  antiPatterns: z.array(z.string()).default([]),
  competitorMap: CompetitorMapSchema,
  createdAt: z.string(),
});

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

/**
 * Validates an `IntakeContext` parsed from disk. H-6: replaces the prior
 * `parsed as unknown as IntakeContext` cast in `deserializeContext`. Catches
 * shape drift, missing arrays, or version-incompatible serializations at the
 * boundary instead of at the first phase that touches the bad field.
 */
export const IntakeContextSchema = z.object({
  roleDescription: z.string().optional(),
  roleParameters: RoleParametersSchema.optional(),
  companyUrl: z.string().optional(),
  companyIntel: FullCompanyIntelSchema.optional(),
  teamProfiles: z.array(FullProfileAnalysisSchema).optional(),
  compositeProfile: CompositeProfileSchema.optional(),
  antiPatterns: z.array(z.string()).optional(),
  competitorMap: CompetitorMapSchema.optional(),
  talentProfile: TalentProfileSchema.optional(),
  similaritySeeds: z.array(z.string()).optional(),
  conversationHistory: z.array(MessageSchema),
});
