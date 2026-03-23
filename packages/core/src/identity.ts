// Identity resolution types — PersonIdentity and observed identifiers across sources

/** Types of identifiers observed across data sources */
export type IdentifierType =
  | 'linkedin_url'
  | 'github_username'
  | 'twitter_handle'
  | 'email'
  | 'name_company'
  | 'personal_url';

/** Confidence level for observations and merges */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** A single identifier observed from a specific data source */
export interface ObservedIdentifier {
  type: IdentifierType;
  value: string;
  source: string;
  observedAt: string;
  confidence: ConfidenceLevel;
}

/** Stable identity for a person across multiple data sources */
export interface PersonIdentity {
  canonicalId: string;
  observedIdentifiers: ObservedIdentifier[];
  mergedFrom?: string[];
  mergeConfidence: number;
}
