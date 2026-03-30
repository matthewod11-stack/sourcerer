# Sourcerer

AI-powered talent sourcing agent. CLI tool that runs an intelligent intake conversation, discovers candidates across multiple data sources, enriches and scores them with full evidence transparency, and pushes results to existing workflow tools.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Monorepo:** Turborepo
- **Runtime:** Node.js
- **Package manager:** pnpm (workspace protocol)
- **Test runner:** vitest
- **Linter:** ESLint + Prettier

## Project Structure

```
sourcerer/
├── packages/
│   ├── core/          # Pipeline engine, interfaces, identity resolution, types
│   ├── intake/        # Interactive intake engine, conversation, content research
│   ├── adapters/      # Data source adapters (each independently installable)
│   │   ├── adapter-exa/
│   │   ├── adapter-github/
│   │   ├── adapter-x/
│   │   ├── adapter-hunter/
│   │   └── (future: adapter-pearch, adapter-pdl, adapter-contactout)
│   ├── scoring/       # Scoring engine, signal extraction, narrative generation
│   ├── output/        # Output adapters
│   │   ├── output-json/
│   │   ├── output-csv/
│   │   ├── output-markdown/
│   │   ├── output-notion/
│   │   └── (future: output-sheets)
│   └── ai/            # LLM abstraction layer, prompt templates, response caching
├── apps/
│   └── cli/           # Interactive CLI application
├── docs/
│   ├── specs/         # Design specifications
│   └── roadmap.md     # Implementation roadmap
└── DESIGN-sourcerer-strategy-2026-03-20.md
```

## Key Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (turbo, topological order)
pnpm test             # Run all tests (turbo, vitest per package)
pnpm lint             # Lint all packages (turbo)
pnpm dev              # Dev mode (turbo)
pnpm typecheck        # Type-check all packages
pnpm clean            # Remove all dist/ and tsbuildinfo
```

## Key Files

- `docs/specs/2026-03-20-sourcerer-design.md` — Full design specification (reviewed, 2 rounds)
- `docs/roadmap.md` — Implementation roadmap (validated)
- `DESIGN-sourcerer-strategy-2026-03-20.md` — Product strategy and business context
- `PROJECT_STATE.md` — Cross-surface context sync (Claude Chat, Claude Code, Cowork)
- `docs/OVERNIGHT_AGENT.md` — Autonomous tech-debt agent prompt + issue template
- `prompts/overnight-agent.md` — Desktop task entry point for overnight agent
- `state/overnight-agent-log.json` — Run log (gitignored, written by overnight agent)

## Conventions

- All types live in `@sourcerer/core` and are imported by other packages
- Core types split into 7 domain files: `identity.ts`, `evidence.ts`, `scoring.ts`, `candidate.ts`, `pipeline.ts`, `ai.ts`, `intake.ts` — barrel re-exported from `index.ts`
- Each adapter is an independent package with its own tests
- Evidence grounding: LLM signals can ONLY reference canonical `EvidenceItem.id` values
- `generateEvidenceId()` in core produces deterministic `ev-XXXXXX` IDs — all adapters use this
- Identity resolution uses `PersonIdentity` with confidence-based merging
- PII is tracked per-field with `PIIField` (adapter attribution + retention TTL)
- Candidate.id === PersonIdentity.canonicalId (one stable identifier)
- Adapter-keyed data on Candidate uses `Record<string, X>` (not Map) for JSON serialization compatibility
- No hardcoded API keys — everything via `~/.sourcerer/config.yaml`
- ESM throughout — `"type": "module"`, `nodenext` module resolution
- Use `.js` extensions in relative imports (TypeScript resolves `.js` → `.ts`)
- Dev dependencies hoisted to root (TypeScript, vitest, prettier)
- Internal deps use `workspace:*` protocol

## Build Order

Turbo builds in topological order: `core` → 6 packages in parallel → `cli`.

See `docs/roadmap.md` for full phased plan. Currently: Phases 1-5 COMPLETE. Next: Phase 6 (Output Adapters — CSV, Notion, CLI results display).
