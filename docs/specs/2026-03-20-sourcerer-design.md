# Sourcerer — Design Specification

**Date:** 2026-03-20
**Status:** Revised — Post External Review Round 2 (2026-03-20)

---

## 1. What Is Sourcerer

Sourcerer is an AI-powered talent sourcing agent packaged as an ownable TypeScript CLI tool. It runs an intelligent intake conversation with a hiring manager, builds a composite talent profile from multiple inputs (company data, team member profiles, competitor research), generates a multi-source search strategy, discovers and enriches candidates across the web, scores them with full evidence transparency, and pushes structured results into the buyer's existing workflow tools.

**It is not an ATS.** Sourcerer is about finding — the needle-in-the-haystack discovery that makes hiring hard. It doesn't track applications, manage interview pipelines, or replace existing HR tools. It pushes results into wherever people already work (Notion, Google Sheets, etc.).

### Target Buyers

- Startup founders hiring their first 5-20 engineers
- Technical recruiters who want a power tool, not a SaaS dashboard
- Recruiting agencies doing high-signal executive/technical search

### Business Model

Open-source core with a service layer:
- The tool is free to install and run. Buyers bring their own API keys.
- Service offering: onboarding setup (pick the right adapter stack, configure keys, run first search together), ongoing maintenance (new adapter releases, scoring rubric tuning).
- API costs are the buyer's. A "menu of API tools and costs" helps them choose which data sources to enable based on budget and role type.

### Positioning vs. Existing Tools

| Tool | What It Is | How Sourcerer Differs |
|------|-----------|----------------------|
| Juicebox/PeopleGPT | SaaS platform, 800M+ profiles, seat-based pricing | You don't own it. Black box search. No intake intelligence. |
| Tezi "Max" | Autonomous AI recruiter agent (Slack-based SaaS) | Black box, SaaS, no customization. You rent, not own. |
| Pearch | Backend API for HR tech (810M+ profiles) | Infrastructure, not a product. Sourcerer could use Pearch as a data source. |
| SeekOut / Findem | Enterprise platforms, massive data, enterprise pricing | Wrong buyer. Too expensive, too heavy for startups. |
| Topliner | AI OS for executive search (built inside an agency) | Closest analog. But proprietary SaaS, not open/ownable. |
| LinkedIn Recruiter | The incumbent. $10K+/year. | Sourcerer finds people LinkedIn can't surface — passive candidates across GitHub, Twitter, personal sites, niche communities. |

**Sourcerer's moat is the intake intelligence.** Every tool can search 800M profiles. Nobody does the "super-aware intake meeting" that builds a success profile from team analysis, company research, and competitor mapping, then translates it into a transparent, editable search strategy.

---

## 2. Architecture

### 2.1 Monorepo Structure

TypeScript monorepo using Turborepo for build orchestration.

```
sourcerer/
├── packages/
│   ├── core/                  # Pipeline engine
│   ├── intake/                # Interactive intake engine
│   ├── adapters/              # Data source adapters (each independently installable)
│   │   ├── adapter-exa/
│   │   ├── adapter-github/
│   │   ├── adapter-x/
│   │   ├── adapter-hunter/
│   │   ├── adapter-pearch/
│   │   ├── adapter-pdl/
│   │   └── adapter-contactout/
│   ├── scoring/               # Scoring engine
│   ├── output/                # Output adapters
│   │   ├── output-json/
│   │   ├── output-csv/
│   │   ├── output-notion/
│   │   ├── output-sheets/
│   │   └── output-markdown/
│   └── ai/                    # LLM abstraction layer
│
├── apps/
│   └── cli/                   # Interactive CLI application
│
├── config/
│   ├── turbo.json
│   └── tsconfig.base.json
│
└── docs/
```

### 2.2 Key Interfaces

