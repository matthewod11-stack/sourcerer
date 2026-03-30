# Overnight Tech-Debt Agent

> Runs as a Claude Desktop local scheduled task at 2:00 AM PT.
> Full local tool access: pnpm, gh, node, git.

Read `docs/OVERNIGHT_AGENT.md` for the full autonomous agent prompt, then execute the instructions in the "Autonomous Agent Prompt" section.

At end of run, write a summary to `state/overnight-agent-log.json`:

```json
{
  "ts": "<ISO timestamp>",
  "issues_fixed": [{"number": 0, "pr_url": "..."}],
  "issues_skipped": [{"number": 0, "reason": "..."}],
  "issues_closed": [{"number": 0, "reason": "already resolved"}],
  "warnings": []
}
```
