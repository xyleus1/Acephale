# Derya Procurement API

Audience: a customer office (for example Guild) that wants to create procurement
orders, attach context and documents, and poll status from its own systems.

- Base URL: `https://app.derya.ai`
- Transport: HTTPS only, JSON except for document uploads
- Auth: session cookie `crm_session`, issued by `POST /api/auth/session`
- Tenancy: every route is scoped to the office of the authenticated user. The
  Bourne procurement customer is resolved server side from that office, so a
  client can never select another tenant's data or customer id.
- Do not cache authenticated responses. Routes that explicitly set
  `cache-control` use `no-store`; document upload success responses do not
  currently advertise a cache-control header.

## 1. Authenticate

```
POST /api/auth/session
Content-Type: application/json

{ "identifier": "guild", "password": "..." }
```

`identifier` is either the office username (for example `guild`) or a full email
address. A bare username is resolved to the reserved internal identity
`<username>@office.derya.invalid`.

Success returns `200` plus a `Set-Cookie: crm_session=...` header:

```json
{
  "ok": true,
  "officeId": "b1f0...",
  "role": "ADMIN",
  "canViewWholeOffice": true,
  "expiresInSeconds": 34560000
}
```

Store the cookie and send it on every later call. The cookie is httpOnly,
`SameSite=Lax`, and valid for 400 days, so a long lived integration can log in
once and refresh only when a call returns `401`.

Errors: `400` invalid body, `401` `{"error":"Invalid username, email, or
password."}`, `413` body over 8,000 bytes, `429` after five failed attempts
per resolved identifier within 15 minutes, or five failed attempts for the same
identifier and client IP within 15 minutes.

`DELETE /api/auth/session` clears the session and returns `204`. It is safe to
call without a session.

Curl example that keeps the cookie in a jar:

```bash
curl -sS -c derya.cookies -X POST https://app.derya.ai/api/auth/session \
  -H 'content-type: application/json' \
  -d '{"identifier":"guild","password":"'"$DERYA_PASSWORD"'"}'
```

Every example below assumes `-b derya.cookies`.

## 2. Find your workspace

Orders and context both hang off a company workspace. List the ones your office
can see:

```
GET /api/supply-os/workspaces
```

```json
{
  "workspaces": [
    {
      "id": "5d0e...",
      "companyId": "...",
      "externalKey": "guild:primary",
      "name": "Guild Expansion",
      "status": "ACTIVE",
      "version": 1,
      "updatedAt": "2026-09-12T09:15:00.000Z",
      "company": { "name": "Guild AI, Inc.", "website": "http://guildai.co/" },
      "mediaAssets": [ { "url": "https://cdn.example.com/guild-logo.png" } ],
      "snapshots": [
        {
          "id": "...",
          "version": 1,
          "publishedAt": "2026-09-12T09:15:00.000Z",
          "_count": { "items": 42, "locations": 3, "inventory": 18, "demands": 7 }
        }
      ]
    }
  ]
}
```

Keep the workspace `id`. It is the `workspaceId` path segment for context routes
and the `requestContext.source.workspace_id` value on new orders.

## 3. Create a procurement order

```
POST /api/procurement/requests
Content-Type: application/json
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `quantity` | number | yes | Positive, up to 1,000,000,000 |
| `unit` | string | yes | 1 to 80 characters, for example `pcs`, `kg`, `L` |
| `idempotencyKey` | string | yes | 1 to 200 characters, unique per real order |
| `material` | string | required unless `bomId` is set | Up to 500 characters |
| `bomId` | uuid or null | no | Existing bill of materials to reorder |
| `specification` | string or null | no | Up to 4,000 characters of requirements |
| `neededBy` | `YYYY-MM-DD` or null | no | Delivery deadline |
| `notes` | string or null | no | Up to 4,000 characters, internal notes |
| `requestContext` | object | no | Structured context, see below |
| `lineItemPreferences` | object | no | Free form per line preferences |

Unknown fields are rejected with `400`. The body must stay under 64 KB.

`requestContext` is a free form JSON object with two conventions Derya reads:

- `requestContext.source.workspace_id`: the workspace the order belongs to.
  Required for customer portal accounts, and strongly recommended for office
  accounts because it is what links the order to the company workspace.
- `requestContext.source.campaign`: set to `CUSTOM` when the order should inherit
  the workspace context assembled by Derya.
- `requestContext.procurement_context`: request specific context for the sourcing
  agent. When present it takes precedence over inherited company context.

For orders whose source campaign is `CUSTOM`, Derya assembles the workspace
context (uploaded documents and context messages) into the order automatically,
so anything added in section 5 is already visible to sourcing.

```bash
curl -sS -b derya.cookies -X POST https://app.derya.ai/api/procurement/requests \
  -H 'content-type: application/json' \
  -d '{
    "material": "NEMA 17 bipolar stepper motor",
    "specification": "1.8 deg step, 42 mm frame, 0.9 Nm holding torque",
    "quantity": 250,
    "unit": "pcs",
    "neededBy": "2026-10-15",
    "idempotencyKey": "guild-po-2026-0912-a",
    "requestContext": {
      "source": { "campaign": "CUSTOM", "workspace_id": "5d0e..." },
      "procurement_context": { "program": "Robotics pilot", "incoterm": "DAP Long Beach" }
    }
  }'
