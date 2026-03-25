// @sourcerer/scoring — Scoring engine, signal extraction, narrative generation

// Signal extraction
export { extractSignals, formatEvidence, formatTalentProfile } from './signal-extractor.js';
export type { ExtractSignalsOptions, SignalExtractionResult } from './signal-extractor.js';

// Evidence grounding validation
export { validateGrounding } from './grounding-validator.js';
export type { GroundingViolation, GroundingResult } from './grounding-validator.js';

// Score calculation
export { calculateScore, assignTier } from './score-calculator.js';
export type { ScoreOptions } from './score-calculator.js';

// Narrative generation
export { generateNarrative, formatScoreBreakdown } from './narrative-generator.js';
export type { NarrativeOptions } from './narrative-generator.js';

// Zod schemas for LLM output validation
export {
  ExtractedSignalsSchema,
  SignalDimensionSchema,
  RedFlagSchema,
} from './schemas.js';
