// Identity resolution — deduplicates RawCandidates into canonical Candidates

import { createHash } from 'node:crypto';
import type {
  ObservedIdentifier,
  PersonIdentity,
  ConfidenceLevel,
} from './identity.js';
import type {
  RawCandidate,
  Candidate,
  SourceData,
  PIIField,
} from './candidate.js';
import type { EvidenceItem } from './evidence.js';

// --- Public Types ---

export type MergeRule =
  | 'linkedin_url'
  | 'verified_email'
  | 'github_username'
  | 'cross_source_email'
  | 'name_company'
  | 'similar_name_company';

export interface MergeReason {
  rule: MergeRule;
  confidence: ConfidenceLevel;
  matchedValues: [string, string];
  description: string;
}

export interface MergeDecision {
  clusterIndexA: number;
  clusterIndexB: number;
  reason: MergeReason;
  automatic: boolean;
}

export interface PendingMerge {
  candidateA: { name: string; identifiers: ObservedIdentifier[] };
  candidateB: { name: string; identifiers: ObservedIdentifier[] };
  reason: MergeReason;
}

export interface ResolveResult {
  candidates: Candidate[];
  mergeLog: MergeDecision[];
  pendingMerges: PendingMerge[];
  stats: {
    inputCount: number;
    outputCount: number;
    highConfidenceMerges: number;
    mediumConfidenceMerges: number;
    lowConfidenceMerges: number;
  };
}

// --- Internal Types ---

interface CandidateCluster {
  rawCandidates: RawCandidate[];
  allIdentifiers: ObservedIdentifier[];
  merged: boolean;
}

// --- Normalization ---

export function normalizeLinkedInUrl(url: string): string {
  let n = url.toLowerCase().trim();
  n = n.replace(/^https?:\/\//, '');
  n = n.replace(/^www\./, '');
  n = n.replace(/\?.*$/, '');
  n = n.replace(/\/+$/, '');
  const match = n.match(/^linkedin\.com\/in\/(.+)/);
  if (match) {
    n = `linkedin.com/in/${match[1].replace(/-/g, '')}`;
  }
  return n;
}

export function normalizeEmail(email: string): string {
  let n = email.toLowerCase().trim();
  const atIndex = n.indexOf('@');
  if (atIndex === -1) return n;
  let local = n.slice(0, atIndex);
  const domain = n.slice(atIndex + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '').replace(/\+.*$/, '');
    return `${local}@gmail.com`;
  }
  return n;
}

