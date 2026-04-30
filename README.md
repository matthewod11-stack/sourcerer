# Sourcerer

AI-powered talent sourcing agent. Run an intelligent intake conversation, discover candidates across multiple data sources, enrich and score them with full evidence transparency, and push results to your existing workflow tools.

<!-- ![Sourcerer CLI](docs/screenshots/cli.png) -->

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
   [ Discover ]         Exa semantic search + find_similar
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
- **Multi-source discovery** -- Exa-powered semantic search with tiered queries and `find_similar` expansion
- **Identity resolution** -- confidence-based deduplication across data sources with stable canonical IDs
- **Evidence-grounded scoring** -- LLM signal extraction constrained to cite only canonical evidence items
- **Pipeline checkpoints** -- interrupt and resume mid-run without losing progress
- **Pluggable adapters** -- independent data source and output adapters, each with its own package and tests
- **Cost tracking** -- per-adapter cost instrumentation from day one
- **PII-aware** -- field-level provenance tracking with adapter attribution and retention TTLs

## Tech Stack

| Technology | Role |
|---|---|
| TypeScript | Language (strict mode, ESM throughout) |
| Turborepo | Monorepo build orchestration |
| Node.js | Runtime |
| pnpm | Package manager (workspace protocol) |
| Vitest | Test runner (570 tests across 13 packages) |
| Exa | Candidate discovery (semantic search) |
| GitHub API | Code signal enrichment |
| X/Twitter API | Social signal enrichment |
| Hunter.io | Email finder and verification |
| Notion API | Candidate database output |

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
```

### Required API Keys

| Adapter | Key | Free Tier |
|---|---|---|
| Exa | `EXA_API_KEY` | 1,000 searches/mo |
| GitHub | `GITHUB_TOKEN` | 5,000 req/hr (authenticated) |
| X/Twitter | `X_API_KEY` | Basic tier |
| Hunter.io | `HUNTER_API_KEY` | 25 searches/mo |
| Notion | `NOTION_TOKEN` | Free (integration token) |

Keys are stored in `~/.sourcerer/config.yaml` (outside the repo, never committed).

### Model Selection

Sourcerer uses Anthropic Sonnet 4.6 (`claude-sonnet-4-6`) by default for per-candidate scoring — fast, cheap, and high-quality enough for the structured-output workload. Override per-run by setting `aiProvider.model` in `~/.sourcerer/config.yaml`. The current defaults are visible at any time via `sourcerer config status`.

| Model | When to pick it |
|---|---|
| `claude-opus-4-7` | Deep narrative reasoning, batch scoring with 1M-context (post-Phase-4 enhancement E-5) |
| `claude-sonnet-4-6` | **Default.** Per-candidate scoring, intake conversation, content research |
| `claude-haiku-4-5` | Bulk preprocessing, dedup-time identity scoring, very high-volume runs |

OpenAI provider also supported (`aiProvider.name: openai`); current default is `gpt-4o`.

## Development

```bash
pnpm build        # Build all packages (topological order)
pnpm test         # Run all tests
pnpm typecheck    # Type-check all packages
pnpm lint         # Lint all packages
pnpm clean        # Remove build artifacts
```

Turborepo handles the build graph automatically. `core` builds first, then all other packages in parallel, then `cli` last.

## License

[MIT](LICENSE)

---

Built with [Claude Code](https://claude.ai/code)
