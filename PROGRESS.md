# Progress — Sourcerer

---

## Session: 2026-03-23 16:00 — PROJECT_STATE.md

### Completed
- Created `PROJECT_STATE.md` — cross-surface context sync document modeled after Walters/SF School Navigator/Sunday Dinner/ABC patterns
- Covers: project overview, stack, architecture, current state (phase table), recent decisions, known issues, what's next, V1 success criteria, cross-surface notes

### In Progress
- Nothing — this was a documentation-only session

### Issues Encountered
- None

### Next Session Should
- **Phase 2.4:** output-json + output-markdown (implement `OutputAdapter` interface for both)
- **Phase 2.5:** End-to-end smoke test (Exa search → dedup → JSON output with hand-written search config)
- Then Phase 3: Intake Engine + AI Layer (parallel fork with `/orchestrate`)

---

## Session: 2026-03-23 — Phases 1.2 through 2.3

### Completed
- **Phase 1.2:** 40+ core types/interfaces (identity, evidence, scoring, candidate, pipeline, AI, intake)
- **Phase 1.3:** IdentityResolver with 4-pass merge algorithm (high → cross-source → medium → low confidence)
- **Phase 1.4:** PipelineRunner with handler injection, checkpoint/resume, cost tracking, run artifacts
- **Phase 1.5:** Config system (SourcererConfig, validateConfig, applyDefaults, ConfigValidationError)
- **Phase 1.6:** CLI skeleton (10 commands, config status, help/version)
- **Phase 1.7:** Test protocol, benchmark fixtures, dedup test candidates
- **Phase 2.1:** Onboarding wizard (sourcerer init, config show, config reset, @inquirer/prompts)
- **Phase 2.2:** adapter-exa (DataSource: search, enrich, findSimilar, rate limiting, evidence grounding)
- **Phase 2.3:** adapter-github (enrichment-only: profile, repos, languages, commit emails, PII tagging)

### Stats
- **Tests:** 0 → 171 passing (+171), 0 failures
- **Packages:** 8 → 9 (added adapter-github)
- **Files created:** ~35 new source files
- **Build:** 9/9, Typecheck: 16/16, Test: 17/17

### Issues Encountered
- Vitest 3.x exits 1 with no test files (fixed with passWithNoTests in Phase 1.1)
- Exa SDK uses named export `Exa` not default (fixed import)
- Gmail dot normalization needed for email dedup accuracy
- Levenshtein threshold for company names: "Chainlink Labs" vs "Chainlink" = distance 5, exceeds threshold 3

### Next Session Should
- **Phase 2.4:** output-json + output-markdown (OutputAdapter implementations)
- **Phase 2.5:** End-to-end smoke test (Exa search → dedup → JSON output)
- Then Phase 3: Intake Engine + AI Layer (parallel fork)

---

## Session: 2026-03-23 (cont.) — Phase 2.3: adapter-github

### Completed
- Scaffolded new `@sourcerer/adapter-github` package (package.json, tsconfig, vitest)
- `GitHubAdapter` class implementing `DataSource` with `capabilities: ['enrichment']`
- `enrich()`: fetches user profile + top 20 repos + commits from top 3 starred repos
- Email extraction from commits: filters noreply, prefers personal over company, deduplicates
- Language distribution: top 5 languages from non-forked repos
- Evidence items for: profile overview, bio, languages, commit activity, top repos, emails
- PII tagging for all extracted emails
- `GitHubClient`: bare `fetch()` wrapper for GitHub REST API v3 (zero external deps)
- `enrichBatch()` with sequential rate limiting
- `healthCheck()` via rate_limit endpoint, `estimateCost()` returns $0 (free API)
- `search()` throws — enrichment-only adapter
- 14 new tests with mocked `global.fetch`, **171 total tests passing**

### Next Session Should
- Phase 2.4: output-json + output-markdown (OutputAdapter implementations)

---

## Session: 2026-03-23 (cont.) — Phase 2.2: adapter-exa

### Completed
- `ExaAdapter` class implementing full `DataSource` interface from `@sourcerer/core`
- `search()` as AsyncGenerator<SearchPage>: P0 similarity seeds first, then P1-P4 tiered queries with rate limiting
- `findSimilar()` wrapping Exa's `findSimilar` API with provenance tracking in evidence items
- `enrich()` and `enrichBatch()` for URL content enrichment via `getContents()`
- `healthCheck()` and `estimateCost()` implementations
- `parsers.ts` — identifier extraction from Exa results (LinkedIn, GitHub, Twitter, email, personal URL)
- `rate-limiter.ts` — simple delay-based rate limiter (timestamp-based, no deps)
- Evidence grounding: every discovery/enrichment result generates `EvidenceItem` via `generateEvidenceId()`
- Added `exa-js` SDK dependency
- 20 new tests with fully mocked Exa SDK, **157 total tests passing** (118 core + 19 CLI + 20 exa)

