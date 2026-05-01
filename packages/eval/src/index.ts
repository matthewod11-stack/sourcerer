export {
  GOLDEN_CANDIDATES,
  GOLDEN_SEARCH_CONFIG,
  GOLDEN_SET,
  GOLDEN_TALENT_PROFILE,
} from './fixtures/golden-set.js';
export {
  createGoldenFixtureProvider,
  runGoldenEvaluation,
  writeEvalReports,
} from './runner.js';
export type { RunGoldenEvalOptions, WriteEvalReportOptions } from './runner.js';
export { SCORE_DIMENSIONS } from './types.js';
export type {
  CandidateEvalResult,
  GoldenCandidate,
  GoldenEvalMetrics,
  GoldenEvalReport,
  GoldenSet,
  ScoreDimension,
} from './types.js';
