# PROJECT_STATE.md

> Cross-surface context document. Shared across Claude Chat, Claude Code, and Cowork sessions.
> Last updated: 2026-03-23

---

## Project Overview

Sourcerer is an AI-powered talent sourcing agent packaged as a TypeScript CLI tool. It runs an intelligent intake conversation with a hiring manager, builds a composite talent profile from multiple inputs (company data, team member profiles, competitor research), discovers candidates across the web via Exa, enriches them with GitHub/Twitter/email signals, scores them with full evidence transparency, and pushes structured results into existing workflow tools (Notion, CSV, JSON, Markdown).

The business model is open-source core + done-for-you services. The CLI is operational leverage — the builder (you) runs Sourcerer for clients, charges per engagement, and undercuts agency fees ($30-60K/hire) with tool-powered speed. Two prior client implementations shipped (Lunar Labs, Agoric) using predecessor repos. Sourcerer is the portable, multi-client version of that work.

**Current milestone:** Phase 1 (Foundation) is COMPLETE. Phase 2 is partially complete (2.1–2.3 shipped, 2.4–2.5 remain). The pipeline can discover candidates via Exa, enrich via GitHub, deduplicate via identity resolution, and checkpoint/resume — but no scoring, no intake conversation, and no output adapters beyond stubs.

---

## Current Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Language | TypeScript 5.8 | Strict mode, ESM throughout |
| Monorepo | Turborepo 2.8 | Topological build, task caching |
| Runtime | Node.js ≥22 | ESM, `nodenext` module resolution |
| Package Manager | pnpm 10.32 | Workspace protocol (`workspace:*`) |
| Test Runner | Vitest 3.2 | Per-package configs, **171 tests all passing** |
| Linter | ESLint + Prettier | Dev deps hoisted to root |
| CLI Prompts | @clack/prompts | Interactive onboarding wizard |
| External APIs | Exa (search), GitHub REST API | Adapters wrap each API behind `DataSource` interface |

No database, no frontend, no web server. Sourcerer is a CLI tool that reads `~/.sourcerer/config.yaml`, runs a pipeline, and writes results to disk (JSON/Markdown) or pushes to external services (Notion).

---

## Architecture

```
sourcerer/
├── packages/
│   ├── core/              # Pipeline engine, types, identity resolution, config
│   │   ├── src/
│   │   │   ├── index.ts              # Barrel re-export of all types
│   │   │   ├── identity.ts           # PersonIdentity, ObservedIdentifier, PIIField
│   │   │   ├── evidence.ts           # EvidenceItem, generateEvidenceId()
│   │   │   ├── scoring.ts            # Score, ScoreComponent, ExtractedSignals
│   │   │   ├── candidate.ts          # Candidate, SearchConfig
│   │   │   ├── pipeline.ts           # DataSource, OutputAdapter interfaces
│   │   │   ├── pipeline-types.ts     # Phase, PipelineState, RunMeta
│   │   │   ├── pipeline-runner.ts    # PipelineRunner (phase orchestration, checkpoints)
│   │   │   ├── identity-resolver.ts  # IdentityResolver (confidence-based merging)
│   │   │   ├── checkpoint.ts         # Checkpoint serialization/deserialization
│   │   │   ├── run-artifacts.ts      # Run directory management
│   │   │   ├── cost-tracker.ts       # Cost tracking across adapters
│   │   │   ├── config.ts             # Config schema + read/write
│   │   │   ├── ai.ts                 # AIProvider interface (contract only)
│   │   │   └── intake.ts             # TalentProfile, IntakeContext, ContentResearch interface
│   │   └── __tests__/               # 118 tests (types, identity resolver, pipeline, config, dedup)
│   │
│   ├── intake/            # Conversation engine (stub — Phase 3A)
│   ├── ai/                # LLM abstraction layer (stub — Phase 3B)
│   ├── scoring/           # Scoring engine (stub — Phase 5)
│   │
│   ├── adapters/
│   │   ├── adapter-exa/   # Exa search + find_similar + enrich (20 tests)
│   │   └── adapter-github/# GitHub enrichment: profile, repos, commits, emails (14 tests)
│   │
│   └── output/
│       ├── output-json/   # JSON output adapter (stub — Phase 2.4)
│       └── output-markdown/ # Markdown output adapter (stub — Phase 2.4)
│
└── apps/
    └── cli/               # Interactive CLI: init, config, run, etc. (19 tests)
        └── src/commands/   # init, config-show, config-status, help, stubs
```

### Build Order

Turbo builds topologically: `core` → `adapters/*`, `intake`, `ai`, `scoring`, `output/*` (parallel) → `cli`

### Data Flow (V1 Target)

