# Next Agent Task

Chat-led outreach campaigns with an active-campaign banner.

## Objective

- An operator can plan an outreach campaign in chat, see the exact audience, count, mailbox, subject, and body, and start it by giving an explicit greenlight in chat.
- Nothing is emailed until that greenlight is applied. Chat drafting alone never sends.
- Every authenticated page shows a banner for each active or paused campaign with live counts.

## Context

- Wens is a live office with two research lists (`wens-pilot-primary`, `wens-pilot-check`) holding reviewable European and UK end-user rows. Those rows are the first audience.
- Sending infrastructure already exists: `src/lib/email-sender-pool.ts` reserves a sender with daily caps and idempotency, and `src/lib/supply-os/supplier-email-provider.ts` sends and reconciles through Gmail.
- `src/lib/procurement-bulk-rfq.ts` is the reference implementation for a bulk send loop: reserve, send, record, release on rejection, stop on pool exhaustion.
- Chat approval already exists: a tool creates a PENDING `AgentProposal` with `payload.entity = "bulk"`, and `apply <id>` in chat applies it through `applyPendingBulkActionProposal` in `src/lib/agent-proposals.ts`.
- No mailbox is connected for Wens yet, so a planned campaign must report that as a blocker instead of failing.

## Required reading

- Root `AGENTS.md`, `src/lib/AGENTS.md`
- `DESIGN.md` (banner is visible UI and product copy)
- `docs/AI_COLLABORATION_PROTOCOL.md`, `docs/DECISIONS.md`, `docs/AI_HANDOFF.md`

## Non-goals

- No second approval system. Reuse `AgentProposal` and the existing `apply <id>` path.
- No new dependencies.
- No changes to `EmailAccount`, `EmailSenderReservation`, reply sync, or existing outreach cadence in `src/lib/lead-outreach.ts`.
- No default campaign copy that asserts product specs, calibres, grades, prices, MOQ, certifications, or Incoterms. Copy always comes from the operator.

## Constraints

- Schema changes are allowed and additive only: two new models plus their relation fields.
- Every read and write is scoped by `officeId`.
- No em dash anywhere.
- The runner may only send for a campaign whose status is `ACTIVE`.

## Data model

Add to `prisma/schema.prisma` plus one new migration directory, and the matching relation fields on `Office` and `ResearchList`.

```prisma
model OutreachCampaign {
  id               String   @id @default(cuid())
  officeId         String
  name             String
  listId           String
  status           String   @default("DRAFT") // DRAFT / ACTIVE / PAUSED / COMPLETED / CANCELLED
  subject          String
  bodyTemplate     String
  emailField       String
  companyField     String?
  countryField     String?
  rowStatuses      Json     // eligible ResearchRecord statuses, e.g. ["new","reviewed"]
  filters          Json?    // { countries?: string[], segments?: string[], segmentField?: string }
  senderAccountId  String?  // required before activation; the shared pool is cross-office
  audienceTotal    Int      @default(0)
  dailyCap         Int      @default(40)
  createdByUserId  String?
  approvedByUserId String?
  approvedAt       DateTime?
  startedAt        DateTime?
  pausedAt         DateTime?
  completedAt      DateTime?
  lastRunAt        DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  office Office                 @relation(fields: [officeId], references: [id], onDelete: Cascade)
  list   ResearchList           @relation(fields: [listId, officeId], references: [id, officeId], onDelete: Cascade)
  sends  OutreachCampaignSend[]

  @@unique([officeId, name])
  @@unique([id, officeId])
  @@index([officeId, status])
}

model OutreachCampaignSend {
  id                String   @id @default(cuid())
  officeId          String
  campaignId        String
  recordId          String
  recipient         String
  status            String   @default("QUEUED") // SENT / REJECTED / UNKNOWN
  senderEmail       String?
  providerMessageId String?
  providerThreadId  String?
  localThreadId     String?
  error             String?
  sentAt            DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  office   Office           @relation(fields: [officeId], references: [id], onDelete: Cascade)
  campaign OutreachCampaign @relation(fields: [campaignId, officeId], references: [id, officeId], onDelete: Cascade)

  @@unique([campaignId, recordId])
  @@index([officeId, campaignId, status])
  @@index([officeId, sentAt])
}
```

## Modules

### `src/lib/outreach-campaign-copy.ts` (leaf, no `server-only`, no prisma)

Pure helpers so tests can import them under `tsx`:

