# Internal CRM / Relationship OS V1 PR Summary

## What Changed

- Added the implementation plan: `PRODUCT_CRM_IMPLEMENTATION_PLAN.md`.
- Added additive Prisma schema/migration support for relationship metadata and a new `CrmOpportunity` model.
- Added `/dashboard/crm` command center plus companies, people, opportunities, tasks, relationships, and entity detail routes.
- Added reusable CRM UI components for dense relationship tables, people cards, opportunity board, task queue, timeline, Brain Context, and internal-only forms.
- Added server-side CRM data helpers and server actions with explicit `officeId` scoping.
- Added a CRM Brain Context adapter over existing company dossier and operational brain search.
- Added RFQ detail integration: compact CRM Brain Context and RFQ-linked opportunity creation when a company is attached.
- Added `npm run test:crm` smoke coverage for CRM constants and owner-scope filtering.

## Safety

- No email sending.
- No Slack posting.
- No Gmail mutation.
- No live provider API calls.
- No booking, tendering, payments, or quote commitments.
- CRM actions are internal-only and use human-entered forms.
- Company/contact truth is not duplicated into parallel CRM tables.

## Verification

Run before merge:

- `npx prisma validate`
- `npm run db:generate`
- `npm run test:crm`
- `npx tsc --noEmit`
- `npm run check:docs`
- `npm run build`

## Next Slice

Recommended next slice: live GBrain retrieval into CRM entity pages, still server-side and source-cited, with a persisted approval/audit record for any agent-suggested CRM mutation.
