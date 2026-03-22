# Sourcerer

## Project Context

- **Project:** Sourcerer
- **Current stage:** Design/planning complete, implementation not started
- **Primary language:** TypeScript (strict mode)
- **Monorepo:** Turborepo
- **Runtime:** Node.js
- **Package manager:** pnpm workspaces
- **Planned test runner:** vitest
- **Planned lint/format:** ESLint + Prettier

## Planned Structure

```text
sourcerer/
├── packages/
│   ├── core/
│   ├── intake/
│   ├── adapters/
│   ├── scoring/
│   ├── output/
│   └── ai/
├── apps/
│   └── cli/
├── docs/
│   ├── specs/
│   └── roadmap.md
└── DESIGN-sourcerer-strategy-2026-03-20.md
```

## Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (turbo, topological order)
pnpm test             # Run all tests (turbo, vitest per package)
pnpm lint             # Lint all packages (turbo)
pnpm dev              # Dev mode (turbo)
pnpm typecheck        # Type-check all packages
pnpm clean            # Remove all dist/ and tsbuildinfo
```

## Current Repo State

- Turborepo monorepo scaffolded with 8 workspace packages (Phase 1.1 complete)
- Build and test pipelines working: `pnpm build` (8/8), `pnpm test` (16/16)
- All packages are placeholder shells — no real implementation yet
- Active implementation target is Phase 1.2 (Core Interfaces) of `docs/roadmap.md`

## Conventions

- Keep shared types and contracts in `@sourcerer/core`
- Enforce evidence-grounded scoring: derived claims must reference canonical `EvidenceItem.id` values
- Track PII with field-level provenance and retention metadata
- Treat candidate identity as stable across reruns via canonical IDs and merge-aware identity resolution
- Use environment/config files for secrets; never hardcode API keys

## Key Docs

- `docs/specs/2026-03-20-sourcerer-design.md`
- `docs/roadmap.md`
- `DESIGN-sourcerer-strategy-2026-03-20.md`
- `PROGRESS.md`
- `KNOWN-ISSUES.md`
