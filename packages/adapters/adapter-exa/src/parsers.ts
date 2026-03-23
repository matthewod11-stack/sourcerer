// Parse Exa search results into Sourcerer types

import {
  generateEvidenceId,
  type RawCandidate,
  type ObservedIdentifier,
  type EvidenceItem,
  type PIIField,
  type SourceData,
  type ConfidenceLevel,
} from '@sourcerer/core';

// --- Identifier Extraction ---

const LINKEDIN_RE = /linkedin\.com\/in\/([\w-]+)/gi;
const GITHUB_RE = /github\.com\/([\w-]+)/gi;
const TWITTER_RE = /(?:twitter|x)\.com\/([\w]+)/gi;
const EMAIL_RE = /[\w.+-]+@[\w.-]+\.\w{2,}/gi;

const SOCIAL_DOMAINS = ['linkedin.com', 'github.com', 'twitter.com', 'x.com'];

function isSocialUrl(url: string): boolean {
  return SOCIAL_DOMAINS.some((d) => url.toLowerCase().includes(d));
}

export function extractIdentifiers(
  url: string,
  text: string,
  adapter: string,
  observedAt: string,
): ObservedIdentifier[] {
  const identifiers: ObservedIdentifier[] = [];
  const combined = `${url} ${text}`;

  // LinkedIn URLs
  for (const match of combined.matchAll(LINKEDIN_RE)) {
    identifiers.push({
      type: 'linkedin_url',
      value: `https://linkedin.com/in/${match[1]}`,
      source: adapter,
      observedAt,
      confidence: 'high',
    });
  }

  // GitHub usernames
  for (const match of combined.matchAll(GITHUB_RE)) {
    const username = match[1].toLowerCase();
    if (!['features', 'about', 'pricing', 'blog', 'docs', 'settings', 'topics'].includes(username)) {
      identifiers.push({
        type: 'github_username',
        value: username,
        source: adapter,
        observedAt,
        confidence: 'high',
      });
    }
  }

  // Twitter/X handles
  for (const match of combined.matchAll(TWITTER_RE)) {
    const handle = match[1].toLowerCase();
    if (!['home', 'search', 'explore', 'settings', 'i'].includes(handle)) {
      identifiers.push({
        type: 'twitter_handle',
        value: handle,
        source: adapter,
        observedAt,
        confidence: 'medium',
      });
    }
  }

  // Emails
  for (const match of combined.matchAll(EMAIL_RE)) {
    identifiers.push({
      type: 'email',
      value: match[0].toLowerCase(),
      source: adapter,
      observedAt,
      confidence: 'medium',
    });
  }

  // Personal URL (the result URL itself, if not a social platform)
  if (!isSocialUrl(url)) {
    identifiers.push({
      type: 'personal_url',
      value: url,
      source: adapter,
      observedAt,
      confidence: 'medium',
    });
  }

  // Deduplicate by type+value
  const seen = new Set<string>();
  return identifiers.filter((id) => {
    const key = `${id.type}:${id.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractEmails(text: string): string[] {
  const matches = text.matchAll(EMAIL_RE);
  const emails = new Set<string>();
  for (const m of matches) {
    emails.add(m[0].toLowerCase());
  }
  return [...emails];
}

// --- Result Parsing ---

export interface ExaResult {
  title: string | null;
  url: string;
  text?: string;
  publishedDate?: string;
  author?: string;
  score?: number;
  id: string;
}

export function parseExaResult(
  result: ExaResult,
  queryContext: string,
  similaritySeedUrl?: string,
): RawCandidate {
  const now = new Date().toISOString();
  const text = result.text ?? '';
  const title = result.title ?? '';

  // Extract name heuristic: prefer author, then title (if it looks like a name)
  const name = extractName(result.author, title, result.url);

  // Identifiers
  const identifiers = extractIdentifiers(result.url, text, 'exa', now);

  // Evidence
  const evidence: EvidenceItem[] = [];

  // Main discovery evidence
  const claim = similaritySeedUrl
    ? `Found via similarity to ${similaritySeedUrl}: ${title}`
    : `Found via Exa search "${queryContext}": ${title}`;

  evidence.push({
    id: generateEvidenceId({ adapter: 'exa', source: result.url, claim, retrievedAt: now }),
    claim,
    source: result.url,
    adapter: 'exa',
    retrievedAt: now,
    confidence: 'medium',
    url: result.url,
  });

  // If text has substantial content, add as additional evidence
  if (text.length > 100) {
    const snippet = text.slice(0, 200).replace(/\n/g, ' ').trim();
    const contentClaim = `Page content: ${snippet}`;
    evidence.push({
      id: generateEvidenceId({ adapter: 'exa', source: result.url, claim: contentClaim, retrievedAt: now }),
      claim: contentClaim,
      source: result.url,
      adapter: 'exa',
      retrievedAt: now,
      confidence: 'medium',
      url: result.url,
    });
  }

  // PII fields
  const piiFields: PIIField[] = extractEmails(text).map((email) => ({
    value: email,
    type: 'email' as const,
    adapter: 'exa',
    collectedAt: now,
  }));

  // Source data
  const sourceData: SourceData = {
    adapter: 'exa',
    retrievedAt: now,
    urls: [result.url],
    rawProfile: {
      title,
      text: text.slice(0, 5000),
      score: result.score,
      publishedDate: result.publishedDate,
      author: result.author,
      exaId: result.id,
    },
  };

  return {
    name,
    identifiers,
    sourceData,
    evidence,
    piiFields,
  };
}

function extractName(author: string | undefined, title: string, url: string): string {
  // Prefer explicit author
  if (author && author.trim().length > 0 && author.length < 60) {
    return author.trim();
  }

  // Try title — if it looks like a personal page title (short, no special chars)
  if (title && title.length < 50 && /^[A-Z][\w\s.'-]+$/.test(title)) {
    return title.trim();
  }

  // Fallback to URL-derived name
  const linkedinMatch = url.match(/linkedin\.com\/in\/([\w-]+)/);
  if (linkedinMatch) {
    return linkedinMatch[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const githubMatch = url.match(/github\.com\/([\w-]+)/);
  if (githubMatch) {
    return githubMatch[1];
  }

  return title || 'Unknown';
}