```
Intake Conversation → TalentProfile + SearchConfig + SimilaritySeeds
                                         ↓
Discovery: Exa search (tiered queries) + find_similar (from seeds)
                                         ↓
Dedup: IdentityResolver (confidence-based merge → stable canonicalId)
                                         ↓
Enrichment: GitHub (code signals) + X (social signals) + Hunter (email verify)
                                         ↓
Scoring: LLM signal extraction → weighted calculator → narrative generation
                                         ↓
Output: JSON, Markdown, CSV, Notion (push to existing workflow tools)
```

### Key Patterns

- **Evidence grounding**: LLM signals can ONLY reference canonical `EvidenceItem.id` values — no freeform claims
- **`generateEvidenceId()`**: deterministic `ev-XXXXXX` IDs from SHA-256 of adapter+type+source
- **Identity resolution**: `PersonIdentity` with high/medium/low confidence merging. `canonicalId` survives reruns.
- **PII tracking**: per-field `PIIField` with adapter attribution + retention TTL
- **Adapter-keyed data**: `Record<string, X>` (not Map) for JSON serialization compatibility
- **Config**: `~/.sourcerer/config.yaml` with adapter keys, retention TTLs, AI provider selection
- **Pipeline checkpoints**: serialize state to disk after each phase, resume from last completed phase
- **Cost tracking**: `costIncurred` on `SearchPage` and `BatchResult` from day one

---

## Current State

### Phase Completion Status

| Phase | Status | Features |
|-------|--------|----------|
| 1.1 Monorepo Scaffold | **Complete** | Turborepo, package structure, tsconfig, workspace refs |
| 1.2 Core Interfaces | **Complete** | All 7 domain type files, DataSource/OutputAdapter interfaces, AIProvider/ContentResearch contracts |
| 1.3 Identity Resolution | **Complete** | High/medium/low confidence merge, cross-source linking, stable canonicalId, merge history |
| 1.4 Pipeline Runner | **Complete** | Phase orchestration, checkpoint/resume, partial failure handling, run artifacts |
| 1.5 Config System | **Complete** | `~/.sourcerer/config.yaml` schema, read/write, validation |
| 1.6 CLI Skeleton | **Complete** | `sourcerer` binary, command routing (init, config, run, etc.), help |
| 1.7 Test Protocol | **Complete** | Benchmark fixtures, dedup test candidates, cost tracking, test protocol doc |
| 2.1 Onboarding Wizard | **Complete** | `sourcerer init`, adapter menu with cost transparency, key validation flow, config write |
| 2.2 adapter-exa | **Complete** | Search, find_similar, enrich, domain filtering, rate limiting, healthCheck, estimateCost |
| 2.3 adapter-github | **Complete** | Profile, repos, commit history, email extraction, contribution signals, PII tagging |
| 2.4 output-json + output-markdown | Not started | JSON/Markdown output adapters |
| 2.5 End-to-end smoke test | Not started | Partial pipeline test with real Exa + GitHub |

### Test Summary

| Package | Tests |
|---------|-------|
| @sourcerer/core | 118 |
| @sourcerer/adapter-exa | 20 |
| @sourcerer/adapter-github | 14 |
| @sourcerer/cli | 19 |
| **Total** | **171 passing, 0 failing** |

---

## Recent Decisions

1. **adapter-github moved to Phase 2.3** (from Phase 4A) — eliminates forward dependency from intake's `ContentResearch.analyzeProfile()` which needs GitHub data. Validated during roadmap review.

2. **Google Sheets deferred to Phase 7.6** — OAuth complexity (consent screen, token refresh, secure storage) would block Phase 6. CSV + Notion + JSON + Markdown is sufficient for V1.

3. **GitHub is enrichment-only, not discovery** — Exa handles discovery. GitHub enriches candidates who already have a GitHub username/URL. Prevents GitHub's limited search from narrowing the candidate pool.

4. **`AIProvider` and `ContentResearch` as interfaces in core** — enables Phase 3A (intake) and 3B (AI layer) to develop in parallel against shared contracts, then integrate in 3C.

5. **Post-discovery expansion deferred to Phase 7.2** — P0 similarity from success profile seeds (Phase 3) covers the highest-value use case. Post-discovery `find_similar` is opt-in enhancement.

6. **Approach A: Ship the Engine, Sell the Driving** — interleave building with real client engagements starting at Phase 2 completion. Revenue while you build. Each engagement validates the next phase.

7. **`@clack/prompts` for CLI interaction** — chosen over inquirer for cleaner UX and better ESM support.

8. **Adapter-keyed data uses `Record<string, X>`** — not Map, for JSON serialization compatibility. Decided during type design.

---

## Known Issues & Debt

### Active

- **healthCheck validation deferred in onboarding** — `sourcerer init` validates key format but doesn't call adapter `healthCheck()` yet (adapters need to be instantiated first). Marked as deferred in roadmap task 2.1.
- **No real API integration tests** — all adapter tests use mocked responses. First real-API test is Phase 2.5.
- **Stub packages** — `packages/intake`, `packages/ai`, `packages/scoring`, `packages/output/output-json`, `packages/output/output-markdown` export empty barrel files. They compile and are wired into the workspace but contain no implementation.

