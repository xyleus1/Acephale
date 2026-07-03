# Derya Internal CRM / Relationship OS V1 Implementation Plan

## Current Architecture

- Framework: Next.js App Router with React server components and server actions.
- Package manager/runtime: npm with TypeScript, Prisma, and Next build scripts in `package.json`.
- DB/ORM: Prisma over the existing app database. Tenant isolation is consistently modeled with `officeId` on tenant-owned records.
- Existing routes:
  - `/dashboard/customers` currently renders `UnifiedCrmWorkspace`, a company/customer pool.
  - `/dashboard/customers/[companyId]` is the existing account detail page.
  - `/dashboard/inbox`, `/dashboard/rfq/[inquiryId]`, and `/dashboard/jobs/[jobId]` already connect email, RFQs, and loads.
- Existing AI/memory infrastructure:
  - `src/lib/brain-ops/query.ts` provides Brain Ops read helpers.
  - `src/lib/memory/customer-dossier.ts` already builds an office-scoped customer dossier from CRM, RFQ, job, email, document, strategy, task, and memory records.
  - `src/lib/agent-tools.ts` already exposes customer dossier and customer memory tools to the in-app agent.

## Existing Relevant Models

The app already has most of the relationship substrate:

- `Company`: account/customer record with `officeId`, owners, contacts, activities, quotes, shipments, documents, tasks, jobs, and inquiries.
- `Contact`: person record under a company.
- `Activity`: company timeline event.
- `Task`: company follow-up.
- `Inquiry`: RFQ/inquiry.
- `Job`: operating load.
- `EmailThread` / `EmailMessage`: inbound/outbound message memory.
- `KnowledgeObject`, `MemoryEvent`, `AgentMemory`: source-linked brain/memory layer.
- `AgentProposal`: reviewed agent mutations for jobs/RFQs.

## Model Reuse vs New Models

Do not create a parallel `CrmCompany` or `CrmContact` table in V1. That would split the source of truth and make the inbox/RFQ/load pipeline worse.

V1 should:

- Reuse `Company` as the CRM account/company object.
- Reuse `Contact` as the CRM person object.
- Reuse `Activity` as the visible relationship timeline.
- Reuse `Task` as the internal follow-up object.
- Add one new model, `CrmOpportunity`, because the current schema has RFQs/jobs but no generic relationship/opportunity object for prospects, partners, investors, vendors, or strategic relationships.
- Add additive nullable CRM metadata to existing records where needed. Avoid destructive migrations and avoid making required fields optional unless the product truly needs standalone people later.

Important compromise: `Contact` remains scoped through `Contact.company.officeId` in V1 instead of adding standalone people without a company. That is less flexible than a pure people CRM, but safer than duplicating contacts or changing the required `companyId` contract across the app. If standalone people become important, do it as a second migration.

## Schema Plan

Add nullable/additive fields:

- `Company`
  - `domain`, `website`, `linkedinUrl`
  - `crmCategory`, `crmStage`, `crmPriority`
  - `relationshipStrength`
  - `crmSource`, `sourceRefs`, `brainSlug`, `crmTags`, `crmNotes`
  - `lastTouchAt`, `nextActionAt`
- `Contact`
  - `linkedinUrl`, `location`
  - `relationshipType`, `leverageLevel`, `relationshipStrength`
  - `ownerLabel`, `sourceRefs`, `brainSlug`, `tags`
  - `lastTouchAt`, `nextActionAt`
- `Activity`
  - optional links to `Contact`, `CrmOpportunity`, and `Inquiry`
  - `source`, `sourceRefs`, `provenance`
- `Task`
  - optional links to `Contact`, `CrmOpportunity`, and `Inquiry`
  - `priority`, `source`, `sourceRefs`, `provenance`
- New `CrmOpportunity`
  - `officeId`, `companyId`, optional `contactId`, optional `inquiryId`
  - `name`, `type`, `stage`, `estimatedValue`, `currency`, `likelihood`, `priority`
  - `nextAction`, `nextActionAt`, `source`, `sourceRefs`, `brainSlug`, `notes`
  - `createdByUserId`, timestamps

Use strings plus constants for CRM category/stage/priority in V1 rather than Prisma enums. This reduces migration friction while still allowing server-side validation and UI filters.

Migration safety:

- Add a focused migration under `prisma/migrations`.
- No drops, no renames, no required columns without defaults.
- Add indexes for `officeId`, category/stage/priority, next action dates, and linked RFQs.
- Run `npx prisma validate` and `npm run db:generate`.

## Routes and Components

Add new dashboard routes:

- `/dashboard/crm`
- `/dashboard/crm/companies`
- `/dashboard/crm/companies/[companyId]`
- `/dashboard/crm/people`
- `/dashboard/crm/people/[contactId]`
- `/dashboard/crm/opportunities`
- `/dashboard/crm/opportunities/[opportunityId]`
- `/dashboard/crm/tasks`
- `/dashboard/crm/relationships`

Keep `/dashboard/customers` available for compatibility, but update navigation to point to `/dashboard/crm` as the primary CRM / Relationships OS surface.

