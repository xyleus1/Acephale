# Derya Freight OS Agent Guidance

## Product Context

- Derya is a freight forwarding operating system, not a generic CRM.
- The product supports pricing, route choice, risk assessment, margin guardrails, negotiation, and operational execution with human approval where risk is high.
- Repo docs are the source of truth. Chat history is not.
- FOUNDER PRODUCT DIRECTION (Mert, 2026-08-08): The retired parallel procurement prototype and its Supply OS name, routes, models, scripts, dependencies, and product positioning must not return. The freight dashboard, RFQ, pricing, inbox, CRM, carrier, intelligence, reporting, and Supplier Finder workflows are the active internal product. Any reversal requires a new explicit founder instruction that names this decision and explains the migration and data-preservation plan.

## Required Reading

- Before implementation tasks, read `docs/NEXT_AGENT_TASK.md` if it contains a populated task.
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
- Follow `docs/PRODUCT_COPY_POLICY.md` for every visible string and generated draft. Product copy must state operational context, status, limits, action, recovery, or provenance. Never use retired product names, model promotion, AI capability claims, slogans, internal strategy jargon, or self-congratulatory evidence language. Run `npm run check:product-copy` after copy changes.
- Keep changes scoped and additive unless explicitly asked to refactor or replace behavior.
- Do not touch secrets, `.env` values, tokens, private keys, or credentials.
- Do not change product behavior, database schema, or dependencies unless the task explicitly asks for it.
- Firecrawl/web intelligence work must keep `FIRECRAWL_API_KEY` secret, use
  source allow-lists, avoid broad crawls, avoid paywall/login scraping, and use
  mocked fixtures for tests unless the task explicitly asks for live internet.

## Handoff And Verification

- Update `docs/AI_HANDOFF.md` and `docs/ENGINEERING_LOG.md` after meaningful implementation tasks.
- Add a `docs/DECISIONS.md` entry for architecture decisions that future agents should treat as durable.
- Run the verification commands requested by the task. Report exact failures instead of fixing unrelated code.
