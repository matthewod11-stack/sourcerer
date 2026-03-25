// Zod schemas for LLM structured output validation

import { z } from 'zod';

export const SignalDimensionSchema = z.object({
  score: z.number().min(0).max(100),
  evidenceIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const RedFlagSchema = z.object({
  signal: z.string(),
  evidenceId: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
});

export const ExtractedSignalsSchema = z.object({
  technicalDepth: SignalDimensionSchema,
  domainRelevance: SignalDimensionSchema,
  trajectoryMatch: SignalDimensionSchema,
  cultureFit: SignalDimensionSchema,
  reachability: SignalDimensionSchema,
  redFlags: z.array(RedFlagSchema),
});

export type ValidatedSignals = z.infer<typeof ExtractedSignalsSchema>;
