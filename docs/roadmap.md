# Sourcerer — Implementation Roadmap

> **Source Spec:** `docs/specs/2026-03-20-sourcerer-design.md`
> **Created:** 2026-03-20
> **Status:** Validated — APPROVED WITH CHANGES (applied 2026-03-20)
> **Validation:** Internal stress-test against 7-point checklist. 2 critical, 7 important, 2 minor findings. All addressed below.
> **Approach:** Methodical, quality-first. No rush.

---

## V1 Success Criteria

Before building, this is what "done" looks like:

1. A user can `npx sourcerer init`, configure API keys, and run a full pipeline from intake to scored output
2. The intake conversation produces a talent profile + reviewable search config from role description, company URL, and team member profiles
3. Discovery finds candidates across Exa (+ P0 similarity from success profile seeds). GitHub is an enrichment source, not a discovery source.
4. Enrichment fills in GitHub code signals, X/Twitter social signals, and Hunter.io email verification
5. Scoring is fully grounded — every claim traces to an `EvidenceItem`, narrative is generated only from grounded data
6. Output pushes to Notion, CSV, JSON, and Markdown (Google Sheets deferred to Phase 7 due to OAuth complexity)
7. Identity resolution correctly deduplicates across multi-source data
8. Reruns upsert (not duplicate) against stable candidate IDs

**Target Metrics:**
- Tier 1 precision: >70% of Tier 1 candidates are human-validated as strong fits
- Dedup accuracy: <5% duplicate rate across multi-source runs
- Cost per run: <$5 for a typical 50-candidate search (Exa + AI, excluding premium adapters)

---

## Dependency Graph

```
Phase 1: Foundation ──────────────────────────────────────── SEQUENTIAL (must be first)
    │
    ▼
Phase 2: Exa + GitHub + Onboarding ──────────────────────── SEQUENTIAL (needs foundation)
    │
    ├──────────────────────┬──────────────────────────────── PARALLEL FORK
    ▼                      ▼
Phase 3A: Intake Engine    Phase 3B: AI Layer
(conversation, content     (provider abstraction,
 research, config gen)      prompt templates, caching)
    │                      │
    ├──────────────────────┘
    ▼
Phase 3C: Intake Integration ─────────────────────────────── SEQUENTIAL (merges 3A + 3B)
    │
    ├──────────────────────┬───────────────────┬──────────── PARALLEL FORK
    ▼                      ▼                   ▼
Phase 4A: GitHub hardening Phase 4B: adapter-x  Phase 4C: adapter-hunter
    │                      │                   │
    ├──────────────────────┼───────────────────┘
    ▼                      │
Phase 4D: Enrichment       │
Orchestrator ──────────────┘ ─────────────────────────────── SEQUENTIAL (needs all adapters)
    │
    ▼
Phase 5: Scoring Engine ──────────────────────────────────── SEQUENTIAL (needs enrichment)
    │
    ├──────────────────────┬──────────────────────────────── PARALLEL FORK
    ▼                      ▼
Phase 6A: output-csv      Phase 6B: output-notion
Phase 6D: CLI results
    │                      │
    ├──────────────────────┘
    ▼
Phase 7: Polish & Advanced ───────────────────────────────── SEQUENTIAL (integration)
(includes: output-sheets, post-discovery expansion, premium adapters)
```

---

## Phase 1: Foundation

**Mode:** Sequential. One session. Everything downstream depends on this.
**Estimated sessions:** 2-3
**Start command:** `/session-start`

### 1.1 Monorepo Scaffold ✅ (2026-03-22)
- [x] Initialize Turborepo with TypeScript
- [x] Create package structure: `packages/core`, `packages/intake`, `packages/adapters/adapter-exa`, `packages/scoring`, `packages/output/output-json`, `packages/output/output-markdown`, `packages/ai`, `apps/cli`
- [x] Shared `tsconfig.base.json` with strict mode
- [x] `turbo.json` with build/test/lint task pipeline
- [x] Workspace package references (`@sourcerer/core`, `@sourcerer/intake`, etc.)
- **Acceptance:** `turbo build` succeeds across all packages. `turbo test` runs (even if no tests yet). Package imports resolve correctly.

