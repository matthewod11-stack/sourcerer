# Sourcerer

AI-powered talent sourcing agent. Run an intelligent intake conversation, discover candidates across multiple data sources, enrich and score them with full evidence transparency, and push results to your existing workflow tools.

See [the no-key demo transcript](docs/demo.md) for a quick tour of the CLI and eval output.

## About

Sourcerer is a CLI tool that replaces the manual grind of technical recruiting. Instead of juggling LinkedIn Recruiter, agency fees, and hours of GitHub/Twitter stalking, Sourcerer runs a structured pipeline: an intake conversation with the hiring manager, multi-source candidate discovery via Exa, enrichment from GitHub and social signals, evidence-grounded scoring, and output to Notion, CSV, JSON, Markdown, or the terminal.

Every scoring claim traces back to a canonical evidence item. No hallucinated candidate summaries. No black-box rankings.

## Pipeline

```
sourcerer init          Configure API keys and adapters
       |
sourcerer run --intake  Run the full pipeline:
       |
   [ Intake ]           Conversational role profiling
       |
   [ Discover ]         Exa semantic search + seed-based find_similar
       |
   [ Dedup ]            Identity resolution across sources
       |
   [ Enrich ]           GitHub, X/Twitter, Hunter.io signals
       |
   [ Score ]            LLM-grounded scoring with evidence chains
       |
   [ Output ]           Push to Notion, CSV, JSON, Markdown

sourcerer results       View and re-export results
```

## Features

- **Intelligent intake** -- conversational onboarding that builds a talent profile, search config, and similarity seeds from role descriptions, company URLs, and team member profiles
- **Multi-source discovery** -- Exa-powered semantic search with tiered queries and success-profile `find_similar` seeds
- **Identity resolution** -- confidence-based deduplication across data sources with stable canonical IDs
- **Evidence-grounded scoring** -- LLM signal extraction constrained to cite only canonical evidence items
- **Pipeline checkpoints** -- interrupt and resume mid-run without losing progress
- **Pluggable adapters** -- independent data source and output adapters, each with its own package and tests
- **Cost tracking** -- per-adapter cost instrumentation from day one
- **PII-aware** -- field-level provenance tracking with adapter attribution and retention TTLs

## Tech Stack

| Technology    | Role                                       |
| ------------- | ------------------------------------------ |
| TypeScript    | Language (strict mode, ESM throughout)     |
| Turborepo     | Monorepo task orchestration                |
| Node.js       | Runtime                                    |
| pnpm          | Package manager (workspace protocol)       |
| Vitest        | Test runner (793 passing tests across 14 packages, 1 live smoke skipped by default) |
| Exa           | Candidate discovery (semantic search)      |
| GitHub API    | Code signal enrichment                     |
| X/Twitter API | Social signal enrichment                   |
| Hunter.io     | Email finder and verification              |
| Notion API    | Candidate database output                  |

## Project Structure

```
sourcerer/
  packages/
    core/             Pipeline engine, types, identity resolution, config
    intake/           Conversational intake engine + content research
    ai/               LLM abstraction layer + prompt templates
    scoring/          Evidence-grounded scoring engine
    adapters/
      adapter-exa/    Exa search + enrichment
      adapter-github/ GitHub profile + code signals
      adapter-x/      X/Twitter social signals
      adapter-hunter/ Email finder + verification
    output/
      output-json/    Structured JSON output
      output-csv/     Excel-compatible CSV export
      output-markdown/ Formatted Markdown reports
      output-notion/  Notion database push with upsert
  apps/
    cli/              Interactive CLI application
```

## Getting Started

```bash
# Clone and install
git clone https://github.com/matthewod11-stack/sourcerer.git
cd sourcerer
corepack enable
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Configure API keys
pnpm --filter @sourcerer/cli start init

# Run a search
pnpm --filter @sourcerer/cli start run --config search-config.yaml --output json,markdown

# View results
pnpm --filter @sourcerer/cli start results --tier 1

# Re-score a saved run without re-fetching candidates
pnpm --filter @sourcerer/cli start replay <run-id-or-dir>

# Run the mock golden-set scoring eval
pnpm eval

# Run the Phase 6 mock batch-scoring comparison
pnpm --filter @sourcerer/cli start score --batch --mock
```

No API keys are needed for `pnpm test`, `pnpm eval`, or `pnpm --filter @sourcerer/cli start score --batch --mock`. Live discovery and enrichment require adapter keys in `~/.sourcerer/config.yaml`.