### Technical Debt

- No CI/CD pipeline — tests only run locally via `pnpm test`
- No ESLint config yet (Prettier is configured)
- `.js` extension convention in imports (TypeScript ESM requirement) — may confuse contributors unfamiliar with this pattern
- Config stores API keys in plaintext YAML — acceptable for V1 CLI tool, not for a hosted service

---

## What's Next

### Immediate (next session)

1. **Phase 2.4: output-json + output-markdown** — implement `OutputAdapter` for both. JSON writes `candidates.json` to run directory. Markdown generates formatted report grouped by tier with narrative briefs, score breakdowns, evidence links.
2. **Phase 2.5: End-to-end smoke test** — `sourcerer run --config test-config.yaml --output json` executes Exa search → dedup → JSON output. Pipeline checkpoints work. Run artifacts created. First test with hand-written search config (no intake yet).

### Short-term (next 2-3 sessions)

3. **Phase 3A + 3B in parallel** — Intake Engine (conversation, content research, config generation) + AI Layer (provider abstraction, prompt templates, caching). These can run as parallel agents.
4. **Phase 3C: Integration** — wire intake to AI layer, end-to-end test from `sourcerer intake` through discovery.

### Medium-term

5. **Phase 4: Enrichment adapters** — adapter-x (Twitter), adapter-hunter (email), GitHub hardening, enrichment orchestrator
6. **Phase 5: Scoring engine** — signal extraction, weighted scoring, narrative generation, tiering, re-scoring
7. **Phase 6: Output adapters** — CSV, Notion, CLI results display

### Strategic

- **Run a real client engagement at Phase 2 completion** — use Sourcerer with a hand-written search config for a live sourcing engagement. The feedback is worth more than any spec review.
- **Open-source timing TBD** — options: Phase 2 (early, raw), Phase 4 (functional), Phase 7 (polished)
- **Pricing model needed** — decide per-engagement pricing before Phase 2 ends

---

## Planning Artifacts

| File | Purpose |
|------|---------|
| `docs/specs/2026-03-20-sourcerer-design.md` | Full design specification (revised, 2 review rounds) |
| `docs/roadmap.md` | Implementation roadmap — 7 phases, validated (APPROVED WITH CHANGES) |
| `DESIGN-sourcerer-strategy-2026-03-20.md` | Product strategy, business model, /office-hours output |
| `CLAUDE.md` | Claude Code project instructions, conventions, key commands |

---

## V1 Success Criteria

1. User can `npx sourcerer init`, configure API keys, and run a full pipeline from intake to scored output
2. Intake conversation produces a talent profile + reviewable search config
3. Discovery finds candidates across Exa (+ P0 similarity from success profile seeds)
4. Enrichment fills in GitHub code signals, X/Twitter social, Hunter.io email verification
5. Scoring is fully grounded — every claim traces to an `EvidenceItem`
6. Output pushes to Notion, CSV, JSON, and Markdown
7. Identity resolution correctly deduplicates across multi-source data
8. Reruns upsert (not duplicate) against stable candidate IDs

**Target Metrics:**
- Tier 1 precision: >70% of Tier 1 candidates are human-validated as strong fits
- Dedup accuracy: <5% duplicate rate across multi-source runs
- Cost per run: <$5 for a typical 50-candidate search

---

## Cross-Surface Notes

- **Repo is private** on GitHub (`matthewod11-stack/sourcerer`). No deployment — CLI tool runs locally.
- **4 git commits** on main: monorepo scaffold (Phase 1.1) + Phase 1 + Phase 2.1-2.3 + PROJECT_STATE.md + GitHub polish (README, MIT license).
- **Build command**: `pnpm build` (Turbo, topological). **Test command**: `pnpm test` (171 tests, all passing).
- **Config file**: `~/.sourcerer/config.yaml` — API keys for Exa, GitHub, AI provider. Created by `sourcerer init`.
- **Run artifacts**: written to `runs/YYYY-MM-DD-<role>/` with `run-meta.json`, checkpoints, candidate data.
- **Predecessor repos**: Lunar Labs and Agoric sourcing repos were custom per-client. Sourcerer is the portable, multi-client evolution.
- **The CLI is the product AND the service infrastructure.** Same tool, different configs. Portability across clients is the core requirement.
- **Phase 3 is the biggest risk** — intake engine, content research, and company intelligence are each independently complex. Watch for 2x estimated sessions.
- **Phase 5 (scoring/grounding) is the hardest technical problem** — LLM grounding constraints are hard to enforce. Early grounding test planned in Phase 3C.

---

*This file is the single source of truth for external Claude sessions. Update it at the end of any session with meaningful changes.*
