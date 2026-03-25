// Parse X/Twitter API responses into Sourcerer evidence types

import {
  generateEvidenceId,
  type EvidenceItem,
} from '@sourcerer/core';
import type { XUser, XTweet } from './x-client.js';

// --- Technical content keywords ---

const TECHNICAL_KEYWORDS = [
  'shipped',
  'built',
  'deploy',
  'deployed',
  'architecture',
  'open source',
  'open-source',
  'pr',
  'merge',
  'merged',
  'release',
  'released',
  'refactor',
  'refactored',
  'api',
  'sdk',
  'framework',
  'kubernetes',
  'k8s',
  'docker',
  'ci/cd',
  'pipeline',
  'microservice',
  'backend',
  'frontend',
  'full-stack',
  'fullstack',
  'rust',
  'typescript',
  'python',
  'golang',
];

// Case-insensitive word-boundary match for technical keywords
function isTechnicalTweet(text: string): boolean {
  const lower = text.toLowerCase();
  return TECHNICAL_KEYWORDS.some((kw) => lower.includes(kw));
}

// --- Profile Evidence ---

export function buildProfileEvidence(user: XUser, profileUrl: string): EvidenceItem[] {
  const now = new Date().toISOString();
  const evidence: EvidenceItem[] = [];

  // Bio content
  if (user.description) {
    const bioClaim = `X bio: "${user.description}"`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'x', source: profileUrl, claim: bioClaim, retrievedAt: now }),
      claim: bioClaim,
      source: profileUrl,
      adapter: 'x',
      retrievedAt: now,
      confidence: 'high',
      url: profileUrl,
    });
  }

  // Follower count
  const followerClaim = `${user.public_metrics.followers_count} followers on X`;
  evidence.push({
    id: generateEvidenceId({ adapter: 'x', source: profileUrl, claim: followerClaim, retrievedAt: now }),
    claim: followerClaim,
    source: profileUrl,
    adapter: 'x',
    retrievedAt: now,
    confidence: 'high',
    url: profileUrl,
  });

  // Account age
  const createdYear = user.created_at.slice(0, 10);
  const ageClaim = `X account created ${createdYear}`;
  evidence.push({
    id: generateEvidenceId({ adapter: 'x', source: profileUrl, claim: ageClaim, retrievedAt: now }),
    claim: ageClaim,
    source: profileUrl,
    adapter: 'x',
    retrievedAt: now,
    confidence: 'high',
    url: profileUrl,
  });

  // Location
  if (user.location) {
    const locationClaim = `Location from X: ${user.location}`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'x', source: profileUrl, claim: locationClaim, retrievedAt: now }),
      claim: locationClaim,
      source: profileUrl,
      adapter: 'x',
      retrievedAt: now,
      confidence: 'medium',
      url: profileUrl,
    });
  }

  return evidence;
}

// --- Tweet Evidence ---

export function buildTweetEvidence(
  tweets: XTweet[],
  profileUrl: string,
  followerCount: number,
): EvidenceItem[] {
  const now = new Date().toISOString();
  const evidence: EvidenceItem[] = [];

  if (tweets.length === 0) {
    return evidence;
  }

  // Posting frequency
  const sortedByDate = [...tweets].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const oldest = new Date(sortedByDate[0].created_at);
  const newest = new Date(sortedByDate[sortedByDate.length - 1].created_at);
  const spanWeeks = Math.max((newest.getTime() - oldest.getTime()) / (7 * 24 * 60 * 60 * 1000), 1);
  const tweetsPerWeek = Math.round((tweets.length / spanWeeks) * 10) / 10;

  const freqClaim = `Posts ~${tweetsPerWeek} tweets per week on X`;
  evidence.push({
    id: generateEvidenceId({ adapter: 'x', source: profileUrl, claim: freqClaim, retrievedAt: now }),
    claim: freqClaim,
    source: profileUrl,
    adapter: 'x',
    retrievedAt: now,
    confidence: 'medium',
  });

  // Engagement rate
  if (followerCount > 0) {
    const totalEngagement = tweets.reduce(
      (sum, t) => sum + t.public_metrics.like_count + t.public_metrics.retweet_count,
      0,
    );
    const avgEngagement = totalEngagement / tweets.length;
    const engagementRate = Math.round((avgEngagement / followerCount) * 10000) / 100;

    const engClaim = `Average engagement rate of ${engagementRate}% on X`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'x', source: profileUrl, claim: engClaim, retrievedAt: now }),
      claim: engClaim,
      source: profileUrl,
      adapter: 'x',
      retrievedAt: now,
      confidence: 'medium',
    });
  }

  // Technical content detection
  const technicalTweets = tweets.filter((t) => isTechnicalTweet(t.text));
  if (technicalTweets.length > 0) {
    const pct = Math.round((technicalTweets.length / tweets.length) * 100);
    const techClaim = `${pct}% of recent X posts contain technical content (${technicalTweets.length}/${tweets.length} tweets)`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'x', source: profileUrl, claim: techClaim, retrievedAt: now }),
      claim: techClaim,
      source: profileUrl,
      adapter: 'x',
      retrievedAt: now,
      confidence: 'medium',
    });
  }

  // Recent activity
  const lastTweetDate = newest.toISOString().slice(0, 10);
  const activityClaim = `Last X post was ${lastTweetDate}`;
  evidence.push({
    id: generateEvidenceId({ adapter: 'x', source: profileUrl, claim: activityClaim, retrievedAt: now }),
    claim: activityClaim,
    source: profileUrl,
    adapter: 'x',
    retrievedAt: now,
    confidence: 'high',
  });

  return evidence;
}
