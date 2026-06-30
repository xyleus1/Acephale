Status: current-state
Owner: engineering
Last-verified: 2026-06-23
Source-of-truth: `docs/templates/agent-journal.md`

# Agent Journal

The agent journal is a manual workflow for reviewing repeated AI friction and proposing improvements.

Use it weekly or monthly when agent runs repeatedly hit the same missing context, unclear docs, brittle tests, unsafe paths, or data cleanup issues.

Keep proposals short. Do not expose secrets or `.env` values. Output at most five proposals per report.

Automation can be added later if the existing scheduled-job system needs it. Do not add a scheduler until there is a clear operational owner.
