# RFQ Brain Context V1 Implementation Plan

Generated: 2026-07-01

## Objective

Make the RFQ Brain Context / Domestic Trucking Rates V1 safe and explicit inside the product:

- US-only domestic trucking eligibility.
- Mock/manual rate providers only.
- Internal draft quote economics only.
- Read-only brain-context placeholders with source slugs.
- No live provider calls, customer sends, booking, tendering, or product writes beyond existing RFQ reads.

## Existing Baseline

The repo already contains a committed V1 slice:

- `src/lib/domestic-trucking-pricing.ts`
- `src/components/domestic-trucking-rate-panel.tsx`
- `src/app/dashboard/domestic-pricing/page.tsx`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `scripts/domestic-trucking-pricing.test.ts`

The right implementation move is hardening, not a rewrite.

## Files To Change

- `src/lib/domestic-trucking-pricing.ts`
  - Extend provider-neutral interfaces with sandbox, required-field, and response-normalization semantics.
  - Add explicit eligibility status, next questions, source/provenance, source mode, selected flag, and quote approval placeholders.
  - Expand read-only brain-context slugs for web intelligence and product bridge pages.
- `src/components/domestic-trucking-rate-panel.tsx`
  - Make V1 safety labels visible.
  - Show eligibility status, next questions, source/provenance, selected option, and draft-only approval state.
  - Keep customer-facing actions disabled.
- `src/app/globals.css`
  - Add compact styling for safety rail, next questions, provenance, and approval metadata.
- `scripts/domestic-trucking-pricing.test.ts`
  - Add smoke assertions for the hard safety contract and provider-neutral metadata.
- `docs/AI_HANDOFF.md`, `docs/ENGINEERING_LOG.md`, `docs/DECISIONS.md`
  - Record what changed, what was verified, and what is intentionally still blocked.

## Schema / DB

No Prisma schema change in V1. Persisted audit logs, selected rate options, and approval queues are deferred until the product has an explicit approval workflow for quotes.

## Test Plan

- `npx prisma validate`
- `npm run db:generate`
- `npx tsx scripts/domestic-trucking-pricing.test.ts`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build` with the repo's normal environment or a dummy local `DATABASE_URL` if needed.

## Manual Check

1. Open `/dashboard/rfq/[inquiryId]` for a Road RFQ.
2. Confirm the compact panel shows eligibility, missing fields, visible safety labels, and no send/book/tender controls.
3. Open `/dashboard/domestic-pricing?inquiry=[inquiryId]`.
4. Confirm complete US domestic RFQs show mock benchmark options and a draft-only quote.
5. Confirm missing or non-US lanes show blockers and no rate options.

## Deferred

- Live GBrain retrieval.
- Live provider credentials or API calls.
- Persisted rate audit log.
- Approval queue.
- Customer quote send workflow.
- Booking/tendering.
