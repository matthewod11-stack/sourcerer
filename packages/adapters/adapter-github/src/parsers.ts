// Parse GitHub API responses into Sourcerer types

import {
  computeRetentionExpiresAt,
  generateEvidenceId,
  type EvidenceItem,
  type PIIField,
  type SourceData,
} from '@sourcerer/core';
import type { GitHubUser, GitHubRepo, GitHubCommit, GitHubEvent } from './github-client.js';

// --- Email Extraction ---

const NOREPLY_PATTERNS = [
  /@users\.noreply\.github\.com$/i,
  /^noreply@/i,
  /^no-reply@/i,
];

const PERSONAL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'protonmail.com', 'proton.me',
  'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'me.com',
];

function isNoreply(email: string): boolean {
  return NOREPLY_PATTERNS.some((p) => p.test(email));
}

function isPersonalEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return PERSONAL_DOMAINS.includes(domain);
}

export function extractEmailsFromCommits(commits: GitHubCommit[]): string[] {
  const emailCounts = new Map<string, number>();

  for (const commit of commits) {
    const email = commit.commit.author.email?.toLowerCase().trim();
    if (!email || isNoreply(email)) continue;
    emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }

  // Sort: personal emails first, then by frequency
  return [...emailCounts.entries()]
    .sort((a, b) => {
      const aPersonal = isPersonalEmail(a[0]) ? 0 : 1;
      const bPersonal = isPersonalEmail(b[0]) ? 0 : 1;
      if (aPersonal !== bPersonal) return aPersonal - bPersonal;
      return b[1] - a[1]; // higher frequency first
    })
    .map(([email]) => email);
}

// --- Language Distribution ---

export interface LanguageStat {
  language: string;
  count: number;
  percentage: number;
}

export interface LanguageTrend {
  language: string;
  recentCount: number;
  olderCount: number;
  trend: 'growing' | 'declining' | 'stable';
}

