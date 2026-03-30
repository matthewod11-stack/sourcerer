# Overnight Agent

Autonomous overnight agent for resolving tech-debt GitHub issues via Claude Desktop local scheduled task.

## How It Works

1. A Desktop local task runs nightly at 2:00 AM PT
2. The agent reads open `tech-debt` issues, filters out design-decision/deferred/in-progress
3. Picks up to 3 mechanical issues per run (oldest first)
4. Creates a branch + PR for each fix, or comments if it needs to bail
5. You review PRs in the morning
6. Run log written to `state/overnight-agent-log.json`

**Task prompt:** `prompts/overnight-agent.md`

## Autonomous Agent Prompt

```
You are an overnight maintenance agent for Sourcerer — an AI-powered talent sourcing agent (TypeScript + pnpm monorepo + Turborepo + vitest).

## Setup
1. Read CLAUDE.md for full project context
2. Run `pnpm install`
3. Run `pnpm build` to confirm clean baseline. If build fails, STOP and comment on the most recent open issue with the build error. Do not proceed.
4. Run `pnpm test` to confirm tests pass. If tests fail, STOP and comment with the failure output. Do not proceed.

## Triage
1. Run `gh issue list --state open --label tech-debt --json number,title,labels,body` to fetch all open tech-debt issues
2. Filter OUT any issue that also has the label `needs-design-decision`, `deferred`, or `in-progress`
3. Filter OUT any issue whose body contains "## Automation Hints" with `risk: high`
4. Sort remaining by issue number (oldest first)
5. Pick up to 3 issues for this run

## For each issue
1. Read the full issue body — treat "## Suggested Fix" as your instructions
2. Check the `blocked-by` field in Automation Hints — if it references an open issue, skip
3. Create a branch: `fix/issue-{N}-{short-slug}`
4. Implement the fix following the issue's suggested approach
5. Run `pnpm build` — must pass. If it fails, revert your changes, comment on the issue with what went wrong, and move to the next issue
6. Run `pnpm test` — must pass. If new test failures, revert and comment
7. Run `pnpm typecheck` — must pass. If new type errors, revert and comment
8. Check `max-files-changed` from Automation Hints — if you exceeded it, revert and comment with what happened
9. If all gates pass: commit, push, open PR with `gh pr create --title "fix: {description} (closes #{N})" --body "Closes #{N}\n\n{1-2 sentence summary of what changed}\n\nVerified: pnpm build, pnpm test, and pnpm typecheck all pass."`
10. If the issue turns out to be already resolved (no changes needed), comment on the issue explaining what you found and close it with `gh issue close {N}`
11. `git checkout main` before starting the next issue

## Safety rails
- MAX 3 issues per run — even if more qualify
- NEVER modify core type definitions in `packages/core/src/types/` unless the issue explicitly targets them
- NEVER touch files listed in `do-not-touch` in Automation Hints
- If an issue's scope is ambiguous or seems to require design decisions, SKIP it and comment: "Skipping: this issue may require design input. Recommend adding `needs-design-decision` label."
- If you encounter merge conflicts with a previous branch from this run, skip that issue
- Check `bail-if` conditions in Automation Hints before pushing
- Respect the monorepo: only modify packages within the `scope` specified in Automation Hints
- After modifying a package, run its tests specifically: `pnpm --filter @sourcerer/{package} test`

## End of run
After processing all issues (or hitting the cap), output a summary:
- Issues fixed (with PR links)
- Issues skipped (with reasons)
- Issues closed as resolved
- Any warnings or observations
```

## Issue Template

Use this template when filing new tech-debt issues so the overnight agent can pick them up:

```markdown
## Description
[What's wrong and why it matters — 1-2 sentences]

## Current State
[What exists today — specific files and behavior]

## Suggested Fix
[Step-by-step approach]
- [ ] Step 1
- [ ] Step 2

## Verification
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` clean
- [ ] [optional: specific test/grep check]

## Automation Hints
scope: [file or directory paths the agent should touch]
do-not-touch: [files/dirs the agent must NOT modify]
approach: [extract-and-move | add-declarations | refactor-types | config-change | add-tests | add-migration | add-validation | refactor-to-config]
risk: [low | medium | high]
max-files-changed: [number]
blocked-by: [#N or "none"]
bail-if: [explicit abort conditions beyond "build fails"]

## Priority
[Low | Medium | High]
```

### Label conventions

| Label | Meaning for agent |
|-------|-------------------|
| `tech-debt` | Eligible for overnight agent |
| `needs-design-decision` | Agent skips — requires human input |
| `deferred` | Agent skips — intentionally postponed |
| `in-progress` | Agent skips — someone is already working on it |
| `testing` | Can combine with `tech-debt` — agent will add tests |

### Automation Hints reference

| Field | Purpose |
|-------|---------|
| `scope` | Files/dirs the agent should focus on |
| `do-not-touch` | Explicit negative scope — agent self-checks before committing |
| `approach` | Categorizes the type of work |
| `risk` | `high` = agent skips entirely |
| `max-files-changed` | Circuit breaker — if exceeded, agent reverts and comments |
| `blocked-by` | Agent checks if referenced issue is still open; skips if so |
| `bail-if` | Per-issue abort conditions the agent evaluates before pushing |