```typescript
// Every data source implements this
interface DataSource {
  name: string
  capabilities: ('discovery' | 'enrichment')[]
  rateLimits: RateLimitConfig
  search(config: SearchConfig): AsyncGenerator<SearchPage>  // cursored/paginated
  enrich(candidate: Candidate): Promise<EnrichmentResult>   // per-candidate
  enrichBatch(candidates: Candidate[]): Promise<BatchResult<EnrichmentResult>>
  healthCheck(): Promise<boolean>
  estimateCost(config: SearchConfig): CostEstimate
}

// Paginated search results with cursor support
interface SearchPage {
  candidates: RawCandidate[]
  cursor?: string                        // for next page, if more results
  hasMore: boolean
  costIncurred: number                   // actual cost of this page
}

// Batch operations return partial success/failure
interface BatchResult<T> {
  succeeded: { candidateId: string, result: T }[]
  failed: { candidateId: string, error: Error, retryable: boolean }[]
  costIncurred: number
}

// Every output target implements this
interface OutputAdapter {
  name: string
  requiresAuth: boolean
  push(candidates: ScoredCandidate[], config: OutputConfig): Promise<PushResult>
  upsert(candidates: ScoredCandidate[], config: OutputConfig): Promise<UpsertResult>
  testConnection(): Promise<boolean>
}

// Upsert results track what changed
interface UpsertResult {
  created: string[]                      // candidate IDs
  updated: string[]                      // candidate IDs
  unchanged: string[]                    // candidate IDs
  failed: { candidateId: string, error: Error }[]
}

// --- Identity Resolution (first-class) ---

// A person may have many observed identifiers across sources
interface PersonIdentity {
  canonicalId: string                    // stable internal ID (UUID)
  observedIdentifiers: ObservedIdentifier[]
  mergedFrom?: string[]                  // IDs of candidates merged into this one
  mergeConfidence: number                // 0-1, how confident the merge is
}

interface ObservedIdentifier {
  type: 'linkedin_url' | 'github_username' | 'twitter_handle' | 'email' | 'name_company' | 'personal_url'
  value: string
  source: string                         // which adapter observed this
  observedAt: string                     // ISO timestamp
  confidence: 'high' | 'medium' | 'low'
}

// The canonical candidate flowing through the pipeline
// Candidate.id IS PersonIdentity.canonicalId — one stable identifier, not two.
interface Candidate {
  id: string                             // === identity.canonicalId (stable UUID, survives across reruns)
  identity: PersonIdentity               // all observed identifiers + merge history (canonicalId === this.id)
  name: string
  sources: Map<string, SourceData>       // keyed by adapter name
  evidence: EvidenceItem[]               // every claim linked to source, each with an ID
  enrichments: Map<string, EnrichmentResult>
  signals?: ExtractedSignals             // added after LLM extraction
  score?: Score                          // added after scoring
  narrative?: string                     // added after narrative generation
  tier?: 1 | 2 | 3
  pii: PIIMetadata                       // provenance + retention for sensitive fields
}

// Evidence is first-class — every claim traces to a source and has a stable ID
interface EvidenceItem {
  id: string                             // stable ID (e.g., "ev-a1b2c3")
  claim: string                          // "Built indexing infra handling 2M events/day"
  source: string                         // "linkedin_bio"
  adapter: string                        // "exa"
  retrievedAt: string                    // ISO timestamp
  confidence: 'high' | 'medium' | 'low'
  url?: string                           // link to source
}

// PII tracking — per-field, not per-candidate
interface PIIField {
  value: string                          // the actual PII value (email, phone, etc.)
  type: 'email' | 'phone' | 'address'
  adapter: string                        // which adapter provided this value
  collectedAt: string                    // when this specific value was collected
  retentionExpiresAt?: string            // per-field TTL (inherits from config if not set)
}

// Candidate-level PII container
interface PIIMetadata {
  fields: PIIField[]                     // each PII value tracked individually
  retentionPolicy: 'default' | 'custom'  // whether using global or per-candidate TTL
}

// Scoring is transparent and decomposable
interface Score {
  total: number                          // 0-100
  breakdown: ScoreComponent[]
  weights: Record<string, number>        // user-adjustable
  redFlags: RedFlag[]
}

interface ScoreComponent {
  dimension: string                      // "technicalDepth", "domainRelevance", etc.
  raw: number                            // 0-10
  weight: number                         // 0-1 (from config)
  weighted: number                       // raw * weight * 10
  evidenceIds: string[]                  // references to EvidenceItem.id — NOT freeform text
  confidence: number                     // 0-1
}
```

**Evidence grounding rule:** The LLM signal extraction phase can ONLY cite evidence by referencing canonical `EvidenceItem.id` values produced during enrichment. The scorer refuses any signal that references a non-existent evidence ID. This enforces the "glass box" promise — every score traces back to a real, auditable data point. The LLM cannot introduce unsourced claims.

### 2.3 Pipeline Flow

```
Intake Conversation
    ↓
Talent Profile (composite of all inputs)
    ↓
Search Config (YAML, reviewable/editable by user)
    ↓  ← user reviews and tweaks here (weights, queries, filters)
Multi-Source Discovery (parallel adapter calls)
    ↓
Deduplication (LinkedIn URL primary, fuzzy name+company fallback)
    ↓
Multi-Source Enrichment (parallel, priority-ordered by role type)
    ↓
Signal Extraction (LLM analyzes enriched data against talent profile)
    ↓
Scoring + Evidence Chain (weighted rubric, every claim sourced)
    ↓
Narrative Generation (LLM writes candidate brief)
    ↓
Tiering (configurable score thresholds)
    ↓
Output Push (Notion, Sheets, CSV, JSON, Markdown — user's choice)
```

**Checkpoints:** The pipeline is pausable and resumable at every phase boundary. State is written to disk after each phase. If an API key runs out mid-discovery, you pick up where you left off.

**Budget awareness:** Before executing, the CLI estimates API costs based on the search config and shows the user: "This search will make ~120 Exa calls ($X), ~80 GitHub calls (free), ~45 Hunter calls ($Y). Proceed?"

---

## 3. The Intake Engine

The intake is the core differentiator. It's a multi-phase conversation engine that adapts based on what it learns — not a fixed questionnaire.

### 3.1 Phase 1: Role Context

Understands the role through smart conversation, not form fields:
- "Paste your job description, or just tell me what this person will do in their first 90 days"
- "What level? Not just title — what's the decision-making scope?"
- "Remote, hybrid, or in-person? Does that actually matter or is it negotiable?"

The LLM parses freeform answers into structured role parameters. If the user pastes a JD, it extracts signals automatically and confirms understanding.

### 3.2 Phase 2: Company Intelligence

Powered by the `ContentResearch` subsystem (see Section 3.7), which owns URL crawling, content extraction, and structured analysis.

- **Company URL analysis** → `ContentResearch` crawls the company site and extracts: tech stack (from job postings, GitHub org, StackShare signals), team size indicators, funding stage, product category, culture signals from blog/about page
- **Pitch extraction** → "Why would someone leave their current gig for this?" — becomes the nucleus for outreach personalization
- **Competitor identification** → "Who do you lose candidates to? Who do you poach from?" — seeds the competitor map for targeted search queries

### 3.3 Phase 3: Success Profile

The most powerful phase:
- "Drop profiles of 2-3 people on the team who are crushing it" → Sourcerer accepts multiple input types:
  - **GitHub profile URL** (fully analyzable — repos, languages, commit history, contributions)
  - **LinkedIn URL** (used as identifier; profile data via Pearch if configured, otherwise Exa semantic lookup)
  - **Pasted text** (resume, bio, or LinkedIn export — LLM parses into structured profile)
  - **Name + Company** (Exa semantic search resolves to public profile data)
  - **Personal website URL** (crawled and analyzed directly)