```

`201` for a newly created order, `200` when the same `idempotencyKey` and body
returned an existing order:

```json
{
  "orderId": "a83295c3-...",
  "status": "new",
  "workflowWakeRequested": true,
  "message": "Request accepted"
}
```

Idempotency: the key is hashed together with the request payload. Reusing a key
with a different payload is a conflict (`409`), so generate one key per real
order and retry with the exact same body.

Errors: `400` validation, `401` no session, `403` workspace not allowed for this
account, `409` idempotency conflict, `413` body too large, `500` submit failed.
A `500` may leave the order unsubmitted, so retry with the same key.

If `workflowWakeRequested` is `false`, the order is saved but sourcing has not
started. Nudge it:

```
POST /api/procurement/requests/{orderId}/wake
```

`202` when this call started processing, `200` when processing was already
requested, `503` when the workflow refused. On `503` the order is safe, retry
after 30 seconds.

## 4. Check status

Single order:

```
GET /api/procurement/requests/{orderId}
```

```json
{
  "id": "a83295c3-...",
  "status": "awaiting_shortlist_approval",
  "progress": "Shortlist ready for review; nothing was sent.",
  "material": "NEMA 17 bipolar stepper motor",
  "specification": "...",
  "quantity": 250,
  "unit": "pcs",
  "neededBy": "2026-10-15",
  "requestContext": { "source": { "campaign": "CUSTOM", "workspace_id": "5d0e..." } },
  "approvalRequestedAt": "2026-09-13T11:04:22.000Z",
  "decisionSnapshot": { },
  "vendors": [
    {
      "id": "...",
      "name": "Oriental Motor USA",
      "website": "https://www.orientalmotor.com",
      "contact": { "name": null, "email": "sales@example.com", "phone": null },
      "contacted": true,
      "responseCount": 1,
      "status": "contacted",
      "research": { },
      "quote": { }
    }
  ],
  "updatedAt": "2026-09-13T11:04:22.000Z"
}
```

`404` when the order does not exist or belongs to another tenant. The two cases
are deliberately indistinguishable.

Order list, newest first, up to 50:

```
GET /api/procurement/requests?activeOnly=true&sourceWorkspaceId=5d0e...
```

Optional filters: `activeOnly` (`true` or `false`), `sourceWorkspaceId`,
`sourceCompanyName`, `sourceCampaign`. Response is
`{ "requests": [ ... ] }` where each entry is the detail shape without
`vendors`, `approvalRequestedAt`, and `decisionSnapshot`, plus `notes`,
`supplierCount`, `contactedCount`, and `responseCount`.

Status vocabulary:

| `status` | Meaning |
| --- | --- |
| `new` | Queued, sourcing not started |
| `researching` | Supplier research running |
| `awaiting_shortlist_approval` | Supplier shortlist waiting for approval |
| `sourcing` | RFQs sent, collecting supplier replies |
| `awaiting_order_approval` | Final order waiting for approval |
| `ordered` | Completed |
| `needs_attention` | Blocked, `progress` explains what is missing |
| `cancelled` | Canceled |

`activeOnly=true` excludes only `ordered` and `cancelled`; approval and attention
statuses are still included. Approvals at `awaiting_shortlist_approval` and
`awaiting_order_approval` are human decisions taken inside the Derya app, not
through this API, and nothing is sent to a supplier before that approval.

The shortlist behind a pending approval is readable:

```
GET /api/procurement/research-shortlist/{orderId}
```

This endpoint uses `Authorization: Bearer <research shared secret>` rather than
the `crm_session` cookie. It returns `200` with the shortlist when Derya
research mode is enabled, `401` for a missing or invalid bearer secret, `404`
when the order or shortlist is unavailable, and `503` when research is disabled
or unavailable.

## 5. Add context and documents

Context is per workspace. It is inherited by orders whose
`requestContext.source.campaign` is `CUSTOM` and whose
`requestContext.source.workspace_id` identifies that workspace.

Read the current context:

```
GET /api/supply-os/workspaces/{workspaceId}/context
```

```json
{
  "context": {
    "workspace": { "id": "5d0e...", "name": "Guild Expansion" },
    "documents": [
      {
        "id": "...",
        "name": "tolerance-spec.pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 184320,
        "contentHash": "...",
        "summary": "...",
        "processingState": "READY",
        "processingError": null,
        "itemId": null,
        "itemName": null,
        "createdAt": "2026-09-12T09:15:00.000Z"
      }
    ],
    "messages": [ ],
    "procurementActions": [ ],
    "prospectingActions": [ ]
  }
}
```

`processingState` is `READY`, `UNSUPPORTED`, or `FAILED`. Only `READY` documents are
extracted into the context that sourcing reads, so poll this route after upload
if the text matters for the order.

Upload a document:

```
POST /api/supply-os/workspaces/{workspaceId}/context/documents
Content-Type: multipart/form-data
```

Fields: `file` (required), optional `itemId` to attach the document to a
specific inventory item.

```bash
curl -sS -b derya.cookies \
  -X POST https://app.derya.ai/api/supply-os/workspaces/5d0e.../context/documents \
  -F 'file=@tolerance-spec.pdf;type=application/pdf'