### 1.2 Core Interfaces ✅ (2026-03-23)
- [x] `DataSource` interface with `AsyncGenerator<SearchPage>`, `enrichBatch`, `BatchResult`
- [x] `OutputAdapter` interface with `push`, `upsert`, `UpsertResult`
- [x] `Candidate` type with `PersonIdentity`, `EvidenceItem[]`, `PIIMetadata`
- [x] `PersonIdentity` and `ObservedIdentifier` types
- [x] `EvidenceItem` with stable ID generation
- [x] `Score`, `ScoreComponent` with `evidenceIds` (not freeform strings)
- [x] `ExtractedSignals` with `evidenceIds`
- [x] `PIIField` per-field provenance model
- [x] `SearchConfig` type (what intake produces, what adapters consume)
- [x] `TalentProfile` type (what intake builds from conversation)
- [x] `AIProvider` interface (interface only — implementation in Phase 3B). Both intake and scoring code against this contract.
- [x] `ContentResearch` interface (interface only — implementation in Phase 3A). Defines the crawl/analyze/findSimilar contract.
- [x] Export all types from `@sourcerer/core`
- **Acceptance:** Types compile. A test file can import all types and construct valid instances. No `any` types. Phase 3 agents can code against `AIProvider` and `ContentResearch` interfaces independently.

### 1.3 Identity Resolution Engine ✅ (2026-03-23)
- [x] `IdentityResolver` class in `@sourcerer/core`
- [x] High-confidence merge: matching LinkedIn URL, verified email, or GitHub username
- [x] Medium-confidence merge: same name + same company (auto-merge with flag)
- [x] Low-confidence merge: similar name + similar company (pending confirmation)
- [x] Cross-source linking: merge when same email observed from different adapters
- [x] Stable `canonicalId` generation (UUID, survives reruns)
- [x] Merge history tracking (`mergedFrom[]`)
- [x] Unit tests: merge scenarios, non-merge scenarios, cross-source linking
- **Acceptance:**
  - Given 3 candidates from different sources with overlapping identifiers, resolver correctly merges to 1 candidate with all identifiers preserved
  - Given 2 genuinely different people with similar names, resolver does NOT merge
  - Re-running merge on the same input produces the same `canonicalId` (idempotent)
  - Source arrival order does not affect final `canonicalId` (parallel-safe)
  - Unmerge is explicitly out of scope for V1 — if a bad merge happens, the user deletes and re-runs

### 1.4 Pipeline Runner ✅ (2026-03-23)
- [x] Phase-based orchestration: `intake → discover → dedup → enrich → score → output`
- [x] Checkpoint system: serialize pipeline state to disk after each phase
- [x] Resume from checkpoint: detect last completed phase, continue from there
- [x] Partial failure handling: if a phase partially succeeds, save what worked, report what failed
- [x] Run artifact directory creation (`runs/YYYY-MM-DD-<role>/`)
- [x] `run-meta.json` generation (timing, phase status, cost tracking)
- **Acceptance:** Pipeline can be interrupted mid-enrichment, restarted, and resumes from the right point. Run artifacts are written correctly.

### 1.5 Config System ✅ (2026-03-23)
- [x] `~/.sourcerer/config.yaml` schema (adapter keys, retention TTLs, default output, AI provider)
- [x] Config read/write utilities
- [x] Key storage (plaintext in config file, gitignored by convention)
- [x] Config validation (required fields, known adapter names)
- **Acceptance:** Can read/write config. Invalid config throws clear errors.

### 1.6 CLI Skeleton ✅ (2026-03-23)
- [x] Entry point (`sourcerer` binary via `package.json` bin field)
- [x] Command routing: `init`, `config`, `intake`, `run`, `discover`, `enrich`, `score`, `results`, `runs`, `candidates`
- [x] Each command prints "not yet implemented" except `config`
- [x] `sourcerer config status` reads config and reports adapter connection status
- [x] Interactive prompt library chosen and integrated (e.g., `@inquirer/prompts` or `@clack/prompts`)
- **Acceptance:** `npx sourcerer --help` shows all commands. `sourcerer config status` reads config and reports.

### 1.7 Test Protocol for V1 Metrics ✅ (2026-03-23)
- [x] Create a benchmark role description (e.g., "Senior Backend Engineer for a DeFi startup") with known-good and known-bad candidate profiles
- [x] Create a set of 10+ known-duplicate test candidates (same person, different source representations) for dedup accuracy testing
- [x] Instrument `costIncurred` tracking in `SearchPage` and `BatchResult` from day one — aggregate in `run-meta.json` starting Phase 2
- [x] Document the manual test protocol: how many runs, which role descriptions, who validates Tier 1 precision
- **Acceptance:** Benchmark fixtures exist. Cost tracking is wired into core types. Test protocol document written.

**End of Phase 1:** `/checkpoint` ✅ — All types compile, identity resolver tests pass, pipeline runner checkpoint/resume works, CLI routes commands, test fixtures exist.

---

## Phase 2: Onboarding + First Adapter

**Mode:** Sequential. Builds on foundation.
**Estimated sessions:** 2
**Start command:** `/session-start`

