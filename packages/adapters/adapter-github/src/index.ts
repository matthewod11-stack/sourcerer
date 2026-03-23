// @sourcerer/adapter-github — GitHub enrichment adapter

export { GitHubAdapter } from './github-adapter.js';
export { GitHubClient, GitHubApiError, type GitHubUser, type GitHubRepo, type GitHubCommit } from './github-client.js';
export { extractEmailsFromCommits, computeLanguageDistribution, buildProfileEvidence } from './parsers.js';
