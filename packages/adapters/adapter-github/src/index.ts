// @sourcerer/adapter-github — GitHub enrichment adapter

export { GitHubAdapter, type EnrichBatchOptions } from './github-adapter.js';
export {
  GitHubClient,
  GitHubApiError,
  type GitHubUser,
  type GitHubRepo,
  type GitHubCommit,
  type GitHubEvent,
  type RateLimitHeaders,
  type ApiResponse,
} from './github-client.js';
export {
  extractEmailsFromCommits,
  computeLanguageDistribution,
  computeLanguageTrends,
  computeOssRatio,
  computeCommitFrequency,
  buildContributionTrends,
  buildProfileEvidence,
  type LanguageStat,
  type LanguageTrend,
  type CommitFrequency,
} from './parsers.js';