### 2.1 Onboarding Wizard ✅ (2026-03-23)
- [x] `sourcerer init` command — interactive setup flow
- [x] Adapter menu with cost transparency (as designed in spec Section 8.1)
- [x] Per-adapter walkthrough: link to signup → paste key → validate → confirm
- [ ] Validation calls `healthCheck()` on each configured adapter (deferred — adapters not built yet)
- [x] Writes valid `~/.sourcerer/config.yaml` on completion
- [x] `sourcerer config` for post-init changes (add/remove adapters)
- [x] `sourcerer config reset` to re-run from scratch
- **Acceptance:** Fresh user runs `sourcerer init`, selects Exa + Claude, pastes keys, gets "connected" confirmation. Config file is valid.

### 2.2 adapter-exa ✅ (2026-03-23)
- [x] Implements `DataSource` interface
- [x] `search()`: translates `SearchConfig` queries into Exa API calls, returns `AsyncGenerator<SearchPage>`
- [x] `enrich()`: uses `getContents()` for URL-based content enrichment
- [x] `find_similar()` support (called by pipeline for P0 and post-discovery expansion)
- [x] Domain filtering (`include_domains`, `exclude_domains`)
- [x] Rate limiting (configurable, default 1 req/sec)
- [x] `healthCheck()`: validates API key with a test search
- [x] `estimateCost()`: estimates based on query count × cost per search
- [x] Error handling: API errors, rate limit 429s, timeout
- [x] Unit tests with mocked Exa responses
- **Acceptance:** Given a search config with 3 tiered queries, adapter executes searches, returns parsed candidates with evidence items. `find_similar` returns semantically related profiles. Rate limiting respects configured delay.

### 2.3 adapter-github ✅ (2026-03-23)
- [x] Implements `DataSource` with `capabilities: ['enrichment']`
- [x] `enrich()`: given a candidate with GitHub username or URL:
  - Fetch user profile (public email, bio, company, location)
  - Fetch repos (top 20 by stars/recent activity, languages, topics)
  - Fetch commit history for recent repos (email extraction from commits)
  - Calculate contribution signals (commit frequency, language distribution, OSS vs private)
- [x] `enrichBatch()` with rate limiting (GitHub: 5000 req/hr authenticated, 60/hr unauth)
- [x] Email extraction: prefer personal email (gmail, protonmail) over work/noreply
- [x] Evidence item generation: each extracted fact becomes an `EvidenceItem` with `adapter: 'github'`
- [x] PII tagging: emails marked as `PIIField` with adapter attribution
- [x] Unit tests with mocked GitHub API responses
- **Acceptance:** Given a GitHub username, returns enriched profile with repos, languages, commit email, and contribution signals. Each fact is a properly sourced `EvidenceItem`.

**Why Phase 2 (not Phase 4):** GitHub is free, fundamental, and used by both intake (success profile analysis of team members) and enrichment. The intake engine's `ContentResearch.analyzeProfile()` for `github_url` input type needs adapter-github to exist. Moving it here eliminates a forward dependency.

### 2.4 output-json + output-markdown ✅ (2026-03-24)
- [x] `output-json`: writes `candidates.json` to run directory. Full structured data.
- [x] `output-markdown`: generates formatted report grouped by tier with narrative briefs, score breakdowns, evidence links
- [x] Both implement `OutputAdapter` interface (push + upsert — for JSON/markdown, upsert overwrites the file)
- **Acceptance:** Given 10 scored candidates, both outputs produce correct files. Markdown is readable and well-formatted.

### 2.5 End-to-End Smoke Test ✅ (2026-03-24)
- [x] `sourcerer run --config test-config.yaml --output json` executes: Exa search → dedup → JSON output
- [x] No intake yet (uses a hand-written search config)
- [x] Pipeline checkpoints work
- [x] Run artifacts are created correctly
- [x] `find_similar` unit test with mocked Exa response
- [x] GitHub enrichment test with mocked API response
- **Acceptance:** Partial pipeline runs (discovery + dedup + basic enrichment, scoring is stub). Real Exa API key produces valid output. Pipeline can be interrupted and resumed.

**End of Phase 2:** `/checkpoint` ✅ — Working end-to-end from config → Exa search → GitHub enrichment → JSON/markdown output.

---

## Phase 3: Intake Engine + AI Layer

**Mode:** PARALLEL FORK then sequential merge. Use `/orchestrate`.

### Phase 3A: Intake Engine (Agent 1)
**Scope:** `packages/intake/` — conversation engine, content research, config generation
**Read-only:** `@sourcerer/core` types, `@sourcerer/adapters/adapter-exa`, `@sourcerer/adapters/adapter-github`
**Sessions:** 3-4

#### 3A.1 Conversation Engine ✅ (2026-03-24)
- [x] `ConversationNode` graph implementation
- [x] Dynamic prompt generation (LLM crafts follow-ups based on context)
- [x] Response parsing (freeform text → structured data via LLM)
- [x] Context-aware branching (skip questions already answered by JD paste)
- [x] Conversation state serialization (save/resume with `--resume`)
- [x] `IntakeContext` accumulator (builds up across phases)
- **Acceptance:** A test conversation with 5 nodes executes correctly, branches on context, saves/resumes state.

