# Bourne procurement communication ledger

## Purpose

Bourne owns supplier email execution and inbox observation. Derya owns the
authenticated operator view. Bourne must persist each delivered or observed
supplier message in the shared workflow database so Derya can render the exact
conversation without connecting the same mailbox a second time.

This is a database handoff. It is not a webhook and it does not send provider
credentials to Derya.

## Files to give Bourne

1. `scripts/sql/bourne-procurement-communication-ledger.sql`
2. This contract

Apply the SQL as the Bourne Neon database owner after the canonical
`ProcurementOrder` and `OrderSupplier` tables and the `dashboard_api` and
`bourne_supply_chain` roles exist. The runtime `bourne_supply_chain` role must
not run the migration and does not need schema or database `CREATE` privilege.
The main `scripts/sql/procurement-dashboard-api.sql` provisioning file also
includes this ledger migration.

## Ownership

- Bourne writes `procurement_communication_messages` after a confirmed send or
  an observed inbound message.
- The owner migration grants `bourne_supply_chain` only `SELECT` and `INSERT`
  on the ledger. Existing rows are immutable to that runtime role.
- Derya has `SELECT` only.
- Neither runtime role keeps schema or database `CREATE` privilege.
- The browser never receives provider message IDs.
- Derya reads only rows matching the authenticated customer, order, and vendor.
- Derya rejects a row when `counterparty_email` is not present in its sender,
  recipient, or CC addresses.
- The database foreign keys reject a vendor attached to the wrong order or an
  order attached to the wrong customer.
- Orders and vendors with recorded messages cannot be deleted until an owner
  explicitly handles the retained transcript.
- One provider message cannot be linked to two customers, even if the worker
  retries with a different customer ID.
- Drafts, failed sends, and unconfirmed delivery attempts do not belong in the
  ledger.

Before insertion, remove leading and trailing whitespace from provider IDs and
email addresses, lowercase all email addresses, and reject values that become
empty. Apply the same normalization to every address in `to_emails` and
`cc_emails`. The database rejects surrounding spaces, tabs, and line breaks so
two textual forms of one provider identity cannot bypass idempotency.

## Required row

Write one immutable row per provider message.

| Column | Required | Bourne value |
| --- | --- | --- |
| `customer_id` | yes | Authenticated Bourne customer UUID |
| `order_id` | yes | Exact procurement order UUID |
| `vendor_id` | yes | Exact `order_vendors.id` UUID |
| `provider` | yes | Uppercase provider key, currently `GMAIL` |
| `account_email` | yes | Bourne mailbox that sent or received the message |
| `counterparty_email` | yes | Verified supplier email for this vendor thread |
| `provider_message_id` | yes | Gmail API message `id`, not the RFC header |
| `provider_thread_id` | recommended | Gmail API `threadId` |
| `rfc_message_id` | recommended | RFC `Message-ID` header when available |
| `direction` | yes | `OUTBOUND` or `INBOUND` |
| `from_email` | yes | Actual sender address |
| `from_name` | no | Actual sender display name |
| `to_emails` | yes | JSON array of up to 50 normalized recipient addresses |
| `cc_emails` | yes | JSON array of up to 50 addresses, use `[]` when empty |
| `subject` | no | Message subject |
| `body_text` | no | Plain text body, never OAuth data or raw credentials |
| `body_truncated` | yes | `true` when Bourne shortened the stored body |
| `attachments` | yes | JSON metadata array, use `[]` when empty |
| `sent_at` | yes | Provider message timestamp |

Recommended attachment metadata:

```json
{
  "filename": "quote.pdf",
  "mimeType": "application/pdf",
  "size": 248113,
  "providerAttachmentId": "provider-owned-id"
}
```

Do not store OAuth tokens, refresh tokens, authorization headers, passwords, or
raw provider API responses.

The Bourne send and inbox-observation steps should produce this normalized
object before the database insert:

```json
{
  "customerId": "customer-uuid",
  "orderId": "order-uuid",
  "vendorId": "vendor-uuid",
  "provider": "GMAIL",
  "accountEmail": "purchasing@example.com",
  "counterpartyEmail": "supplier@example.com",
  "providerMessageId": "gmail-api-message-id",
  "providerThreadId": "gmail-api-thread-id",
  "rfcMessageId": "<message@example.com>",
  "direction": "OUTBOUND",
  "fromEmail": "purchasing@example.com",
  "fromName": "Purchasing",
  "toEmails": ["supplier@example.com"],
  "ccEmails": [],
  "subject": "Request for quote",
  "bodyText": "Please quote the attached requirement.",
  "bodyTruncated": false,
  "attachments": [],
  "sentAt": "2026-08-21T18:00:00.000Z"
}
```