export function computeLanguageDistribution(
  repos: GitHubRepo[],
  options?: { trendWindowMonths?: number },
): LanguageStat[] {
  const counts = new Map<string, number>();
  let total = 0;

  for (const repo of repos) {
    if (repo.language && !repo.fork) {
      counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
      total++;
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([language, count]) => ({
      language,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }));
}

/**
 * Compute language trends over time by comparing recent vs older repos.
 * Uses pushed_at or created_at dates to split repos into recent vs older windows.
 */
export function computeLanguageTrends(
  repos: GitHubRepo[],
  windowMonths = 6,
): LanguageTrend[] {
  const now = Date.now();
  const cutoff = now - windowMonths * 30 * 24 * 60 * 60 * 1000;

  const recentCounts = new Map<string, number>();
  const olderCounts = new Map<string, number>();

  for (const repo of repos) {
    if (!repo.language || repo.fork) continue;

    const dateStr = repo.pushed_at ?? repo.updated_at;
    const repoTime = new Date(dateStr).getTime();

    if (repoTime >= cutoff) {
      recentCounts.set(repo.language, (recentCounts.get(repo.language) ?? 0) + 1);
    } else {
      olderCounts.set(repo.language, (olderCounts.get(repo.language) ?? 0) + 1);
    }
  }

  const allLangs = new Set([...recentCounts.keys(), ...olderCounts.keys()]);
  const trends: LanguageTrend[] = [];

  for (const language of allLangs) {
    const recentCount = recentCounts.get(language) ?? 0;
    const olderCount = olderCounts.get(language) ?? 0;

    let trend: 'growing' | 'declining' | 'stable';
    if (recentCount > olderCount) {
      trend = 'growing';
    } else if (recentCount < olderCount) {
      trend = 'declining';
    } else {
      trend = 'stable';
    }

    trends.push({ language, recentCount, olderCount, trend });
  }

  return trends.sort((a, b) => (b.recentCount + b.olderCount) - (a.recentCount + a.olderCount));
}

// --- OSS Ratio ---

/**
 * Calculate ratio of original (non-fork) repos to total repos.
 * Returns a number between 0 and 1.
 */
export function computeOssRatio(repos: GitHubRepo[]): number {
  if (repos.length === 0) return 0;
  const originalCount = repos.filter((r) => !r.fork).length;
  return originalCount / repos.length;
}

// --- Commit Frequency ---

export interface CommitFrequency {
  commitsPerWeek: number;
  commitsPerMonth: number;
  totalEvents: number;
  activeWeeks: number;
  spanWeeks: number;
  status: 'active' | 'moderate' | 'dormant';
}

/**
 * Given user events (from /users/:user/events), compute commit frequency metrics.
 * Detects active vs dormant accounts based on push event frequency.
 */
export function computeCommitFrequency(events: GitHubEvent[]): CommitFrequency {
  const pushEvents = events.filter((e) => e.type === 'PushEvent');

  if (pushEvents.length === 0) {
    return {
      commitsPerWeek: 0,
      commitsPerMonth: 0,
      totalEvents: 0,
      activeWeeks: 0,
      spanWeeks: 0,
      status: 'dormant',
    };
  }

  // Count total commits from push events
  let totalCommits = 0;
  const weekSet = new Set<string>();

  for (const event of pushEvents) {
    const commitCount = event.payload?.size ?? event.payload?.commits?.length ?? 1;
    totalCommits += commitCount;

    // Track unique ISO weeks for active weeks count
    const date = new Date(event.created_at);
    const yearWeek = `${date.getFullYear()}-W${Math.ceil(((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7)}`;
    weekSet.add(yearWeek);
  }

  // Calculate time span
  const dates = pushEvents.map((e) => new Date(e.created_at).getTime());
  const oldest = Math.min(...dates);
  const newest = Math.max(...dates);
  const spanMs = newest - oldest;
  const spanWeeks = Math.max(1, Math.ceil(spanMs / (7 * 24 * 60 * 60 * 1000)));

  const commitsPerWeek = Math.round((totalCommits / spanWeeks) * 10) / 10;
  const commitsPerMonth = Math.round((totalCommits / spanWeeks) * 4.33 * 10) / 10;

  let status: 'active' | 'moderate' | 'dormant';
  if (commitsPerWeek >= 5) {
    status = 'active';
  } else if (commitsPerWeek >= 1) {
    status = 'moderate';
  } else {
    status = 'dormant';
  }

  return {
    commitsPerWeek,
    commitsPerMonth,
    totalEvents: totalCommits,
    activeWeeks: weekSet.size,
    spanWeeks,
    status,
  };
}

// --- Contribution Trends Evidence ---

/**
 * Build additional evidence items for OSS ratio, commit frequency, and language trends.
 */
export function buildContributionTrends(
  repos: GitHubRepo[],
  events: GitHubEvent[],
  profileUrl: string,
): EvidenceItem[] {
  const now = new Date().toISOString();
  const evidence: EvidenceItem[] = [];

  // OSS ratio evidence
  const ossRatio = computeOssRatio(repos);
  if (repos.length > 0) {
    const originalCount = repos.filter((r) => !r.fork).length;
    const ossClaim = `OSS ratio: ${originalCount}/${repos.length} repos are original (${Math.round(ossRatio * 100)}%)`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'github', source: profileUrl, claim: ossClaim, retrievedAt: now }),
      claim: ossClaim,
      source: profileUrl,
      adapter: 'github',
      retrievedAt: now,
      confidence: 'high',
      url: profileUrl,
    });
  }

  // Commit frequency evidence
  const frequency = computeCommitFrequency(events);
  if (frequency.totalEvents > 0) {
    const freqClaim = `Commit frequency: ${frequency.commitsPerWeek}/week (${frequency.status}), ${frequency.activeWeeks} active weeks over ${frequency.spanWeeks}-week span`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'github', source: profileUrl, claim: freqClaim, retrievedAt: now }),
      claim: freqClaim,
      source: profileUrl,
      adapter: 'github',
      retrievedAt: now,
      confidence: 'medium',
      url: profileUrl,
    });
  }

  // Language trend evidence
  const trends = computeLanguageTrends(repos);
  const growing = trends.filter((t) => t.trend === 'growing');
  if (growing.length > 0) {
    const trendLangs = growing.map((t) => t.language).join(', ');
    const trendClaim = `Language trends: growing activity in ${trendLangs}`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'github', source: profileUrl, claim: trendClaim, retrievedAt: now }),
      claim: trendClaim,
      source: profileUrl,
      adapter: 'github',
      retrievedAt: now,
      confidence: 'medium',
      url: profileUrl,
    });
  }

  return evidence;
}

