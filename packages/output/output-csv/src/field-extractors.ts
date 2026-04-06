// Pure functions to extract flattened fields from ScoredCandidate

import type { ScoredCandidate, SourceData } from '@sourcerer/core';

/** Extract current role from rawProfile across all sources */
export function extractCurrentRole(sources: Record<string, SourceData>): string {
  for (const sourceData of Object.values(sources)) {
    if (sourceData.rawProfile) {
      const title = sourceData.rawProfile['title'] ?? sourceData.rawProfile['role'];
      if (typeof title === 'string' && title.length > 0) {
        return title;
      }
    }
  }
  return '';
}

/** Extract company from rawProfile across all sources */
export function extractCompany(sources: Record<string, SourceData>): string {
  for (const sourceData of Object.values(sources)) {
    if (sourceData.rawProfile) {
      const company = sourceData.rawProfile['company'];
      if (typeof company === 'string' && company.length > 0) {
        return company;
      }
    }
  }
  return '';
}

/** Extract email from PII fields or observed identifiers */
export function extractEmail(candidate: ScoredCandidate): string {
  // Try PII fields first
  const piiEmail = candidate.pii.fields.find((f) => f.type === 'email');
  if (piiEmail) {
    return piiEmail.value;
  }

  // Fall back to observed identifiers
  const identEmail = candidate.identity.observedIdentifiers.find(
    (id) => id.type === 'email',
  );
  if (identEmail) {
    return identEmail.value;
  }

  return '';
}

/** Extract top N signals from score breakdown, sorted by weighted descending */
export function extractTopSignals(
  candidate: ScoredCandidate,
  count: number,
): string[] {
  const sorted = [...candidate.score.breakdown].sort(
    (a, b) => b.weighted - a.weighted,
  );
  return sorted.slice(0, count).map((sc) => `${sc.dimension}: ${sc.raw}`);
}

/** Truncate narrative to maxLength chars, appending '...' if truncated */
export function truncateNarrative(
  narrative: string,
  maxLength: number,
): string {
  if (narrative.length <= maxLength) {
    return narrative;
  }
  return narrative.slice(0, maxLength) + '...';
}

/** Extract LinkedIn URL from observed identifiers */
export function extractLinkedInUrl(candidate: ScoredCandidate): string {
  const linkedin = candidate.identity.observedIdentifiers.find(
    (id) => id.type === 'linkedin_url',
  );
  return linkedin ? linkedin.value : '';
}

/** Extract GitHub URL from observed identifiers (formats username into URL) */
export function extractGitHubUrl(candidate: ScoredCandidate): string {
  const github = candidate.identity.observedIdentifiers.find(
    (id) => id.type === 'github_username',
  );
  return github ? `https://github.com/${github.value}` : '';
}
