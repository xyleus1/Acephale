# AI Collaboration Protocol

This repo is the source of truth. Chat history is working memory, not durable project state.

The protocol exists to keep the strategy/chat agent, coding agent, and founder aligned without relying on whoever remembers the last conversation best. If a decision, caveat, verification result, or next task matters, it belongs in the repo docs.

## Roles

### Strategy/chat agent

- Turns founder intent into a clear product and architecture prompt.
- Uses repo docs as context before inventing new direction.
- Writes the next implementation task into `docs/NEXT_AGENT_TASK.md` when a coding handoff is needed.
- Treats `docs/AI_HANDOFF.md`, `docs/DECISIONS.md`, and `docs/ENGINEERING_LOG.md` as the durable record.

### Coding agent

- Implements the task in the repo.
- Keeps changes scoped to the requested implementation.
- Updates `docs/AI_HANDOFF.md` after implementation.
- Adds durable engineering notes to `docs/ENGINEERING_LOG.md` when the work changes how future agents should operate.
- Adds or updates `docs/DECISIONS.md` only for decisions that should outlive the task.

### Founder

- Reviews the implementation and the handoff.
- Resolves product questions or sends them back to the strategy/chat agent.
- Uses the handoff as the payload for the next strategy pass.

## Workflow

1. Founder gives product direction to the strategy/chat agent.
2. Strategy/chat agent reads repo docs and creates a product/architecture prompt.
3. Strategy/chat agent places the implementation task in `docs/NEXT_AGENT_TASK.md`.
4. Coding agent reads `docs/NEXT_AGENT_TASK.md` and relevant repo docs.
5. Coding agent implements the task.
6. Coding agent verifies the task with repo-appropriate checks.
7. Coding agent updates `docs/AI_HANDOFF.md` with what changed, behavior added, verification, caveats, product questions, and the recommended next step.
8. Founder reviews the implementation and handoff.
9. Founder sends the handoff back to the strategy/chat agent for the next product decision or task.

## Codex-native workflow

- `AGENTS.md` is the durable instruction layer. Root guidance applies repo-wide; nested `AGENTS.md` files apply when Codex is started from that directory or when the user explicitly asks Codex to read them.
- `docs/NEXT_AGENT_TASK.md` is the task packet for the next implementation pass.
- `docs/AI_HANDOFF.md` is the output packet from the completed implementation pass.
- `.codex/rules` files are for command permissions and safety prompts, not company context.
- Start Codex from specialized directories when you want nested `AGENTS.md` guidance to apply automatically, such as `src/lib/memory` for company-brain memory work.
- If Codex is started from the repo root, explicitly ask it to read the relevant nested `AGENTS.md` before specialized work.

## Handoff Rules

- Do not rely on chat history for durable context.
- Do not hide failed checks. Failed or skipped verification belongs in the handoff.
- Do not include secrets, `.env` values, access tokens, customer credentials, or private keys.
- Do not claim database behavior changed unless the schema, migrations, seed data, and runtime path support that claim.
- Do not bury product uncertainty. Put unresolved product questions in the handoff.
- Keep the handoff short enough to read, but specific enough for the next agent to audit.
- Prefer exact commands and concrete file names over vague summaries.

## Documentation Responsibilities

- `docs/AI_HANDOFF.md`: current implementation handoff. Update after each coding-agent task.
- `docs/NEXT_AGENT_TASK.md`: next implementation prompt. Strategy/chat agent or founder updates before coding starts.
- `docs/DECISIONS.md`: durable product and engineering decisions.
- `docs/ENGINEERING_LOG.md`: chronological implementation notes, especially checks run, known caveats, and follow-up work.

## Using The Generator

Run:

```bash
npm run ai:handoff
```

The command prints a handoff draft with Git metadata, changed files, package script changes, and Prisma migration files. Review it before pasting into `docs/AI_HANDOFF.md`; the generator can collect context, but it cannot know the product intent or judge caveats for you.
