Status: current-state
Owner: engineering
Last-verified: 2026-06-23
Source-of-truth: Codex permission model and repo safety rules

# Codex Permissions SOP

Recommended modes:

- Read-only investigation: use for discovery, review, and source analysis.
- Workspace edit: use for normal implementation inside the repo.
- Danger/full access: use only when intentional and justified. It is too sharp for routine edits.

Local safeguards:

- Deny `.env` reads/edits unless the task explicitly concerns env examples or docs.
- Restrict network unless the task needs live internet.
- Do not expose tokens, private keys, OAuth credentials, or customer secrets.
- Do not run destructive database commands against production.

Project-local hooks in `.codex/hooks/` are advisory developer safeguards. They are not production security.