```

`201` with `{ "document": { ... } }` on a complete upload. A request whose
`content-length` exceeds the limit is rejected with `413` before the body is
read.

Limits and accepted types:

- 10 MB per document
- PDF, TXT, Markdown, CSV, PNG, JPEG, WebP, DOC, DOCX, XLS, XLSX, ZIP, STL
- The filename must have a supported type. A declared non-`application/octet-stream`
  `Content-Type` must match the filename's inferred type; a mismatched or
  unsupported type is rejected with `400`.
- PDF extraction covers the first 25 pages and 100,000 characters per document.

Large files can be sent in 2 to 4 chunks instead, by adding `uploadId` (16 to 80
characters of `A-Za-z0-9_-`, stable across the chunks of one file),
`chunkIndex` (zero based), `chunkCount`, `fileName`, `fileType`, and `fileSize`
alongside a `file` part holding that chunk. Each chunk is limited to 3 MB and
the assembled file must match `fileSize` exactly. Incomplete uploads return
`202` with `{ "complete": false }`; the chunk that completes the set assembles
the document and returns `201` with `{ "complete": true, "document": { ... } }`.
Unfinished chunk sets expire, so send all chunks in one pass.

Download a stored document:

```
GET /api/supply-os/workspaces/{workspaceId}/context/documents/{documentId}
```

The response streams the original bytes with the stored content type and a
`content-disposition` attachment header.

Add a context message, which is a written instruction or answer the sourcing
agent should honor:

```
POST /api/supply-os/workspaces/{workspaceId}/context/chat
Content-Type: application/json

{ "instruction": "Only US based suppliers, and RoHS compliance is mandatory." }
```

Returns `{ "result": { ... }, "messageSaved": true }`. Each instruction is
capped at 4,000 characters. Customer access is limited to 20 messages per
15-minute window per portal user and workspace. A `503` with
`"messageSaved": true` means the message was stored but the agent reply failed,
so do not resend it.

## 6. Errors

| Code | Meaning |
| --- | --- |
| `400` | Validation failure, `error` names the first problem |
| `401` | Missing, expired, or invalid route authentication; log in again or provide the research bearer secret |
| `403` | Authenticated but not entitled to that workspace |
| `404` | Not found, or not visible to your tenant |
| `409` | Idempotency conflict, or a conflicting state |
| `413` | Body over the route limit |
| `422` | A connector rejected the payload |
| `429` | Rate limited, back off and retry |
| `500` | Unexpected server failure, safe to retry with the same idempotency key |
| `503` | A downstream workflow or agent was unavailable, retry later |

Error bodies include an `{ "error": "human readable message" }` field; some
routes also return structured fields such as `issues`, `code`, `retryable`, or
`messageSaved`. Authentication errors never echo credentials.

## 7. Operational notes

- Poll status at most once per minute per order. Sourcing runs in minutes to
  hours, not seconds.
- There are no webhooks today. Status changes must be polled.
- Customer portal accounts use the parallel `/api/portal/procurement/...`
  routes with the same shapes, and are restricted to their assigned workspaces.
- Nothing in this API contacts a supplier. Supplier outreach happens only after
  a human approval inside Derya.
