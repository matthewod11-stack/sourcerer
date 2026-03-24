# Sourcerer

AI-powered talent sourcing agent. Run an intelligent intake conversation, discover candidates across multiple data sources, enrich and score them with full evidence transparency, and push results to your existing workflow tools.

<!-- TODO: Add screenshot once CLI is complete -->
<!-- ![Sourcerer CLI](docs/screenshots/cli.png) -->

## About

Sourcerer is a CLI tool that replaces the manual grind of technical recruiting. Instead of juggling LinkedIn Recruiter, agency fees, and hours of GitHub/Twitter stalking, Sourcerer runs a structured pipeline: intake conversation with the hiring manager, multi-source candidate discovery via Exa, enrichment from GitHub and social signals, evidence-grounded scoring, and output to Notion, CSV, JSON, or Markdown.

Every scoring claim traces back to a canonical evidence item. No hallucinated candidate summaries. No black-box rankings.

## Features

- **Intelligent intake** -- conversational onboarding that builds a talent profile, search config, and similarity seeds from role descriptions, company URLs, and team member profiles
- **Multi-source discovery** -- Exa-powered semantic search with tiered queries and `find_similar` expansion
- **Identity resolution** -- confidence-based deduplication across data sources with stable canonical IDs
- **Evidence-grounded scoring** -- LLM signal extraction constrained to cite only canonical evidence items
- **Pipeline checkpoints** -- interrupt and resume mid-run without losing progress
- **Pluggable adapters** -- independent data source and output adapters (Exa, GitHub, X, Hunter, Notion, CSV, JSON, Markdown)
- **Cost tracking** -- per-adapter cost instrumentation from day one
- **PII-aware** -- field-level provenance tracking with adapter attribution and retention TTLs

## Tech Stack

| Technology | Role |
|---|---|
| TypeScript | Language (strict mode, ESM throughout) |
| Turborepo | Monorepo build orchestration |
| Node.js 22+ | Runtime |
| pnpm | Package manager (workspace protocol) |
| Vitest | Test runner |
| Exa | Candidate discovery (semantic search) |
| GitHub API | Code signal enrichment |

## Project Structure

```
sourcerer/
  packages/
    core/             Pipeline engine, types, identity resolution, config
    intake/           Conversational intake engine
    ai/               LLM abstraction layer
    scoring/          Evidence-grounded scoring engine
    adapters/
      adapter-exa/    Exa search + enrichment
      adapter-github/ GitHub profile + code signals
      adapter-x/      X/Twitter social signals
      adapter-hunter/ Email finder + verification
    output/
      output-json/    JSON output
      output-csv/     CSV output
      output-markdown/ Markdown reports
      output-notion/  Notion database push
  apps/
    cli/              Interactive CLI application
```

## Getting Started

```bash
# Clone
git clone git@github.com:matthewod11-stack/sourcerer.git
cd sourcerer

# Install
pnpm install

# Build
pnpm build

# Run tests
pnpm test
```

## Status

Under active development. Phase 1 (Foundation) and Phase 2.1--2.3 (Onboarding + Exa + GitHub adapters) are complete. 171 tests passing. See `docs/roadmap.md` for the full implementation plan.

## License

[MIT](LICENSE)