#### 3A.2 Content Research Subsystem ✅ (2026-03-24)
- [x] `ContentResearch` interface implementation
- [x] `crawlUrl()` via Exa `search_and_contents()`
- [x] `analyzeCompany()` → extracts tech stack, team size, funding stage, culture signals, product category
- [x] `analyzeProfile()` for each `ProfileInput` type:
  - `github_url` → calls adapter-github (built in Phase 2.3) for repos, languages, contributions
  - `linkedin_url` → Exa semantic lookup (or Pearch if configured)
  - `pasted_text` → LLM structured extraction
  - `name_company` → Exa search to find public profile data
  - `personal_url` → crawl and LLM analyze
- [x] `findSimilar()` → Exa `find_similar_and_contents()`
- [x] Similarity seeds generation from analyzable team member URLs
- **Acceptance:** Given a company URL, returns structured `CompanyIntel`. Given a GitHub URL, returns `ProfileAnalysis` with career patterns and skill signatures.

#### 3A.3 Intake Phases 1-4 ✅ (2026-03-24)
- [x] Phase 1 (Role Context): JD parsing, structured role parameter extraction, confirmation
- [x] Phase 2 (Company Intelligence): company URL analysis via ContentResearch, pitch extraction, competitor identification
- [x] Phase 3 (Success Profile): multi-input team member analysis, composite success profile generation, anti-pattern extraction
- [x] Phase 4 (Search Config Generation): tiered query generation, scoring weight proposal, enrichment priority, anti-filters
- [x] Search config output as YAML, presented for user review/editing in CLI
- [x] Talent profile output as JSON
- [x] Similarity seeds output as JSON
- **Acceptance:** Full intake conversation with real inputs produces a valid `search-config.yaml`, `talent-profile.json`, and `similarity-seeds.json`. User can review and edit the search config before proceeding.

### Phase 3B: AI Layer (Agent 2)
**Scope:** `packages/ai/` — provider abstraction, prompt templates, response caching
**Read-only:** `@sourcerer/core` types
**Sessions:** 1-2

#### 3B.1 Provider Abstraction ✅ (2026-03-24)
- [x] `AIProvider` interface implementation
- [x] Claude provider (via `@anthropic-ai/sdk`)
- [x] OpenAI provider (via `openai` SDK)
- [x] `structuredOutput<T>()` with Zod schema validation
- [x] Provider selection from config
- [x] Error handling: rate limits, token limits, provider outages
- **Acceptance:** Both Claude and OpenAI providers produce structured output for the same prompt+schema. Provider is selectable from config.

#### 3B.2 Prompt Templates ✅ (2026-03-24)
- [x] Template loader (reads `.md` files from `packages/ai/prompts/`)
- [x] Variable interpolation (candidate data, talent profile, evidence items)
- [x] `intake-role-parse.md`
- [x] `intake-company-analyze.md`
- [x] `intake-success-profile.md`
- [x] `intake-config-generate.md`
- [x] `scoring-signal-extract.md` — includes evidence grounding constraint
- [x] `scoring-narrative.md` — includes grounding constraint (only cite evidence items)
- **Acceptance:** All templates load and interpolate correctly. Signal extraction template explicitly constrains to evidence IDs.

#### 3B.3 Response Caching ✅ (2026-03-24)
- [x] Cache keyed by SHA-256 of input (prompt + model + schema)
- [x] File-based cache in `~/.sourcerer/cache/`
- [x] TTL configurable (default: 24h for enrichment-derived, 7d for scoring)
- [x] Cache bypass flag (`--no-cache`)
- **Acceptance:** Same input returns cached response on second call. Different input doesn't. Cache can be bypassed.

### Phase 3C: Integration (Sequential — merges 3A + 3B) ✅ (2026-03-24)
**Mode:** Sequential. After both agents complete.
**Sessions:** 1

- [x] Wire intake engine to use AI layer for all LLM calls
- [x] Wire content research to use AI layer for structured extraction
- [x] End-to-end test: `sourcerer intake` → full conversation → produces all 3 artifacts
- [x] End-to-end test: `sourcerer run` → intake → P0 similarity discovery → Exa search → JSON output
- **Acceptance:** Full pipeline from intake through Exa discovery produces deduplicated candidates with evidence items. Scoring is not yet implemented (stubs return placeholder scores). Intake uses AI layer, not direct API calls.

**End of Phase 3:** `/checkpoint` ✅ — Full intake → discovery pipeline working end-to-end.

---

## Phase 4: Enrichment Adapters

**Mode:** PARALLEL FORK (4A/4B/4C) then sequential orchestrator (4D). Use `/orchestrate`.