export function normalizeGitHubUsername(username: string): string {
  let n = username.toLowerCase().trim();
  n = n.replace(/^https?:\/\/(www\.)?github\.com\//, '');
  n = n.replace(/^@/, '');
  n = n.replace(/\/+$/, '');
  return n;
}

export function normalizeTwitterHandle(handle: string): string {
  let n = handle.toLowerCase().trim();
  n = n.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//, '');
  n = n.replace(/^@/, '');
  n = n.replace(/\/+$/, '');
  return n;
}

export function normalizeIdentifierValue(id: ObservedIdentifier): string {
  switch (id.type) {
    case 'linkedin_url':
      return normalizeLinkedInUrl(id.value);
    case 'email':
      return normalizeEmail(id.value);
    case 'github_username':
      return normalizeGitHubUsername(id.value);
    case 'twitter_handle':
      return normalizeTwitterHandle(id.value);
    case 'personal_url':
      return id.value.toLowerCase().trim().replace(/\/+$/, '');
    case 'name_company':
      return id.value.toLowerCase().trim();
  }
}

// --- Name/Company Matching ---

export function namesMatch(a: string, b: string): boolean {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return true;
  const partsA = na.split(/\s+/).sort();
  const partsB = nb.split(/\s+/).sort();
  return partsA.join(' ') === partsB.join(' ');
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function namesSimilar(a: string, b: string): boolean {
  if (namesMatch(a, b)) return true;
  return levenshtein(a.toLowerCase().trim(), b.toLowerCase().trim()) <= 2;
}

function extractFromNameCompany(value: string): { name: string; company: string } {
  const parts = value.split('|');
  return {
    name: (parts[0] ?? '').trim().toLowerCase(),
    company: (parts[1] ?? '').trim().toLowerCase(),
  };
}

function getClusterNames(cluster: CandidateCluster): string[] {
  const names = new Set<string>();
  for (const raw of cluster.rawCandidates) {
    names.add(raw.name.toLowerCase().trim());
  }
  for (const id of cluster.allIdentifiers) {
    if (id.type === 'name_company') {
      const { name } = extractFromNameCompany(id.value);
      if (name) names.add(name);
    }
  }
  return [...names];
}

function getClusterCompanies(cluster: CandidateCluster): string[] {
  const companies = new Set<string>();
  for (const id of cluster.allIdentifiers) {
    if (id.type === 'name_company') {
      const { company } = extractFromNameCompany(id.value);
      if (company) companies.add(company);
    }
  }
  return [...companies];
}

function getClusterAdapters(cluster: CandidateCluster): Set<string> {
  return new Set(cluster.rawCandidates.map((r) => r.sourceData.adapter));
}

// --- Canonical ID Generation ---

function generateCanonicalId(identifiers: ObservedIdentifier[]): string {
  // Filter to stable identifiers (exclude name_company which is too volatile)
  let stable = identifiers.filter((id) => id.type !== 'name_company');

  // Fallback: if no stable identifiers, use name_company
  if (stable.length === 0) {
    stable = identifiers;
  }

  // Normalize, deduplicate, sort
  const normalized = stable.map((id) => ({
    type: id.type,
    value: normalizeIdentifierValue(id),
  }));

  const unique = [
    ...new Map(normalized.map((n) => [`${n.type}:${n.value}`, n])).values(),
  ];

  unique.sort((a, b) =>
    a.type !== b.type
      ? a.type.localeCompare(b.type)
      : a.value.localeCompare(b.value),
  );

  const canonical = unique.map((n) => `${n.type}=${n.value}`).join('|');
  const hash = createHash('sha256').update(canonical).digest('hex');

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

// --- Cluster to Candidate ---

function chooseBestName(cluster: CandidateCluster): string {
  // Count name frequencies, pick most common
  const counts = new Map<string, number>();
  for (const raw of cluster.rawCandidates) {
    const n = raw.name.trim();
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  let best = cluster.rawCandidates[0].name;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

function clusterToCandidate(
  cluster: CandidateCluster,
  lowConfidenceMerge = false,
): Candidate {
  const allIdentifiers = cluster.allIdentifiers;
  const canonicalId = generateCanonicalId(allIdentifiers);

  const sources: Record<string, SourceData> = {};
  for (const raw of cluster.rawCandidates) {
    sources[raw.sourceData.adapter] = raw.sourceData;
  }

  const evidenceMap = new Map<string, EvidenceItem>();
  for (const raw of cluster.rawCandidates) {
    for (const ev of raw.evidence) {
      evidenceMap.set(ev.id, ev);
    }
  }

  const piiFields: PIIField[] = [];
  for (const raw of cluster.rawCandidates) {
    piiFields.push(...raw.piiFields);
  }

  const wasMerged = cluster.rawCandidates.length > 1;
  const mergeConfidence = !wasMerged ? 1.0 : lowConfidenceMerge ? 0.7 : 0.95;

  const identity: PersonIdentity = {
    canonicalId,
    observedIdentifiers: allIdentifiers,
    mergedFrom: wasMerged
      ? cluster.rawCandidates.map((r) => r.sourceData.adapter)
      : undefined,
    mergeConfidence,
    ...(lowConfidenceMerge ? { lowConfidenceMerge: true } : {}),
  };

  return {
    id: canonicalId,
    identity,
    name: chooseBestName(cluster),
    sources,
    evidence: [...evidenceMap.values()],
    enrichments: {},
    pii: { fields: piiFields, retentionPolicy: 'default' },
  };
}

// --- The Resolver ---

export class IdentityResolver {
  resolve(rawCandidates: RawCandidate[]): ResolveResult {
    if (rawCandidates.length === 0) {
      return {
        candidates: [],
        mergeLog: [],
        pendingMerges: [],
        stats: {
          inputCount: 0,
          outputCount: 0,
          highConfidenceMerges: 0,
          mediumConfidenceMerges: 0,
          lowConfidenceMerges: 0,
        },
      };
    }

    // Build initial clusters (one per RawCandidate)
    let clusters: CandidateCluster[] = rawCandidates.map((raw) => ({
      rawCandidates: [raw],
      allIdentifiers: [...raw.identifiers],
      merged: false,
    }));

    const mergeLog: MergeDecision[] = [];
    const pendingMerges: PendingMerge[] = [];
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;

    // Pass 1: High-confidence merges (LinkedIn, email, GitHub)
    const pass1Decisions = this.findHighConfidenceMerges(clusters);
    for (const decision of pass1Decisions) {
      clusters = this.applyMerge(clusters, decision);
      mergeLog.push(decision);
      highCount++;
    }

    // Pass 2: Cross-source email linking
    const pass2Decisions = this.findCrossSourceEmailMerges(clusters);
    for (const decision of pass2Decisions) {
      clusters = this.applyMerge(clusters, decision);
      mergeLog.push(decision);
      highCount++;
    }

    // Pass 3: Medium-confidence (same name + same company, different sources)
    const pass3Decisions = this.findMediumConfidenceMerges(clusters);
    for (const decision of pass3Decisions) {
      clusters = this.applyMerge(clusters, decision);
      mergeLog.push(decision);
      mediumCount++;
    }

    // Pass 4: Low-confidence (similar name + similar company) — auto-merge with flag
    const pass4Decisions = this.findLowConfidenceMergeDecisions(clusters);
    const lowConfidenceMergedClusters = new Set<number>();
    for (const decision of pass4Decisions) {
      lowConfidenceMergedClusters.add(decision.clusterIndexA);
      clusters = this.applyMerge(clusters, decision);
      mergeLog.push(decision);
      lowCount++;
    }

    // Build final candidates from surviving clusters
    const activeClusters = clusters.filter((c) => !c.merged);
    const candidates = activeClusters.map((c, idx) => {
      const originalIdx = clusters.indexOf(c);
      const isLowConfidence = lowConfidenceMergedClusters.has(originalIdx);
      return clusterToCandidate(c, isLowConfidence);
    });

    return {
      candidates,
      mergeLog,
      pendingMerges,
      stats: {
        inputCount: rawCandidates.length,
        outputCount: candidates.length,
        highConfidenceMerges: highCount,
        mediumConfidenceMerges: mediumCount,
        lowConfidenceMerges: lowCount,
      },
    };
  }

  // --- Pass 1: High-confidence index-based merges ---

  private findHighConfidenceMerges(
    clusters: CandidateCluster[],
  ): MergeDecision[] {
    const decisions: MergeDecision[] = [];
    const typesToCheck: Array<{
      type: ObservedIdentifier['type'];
      rule: MergeRule;
    }> = [
      { type: 'linkedin_url', rule: 'linkedin_url' },
      { type: 'email', rule: 'verified_email' },
      { type: 'github_username', rule: 'github_username' },
    ];

    for (const { type, rule } of typesToCheck) {
      const index = new Map<string, number[]>();

      for (let i = 0; i < clusters.length; i++) {
        if (clusters[i].merged) continue;
        for (const id of clusters[i].allIdentifiers) {
          if (id.type !== type) continue;
          const normalized = normalizeIdentifierValue(id);
          const existing = index.get(normalized);
          if (existing) {
            if (!existing.includes(i)) existing.push(i);
          } else {
            index.set(normalized, [i]);
          }
        }
      }

      for (const [value, clusterIndices] of index) {
        if (clusterIndices.length < 2) continue;
        // Merge all into the first
        for (let k = 1; k < clusterIndices.length; k++) {
          const idxA = clusterIndices[0];
          const idxB = clusterIndices[k];
          if (clusters[idxB].merged) continue;
          decisions.push({
            clusterIndexA: idxA,
            clusterIndexB: idxB,
            reason: {
              rule,
              confidence: 'high',
              matchedValues: [value, value],
              description: `Matching ${type}: ${value}`,
            },
            automatic: true,
          });
        }
      }
    }

    return decisions;
  }

  // --- Pass 2: Cross-source email linking ---

  private findCrossSourceEmailMerges(
    clusters: CandidateCluster[],
  ): MergeDecision[] {
    const decisions: MergeDecision[] = [];
    // Index: normalized email → [{clusterIndex, adapters}]
    const emailIndex = new Map<
      string,
      { clusterIdx: number; adapters: Set<string> }[]
    >();

    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].merged) continue;
      for (const id of clusters[i].allIdentifiers) {
        if (id.type !== 'email') continue;
        const normalized = normalizeEmail(id.value);
        const entries = emailIndex.get(normalized) ?? [];
        const existing = entries.find((e) => e.clusterIdx === i);
        if (existing) {
          existing.adapters.add(id.source);
        } else {
          entries.push({ clusterIdx: i, adapters: new Set([id.source]) });
        }
        emailIndex.set(normalized, entries);
      }
    }

    for (const [email, entries] of emailIndex) {
      if (entries.length < 2) continue;
      // Check that entries come from different adapters
      const allAdapters = new Set<string>();
      for (const e of entries) {
        for (const a of e.adapters) allAdapters.add(a);
      }
      if (allAdapters.size < 2) continue;

      for (let k = 1; k < entries.length; k++) {
        const idxA = entries[0].clusterIdx;
        const idxB = entries[k].clusterIdx;
        if (idxA === idxB || clusters[idxB].merged) continue;
        decisions.push({
          clusterIndexA: idxA,
          clusterIndexB: idxB,
          reason: {
            rule: 'cross_source_email',
            confidence: 'high',
            matchedValues: [email, email],
            description: `Same email from different adapters: ${email}`,
          },
          automatic: true,
        });
      }
    }

    return decisions;
  }

  // --- Pass 3: Medium-confidence (name + company) ---

  private findMediumConfidenceMerges(
    clusters: CandidateCluster[],
  ): MergeDecision[] {
    const decisions: MergeDecision[] = [];

    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].merged) continue;
      for (let j = i + 1; j < clusters.length; j++) {
        if (clusters[j].merged) continue;

        // Must be from different adapters
        const adaptersA = getClusterAdapters(clusters[i]);
        const adaptersB = getClusterAdapters(clusters[j]);
        let hasDifferentAdapter = false;
        for (const a of adaptersB) {
          if (!adaptersA.has(a)) {
            hasDifferentAdapter = true;
            break;
          }
        }
        if (!hasDifferentAdapter) continue;

        const namesA = getClusterNames(clusters[i]);
        const namesB = getClusterNames(clusters[j]);
        const companiesA = getClusterCompanies(clusters[i]);
        const companiesB = getClusterCompanies(clusters[j]);

        if (companiesA.length === 0 || companiesB.length === 0) continue;

        let nameMatch = false;
        for (const na of namesA) {
          for (const nb of namesB) {
            if (namesMatch(na, nb)) {
              nameMatch = true;
              break;
            }
          }
          if (nameMatch) break;
        }
        if (!nameMatch) continue;

        let companyMatch = false;
        let matchedCompany = '';
        for (const ca of companiesA) {
          for (const cb of companiesB) {
            if (ca === cb) {
              companyMatch = true;
              matchedCompany = ca;
              break;
            }
          }
          if (companyMatch) break;
        }
        if (!companyMatch) continue;

        decisions.push({
          clusterIndexA: i,
          clusterIndexB: j,
          reason: {
            rule: 'name_company',
            confidence: 'medium',
            matchedValues: [namesA[0], namesB[0]],
            description: `Same name + company (${matchedCompany})`,
          },
          automatic: true,
        });
      }
    }

    return decisions;
  }

  // --- Pass 4: Low-confidence (similar name + company) → auto-merge with flag ---

  private findLowConfidenceMergeDecisions(
    clusters: CandidateCluster[],
  ): MergeDecision[] {
    const decisions: MergeDecision[] = [];

    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].merged) continue;
      for (let j = i + 1; j < clusters.length; j++) {
        if (clusters[j].merged) continue;

        const namesA = getClusterNames(clusters[i]);
        const namesB = getClusterNames(clusters[j]);
        const companiesA = getClusterCompanies(clusters[i]);
        const companiesB = getClusterCompanies(clusters[j]);

        if (companiesA.length === 0 || companiesB.length === 0) continue;

        let similarName = false;
        for (const na of namesA) {
          for (const nb of namesB) {
            if (namesSimilar(na, nb) && !namesMatch(na, nb)) {
              similarName = true;
              break;
            }
          }
          if (similarName) break;
        }
        if (!similarName) continue;

        let similarCompany = false;
        for (const ca of companiesA) {
          for (const cb of companiesB) {
            if (levenshtein(ca, cb) <= 3 && ca !== cb) {
              similarCompany = true;
              break;
            }
          }
          if (similarCompany) break;
        }
        if (!similarCompany) continue;

        decisions.push({
          clusterIndexA: i,
          clusterIndexB: j,
          reason: {
            rule: 'similar_name_company',
            confidence: 'low',
            matchedValues: [namesA[0], namesB[0]],
            description: 'Similar name + similar company',
          },
          automatic: true,
        });
      }
    }

    return decisions;
  }

  // --- Merge Application ---

  private applyMerge(
    clusters: CandidateCluster[],
    decision: MergeDecision,
  ): CandidateCluster[] {
    const { clusterIndexA, clusterIndexB } = decision;
    if (clusters[clusterIndexB].merged) return clusters;

    // Merge B into A
    const a = clusters[clusterIndexA];
    const b = clusters[clusterIndexB];

    a.rawCandidates.push(...b.rawCandidates);
    a.allIdentifiers.push(...b.allIdentifiers);
    b.merged = true;

    return clusters;
  }
}
