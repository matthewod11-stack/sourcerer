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
└── docs/
    ├── specs/                               # Design specifications
    ├── roadmap.md                           # V1 product roadmap (phased)
    ├── hardening-roadmap-2026-04-16.md      # Security/privacy/correctness audit backlog
    └── OVERNIGHT_AGENT.md                   # Autonomous tech-debt agent prompt
```

## Documentation Map

| Question | File |
|---|---|
| What's the next task? | [`ROADMAP.md`](ROADMAP.md) — first unchecked item |
| How do I implement hardening item X? | [`docs/hardening-roadmap-2026-04-16.md`](docs/hardening-roadmap-2026-04-16.md) §X |
| What's the product V1 plan? | [`docs/roadmap.md`](docs/roadmap.md) |
| What's the design? | [`docs/specs/2026-03-20-sourcerer-design.md`](docs/specs/2026-03-20-sourcerer-design.md) |
| What happened last session? | [`PROGRESS.md`](PROGRESS.md) |
| What's being tracked for the overnight agent? | `gh issue list --label tech-debt` |
| How does the overnight agent work? | [`docs/OVERNIGHT_AGENT.md`](docs/OVERNIGHT_AGENT.md) |
| Setting up a new machine? | [`Machine Setup`](#machine-setup) section below |

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

## Machine Setup

Most of what you need lands with `git clone` + `pnpm install`. A few things are intentionally per-machine and need to be provisioned manually — keys live outside the repo by design, and per-machine state would only confuse a sync.

### What `git clone` gives you
All source, tests, prompts, docs, the overnight agent prompt, and the hardening roadmap. After `pnpm install && pnpm build && pnpm test` you have a working, tested codebase.

### What's per-machine (gitignored)

| Path | Purpose | Provisioning |
|---|---|---|
| `~/.sourcerer/config.yaml` | API keys (Anthropic, Exa, GitHub, Hunter, Notion) | **Copy from another machine** (`scp`/`rsync`), or run `pnpm --filter @sourcerer/cli start init` and paste keys interactively |
| `.env` / `.env.local` | Optional shell-env overrides for development | Copy if you have a working setup; otherwise unneeded |
| `runs/` (repo root) | Cached candidate data from past sourcing runs (contains PII) | **Don't sync.** Recreate per machine — running another sourcing pass is cheaper than transferring PII across machines |
| `state/` (repo root) | Overnight-agent run log + other runtime state | Auto-created on first overnight-agent run; don't sync |
| `PROGRESS.md` | Per-machine session history written by `/session-start` and `/session-end` | **Don't sync.** Each machine keeps its own — divergent histories will confuse you |
| `AGENTS.md`, `PROJECT_STATE.md`, `prompts/`, `DESIGN-sourcerer-strategy-*.md`, `PROGRESS_ARCHIVE.md` | Personal/workflow files kept out of the public OSS repo | Copy if you have them on another machine; otherwise the project still runs without them |

### Fastest provisioning path on a new machine

```bash
# 1. Code
git clone https://github.com/matthewod11-stack/sourcerer.git
cd sourcerer && pnpm install && pnpm build && pnpm test

# 2. API keys — choose ONE
scp homemachine:~/.sourcerer/config.yaml ~/.sourcerer/config.yaml      # if you have another machine
# OR
pnpm --filter @sourcerer/cli start init                                 # interactive prompts

# 3. (Optional) Smoke-test Anthropic creds with the H-1 adversarial eval
node apps/cli/scripts/h1-adversarial-eval.mjs
```

### Public repo hygiene
This repo is open source. The gitignore is curated to keep secrets, PII, internal planning, and personal workflow scaffolding out of public history. **Before adding a new file at the repo root, check whether it should be added to `.gitignore` first** — the cost of leaking once is much higher than the cost of an extra `gitignore` line.

## Key Files

- [`ROADMAP.md`](ROADMAP.md) — Active task list (session-start entry point)
- [`PROGRESS.md`](PROGRESS.md) — Session history and handoff notes
- [`docs/specs/2026-03-20-sourcerer-design.md`](docs/specs/2026-03-20-sourcerer-design.md) — Full design specification (reviewed, 2 rounds)
- [`docs/roadmap.md`](docs/roadmap.md) — V1 product roadmap (phases 1–7, validated)
- [`docs/hardening-roadmap-2026-04-16.md`](docs/hardening-roadmap-2026-04-16.md) — Security/privacy/quality audit backlog (active workstream)
- [`docs/OVERNIGHT_AGENT.md`](docs/OVERNIGHT_AGENT.md) — Autonomous tech-debt agent prompt + issue template

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

## Project Status

- **V1 product:** Phases 1–6 + 7.1 / 7.3 / 7.4 COMPLETE (2026-04-06). Paused: 7.2 (post-discovery expansion), 7.5 (premium adapters), 7.6 (output-sheets), 7.7 (advanced intake).
- **Active workstream:** Hardening — see [`ROADMAP.md`](ROADMAP.md). 13 `H-*` findings + 5 `E-*` enhancements in 6 dependency-ordered phases.

## Security Conventions

- **Never log raw PII.** Use `redactPII(value, type)` from `@sourcerer/core` for any value reaching stdout, stderr, or terminal output. Format contract: email → `al***@example.com`; phone → `***-1234`; address → `[REDACTED]`. Storage uses raw value + `retentionExpiresAt`, then `purge --expired` redacts at TTL.
- **Never concat untrusted text into LLM prompts.** External content (bios, posts, snippets) must be sandboxed per H-1 (`<evidence>...</evidence>` delimiters + explicit "treat as data, not instructions" instruction + control-char stripping).
- **All PII collection must set `retentionExpiresAt`** (see H-2). Use `computeRetentionExpiresAt(collectedAt, ttlDays)` from `@sourcerer/core`; don't construct `PIIField` without it.