### Phase 4A: adapter-github enrichment hardening (Agent 1)
**Scope:** `packages/adapters/adapter-github/`
**Read-only:** `@sourcerer/core` types
**Sessions:** 1

adapter-github was built in Phase 2.3. This phase hardens it for production enrichment at scale:
- [x] `enrichBatch()` optimization for 50+ candidates (parallel with rate limit pooling) ✅ (2026-03-25)
- [x] Incremental enrichment: skip candidates already enriched by GitHub (check staleness) ✅ (2026-03-25)
- [x] Deeper contribution analysis: language distribution over time, OSS vs private ratio, commit frequency trends ✅ (2026-03-25)
- [x] Handle edge cases: private profiles, no public repos, rate limit exhaustion mid-batch ✅ (2026-03-25)
- [x] Integration test: enrichBatch with 20 candidates, verify partial failure handling ✅ (2026-03-25)
- **Acceptance:** Given 50 candidates, enrichBatch completes with proper rate limiting, handles 3+ failures gracefully, skips already-enriched candidates.

### Phase 4B: adapter-x (Agent 2)
**Scope:** `packages/adapters/adapter-x/`
**Read-only:** `@sourcerer/core` types
**Sessions:** 1-2

- [x] Implements `DataSource` with `capabilities: ['enrichment']` ✅ (2026-03-25)
- [x] `enrich()`: given a candidate with Twitter handle or URL ✅ (2026-03-25)
- [x] `enrichBatch()` with rate limiting per X API tier ✅ (2026-03-25)
- [x] Evidence item generation: each signal/fact becomes an `EvidenceItem` with `adapter: 'x'` ✅ (2026-03-25)
- [x] Handle: no X handle found, protected account, rate limits, API errors ✅ (2026-03-25)
- [x] Unit tests with mocked X API responses ✅ (2026-03-25)
- **Acceptance:** Given a Twitter handle, returns enriched profile with bio, recent tweets, engagement metrics, and extracted signals. Each fact is a properly sourced `EvidenceItem`.

### Phase 4C: adapter-hunter (Agent 3)
**Scope:** `packages/adapters/adapter-hunter/`
**Read-only:** `@sourcerer/core` types
**Sessions:** 1

- [x] Implements `DataSource` with `capabilities: ['enrichment']` ✅ (2026-03-25)
- [x] `enrich()`: email finder + verification ✅ (2026-03-25)
- [x] `enrichBatch()` with rate limiting (Hunter free tier: 25 searches/mo) ✅ (2026-03-25)
- [x] Evidence item generation: email + verification status as `EvidenceItem` ✅ (2026-03-25)
- [x] PII tagging: all emails as `PIIField` with `adapter: 'hunter'` ✅ (2026-03-25)
- [x] Handle: no results, unverifiable, rate limits, quota exhaustion ✅ (2026-03-25)
- [x] Unit tests with mocked Hunter API responses ✅ (2026-03-25)
- **Acceptance:** Given name + company, returns email if found with verification status. PII properly tagged. Handles quota exhaustion gracefully.

### Phase 4D: Enrichment Orchestrator (Sequential — needs all adapters)
**Sessions:** 1

- [x] Parallel enrichment execution: run all configured adapters simultaneously per candidate ✅ (2026-03-25)
- [x] Priority ordering: run cheap/fast adapters first (GitHub), expensive later (Pearch, PDL) ✅ (2026-03-25)
- [x] Conditional execution: skip expensive adapters if cheap ones produced enough signal ✅ (2026-03-25)
- [x] Budget gate: estimate enrichment cost before running, skip if over budget ✅ (2026-03-25)
- [x] Incremental enrichment: on rerun, skip already-enriched candidates (check staleness threshold) ✅ (2026-03-25)
- [x] Partial failure handling: if Hunter fails, GitHub results still saved ✅ (2026-03-25)
- [x] Aggregate evidence items from all adapters into candidate's `EvidenceItem[]` ✅ (2026-03-25)
- [x] Aggregate PII fields from all adapters into candidate's `PIIMetadata` ✅ (2026-03-25)
- [x] Cross-source identity linking: if GitHub email matches Hunter email, merge identities ✅ (2026-03-25)
- **Acceptance:** Given 20 candidates, orchestrator runs GitHub + X + Hunter in parallel, respects rate limits, handles partial failures, produces fully enriched candidates with merged evidence.

**End of Phase 4:** `/checkpoint` — Full pipeline: intake → discovery → enrichment → JSON output with multi-source evidence.

---

## Phase 5: Scoring Engine

**Mode:** Sequential. Depends on enrichment producing evidence items.
**Sessions:** 2-3
**Start command:** `/session-start`

