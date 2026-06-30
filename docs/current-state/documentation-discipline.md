Status: current-state
Owner: engineering
Last-verified: 2026-06-23
Source-of-truth: `AGENTS.md`, `docs/AI_COLLABORATION_PROTOCOL.md`, `scripts/check-docs-fresh.ts`

# Documentation Discipline

Derya docs use explicit status markers so agents do not confuse implemented behavior with plans or brainstorms.

Allowed status values are `current-state`, `plan`, `brainstorm`, `report`, `archived`, `proposed`, `active`, `superseded`, and `rejected`.

`current-state` docs require `Last-verified: YYYY-MM-DD` near the top. Reports are dated observations. Plans are future intent. Brainstorms are idea capture. Archived docs are retained history.

Every PR that changes a documented workflow must update the corresponding doc in the same PR. Run:

```bash
npm run check:docs
```

The checker governs new status-disciplined folders and legacy docs that opt into a `Status:` header. It intentionally does not force every old markdown file to be rewritten at once.
