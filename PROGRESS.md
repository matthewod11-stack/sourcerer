# Progress — Sourcerer

---

## Session: 2026-04-06 09:25 — Phase 6 Output Adapters + Issue #3

### Completed
- **Phase 6A: output-csv** — `@sourcerer/output-csv` package with `CsvOutputAdapter`, `csv-stringify` RFC 4180 rendering, UTF-8 BOM, field extractors (role/company from rawProfile, email from PII/identifiers, top signals, LinkedIn/GitHub URLs). 29 tests.
- **Phase 6B: output-notion** — `@sourcerer/output-notion` package with `NotionOutputAdapter`, find-or-create database, page-per-candidate (narrative callout, score table, evidence bullets, red flags, profile links), upsert by CandidateId, token bucket rate limiter (3 req/sec + exponential backoff). 27 tests.
- **Phase 6D: CLI results display** — `sourcerer results` command with `--tier` filtering, `--push` re-export, `--run` directory selection, `--json` scripting output. Run loader, candidate card formatter, summary table, shared adapter registry. 14 new tests.
- **Integration:** CLI package.json/tsconfig updated with new packages, `run.ts` refactored to use shared `adapter-registry.ts`, `results` removed from stubs.
- **Issue #3 (closed):** Low-confidence identity merges now auto-merge with `lowConfidenceMerge` flag on `PersonIdentity`. `mergeConfidence` is now meaningful (1.0 single / 0.95 high-medium / 0.7 low). Flag surfaced in all 5 output formats.
- **Code review fixes:** Notion rate-limit retry loop (max 2), DB search scoped to parent page, GitHub username → URL in page builder, `findLatestRunDir` filters to directories, Notion credential error messaging, CLI tsconfig adapter references added.

### Test Results
- 570 tests passing, 0 failing across 13 packages (baseline was ~306 at start)

### Issues Encountered
- Worktree agents didn't auto-commit — copied files manually from worktree paths
- Vercel plugin hooks fired false positives throughout (not a Next.js project)

### Next Session Should
- **Phase 7:** Polish & advanced features — output-sheets (deferred from Phase 6), post-discovery expansion, premium adapters
- Update `docs/roadmap.md` to check off Phase 6 items
- Live smoke test with real API keys (still pending from Phase 5)
- Issue #1 (LinkedIn/Pearch) and #4 (Google Sheets OAuth) remain deferred

---

## Session: 2026-03-30 08:15 — Local Overnight Agent Setup

### Completed
- **Adapted overnight agent for Desktop local task:** Updated `docs/OVERNIGHT_AGENT.md` header from remote trigger → Desktop local scheduled task, added state log reference
- **Created `prompts/overnight-agent.md`:** Thin Desktop task entry point, points to docs for full prompt, defines JSON run log format for `state/overnight-agent-log.json`
- **Created `state/` directory** for runtime artifacts (overnight agent logs)
- **Updated `.gitignore`:** Added `state/` to prevent committing runtime artifacts
- **Updated `CLAUDE.md`:** Added overnight agent files to Key Files section

### Issues Encountered
- None

### Next Session Should
- **Phase 6:** Output adapters (output-csv, output-notion, CLI results display) — the current roadmap priority
- Create Desktop local task manually (config reported in session)
- Live smoke test with real API keys still pending from Phase 5

---

## Session: 2026-03-30 07:40 — Issue-Driven Maintenance Setup

### Completed
- **GitHub labels:** Created 5 labels (`tech-debt`, `needs-design-decision`, `deferred`, `in-progress`, `testing`)
- **KNOWN-ISSUES.md → GitHub Issues:** Migrated 4 items, skipped 1 resolved (fake Zod schemas)
  - #1: LinkedIn data access (`deferred`) — external API limitation
  - #2: LLM evidence grounding runtime validation (`tech-debt`) — agent-fixable
  - #3: Low-confidence identity merge strategy (`needs-design-decision`) — needs human input
  - #4: Google Sheets OAuth (`deferred`) — complexity, moved to Phase 7
- **Deleted KNOWN-ISSUES.md** — GitHub Issues is now the single source of truth
- **docs/OVERNIGHT_AGENT.md:** Full autonomous agent prompt adapted from CatRunner template for pnpm/Turborepo/vitest stack, with triple gate (build + test + typecheck), monorepo safety rails, and issue template
- **Scheduler:** Attempted to create nightly trigger but hit 3-trigger plan limit (CatRunner, Barron, Dreamofhyperparameters already using all slots)

### Issues Encountered
- Plan limit of 3 scheduled triggers — cannot add Sourcerer overnight agent without removing one

### Next Session Should
- **Phase 6:** Output adapters (output-csv, output-notion, CLI results display) — the current roadmap priority
- Consider freeing a scheduler slot for Sourcerer if CatRunner one-shot is complete
- Live smoke test with real API keys still pending from Phase 5