### 5.1 Signal Extraction
- [x] LLM receives: enriched candidate data, talent profile, list of `EvidenceItem` IDs + claims ✅ (2026-03-25)
- [x] Structured output: `ExtractedSignals` with `evidenceIds` per dimension ✅ (2026-03-25)
- [x] Evidence grounding validation: scorer rejects any `evidenceId` not in the canonical set ✅ (2026-03-25)
- [x] Red flag extraction with severity and evidence ✅ (2026-03-25)
- [x] Prompt template: `scoring-signal-extract.md` with grounding constraint ✅ (2026-03-25)
- **Acceptance:** Given a candidate with 10 evidence items, LLM produces `ExtractedSignals` referencing only valid IDs. If LLM hallucinates an ID, the scorer rejects that signal.

### 5.2 Weighted Scoring Calculator
- [x] Reads scoring weights from search config ✅ (2026-03-25)
- [x] Applies weights to signal scores: `raw * weight * 10` per dimension ✅ (2026-03-25)
- [x] Aggregates to 0-100 total score ✅ (2026-03-25)
- [x] Generates `ScoreComponent[]` with `evidenceIds` (passed through from signals) ✅ (2026-03-25)
- [x] Red flags reduce total score by configurable penalties ✅ (2026-03-25)
- **Acceptance:** Given signals with weights {technical: 0.3, domain: 0.25, trajectory: 0.2, culture: 0.15, reachability: 0.1}, produces correct weighted total. Evidence IDs pass through correctly.

### 5.3 Narrative Generation
- [x] LLM receives ONLY: `EvidenceItem[]` + `ScoreComponent[]` + talent profile summary ✅ (2026-03-25)
- [x] Prompt template: `scoring-narrative.md` with explicit grounding constraint ✅ (2026-03-25)
- [x] Output: natural language paragraph per candidate ✅ (2026-03-25)
- [ ] Validation: spot-check that narrative claims map to evidence items (log warning if unmappable claim detected)
- **Acceptance:** Generated narrative for a candidate references only facts present in evidence items. No fabricated details.

### 5.4 Tiering
- [x] Configurable thresholds (default: Tier 1 ≥ 70, Tier 2 ≥ 40, Tier 3 < 40) ✅ (2026-03-25)
- [x] Thresholds editable in search config ✅ (2026-03-25)
- **Acceptance:** Candidates are correctly tiered based on total score.

### 5.5 Re-scoring Flow
- [ ] `sourcerer score` command re-runs scoring on existing enriched candidates
- [ ] Does NOT re-run discovery or enrichment (cheap operation)
- [x] Signal extraction re-runs only if evidence changed; otherwise uses cached signals (provider caching handles this) ✅ (2026-03-25)
- [x] Math + narrative regeneration always runs ✅ (2026-03-25)
- [ ] Updated candidates written back to run artifacts
- **Acceptance:** User adjusts weights in search config, runs `sourcerer score`, gets re-ranked candidates with new narratives. No API calls to data sources.

**End of Phase 5:** `/checkpoint` — Full pipeline: intake → discovery → enrichment → grounded scoring → tiered output.

---

## Phase 6: Output Adapters

**Mode:** PARALLEL FORK. Independent adapters, no shared state. Use `/orchestrate`.

### Phase 6A: output-csv (Agent 1) ✅ (2026-04-06)
**Scope:** `packages/output/output-csv/`
**Sessions:** 1

- [x] Flattened CSV with columns: Name, Score, Tier, Current Role, Company, Email, Top 3 Signals, Narrative (truncated), LinkedIn URL, GitHub URL, Low Confidence Merge
- [x] Excel-compatible encoding (UTF-8 BOM, proper escaping via csv-stringify)
- [x] Sorted by score descending
- [x] `push()` writes file. `upsert()` overwrites file.
- **Acceptance:** Generates valid CSV that opens correctly in Excel and Google Sheets. All fields properly escaped. 29 tests.

### Phase 6B: output-notion (Agent 2) ✅ (2026-04-06)
**Scope:** `packages/output/output-notion/`
**Sessions:** 1

- [x] Create Notion database if not exists (properties: Name, Score, Tier, Role, Company, Email, Status, Low Confidence Merge, CandidateId, PushedAt)
- [x] Create page per candidate (body: narrative callout → score breakdown table → evidence bullets → red flags callout → profile links)
- [x] `upsert()`: match by candidate ID stored in CandidateId property, update existing pages
- [x] Track push history: PushedAt date property records when each candidate was last synced
- [x] Handle: Notion API rate limits (token bucket 3 req/sec + exponential backoff), parent-page-scoped DB search
- **Acceptance:** Given 20 candidates, creates Notion DB with pages. Re-running upserts existing candidates (updates score/tier), creates new candidates. No duplicates. 27 tests.

### Phase 6C: output-sheets — DEFERRED TO PHASE 7