### Next Session Should
- Phase 2.3: adapter-github (enrichment-only DataSource)

---

## Session: 2026-03-23 (cont.) — Phase 2.1: Onboarding Wizard

### Completed
- `sourcerer init` interactive wizard: AI provider selection, Exa key entry, optional adapter multi-select, per-adapter key walkthrough, defaults (TTL, budget), config summary
- `sourcerer config show` displays config YAML with redacted API keys
- `sourcerer config reset` re-runs init wizard
- Added `@inquirer/prompts` dependency for interactive CLI prompts
- `init` removed from stub commands, routed to real handler
- Adapter metadata with names, descriptions, costs, signup URLs
- Existing config overwrite confirmation
- 7 new tests, **137 total tests passing** (118 core + 19 CLI)

### Next Session Should
- Phase 2.2: adapter-exa (DataSource implementation)

---

## Session: 2026-03-23 (cont.) — Phase 1.7: Test Protocol

### Completed
- Benchmark role fixture (`test-fixtures/benchmark-role.json`): "Senior Backend Engineer for DeFi startup" with known-good and known-bad candidate profiles, expected scores and tiers
- Dedup test candidates fixture (`test-fixtures/dedup-candidates.json`): 10 candidates representing 5 real people across 3 merge groups + 1 single + 1 similar-but-different non-merge
- Integration test (`dedup-fixtures.test.ts`): loads fixture, verifies merge groups, confirms non-merge, checks idempotency
- Test protocol document (`docs/test-protocol.md`): manual validation protocol for Tier 1 precision, dedup accuracy, cost per run
- Cost tracking already wired from Phase 1.4: `SearchPage.costIncurred`, `BatchResult.costIncurred`, `CostTracker`, `RunMeta.cost`
- 4 new fixture tests, **130 total tests passing** (118 core + 12 CLI)

### Phase 1 Complete!
All 7 sub-phases (1.1-1.7) done. Foundation is solid:
- 40+ types/interfaces, identity resolver, pipeline runner, config system, CLI skeleton
- 130 tests passing, 0 failures
- Ready for Phase 2: Onboarding + First Adapter (Exa + GitHub)

---

## Session: 2026-03-23 (cont.) — Phase 1.6: CLI Skeleton

