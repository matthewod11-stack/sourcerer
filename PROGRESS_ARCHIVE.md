# Progress Archive — Sourcerer

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

---

## Session: 2026-03-22 14:00 — Phase 1.1: Monorepo Scaffold

### Completed
- Fixed pnpm global bin directory (`pnpm setup` + sourced `.zshrc`)
- Installed turbo 2.8.20 globally via pnpm
- Scaffolded full Turborepo monorepo with 8 workspace packages:
  - `@sourcerer/core`, `@sourcerer/intake`, `@sourcerer/adapter-exa`, `@sourcerer/scoring`
  - `@sourcerer/output-json`, `@sourcerer/output-markdown`, `@sourcerer/ai`, `@sourcerer/cli`
- Root config: `package.json`, `pnpm-workspace.yaml`, `turbo.json` (v2 tasks), `tsconfig.base.json`, `vitest.workspace.ts`
- ESM throughout (`"type": "module"`, `nodenext` module resolution)
- TypeScript strict mode with composite project references
- All packages build successfully (`turbo build` — 8/8, topological order)
- All packages pass test (`turbo test` — 16/16, vitest with `passWithNoTests`)
- CLI entry point works: `node apps/cli/dist/index.js` prints placeholder

### Issues Encountered
- `pnpm add -g turbo` failed initially — `PNPM_HOME` not configured. Fixed with `pnpm setup`
- Vitest 3.x exits with code 1 when no test files found (behavior change from v2). Fixed with `passWithNoTests: true` in all vitest configs

### Next Session Should
- Implement core interfaces and types (Phase 1.2) — `DataSource`, `OutputAdapter`, `Candidate`, `PersonIdentity`, `EvidenceItem`, `Score`, `PIIField`, `SearchConfig`, `TalentProfile`, `AIProvider`, `ContentResearch`
- Build identity resolution engine (Phase 1.3)
- Build pipeline runner with checkpoint/resume (Phase 1.4)
- Build config system (Phase 1.5)

---

## 2026-03-20 — Session 1: Design & Planning

### Completed
- Brainstormed product concept from two prior implementations (LunarSource, ymax-sourcing)
- Competitive research: mapped AI sourcing landscape (Juicebox, Tezi, Pearch, Topliner, etc.)
- Design decisions: hybrid intake (C), library+CLI runtime (A), push-to-existing-tools output
- Wrote full design spec (`docs/specs/2026-03-20-sourcerer-design.md`)
- Two rounds of external review — 11 issues found and addressed
- Generated implementation roadmap (`docs/roadmap.md`) — 7 phases, validated
- Product strategy diagnostic (`DESIGN-sourcerer-strategy-2026-03-20.md`) — approved
- Key insight: CLI is operational leverage for services business, not standalone product

### Next Session Should
- Initialize git repo
- Scaffold Turborepo monorepo (Phase 1.1)
- Implement core interfaces and types (Phase 1.2)
- Build identity resolution engine (Phase 1.3)
