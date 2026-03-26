# Data Source Strategy — Sourcerer

> **Created:** 2026-03-26
> **Status:** APPROVED — ready for roadmap integration
> **Context:** Research into candidate sourcing data beyond the existing adapter set (Exa, GitHub, X, Hunter.io). Motivated by LinkedIn's walled garden, Hunter.io's cost constraints, and the availability of $50/mo Apify credits.
> **Integrates with:** `docs/roadmap.md` Phase 7.5 (Premium Adapters) — to be reorganized into a dedicated Data Source Expansion phase.

---

## Executive Summary

The current adapter set covers web search (Exa), code (GitHub), social (X), and email (Hunter). The biggest gap is **professional profile data** — the LinkedIn-shaped hole. This strategy adds four high-ROI adapters and two free enrichers that collectively cover professional databases, LinkedIn (via scraping), email (free replacement for Hunter), and open-source contribution signals.

**Total new monthly cost:** ~$50 (Apify budget) + $0 (Apollo, Stack Overflow, ecosyste.ms are free)

---

## Current Coverage Map

```
DISCOVERY (finding candidates)
├── Exa semantic search .............. ✅ built (Phase 2)
├── LinkedIn search .................. ❌ gap — walled garden
├── Professional database search ..... ❌ gap
└── Google web search ................ ❌ gap

ENRICHMENT (deepening candidate profiles)
├── GitHub (code, repos, languages) .. ✅ built (Phase 2 + 4A)
├── X/Twitter (social signals) ....... ✅ built (Phase 4B)
├── LinkedIn profile data ............ ❌ gap
├── Email finding .................... ✅ Hunter.io (50 free/mo — expensive beyond that)
├── Stack Overflow (technical rep) ... ❌ gap — free API available
├── OSS contributions (npm/PyPI) ..... ❌ gap — free API available
└── Academic papers .................. ❌ gap — free API available (niche)
```

---

## Proposed Adapters

### Tier 1 — Build These (High ROI)

#### 1. `adapter-apollo` — Professional Database + Email

**What:** Apollo.io has 275M+ contacts with an incredibly generous free tier. People Search doesn't consume credits. Email finding is unlimited (~250/day fair use).

**Why it's high priority:**
- **Replaces Hunter.io for email** — Hunter gives 50 free/mo; Apollo gives ~250/day
- **Adds discovery** — People Search by title, company, location, seniority (free endpoint)
- **Adds enrichment** — Work history, skills, company data
- **API quality** — Well-documented REST API, good rate limit transparency

**Capabilities:**
- `search()` — People Search by role, company, location, seniority, keywords. Maps to `SearchConfig` queries. Does NOT consume credits.
- `enrich()` — Contact enrichment (email, phone, work history). Uses email credits (~250/day).
- `enrichBatch()` — Bulk enrichment with rate limiting (50 req/min, 600 req/day free tier)
- `healthCheck()` — Validate API key
- `estimateCost()` — Always $0 on free tier (credit-based caps, not dollar-based)

**Pricing:**
| Tier | Cost | Search | Email Credits | Rate Limit |
|------|------|--------|---------------|------------|
| Free | $0/mo | Unlimited (no credits) | ~250/day fair use | 50 req/min, 600/day |
| Basic | $49/user/mo | Unlimited | 1,000/mo | Higher |

**Integration notes:**
- API key via `~/.sourcerer/config.yaml` (standard pattern)
- Free tier is sufficient for typical Sourcerer runs (50-candidate search = ~50 enrichments)
- People Search returns partial data; full enrichment requires separate call
- Rate limit: implement 600/day budget tracker (similar to Hunter quota guard)

**Risk:** Low. Legitimate SaaS platform. Standard API usage.

---

#### 2. `adapter-apify` — LinkedIn + Google Search (via Apify Actors)

**What:** Apify is a web scraping platform with a marketplace of pre-built "Actors." The user has $50/mo in credits. This adapter wraps the `apify-client` TypeScript SDK and provides access to multiple actors as sub-adapters.

**Why it's high priority:**
- **Unlocks LinkedIn** — the single biggest data gap for talent sourcing
- **Google Search** — cheap supplementary discovery ($0.002/query)
- **$50/mo budget** already allocated
- **TypeScript SDK** — `apify-client` is fully typed, fits our stack