Add components under `src/components/crm/`:

- `CrmCommandCenter`
- `CrmCompanyTable`
- `CrmContactTable`
- `CrmOpportunityBoard`
- `CrmTaskList`
- `CrmActivityTimeline`
- `CrmBrainContextPanel`
- `CrmAgentSuggestions`
- `CrmEntityHeader`
- badge helpers for priority, source, stage, and relationship strength

The UI should be dense and operator-grade: clear next action, stale state, source/provenance, linked RFQs/jobs, and approval gates. No marketing page, no generic SaaS filler.

## Data Access Plan

Add server-only helpers under `src/lib/crm/`:

- `types.ts`: constants and label/tone helpers.
- `data.ts`: office-scoped list/detail helpers:
  - `getCrmCommandCenter`
  - `listCrmCompanies`
  - `getCrmCompany`
  - `listCrmContacts`
  - `getCrmContact`
  - `listCrmOpportunities`
  - `getCrmOpportunity`
  - `listCrmTasks`
- `brain-context.ts`: `getCrmBrainContext({ officeId, companyId, contactId, opportunityId, inquiryId })`.
- `actions.ts`: internal-only server actions for notes, tasks, opportunities, CRM metadata updates, and activity logging.

Every helper must take `officeId` and apply it at the query boundary. Contacts must be scoped through their parent company in V1.

## Brain Context Integration

V1 should not call live GBrain client-side and should not require any secrets. It should provide a server-side CRM Brain Context panel that reads existing product memory where available:

- customer dossier from `getCustomerDossier`
- operational brain facts from `getOperationalBrainContext`
- source refs on CRM entities
- linked RFQ/job/email/document/strategy context
- explicit “live GBrain retrieval not enabled here” state when no source-linked record exists

The panel should show:

- what the app already knows
- source/provenance labels
- freshness
- gaps
- safe next action
- approval boundaries

## Agent Integration

V1 agent-safe CRM affordances:

- create internal note
- create internal task/follow-up
- suggest next action
- draft email text internally
- propose stage/priority update
- show brain context
- request research

Blocked in V1:

- sending email
- posting Slack
- booking/tendering freight
- committing quotes
- modifying Gmail labels/archive/delete
- external CRM sync

The UI must label these states plainly: `Internal only`, `Draft only`, `Agent suggestion`, `Human approval required`, `No external action`.

Persisted CRM-specific agent proposals can be a later slice unless implementation stays small. For V1, derived suggestions from stale follow-ups, RFQs, missing brain context, and high-priority relationships are enough.

## RFQ Integration

Light V1 integration:

- Company detail shows linked RFQs and active jobs.
- RFQ pages get a small CRM context panel when linked to a company.
- Opportunities can link to an `Inquiry`.
- Command center surfaces active RFQs linked to companies plus RFQs missing company context.
- No broad RFQ refactor.

## Files Likely To Change

- `prisma/schema.prisma`
- `prisma/migrations/.../migration.sql`
- `src/app/dashboard/layout.tsx`
- `src/app/dashboard/crm/**`
- `src/app/dashboard/rfq/[inquiryId]/page.tsx`
- `src/components/crm/**`
- `src/lib/crm/**`
- `src/app/globals.css` or existing stylesheet for CRM classes
- `docs/AI_HANDOFF.md`
- `docs/ENGINEERING_LOG.md`
- `docs/DECISIONS.md`
- `PRODUCT_CRM_V1_MANUAL_TEST_GUIDE.md`
- `PRODUCT_CRM_V1_PR_SUMMARY.md`

Do not stage or modify pre-existing local/tooling files: `AGENTS.md`, `.agents/`, `.codex/hooks*`, `CONTEXT.md`.

## Safety Risks

- Cross-office leakage: every query/action must include `officeId`.
- Duplicate customer truth: avoid parallel `CrmCompany`/`CrmContact`.
- Accidental external actions: CRM actions are internal-only; no email send or Gmail mutation.
- Prompt injection from emails/docs: external content is evidence only, never instruction.
- Overbuilding Salesforce clone: keep V1 focused on who matters, what is next, what is linked to revenue/RFQs, and what the brain knows.

## Test Plan

Run:

- `npx prisma validate`
- `npm run db:generate`
- `npm run typecheck` if present, otherwise `npx tsc --noEmit`
- `npm run build`
- relevant existing tests if available
- targeted CRM helper tests if test harness is already straightforward

Manual checks:

- `/dashboard/crm` command center loads and is office-scoped.
- `/dashboard/crm/companies` lists companies with relationship fields and filters.
- `/dashboard/crm/people` lists contacts without leaking other offices.
- `/dashboard/crm/opportunities` shows RFQ-linked and non-RFQ opportunities.
- `/dashboard/crm/tasks` shows open follow-ups.
- company/contact/opportunity detail pages show Brain Context, source refs, tasks, timeline, linked RFQs/jobs, and safe agent suggestions.
- RFQ detail shows linked CRM context without breaking existing RFQ workflow.