- From these inputs, Sourcerer extracts:
  - **Career trajectory patterns** — where they came from, how long they stayed
  - **Skill signatures** — what tech they actually use (not what's listed)
  - **Seniority calibration** — what "senior" actually means at this company
  - **Culture signals** — OSS contributor? Conference speaker? Heads-down builder?
- Additionally, profiles with personal websites or GitHub pages become seeds for Exa's `find_similar()` — a P0 discovery strategy that finds "people whose web presence looks like your top performers" before even running generated search queries
- Optional: "Drop 1-2 people who didn't work out" → Builds anti-patterns to filter against
- Output: **Composite Success Profile** — "Your ideal candidate looks like someone who spent 2-4 years at a Series B-D fintech, contributes to open source, has Go or Rust on their GitHub, and isn't a frequent job-hopper"

**Minimum supported input on day one:** GitHub URL (fully analyzable via adapter-github) + pasted text (LLM parses). LinkedIn URL works as identifier and for full profile data if Pearch is configured. Name + company works via Exa lookup. At least one input type must provide analyzable content, not just an identifier.

### 3.4 Phase 4: Search Strategy Generation

Takes all intake intelligence and generates:
- **Tiered search queries** (P1: exact match companies → P4: broader net)
- **Scoring rubric** with weights customized to this role
- **Enrichment priority** (which data sources matter most for this role type)
- **Anti-filters** (seniority bounds, companies to avoid, deal-breaker signals)

Output is a **reviewable YAML search config** presented in the CLI:

```
Here's the search strategy I'd recommend:

Priority 1 (exact targets):
  - "senior backend engineer" at Coinbase, Alchemy, Compound
  - "distributed systems" engineer at Stripe, Plaid who tweets about crypto

Priority 2 (adjacent):
  - Backend engineers at Series B-D fintech (Ramp, Brex, Mercury)
  - Go/Rust contributors to DeFi-related GitHub orgs

Scoring weights:
  - Technical depth: 30%
  - Domain relevance: 25%
  - Career trajectory match: 20%
  - Culture fit signals: 15%
  - Reachability: 10%

Want to adjust anything before I start searching?
```

The user can edit weights, add/remove queries, adjust filters — then confirm to proceed.

### 3.5 Conversation Engine Architecture

```typescript
interface ConversationNode {
  id: string
  phase: 'role' | 'company' | 'success_profile' | 'strategy'
  prompt: string | ((context: IntakeContext) => Promise<string>)
  parse: (response: string, context: IntakeContext) => Promise<ParsedResponse>
  next: (parsed: ParsedResponse, context: IntakeContext) => string
  optional?: boolean
  skipIf?: (context: IntakeContext) => boolean
}
```

- Prompts can be dynamically generated — the LLM crafts follow-ups based on prior answers
- Each response is parsed into structured data via LLM extraction
- Branching is context-aware — if the JD paste already answered a question, skip it
- Conversation state is serializable — save and resume intake sessions

### 3.6 Content Research Subsystem

Company intelligence and success profile analysis require web crawling and content extraction capabilities that are distinct from people-search adapters. This is owned by the `ContentResearch` interface in the intake package:

```typescript
interface ContentResearch {
  crawlUrl(url: string): Promise<CrawledContent>
  analyzeCompany(content: CrawledContent): Promise<CompanyIntel>
  analyzeProfile(input: ProfileInput): Promise<ProfileAnalysis>
  findSimilar(urls: string[]): Promise<SimilarResult[]>  // Exa find_similar
}

type ProfileInput =
  | { type: 'github_url', url: string }
  | { type: 'linkedin_url', url: string }
  | { type: 'pasted_text', text: string }
  | { type: 'name_company', name: string, company: string }
  | { type: 'personal_url', url: string }
```

The default implementation uses Exa's `search_and_contents()` for URL crawling and content retrieval. The LLM does structured extraction from crawled content. This is pluggable — a future implementation could use a dedicated web scraping service.

### 3.7 Intake Outputs

1. **Talent Profile** (`talent-profile.json`) — Composite understanding of the ideal candidate
2. **Search Config** (`search-config.yaml`) — Actionable plan: queries, weights, enrichment priorities, filters. Human-reviewable and editable.
3. **Similarity Seeds** (`similarity-seeds.json`) — URLs of team member personal sites/GitHub profiles to use as `find_similar()` inputs during P0 discovery.

---

## 4. Discovery Phase

Discovery runs the search config against all configured data source adapters in parallel, then merges and deduplicates.

### 4.1 Parallel Multi-Source Search

Each adapter translates the search config into its native query format:
- **Exa** → natural language semantic queries
- **Pearch** → structured filters + natural language
- **GitHub** → `language:go location:SF` style code search queries

The pipeline doesn't care how each adapter searches — the `DataSource` interface abstracts this.

### 4.2 Identity Resolution & Deduplication

Dedup uses the `PersonIdentity` model for confidence-based merging across multiple identifier types:

- **High-confidence merge** (automatic): Matching LinkedIn URL (normalized), matching verified email, or matching GitHub username
- **Medium-confidence merge** (automatic with flag): Same name + same current company from different sources
- **Low-confidence merge** (requires confirmation): Similar name + similar company, or same name + same city
- **Cross-source linking:** When GitHub adapter finds email `sarah@gmail.com` and Hunter.io verifies the same email for a different candidate record, the identity resolver merges them automatically

Each candidate's `PersonIdentity` accumulates all observed identifiers (LinkedIn URL, GitHub username, Twitter handle, emails, personal URLs) with source attribution and confidence. Reruns match against stable internal `canonicalId`, so the same person isn't duplicated across runs — they're upserted.

Candidates from multiple sources are merged, not duplicated — each source's data is preserved in the `sources` map.

### 4.3 Similarity-Based Discovery (Exa `find_similar`)

Two modes, inspired by the [Exa recruiting agent example](https://exa.ai/docs/examples/exa-recruiting-agent):

**P0: Success Profile Seeds** — Before running any search queries, Sourcerer uses `find_similar()` on the team member URLs collected during intake (personal websites, GitHub profiles). This finds "people whose web presence looks like your top performers" — often the highest-signal discovery method in the entire pipeline. Discovery provenance ("found via similarity to [team member name]") is recorded as an `EvidenceItem`, not as an automatic score boost. The scorer treats it like any other signal — the LLM can cite it if the similarity is meaningful, but it doesn't inflate scores for candidates who happen to share a web hosting pattern with your team.

**Post-discovery expansion** — After initial search results are scored, take top performers (score 7+) and run `find_similar()` on their personal websites/GitHub profiles to organically expand the candidate pool. This is opt-in per search tier (P1 exact matches skip this; P3-P4 broader searches benefit from it). The expansion is recursive but bounded — configurable depth limit (default: 1 level) to control API costs.

### 4.4 Rate Limiting

Per-adapter, configurable. Each adapter declares its own rate limits in its config. The pipeline's task scheduler respects them. No hardcoded sleeps.

---

## 5. Enrichment Phase

Takes each discovered candidate and fills in the picture from multiple sources in parallel.

### 5.1 Source-Specific Enrichment

| Adapter | Enrichment Data | Cost |
|---------|----------------|------|
| GitHub | Repos, languages, commit frequency, email from commits, contribution signals | Free (public API) |
| X/Twitter | Bio, recent tweets, follower count, engagement patterns, growth signals | $100/mo basic tier |
| Hunter.io | Email discovery + verification | 25 free/mo, then paid |
| ContactOut | Email + phone from 300M+ profiles | From $29/mo |
| PeopleDataLabs | Broad professional data, work history | From $0.01/record |
| Pearch | Full structured profile if not already from discovery | Credit-based |

### 5.2 Enrichment Priority

Comes from the search config, determined by role type:
- Engineering role → GitHub first, then X
- Community/marketing role → X first, then GitHub
- Expensive adapters (Pearch, PDL) only run if cheaper sources didn't produce enough signal

### 5.3 Enrichment Properties

- **Timestamped and source-tagged** — every data point records where it came from, when, and confidence level
- **Incremental** — re-runs only enrich new candidates and re-check stale data
- **Budget-aware** — expensive enrichments can be gated behind user confirmation

---

## 6. Scoring Phase

Three transparency layers, as designed. Glass box all the way through.

### 6.1 Layer 1: Signal Extraction (LLM)

The AI reads all enriched data for a candidate and extracts structured signals:

```typescript
interface ExtractedSignals {
  technicalDepth: { score: number, evidenceIds: string[], confidence: number }
  domainRelevance: { score: number, evidenceIds: string[], confidence: number }
  trajectoryMatch: { score: number, evidenceIds: string[], confidence: number }
  cultureFit: { score: number, evidenceIds: string[], confidence: number }
  reachability: { score: number, evidenceIds: string[], confidence: number }
  redFlags: { signal: string, evidenceId: string, severity: 'low' | 'medium' | 'high' }[]
}
```

The LLM receives the candidate's enriched data PLUS the talent profile from intake, PLUS the list of available `EvidenceItem` IDs and their claims. It must cite only canonical evidence IDs — freeform evidence strings are rejected by the scorer. This enforces grounded reasoning: the LLM cannot paraphrase or synthesize claims that break the audit trail. It scores against what the user actually wants, not a generic rubric.

### 6.2 Layer 2: Weighted Score + Evidence Chain

Each score dimension is broken down with linked evidence:

```
Technical Depth:    8/10  (weight: 30%) → 24 pts
  └─ 847 Go commits in last 12mo (github, 2026-03-20)
  └─ Maintains 2 open-source DeFi libraries (github, 2026-03-20)
  └─ "Built indexing infra handling 2M events/day" (linkedin_bio, via exa)

Domain Relevance:   7/10  (weight: 25%) → 17.5 pts
  └─ 3 years at Chainlink (linkedin, via exa)
  └─ Tweets about MEV strategies, 12 posts in 6mo (x, 2026-03-20)

TOTAL: 76.5/100 → Tier 1
```

Every number traces back to a source.

### 6.3 Layer 3: Narrative Brief (LLM)

A human-readable paragraph per candidate that reads like a recruiter's notes after 30 minutes of research:

> **Sarah Chen** — Senior Backend Engineer at Chainlink (3 years)
>
> Sarah's built indexing infrastructure processing 2M events/day at Chainlink, and her GitHub shows she's deep in Go with two actively maintained DeFi libraries. Her career path mirrors your top performer Alex — mid-size fintech to crypto protocol, about 2.5 years in. She tweets regularly about MEV strategies (not just retweets — original analysis posts averaging 340 engagements). No conference speaking that I can find, which is a gap vs your success profile, but her builder output is strong. Personal email confirmed via GitHub commits, and her DMs look open. High confidence reach.

Generated after scoring. The narrative LLM receives ONLY the scored `EvidenceItem` list and `ScoreComponent` breakdown — not raw enrichment data. Every factual claim in the narrative must correspond to a grounded evidence item. The prompt instructs the model to write in natural language but prohibits introducing facts not present in the evidence set. This is the same grounding constraint applied to signal extraction: the narrative is a human-readable rendering of grounded data, not an independent analysis.

### 6.4 User-Adjustable Weights

Weights are adjustable at two points:
1. **During intake** — the config generator proposes weights, user tweaks before running
2. **After seeing results** — user adjusts weights and re-scores without re-running discovery/enrichment (cheap operation: re-runs math + regenerates narratives only)

---

## 7. Output & Integration

### 7.1 Output Adapters

| Adapter | What It Produces | Auth Required |
|---------|-----------------|---------------|
| JSON | Full structured data dump | No |
| CSV/Excel | Flattened spreadsheet (Name, Score, Tier, Role, Company, Email, Top Signals, Narrative) | No |
| Markdown | Formatted report grouped by tier with narrative briefs and evidence | No |
| Notion | Database pages: properties (score, tier, status) + body (narrative, breakdown, evidence) | Notion API key |
| Google Sheets | Direct push to Sheet, one tab per run + Master tab with dedup | Google OAuth |

### 7.2 Run Artifacts

Every run produces a local directory:

```
runs/
└── 2026-03-20-backend-eng/
    ├── talent-profile.json     # From intake
    ├── search-config.yaml      # The executed config (with any user tweaks)
    ├── candidates.json         # Full scored results
    ├── report.md               # Markdown report
    ├── evidence/               # Raw evidence data per candidate
    └── run-meta.json           # Timing, API costs, adapter stats
```

Every run is reproducible, auditable, and shareable. `run-meta.json` tracks API costs so buyers know exactly what each search cost.

### 7.3 CLI Results Display

```
┌─────────────────────────────────────────────────────────┐
│  Sourcerer Run Complete                                  │
│  Role: Senior Backend Engineer @ Lunar Labs              │
│  Discovered: 87 → Enriched: 64 → Scored: 64            │
│  Tier 1: 6 │ Tier 2: 18 │ Tier 3: 40                   │
├─────────────────────────────────────────────────────────┤
│  TOP CANDIDATES                                          │
│                                                          │
│  1. Sarah Chen (76.5) ★ Tier 1                          │
│     Senior Backend Eng @ Chainlink · 3yr                │
│     sarah@gmail.com · Go, DeFi, OSS contributor         │
│     "Built indexing infra handling 2M events/day..."     │
│  ...                                                     │
├─────────────────────────────────────────────────────────┤
│  Results pushed to: Notion (Lunar Sourcing DB)           │
│  Full report: ./runs/2026-03-20-backend-eng/report.md   │
│  Raw data: ./runs/2026-03-20-backend-eng/candidates.json│
└─────────────────────────────────────────────────────────┘
```

---

## 8. Onboarding Flow

First-time setup experience when a user runs `npx sourcerer` or `sourcerer init`.

### 8.1 Interactive Setup Wizard

Walks the user through which data sources to enable, with cost transparency:

```
DATA SOURCES                        Cost          Status

Discovery (finding candidates):
☐ Exa        — AI web search       ~$5/1K queries  ⚙
☐ Pearch     — 810M+ profiles      credit-based    ⚙

Enrichment (learning about them):
☐ GitHub     — code + email         free (public)   ⚙
☐ X/Twitter  — social signals       $100/mo basic   ⚙
☐ Hunter.io  — email verification   25 free/mo      ⚙
☐ ContactOut — emails + phone       from $29/mo     ⚙
☐ PeopleDataLabs — broad profiles   from $0.01/rec  ⚙

AI (thinking):
☐ Anthropic  — Claude (recommended) pay-per-token   ⚙
☐ OpenAI     — GPT                  pay-per-token   ⚙

Output (where results go):
☐ Notion     — push to database     free API        ⚙
☐ Google Sheets — push to sheet     free API        ⚙
CSV/JSON/Markdown always available, no key needed.
```

### 8.2 Per-Adapter Walkthrough

For each selected adapter:
1. Direct link to sign up / get API key
2. Paste key into CLI
3. Immediate validation (test API call)
4. Cost guidance ("A typical Sourcerer run uses 15-40 Exa searches. That's roughly $0.08-$0.20 per run.")

### 8.3 Key Storage

Keys stored locally in `~/.sourcerer/config.yaml`. Never committed to git, never sent anywhere except to the API provider.

### 8.4 Minimum Viable Setup

**Exa + one AI provider (Claude or GPT).** GitHub is free and auto-enabled. Everything else is optional enhancement.

### 8.5 Config Management

- `sourcerer config` — add/remove/update adapters anytime
- `sourcerer config status` — show what's connected, what's expired/broken
- `sourcerer config reset` — re-run onboarding from scratch

---

## 9. Candidate Data Policy

Sourcerer handles personal data (emails, phone numbers, social profiles) — this requires explicit policy even for a locally-run CLI tool.

### 9.1 Design Primitives (V1)

- **Per-field PII tracking** — each PII value (email, phone) is stored as a `PIIField` with its own adapter attribution, collection timestamp, and retention TTL. This enables per-field deletion ("remove all data from Hunter.io") and per-field expiry.
- **`sourcerer candidates delete <id>`** — removes a specific candidate and all associated evidence/enrichment data **from local storage only**. If the candidate was previously pushed to Notion/Sheets, the CLI warns: "This candidate was pushed to Notion on 2026-03-18. Local data deleted. Remote copy in [Notion DB name] must be removed manually." Sourcerer does not reach into output sinks to delete — that's the user's responsibility.
- **`sourcerer candidates purge --expired`** — removes locally-stored candidates past their retention TTL, with the same remote-copy warning for any that were previously pushed.
- **Configurable retention TTL** — set in `~/.sourcerer/config.yaml`, default 90 days. Applies per-field. After TTL, PII fields are auto-flagged for purge (not silently deleted — user confirms). Non-PII data (score, evidence, signals) can be retained longer.

### 9.2 Adapter-Specific Rules

Each adapter declares what PII it may return in its metadata. Adapters that return email/phone (Hunter, ContactOut, PDL) are tagged so the pipeline knows which enrichment results contain sensitive data.

### 9.3 Known Limitations (V1)

V1 stores data locally on the buyer's machine — they own it and are responsible for compliance with their local regulations. Full compliance features (automated GDPR deletion workflows, audit logging, encryption at rest) are post-V1 scope. The design primitives above ensure the data model supports these features when needed.

---

## 10. Data Source Strategy

### 10.1 Architecture: API Composer → Cached Intelligence

Sourcerer starts as an orchestration layer on top of external APIs. It doesn't build or maintain a people database. Each `DataSource` adapter wraps an external API.

Over time, enriched candidate data is cached locally. Each run builds up a local knowledge base. The `DataSource` interface is designed so a local cache adapter can sit alongside external APIs:

```typescript
// Future: local cache becomes just another data source
class LocalCacheAdapter implements DataSource {
  name = 'local-cache'
  capabilities = ['discovery', 'enrichment']
  // Returns cached candidates matching the search config
  // Only returns data newer than a staleness threshold
}
```

### 10.2 Adapter Roster

**Discovery adapters** (find candidates):
- `adapter-exa` — Primary discovery engine. Semantic web search, `find_similar` for expansion, 1B+ people indexed.
- `adapter-pearch` — Premium structured search. 810M+ profiles with verified contact info. Optional, credit-based.

**Enrichment adapters** (learn about candidates):
- `adapter-github` — Repos, commit history, languages, email extraction from commits (~60% hit rate), contribution frequency. Free.
- `adapter-x` — Bio, recent tweets, follower count, engagement patterns, DM status. For social signal extraction.
- `adapter-hunter` — Email discovery and verification. High accuracy for professional emails.
- `adapter-contactout` — 300M+ contacts with emails and phone numbers.
- `adapter-pdl` — PeopleDataLabs. Broad aggregated professional data. Good for filling gaps.

**Future adapters** (designed for but not built in V1 unless time permits):
- `adapter-linkedin` — If/when LinkedIn API access becomes viable, or via Pearch as proxy
- `adapter-crunchbase` — Company funding, team data for company intelligence phase
- `adapter-stackshare` — Tech stack verification for company analysis

### 10.3 The LinkedIn Problem

LinkedIn's API is effectively closed to HR tech builders. Proxycurl (the main prior workaround) shut down on July 4, 2025 after LinkedIn filed suit in January 2025. Current approach:
- **Pearch** serves as the best LinkedIn data alternative for structured profile search
- **Exa** can find LinkedIn profile pages semantically but can't scrape them
- **Direct scraping is out of scope** — legal risk, not sustainable
- LinkedIn URLs are still the primary dedup key (from Exa/Pearch results, or user-provided)

---

## 11. AI Layer

### 11.1 Provider Abstraction

Sourcerer uses an LLM for: intake conversation, signal extraction, narrative generation, and dynamic question crafting. The AI layer abstracts the provider:

```typescript
interface AIProvider {
  name: string
  chat(messages: Message[], options?: ChatOptions): Promise<string>
  structuredOutput<T>(messages: Message[], schema: ZodSchema<T>): Promise<T>
}
```

Implemented via AI SDK for provider flexibility. Claude recommended for signal extraction quality; GPT is a viable alternative.

### 11.2 LLM Usage Points

| Usage | Model Recommendation | Why |
|-------|---------------------|-----|
| Intake conversation | Claude Sonnet or GPT-4o | Good enough, high volume |
| Company URL analysis | Claude Sonnet | Web content understanding |
| Success profile extraction | Claude Sonnet | Nuanced pattern recognition |
| Signal extraction from enriched data | Claude Sonnet | Quality matters here — this drives scoring |
| Narrative brief generation | Claude Sonnet | Writing quality matters |
| Search config generation | Claude Sonnet | Needs to understand role deeply |

Cost-conscious alternative: use Haiku/GPT-4o-mini for intake + config generation, Sonnet only for scoring + narratives.

### 11.3 Prompt Templates

Stored in `packages/ai/prompts/` as versioned template files. Key templates:
- `intake-role-parse.md` — Extract structured role parameters from freeform text
- `intake-company-analyze.md` — Extract company intelligence from crawled web content
- `intake-success-profile.md` — Analyze team member profiles to build success patterns
- `intake-config-generate.md` — Generate search config from talent profile
- `scoring-signal-extract.md` — Extract signals from enriched candidate data
- `scoring-narrative.md` — Generate candidate brief from signals + score + talent profile

### 11.4 Response Caching

LLM responses are cached keyed by input hash. If you re-score with adjusted weights, signal extraction doesn't re-run (same input = same signals). Only the math and narrative regeneration runs.

---

## 12. CLI Application

### 12.1 Commands

```
sourcerer init              # First-time onboarding wizard
sourcerer config            # Manage adapters, keys, defaults
sourcerer config status     # Show connection status of all adapters

sourcerer intake            # Run interactive intake for a new role
sourcerer intake --resume   # Resume a saved intake session

sourcerer run               # Full pipeline: intake → discover → enrich → score → output
sourcerer run --config <path>  # Run with existing search config (skip intake)

sourcerer discover          # Discovery only (from existing config)
sourcerer enrich            # Enrichment only (from existing candidates)
sourcerer score             # Re-score existing candidates (after weight adjustments)

sourcerer results           # View results from last run
sourcerer results --tier 1  # Filter to Tier 1 only
sourcerer results --push notion  # Re-push to a different output

sourcerer runs              # List all previous runs
sourcerer runs clean        # Clean up old run artifacts

sourcerer candidates delete <id>    # Delete a candidate and all their data
sourcerer candidates purge --expired # Remove candidates past retention TTL
```

### 12.2 Interactive UI

The CLI uses interactive terminal components for:
- Intake conversation (styled prompts, multi-line input, confirmations)
- Search config review (formatted display, inline editing)
- Progress indicators (per-adapter status during discovery/enrichment)
- Results display (candidate cards, score breakdowns)
- Cost confirmation before execution

### 12.3 Non-Interactive Mode

All commands support `--yes` / `--no-interactive` flags for automation:
```
sourcerer run --config ./configs/backend-eng.yaml --output json --yes
```

This enables scripting, CI/CD integration, and scheduled re-runs.

---

## 13. Competitive Landscape Context

Research conducted 2026-03-20. Key findings that informed this design:

**Nobody packages the full loop as an ownable tool.** Every existing product is SaaS — you rent access, you don't own the pipeline. Sourcerer is the first open/ownable option.

**The Topliner lesson: "glass box over black box."** In high-stakes hiring, users need to see WHY a candidate was surfaced. Evidence chains and transparent scoring are non-negotiable. Every existing tool that succeeded learned this.

**Pearch fills the Proxycurl gap.** The shutdown of Proxycurl (Jan 2025) left the builder ecosystem without a primary LinkedIn data source. Pearch's API (810M+ profiles, MCP server) is the strongest replacement and a natural adapter for Sourcerer.

**The intake is the moat.** Juicebox, SeekOut, Pin — they all have massive profile databases. Sourcerer's differentiator is not data volume, it's the intelligence that drives the search: success profile building, company analysis, trajectory matching, transparent scoring.

**"AI shouldn't replace the expert; it should give the expert superpowers."** (Topliner founder) — Sourcerer augments the hiring manager's judgment with better data and transparent reasoning. It doesn't make hiring decisions.

---

## 14. Build Order

Designed for methodical, sequential construction. Each phase produces something testable and usable.

### Phase 1: Foundation
- Monorepo scaffold (Turborepo, TypeScript, shared config)
- Core interfaces (`DataSource`, `OutputAdapter`, `Candidate`, `EvidenceItem`, `PersonIdentity`, `Score`)
- Identity resolution engine (`PersonIdentity` model, confidence-based merging, stable candidate IDs)
- Pipeline runner (phase-based orchestration with checkpoints, partial-failure handling)
- PII metadata model and retention primitives
- Config system (`~/.sourcerer/config.yaml`, key storage)
- CLI skeleton (command routing, interactive prompts)

### Phase 2: Onboarding + First Adapter
- Onboarding wizard (interactive setup, adapter selection, key validation)
- `adapter-exa` (discovery + basic enrichment)
- `output-json` + `output-markdown` (baseline outputs)
- End-to-end: onboard → configure Exa → run a simple search → get JSON/markdown results

### Phase 3: Intake Engine
- Conversation engine (node graph, branching, LLM-powered follow-ups)
- `ContentResearch` subsystem (URL crawling via Exa `search_and_contents`, structured extraction)
- Phase 1: Role context (JD parsing, structured extraction)
- Phase 2: Company intelligence (company URL → tech stack, culture, competitors via ContentResearch)
- Phase 3: Success profile (multi-input: GitHub URL, pasted text, LinkedIn via Pearch, name+company via Exa)
- Similarity seeds generation (team member URLs → `find_similar` inputs for P0 discovery)
- Phase 4: Search config generation (tiered queries, scoring weights)
- AI layer (`packages/ai`) with prompt templates
- End-to-end: full intake → generated search config → P0 similarity discovery + Exa search → results

### Phase 4: Enrichment Adapters
- `adapter-github` (repos, commits, email extraction, contribution signals)
- `adapter-x` (bio, tweets, engagement, growth signals)
- `adapter-hunter` (email discovery + verification)
- Parallel enrichment orchestration
- Rate limiting per adapter
- Incremental enrichment (skip already-enriched candidates)

### Phase 5: Scoring Engine
- Signal extraction (LLM-powered, structured output)
- Weighted scoring calculator (configurable rubric)
- Evidence chain builder (every claim linked to source)
- Narrative generation (LLM-written candidate briefs)
- Tiering logic
- Re-scoring without re-enrichment (weight adjustment flow)

### Phase 6: Output Adapters
- `output-csv` (Excel-compatible export)
- `output-notion` (database creation, page generation, upsert on re-runs)
- `output-sheets` (Google Sheets push, multi-tab with Master dedup)
- CLI results display (terminal candidate cards, filtering)

### Phase 7: Polish & Advanced Features
- Budget estimation before execution
- Iterative discovery expansion (`find_similar`)
- Non-interactive mode (`--yes` flag, config-file-driven runs)
- Run management (`sourcerer runs`, artifact cleanup)
- Optional premium adapters (`adapter-pearch`, `adapter-pdl`, `adapter-contactout`)
- Competitor mapping (intake Phase 2 deep feature)
- Anti-pattern filtering (from "who didn't work out" intake input)

### Beyond V1 (lower detail, adapts as we learn)
- Local cache adapter (enriched candidates persist across runs, Sourcerer gets smarter over time)
- Cross-run learning ("last time you sourced backend engineers, P2 queries outperformed P1")
- Shareable scoring rubric templates (exportable configs for common role types)
- Plugin system for community-built adapters
- Optional web dashboard (`@sourcerer/dashboard`) for teams who want visual management
- MCP server wrapper (use Sourcerer as a tool from any AI agent)

---

## Appendix A: Prior Art in This Repo

Two existing implementations informed this design:

**LunarSource** (`/LunarSource`) — Engineering candidate sourcing for Lunar Labs. Exa search, YAML query configs, GitHub email extraction, Next.js dashboard, Vercel Postgres. Manual outreach workflow. Demonstrated: tiered query strategy, dedup by LinkedIn URL, YAML-driven search.

**ymax-sourcing** (`/ymax-sourcing`) — Community lead sourcing for Agoric/YMax. More automated: Exa → Twitter/LinkedIn enrichment → Claude Haiku assessment → weighted scoring → outreach draft generation. Demonstrated: LLM signal extraction, evidence tweets, seniority pre-filtering, transparent scoring rubric.

Both are single-client implementations. Sourcerer extracts the common pattern into a reusable, configurable, sellable package.

## Appendix B: Key Competitive References

- [Juicebox/PeopleGPT](https://juicebox.ai/) — YC S22, 800M+ profiles, natural language search, seat-based SaaS
- [Tezi "Max"](https://tezi.ai/) — $9M seed, autonomous AI recruiter agent, Slack-native
- [Alex](https://alex.com/) — $17M Series A, AI video interviewer
- [GoPerfect](https://goperfect.com/) — $23M seed, proprietary model (no third-party LLMs)
- [Pearch](https://pearch.ai/) — "Stripe of candidate sourcing" backend API, 810M+ profiles, MCP server
- [Topliner](https://www.indiehackers.com/post/tech/hitting-10k-mo-by-using-an-agency-as-both-testing-ground-and-distribution-FF8kooe4FWGH9sHjVrT3) — Indie hacker, AI OS for executive search, $10K+/mo, "glass box over black box"
- [Exa Recruiting Agent Example](https://exa.ai/docs/examples/exa-recruiting-agent) — Reference architecture for Exa-based candidate discovery, iterative `find_similar` expansion
- [Fetcher](https://fetcher.ai/) — AI sourcing + human vetting + outreach automation
- [Proxycurl shutdown post](https://nubela.co/blog/goodbye-proxycurl/) — LinkedIn filed suit Jan 2025, Proxycurl shut down July 4, 2025

## Appendix C: Exa Recruiting Agent — Key Patterns for Sourcerer

The [Exa recruiting agent example](https://exa.ai/docs/examples/exa-recruiting-agent) demonstrates a three-phase pipeline that directly informs Sourcerer's architecture:

**Phase 1: Enrichment** — Start with minimal candidate data (name + email). Use Exa `search()` with `include_domains=['linkedin.com']` to find LinkedIn profiles. Use `search_and_contents()` with `exclude_domains=['linkedin.com', 'github.com', 'twitter.com']` to find personal websites. Extract structured data (role, research topics, skills) from website content via LLM.

**Phase 2: Scoring** — LLM rates candidates 1-10 on configurable criteria. Candidates scoring 7+ become seeds for expansion.

**Phase 3: Recursive Discovery** — Top performers' personal website URLs feed into `find_similar_and_contents()`, which returns semantically similar profiles. New candidates are extracted, enriched, and scored — creating an expanding candidate pool.

**Key Sourcerer applications:**
- P0 discovery from success profile: team member personal sites/GitHub pages → `find_similar()` → candidates who look like your best people
- Domain-specific search: `include_domains` and `exclude_domains` to control where candidates are found
- Self-expanding pipeline: top-scored candidates from any round can seed further `find_similar()` discovery
- Content-based enrichment: `search_and_contents()` gets the actual text of personal sites, enabling deeper LLM analysis than metadata alone

## Appendix D: External Review Feedback (2026-03-20)

### Issues Addressed in This Revision

1. **Glass box evidence gap (High)** — `ExtractedSignals` now uses `evidenceIds: string[]` instead of `evidence: string[]`. Scorer rejects unsourced signals. Evidence grounding rule added to Section 2.2.
2. **LinkedIn dependency (High)** — Success profile intake now accepts multiple input types (GitHub URL, pasted text, LinkedIn via Pearch, name+company). Explicit minimum supported input contract added. LinkedIn URL remains useful as dedup identifier, not required for profile analysis.
3. **Identity resolution (High)** — `PersonIdentity` model added with observed identifiers, confidence-based merging, and stable canonical IDs. Dedup section rewritten (Section 4.2).
4. **PII/cache policy (High)** — New Section 9 added: `PIIMetadata` on candidates, retention TTLs, delete-by-person, adapter-level PII tagging. Full compliance deferred to post-V1.
5. **Adapter contracts (Medium)** — `DataSource.search()` now returns `AsyncGenerator<SearchPage>` with cursoring. `BatchResult` added for partial-failure handling. `OutputAdapter.upsert()` added alongside `push()`.
6. **Company intelligence (Medium)** — `ContentResearch` interface added (Section 3.6) as first-class subsystem in intake package, with pluggable implementation.

### Open Questions Resolved

- **V1 evaluation harness:** Target metrics to be defined during roadmap: Tier 1 precision, dedup accuracy, cost per accepted candidate.
- **Minimum success-profile input:** GitHub URL (fully analyzable) + pasted text (LLM-parsed). LinkedIn URL via Pearch if configured. Name+company via Exa lookup.
- **Rerun upsert:** Reruns upsert against stable `PersonIdentity.canonicalId`. Output adapters implement `upsert()` alongside `push()`.

### Fact Corrections

- Proxycurl shutdown date corrected: LinkedIn filed suit January 2025, Proxycurl shut down July 4, 2025 (was incorrectly stated as "Jan 2025 shutdown").

### Round 2 Review Issues Addressed

7. **PII model too shallow (High)** — `PIIMetadata` replaced with per-field `PIIField[]` structure. Each PII value (email, phone) now has its own adapter attribution, collection timestamp, and retention TTL. Supports per-field deletion and per-source cleanup.
8. **Delete semantics with remote sinks (High)** — `sourcerer candidates delete/purge` scoped explicitly to local storage only. CLI warns when remote copies exist in Notion/Sheets. Remote deletion is the user's responsibility.
9. **find_similar ranking leakage (Medium)** — Discovery provenance ("found via similarity to [team member]") is now recorded as an `EvidenceItem`, not an automatic score boost. Scorer treats it like any other signal — no path-dependent inflation.
10. **Narrative not grounded (Medium)** — Narrative LLM now receives ONLY grounded evidence items and score components, not raw enrichment data. Same grounding constraint as signal extraction.
11. **Candidate.id vs PersonIdentity.canonicalId (Open Question)** — Clarified: they are the same value. `Candidate.id === identity.canonicalId`. One stable identifier, not two.