**Architecture:**
```
adapter-apify/
├── src/
│   ├── apify-client.ts          # Shared ApifyClient wrapper + budget tracker
│   ├── actors/
│   │   ├── linkedin-search.ts    # harvestapi/linkedin-profile-search
│   │   ├── linkedin-profile.ts   # supreme_coder/linkedin-profile-scraper
│   │   ├── linkedin-company.ts   # harvestapi/linkedin-company-employees
│   │   └── google-search.ts      # apify/google-search-scraper
│   ├── apify-adapter.ts          # Main adapter (routes to sub-actors)
│   ├── parsers.ts                # Actor output → Candidate/EvidenceItem
│   └── index.ts
```

**Sub-actors:**

| Actor | Use Case | Cost | Actor ID |
|-------|----------|------|----------|
| LinkedIn Profile Search | Discovery — find candidates by title/company/location | ~$4/1k (short mode) | `harvestapi/linkedin-profile-search` |
| LinkedIn Profile Scraper | Enrichment — full profile data from URL | ~$3/1k profiles | `supreme_coder/linkedin-profile-scraper` |
| LinkedIn Company Employees | Discovery — all employees at a company | ~$4/1k (short mode) | `harvestapi/linkedin-company-employees` |
| Google Search Scraper | Discovery — web search for candidate profiles | ~$0.002/query | `apify/google-search-scraper` |

**Budget management:**
- Track spend per actor per run in `run-meta.json`
- Monthly budget cap ($50) enforced at adapter level
- Budget gate: estimate cost before executing, skip if over remaining monthly budget
- Store monthly spend in `~/.sourcerer/apify-budget.json` (reset on 1st of month)

**Capabilities:**
- `search()` — Routes to LinkedIn Profile Search or Google Search based on query type
- `searchCompanyEmployees()` — LinkedIn Company Employees actor
- `enrich()` — LinkedIn Profile Scraper for full profile data from URL
- `enrichBatch()` — Batch profile scraping with budget awareness
- `healthCheck()` — Validate Apify API token
- `estimateCost()` — Based on candidate count × per-result pricing

**Pricing estimate per typical run (50 candidates):**
- LinkedIn search (3 queries × ~100 results): ~$1.20
- LinkedIn profile enrichment (50 profiles): ~$0.15
- Google search (10 queries): ~$0.02
- **Total: ~$1.37 per run** → ~36 runs/month within $50 budget

**Legal considerations:**
- Use **no-cookie actors only** — no LinkedIn account at stake
- Only access publicly visible data
- hiQ v. LinkedIn (Ninth Circuit) precedent: scraping public data is not a federal crime
- LinkedIn TOS violation is a civil matter — low practical risk for an indie tool accessing public profiles
- Actors are 3rd-party maintained — may break when LinkedIn changes frontend
- **Late 2025 change:** LinkedIn moved some work history behind login wall — no-cookie actors return less complete data than before
- **Mitigation:** Always have fallback enrichment paths (Apollo, Exa, GitHub)

**Integration notes:**
- `apify-client` npm package (fully typed TypeScript)
- Pattern: `client.actor('actor-id').call(input)` → wait → `client.dataset(runId).listItems()`
- Actors run asynchronously on Apify infrastructure — need polling/webhook for completion
- Store Apify API token in `~/.sourcerer/config.yaml`

---

#### 3. `enricher-stackoverflow` — Technical Reputation Signal

**What:** Stack Exchange API v2.3. Free, no key required. Extracts reputation, badges, top tags, and answer quality.

**Why it's high priority:**
- **Free** — zero cost, no API key management
- **High signal** — Stack Overflow reputation is one of the strongest public indicators of technical depth
- **Easy to implement** — simple REST API, well-documented

**Capabilities:**
- `enrich()` — Given a Stack Overflow user ID or display name, returns reputation, badge counts, top tags with scores, answer count, question count
- Evidence items: `so-reputation`, `so-top-tags`, `so-badges`

**Data points extracted:**
- Reputation score (strong overall skill indicator)
- Gold/Silver/Bronze badge counts
- Top tags with tag scores (maps directly to skills)
- Answer count + acceptance rate (helpfulness signal)
- Account age (experience indicator)

