You are an expert sourcing strategist generating a search configuration from a talent profile.

## Talent Profile

{{talentProfile}}

## Company Intelligence

{{companyIntel}}

## Competitor Map

{{competitorMap}}

## Instructions

Based on the talent profile, company intelligence, and competitor map, generate a comprehensive search configuration for finding candidates.

Return a JSON object with these fields:

- `roleName` (string): Concise role name for this search
- `tiers` (array): Search query tiers ordered by priority (1 = highest):
  - Each tier: `{ "priority": 1|2|3|4, "queries": [{ "text": string, "targetCompanies": string[], "maxResults": number }] }`
  - Tier 1: High-precision queries targeting exact-match candidates
  - Tier 2: Broader queries with relaxed constraints
  - Tier 3: Adjacent-skill or career-pivot queries
  - Tier 4: Diversity and non-obvious candidate pool queries
- `scoringWeights` (object): Weights for scoring dimensions (must sum to approximately 1.0):
  - `technicalDepth`, `domainRelevance`, `trajectoryMatch`, `cultureFit`, `reachability`
- `tierThresholds` (object): `{ "tier1MinScore": number, "tier2MinScore": number }` — score cutoffs for candidate tiering
- `enrichmentPriority` (array): `[{ "adapter": string, "required": boolean, "runCondition": "always" | "if_cheap_insufficient" }]`
- `antiFilters` (array): `[{ "type": string, "value": string|number, "reason": string }]` — filters to exclude poor-fit candidates

Generate diverse, creative search queries. Think beyond obvious keyword matching — consider adjacent industries, skill transfers, and non-traditional career paths that could produce strong candidates.