Google Sheets OAuth (credential setup, consent screen, token refresh, secure storage of refresh tokens) is significantly more complex than other output adapters. Deferred to Phase 7 to avoid blocking Phase 6 completion. V1 ships with CSV + Notion + JSON + Markdown — four output formats is sufficient for launch.

### Phase 6D: CLI Results Display ✅ (2026-04-06)
**Scope:** `apps/cli/` — results rendering
**Sessions:** 1

- [x] `sourcerer results` — terminal display of last run results
- [x] Candidate cards with score, tier, role, company, top signals, low-confidence merge badge
- [x] `--tier` filtering
- [x] `--push <adapter>` — re-push to a different output from existing results
- [x] Shared adapter registry (`adapter-registry.ts`) used by both `run` and `results` commands
- **Acceptance:** `sourcerer results --tier 1` shows only Tier 1 candidates with formatted cards. 14 new tests.

**End of Phase 6:** `/checkpoint` ✅ — All output adapters working. Full pipeline delivers results to CSV, Notion, JSON, Markdown, and terminal. (Sheets deferred to Phase 7.)

---

## Phase 7: Polish & Advanced Features

**Mode:** Mix of parallel and sequential. Items are largely independent.
**Sessions:** 3-4 total
**Start command:** `/session-start`

### 7.1 Budget Estimation
- [ ] `estimateCost()` aggregated across all configured adapters before execution
- [ ] CLI displays: "Estimated cost: ~$X (Exa: $Y, Hunter: $Z, AI: $W). Proceed? [y/n]"
- [ ] Actual cost tracked in `run-meta.json` and compared to estimate after run

### 7.2 Post-Discovery Expansion (`find_similar`)
**Note:** The design spec (Section 4.3) treats this as part of core discovery. It is intentionally deferred from the core pipeline to Phase 7 because P0 similarity (from success profile seeds, built in Phase 3) covers the highest-value use case. Post-discovery expansion is opt-in enhancement, not essential for V1 success criteria.
- [ ] After initial scoring, take candidates with score 7+ and run `find_similar()` on their personal URLs
- [ ] Bounded recursion: configurable depth limit (default: 1)
- [ ] New candidates flow through enrichment → scoring → output
- [ ] Cost estimate includes expansion

### 7.3 Non-Interactive Mode
- [ ] `--yes` flag bypasses all confirmations
- [ ] `--no-interactive` uses config file for all inputs (no prompts)
- [ ] `sourcerer run --config ./config.yaml --output json,notion --yes`
- [ ] Enables scripting and scheduled re-runs

### 7.4 Run Management
- [ ] `sourcerer runs` — list all previous runs with date, role, candidate count, tier breakdown
- [ ] `sourcerer runs clean --older-than 30d` — remove old run artifacts
- [ ] `sourcerer candidates delete <id>` — delete candidate locally + warn about remote copies
- [ ] `sourcerer candidates purge --expired` — remove PII-expired candidates

### 7.5 Premium Adapters (Parallel — each independent)
- [ ] `adapter-pearch` — 810M+ structured profiles, credit-based
- [ ] `adapter-pdl` — PeopleDataLabs broad professional data
- [ ] `adapter-contactout` — 300M+ contacts with emails + phone

### 7.6 output-sheets (Deferred from Phase 6)
- [ ] Google OAuth flow (service account approach for V1 — simpler than full OAuth2 redirect)
- [ ] Create sheet per run (tab named with date + role)
- [ ] Master tab that accumulates across runs with dedup
- [ ] `upsert()`: match by candidate ID in Master tab, update existing rows
- [ ] Handle: Sheets API rate limits, large batch writes

### 7.7 Advanced Intake Features
- [ ] Competitor mapping deep feature (identify companies → extract their team profiles → seed queries)
- [ ] Anti-pattern filtering ("who didn't work out" → negative signals in scoring)

**End of Phase 7:** `/session-end` — V1 complete. Full pipeline with budget awareness, expansion, premium adapters, and run management.

---

## Beyond V1 (Lower Detail — Adapts as We Learn)

These are directional, not planned. Build order and scope will be informed by V1 usage.

- **Local cache adapter** — enriched candidates persist across runs, Sourcerer gets smarter over time
- **Cross-run learning** — "last time you sourced backend engineers, P2 queries outperformed P1"
- **Shareable scoring rubrics** — exportable configs for common role types
- **Plugin system** — community-built adapters
- **Web dashboard** — `@sourcerer/dashboard` for teams who want visual management
- **MCP server** — use Sourcerer as a tool from any AI agent

---

## Session Workflow Integration

### Starting a Phase

```
/session-start
→ Review roadmap progress
→ Identify next phase/task
→ Verify prerequisites from prior phases
→ Begin work
```

### Parallel Phases (3A/3B, 4A/4B/4C, 6A/6B/6C)