- `CAMPAIGN_STATUSES` and `CampaignStatus`.
- `renderCampaignEmail({ subject, bodyTemplate, row })`: substitutes `{{company}}`, `{{country}}`, `{{email}}` from the row values, leaves unknown placeholders untouched, collapses header whitespace in the subject, and runs `stripEmDashes` on both.
- `campaignRowEligible({ row, statuses, countries, segments, emailField, countryField, segmentField })`: deterministic predicate. A row is eligible when its status is in `statuses`, its email value is a syntactically valid single address, and, when filters are given, its country or segment value matches case-insensitively.
- `campaignBlockers(input: { eligible: number; mailboxesAvailable: number; senderPinned: boolean; subject: string; bodyTemplate: string; dailyCap: number })`: returns a string array. Blockers, in this order and wording:
  - `"Subject is required."`
  - `"Body is required."`
  - `"Body must contain an opt-out line."` when the body has no line matching `/reply\s+(stop|no)|unsubscrib|opt out|opt-out/i`.
  - `"No mailbox is connected for sending."` when no shared mailbox is available.
  - `"Select a sender mailbox."` when a mailbox exists but the campaign has no pinned sender.
  - `"No eligible rows in this list."`
  - `"Daily cap must be between 1 and 200."`
- `campaignProgress({ total, sent, rejected, unknown })`: returns `{ total, sent, rejected, unknown, remaining }` with `remaining` never negative.

### `src/lib/outreach-campaigns.ts` (`server-only`)

- `planOutreachCampaign(input)`: resolves the list by slug or name inside `officeId`, counts eligible rows, counts rows already recorded as sent for the matching draft campaign, checks the shared sender pool through `listEmailSenderPoolAccounts()`, and returns a `CampaignPlan`: list name and slug, counts (`eligible`, `alreadySent`, `remaining`, `missingEmail`, `audienceTotal`), applied filters, `dailyCap`, `subject`, first 400 characters of the rendered body for a sample row, the pinned sender email or null, the available mailbox count, the resolved `emailField`, the first ten `sampleRecipients` with id, email, company, and country, and `blockers`.
- `saveDraftCampaign(input)`: creates or updates the single DRAFT campaign for that office and list, so repeated planning in one conversation does not accumulate campaigns. It stores the eligible audience id snapshot and a SHA-256 revision hash over the reviewed content and audience, and returns `{ id, revisionHash }`.
- `activateCampaign({ officeId, campaignId, userId, expectedRevisionHash })`: refuses with `"This campaign changed after it was proposed. Plan it again."` when the proposal hash no longer matches, then recomputes blockers and refuses with the blocker list if any remain. On success it snapshots the approved audience, sets `status = "ACTIVE"`, nullable `approvedByUserId`, `approvedAt`, and `startedAt` when first activated.
- `pauseCampaign`, `resumeCampaign` (only when `approvedAt` is set), `cancelCampaign`.
- `listCampaignSummaries(officeId, statuses)`: banner data per campaign: id, name, status, list name and slug, stored audience total, `sent`, `sentToday` using UTC day bounds, `rejected`, `unknown`, `replies`, `dailyCap`, pinned sender email, and `lastRunAt`. It uses aggregate queries rather than scanning research records and returns an empty array with one generic server log when the campaign table or column is not yet migrated.
- `completeCampaignIfDone({ officeId, campaignId })`: uses the approved audience snapshot and sets `COMPLETED` when no unsent snapshot row remains.

### `src/lib/outreach-campaign-send.ts` (`server-only`)

`runOutreachCampaignBatch({ officeId, campaignId, limit?, provider?, now?, pauseMs? })`, modeled on `runProcurementBulkRfq`:

- Loads the campaign scoped by `officeId`; returns `{ blocked: "NOT_ACTIVE" }` shaped result unless status is `ACTIVE`.
- Batch capacity is claimed transactionally as `dailyCap - sentToday - queuedToday`; stale QUEUED claims older than 30 minutes are reclaimed before claiming. The approved audience snapshot is used when present.
- Each row is status-checked immediately before reservation and send, so pause or cancellation stops the current run.
- Per row: `reserveEmailSender({ officeId, idempotencyKey: "outreach-campaign:" + campaignId + ":" + recordId, requestHash: sha256 of { campaignId, recordId, recipient, subject, body }, accountId: campaign.senderAccountId ?? undefined })`.
- Reservation already `completed` counts as `alreadySent`. `POOL_EXHAUSTED` or `POOL_EMPTY` stops the run and sets `poolExhausted`.
- Sends through `gmailSupplierEmailProvider.send` with sanitized id segments in the RFC message id. UNKNOWN sends are reconciled at the start of later batches and remain UNKNOWN unless the provider finds the message.
- `SENT` writes an `OutreachCampaignSend` row (upsert on `campaignId` plus `recordId`) with sender, provider ids, and `sentAt`, and updates `lastRunAt`. `REJECTED` releases the reservation and records the row with `status = "REJECTED"` and the error. `UNKNOWN` records `status = "UNKNOWN"` without releasing.
- Pauses `pauseMs` (default 400) between sends, then calls `completeCampaignIfDone`.

### Cron: `src/app/api/cron/outreach-campaigns/route.ts`

