# Sourcerer Demo Transcript

This transcript uses deterministic fixture data and does not require API keys.
It is safe to run on a fresh checkout after `pnpm install`.

## CLI Surface

```bash
$ pnpm --filter @sourcerer/cli start --help

sourcerer - AI-powered talent sourcing agent

Usage: sourcerer <command> [options]

Commands:
  init          Set up Sourcerer (API keys, adapters)
  config        View and manage configuration
  intake        Run the intake conversation
  run           Execute a full pipeline run
  replay        Re-score a saved run without discovery/enrichment
  eval          Run golden-set scoring evaluation
  score         Run scoring phase only
  results       View results from last run
  runs          List previous runs
  candidates    Manage candidate data
```

## Mock Golden Eval

```bash
$ pnpm eval

Golden eval complete
  Model: fixture
  Candidates: 15
  Tier accuracy: 100.0%
  Tier proximity (+/-1): 100.0%
  Hallucination rate: 0.0%
  Cost: $0.0000
```

The eval runs the full scoring pipeline against a sanitized golden set. It
checks exact tier accuracy, near-miss tier proximity, hallucinated evidence
references, and cost accounting.

## Batch-Scoring Smoke Comparison

```bash
$ pnpm --filter @sourcerer/cli start score --batch --mock

Batch scoring spike complete
  Model: fixture
  Candidates: 15
  Per-candidate tier accuracy: 100.0%
  Batch tier accuracy: 100.0%
  Cost delta: $0.0000
```

The batch path is intentionally experimental. The default production scoring
flow remains per-candidate scoring with evidence-grounded signal extraction.

## Live Run Shape

Live sourcing requires adapter keys in `~/.sourcerer/config.yaml`.

```bash
$ pnpm --filter @sourcerer/cli start init
$ pnpm --filter @sourcerer/cli start run --config search-config.yaml --output json,markdown
$ pnpm --filter @sourcerer/cli start results --tier 1
```

Generated run artifacts are written under `runs/` and are gitignored because
they can contain candidate PII.
