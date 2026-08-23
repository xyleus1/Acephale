# Derya Freight OS Agent Guidance

## Product Context

- Derya is an AI-native freight forwarding operating system, not a generic CRM.
- The product brain is about pricing, route choice, risk assessment, margin guardrails, negotiation support, and operational execution with human approval where risk is high.
- Repo docs are the source of truth. Chat history is not.

## Required Reading

- Before implementation tasks, read `docs/NEXT_AGENT_TASK.md` if it contains a populated task.
- Before changing visible UI or product copy, read and follow `DESIGN.md`.
- Read `docs/AI_COLLABORATION_PROTOCOL.md` for the strategy-agent to coding-agent workflow.
- Read `docs/COMPANY_BRAIN.md` for memory, agent, retrieval, and intelligence work.
- Read `docs/PROJECT_CONTEXT.md` for freight workflow and product context.
- Read `docs/DECISIONS.md` before architecture changes.
- Read `docs/AI_HANDOFF.md` for the latest completed work.

## Engineering Rules

- ABSOLUTE RULE (Mert, 2026-07-21): NEVER use an em dash (the U+2014 character) anywhere. Not in UI copy, emails, WhatsApp drafts, subjects, notes, memory records, agent-generated text, LLM prompts, code comments, or docs. Use a comma, colon, period, or plain hyphen instead. Only exceptions: historical Prisma migration files (checksummed, never edit) and verbatim quotes of external input.
- Preserve tenant scoping with `officeId` on reads, writes, syncs, memory records, and agent-visible data.
- Preserve provenance and evidence for company-brain work. Agent answers should be traceable to source records when possible.
- Prefer deterministic domain logic before LLM calls. LLMs should explain, draft, rank, or assist, not silently replace business rules.
- Preserve human approval for risky customer-facing or supplier-facing actions.
- Keep changes scoped and additive unless explicitly asked to refactor or replace behavior.
- Do not touch secrets, `.env` values, tokens, private keys, or credentials.
- Do not change product behavior, database schema, or dependencies unless the task explicitly asks for it.
- Firecrawl/web intelligence work must keep `FIRECRAWL_API_KEY` secret, use
  source allow-lists, avoid broad crawls, avoid paywall/login scraping, and use
  mocked fixtures for tests unless the task explicitly asks for live internet.
- Treat the app-wide 80 percent airy, 20 percent compact direction and the
  zero-fluff product-copy rule in `DESIGN.md` as requirements, not suggestions.

## Handoff And Verification

- After completing coding work, explain what was built and what to test in one short, simple summary by default. Give more detail only when the user asks or a material failure or risk requires it.
- Update `docs/AI_HANDOFF.md` and `docs/ENGINEERING_LOG.md` after meaningful implementation tasks.
- Add a `docs/DECISIONS.md` entry for architecture decisions that future agents should treat as durable.
- Run the verification commands requested by the task. Report exact failures instead of fixing unrelated code.
