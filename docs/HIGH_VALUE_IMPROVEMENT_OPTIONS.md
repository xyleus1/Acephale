# High-Value Improvement Options

Last updated: 2026-06-20

This is the blunt product direction to keep the work from drifting into random feature collection. The app already has enough screens. The valuable work now is making one commercial workflow tight enough that an operator can trust it.

## Priority Options

1. Close the pricing procurement loop.
   Finish the real RFQ-to-forwarder-to-rate-to-customer-quote flow: reviewed forwarder sends, inbound reply parsing into structured rates, strategy recompute, customer quote send, and follow-up tracking. Until this loop works, "automation" is mostly demo surface.

2. Make Desk a true decision queue.
   The Desk should rank work by commercial urgency: complete RFQs, create/send forwarder drafts, chase stale rates, review margin blockers, quote-ready deals, inbound replies, and high-risk jobs. Users should not have to know which page contains the next action.

3. Upgrade the agent from chatbot to action reviewer.
   Every agent proposal should carry enough audit evidence to be trusted: source, extracted facts, skipped fields, proposed diff, readiness impact, review status, and final mutation metadata. Chat-only intelligence is not good enough for freight operations.

4. Simplify UI around one commercial workflow.
   Keep the primary navigation centered on Inbox -> Deal Desk -> Pricing -> CRM -> Setup. Avoid overlapping mental models where the same job can be "handled" from five places with different rules.

5. Build the data moat.
   Use lane history, target-price history, customer conversion, forwarder response speed, accepted/rejected counter-offers, and margin outcomes to make pricing/route/risk recommendations better over time.

6. Add customer quote send and win/loss detection.
   After rates come in, the app should send/log the customer quote, detect yes/no/silence, and feed that outcome back into pricing strategy.

7. Production hardening.
   Remove dangerous schema mutation from build, use explicit database sync/migration commands, queue email/AI work, move file storage off local disk, and harden tenant isolation. This is boring, but freight software with fragile infra will punish you.

## Current Implementation Track

- Option 2 now has a reusable decision queue service, a better Desk queue, and an agent tool that reads the same queue.
- Option 2 also renders the queue before the no-job empty state, explains why each item is ranked, exposes score/category/action on the Desk, and returns queue summary metadata to the agent.
- Option 2 now includes stale/pending customer quote outcomes in the same shared queue, so quote follow-up and won/lost cleanup are part of the Desk instead of hidden on a customer record.
- Option 3 now has stronger `AgentProposal` audit metadata, clearer review UI, visible Job/RFQ field diffs, best-effort `agent.run` event logging for tool calls, `agent.proposal_reviewed` events for apply/discard decisions, a job-level audit trail card, and an office-wide Admin agent audit tab.
- Option 3 also routes common agent record-write tools through review proposals: job/RFQ edits, stage changes, quote lines, revenue/cost, customer links, company renames, deal renames, and milestone changes no longer mutate immediately from chat.
- Option 3 now also routes supplier awards, thread-linking, AI populate-from-emails, duplicate inquiry merge, merge-all-open-inquiries, and bulk hide through applyable review proposals with explicit record lists.
- Option 4 now has tighter navigation and copy around the lead-to-quote workflow, with the primary sidebar reduced to Inbox -> Deal Desk -> Pricing -> CRM -> Setup instead of treating the pipeline as a parallel home base.
- Option 7 now removes `prisma db push --accept-data-loss` from the production build path. Database sync must be explicit, `npm run db:push` refuses remote databases unless `ALLOW_REMOTE_DB_PUSH=1` is set, high-risk read/write paths now carry explicit office scoping, `npm run audit:tenant-scope` passes, and `npm run audit:tenant-scope:strict` is available for CI.
- Option 7 also has a Prisma config file instead of deprecated `package.json#prisma`, plus a document-storage boundary: local disk remains the dev driver, production local uploads are blocked unless explicitly allowed, and S3-compatible storage can be configured through environment variables.
- Option 7 now has a durable `BackgroundJob` queue, a `/api/cron/background-jobs` drain endpoint scheduled in `vercel.json`, and formerly fire-and-forget document analysis, supplier-offer prewarm, and customer notification work now enqueues instead of running inside request handlers.
- Option 7 now exposes background queue operations: Admin has a System Jobs tab with failed/running/stale/queued counts plus retry/run-now/release-lock controls, and `/api/health` checks the background job schema plus failed/stale backlog.
