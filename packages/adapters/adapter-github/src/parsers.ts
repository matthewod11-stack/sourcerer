// Parse GitHub API responses into Sourcerer types

import {
  generateEvidenceId,
  type EvidenceItem,
  type PIIField,
  type SourceData,
} from '@sourcerer/core';
import type { GitHubUser, GitHubRepo, GitHubCommit } from './github-client.js';

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

export function computeLanguageDistribution(repos: GitHubRepo[]): LanguageStat[] {
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

// --- Evidence Generation ---

export function buildProfileEvidence(
  user: GitHubUser,
  repos: GitHubRepo[],
  languages: LanguageStat[],
  emails: string[],
  commitCount: number,
): { evidence: EvidenceItem[]; piiFields: PIIField[]; sourceData: SourceData } {
  const now = new Date().toISOString();
  const profileUrl = user.html_url;
  const evidence: EvidenceItem[] = [];

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
    });
  }

  // Public email from profile
  if (user.email && !emails.includes(user.email.toLowerCase())) {
    piiFields.push({
      value: user.email.toLowerCase(),
      type: 'email',
      adapter: 'github',
      collectedAt: now,
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
