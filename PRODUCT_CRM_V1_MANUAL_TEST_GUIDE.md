# Internal CRM / Relationship OS V1 Manual Test Guide

## Preconditions

- Sign in to a real office or local development office.
- Run schema migration/generation for the target environment before using the new CRM routes.
- Do not use these flows to send email, book freight, tender loads, or mutate Gmail. V1 CRM actions are internal-only.

## Routes

- `/dashboard/crm` - command center.
- `/dashboard/crm/companies` - relationship/account directory.
- `/dashboard/crm/people` - contacts/people directory.
- `/dashboard/crm/opportunities` - opportunity board.
- `/dashboard/crm/tasks` - internal follow-up queue.
- `/dashboard/crm/relationships` - high-priority people/accounts.
- `/dashboard/crm/companies/[companyId]` - company detail.
- `/dashboard/crm/people/[contactId]` - person detail.
- `/dashboard/crm/opportunities/[opportunityId]` - opportunity detail.
- `/dashboard/rfq/[inquiryId]` - compact CRM Brain Context panel on RFQs.

## Test Flow

1. Open `/dashboard/crm`.
   - Expected: command center shows counts, follow-ups, active RFQs, opportunities, stale relationships, and agent-safe suggestions.
   - Expected: no external-action controls appear.

2. Create a relationship from the `New relationship` control.
   - Use a fictional/test company.
   - Expected: it redirects to `/dashboard/crm/companies/[id]`.
   - Expected: the company is assigned to the current user and gets an internal timeline note.

3. On company detail, add a contact, opportunity, task, and internal note.
   - Expected: each appears on the company page after submit.
   - Expected: Brain Context panel remains internal-only and shows gaps/source state.

4. Open `/dashboard/crm/people`.
   - Expected: the new contact appears and links to the person detail page.
   - Expected: person detail can create an internal opportunity/task/note tied to the parent company.

5. Open `/dashboard/crm/opportunities`.
   - Expected: opportunity appears in its stage column.
   - Expected: changing stage on opportunity detail creates a timeline event.

6. Open `/dashboard/crm/tasks`.
   - Expected: open tasks show company/contact/opportunity context.
   - Mark one done.
   - Expected: task leaves the default open queue.

7. Open a linked RFQ detail page.
   - Expected: CRM Brain Context panel appears on the RFQ side rail.
   - If the RFQ has a linked company, expected: `Create opportunity` can create an internal RFQ-linked opportunity.

## Safety Checks

- No email is sent.
- No Slack message is posted.
- No Gmail labels/archive/delete actions run.
- No booking, tender, payment, provider API, or quote commitment is triggered.
- All data reads/writes are scoped by `officeId`; non-admin users see only owned companies through the same owner scope as the older customer workspace.

## Known V1 Limits

- Contacts remain company-scoped. Standalone people without a company need a later migration.
- Brain Context uses existing server-side CRM/RFQ/memory search. It does not call live GBrain from the browser.
- CRM-specific agent suggestions are derived from stale tasks/RFQs/relationships; persisted agent proposals are a later slice.