// --- Evidence Generation ---

export function buildProfileEvidence(
  user: GitHubUser,
  repos: GitHubRepo[],
  languages: LanguageStat[],
  emails: string[],
  commitCount: number,
  /**
   * Optional retention TTL in days. When provided, every PIIField produced
   * here is stamped with `retentionExpiresAt = now + ttlDays`. H-2.
   */
  retentionTtlDays?: number,
): { evidence: EvidenceItem[]; piiFields: PIIField[]; sourceData: SourceData } {
  const now = new Date().toISOString();
  const profileUrl = user.html_url;
  const evidence: EvidenceItem[] = [];
  const retentionExpiresAt =
    retentionTtlDays !== undefined ? computeRetentionExpiresAt(now, retentionTtlDays) : undefined;

  // Profile overview
  const profileClaim = `GitHub profile: ${user.public_repos} public repos, ${user.followers} followers, member since ${user.created_at.slice(0, 4)}`;
  evidence.push({
    id: generateEvidenceId({ adapter: 'github', source: profileUrl, claim: profileClaim, retrievedAt: now }),
    claim: profileClaim,
    source: profileUrl,
    adapter: 'github',
    retrievedAt: now,
    confidence: 'high',
    url: profileUrl,
  });

  // Bio
  if (user.bio) {
    const bioClaim = `GitHub bio: "${user.bio}"`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'github', source: profileUrl, claim: bioClaim, retrievedAt: now }),
      claim: bioClaim,
      source: profileUrl,
      adapter: 'github',
      retrievedAt: now,
      confidence: 'high',
      url: profileUrl,
    });
  }

  // Top languages
  if (languages.length > 0) {
    const langList = languages.map((l) => `${l.language} (${l.percentage}%)`).join(', ');
    const langClaim = `Top languages: ${langList}`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'github', source: profileUrl, claim: langClaim, retrievedAt: now }),
      claim: langClaim,
      source: profileUrl,
      adapter: 'github',
      retrievedAt: now,
      confidence: 'high',
    });
  }

  // Commit activity
  if (commitCount > 0) {
    const activityClaim = `${commitCount} recent commits across top repos`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'github', source: profileUrl, claim: activityClaim, retrievedAt: now }),
      claim: activityClaim,
      source: profileUrl,
      adapter: 'github',
      retrievedAt: now,
      confidence: 'medium',
    });
  }

  // Top repos by stars
  const starredRepos = repos.filter((r) => !r.fork && r.stargazers_count > 0).slice(0, 3);
  for (const repo of starredRepos) {
    const repoClaim = `Repo: ${repo.full_name} (${repo.language ?? 'unknown'}, ${repo.stargazers_count} stars)`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'github', source: repo.html_url, claim: repoClaim, retrievedAt: now }),
      claim: repoClaim,
      source: repo.html_url,
      adapter: 'github',
      retrievedAt: now,
      confidence: 'high',
      url: repo.html_url,
    });
  }

  // Emails from commits as evidence + PII
  const piiFields: PIIField[] = [];
  for (const email of emails) {
    const emailClaim = `Email observed in commits: ${email}`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'github', source: profileUrl, claim: emailClaim, retrievedAt: now }),
      claim: emailClaim,
      source: profileUrl,
      adapter: 'github',
      retrievedAt: now,
      confidence: 'medium',
    });
    piiFields.push({
      value: email,
      type: 'email',
      adapter: 'github',
      collectedAt: now,
      retentionExpiresAt,
    });
  }

  // Public email from profile
  if (user.email && !emails.includes(user.email.toLowerCase())) {
    piiFields.push({
      value: user.email.toLowerCase(),
      type: 'email',
      adapter: 'github',
      collectedAt: now,
      retentionExpiresAt,
    });
  }

  const sourceData: SourceData = {
    adapter: 'github',
    retrievedAt: now,
    urls: [profileUrl],
    rawProfile: {
      login: user.login,
      name: user.name,
      bio: user.bio,
      company: user.company,
      location: user.location,
      public_repos: user.public_repos,
      followers: user.followers,
      topLanguages: languages,
      repoCount: repos.length,
    },
  };

  return { evidence, piiFields, sourceData };
}
