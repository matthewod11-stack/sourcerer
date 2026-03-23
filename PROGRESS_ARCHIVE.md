# Progress Archive — Sourcerer

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
