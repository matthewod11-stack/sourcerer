# Sourcerer — Roadmap

> **Last updated:** 2026-04-16
> **Active workstream:** Hardening (audit-driven — see [`docs/hardening-roadmap-2026-04-16.md`](docs/hardening-roadmap-2026-04-16.md))
> **Paused workstream:** V1 product backlog — Phase 7.2 / 7.5 / 7.6 / 7.7 (see [`docs/roadmap.md`](docs/roadmap.md))

This file is the single source of truth for `/session-start` task selection. Phased lists are ordered by dependency. The first unchecked `[ ]` item is the next task.

---

## Active: Hardening (2026-04-16 audit)

Full item specs (Problem, Fix, Files, Acceptance, Effort) live in [`docs/hardening-roadmap-2026-04-16.md`](docs/hardening-roadmap-2026-04-16.md). GitHub Issues are filed per item for tracking and overnight-agent eligibility.

### Phase 1 — Security & Privacy (parallel-safe)
- [x] [**H-1** #5](https://github.com/matthewod11-stack/sourcerer/issues/5) Sandbox external content in LLM prompts — M — no deps ✅ 2026-04-19
- [ ] [**H-2** #6](https://github.com/matthewod11-stack/sourcerer/issues/6) Populate `retentionExpiresAt` at PII collection time — M — no deps
- [ ] [**H-3** #7](https://github.com/matthewod11-stack/sourcerer/issues/7) Stop logging raw PII to stdout — S — no deps

### Phase 2 — Model defaults, Zod config, determinism (parallel-safe)
- [ ] [**H-4** #8](https://github.com/matthewod11-stack/sourcerer/issues/8) Upgrade Anthropic default model to `claude-sonnet-4-6` — S — no deps
- [ ] [**H-5** #9](https://github.com/matthewod11-stack/sourcerer/issues/9) Replace hand-rolled config validator with Zod — S — no deps
- [ ] [**H-10** #10](https://github.com/matthewod11-stack/sourcerer/issues/10) Stable sort for GitHub repo selection — S — no deps

### Phase 3 — Boundaries, cost, grounding
- [ ] [**H-6** #11](https://github.com/matthewod11-stack/sourcerer/issues/11) Zod-parse checkpoint and intake-context deserialization — S — needs #9
- [ ] [**H-11** #12](https://github.com/matthewod11-stack/sourcerer/issues/12) Zod-parse external API responses — M — needs #9
- [ ] [**H-7** #13](https://github.com/matthewod11-stack/sourcerer/issues/13) Real token-usage accounting — M — no deps (pairs with E-2)
- [ ] [**H-8** #14](https://github.com/matthewod11-stack/sourcerer/issues/14) Fix malformed SearchConfig in budget gate — S — no deps
- [ ] [**H-9** #15](https://github.com/matthewod11-stack/sourcerer/issues/15) Penalize the score on hallucinated IDs — S — **needs-design-decision** (strict / soft / bifurcated)

### Phase 4 — Logging, prompt versioning, tests, docs
- [ ] **E-2** Structured logging & run telemetry — M — pairs with #7 (not yet filed as issue)
- [ ] **E-4** Versioned prompt registry — S — no deps (not yet filed as issue)
- [ ] [**H-12** #16](https://github.com/matthewod11-stack/sourcerer/issues/16) Grow scoring-package test coverage — M — needs #5, #15
- [ ] [**H-13** #17](https://github.com/matthewod11-stack/sourcerer/issues/17) Document plaintext-PII-at-rest posture — S — no deps

### Phase 5 — Replay & eval
- [ ] **E-3** Cache-driven replay mode — S–M — needs E-4
- [ ] **E-1** Golden-set evaluation harness — L — needs E-2

### Phase 6 — Batch-scoring spike
- [ ] **E-5** Opus-4.7 / 1M-context batch scoring spike — M + L — needs-design-decision — needs E-1

**Minimum-viable hardening pass:** Phase 1 + H-5 + H-7. Closes every High-severity finding plus the most important Medium in 2–3 sessions.

---

## Paused: V1 Product Backlog

Full plan in [`docs/roadmap.md`](docs/roadmap.md). Resumed after hardening lands.

- [ ] **7.2** Post-discovery expansion (`find_similar`) — bounded recursion on top-scoring candidates
- [ ] **7.5** Premium adapters — `adapter-pearch`, `adapter-pdl`, `adapter-contactout`
- [ ] **7.6** `output-sheets` — Google Sheets adapter (deferred from Phase 6, OAuth complexity)
- [ ] **7.7** Advanced intake — competitor mapping, anti-pattern filtering

---

## Completed

- **Phases 1–6 + 7.1 / 7.3 / 7.4** (2026-04-06) — core pipeline, budget estimation, non-interactive mode, run management. See [`docs/roadmap.md`](docs/roadmap.md) for details.
- **2026-04-16 audit** — full-repo security/privacy/correctness sweep. Output: [`docs/hardening-roadmap-2026-04-16.md`](docs/hardening-roadmap-2026-04-16.md).
