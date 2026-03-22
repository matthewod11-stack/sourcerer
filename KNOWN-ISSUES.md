# Known Issues — Sourcerer

## Pre-Build (Design Phase)

- **LinkedIn data access:** LinkedIn API is closed to HR tech. Proxycurl shut down July 2025. Pearch (810M+ profiles) is the best alternative but is a paid API. Success profile intake accepts multiple input types to work around this.
- **LLM grounding enforcement:** The evidence grounding constraint (LLM can only cite canonical EvidenceItem IDs) is designed but untested. Early validation planned for Phase 3C with fixture data.
- **Identity resolution complexity:** Confidence-based merging across 5+ data sources is non-trivial. V1 scopes to auto-merge on high-confidence matches only. Unmerge is explicitly out of scope.
- **Google Sheets OAuth:** Deferred from Phase 6 to Phase 7 due to OAuth complexity (consent screen, token refresh, secure storage).