```
/orchestrate
→ Launch parallel agents with:
  - Assigned package scope (each agent owns specific directories)
  - Read-only access to @sourcerer/core types
  - No cross-agent file edits
  - Each agent runs its own tests
→ Monitor progress
→ When all agents complete:
  - Verify all outputs exist
  - Run full test suite
  - Resolve any conflicts
  - Integration merge session
```

### Mid-Session Saves

```
/checkpoint
→ At every phase boundary (marked in roadmap)
→ Verify: tests pass, artifacts generated, no regressions
→ Commit completed phase
→ Update this roadmap with status
```

### Ending a Session

```
/session-end
→ Run full test suite
→ Commit changes
→ Update roadmap status
→ Note any carryover for next session
```

### Agent Boundaries for Parallel Phases

| Phase | Agent 1 | Agent 2 | Agent 3 | Shared (read-only) |
|-------|---------|---------|---------|---------------------|
| 3A/3B | `packages/intake/` | `packages/ai/` | — | `@sourcerer/core` types, `adapter-exa`, `adapter-github` |
| 4A/4B/4C | `adapter-github/` (hardening) | `adapter-x/` | `adapter-hunter/` | `@sourcerer/core` types |
| 6A/6B/6D | `output-csv/` | `output-notion/` | CLI results display | `@sourcerer/core` types, scored candidate data |

**Rule:** Agents NEVER edit files outside their assigned scope. If an agent discovers a needed change to `@sourcerer/core`, it flags the change — the coordinator applies it after the parallel phase.

---

## Risk Register

| Risk | Severity | Phase | Mitigation | Fallback |
|------|----------|-------|------------|----------|
| Exa API changes or pricing shifts | Medium | 2+ | Pin Exa SDK version, wrap in adapter | Pearch as alternate primary discovery |
| X/Twitter API access restrictions | Medium | 4B | Rate limit carefully, handle 403s | Degrade gracefully — skip X enrichment, rely on GitHub + Hunter |
| LLM grounding constraint doesn't hold | High | 5 | Validate evidence IDs programmatically, reject bad signals. Run a manual grounding test in Phase 3C with fixture evidence to validate the approach early. | Stricter prompt engineering + validation pass. Worst case: manual review flag on ungrounded claims |
| Identity resolution over-merges | Medium | 1.3+ | Conservative defaults (high-confidence only auto-merge) | Manual confirmation mode for all merges |
| Notion API rate limits on large runs | Low | 6B | Batch writes with exponential backoff | Fall back to JSON + manual import |
| Intake conversation feels robotic | Medium | 3A | Invest in prompt quality, test with real hiring managers | Simplify to fewer, better questions. Quality over breadth. |
| Premium adapter costs surprise users | Low | 7.5 | Always show cost estimate before execution | Default to free/cheap adapters only |

---

## Out of Scope (V1)

Explicitly NOT building in V1:

- [ ] Web dashboard
- [ ] Automated outreach (email/DM sending)
- [ ] ATS integrations (Greenhouse, Lever, etc.)
- [ ] Multi-user/team collaboration
- [ ] Automated GDPR/compliance workflows (design primitives are in place, full automation is not)
- [ ] LinkedIn scraping
- [ ] Real-time monitoring / candidate alerts
- [ ] Billing or payment processing
- [ ] Mobile interface
- [ ] GitHub as a discovery source (GitHub is enrichment-only; Exa handles discovery)

---

## Validation Log

**2026-03-20 — Internal Validation**
- **Verdict:** APPROVED WITH CHANGES
- **Findings:** 2 critical, 7 important, 2 minor
- **Changes applied:**
  - (Critical) Phase 3C acceptance criteria fixed — removed "scored candidates" reference, scoring is Phase 5
  - (Critical) adapter-github moved from Phase 4A to Phase 2.3 — eliminates forward dependency from intake's ContentResearch
  - (Important) `AIProvider` and `ContentResearch` interfaces added to Phase 1.2 core — enables independent parallel work in Phase 3
  - (Important) Identity resolution acceptance criteria expanded — idempotent re-merge, parallel source order independence, unmerge explicitly out of scope
  - (Important) adapter-exa and adapter-github added to Phase 3A read-only dependencies
  - (Important) Test protocol task (1.7) added to Phase 1 — benchmark fixtures, cost tracking instrumentation
  - (Important) Google Sheets deferred from Phase 6C to Phase 7.6 — OAuth complexity underscoped
  - (Important) Post-discovery expansion (7.2) annotated as intentional V1 deferral from spec
  - (Minor) Phase 2.5 smoke test reworded — "Partial pipeline" not "Full pipeline"
  - (Minor) find_similar unit test added to Phase 2.5 acceptance
  - Success criterion #3 clarified — GitHub is enrichment, not discovery
  - Success criterion #6 updated — Google Sheets moved to Phase 7