**Rate limits:** 300 req/day unauthenticated. With API key (free): 10,000 req/day.

**Candidate matching:** Requires Stack Overflow username or profile URL. Can attempt fuzzy match via `/users` search endpoint (name + location), but match confidence is lower.

**Integration notes:**
- Not a full `DataSource` adapter — this is an enrichment-only module
- Could live as a sub-module within `adapter-apify` or as a standalone `enricher-stackoverflow` package
- Recommend: standalone package `packages/enrichers/enricher-stackoverflow/` to establish the enricher pattern

---

#### 4. `enricher-ecosystems` — Open Source Contribution Signal

**What:** ecosyste.ms provides free, open APIs aggregating package data across npm, PyPI, RubyGems, Crates.io, Go modules, and 30+ other registries. Maps maintainers to packages, download counts, and dependency graphs.

**Why it's high priority:**
- **Free** — open source project, no API key, no rate limit documented
- **Cross-ecosystem** — one API covers npm + PyPI + RubyGems + Crates.io instead of hitting each separately
- **Strong signal** — package authorship is a high-confidence indicator of technical capability and OSS involvement

**Capabilities:**
- `enrich()` — Given a GitHub username (which we already extract), find all packages they maintain across registries
- Evidence items: `ecosystems-packages`, `ecosystems-downloads`, `ecosystems-languages`

**Data points extracted:**
- Packages maintained (name, registry, version count)
- Total download counts (popularity signal)
- Language distribution across packages
- Dependency count (how widely depended upon)
- First/last publish dates (longevity signal)

**Candidate matching:** Uses GitHub username (already available from `adapter-github` enrichment). The ecosyste.ms API supports lookup by GitHub owner.

**Integration notes:**
- Standalone package `packages/enrichers/enricher-ecosystems/`
- Only runs if candidate has a GitHub username (conditional enrichment)
- Very low latency — API is fast and doesn't require authentication

---

### Tier 2 — Build When Needed

These are lower priority but well-researched. Ready to build when the use case demands it.

#### 5. `adapter-pearch` — Purpose-Built Sourcing API

- 810M+ profiles. Natural language search via MCP server.
- $200 intro pack (10,000 credits). Fast Search = 1 credit, Email = 2 credits.
- Best option for production-grade professional data at scale.
- **Build when:** Free tier adapters (Apollo, Apify) hit coverage or quality limits.

#### 6. `adapter-pdl` — Broad Professional Data

- 1.5B+ records. 100 free lookups/mo.
- Good enrichment complement — broad but can be stale.
- **Build when:** Need additional enrichment depth beyond Apollo + LinkedIn scraping.

#### 7. `enricher-semantic-scholar` — Academic Signal

- 214M+ papers. Free API, 100 req/5 min.
- Papers, citations, h-index, venues.
- **Build when:** Users source for ML/AI/research roles regularly.

#### 8. `enricher-devto` — Thought Leadership Signal

- Forem API v1. Free, no auth needed.
- Published articles, tags, reactions.
- **Build when:** Want to add content/writing signals to candidate profiles.

### Tier 3 — Skip

| Source | Reason |
|--------|--------|
| ContactOut | API gated behind enterprise sales call |
| RocketReach | $2,099/yr minimum for API access |
| Clearbit/Breeze | Absorbed into HubSpot, no standalone API |
| Proxycurl | Dead — sued by LinkedIn, shut down July 2025 |
| Patent databases | Too niche for V1 |
| Conference speakers | No unified API exists |
| Bright Data | Overkill proxy network, expensive for our scale |

---

## Revised Coverage Map (Post-Implementation)

```
DISCOVERY (finding candidates)
├── Exa semantic search .............. ✅ built
├── Apollo People Search ............. 🆕 FREE — title/company/location/seniority
├── Apify LinkedIn Search ............ 🆕 ~$4/1k — LinkedIn-native discovery
├── Apify LinkedIn Company Employees . 🆕 ~$4/1k — "all engineers at Company X"
├── Apify Google Search .............. 🆕 ~$0.002/query — web profile discovery
└── (Pearch, PDL — Tier 2)

ENRICHMENT (deepening candidate profiles)
├── GitHub (code, repos, languages) .. ✅ built
├── X/Twitter (social signals) ....... ✅ built
├── Apollo (email, work history) ..... 🆕 FREE — replaces Hunter.io for email
├── Apify LinkedIn Profile ........... 🆕 ~$3/1k — full LinkedIn profile data
├── Stack Overflow (technical rep) ... 🆕 FREE — reputation, tags, badges
├── ecosyste.ms (OSS packages) ...... 🆕 FREE — npm/PyPI/RubyGems authorship
├── Hunter.io (email verification) ... ✅ built — demoted to verification-only fallback
└── (Semantic Scholar, DEV.to — Tier 2)
```