### Prompt Iteration

Use `pnpm --filter @sourcerer/cli start replay <run-id-or-dir>` when you want to iterate on scoring prompts without spending discovery or enrichment quota again. Replay loads the source run's saved `candidates.json`, re-runs only the scoring phase with the current prompts, and writes the result to a new run directory so the original run stays intact.

The AI response cache is still honored during replay. To intentionally bust only the scoring cache while testing a prompt variant, pass a namespace:

```bash
pnpm --filter @sourcerer/cli start replay <run-id-or-dir> --prompt-version v3
```

### Batch Scoring Spike

Phase 6 adds an experimental golden-set comparison path for 1M-context batch scoring:

```bash
pnpm --filter @sourcerer/cli start score --batch --mock
pnpm --filter @sourcerer/cli start score --batch --model claude-opus-4-7
```

The command compares the existing per-candidate scoring baseline against a single-call batch scoring prompt and writes JSON/Markdown reports under `eval-results/`. Use `--mock` for no-key/no-cost smoke checks; omit it only when intentionally spending provider quota.

### Required API Keys

| Adapter   | Key              | Free Tier                    |
| --------- | ---------------- | ---------------------------- |
| Exa       | `EXA_API_KEY`    | 1,000 searches/mo            |
| GitHub    | `GITHUB_TOKEN`   | 5,000 req/hr (authenticated) |
| X/Twitter | `X_API_KEY`      | Basic tier                   |
| Hunter.io | `HUNTER_API_KEY` | 25 searches/mo               |
| Notion    | `NOTION_TOKEN`   | Free (integration token)     |

Keys are stored in `~/.sourcerer/config.yaml` (outside the repo, never committed).

## Security & Data Handling

Sourcerer is currently designed for local, single-user operation. Run artifacts live under `runs/<date-role>/` by default and include `candidates.json`, `checkpoint.json`, `run-meta.json`, and optional report/output files. These files are gitignored, but they are plaintext JSON/Markdown on disk.

Candidate artifacts may contain PII including emails, phone numbers, addresses when an adapter supplies them, source URLs, adapter provenance, collection timestamps, and `retentionExpiresAt` values. API keys are not stored in run artifacts; keys live in `~/.sourcerer/config.yaml` or environment variables.

The default PII retention TTL is 90 days unless changed during `sourcerer init` or in `~/.sourcerer/config.yaml`. To redact expired local PII, run:

```bash
pnpm --filter @sourcerer/cli start candidates purge --expired
```

At-rest encryption is not implemented yet. Do not run Sourcerer on shared machines, shared workspaces, synced folders, or multi-user servers unless you add disk-level protection and access controls outside the app. Remote copies pushed to tools like Notion are not affected by local purge commands. The proposed implementation path is documented in [`docs/security/run-artifact-encryption-design.md`](docs/security/run-artifact-encryption-design.md).

### Model Selection

Sourcerer uses Anthropic Sonnet 4.6 (`claude-sonnet-4-6`) by default for per-candidate scoring -- fast, cheap, and high-quality enough for the structured-output workload. Override per-run by setting `aiProvider.model` in `~/.sourcerer/config.yaml`. The current defaults are visible at any time via `pnpm --filter @sourcerer/cli start config status`.

| Model               | When to pick it                                                                        |
| ------------------- | -------------------------------------------------------------------------------------- |
| `claude-opus-4-7`   | Deep narrative reasoning, batch scoring with 1M-context (post-Phase-4 enhancement E-5) |
| `claude-sonnet-4-6` | **Default.** Per-candidate scoring, intake conversation, content research              |
| `claude-haiku-4-5`  | Bulk preprocessing, dedup-time identity scoring, very high-volume runs                 |

OpenAI provider also supported (`aiProvider.name: openai`); current default is `gpt-4o`.

## Development

```bash
pnpm build        # Build all packages through TypeScript project references
pnpm test         # Run all Vitest projects
pnpm typecheck    # Type-check all package references
pnpm lint         # Lint all source directories
pnpm eval         # Run the deterministic mock golden-set eval
pnpm clean        # Remove build artifacts through package clean tasks
```

TypeScript project references define the package graph. Turborepo remains configured for package task orchestration, but the root verification gates call TypeScript, Vitest, and ESLint directly so they do not depend on an ambient global package-manager binary.

## License

[MIT](LICENSE)