Mirror `src/app/api/cron/procurement-research/route.ts`: `CRON_SECRET` required, `sharedSecretMatches` on `x-cron-secret` or bearer, 401 with `{ "error": "Unauthorized" }`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300`. Iterates up to five `ACTIVE` campaigns across offices, runs one batch each, returns per-campaign counts. Register `/api/cron/outreach-campaigns` in `vercel.json` at `*/30 * * * *`.

## Chat surface

Add to `TOOLS` and the `dispatchTool` switch in `src/lib/agent-tools.ts`:

- `list_research_lists`: read only. Slug, name, row counts per status.
- `list_sender_mailboxes`: read only. Email, display name, provider, daily limit, and sent today from the shared sender pool.
- `plan_outreach_campaign` `{ list, statuses?, countries?, segments?, daily_cap?, subject?, body?, campaign_name?, sender_mailbox? }`: resolves `sender_mailbox` by email or account id, calls `planOutreachCampaign` and `saveDraftCampaign`, and requires a pinned sender before activation. When there are no blockers it also creates a PENDING proposal through `createPendingBulkActionProposal` with `kind: "OUTREACH_CAMPAIGN_START"`, `action: "START_OUTREACH_CAMPAIGN"`, `actionInput: { campaignId, revisionHash }`, an `actionLabel` naming list and recipient count, `actionDetails` listing the resolved sender mailbox, daily cap, filters, subject, and the fact that sending starts on the next batch, and review items shaped as `{ id, title, meta, detail }` from the plan's first ten sample recipients. The tool result includes the proposal id, resolved sender, and blockers. When blockers exist it creates no proposal and returns them.
- `list_outreach_campaigns`: read only, optional statuses and counts from `listCampaignSummaries`.
- `pause_outreach_campaign`, `resume_outreach_campaign`, `cancel_outreach_campaign` `{ campaign_id }`: direct, no proposal. Pausing and cancelling reduce risk, and resuming only works on a campaign that was already approved.
- `run_outreach_campaign_now` `{ campaign_id, limit? }`: only for an `ACTIVE` campaign, capped by the daily cap, so an operator who already greenlit can ask for the next batch immediately. A campaign without a pinned sender returns `blocked: "NO_SENDER"`.

In `src/lib/agent-proposals.ts`, add a `START_OUTREACH_CAMPAIGN` branch to `applyPendingBulkActionProposal` that calls `activateCampaign` and reports the blockers when activation refuses. Nothing sends inside the apply path.

In `src/lib/agent-chat.ts`, extend the existing command match so a bare greenlight phrase works: `/^(greenlight|green ?light|send it|approve it|go ahead)\b/i` applies the single PENDING `OUTREACH_CAMPAIGN_START` proposal for this office and user. With none pending, fall through to the normal agent flow. With more than one, list them and ask which id.

## Banner

- `src/components/active-campaign-banner.tsx`: server component, reads `listCampaignSummaries(session.officeId, ["ACTIVE", "PAUSED"])`, renders nothing when empty.
- Render it in `src/app/dashboard/layout.tsx` directly inside `.page-container`, above `{children}`.
- Per campaign, one row: campaign name, status, list name linking to `/dashboard/research/<slug>`, sender mailbox or `no mailbox connected`, `sent / total` and today against the daily cap in mono, rejected, replies, and last run time. Pause, resume, and stop controls in a small client component calling server actions in `src/app/dashboard/outreach-campaign-actions.ts`.
- Follow `DESIGN.md`: neutral surface, tokens only, sentence case, no marketing copy, counts in IBM Plex Mono, decision clay only for a paused or blocked state.

## Tests

- `scripts/outreach-campaign-copy.test.ts` (`test:outreach-campaign-copy`): placeholder substitution, em dash stripping, invalid and missing email rejection, status and country and segment filtering, every blocker string including the opt-out rule, progress math.
- `scripts/outreach-campaign-send.test.ts` (`test:outreach-campaign-send`): batch-size arithmetic against the daily cap, idempotency key and request hash shape, and the `SENT` / `REJECTED` / `UNKNOWN` / `POOL_EXHAUSTED` handling with an injected fake provider and reservation seam. Keep it pure in the style of `scripts/procurement-bulk-rfq.test.ts`, which sets a fake `DATABASE_URL` and exercises exported helpers, so extract whatever arithmetic and selection logic is needed into exported pure functions.
- Add both scripts to the `Supply OS tests` workflow job that already runs the deterministic suites.

## Verification

- `npm run test:outreach-campaign-copy`
- `npm run test:outreach-campaign-send`
- `npm run check:product-copy`
- `npx prisma validate` and `npx prisma migrate diff` consistency between schema and the new migration
- `npx tsc --noEmit`
- `npx next lint` on changed files only
- `git diff --check`

## Deployment note

The new tables need the `Production database migration` workflow run on `main` after merge. Nothing in the feature may assume the tables exist before that, so surface a clear failure instead of a crash if a query hits a missing table.