**Net effect:** 4 new discovery channels (up from 1), 4 new enrichment sources (up from 3), email finding moves from paid to free.

---

## Implementation Sequence

Recommended build order, designed to slot into the roadmap after Phase 6:

```
Phase 8A: adapter-apollo ──────────── PARALLEL ─── Phase 8B: adapter-apify
(free, replaces Hunter email)          (LinkedIn + Google, $50/mo budget)
    │                                      │
    ├──────────────────────────────────────┘
    ▼
Phase 8C: enricher-stackoverflow + enricher-ecosystems ─── PARALLEL (both free, lightweight)
    │
    ▼
Phase 8D: Integration ─────────────── SEQUENTIAL
- Wire new adapters into enrichment orchestrator
- Update onboarding wizard (adapter menu)
- Update cost estimation
- Update CLI results display for new evidence types
```

**Estimated sessions:** 3-4 total (8A and 8B can run in parallel, 8C is lightweight)

---

## Impact on Existing Architecture

### Config changes (`~/.sourcerer/config.yaml`)
```yaml
adapters:
  apollo:
    api_key: "..."          # Free tier
  apify:
    api_token: "..."
    monthly_budget: 50      # USD cap
    actors:
      linkedin_search: harvestapi/linkedin-profile-search
      linkedin_profile: supreme_coder/linkedin-profile-scraper
      linkedin_company: harvestapi/linkedin-company-employees
      google_search: apify/google-search-scraper
  stackoverflow: {}         # No config needed (free, no auth)
  ecosystems: {}            # No config needed (free, no auth)
```

### Enrichment orchestrator changes
- Add Apollo to "cheap/free" adapter tier (runs first, alongside GitHub)
- Add Stack Overflow and ecosyste.ms to "cheap/free" tier
- Add Apify LinkedIn to "medium" tier (runs after cheap adapters)
- Demote Hunter.io to "email verification only" — run only if Apollo didn't find email
- Budget gate: Apify adapter checks remaining monthly budget before executing

### New package structure
```
packages/
├── adapters/
│   ├── adapter-apollo/        # NEW — discovery + email enrichment
│   ├── adapter-apify/         # NEW — LinkedIn + Google via Apify actors
│   ├── adapter-exa/           # existing
│   ├── adapter-github/        # existing
│   ├── adapter-hunter/        # existing (demoted to verification fallback)
│   └── adapter-x/             # existing
├── enrichers/                 # NEW directory
│   ├── enricher-stackoverflow/  # NEW — technical reputation
│   └── enricher-ecosystems/     # NEW — OSS package authorship
```

### Core type additions
- `EnricherModule` interface (lightweight variant of `DataSource` — enrichment only, no `search()`)
- `BudgetTracker` utility (shared by Apify and any future metered adapters)
- New evidence source types: `'apollo'`, `'apify-linkedin'`, `'apify-google'`, `'stackoverflow'`, `'ecosystems'`

---

## Open Questions

1. **Enricher vs Adapter pattern:** Should Stack Overflow and ecosyste.ms be full `DataSource` adapters or a lighter-weight `Enricher` interface? Leaning toward a new `Enricher` interface since they don't support discovery.
2. **Apify actor reliability:** Third-party actors can break without warning. Need a resilience strategy — fallback actors, error reporting, actor version pinning.
3. **LinkedIn data completeness:** With the late-2025 login wall change, no-cookie actors return less work history. How much does this matter for scoring? May need to weight LinkedIn evidence lower or combine with Apollo data.
4. **Apollo fair use limits:** "~250/day" is unofficial. Need to monitor for rate limit changes and have Hunter.io as fallback.
5. **Roadmap placement:** This document proposes "Phase 8" but the exact numbering depends on whether Phase 6 and 7 items get reorganized.