---

## Session: 2026-03-26 08:00 — Data Source Strategy Research

### Completed
- **Git pull:** Synced 96 files changed from previous session (Phases 4-5 work)
- **Environment fix:** Ran `pnpm install` to resolve missing `node_modules` in new packages (adapter-x, adapter-hunter)
- **Data source research:** Deep research into Apify actor store and alternative sourcing APIs using parallel research agents
- **Strategy document:** Wrote formal data source strategy addendum at `docs/specs/2026-03-26-data-source-strategy.md`
  - 4 Tier 1 adapters: adapter-apollo (free, replaces Hunter for email), adapter-apify (LinkedIn + Google, $50/mo budget), enricher-stackoverflow (free), enricher-ecosystems (free)
  - 4 Tier 2 options: Pearch, PDL, Semantic Scholar, DEV.to
  - Tier 3 skips with rationale (ContactOut, RocketReach, Clearbit/Breeze dead, Proxycurl dead)
  - Implementation sequence (Phase 8A-8D), architecture, config changes, legal considerations

### Issues Encountered
- Vercel plugin hooks keep firing for Next.js/Vercel skills (auth, chat-sdk, etc.) despite this being a CLI project — false positives, no impact on work
- `adapter-x` build failed after pull due to missing `node_modules` — fixed by `pnpm install`

### Next Session Should
- **Phase 6:** Output adapters (output-csv, output-notion, CLI results display) — the current roadmap priority
- Consider integrating the data source strategy into the main roadmap as Phase 8 (or reorganize Phases 7/8)
- When building Phase 8: start with `adapter-apollo` (free, highest ROI, replaces Hunter for email)
- Live smoke test with real API keys still pending from Phase 5

---

## Session: 2026-03-25 13:30 — Phase 4 + Phase 5 (Enrichment Adapters + Scoring Engine)

### Completed
- **Phase 4A:** adapter-github hardening — parallel enrichBatch with semaphore concurrency, incremental enrichment (TTL skip), rate limit exhaustion handling, deeper contribution analysis (OSS ratio, commit frequency, language trends). 14 → 32 tests.
- **Phase 4B:** adapter-x (new package) — Twitter/X enrichment with tier-aware rate limiting, profile + tweet evidence, engagement metrics, technical content detection. 26 tests.
- **Phase 4C:** adapter-hunter (new package) — Hunter.io email finder + verifier, PII tagging, quota tracking with exhaustion guard. 19 tests.
- **Phase 4D:** Enrichment orchestrator — parallel cheap adapter execution, conditional expensive adapter gating, budget gate (actually skips, not just warns), incremental enrichment, post-enrichment cross-candidate identity merging. 5 new CLI tests.
- **Phase 4 review fixes:** 5 findings addressed — GitHub rate limiting at HTTP level, real cross-candidate identity merging, stale re-enrichment dedup, budget gate enforcement, Hunter cost accuracy.
- **Phase 5.1:** Signal extraction — LLM-driven `ExtractedSignals` with Zod schema validation, evidence grounding validator (strips hallucinated IDs, adjusts confidence). 16 tests.
- **Phase 5.2:** Score math — weighted scoring with configurable red flag penalties, `ScoreComponent` breakdown, tier assignment. 11 tests.
- **Phase 5.3:** Narrative generation — LLM narrative with evidence citations via `provider.chat()`. 8 tests.
- **Phase 5.5:** CLI wiring — `createScoreHandler` replaces stub in pipeline, AI provider instantiated in run command. Stub kept for test use.

- **Phase 5 review fixes:** 5 findings addressed — score math scale (removed ×10), confidence gates score contribution, GitHub sequential processing, identity merge includes observedIdentifiers, score handler fault isolation + cost tracking.

### Stats
- **Tests:** 394 → 498 (+104 new tests)
- **New packages:** adapter-x, adapter-hunter (2 fully built)
- **Packages substantially modified:** adapter-github (hardened), scoring (built from empty), cli (orchestrator + score wiring)

### Issues Encountered
- Pipeline runner expects `partialData` (not `data`) when status is `'partial'` — fixed in enrichment orchestrator
- Existing e2e tests relied on `createStubScoreHandler` — kept it exported alongside the real `createScoreHandler`

### Next Session Should
- **Phase 6:** Output adapters (output-csv, output-notion, CLI results display)
- Run live smoke test with real API keys to validate scoring end-to-end
- Consider adding `sourcerer score` command (re-score without re-enriching)
- Consider CI workflow (`.github/workflows/ci.yml`)

---

## Session: 2026-03-24 18:00 — Hardening Pass (6 Fixes)