### Completed
- Command dispatcher with argv-based routing (no framework, 10 commands)
- `sourcerer --help` shows all commands with descriptions
- `sourcerer --version` shows version
- `sourcerer config status` reads `~/.sourcerer/config.yaml`, validates, displays adapter status table
- All other commands (init, intake, run, discover, enrich, score, results, runs, candidates) print "not yet implemented"
- `config-io.ts` — YAML file I/O bridge (js-yaml → core's validateConfig)
- Unknown commands show helpful error with suggestion
- Added `js-yaml` and `chalk` dependencies to CLI
- 12 new tests, **126 total tests passing** (114 core + 12 CLI)

### Next Session Should
- Build test protocol (Phase 1.7) — benchmark fixtures, cost tracking instrumentation
- Then Phase 2: Onboarding wizard + first adapter (Exa) + adapter-github

---

## Session: 2026-03-23 (cont.) — Phase 1.5: Config System

### Completed
- `SourcererConfig` type with adapter configs, AI provider, retention TTL, budget defaults
- `validateConfig(raw: unknown)` with multi-error collection and clear messages
- `ConfigValidationError` class with `errors: string[]` field
- `applyDefaults()` for missing optionals (90-day retention, GitHub auto-enabled, JSON output)
- `getConfiguredAdapters()` and `getAdapterApiKey()` utilities
- Constants: `CONFIG_PATH`, `KNOWN_ADAPTERS`, `AI_PROVIDER_NAMES`
- Core remains zero-dep — validation operates on parsed JS objects, YAML I/O deferred to CLI
- 19 new tests, **114 total tests passing** across core

### Next Session Should
- Build CLI skeleton (Phase 1.6) — command routing, `sourcerer config status`, prompt library
- Build test protocol (Phase 1.7) — benchmark fixtures, cost tracking instrumentation

---

## Session: 2026-03-23 (cont.) — Phase 1.4: Pipeline Runner

### Completed
- Built PipelineRunner class with handler injection pattern: each phase accepts a `PhaseHandler<TInput, TOutput>`
- Typed phase chain: intake → discover → dedup → enrich → score → output with compile-time verified data flow
- Checkpoint system: JSON serialization to disk after each phase, loadable for resume
- Resume logic: loads checkpoint, restores cost state, starts from phase after last completed
- CostTracker class: per-phase and per-adapter cost accumulation, budget enforcement
- Run artifact management: `YYYY-MM-DD-<role>` directories, `run-meta.json`, `evidence/` subdir, `writeArtifact` helper
- `createDedupHandler()` factory wiring IdentityResolver as the built-in dedup phase handler
- Partial failure handling: `partial` status stores successes, logs failures, downstream continues
- 5 new files: `pipeline-types.ts`, `cost-tracker.ts`, `run-artifacts.ts`, `checkpoint.ts`, `pipeline-runner.ts`
- 26 new tests, **95 total tests passing** across core (21 types + 48 identity resolver + 26 pipeline runner)

### Design Decisions
- Handler injection pattern over monolithic runner — later phases plug in without modifying runner
- Simple `for` loop over `PHASE_ORDER` instead of graph-based state machine — pipeline is always linear
- Checkpoint written after full phase (not intra-phase) — acceptable at V1 scale
- `PhaseResult.failures[].error` is `string` not `Error` for JSON serialization survival

### Next Session Should
- Build config system (Phase 1.5) — `~/.sourcerer/config.yaml` read/write, validation
- Build CLI skeleton (Phase 1.6) — command routing, `@clack/prompts` integration
- Build test protocol (Phase 1.7) — benchmark fixtures, cost tracking instrumentation

---

## Session: 2026-03-23 (cont.) — Phase 1.3: Identity Resolution Engine

### Completed
- Implemented `IdentityResolver` class in `@sourcerer/core` with 4-pass merge algorithm:
  - Pass 1: High-confidence index-based merges (LinkedIn URL, email, GitHub username)
  - Pass 2: Cross-source email linking (same email from different adapters)
  - Pass 3: Medium-confidence (same name + same company, different sources)
  - Pass 4: Low-confidence (similar name + similar company) — collected as `PendingMerge`, not auto-applied
- Deterministic `canonicalId` generation via SHA-256 hash of sorted normalized identifiers (UUID format)
- Normalization functions for all 6 identifier types (LinkedIn URL, email, GitHub, Twitter, personal_url, name_company)
  - Gmail dot/plus normalization, LinkedIn hyphen stripping, GitHub URL/handle normalization
- `namesMatch()` with first/last reorder, `namesSimilar()` via Levenshtein distance
- `name_company` value format convention: pipe separator `"Name|Company"`
- Exported types: `MergeRule`, `MergeReason`, `MergeDecision`, `PendingMerge`, `ResolveResult`
- 48 tests covering all merge rules, normalization, acceptance criteria, edge cases
- Total: 69 tests passing (21 from Phase 1.2 + 48 new), 0 failures

### Design Decisions
- `node:crypto` for SHA-256 hashing (zero external deps, Node 22+)
- `name_company` excluded from canonicalId hash (too volatile), with fallback if no other identifiers exist
- Low-confidence merges collected but NOT applied in V1 (conservative default per risk register)
- O(n²) pairwise comparison acceptable for V1 scale (50-200 candidates)

### Next Session Should
- Build pipeline runner with checkpoint/resume (Phase 1.4)
- Build config system (Phase 1.5)
- Build CLI skeleton (Phase 1.6)

---

## Session: 2026-03-23 — Phase 1.2: Core Interfaces

### Completed
- Defined all core types and interfaces in `@sourcerer/core` (7 domain files + barrel index)
- File organization: `identity.ts`, `evidence.ts`, `scoring.ts`, `candidate.ts`, `pipeline.ts`, `ai.ts`, `intake.ts`
- ~40 exported types/interfaces covering: identity resolution, evidence grounding, candidate lifecycle, scoring, pipeline adapters, AI provider, intake engine, search config, talent profile
- `generateEvidenceId()` — deterministic `ev-XXXXXX` ID generation (djb2 hash, zero deps)
- Design decision: `Record<string, X>` over `Map<string, X>` for JSON serialization compatibility
- `ScoredCandidate extends Candidate` with required score fields for type-safe output adapters
- `EnrichmentResult` co-located in `candidate.ts` to avoid circular imports
- 21 acceptance tests passing: type construction, evidence ID determinism, grounding constraint validation
- All 15 typecheck tasks pass, all 16 test tasks pass, all 8 build tasks pass

### Design Decisions
- `Record` over `Map` for adapter-keyed data (JSON serialization)
- `AIProvider.structuredOutput` schema typed as `unknown` (core is zero-dep, narrowed in `@sourcerer/ai`)
- Evidence grounding encoded in types: `ScoreComponent.evidenceIds` and `RedFlag.evidenceId` reference `EvidenceItem.id`

### Next Session Should
- Build identity resolution engine (Phase 1.3) — `IdentityResolver` class with confidence-based merging
- Build pipeline runner with checkpoint/resume (Phase 1.4)
- Build config system (Phase 1.5)
- Build CLI skeleton (Phase 1.6)

