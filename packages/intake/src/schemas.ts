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