### Completed
- **Fix 1:** Real Zod schemas — replaced all 14 `{ schema: {} as unknown }` call sites with proper Zod validation schemas (10 schema types in `packages/intake/src/schemas.ts`)
- **Fix 2:** Preserved crawl result — `company_analysis` node now stores crawled intel via closure variable instead of discarding it when user confirms
- **Fix 3:** Persisted composite profile — added `compositeProfile` field to `IntakeContext`, `team_analysis.parse()` now stores AI-synthesized profile in context, `buildTalentProfile()` uses it
- **Fix 4:** Wired response cache — both providers (Anthropic, OpenAI) now check/store cache before/after API calls, `createAIProvider()` creates cache by default, `--no-cache` flag on CLI
- **Fix 5:** Guarded CLI resume — `run --resume` now loads searchConfig from checkpoint when `--config` not provided, clear error message if neither available
- **Fix 6:** Enrichment cost/failure reporting — `ExaAdapter.enrichBatch()` tracks cost per call, `createEnrichHandler()` reports `batch.failed` and returns `status: 'partial'`

### Stats
- **Tests:** 392 → 394 passing (+2 new factory tests for cache wiring)
- **Files modified:** 15 (across core, intake, ai, adapters, cli)
- **New file:** `packages/intake/src/schemas.ts`

### Issues Encountered
- Vercel plugin keeps flagging direct Anthropic/OpenAI SDK imports as errors — false positives for this CLI project (not a Vercel web app)

### Next Session Should
- **Phase 4:** Enrichment adapters (adapter-github hardening, adapter-x, adapter-hunter, enrichment orchestrator)
- Run live smoke test with real API keys to validate the hardening fixes end-to-end
- Consider adding CI workflow (`.github/workflows/ci.yml`)

---

## Session: 2026-03-24 16:00 — Phases 2.4 through 3C

### Completed
- **Phase 2.4:** output-json (`JsonOutputAdapter` with metadata envelope) + output-markdown (`MarkdownOutputAdapter` with tier-grouped reports, score tables, evidence links) — 19 + 21 tests
- **Phase 2.5:** End-to-end smoke test — 4 phase handler factories (discover, enrich, stub-score, output), CLI `run` command (`--config`, `--output`, `--resume`), hand-written test fixtures, 10 e2e tests with mock handlers
- **Phase 3A:** Intake engine (parallel agent) — conversation engine (11-node graph, save/resume), content research subsystem (5 profile input types), intake phases 1-4 (role context, company intel, success profile, search config gen) — 104 tests
- **Phase 3B:** AI layer (parallel agent) — Anthropic + OpenAI providers with retry/backoff, template loader with `{{variable}}` interpolation, 6 prompt templates, SHA-256 file-based response cache — 60 tests
- **Phase 3C:** Integration — content research adapter wrappers (Exa UrlCrawler, GitHub analyzer, similarity searcher), `sourcerer intake` interactive CLI command, `--intake` flag on run command, 7 integration tests

### Stats
- **Tests:** 171 → 392 passing (+221)
- **New packages implemented:** output-json, output-markdown, ai (3 fully built), intake (1 fully built)
- **New CLI commands:** `run`, `intake` (removed from stubs)

### Issues Encountered
- Worktree isolation caused lockfile mismatch — `zod` installed in agent worktree but missing on main (fixed with `pnpm install`)
- Vitest `vi.mock('exa-js')` doesn't intercept across monorepo package boundaries — switched to mock handlers for e2e tests
- Intake conversation flow requires precise response alignment with node confirm/skip lists — `company_confirm` accepts 'looks good' but not 'yes'

### Next Session Should
- **Phase 4:** Enrichment adapters (adapter-github hardening, adapter-x, adapter-hunter, enrichment orchestrator)
- Consider adding CI workflow (`.github/workflows/ci.yml`)
- Run live smoke test with real Exa API key (`SOURCERER_LIVE_TEST=1 pnpm test`)
- Review intake conversation UX with real AI provider

---

## Session: 2026-03-24 — GitHub Repo Setup

### Completed
- Created private GitHub repo: `matthewod11-stack/sourcerer`
- Wrote professional README.md (project overview, features, architecture, tech stack, getting started)
- Added MIT license (2026, Matt OD)
- Created `docs/screenshots/.gitkeep` placeholder
- Set repo description and topics (typescript, cli, talent-sourcing, turborepo, monorepo, ai, recruitment, evidence-grounded)
- Pushed all 4 commits to origin/main

### In Progress
- Nothing — this was a repo setup session

### Issues Encountered
- None

### Next Session Should
- **Phase 2.4:** output-json + output-markdown (implement `OutputAdapter` interface for both)
- **Phase 2.5:** End-to-end smoke test (Exa search → dedup → JSON output with hand-written search config)
- Consider adding CI workflow (`.github/workflows/ci.yml`) for automated testing
- Then Phase 3: Intake Engine + AI Layer (parallel fork with `/orchestrate`)

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