## Outbound write

After Gmail confirms the send, use the returned Gmail `id` and `threadId`.
Insert the ledger row and keep the existing vendor receipt fields populated
during the compatibility period.

```sql
BEGIN;

INSERT INTO procurement_communication_messages (
  customer_id,
  order_id,
  vendor_id,
  provider,
  account_email,
  counterparty_email,
  provider_message_id,
  provider_thread_id,
  rfc_message_id,
  direction,
  from_email,
  from_name,
  to_emails,
  cc_emails,
  subject,
  body_text,
  body_truncated,
  attachments,
  sent_at
) VALUES (
  $1::uuid,
  $2::uuid,
  $3::uuid,
  'GMAIL',
  lower($4),
  lower($5),
  $6,
  $7,
  $8,
  'OUTBOUND',
  lower($4),
  $9,
  $10::jsonb,
  $11::jsonb,
  $12,
  $13,
  $14,
  $15::jsonb,
  $16::timestamptz
)
ON CONFLICT (customer_id, provider, account_email, provider_message_id)
DO NOTHING;

UPDATE order_vendors AS vendor
SET contact_email = COALESCE(vendor.contact_email, lower($5)),
    gmail_message_id = COALESCE(vendor.gmail_message_id, $6),
    updated_at = now()
FROM orders AS procurement_order
WHERE vendor.id = $3::uuid
  AND vendor.order_id = $2::uuid
  AND procurement_order.id = vendor.order_id
  AND procurement_order.customer_id = $1::uuid
  AND EXISTS (
    SELECT 1
    FROM procurement_communication_messages AS communication
    WHERE communication.customer_id = $1::uuid
      AND communication.order_id = $2::uuid
      AND communication.vendor_id = $3::uuid
      AND communication.provider = 'GMAIL'
      AND communication.account_email = lower($4)
      AND communication.provider_message_id = $6
      AND communication.direction = 'OUTBOUND'
  );

COMMIT;
```

If the same provider message is retried, `ON CONFLICT DO NOTHING` makes the
ledger write idempotent. The guarded vendor update runs only when that exact
message is bound to the same customer, order, and vendor, so a global provider
ID conflict cannot stamp the wrong supplier receipt. Do not overwrite an
existing message with different content.

## Inbound write

When Bourne observes a supplier reply, insert another ledger row with:

- `direction = 'INBOUND'`
- `from_email = counterparty_email`
- `account_email` set to the receiving Bourne mailbox
- the provider reply `id` and `threadId`
- the exact order and vendor IDs already bound to the thread

Do not replace `order_vendors.gmail_message_id` with every reply. That field is
the compatibility anchor for the initial supplier contact. The ledger carries
the full message sequence.

## Existing-message backfill

For every active supplier thread already visible in Bourne Inbox:

1. Resolve the exact customer, order, and vendor from Bourne workflow state.
2. Read the full provider thread.
3. Determine the verified supplier counterparty email.
4. Insert each sent and received message using its provider message ID.
5. Populate missing `order_vendors.contact_email` and the first outbound
   `gmail_message_id`.
6. Skip any thread that cannot be bound to exactly one vendor. Put it in a
   manual review queue instead of guessing from the supplier name.

Backfill must be idempotent and customer scoped. Supplier-name matching alone
is not acceptable.

## Rollout order

1. Run the protected `production-bourne-ledger.yml` workflow from `main`. It
   uses bounded timeouts and concurrent index creation against the pinned
   Bourne Neon owner target. Do not grant `CREATE` to either runtime role.
2. Deploy the Derya ledger reader.
3. Update Bourne send and inbox-observation steps to write ledger rows.
4. Backfill existing active supplier threads.
5. Verify one outbound and one inbound message in Derya Messages.

Derya detects whether the table exists. Before provisioning, it keeps the old
connected-Gmail path. After ledger rows exist, Derya reads Bourne first and no
longer requires a duplicate Gmail connection for those conversations.

## Acceptance checks

- A Bourne outbound row changes the matching manufacturer to contacted.
- A Bourne inbound row changes the request's supplier-response count.
- The exact subject, body, direction, and timestamp appear in Derya Messages.
- An inbound row appears after the outbound row in the same manufacturer view.
- A different customer cannot read the rows.
- `dashboard_api` cannot insert, update, or delete ledger rows.
- `bourne_supply_chain` can select and insert, but cannot update, delete, or
  truncate ledger rows.
- Provider message IDs do not appear in the browser response.
- A missing ledger table still leaves the older connected-Gmail fallback
  operational.
