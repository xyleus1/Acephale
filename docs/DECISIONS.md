# Decisions

## A supplier conversation is durable work with its own retry state

Date: 2026-09-06

- Status: accepted
- Owner: engineering
- Decision: The owed action for one supplier conversation of one request is
  stored in `ProcurementConversationTask`, keyed uniquely by
  `officeId, orderId, vendorId`. Passes update that row; they never recompute
  ownership from scratch and never enqueue a second row for the same thread.
- Retry rule: `src/lib/procurement-conversation-task.ts` is pure. Attempts count
  failures only, progress resets them, and the backoff is 5m, 15m, 1h, 4h then
  daily, repeating so no thread is abandoned. Whether a thread is due is a
  function of the stored row and the clock, not of what a pass happens to read.
- Terminal rule: a recorded quote is the only settled state. A supplier with no
  contact method is unreachable, counted in the funnel but never retried.
  `NEEDS_OPERATOR` stays owed, because nothing clears it without a person.
- Tenant boundary: writes and backlog reads are office scoped. The scheduled
  pass runs for every office, so it reads due request ids without an office and
  intersects them with the queue it was already allowed to work, so a task can
  never pull in a request outside that queue.
- Safety boundary: the task carries no message body. What goes to a supplier
  still comes from the saved draft and its idempotency record, so a retry can
  change only the mailbox, never the text, and confirmation gates for
  unsolicited follow ups are unchanged.
- Failure boundary: a store that cannot be written or read never silently reads
  as nothing owed. The pass reports it and the next pass rewrites the same
  threads from the same projection.

## Derya owns procurement order status; Bourne wake is opt-in

Date: 2026-09-05

- Status: accepted
- Owner: product and engineering
- Procurement workflow ownership defaults to Derya. Only
  `PROCUREMENT_WORKFLOW_OWNER=bourne` re-enables Bourne wake, retry, and
  reconciliation.
- When `PROCUREMENT_RESEARCH_MODE` is unset, research follows the workflow
  owner, so Derya research is on by default and
  `PROCUREMENT_WORKFLOW_OWNER=bourne` restores the old Bourne default for both.
  An explicit research mode overrides that fallback.
- Derya advances status through the tenant-scoped `SECURITY DEFINER`
  `advance_order_status` boundary. It accepts only `researching`, `sourcing`,
  and `awaiting_order_approval`, moves forward only, and uses the current row
  rank in its atomic update so concurrent progress events cannot lose a
  transition. It never overwrites `ordered`, `cancelled`, or
  `needs_attention`, which remain operator-owned.
- Hooks advance status on the first supplier discovery, first RFQ send, and
  first recorded quote. Supplier sends and approvals are unchanged.
- Out of scope: campaign banner, request-derived ICP discovery, multiple
  contacts per company, and auto-reply loops.


## A supplier conversation is finished only when a quote is recorded

Date: 2026-09-05

- Status: accepted
- Owner: product and engineering
- Decision: Every supplier thread on a sourcing request has a stage
  (`src/lib/procurement-conversation-stage.ts`), and the only stage that owes
  nobody anything is `QUOTED`. A thread never mailed owes a first contact, a
  thread holding a bounce, a wrong contact, or a question the request cannot
  answer owes an action a person has to take, and everything else owes an action
  the loop takes. A pass reports the stage counts, what is still owed, and the
  threads waiting on a person by name, so a request that stalled is visible in
  the pass result and in the scheduled response rather than in a manual sweep.
- Stages are derived, never stored: they are computed from the thread the pass
  just read, the drafts saved against it, the recorded quote, and the missing
  facts of this pass own quote sweep. A stored stage would be a second source of
  truth that drifts from the mailbox, and reconciling it is the failure mode this
  replaces.
- An automatic out of office notice is not an answer, so it does not settle a
  thread. It leaves the thread waiting on the supplier and the chase decision
  applies to it.
- A reply that states some commercial facts and not others is a question, not a
  dead end. The pass asks that supplier for the missing fact on their own thread
  with the category files attached, and a scheduled pass delivers that ask even
  though it withholds unsolicited chases and first contact nudges, because the
  thread already engaged and the missing fact is the last thing between the reply
  and a purchase order. The quiet period and the chase cap still bound it, and
  price, payment terms, and legal questions are still escalated rather than
  answered.

## A mailbox paused mid-send reroutes a first touch and defers a follow-up

Date: 2026-09-03

- Status: accepted
- Owner: product and engineering
- Decision: A sender-protection pause that lands between the sender-pool
  reservation and the provider call (`SENDER_PAUSED_ERROR`) is a mailbox
  problem, not a recipient problem, so it never settles the recipient as
  `REJECTED`. What happens next depends on whether the recipient already has a
  thread with a specific mailbox.
- First touch: no thread exists yet, so in a rotated campaign the message moves
  to another ready mailbox in the pool, once per run, under the same
  idempotency key and request hash (the released reservation is re-reserved, so
  the message cannot be delivered twice). A pinned campaign keeps the
  operator-chosen mailbox and waits: the claim is released and the recipient is
  reclaimed on a later run. A second pause in the same run also waits.
- Follow-up: the recipient's thread belongs to the mailbox that sent the first
  touch, so a follow-up is never rerouted. A paused first-touch mailbox defers
  the step until an operator resumes it; rotated campaigns keep sending other
  recipients, pinned campaigns stop the run.
- Reply boundary: a human reply on the thread ends the sequence, so it is
  checked before deferring. A replied recipient is skipped `REPLIED`, never
  parked and never rerouted. Delivery feedback, auto-replies, and bounce
  reports do not count as a reply.
- Consequences: `CampaignBatchResult.rerouted` reports first-touch reroutes.
  Reviewed recipients survive a bounce spike on one mailbox instead of being
  dropped, and a recipient never receives the same campaign from two mailboxes.

## Deterministic campaign targets own sourcing convergence

Date: 2026-09-03

A sourcing wave targets good suppliers by campaign class (narrow-high-value, specialist, broad-commodity), decided deterministically from the request; it stops on the quote goal, the good-lead target, or exhausted discovery. Bourne's four-supplier shortlist and Inbox approval are not the product's model; Derya owns convergence.

## Research projects group prospect lists by workflow

Date: 2026-09-03

Research projects group prospect lists per customer workflow; drafts name their
project; lists without a project remain visible as Other lists; no automatic
promotion into Companies/Contacts.

Projects and lists are office scoped. A project slug is unique within its
office, and a list can be assigned only to a project in the same office.
Context prospecting reuses a named project and writes reviewable research rows
without changing canonical Companies or Contacts.

## Outreach rotation uses reservations and office-wide recipient dedupe

Date: 2026-09-03

Rotation campaigns select from the enabled shared sender pool through the
existing sender reservation service. Reservations retain the selected mailbox
for each recipient and enforce per-account daily caps, while the plan reports
the mailbox count and total pool capacity available today. A rotation campaign
still requires an explicit human approval before sending.

Recipient dedupe is scoped to the office rather than the campaign. Planning
first keeps one row per normalized recipient within the campaign, then excludes
recipients with `SENT`, `QUEUED`, or `UNKNOWN` attempts from another campaign.
Transactional claiming repeats both filters before applying the daily limit so
concurrent campaigns cannot claim the same recipient. A `QUEUED` row blocks only
while its campaign is not cancelled and its claim is within the reclaim window.
Cancellation releases queued claims in the same transaction as the status
change. A `REJECTED` attempt does not block a later campaign, and recipients
blocked by another live claim count as resolved when completion checks the
approved snapshot. A successful sender reservation marks a queued row in flight
before the provider call, so cancellation releases only unreserved queued
rows. Provider rejection releases the sender reservation and records a
non-blocking `REJECTED` row. A reserved queued row remains eligible for the
existing reclaim threshold if the provider never completes.

Activation uses the saved audience snapshot rather than recomputing office-wide
dedupe, which would spuriously invalidate an approved revision. Send-time status
checks still prevent delivery to rows that are no longer eligible, and
personalization remains part of the revision hash.

## Follow-up steps may be attached after campaign approval

Date: 2026-09-03

An already-active campaign may receive a new follow-up sequence through the
authenticated ops action. This is an explicit post-approval change, so it
requires an active ADMIN in the same office and the exact confirmation phrase
`approve outreach follow-ups`. The route normalizes and validates the steps
before the domain update.

The update recomputes the stored revision hash from the existing approved
campaign snapshot plus the new normalized steps. It changes only `followUps`
and `revisionHash`, leaving first-touch copy, sender, audience,
personalization, variants, and daily cap pinned. DRAFT, ACTIVE, and PAUSED
campaigns can receive this change; COMPLETED and CANCELLED campaigns cannot.
This provides a reviewable way to add an approved follow-up without silently
changing the already-approved first-touch content.

Follow-up rows use positional step numbers for idempotency keys, provider
message ids, and reply chains. Replacing a sequence after any follow-up row
exists would reinterpret its history, so the update is rejected once a row has
been queued or sent. Sequence versioning was rejected in favor of this
explicit safety boundary. Malformed step arrays are rejected before
normalization, while omitted plan-time follow-ups remain optional.

## Every sign-in surface shares one hashed attempt counter

Date: 2026-09-02

`consumeLoginAttempt` in `src/lib/login-throttle.ts` is the only sign-in attempt
counter. Callers pass an identity string they namespace themselves
(`login-code:<address>`, `login-verify:<address>`, `login-password:<address>`,
and the bare address for the customer portal), a maximum, and an optional
window. The identity is HMAC-hashed with `AUTH_SECRET` before storage, so no
client address is persisted, and namespacing keeps one surface from spending
another's budget. Rows continue to live in `CustomerPortalLoginThrottle`: the
table is now generic despite its name, which is preferable to a second table
with identical semantics. New sign-in surfaces must consume a budget here
before any allowlist check or account lookup, so a flooded form cannot be used
to tell allowed addresses from unknown ones.

Address budgets are treated as best effort: `x-forwarded-for` is caller
controlled, so `clientAddressFromHeaders` prefers the platform-set
`x-vercel-forwarded-for` and every credential-guessing surface must also carry
an identifier-scoped budget that address rotation cannot escape. Identifier
budgets count failures only, read with `loginAttemptsExhausted` and spent after
the attempt is judged, so a valid credential is never locked out.

## Supplier quotes are written through a tenant scoped database function

Date: 2026-09-02

Recorded supplier quotes are written by the procurement workflow client, which
authenticates as `dashboard_api`, a role shared by every tenant. A column level
update grant was not enough: any statement issued by that role could have
reached another customer's supplier row, so tenant scope would have lived only
in application code. The role therefore holds no update privilege on
`order_vendors` at all. It may only execute
`record_order_vendor_quote(customer_id, order_id, vendor_id, quote)` in
`scripts/sql/procurement-dashboard-api.sql`, a security definer function with a
fixed search path that writes the quote column alone, only when the order
belongs to the calling customer, and only where no quote object is stored, so an
operator recorded quote is never overwritten and a rerun is idempotent. It
refuses an empty quote. Cross tenant rejection is proven against a migrated
database in `scripts/procurement-workflow-database.test.ts`. Any future supplier
write for this role goes through a function with the same customer check, never
through a column grant.

## Context research jobs are server-owned and cron-continued

Date: 2026-09-02

An operator-confirmed Context prospecting action opts into server-owned
continuation. A five-minute cron tick claims eligible actions across offices,
resolves the office-scoped workspace, runs bounded research batches, retries
bounded failures, and stops at the requested unique row target or exhausted
query plan. Candidate scans page in deterministic updatedAt and id order with
a hard 500-row cap, terminal payloads retire themselves, claim tokens protect
transition writes from stale workers, and creator activity is rechecked before
each batch. The browser chain remains only as a fast-feedback path while the
tab is open. Research writes reviewable rows and never sends or queues
outreach.

## Chat deletion is a hard delete of the thread and its messages only

Date: 2026-09-01

Deleting a company chat thread permanently removes the `CHAT_THREAD` row and
its `MESSAGE` rows, nothing else: documents, memory notes, and procurement
actions created from that chat are company-level records and survive. No
archive state was added; threads are cheap to recreate and an archive flag
would complicate every thread query. The General chat is virtual (thread id
null) and cannot be deleted. Deletion is internal-only; the customer portal
does not expose it.

## Approved outreach campaigns send from pinned recipient snapshots

Date: 2026-09-01

Campaign activation captures the approved audience's exact email, company,
and country values in an office-scoped personalization snapshot. Batch sends
must render from those pinned values instead of live research-list data, and
records without a pinned value are skipped. Later status changes can remove a
recipient from the approved audience, but imports cannot add one. Empty or
unreadable snapshots block execution rather than completing the campaign. The
personalization snapshot is part of the revision hash, so editing a research
row after planning requires the campaign to be planned and approved again.

## Outreach campaign approval reuses AgentProposal and pins a shared mailbox

Date: 2026-09-01

Chat campaign planning reuses the existing `AgentProposal` bulk action shape
and the `apply <id>` path instead of introducing a second approval system.
The greenlight phrase applies the single pending campaign proposal for the
current office and user; applying it activates the campaign but never sends.

Every campaign must pin its sender mailbox before activation. `EmailAccount`
is a shared cross-office sender pool, so allowing the pool to choose a mailbox
could send one office's campaign from another office's mailbox. Mailbox
selection is explicit in chat and visible in the proposal details.

## Supply OS panel alerts are derived client side, not stored

Sidebar attention blips are computed from data the workspace already loads
(the sourcing request list) plus one read-only activity route for the chat
(newest agent message, open clarifying questions, pending suggested actions).
"Seen" is a per browser `localStorage` timestamp per workspace and panel,
cleared when the panel is opened. There is no notification table, no read
receipt column, and no websocket. If alerts must follow an operator across
devices, or must cover per message read state, that is the point to introduce
persistence; until then this keeps the blip truthful without schema surface.

## Stale state in tests is produced by moving the clock, not by rewriting provenance

Date: 2026-08-31

Execution task input and its hash are immutable, and the database enforces that.
A test that reaches for `derya.allow_supply_provenance_mutation` to fake an
expired quote is therefore measuring a state the product can never reach, and it
hides whether the guard would fire in production. `scripts/state-recheck.test.ts`
builds cases with short validity windows and shifts the process clock past them,
so an expired qualification, an expired quote, a passed delivery date, a lapsed
quality plan, and an expired purchase authorization all arise the way they arise
in production. Future state or freshness tests should follow this and keep
provenance mutation for asserting that the database refuses tampering.
## Chat threads live in CompanyContext rows, not a new table

Date: 2026-08-31

Multi-chat support for the context workspace stores each thread as a
`CompanyContext` row with kind `CHAT_THREAD` and stamps `threadId` into message
payloads. Messages without a `threadId` are the General thread, so every
pre-existing conversation keeps working. This avoids a production schema
migration, inherits the existing `officeId` and customer-visibility scoping,
and keeps documents shared across all threads by design: threads scope the
conversation, the company artifacts are project-level.

## A procurement draft may supersede only a pending action

Date: 2026-08-31

The intake agent sees a summary of open procurement requests and must ask
before creating a look-alike. A draft can carry `supersedesActionId`, which is
honored only when it names an action that is still awaiting confirmation; the
pending action is dismissed and the replacement takes its place. Actions that
are already CREATED represent running work with side effects, so they are
never replaced automatically; the agent must ask whether a genuinely new
request is wanted.

## An unsent supplier draft is a PLANNED execution task

Date: 2026-08-25

The Supply OS execution trigger requires every task to be inserted as `PLANNED`
and refuses `READY`, `RUNNING`, or `SUCCEEDED` on an approval requiring task
without a matching approved `SupplyApproval` row. A saved supplier draft is
neither approved nor executing, so it stays `PLANNED` with `requiresApproval`
set, and the explicit confirmed send path owns the approval and the delivery.
Redrafting cancels the previous live draft and writes a new versioned task key,
because task input and its hash are immutable provenance.

## Reconciliation never depends on reading attachment bytes

Date: 2026-08-25

A supplier reply send claims a delivery task before calling Gmail, and a claim
that is still `RUNNING` must be reconciled against the provider before anything
else. Attachment identity for the message hash comes from the request documents
alone, so the claim and reconciliation need no storage read, and file bytes are
loaded and screened only once the claim proves this is a fresh send. Otherwise a
transient storage failure could leave a message that Gmail may already have
delivered permanently unresolved.

The claim marks the attempt `RUNNING`, so a load or screening failure on the
fresh send path is recorded as a non delivery before the error surfaces. `RUNNING`
therefore keeps its meaning of "handed to Gmail", and a file problem stays
retryable.

## Supplier bound attachments come only from trusted request documents

Date: 2026-08-25

Supplier replies asked for the technical package, so outbound mail needed
attachments. Letting an operator or an agent name a file path or a URL would turn
supplier mail into an exfiltration channel for anything the server can read, so
the only admissible source is a `CompanyContext` document row that the sourcing
request already cites as `document:<id>`, loaded with both `officeId` and
`companyId` in the query. Selected ids are revalidated against those citations on
the send path as well, because a stored draft is not a permission.

Every candidate file is screened before it can be attached: allow listed type,
extension and stored type agreement, magic byte or STL structure check, size
limits, sensitive file names, and content that looks like a private key, an AWS
key id, an API token, a mailbox app password, or SMTP settings. A refused file is
withheld with a reason instead of failing the whole draft, so the operator can
see what was held back and why.

Drafting and delivery stay separate by construction. The draft module persists a
`SupplyExecutionTask` with `requiresApproval` and imports no provider, so no code
path can turn a draft into a send; delivery still requires `confirmed: true` from
a human.

## API clients authenticate through the existing session cookie

Date: 2026-08-25

- Decision: Expose `POST /api/auth/session` as the machine-usable credential
  entry point. It resolves usernames with the existing login-code helper and
  delegates credential validation and cookie issuance to `loginWithCredentials`.
- Security boundary: Validate a strict bounded JSON body, never echo
  credentials, send no-store and nosniff headers, and apply a bounded
  per-instance failed-login throttle keyed by both identifier plus client IP
  and identifier alone. The identifier-only key bounds account brute force when
  clients rotate `x-forwarded-for`. This throttle is best effort on serverless
  runtimes, not a replacement for distributed abuse protection.
- Session boundary: The API returns only office, role, whole-office access,
  and the existing cookie max-age. `DELETE` delegates to the existing logout
  behavior so both operator and customer session cookies are cleared.

## Uploaded context files carry deterministic derived facts

Date: 2026-08-25

Storing raw extracted text is not enough for sourcing. A drafting model reading
a 34 line bill of materials or a binary mesh silently drops the details that
decide whether a supplier can build the part, and the resulting supplier request
looks complete while omitting the smallest passive package, the fine pitch
packages, and the real part footprint. Extraction therefore computes those facts
deterministically at ingest and writes them into the stored markdown as plain
sentences, ahead of the raw rows. Derived values are labelled as derived, and
units that a file does not declare, such as STL units, stay stated as an
assumption rather than a fact. A derived tool envelope is explicitly a starting
point for tooling, not a customer requirement.

The extraction version is the migration boundary. Bumping
`CONTEXT_DOCUMENT_PROCESSING_VERSION` marks earlier markdown as stale, and an
office-scoped, dry-run-by-default script re-ingests only stale rows from the
retained source file. Nothing rewrites a procurement order that was already
submitted, because the workflow database owns those rows and Derya holds a read
only role on them. Corrections reach suppliers through a new draft built from
current company context, never by silently editing history.

## Research output stays in office-scoped flexible lists

Date: 2026-08-25

Harvested research varies by customer office and by investigation, so it should not be forced into the canonical Company and Contact models. Research lists provide an office-scoped, user-defined table with ordered fields, bounded typed values, provenance-ready source references, deduplication, CSV import, and agent ingestion. The office boundary is enforced from the authenticated session on every query and write. Records include an intentionally unindexed, lowercased `searchText` column capped at 4,000 characters. Search is a scan narrowed to one list by the existing office and list indexes. If list search becomes slow, a `pg_trgm` GIN index is the upgrade path, but enabling the extension is intentionally deferred because it may require production database privileges. Record statuses are limited to `new`, `reviewed`, and `rejected`.

This surface is intentionally read-only with respect to outreach. Rows are for review and export only. They do not create canonical CRM identities, approval records, queue items, email drafts, or outbound messages. Promotion into operational CRM and outreach remains a separate, explicit workflow.

## Tenant-owned tables require explicit application-role grants

Date: 2026-08-25

Production's `derya_app` role does not inherit privileges on new tables. Every new tenant-owned table must therefore ship a conditional `derya_app` grant and a paired production verification script. Apply those migrations only through the protected production migration workflow.

Use this log for durable product and engineering decisions. Do not put every implementation detail here. If future agents should treat something as settled context, it belongs here.

## Decision Template

### YYYY-MM-DD - Decision title

- Status: proposed | accepted | rejected | superseded
- Owner:
- Context:
- Decision:
- Rationale:
- Consequences:
- Revisit when:

## Log

### 2026-08-24 - Derya protects new supplier inquiry sends with an office sender pool

- Status: accepted, extends the 2026-08-22 Derya email ownership decision
- Owner: product and engineering
- Context: A flat enabled-sender list gives operators no daily usage signal and
  lets campaign workers repeatedly choose one mailbox. Row-level default,
  sync, pause, and sender buttons also turn a simple pool policy into 80 or more
  controls when an Office connects 20 mailboxes.
- Decision: Every active connected Gmail sender has a configurable daily pooled
  send limit from 1 through 30, with 30 as the default and hard maximum. New
  supplier inquiry forms order eligible mailboxes by utilization, including
  in-flight reservations, then raw usage, then a stable email and ID tie-break.
  The operator may override the suggested sender before approval. Delivery
  reserves the exact approved mailbox and refuses the send when that mailbox is
  full. Derya never changes the sender after approval.
- Concurrency boundary: Office-scoped advisory locking serializes allocation.
  A tenant-bound idempotency key is also bound to a SHA-256 hash of the exact
  sender, recipient, subject, and body. A changed request cannot reuse an old
  delivery result. Definite rejection releases capacity. An uncertain delivery
  remains reserved until reconciliation or a human-confirmed non-delivery.
- Conversation boundary: Automatic allocation applies only to new pooled
  outbound messages. Replies remain on the mailbox and thread that received the
  conversation. Reply messages count in the usage shown for that mailbox, but
  the pool limit does not suppress a necessary thread-bound reply.
- UI boundary: Connected emails shows one pool switch per active mailbox,
  multi-select bulk enable or disable, bulk limit updates, and today's sent
  count against the limit. Default sender, manual sync, and pause are removed
  from each active row. Monitoring remains independent of pool participation.
- Campaign boundary: Bourne still owns recipient choice, content, scheduling,
  approval, and campaign progress. No browser-facing bulk-send endpoint or
  text-triggered campaign send is added.
- Consequences: New RFQ drafts naturally spread across the least-used connected
  accounts, while the send-time guard prevents any approved account from
  exceeding its configured allocation ceiling under concurrent workers.
  Existing approved messages keep their bound sender, and no mailbox credential
  leaves Derya.

### 2026-08-23 - Active Sourcing may send one confirmed reply per inbound message

- Status: accepted, supersedes the draft-only and no-send clauses in the
  2026-08-22 supplier replies and supplier quotes decision
- Owner: product and engineering
- Context: Operators can review an exact supplier thread and edit a grounded
  reply in Active Sourcing, but copying the reply into Gmail creates avoidable
  context switching and loses an immediate Derya delivery receipt.
- Decision: Active Sourcing may send one operator-confirmed reply to the latest
  inbound supplier message. The UI requires a separate confirmation click. The
  server binds the office, workspace, customer, order, vendor, source message,
  connected sender, recipient, subject, body, and message hash before calling
  Gmail. The browser cannot select a different sender or provider thread. The
  explicit confirmation is direct operator authorization, so the execution
  task records `requiresApproval = false`; it is not manager approval.
- Idempotency boundary: Each attempted send uses one distinct durable execution task,
  keyed to the exact inbound message and attempt. The RFC Message-ID is stable
  per attempt. A successful repeat returns the stored receipt. An uncertain
  attempt reconciles the same ID and blocks another send while unresolved. A
  provider-rejected attempt may retry identical content in a new task with a
  new attempt number and RFC Message-ID; changed content is rejected.
- Ledger boundary: Derya records the provider receipt in its office-scoped
  email and execution ledgers. Bourne retains exclusive write ownership of the
  append-only procurement communication ledger. This path does not write to
  Bourne, and Derya receives no Bourne mutation privilege.
- Commercial boundary: Sending a reply does not record a quote, select a
  supplier, accept terms, approve a purchase order, or authorize spend. Those
  remain separate facts and approvals.
- Consequences: A sent reply appears in the exact conversation, the prior
  inbound cannot produce another draft, and Gmail failures are visible without
  blind retries. Sending remains blocked until the exact Gmail thread exists in
  the Bourne ledger or Derya's office-scoped email records.
- Revisit when: Bourne exposes an authenticated, tenant-bound receipt endpoint
  that can append Derya sends without weakening its database role boundary.

### 2026-08-22 - Customer portal uses admin-managed passwords

- Status: accepted for password authentication and lockout; credential storage
  and retrieval clauses are superseded by the 2026-08-22 shared Supply OS decision
- Owner: product and engineering
- Context: Administrators need to create a customer account, hand the customer
  a known credential, and reset access without depending on email delivery.
- Decision: Customer portal accounts authenticate with an office-scoped email
  and password. Administrators set a password when adding access and
  may replace it later. The password is visible only in the unsaved form.
  Derya stores an scrypt hash, never recoverable plaintext. Existing accounts
  without a hash cannot sign in until an administrator sets a password.
- Session boundary: Every session carries the account password version. A
  password reset increments that version and invalidates every older session.
  Active company membership and workspace checks still run on every request.
- Abuse boundary: Five failed attempts lock the account for 15 minutes. A
  database-backed IP throttle also limits public attempts across app instances.
  A password reset clears the account lock. Login errors do not reveal whether
  an account exists.
- Consequences: Customer sign-in no longer sends or accepts email codes. The
  administrator can see when a password was last set, but cannot retrieve the
  saved password. Lost credentials require a reset.
- Revisit when: Self-service password reset or a managed identity provider is
  needed.

### 2026-08-22 - Gmail app passwords are an encrypted Derya connector

- Status: accepted
- Owner: product and engineering
- Context: Six demo Google Workspace mailboxes have Gmail app passwords but no
  mailbox-specific OAuth setup. They still need administrator-controlled
  sending and reply monitoring inside Derya.
- Decision: Add a fixed Gmail connector that verifies SMTP on port 587 with
  required STARTTLS and IMAP on port 993 with TLS before saving. Store the app
  password only as an AES-256-GCM encrypted secret under the Office account.
  Do not support administrator-supplied mail hosts. New accounts start with
  sending disabled and use the same default-sender and pause controls as OAuth
  accounts.
- Safety boundary: Credentials disclosed in chat are not copied into code,
  documentation, deployment configuration, seed data, or tests. They must be
  revoked and replaced before account setup. This connector does not authorize
  Bourne campaigns or remove human approval.
- Consequences: Administrators can add each demo mailbox from Email accounts,
  send a test to themselves, and sync a bounded seven-day IMAP window. Cron can
  sync both OAuth and app-password Gmail accounts.
- Revisit when: Google OAuth is available for these mailboxes or the product
  needs providers other than Gmail.

### 2026-08-22 - Supplier replies and supplier quotes are separate facts

- Status: accepted, with the draft-only and no-send clauses superseded by the
  2026-08-23 confirmed supplier reply decision
- Owner: product and engineering
- Context: Active Sourcing counted inbound Bourne ledger messages at the order
  level, but each manufacturer row inferred a response only from a structured
  quote. A real supplier reply could therefore appear in the exact transcript
  while the same row said `Not received`.
- Decision: A tenant-, order-, and vendor-bound inbound communication marks
  that manufacturer as responded. A structured quote remains a separate
  commercial fact and is never inferred from message text. At the initial
  PR #218 release, supplier reply drafts used the exact request and thread but
  were editable, ephemeral, and review-only.
- Rationale: Delivery, response, quote, approval, and purchase are distinct
  workflow events. Collapsing them creates false UI state and unsafe commercial
  implications.
- Consequences: Manufacturer rows identify the exact respondent and show the
  inbound count even when no quote exists. Sending was later added under the
  separate 2026-08-23 contract and does not change quote state.
- Revisit when: Reply receipt state or quote state needs a different commercial
  workflow boundary.

### 2026-08-22 - Derya owns email accounts and Bourne owns campaigns

- Status: accepted
- Owner: product and engineering
- Context: Operators need one administrator surface to authorize senders,
  monitor replies, and control which connected accounts may send. Bourne needs
  campaign orchestration without receiving raw Gmail credentials or bypassing
  human approval.
- Decision: Derya owns Gmail OAuth, encrypted tokens, account monitoring, the
  per-account sending switch, the Office default sender, actual delivery, and
  the local message ledger. Bourne owns recipient selection, campaign drafts,
  scheduling, approval state, retry, and campaign progress.
- Safety boundary: Enabling an account does not authorize a Bourne campaign. A
  future bridge must bind the Office, Derya account ID, exact approved message,
  recipient, and idempotency key through authenticated server-to-server calls.
  Text instructions may prepare drafts, but they may not directly trigger mass
  outbound email.
- Consequences: Administrators manage email accounts inside Derya. Gmail tokens
  stay in Derya. Existing active Gmail senders remain enabled during migration,
  while newly connected accounts require explicit enablement.
- Revisit when: Bourne has an authenticated, approval-bearing delivery contract
  with tenant binding and idempotent message execution.

### 2026-08-22 - Customer portal may start scoped supplier research from Context

- Status: accepted, supersedes only the customer-portal exclusion and
  operator-only research confirmation in the 2026-08-20 Context decisions
- Owner: product and engineering
- Context: Customers need to describe a procurement requirement in chat and
  confirm supplier research without receiving internal dashboard access.
- Decision: Keep external `CustomerPortalUser` identities separate from
  internal `User` accounts. A current, explicit `CustomerPortalMembership`
  grants access only to the matching office, company, and active
  `SupplyWorkspace`. Customer ADMIN and MEMBER roles may add customer-visible
  Context messages and files and confirm supplier research. VIEWER remains
  read-only. Every route rechecks the current membership.
- Visibility boundary: Existing and future internal Context rows default to
  hidden. Customer routes read only `customerVisible=true` rows. Customer
  writes and their Derya replies are marked customer-visible and retain the
  exact portal user as creator. Customer answers cannot retrieve or cite hidden
  operator files or messages.
- Approval boundary: Customer confirmation creates one idempotent supplier
  research request. It does not contact, select, negotiate with, purchase from,
  or pay a supplier. Supplier communication and spend remain operator-owned.
- Consequences: The existing passwordless portal login is the customer front
  door. No customer account enters the internal founder allowlist or dashboard
  role model. Portal chat is bounded to 20 messages per user per 15 minutes,
  internal preview cannot call customer Context routes, and customer UI hides
  workflow identifiers and configuration errors.
- Revisit when: Derya adds an explicit operator control for publishing selected
  internal Context rows to customers, or approves a customer supplier-contact
  policy.

### 2026-08-21 - Context uses a white work surface

- Status: accepted
- Owner: product and engineering
- Context: The Context conversation had already moved away from its old dark
  treatment, but its canvas still used the app background token. The requested
  product direction is a literal white conversation and file workspace.
- Decision: Context uses `#ffffff` for its conversation canvas, file surface,
  empty state, and upload overlay. Neutral hover, divider, provenance, status,
  and focus tokens remain unchanged.
- Consequences: Context is visually one white work surface while evidence,
  processing state, and human approval boundaries remain visible.
- Revisit when: A future app-wide visual system deliberately replaces the
  authenticated work-surface palette.

### 2026-08-21 - Procurement wake delivery is reconciled from durable orders

- Status: accepted
- Owner: product and engineering
- Context: Derya commits procurement orders before calling Bourne, but an HTTPS
  wake can time out, be rejected, or acknowledge receipt without advancing the
  order. A manual retry and Bourne's fifteen-minute schedule left ordinary
  connection failures visible as stuck work.
- Decision: The Bourne database remains authoritative and its `orders` rows are
  the durable queue. Derya may request immediate pickup through the authenticated
  webhook, but a protected five-minute reconciliation cron reclaims stale wake
  attempts for mapped customers while the order remains `new`. Atomic updates
  to the existing idempotency claim prevent duplicate concurrent wakes. Bourne
  must independently poll and lease eligible orders, so HTTP delivery is never
  the only recovery path.
- Failure boundary: Infrastructure failures remain retryable `new` work.
  `needs_attention` is reserved for missing, conflicting, or invalid business
  input that requires an operator decision.
- Consequences: No new Derya or workflow table is introduced. A webhook failure
  cannot lose an accepted request, duplicate cron invocations cannot fan out
  duplicate wakes, and an acknowledged but unprocessed order is requested again
  while it remains `new`.
- Revisit when: Bourne exposes a durable enqueue receipt or a managed queue
  replaces database polling and leasing.

### 2026-08-21 - Bourne communication ledger is the primary supplier transcript

- Status: accepted, supersedes the live-Gmail primary read in the earlier
  supplier-activity decision
- Owner: product and engineering
- Context: Bourne sends supplier messages and checks its inbox, but the Derya
  supplier activity view could read exact messages only when Bourne copied one
  Gmail receipt onto `order_vendors` and the same mailbox was separately
  connected to the Derya office. Bourne already owns the full provider lineage.
- Decision: Store confirmed outbound and observed inbound supplier messages in
  Bourne's append-only `procurement_communication_messages` table. Derya reads
  those customer, order, and vendor-scoped rows through `dashboard_api` before
  consulting the connected-Gmail compatibility path.
- Database boundary: The ledger references canonical `ProcurementOrder` and
  `OrderSupplier` rows, not their lowercase compatibility views. The owner
  migration grants `bourne_supply_chain` only `SELECT` and `INSERT`; it keeps
  schema and database creation and mutation of existing messages unavailable
  to both runtime roles. Existing table shape and constraints must match the
  contract before grants are applied. Production provisioning runs only from
  `main` through the pinned Bourne owner workflow and committed verification.
- Security boundary: The browser receives a server-derived opaque message ID,
  never the provider message ID. Database foreign keys bind the order to the
  customer and the vendor to the order. Derya rejects messages whose verified
  counterparty is absent from the sender, recipients, and CC addresses.
  Provider IDs and email identities must be normalized before the global
  idempotency key is accepted.
- Message contract: Bourne writes only confirmed sends and observed inbound
  messages, uses provider IDs for idempotency, preserves timestamps and plain
  text, and never stores OAuth credentials or raw provider responses.
- Consequences: Supplier conversations can appear in Derya without connecting
  Bourne's mailbox twice. Existing threads require an exact, customer-scoped
  backfill. Ambiguous supplier matches go to manual review.
- Revisit when: Bourne communication moves behind a versioned service API with
  equivalent tenant isolation, provenance, and read-only Derya access.

### 2026-08-21 - Customer and procurement context use one minimal canonical schema

- Status: accepted, supersedes the 2026-08-20 `CompanyDocument` storage model
- Owner: product and engineering
- Context: The live Neon database contained a second workflow customer table,
  item rows carrying free-form procurement preferences, supplier rows copied
  per order, and Context encoded as several synthetic document records. That
  made hard facts, soft guidance, and technical workflow state difficult to
  distinguish. It also left old CRM opportunity and margin-preference tables
  in the application schema even though no active runtime used them.
- Decision: `Company` remains the customer identity. `Item` stores hard catalog
  facts. `Supplier` stores one office-wide supplier identity, and
  `CompanySupplier` stores the status or notes specific to one company. The
  only customer-context table is `CompanyContext`: a null `itemId` is generic
  company context, while a populated `itemId` is item-specific. A document row
  holds its original storage reference, extracted Markdown, processing result,
  explanation, provenance, and creator. The same table also stores bounded
  Context messages and approval-gated action payloads by `kind`.
- Compatibility boundary: The external procurement worker keeps its UUID
  tenant key through `CompanyWorkflowAccount`. Canonical operational tables are
  `ProcurementOrder`, `OrderSupplier`, and `ProcurementRequestKey`. The old
  lowercase names remain restricted compatibility views so the worker does not
  need an unsafe coordinated cutover. Real orders, quotes, delivery dates,
  supplier contacts, and realized prices are preserved.
- Cleanup boundary: Useful `CompanyDocument` and `CrmOpportunity` rows are
  converted to `CompanyContext` before those tables are retired.
  The active minimum value from `MarginProfile` is moved to the structured
  `Office.pricingTargetMarginPct` field before the table is removed. Unused
  labels, tiers, and urgency variants are not carried forward. Existing item
  `procurement_preferences` are preserved as attributable Context notes before
  that column is removed. No preference JSON remains on the customer or item
  tables.
- Safety boundary: Every canonical row is tenant-scoped. Database triggers
  reject item, supplier, Context, order, supplier-order, or request-key links
  whose customer and office do not agree. The migration refuses to guess when
  a workflow customer cannot be mapped uniquely to a real `Company`.
- Worker boundary: Existing worker-specific columns on the renamed operational
  tables remain visible through the lowercase views. Existing worker-role data
  privileges are copied to those views, then removed from the canonical table
  names. Derya's application and dashboard roles are reset to their narrower
  explicit grants.
- Release boundary: The table renames and data conversions run in one
  transaction so workers never observe half-converted tables. That transaction
  requires the maintenance procedure in
  `docs/RUNBOOKS/MINIMAL_SCHEMA_CUTOVER.md`; Bourne and procurement writes stay
  paused until migration, count checks, app deployment, and smoke tests pass.
- Consequences: Hard delivery, address, item, supplier, order, and quote facts
  remain structured. Soft email style, document explanations, and procurement
  guidance live in one attributable context surface. Historical worker SQL
  continues to operate through bounded views and triggers.
- Revisit when: The procurement worker accepts the canonical Company id
  directly, or stored document volume justifies moving file bytes to managed
  object storage while retaining `CompanyContext` metadata.

### 2026-08-21 - Context procurement separates items and reports wake delivery truthfully

- Status: accepted
- Owner: product and engineering
- Context: One Context instruction could request multiple unrelated sourcing
  items, but the structured agent response permitted only one draft. The
  resulting order combined unrelated processes. Separately, the Bourne wake
  helper returned success after provider errors or timeouts, leaving saved
  orders in `new` while the UI implied that processing had started.
- Decision: Context returns one independently cited procurement confirmation
  per distinct item, part, material, or manufacturing process. All cards from
  one reply are saved atomically, and every card still requires separate human
  confirmation. A workflow wake is successful only when the configured HTTPS
  endpoint returns a successful response. A failed
  accepted retry returns an explicit service error while preserving the saved
  order for another bounded retry.
- Presentation boundary: The supplier worker retains the frozen request and
  company evidence envelopes, but Inventory renders the concise request
  specification instead of the compatibility copy used by the worker.
- Consequences: PCBA and foam requests cannot silently become one supplier
  search. Queued work shows Start sourcing, failed delivery is visible, and no
  retry creates another order. Existing combined orders are not rewritten.
- Revisit when: Bourne provides a durable queue acknowledgment and a first-class
  evidence field that removes the specification compatibility copy.

### 2026-08-21 - Supplier activity joins workflow receipts to connected Gmail

- Status: accepted
- Owner: product and engineering
- Context: New sourcing requests execute in the customer-scoped Neon workflow,
  while Derya still retains older supplier communication workstreams. Inventory
  showed neither the new workflow outreach counts nor the historical exact
  conversations, so operators had to inspect separate systems.
- Decision: Add a Messages view inside Inventory and sourcing. Current workflow
  requests expose only aggregate supplier, contacted, and response counts plus
  a boolean contact receipt per manufacturer. The browser never receives the
  workflow Gmail message ID. On a manufacturer click, the authenticated server
  resolves that opaque ID inside the mapped customer order, requires the saved
  supplier email to be a participant, and reads the exact thread only from an
  active Gmail account in the same Derya office. Historical Derya procurement
  cases read their existing office-scoped email threads.
- Approval boundary: This view is read-only. It does not send email, change a
  workflow status, approve a supplier, place an order, or convert an email into
  commercial truth. Existing Bourne and Derya approval gates remain in force.
- Failure boundary: Counts remain visible when the sending inbox is not
  connected, but the transcript states that it is unavailable. Derya never
  invents message text or infers contact from supplier discovery alone.
- Completeness boundary: The active view excludes completed and canceled work.
  It accepts any Neon campaign linked to the selected workspace. If older
  historical pages remain, the UI labels the totals as loaded history and lets
  the operator load the next page.
- Purchase boundary: A manufacturer is PO-ready only when the order is at the
  approval or ordered stage and the decision receipt names that exact supplier.
  A missing supplier selection is reported as missing instead of copying the
  order status to every manufacturer.
- Consequences: Operators can see reached-out, responded, situation, and PO
  readiness states from one page, then open the exact supplier thread when its
  provenance is available. The historical engine remains audit-only and is not
  reactivated for new sourcing work.
- Revisit when: The procurement workflow stores a first-class, customer-scoped
  communication ledger that can replace live Gmail lookup without exposing
  provider identifiers to the browser.

### 2026-08-21 - Context procurement requires confirmation and layered evidence

- Status: accepted
- Owner: product and engineering
- Context: Company Context already flowed into new custom procurement, but the
  conversation could not prepare or start a request. A broad company snapshot
  also did not identify which part, message, or files were the immediate reason
  for one procurement run.
- Decision: An explicit procurement instruction in Context may create a
  persistent confirmation proposal in the existing `CompanyDocument` table.
  It does not create an order. An authenticated operator must select Start
  procurement before the server submits the existing idempotent CUSTOM request
  and wakes the procurement workflow.
- Evidence order: The confirmed order freezes
  `request_context.procurement_context` from the exact operator request and
  directly cited files. It also freezes the whole eligible company snapshot in
  `request_context.company_context`. The request-specific snapshot and BOM
  specification come first; company Context is inherited background. Generated
  Derya replies are excluded from both evidence layers.
- Approval boundary: Confirmation creates supplier research only. It does not
  contact, select, negotiate with, or purchase from a supplier. Existing later
  review and approval controls remain authoritative.
- Consequences: Confirmation cards, dismissal, and the resulting order link
  survive reload without another table. Repeated confirmation uses the same
  action-derived idempotency key and cannot create a duplicate order. The
  existing record moves atomically from pending to creating before workflow
  submission, so a concurrent dismissal cannot race a confirmed creation.
- Revisit when: The procurement worker supports first-class immutable evidence
  references instead of the current request-context and BOM specification
  compatibility copy.
### 2026-08-20 - Authenticated customer workspaces never use synthetic fallbacks

- Status: accepted
- Owner: product and engineering
- Context: Atlas Robotics was compiled into the authenticated Supply OS as a
  presentation company, inventory set, sample network, sourcing defaults, and
  automatic procurement workspace. A failed or unresolved real workspace could
  therefore show plausible but false customer data.
- Decision: Authenticated company identity must resolve from a tenant-scoped
  Company and SupplyWorkspace. Operational inventory, demand, requirements,
  dates, and delivery locations must resolve from a published SupplySnapshot or
  another explicit tenant record. Missing data stays empty. Reads may fail
  closed, and writes must reject missing workspace context. Customer examples
  are permitted only in test fixtures that production code does not import.
- Consequences: The product cannot silently substitute a convincing customer
  when Neon, authorization, or snapshot loading fails. Demo URLs and query
  parameters, SKU matches, legacy campaign endpoints, and browser fixtures cannot
  bypass the database boundary. Supplier options require research evidence, and
  unknown quantities, units, dates, and locations remain unknown. Existing
  synthetic database rows are not deleted automatically because cleanup must be
  explicit and reviewed.
- Revisit when: A separately deployed sandbox environment is created with an
  isolated database and an unmistakable non-production hostname.

### 2026-08-20 - Custom procurement freezes the selected company Context

- Status: accepted
- Owner: product and engineering
- Context: Context documents and operator messages were durable, but custom
  supplier research received only the browser intake fields. The supplier
  worker could not see the saved company evidence.
- Decision: For a new CUSTOM procurement request with a workspace ID, the
  authenticated server resolves that accessible workspace and builds a
  deterministic, bounded snapshot from its parsed company documents and
  operator messages. Generated Derya replies are excluded. The snapshot is
  stored in `orders.request_context.company_context`, and a bounded evidence
  copy is appended to the BOM specification consumed by supplier research.
- Trust boundary: The snapshot is labeled untrusted source material. Document
  and message content is evidence, never agent instruction. Every read remains
  scoped by the authenticated `officeId`, user access, workspace, and company.
- Consequences: The worker and later reads of that procurement order share the
  exact same Context version without a new table. Later Context edits do not
  silently mutate an active request. A new request captures a new version.
  Existing orders are not retroactively changed.
- Revisit when: Bourne exposes a versioned first-class evidence input that can
  replace the bounded BOM specification copy without weakening compatibility.

### 2026-08-20 - Context uses only CompanyDocument

- Status: accepted, supersedes the 2026-08-19 Context hierarchy, fact,
  source-link, outbound-draft, portal, and allowlist decisions
- Owner: product and engineering
- Context: The six-table Context schema recreated preferences, facts, scopes,
  sources, and drafts that the product does not need. Production uploads also
  failed before parsing because the default storage driver tried to write to a
  local Vercel filesystem.
- Decision: Context is one internal company conversation backed only by the
  existing `CompanyDocument` table. Original uploads, their one-time parsed
  Markdown, operator messages, and agent replies are all file records scoped by
  `officeId` and `companyId`. Remove all six `SupplyContext*` tables and the
  `context_node` memory type. Do not provide a customer portal Context page,
  hierarchy, fact database, preferences, source linker, or outbound draft
  workflow.
- Retrieval boundary: The server resolves the selected `SupplyWorkspace` to its
  company and reads only that company's parsed Markdown and conversation. File
  contents remain untrusted. Agent replies cite eligible files and messages and
  cannot perform external actions.
- Storage boundary: V1 stores original bytes and parsed Markdown as data URLs in
  `CompanyDocument`. Each file is limited to 10 MB and parsed once. Browser
  uploads larger than 3 MB use temporary rows in the same table so every
  request remains below the hosting limit. Completed and expired chunks are
  removed. Unsupported content stays downloadable with an explicit processing
  state.
- Consequences: Context has no dedicated tables and no deployment dependency on
  local disk or object-storage configuration. The database cost is base64
  overhead, which is an intentional tradeoff for the requested one-table model.
- Revisit when: Stored Context files are large enough to justify moving the URL
  payload to managed object storage without adding another Context table.

### 2026-08-20 - Retire the production pentest tenant

- Status: accepted, supersedes the 2026-07-01 pentest self-repair decision
- Owner: engineering
- Context: Production now has one commissioned Dreamz login and one
  HypnoDreamz workspace on unified Neon. The five-minute pentest cron was
  recreating a second Office, user, company, and synthetic fixture data.
- Decision: Remove the pentest seed from Vercel cron scheduling. Keep the
  explicit local seed command for deliberate isolated testing, but never run it
  automatically against production.
- Consequences: Production contains only the commissioned application tenant.
  A future sandbox must use an isolated database or an explicit temporary setup.

### 2026-08-20 - Application builds never run database DDL

- Status: accepted
- Owner: engineering
- Context: Production uses a restricted application database role by design.
  Running `prisma migrate deploy` inside a Vercel build made routine code
  deployments depend on DDL privileges and blocked a navigation hotfix.
- Decision: `npm run build` only generates the Prisma client and builds the
  application. Schema changes use the explicit `npm run deploy:migrations`
  release step with the controlled owner connection, or the protected
  production migration workflow through `workflow_dispatch` or
  `repository_dispatch`, before application rollout.
- Consequences: The runtime role stays least-privileged and ordinary code
  releases cannot mutate schema. Migration-bearing releases must prove the
  owner-run migration separately before production deployment. CI also requires
  the explicit `derya_app` table allowlist to match every Prisma model.
- Revisit when: Deployment infrastructure supports a dedicated, audited
  pre-deploy migration job with a separate credential.

### 2026-08-19 - Context evidence and delivery recovery fail closed

- Status: accepted
- Owner: product and engineering
- Context: The merged Context chat persisted generated replies as ordinary
  citable messages and could strand uncertain Gmail sends without a safe retry
  path.
- Decision: Generated replies remain conversation history but never evidence.
  A grounded reply requires at least one server-approved citation. Supplier
  messages use a stable RFC message ID and reconcile uncertain outcomes before
  retry. Missing delivery returns to human review.
- Rollout: Context is available only to an explicitly allowlisted office or an
  office already commissioned in the server-only procurement customer map.
- Consequences: Generated claims cannot become self-reinforcing evidence,
  invalid customer inputs remain recoverable, and ambiguous supplier delivery
  cannot silently duplicate an email.
- Revisit when: A provider supplies a stronger transactional delivery receipt
  or Context moves to a dedicated reviewed evidence workflow.
### 2026-08-20 - Company directory Delete is archival

- Status: accepted
- Owner: product and engineering
- Context: The released Supply OS company directory mixed fake demo companies
  with durable customer records and exposed no row management controls.
- Decision: Show only durable company workspaces in the directory. Admin rows
  use a three-dot menu with Edit and Delete. Delete archives every active
  workspace for the company, marks the CRM stage archived, and revokes portal
  memberships. It never deletes the Company or SupplyWorkspace record.
- Consequences: Archived companies disappear from the dashboard but retain
  their operational history and keep their name and website reserved. Physical
  deletion and restoration require direct database administration.
- Revisit when: A separate archived-company administration surface is designed
  with explicit restoration permissions and audit history.

### 2026-08-19 - Supply OS Context replaces browser-local Automations

- Status: accepted
- Owner: product and engineering
- Context: Automations stored browser-local workflow drafts and exposed a
  workflow editor. The required product is durable company context assembled
  from operator messages and uploaded evidence for a grounded agent.
- Decision: Context uses the canonical tenant-scoped `SupplyWorkspace` and a
  company, product, part, and request hierarchy. The primary operator interface
  is one conversation with one composer and one file rail. Hierarchy controls,
  proposed facts, source linking, and outbound draft records remain server-owned
  internals rather than competing panels on this screen.
- Evidence boundary: Selected-node ancestors are included and sibling scopes
  are excluded unless explicitly linked. Extracted content is untrusted.
  Confirmed facts control, conflicts block definitive output, and material
  claims carry citations.
- Visibility boundary: Customer reads expose only shared records and published
  replies. Supplier conversations, economics, internal notes, raw extraction,
  and drafts remain internal. External email still requires manager or admin
  approval before the idempotent send path can claim it.
- Rollout: Production is gated by `SUPPLY_CONTEXT_OFFICE_ALLOWLIST`. Apply the
  additive migration before enabling one pilot office.
- Revisit when: The pilot proves a concrete need for visible hierarchy editing,
  OCR, or another reviewed outbound channel.

### 2026-08-18 - Neon is the sole execution path for customer sourcing

- Status: accepted
- Owner: product and engineering
- Context: GUILD2 created Neon orders for the external workflow, while custom
  Dreamz requests started a separate OpenAI worker in Derya's primary database.
  Identical customer actions therefore produced different queues, progress
  screens, failure modes, and supplier records.
- Decision: Keep Derya's structured request intake, but send every complete
  custom, inventory, and GUILD2 sourcing request through the authenticated
  Neon procurement API. Mark custom orders with source campaign `CUSTOM`.
  Disable the legacy supplier-research POST, campaign POST, and cron. Preserve
  authenticated GET only for historical audit.
- Authorization boundary: The authenticated Office mapping selects the Neon
  customer. Workspace and company metadata only group the interface and are
  never accepted as authorization inputs.
- Consequences: All new sourcing work uses one idempotency model, one wake and
  schedule recovery path, one status screen, and one supplier table. Derya does
  not run supplier research, change workflow status, or send supplier email.
- Revisit when: Historical `SupplyCapabilityRun` data has been migrated or can
  be deleted under an explicit retention decision.

### 2026-08-18 - OpenAI web-search sources may enter independent validation without inline JSON citations

- Status: accepted
- Owner: product and engineering
- Context: Strict JSON output from the Responses API can include the bounded
  `web_search_call.action.sources` list without attaching URL citation ranges
  to the JSON text. Requiring both representations discarded provider-returned
  supplier URLs before any page was retrieved.
- Decision: Treat URLs in the native web-search source list as discovery
  provenance. A proposed supplier URL must still be present in that list, pass
  the supplier-source allow rules, and survive the existing pinned DNS, bounded
  page retrieval, exact evidence, and supplier identity validation pipeline.
- Rationale: Inline citation annotations are useful audit metadata, but they do
  not add trust after the server independently retrieves and validates the exact
  provider-returned page.
- Consequences: Structured supplier research can continue when JSON has no
  inline citation annotations. Model-proposed URLs outside the provider source
  set remain rejected and are never fetched.
- Revisit when: The provider guarantees citation ranges for strict JSON output
  or supplier discovery moves to a dedicated search provider.

### 2026-08-18 - Queued customer sourcing may issue one durable recovery wake

- Status: accepted
- Owner: product and engineering
- Context: An order can commit successfully and remain `new` when the immediate
  webhook is lost, rejected, or accepted without a worker claim. Recreating the
  order is unsafe, while a read endpoint must not gain side effects.
- Decision: Reposting the same authenticated procurement request may issue one
  recovery wake only when the original order is still `new` and its idempotency
  row has not been touched for 30 seconds. The transaction updates that row
  before the post-commit wake, so concurrent retries collapse to one attempt.
- Rationale: Recovery must reuse the original order without giving browser code
  access to customer identity or workflow-controlled fields.
- Consequences: The customer workspace can recover a missed start without a new
  order or a new database table. The external worker must still be active and
  must claim work atomically.
- Revisit when: Wake delivery has a dedicated outbox with attempt state and
  backoff, or the workflow platform provides a durable queue acknowledgement.

### 2026-08-18 - Bourne orders use the guided Supply OS sourcing workspace

- Status: accepted
- Owner: product and engineering
- Context: GUILD2 row actions exposed workflow status and supplier results in
  an inline queue panel. That made a durable procurement workflow look like a
  database status viewer and hid the existing Request, Research, Compare, and
  Procure product flow.
- Decision: Opening or creating a GUILD2 procurement order replaces the queue
  with a guided workspace. Derya renders live Neon state, a visible research
  progress sequence, and the existing supplier comparison table. Bourne stays
  responsible for research, workflow state, quotes, and approvals.
- Approval boundary: The supplier table is read-only. Shortlist and final
  approval remain in Bourne Inbox. The browser cannot submit workflow state,
  supplier research, quotes, lease data, or approval decisions.
- Consequences: Active orders poll the customer-scoped detail endpoint every
  seven seconds. Supplier contact snapshots may be displayed, but Gmail IDs
  and internal workflow fields remain excluded. The generic procurement page
  is not the primary GUILD2 experience.
- Revisit when: Derya intentionally becomes the approval system of record or
  Bourne exposes a supported embedded Inbox surface.

### 2026-08-18 - Product application uses app.derya.ai

- Status: accepted
- Owner: product and engineering
- Context: The apex `derya.ai` domain now serves the public landing page.
  Product routes on that host therefore return the landing site instead of the
  authenticated Freight OS.
- Decision: Use `https://app.derya.ai` as the canonical production origin for
  the Derya application. Keep the apex and `www` hosts dedicated to the landing
  page.
- Consequences: Vercel production sets `NEXT_PUBLIC_APP_URL` to the product
  origin. Product links and new Google OAuth callback registrations use the app
  subdomain.
- Revisit when: The landing page and product are intentionally served by one
  routing layer that can safely split paths between them.

### 2026-08-18 - Customer sourcing states hide workflow implementation details

- Status: accepted
- Owner: product and engineering
- Context: Workflow progress can contain internal service names, run failures,
  email-provider details, and operator approval instructions. Rendering that
  text directly makes the customer surface confusing and leaks implementation
  details.
- Decision: Customer sourcing pages derive bounded status and progress copy
  from the order status and supplier count. They do not render the raw workflow
  progress field. Internal service, database, email-provider, and approval-tool
  names stay out of customer-visible copy.
- Consequences: Request, Research, Compare, and Procure remain the customer
  lifecycle. The Compare step shows supplier, contact, evidence, quote, and
  source data. Internal operators retain their separate approval workflow.
- Revisit when: Customers receive an explicit approval role with a reviewed,
  customer-scoped action contract.

### 2026-08-17 - GUILD2 uses the authenticated procurement API

- Status: accepted
- Owner: product and engineering
- Context: The GUILD2 screen briefly had a second workflow bridge that created
  runtime `derya` tables and called a separate trigger. That bypassed the
  reviewed customer-scoped order contract and duplicated credentials.
- Decision: Every row-level Source action uses
  `/api/procurement/requests`. The fixed plan must classify all 40 lines before
  bulk sourcing is enabled. It skips GUILD-027, treats GUILD-039 as
  documentation, and creates only the 38 supplier-searchable orders with a
  concurrency limit of three.
- Idempotency and trigger boundary: Each line uses a deterministic versioned
  key scoped by the authenticated Neon customer. Only a newly committed order
  receives one bounded webhook attempt. A duplicate returns the existing order
  and does not wake Bourne again. The schedule remains recovery.
- Read boundary: Active orders poll the customer-scoped detail endpoint every
  seven seconds. Approval states are read-only and direct operators to Bourne
  Inbox.
- Consequences: Runtime schema creation and `WORKFLOW_AGENT_TRIGGER_*` are
  removed. The only workflow database credential is the `dashboard_api` URL,
  and the optional wake credentials are `BOURNE_WORKFLOW_WEBHOOK_URL` plus the
  server-only `BOURNE_WORKFLOW_WEBHOOK_SECRET` bearer credential.
- Revisit when: A server-side bulk endpoint can provide a stronger atomic batch
  receipt without weakening per-order idempotency or tenant isolation.

### 2026-08-16 - GUILD2 sourcing uses the workflow database and an explicit trigger

- Status: superseded by the 2026-08-17 authenticated procurement API decision
- Owner: product and engineering
- Context: The GUILD sourcing screen previously read and ran its fixed campaign
  through the primary Derya database. The replacement workflow owns a separate
  Neon database and runs outside this repository.
- Decision: Store GUILD2 and its copied 40-line material list in tenant-scoped
  `derya` tables in the workflow database. A dashboard run creates a durable
  sourcing-run record there, then calls the configured web-agent trigger. The
  primary Derya database remains responsible only for the current login session
  until authentication is migrated separately.
- Failure boundary: A missing or failed trigger is visible and cannot be shown
  as a running workflow. Only one active GUILD2 run is allowed per office.
- Consequences: The external workflow can read materials and update the exact
  run using the supplied run ID. Its trigger URL and optional bearer token stay
  in deployment environment variables.
- Revisit when: Authentication also moves to the workflow database or the
  external platform provides a first-class queue integration.


### 2026-08-12 - Supplier research uses persisted jobs, not an HTTP request lifetime

- Status: accepted
- Owner: product and engineering
- Context: Supplier discovery and evidence validation can take longer than one
  serverless request. The blocking route could be terminated while the browser
  kept showing `Public web research is running` with zero sources. An in-memory
  promise was not a durable job, and a longer timeout would only make the same
  failure slower.
- Decision: Use existing `SupplyCapabilityRun` records as the durable queue. A
  POST validates, rate-limits, enqueues or reuses an identical active run, and
  returns HTTP 202 with an exact polling URL. A scoped GET reads that run.
  Next.js `after()` may start it immediately, but the authenticated cron is the
  recovery mechanism and claims no more than two queued runs per invocation.
- Concurrency boundary: A conditional database update atomically claims QUEUED
  work. Only one worker can change it to RUNNING. Terminal records are not
  claimed again. Recovery expires stale RUNNING work only and does not fail
  ordinary QUEUED work. Campaign reconciliation uses an expiring token stored
  on the RUNNING parent. Aggregate writes, child enqueue, lease release, and
  terminalization verify that token while holding the parent row lock. Aggregate
  revisions use an attempt watermark shared across retry generations, so stale
  work cannot replace newer evidence and current validation may remove a lead
  that no longer passes.
- Campaign boundary: The GUILD campaign is a persisted parent run with durable
  child attempts and aggregate result runs. Each invocation queues at most six
  attempts. Retry backoff, three query profiles across as many as three
  exploration cycles, a 48-attempt campaign daily cap, and a 72-attempt office
  daily cap keep public discovery bounded and resumable across cron invocations.
  Campaign enqueue and provider claim share one office-stable advisory lock and
  derive the quota day from the database clock after acquiring it, including
  across the UTC date boundary.
  All campaign records follow the database run-state guard. A retry creates a
  linked immutable generation and reuses validated predecessor history. Child
  calls are pinned to Exa forced-live validation; missing or invalid provider
  configuration blocks visibly instead of changing evidence semantics. Manual
  retry generations stop at twelve, before the bounded ancestry reader can be
  exhausted; further retry requires an operator-reviewed campaign scope.
- Completion boundary: Search 38 lines. GUILD-027 remains
  `CLARIFICATION_REQUIRED`; GUILD-039 remains `REQUIREMENT_ONLY`. A searchable
  line completes with three to five distinct supplier identities and domains
  whose retained `REVIEW_REQUIRED` candidates have attributable public identity
  and capability evidence in the aggregate run.
- Approval boundary: Campaign completion is sourcing research, not supplier
  qualification, a quote, an award, an order, or permission to contact anyone.
  Any blocked or operator-review outcome remains visible instead of being
  converted into empty success.
- Consequences: Research survives navigation, request termination, and
  redeployment. The UI can stop active polling without cancelling work and can
  later restore the exact saved run. Operations must configure the cron and
  provider credentials, monitor queue age, and run authenticated deployment
  acceptance before release.
- Revisit when: A managed external queue replaces database claiming, provider
  throughput supports different concurrency or daily limits, or campaign scope
  expands beyond the fixed GUILD request.

### 2026-08-12 - Exa discovery survives content timeout without commercial claims

- Status: accepted
- Owner: product and engineering
- Context: Exa Search could return attributable supplier URLs before the
  forced-live Contents request timed out. The all-or-nothing integration then
  discarded those URLs, persisted a failed run, and showed the operator zero
  sources even though discovery had succeeded.
- Decision: Bound forced-live content validation to the first three ranked
  search results. If that validation request times out, complete the research
  run as degraded and retain all public Search URLs as source-domain candidates.
- Evidence boundary: Search-only candidates have no trusted role, product
  capability, price, currency, unit, MOQ, lead time, or managed retrieval
  receipt. They cannot create a public price observation or pass supplier
  qualification without later evidence.
- Failure boundary: A Search timeout still fails the run because there is no
  attributable source to retain. Invalid, oversized, and non-timeout provider
  failures continue to fail closed. Derya does not switch providers silently.
- Consequences: Operators can inspect and retry discovered sources instead of
  receiving a false zero-source screen. A partial provider failure loses claim
  validation, not already obtained source provenance.
- Revisit when: content validation moves to a separately persisted background
  worker with per-source retries and progress events.

### 2026-08-12 - Exa forced-live retrieval may create public listing receipts

- Status: accepted
- Owner: product and engineering
- Context: OpenAI web search can discover attributable supplier pages, but its
  generated fields and dates cannot prove that one exact listing currently
  binds an item, amount, currency, and unit. Fetching arbitrary result URLs from
  the application origin would create an SSRF and payload-control problem.
- Decision: When `EXA_API_KEY` is configured, supplier research uses Exa Search
  followed by Exa Contents with `maxAgeHours: 0`. The application contacts only
  fixed `api.exa.ai` endpoints, checks each URL status, bounds response bytes and
  total time, and records a server-owned `retrievedAt`. A deterministic
  validator emits a receipt only when one successful forced-live record contains
  the requested identity, positive amount, explicit ISO 4217 currency, explicit unit
  or package basis, and exact source excerpt.
- Supplier identity: Public results use the source domain as the durable
  candidate name and carry no trusted supplier role. Generated seller names or
  roles remain proposals and cannot imply authorization.
- Persistence: Valid receipts create independently addressable managed-retrieval
  evidence and append-only `PUBLIC_LIST_PRICE` observations. Search or summary
  claims without a receipt remain freshness-unknown and create no observation.
- Procurement boundary: A public listing receipt is not a supplier quote,
  allocation promise, lead-time commitment, approval, or orderable term. Public
  candidate selection remains server-downgraded to unknown commercial terms and
  routes through qualification and RFQ confirmation.
- Fallback: OpenAI web discovery remains available only when Exa is not
  configured. Exa does not silently switch providers. Search failures and
  invalid, oversized, or non-timeout provider failures fail the run. A Contents
  timeout after successful Search retains only unvalidated source URLs and no
  commercial claims.
- Revisit when: Exa coverage proves inadequate on JavaScript-heavy public
  listings and a separately sandboxed Cloudflare Browser Rendering fallback is
  ready for the same validator.

### 2026-08-12 - Supply intelligence schema lands before its runtime

- Status: accepted
- Owner: product and engineering
- Context: The supplier profile, customer fact, benchmark, and price history
  runtime cannot safely deploy while production lacks its four additive tables.
- Decision: Ship the additive schema and migration separately from feature
  runtime. The rollout migration is transactional, uses bounded lock and
  statement timeouts, and retains tenant-scope and append-only guards. Vercel
  runs `prisma migrate deploy` and `prisma migrate status` only for production,
  before the normal application build.
- Rationale: Schema-first rollout removes the missing-table failure window and
  keeps preview builds from mutating the production database.
- Consequences: Feature runtime remains blocked until production reports the
  migration applied. The temporary Vercel migration hook must be removed in a
  follow-up immediately after the successful production deployment.
- Revisit when: Production migration orchestration moves out of the Vercel
  build into a dedicated, observable release stage.

### 2026-08-11 - Public integrations page documents the connector contract

- Status: accepted
- Owner: product and engineering
- Context: Clients need one URL they can send to technical teams, while the
  authenticated product needs one durable place to configure and monitor each
  company connection.
- Decision: Publish `/integrations` as a public technical handoff page and keep
  connection setup under `/dashboard/settings/integrations`. Put Settings in
  the separated lower rail instead of adding a seventh operating domain. The
  public page documents the current read-only pull contract and its approval
  boundaries. It does not present itself as a public Derya write API.
- Rationale: A stable client URL shortens integration discovery without mixing
  client documentation into the operator workflow or overstating unfinished
  writeback capabilities.
- Consequences: Client teams can review data, authentication, pagination, and
  setup requirements without an account. Only authenticated admins can change
  connector state. Deployment is required before the public URL exists.
- Revisit when: Derya exposes a versioned public ingestion or writeback API that
  needs separate OpenAPI documentation, keys, lifecycle policy, and support
  ownership.
### 2026-08-11 - Supply intelligence accumulates as profiles, facts, and price observations

- Status: accepted
- Owner: product and engineering
- Context: Supplier research runs preserved their own outputs but did not build
  a reusable supplier universe. Snapshot supplier terms were immutable ERP
  inputs, so they could not safely represent changing catalog prices, received
  quotes, or commodity benchmarks. The active sourcing route also defaulted to
  one office-wide Atlas workspace, which could mix customer research.
- Decision: Scope sourcing to the selected shared `SupplyWorkspace`. Keep
  `Company` as canonical customer and qualified-company truth. Build the
  customer supply profile as a projection over Company, published snapshots,
  and append-only `SupplyProfileFact` observations. Merge researched suppliers
  into workspace-scoped `SupplySupplierProfile` identities while retaining each
  research run. Store public catalog prices, supplier quotes, internal buys, and
  benchmark values as append-only `SupplyPriceObservation` records. Describe
  commodity sources with `SupplyBenchmarkSeries`, including cadence and delay.
- Price evidence rule: Public research may retain a source-linked listing claim,
  but it does not create a durable current-price observation. That requires a
  server-owned retrieval receipt binding item identity, amount, currency, unit,
  source URL, and observation time. Missing verified prices route to the existing
  approved RFQ workflow.
- Consequences: Supplier and customer knowledge can expand without overwriting
  history. Current, historical, delayed, and monthly values can be labeled
  honestly. Real-time exchange data still requires an authorized connector and
  appropriate market-data rights; public web research is not a substitute.
- Revisit when: Supplier identity resolution needs cross-workspace sharing, or
  licensed exchange feeds require entitlement-aware distribution controls.
### 2026-08-17 - Map Derya Offices to Neon customers through server-only metadata

- Status: accepted
- Owner: product and engineering
- Context: The authenticated Derya user and Office live in the application
  database, while Bourne's procurement records live in a separate Neon
  database. The current Neon `customers` table has no external auth key.
- Decision: Keep Derya authentication on `DATABASE_URL`. Resolve the active
  Office from the authenticated session and map that Office ID to a Neon
  customer UUID through `PROCUREMENT_CUSTOMER_MAP_JSON`, which is server-only
  deployment metadata. Use a separate SSL-only `WORKFLOW_DATABASE_URL` whose
  username is exactly `dashboard_api`.
- Idempotency: Provision `procurement_api_idempotency` in the Bourne Neon
  database. Claim the Office-derived customer and idempotency key in the same
  transaction that inserts the order. Do not split the claim across the Derya
  and Neon databases.
- Approval boundary: The dashboard reads Bourne state and supplier results but
  cannot approve, change workflow state, update leases, or mutate supplier
  research and quotes. Approval remains in Bourne Inbox.
- Consequences: No Derya Prisma migration is needed for this MVP. Neon requires
  explicit role and idempotency provisioning before traffic is enabled. A
  future external tenant key can replace the environment mapping when the Neon
  contract supports it.

### 2026-08-11 - Connected quote PDFs are bounded evidence sources

- Status: accepted
- Owner: product and engineering
- Context: Suppliers commonly put delivery, validity, MOQ, and price only in a
  PDF quotation. Leaving those fields unknown is safe but forces buyers to
  transcribe the most important replies. Treating an arbitrary attachment or
  model summary as commercial truth would be worse.
- Decision: Upgrade `extract.supplier_quote_terms` to version 2. It may retrieve
  text PDFs only from the exact office-scoped Gmail message and attachment IDs
  stored on the connected message record. Limit processing to
  three PDFs, 8 MB per PDF, 25 pages per PDF, and 30,000 combined text
  characters. Stream provider responses under an encoded-size ceiling and parse
  each PDF in a time- and memory-limited worker. Do not accept public URLs,
  client-provided attachment IDs, or arbitrary uploads through this capability.
- Evidence rule: Every proposed non-null field must name one email or attachment
  source and carry an exact excerpt found wholly inside that source. The server
  rejects missing, mislabeled, stitched, or semantically wrong citations. Store
  the attachment source label and extracted-text hash with proposal evidence,
  not the full attachment text.
- Failure rule: Network and provider retrieval failures remain failed immutable
  attempts that can be retried. Unsupported, oversized, scanned, encrypted,
  malformed, or truncated files produce deterministic warnings. OCR remains out
  of scope and is never implied.
- Compatibility: Version 1 proposals remain queryable. Version 2 creates a new
  capability scope so an attachment-only version 1 result can be re-extracted
  without mutating history.
- Review boundary: PDF extraction still only prefills the operator review form.
  It cannot record commercial terms, advance gates, approve a supplier, contact
  anyone, issue an order, spend, or open Logistics.
- Consequences: Buyers can resume evidence-backed quote review without manually
  copying ordinary text PDFs, while attachment failures and unknowns remain
  explicit.

### 2026-08-11 - Supplier quote extraction is a review proposal

- Status: accepted
- Owner: product and engineering
- Context: Connected supplier replies are durable evidence, but manually
  transcribing every price, MOQ, unit, delivery date, quote reference, and
  validity date is slow and error-prone. Treating model output as a commercial
  fact would create a worse failure: unsupported terms could enter procurement
  approval.
- Decision: Add `extract.supplier_quote_terms@1` as an analysis capability for
  one connected reply. It may propose only explicitly cited plain-text terms.
  Every non-null field must carry an exact excerpt that the server verifies
  against the supplier subject or body. Unsupported values remain unknown and
  unit or need-by conflicts remain visible.
- Persistence: Store each invocation as an immutable capability run and each
  successful proposal as model-derived evidence linked to the original
  connected-provider evidence. A failed attempt remains terminal; retry creates
  a new linked attempt. A completed scope is reused idempotently.
- Review boundary: Extraction never records a supplier quote response, advances
  the commercial gate, selects a supplier, requests approval, contacts a
  supplier, or commits spend. The operator must review the proposal, complete
  missing fields, and record the structured response through the existing
  evidence-backed workflow.
- Limit: V1 inspects the supplier email subject and body plus attachment names.
  It does not inspect attachment contents. Attachment-only terms remain unknown.
- Consequences: Sourcing workstreams resume with useful proposed terms without
  weakening evidence, tenant, approval, or external-action controls.

### 2026-08-11 - Supplier acknowledgment follow-up is a separate approved communication

- Status: accepted
- Owner: product and engineering
- Context: A released order can pass its acknowledgment due date without a
  supplier response. A queue warning without a durable follow-up action leaves
  the buyer to improvise in Gmail and loses the exact message, approval, and
  delivery history.
- Decision: Create a revisioned connected-Gmail follow-up draft and an immutable
  communication action bound to the exact active purchase action, release hash,
  remaining quantity, supplier recipient, and message. Require manager approval
  before delivery. Follow-ups may start only when acknowledgment is due.
- Delivery: Thread against the connected order message or latest follow-up when
  provider lineage exists. Use a stable RFC message ID, uncertain-delivery
  reconciliation, documented not-sent recovery, and idempotent retries. Persist
  each definitive send as connected-provider evidence and append it to the
  released-order history.
- Response boundary: A recorded acknowledgment or supplier exception cancels
  only safe unsent follow-up work. In-flight or uncertain delivery must be
  reconciled first. Replies remain review evidence; operators still confirm
  quantity, delivery, and changed terms.
- Consequences: The sourcing queue can resume draft, approval, recovery, sent,
  and reply-review states. This does not create payment, booking, customs,
  inventory, or Logistics state.

### 2026-08-10 - Purchase order release is separate from supplier acknowledgment

- Status: accepted
- Owner: product and engineering
- Context: Combining order release and supplier acknowledgment in one form
  erased the operational period where an issued order is waiting for supplier
  response. The queue could not show that state, schedule follow-up, or prove
  which exact authorized order was released.
- Decision: Record an evidence-backed `PURCHASE_ORDER_RELEASE` against the
  immutable purchase-action scope before accepting any supplier
  acknowledgment. The release stores the external PO reference, channel,
  release date, acknowledgment due date, evidence, scope hash, and deterministic
  release hash. Acknowledgments must bind to that release hash.
- Safety: Release rechecks authorization, qualification on the release date,
  quote validity, active admin decision, tenant scope, and need-by timing.
  Identical and concurrent retries converge. A changed release is rejected and
  the sourcing scope becomes immutable as soon as release is recorded.
- Consequences: The sourcing queue can now resume an order in `RELEASED` state
  and show that supplier acknowledgment is due. This still records an external
  event only. Derya does not send the PO, commit spend, or open Logistics.

### 2026-08-10 - Supplier contact revalidates qualification at release

- Status: accepted
- Owner: product and engineering
- Context: Checking supplier qualification only when an RFQ is prepared leaves
  a stale-authorization window. A qualification can expire or be replaced after
  drafting or approval but before the operator actually contacts the supplier.
- Decision: Bind the exact supplier-qualification review hash and validity date
  into connected-email approval scope. Recheck current qualification when the
  draft is saved, approval is requested, approval is granted, and the send is
  durably claimed immediately before Gmail is called. A manual external release
  also requires qualification that was valid on the recorded release date.
- Concurrency: Contact claims lock the procurement case before the quote cycle
  and communication action. Qualification changes and sends therefore cannot
  cross the side-effect boundary on stale state.
- Receipt rule: Once a provider may have accepted a message, its definitive or
  uncertain receipt must still be persisted. Qualification expiry never erases
  evidence of contact that already occurred. Identical recorded-release retries
  remain idempotent. A definitive `SENT` result is terminal: late timeout or
  reconciliation responses cannot downgrade it to unknown or retryable state.
- Upgrade path: Pending and approved email actions created before qualification
  was part of approval scope are never grandfathered. Safe unsent actions are
  hidden as stale and atomically replaced when the operator requests approval
  again for the same draft. Unresolved deliveries remain visible and must be
  reconciled first.
- Consequences: An earlier approval is not permanent permission to contact a
  supplier. Requalification requires a newly scoped approval before another
  connected send. No schema, connector, purchase, or Logistics behavior changes.

### 2026-08-10 - Supplier qualification is a structured, expiring decision

- Status: accepted
- Owner: product and engineering
- Context: The first procurement gate previously promoted one attributed URL
  plus a free-text note to evidence-complete. That was durable, but it was not a
  defensible supplier qualification and offered no explicit rejection path.
- Decision: Require a structured qualification outcome before RFQ preparation.
  A qualified supplier records identity evidence, component-capability
  evidence, manufacturer or distributor relationship, review validity, note,
  reviewer, timestamp, and deterministic hash. Authorized distributors also
  require manufacturer-authorization evidence. Identity evidence must match the
  attributed supplier domain.
- Rejection: An operator may reject a candidate with a structured reason. The
  workstream and immutable evidence remain visible and resumable. A later
  qualification creates a new evidence record and event without deleting the
  rejection history.
- Freshness: Missing, legacy free-text, and expired qualification reviews reopen
  Gate 1 in the read model. RFQ preparation and downstream approval boundaries
  fail closed against missing or expired qualification.
- Evidence class: Qualification is an operator review of external sources and is
  stored as `OPERATOR_RECORDED_EXTERNAL`. It is not silently promoted to an
  official fact, supplier award, compliance clearance, or purchase authority.
- Consequences: The active sourcing queue can explain why a supplier is blocked
  or rejected and can resume the exact review. No schema, connector, purchase,
  or Logistics change is required.

### 2026-08-10 - Sourcing history uses cursor pages and exact workstream hydration

- Status: accepted
- Owner: product and engineering
- Context: PostgreSQL retained every sourcing research run and procurement
  case, but the UI loaded only a fixed recent window and joined runs to cases
  in the browser. Older research could become invisible, and old quote or email
  actions could fail to reload their parent case after enough newer work.
- Decision: Page research runs by the stable `(createdAt, id)` order and return
  one opaque older-work cursor. Load all supplier cases for the exact run IDs
  on that page. Keep older runs visible as dated saved research instead of
  collapsing them out of the queue.
- Action lookup: API routes that mutate a quote cycle, email draft, or email
  action resolve the parent procurement case through exact task ancestry. They
  do not scan a capped recent-case list.
- Access: Every page and ancestry lookup refreshes the current active user and
  remains office and workspace scoped. Cursor values never weaken tenant
  filters.
- Consequences: Queue reads stay bounded while all durable history remains
  reachable and actionable. No schema, dependency, supplier contact, purchase,
  or Logistics behavior changes.

### 2026-08-10 - Connected supplier email uses stable identity and uncertain-delivery recovery

- Status: accepted
- Owner: product and engineering
- Context: Recording that an operator sent a quote request outside Derya is not
  enough for a controlled communication workflow. A generic email helper that
  sends before durable state exists can also duplicate supplier contact after a
  timeout or lost response.
- Decision: Store a revisioned Gmail draft under the supplier quote cycle, then
  copy the exact sender, recipient, subject, body, supplier, and quote-request
  hash into an immutable execution action. Require manager approval against the
  action input hash before delivery.
- Delivery: Claim one stable RFC message ID before calling Gmail. Persist the
  Gmail message and thread IDs, local outbound message, and connected-provider
  evidence only after a definitive receipt. Treat timeouts, rate limits, and
  incomplete receipts as unknown delivery and block resend until reconciliation
  searches Gmail by that stable ID.
- Recovery: A not-found search is not automatic permission to resend. An admin
  or manager must record how non-delivery was verified. The next attempt uses a
  new stable message ID while preserving the original attempt ledger.
- Boundary: Manual portal, EDI, phone, and external-email recording remains
  evidence-only. This decision does not connect purchase-order release, payment,
  booking, customs, or Logistics.

### 2026-08-10 - Procurement evidence is independently addressable

- Status: accepted
- Owner: product and engineering
- Context: A URL stored only inside mutable task JSON is useful context but not
  a durable evidence system. Supplier qualification, quote selection, and
  order acknowledgment need a stable record that survives task projection
  changes and can be carried into an approval scope.
- Decision: Append one immutable, office-scoped `SupplyEvidence` row for every
  supplier source review, quote-request release, quote response, and order
  acknowledgment. Bind each row to the exact execution task and content hash.
  Carry the selected quote evidence ID with its response hash through sourcing
  approval, purchase drafting, and final purchase authorization.
- Access: Evidence links resolve through an authenticated Supply OS endpoint
  that rechecks the current user and workspace before redirecting to the
  captured source. Cross-office lookup fails closed.
- Boundary: Operator-recorded external events remain labeled as such. A
  canonical evidence record does not prove Derya sent a message, contacted a
  supplier, issued a purchase order, or received a connected-provider event.

### 2026-08-10 - Commercial approval requires a persistent supplier quote cycle

- Status: accepted
- Owner: product and engineering
- Context: A browser form containing price, MOQ, delivery, and an evidence URL
  is structured note-taking, not a defensible supplier quote workflow. It also
  lets client-authored terms reach the approval boundary without a durable
  request and response history.
- Decision: After supplier-source review, create an office-scoped
  `SUPPLIER_QUOTE_CYCLE` child task. The operator prepares a revisioned quote
  request, records evidence that it was released outside Derya, appends one or
  more supplier responses, and selects a response by its server-owned hash.
  Only the selected stored response may complete the commercial gate.
- Evidence: Request revisions, external release, responses, and response
  selection append hashed events. Operator-recorded release and response data
  remain labeled `OPERATOR_RECORDED_EXTERNAL`; they are not upgraded to a
  connected-provider fact.
- Boundary: Operator-recorded release does not send anything. Connected Gmail
  release uses the separate exact-message approval and delivery-recovery path.
  Supplier changes cancel the active quote cycle, while quote revisions remain
  available for audit and resume.

### 2026-08-11 - Supplier negotiation uses immutable quote rounds

- Status: accepted
- Owner: product and engineering
- Context: Appending multiple supplier responses to one released RFQ records
  revised quotes, but it does not record that the buyer changed the request.
  Editing the released request would erase the commercial sequence.
- Decision: `Request revised quote` starts from one stored response hash. The
  prior cycle becomes terminal `REVISION_REQUESTED` history and a new internal
  draft inherits the supplier and operating scope with buyer-edited counter
  requirements. Concurrent retries converge on the same new round.
- Boundary: Creating the new round does not contact the supplier. The new draft
  must pass the existing connected-Gmail approval and delivery flow or receive
  separately recorded external release evidence.

### 2026-08-10 - Supplier acknowledgment is recorded evidence, not a claimed connector send

- Status: accepted
- Owner: product and engineering
- Context: A final purchase authorization is not proof that the supplier
  received or accepted an order. Derya does not yet have a supplier-order
  connector or canonical external purchase-order record.
- Decision: Let an admin or manager record an externally received supplier
  acknowledgment against the immutable authorized purchase action. Each entry
  stores channel, release and acknowledgment dates, supplier reference,
  accepted quantity, confirmed delivery, public evidence URL, actor, timestamp,
  and a deterministic hash.
- Lifecycle: The first entry moves the authorized action and draft from `READY`
  to `RUNNING`. Partial acceptances accumulate without exceeding the authorized
  quantity. Full cumulative acceptance moves both records to `SUCCEEDED`.
  Identical retries are idempotent. Once acknowledgment begins, upstream
  supplier and order scope cannot change; a new procurement case is required.
- Boundary: This records an external event. It does not send a supplier message,
  create a canonical PO, commit payment, book freight, or create a Logistics
  handoff. Only a fully acknowledged quantity may become input to the later
  Logistics handoff contract.

### 2026-08-10 - Final purchase authorization binds the full order, not a plan label

- Status: accepted
- Owner: product and engineering
- Context: The generic `action.execute` contract contains only a plan reference
  and action name. Reusing it for procurement would let an approval appear to
  cover a purchase without binding supplier, quantity, price, destination, or
  payment terms.
- Decision: Create an immutable `PURCHASE_ORDER_ACTION` child task from the
  current server-owned order draft. Its input copies the complete order,
  commercial terms, supplier evidence, quality plan, procurement approval,
  draft revision, and result hash. A separate admin approval binds directly to
  that input hash.
- Lifecycle: Draft edits cancel pending action approvals. Rejected scopes require
  a new draft revision. Authorization freezes the draft. Upstream supplier or
  evidence changes cancel an authorized but unexecuted action while preserving
  its historical approval record.
- Roles: Managers and admins may approve the sourcing scope. Only admins may
  authorize the final purchase action, with conditional separation of duties
  when another active admin exists.
- Boundary: `READY` means approved for a future controlled connector. It does
  not mean a purchase order was issued. Logistics remains unchanged until a
  supplier acknowledgment and explicit handoff contract exist.

### 2026-08-10 - Purchase preparation is a versioned draft, not a purchase order

- Status: accepted
- Owner: product and engineering
- Context: Manager approval makes a sourcing scope eligible for preparation,
  but the application has no canonical supplier-order connector or committed
  purchase-order record. Calling the next screen a PO would overstate what the
  system has actually done.
- Decision: Store purchase preparation as a `PURCHASE_ORDER_DRAFT` child of the
  procurement case. The mutable, revisioned result contains operator-entered
  delivery instructions while supplier identity and commercial terms are
  copied from the immutable approved scope. Commercial confirmation must include
  a unit of measure so quantity, MOQ, and subtotal are dimensionally valid.
- Concurrency: Use optimistic revisions for edits, make identical retries
  idempotent, and cancel active drafts when supplier selection or review scope
  changes.
- Boundary: The draft has no external reference and performs no contact,
  commitment, payment, booking, customs, or Logistics mutation. A future order
  action must copy the exact draft into a new immutable input and obtain its own
  approval before any connector can execute it.

### 2026-08-09 - Supply OS desktop navigation can collapse to a numbered rail

- Status: accepted
- Owner: product and design
- Context: The persistent 260px domain sidebar preserved spatial memory but
  consumed too much width on analysis and automation surfaces. Removing it
  entirely would weaken wayfinding and make domain switching less predictable.
- Decision: Keep the sidebar expanded by default and let the operator collapse
  it to an 84px numbered rail on desktop. Collapsed buttons retain accessible
  domain names and the active state. Below 900px, keep the existing horizontal
  labeled navigation and hide the collapse control.
- Rationale: Operators can reclaim workspace width without losing the stable
  six-domain map. Two-digit domain numbers remain recognizable without adding
  another set of decorative or generic icons.
- Consequences: Collapse state remains local to the mounted shell and survives
  domain changes in that session. Empty lower-rail space remains intentional.
  Future lower-rail utilities must work globally and must not duplicate a
  domain.
- Revisit when: operators need the collapsed preference persisted across
  sessions or the domain count no longer fits the numbered rail.

### 2026-08-09 - Inventory and sourcing share one domain; fulfillment owns customer delivery

- Status: accepted
- Owner: product and design
- Context: Separate Supply and Suppliers tabs split one procurement decision
  across two nearly identical domains. Operators could not infer whether
  Supply meant inventory, production inputs, or supplier discovery. Customer
  delivery also lacked a clear operating domain of its own.
- Decision: Consolidate inventory, demand, internal locations, shortages, and
  supplier options under Inventory & sourcing. Replace the standalone
  Suppliers tab with Fulfillment for allocation, outbound movements, delivery
  readiness, and customer handoffs. Retired supplier URLs resolve to the
  consolidated first domain.
- Rationale: The procurement question is one loop: what is available, what is
  missing, and where can it be sourced. Fulfillment is a different loop: what
  has been allocated, what must move, and whether the customer commitment will
  be met.
- Consequences: Supplier research remains available against inventory and BOM
  context. Fulfillment focuses customer and distribution geography without
  replacing Logistics transport planning or Tracking execution history.
- Revisit when: observed operators consistently need procurement qualification
  separated from inventory planning or fulfillment duplicates execution
  tracking.

### 2026-08-09 - Automations starts as a chat-edited draft workspace

- Status: accepted
- Owner: product and engineering
- Context: Supply OS had no place to inspect reusable operating workflows,
  edit their steps, or describe a new workflow in plain language. Reusing the
  network map would make automation setup harder to understand and would imply
  that a draft could execute live freight actions.
- Decision: Add Automations as the sixth company workspace. Use a two-pane
  layout with chat as the primary work area and an automation library plus the
  selected step plan as secondary context. The first version supports
  deterministic, browser-session drafts only. Chat may select, extend, add an
  approval gate to, or create a workflow draft.
- Rationale: Operators can shape the workflow before Derya connects it to
  canonical records or execution workers. The interface is useful now without
  pretending that a text response is a production automation.
- Consequences: Built-in workflows cover bill of lading preparation, supplier
  search, freight rate requests, customs document checks, and transport
  exception monitoring. The UI labels the selected workflow as `Draft` without
  repeating a long execution disclaimer. GPT may create or revise draft steps,
  but the server preserves approval gates and the feature cannot send messages,
  file customs, book freight, write records, or authorize spend. Specific
  operational icons replace the generic Boxes icon across Supply OS.
- Revisit when: office-scoped workflow persistence, version history, typed
  triggers and actions, approval hashes, and idempotent execution workers are
  ready for the Automations surface.

### 2026-08-09 - Opportunities is a scenario workbench, not a network report

- Status: accepted
- Owner: product and design
- Context: The Opportunities tab reused the network map and ranked-priority
  inspector. It exposed recommendations but did not let an operator choose a
  change, run it as a scenario, or compare the modeled result with the current
  condition.
- Decision: Give Opportunities its own scenario workbench inside the shared
  company shell. Offer Supply, Logistics, Production, and Network plays. Each
  play must state the current condition, change to test, required inputs,
  measure, decision, evidence state, and approval boundary. Running a play
  updates a side-by-side current-versus-change output. Use `Production` for the
  operating domain instead of `Assembly`.
- Rationale: An opportunity is useful only when an operator can test a concrete
  change and see what evidence and decision are required. Reusing the map made
  this tab look like a thinner copy of Logistics.
- Consequences: Scenario output remains deterministic and company-model bound.
  It cannot invent rates, approve a supplier, book transport, file customs, or
  authorize spend. Narrow layouts bring the output into view after a run.
- Revisit when: persisted office-scoped planning results replace the current
  browser interaction or the canonical planning engine exposes additional
  scenario families to this surface.

### 2026-08-09 - Derya uses an app-wide airy system and zero-fluff UI copy

- Status: accepted
- Owner: product and engineering
- Context: The existing interface direction still felt evenly split between
  spacious product design and square, compact enterprise software. It also
  allowed page slogans, explanatory intros, and repeated subtitles that did
  not help an operator make a decision.
- Decision: Apply `DESIGN.md` to the entire app. Target 80 percent airy and 20
  percent compact operational UI. Use generous page spacing, Instrument Sans,
  restrained neutral color, 10px control radii, 12 to 14px panel radii, and
  16px workspace radii. Start directly with the work when the app shell already
  establishes context. Visible copy must identify an object, state, source, or
  scope; name an action; explain a blocker, consequence, uncertainty, or
  approval boundary; or prevent a material mistake. Otherwise remove it.
- Rationale: Operators need fast comprehension, not narration. Spacious layout
  and soft geometry make dense freight data easier to scan, while factual copy
  preserves operational trust.
- Consequences: Future UI work must read and follow `DESIGN.md`. Existing
  screens migrate when touched. Generic hero copy, repeated descriptions,
  square enterprise controls, and decorative card grids are regressions.
  Provenance, demo state, uncertainty, compliance, destructive-action warnings,
  and human approval remain mandatory.
- Revisit when: observed operator sessions show measurable comprehension or
  task-speed problems caused by the comfortable density or geometry.

### 2026-08-08 - Supply OS uses a persistent company ribbon, domain sidebar, and boxed map

- Status: accepted
- Owner: product and engineering
- Context: The previous implementation mixed a full-background map, product
  twin, supplier search, scenario analysis, and execution status without a
  stable navigation hierarchy. Company selection and data controls were also
  hidden behind menus and modal dialogs.
- Decision: Keep the left Supply OS sidebar as the persistent domain switcher.
  Keep a persistent top ribbon for company identity, attributable logo or
  monogram fallback, facility, data freshness, and active domain. Make the
  default state a row-based company directory with inline admin creation and a
  back arrow from a selected company. Geographic views place the map in a
  bordered central box while surrounding context changes by domain. Do not use
  modal or hover-popup workflows for primary operation.
- Rationale: Operators need stable spatial memory. Company context and domain
  navigation should not move while the analysis changes. A bounded map keeps
  geography important without allowing it to consume the full interface.
- Consequences: Supply, Logistics, Suppliers, Opportunities, and Tracking are
  views of one company workspace. Candidate and inferred map edges remain
  dashed and evidence-labeled. Data import and future company setup must be
  inline or use dedicated page regions.
- Revisit when: observed operator sessions show that the persistent ribbon or
  sidebar materially reduces usable space at supported desktop widths.

### 2026-08-08 - Supply OS uses PostgreSQL, relational graphs, and a typed capability DSL

- Status: accepted
- Owner: product and engineering
- Context: Supply OS must combine ERP state, product and BOM mapping,
  supplier and shipper discovery, compliance, sourcing alternatives,
  logistics, customs, tracking, and cost. These records need exact quantities,
  office isolation, evidence provenance, versioning, and human approval. A
  generic agent prompt, separate graph database, or vector-first store would
  weaken those guarantees and add synchronization work before measured scale
  requires it.
- Decision: Keep PostgreSQL as the operational source of truth. Store BOM and
  future route edges as relational adjacency lists, connector-specific detail
  as JSONB beside normalized columns, published ERP data as immutable
  snapshots, and execution history as append-only events. Use the existing
  source-linked knowledge model for unstructured retrieval. Consider pgvector
  only as an optional chunk-retrieval aid after measured recall failures, never
  as operational truth. Control capabilities through the versioned
  `supply-os/v1` DSL and a typed registry. Bind every approval to the hash of
  the exact decision or execution input. Keep external actions behind a
  matching human approval and an idempotent connector worker.
- Rationale: One relational consistency boundary is simpler, safer, and
  sufficient for product and route traversal. The DSL makes agent-assisted
  work reviewable and testable without hiding permissions or side effects
  inside prompts.
- Consequences: Office and workspace scope is enforced in application queries
  and database triggers. Browser storage is temporary compatibility state, not
  shared office persistence. Neo4j and a standalone vector database are not
  part of the current architecture. Supplier contact, purchase orders,
  shipment bookings, and customs filings remain inert until an approved
  connector implementation exists. Missing quantities, prices, lead times,
  dates, and scrap rates remain database `NULL` or explicit unknown values;
  import code may not replace them with zero or an epoch timestamp.
- Revisit when: measured PostgreSQL traversal performance, unstructured recall,
  or connector throughput fails a defined service target after normal indexing,
  recursive SQL, materialized projections, and queue workers are exhausted.

### 2026-08-08 - Supply OS is the sole primary internal product surface

- Status: accepted
- Owner: product and engineering
- Context: CRM, Intel, Supplier Finder, freight planning, and tracking appeared
  as separate products even though they are inputs or workstreams in one supply
  decision. The fragmentation hid the core product and forced operators to
  assemble the operating picture themselves.
- Decision: Make `/dashboard/supply-os` the only primary internal navigation
  destination. Integrate product and materials, supplier qualification,
  sourcing scenarios, logistics and customs, and tracking and cost as panels
  in one operating shell. Keep setup, admin, customer portal, and carefully
  scoped operational deep links available without presenting them as peer
  products. Redirect legacy standalone Supplier Finder and Intel entry points
  into the matching Supply OS panel after their state is migrated.
- Rationale: The product is the decision and execution system across the
  supply chain, not a collection of departmental screens.
- Consequences: Legacy modules may remain temporarily as implementation
  components or compatibility routes, but they cannot retain independent
  product positioning. Every panel must distinguish shared canonical records,
  browser-local drafts, illustrative fixtures, and live external state.
- Revisit when: a customer-facing surface or a narrowly authorized operator
  workflow genuinely requires a separate application boundary.

### 2026-08-07 - Supplier discovery separates public evidence from private origin context

- Status: accepted
- Owner: product and engineering
- Context: Steel-sector users may need suppliers for raw materials, fuel,
  semi-finished goods, or finished products while their current origins and
  commercial relationships remain sensitive. A generic provider directory or
  a model-generated reliability score would expose the wrong information and
  overstate what public research can prove.
- Decision: Add a dedicated Supplier Finder that sends only an explicit public
  product brief to attributable web research. Keep current origin and supplier
  notes in office-and-user-scoped browser storage and exclude them from the
  request contract. Treat every result as an unvetted candidate. Normalize
  public evidence into fixed identity, producer-status, product-capability,
  quality-system, and export-market gates. Keep ownership, sanctions,
  financial, reference, capacity, sample, inspection, authority, and contract
  checks outside the public-evidence score and under human review.
- Rationale: Supplier discovery can shorten the longlist without pretending
  that public pages prove reliability, capacity, authority, or commercial
  readiness. The privacy split lets the operator use sensitive context without
  placing it in a public research query.
- Consequences: The first version is read-only, browser-scoped, and makes no
  supplier contact, award, purchase, booking, filing, or spend mutation. Live
  search requires the existing OpenAI web-search configuration. Browser-local
  notes are not encrypted shared records and should not hold formal secrets.
- Revisit when: Derya has office-scoped supplier records, an approved diligence
  provider, role-based secret storage, and a human-reviewed outreach workflow.

### 2026-08-07 - Supply OS lanes expand into multimodal operating legs

- Status: accepted
- Owner: product and engineering
- Context: A continuous curve between a supplier and factory still hid the
  actual operating chain. Pickup, port or airport handoff, main carriage,
  customs release, and final delivery were stored only as words inside one
  compound mode label, so the map could not render or select them.
- Decision: Keep the commercial lane as the parent record, but deterministically
  expand it into separately rendered road, ocean, air, customs, and final-mile
  planning legs. Show maintained Lucide transport symbols and labeled gateway
  markers on the MapLibre surface. A click on any leg continues to open the
  parent lane dossier. Keep every generated gateway and route explicitly
  inferred until shipment records or live provider responses confirm it.
- Rationale: The customer needs to see the physical handoffs immediately while
  Derya still needs one lane record for quoting, ownership, and approval.
- Consequences: Route geometry and gateways are planning hypotheses. They do
  not claim an observed truck path, booked terminal, vessel movement, flight,
  broker acceptance, capacity, or price.
- Revisit when: A routing engine, shipment feed, terminal API, airline or ocean
  schedule, and broker integration can replace individual inferred legs with
  current records.

### 2026-08-07 - Supply OS route corridors are continuous, directional, and directly selectable

- Status: accepted
- Owner: product and engineering
- Context: Straight route strokes and isolated midpoint labels did not make the
  supplier-to-factory-to-customer flow visually obvious. Small provider lists
  also made the lane inspector look like a generic recommendation widget.
- Decision: Render every modeled movement as a continuous curved corridor over
  the maintained MapLibre basemap. Use repeated Lucide direction markers,
  persistent white casing, and selected-lane emphasis. Keep a wide native
  pointer target along the route curve and preserve the route rail as the
  keyboard-accessible control. Build lane shortlists from endpoint-specific
  official candidates first, followed by national alternatives, with no claim
  of live capacity or award.
- Rationale: A customer should understand physical flow before reading detail,
  and an operator should be able to open the exact lane directly from the map.
  Local and national alternatives make the next quote action useful without
  pretending Derya has already tendered freight.
- Consequences: Curves are planning geometry, not turn-by-turn routes. Provider
  expansion must keep official-source provenance and clearly separate candidate
  fit from live price, capacity, and performance.
- Revisit when: Live route engines, carrier APIs, quote ingestion, or a dynamic
  endpoint provider-search service replaces deterministic planning candidates.

### 2026-08-06 - Customer Supply OS leads with operational ownership and a production handoff

- Status: accepted
- Owner: product and engineering
- Context: The saved customer dashboard treated a robotics company's sourced
  components and finished-goods deliveries as one direct freight lane. In the
  Atlas example, that sent Shenzhen components to Detroit and Nashville while
  skipping the Austin production site. The page also made unqualified
  providers, modeled costs, and static gateway order look more certain than
  the available cargo facts supported.
- Decision: Add a deterministic customer-engagement layer above the detailed
  movement engine. The default offer is full operational ownership, with
  modular starting points for supplier sourcing, inbound logistics, customs,
  and finished-goods delivery. Model the customer network as inbound
  components into the stated production or receiving site and outbound
  finished goods from that site to customers. Store that site separately from
  company headquarters when the prompt distinguishes them. Keep named
  providers, prices, broker candidates, and gateway rankings out of the
  default customer view until current evidence supports a decision. Persist
  the selected coverage with the version 1 browser case,
  while accepting older version 1 cases that do not contain the optional field.
- Rationale: The one-minute demo must answer what the customer can hand to
  Derya before it explains freight mechanics. Separating the production
  handoff prevents a false supply-chain topology, and suppressing unsupported
  precision protects trust.
- Consequences: The customer view now presents five concrete workstreams,
  three scope-specific kickoff inputs, an inbound and outbound network, a
  customs boundary that distinguishes domestic, unknown, and import movements,
  and collapsed execution depth. Multi-source inputs do not assign every
  component to every region without source allocation evidence. Customs scope
  follows each side of the production handoff, and a headquarters fallback
  remains an explicit confirmation item. The existing detailed
  movement planner remains available as an internal deterministic engine and
  no database schema, dependency, provider call, message, booking, or customs
  filing path changes. The prior decision to show gateway, price, transit, and
  eight execution legs by default is superseded.
- Revisit when: Office-scoped cases, BOM records, supplier candidates, live
  quotes, broker responses, or bookings can replace the browser-local scoping
  plan with attributable operational evidence.

### 2026-08-06 - Separate customer generation from saved Supply OS dashboards

- Status: accepted
- Owner: product and engineering
- Context: The first customer-case version placed the prompt, saved customer
  browser, map, provider research, evidence records, customs integrations,
  execution details, and open checks in one very long page. The data model was
  useful, but the presentation made a customer perform two jobs at once and
  exposed planning internals that belong in operator tooling or settings.
- Decision: Keep `/dashboard/supply-os` for saved customer dashboards and add
  `/dashboard/supply-os/new` for case generation and input review. The saved
  dashboard shows only the selected lane, map, recommended gateway, expected
  range, transit assumption, door-to-door steps, compact customs and risk
  summaries, and three next actions. Keep detailed provider requests,
  evidence references, connector setup, invoice guidance, and generic supplier
  profiles in the deterministic engine, but do not render them in the default
  customer dashboard.
- Rationale: One page should answer one question. The generator answers what
  should be modeled. The saved dashboard answers what route is recommended,
  what it may cost, what can block it, and what the operator needs next.
- Consequences: Existing version 1 browser saves and movement-scoped planning
  remain compatible. The route split changes no database schema, tenant scope,
  provider connection, booking, customs filing, message, or approval boundary.
  The single-scroll presentation described in the prior customer-case decision
  is superseded, but its deterministic case model and browser-storage contract
  remain in force.
- Revisit when: Detailed operator evidence receives a separate authenticated
  drill-down, or shared office-scoped case persistence replaces browser saves.

### 2026-08-06 - Supply OS operating plans are movement-scoped and evidence-gated

- Status: accepted
- Owner: product and engineering
- Context: A generated customer case could describe several source regions and
  delivery markets, but one shared shipping section could mix ports, customs
  requirements, provider options, and cost assumptions across different lanes.
  The product also needs detailed guidance without pretending a directory,
  published schedule, index, or stale terminal page is a live quote or current
  operating condition.
- Decision: Derive one operating plan for each source-to-destination movement
  from the versioned saved case. Scope all port rankings, customs workflows,
  intelligence checks, execution legs, candidate providers, quote inputs,
  costs, and evidence to that movement identifier. Model unknown current
  conditions explicitly and require a named source callback with freshness
  before changing a decision. Customs technology may prepare and validate
  source facts, but broker-controlled entry review and filing remain human
  gated.
- Rationale: Movement isolation prevents one lane's evidence or price from
  leaking into another. Evidence gates let the UI be useful at planning time
  without manufacturing live rates, capacity, terminal status, classification,
  admissibility, or customs release.
- Consequences: Existing browser-saved cases stay compatible because the plan
  is derived at render time. All costs remain labeled demo estimates and omit
  duties and taxes. Dangerous-goods prompts withhold totals until source facts
  and carrier acceptance are confirmed. Domestic, intra-EU, land-border, US
  ocean-import, and non-US ocean-import templates cannot borrow jurisdiction or
  mode-specific providers from each other. Provider and customs connector
  records are integration candidates until a real adapter returns attributable,
  timestamped evidence.
  A production implementation needs office-scoped persisted cases, immutable
  plan snapshots, expiry rules, authorized provider callbacks, and explicit
  human approval before messages, bookings, filings, or spend commitments.
- Revisit when: Derya adds an approved live rate, terminal, carrier, drayage,
  broker, customs, ERP, TMS, or procurement adapter.

### 2026-08-06 - Supply OS demos start from a generated customer case

- Status: accepted
- Owner: product and engineering
- Context: The command-center prototype displayed dense fictional operations
  before the user identified a customer. Several controls changed only local
  labels, and six separate views made the demo look broader than its working
  behavior.
- Decision: Make one natural-language customer prompt the start of the Supply
  OS demo. Generate a single scrollable dashboard containing normalized company
  facts, a supply route, supplier search briefs, indicative forwarder options,
  customs checks, risks, and open questions. Save and browse demo dashboards in
  versioned browser storage only. Keep one discreet demo disclosure and mark
  every unsourced or missing claim for verification.
- Rationale: A customer can understand the product by watching their own supply
  case appear. One complete flow is more credible than multiple disconnected
  tabs, fake telemetry, or disabled controls.
- Consequences: Browser saves do not create or link CRM companies, persist to
  Prisma, publish to a customer portal, or authorize any supplier, forwarder,
  broker, customs, booking, or spend action. Local keys are namespaced by the
  authenticated office and user, but this is not a substitute for
  server-enforced tenancy. The future server implementation should use
  office-scoped cases and immutable snapshots with explicit company linking and
  allowlisted customer projection.
- Revisit when: shared case persistence, live provider evidence, or explicit
  customer access is approved.

### 2026-08-06 - Supply OS is an authenticated dashboard workspace

- Status: accepted
- Owner: product and engineering
- Context: The first Supply OS prototype was linked from the product sidebar
  but opened a standalone page with its own green shell. That made it look like
  a separate product and bypassed the established Derya visual system.
- Decision: Keep Supply OS at `/dashboard/supply-os` inside the authenticated
  application layout. Keep `/supply-os` only as a compatibility redirect. Use
  the existing Derya palette and checked-in Natural Earth geography. Prototype
  decisions may update local browser state but cannot call server actions,
  external providers, or operational write paths.
- Rationale: Supply intelligence and logistics control are part of Derya, not
  a detached microsite. A real geographic base and restrained record-oriented
  layout make the prototype more credible without pretending synthetic lanes
  are live tracking.
- Consequences: New Supply OS views should extend the authenticated workspace
  and reuse office-scoped canonical records when backend work begins. They must
  preserve provenance and human approval before supplier, broker, forwarder,
  customs, booking, or spend actions.
- Revisit when: A separately authorized public demo or customer-facing supply
  network product is approved.

### 2026-08-04 - Public customer design sandbox is fixture-only

- Status: accepted
- Owner: product and engineering
- Context: Vercel branch previews require team authentication, and the real
  customer workspace requires either a customer membership or an internal
  staff session. That made rapid visual feedback on the customer experience
  unnecessarily slow.
- Decision: Keep `/customer` as a public, no-login, noindex design sandbox that
  uses only fictional fixture data. It may reuse customer-safe deterministic
  view logic and portal styles, but it must not query Prisma, authenticate a
  customer, resolve an office or company, or expose a real document. All
  consequential controls remain disabled.
- Rationale: Product review needs a stable route that anyone on the local
  workspace can open, while customer and tenant data must remain behind the
  real `/portal` and staff-preview authorization boundaries.
- Consequences: Feedback can cite `/customer` or a shareable
  `/customer?shipment=...` state. Accepted design changes should be applied to
  the authenticated portal, not left only in the sandbox. Future edits must
  preserve the source test that rejects Prisma and live workspace loaders from
  the route.
- Revisit when: The design is stable enough to remove the sandbox, or a
  separately authorized public demo environment is introduced.

### 2026-08-03 - Customer portal preview is internal and read-only

- Status: accepted
- Owner: product and engineering
- Context: Operators could configure customer access but could not inspect the
  actual company workspace without creating a customer identity and completing
  the external login flow. The sign-in page is not a useful product preview.
- Decision: Admins and managers may open the real customer workspace for one
  same-office company through an explicit preview mode. Preview reuses the
  customer-safe projection, workspace, shipment detail pages, and current
  canonical records. It uses the internal session and a temporary member-shaped
  principal. It does not create a customer user, membership, login code, or
  customer session. Quote and upload controls are visible but disabled, and the
  underlying server actions continue to require a real customer principal.
- Rationale: Reusing the actual customer routes prevents a separate mock from
  drifting while preserving tenant isolation and the human approval boundary.
- Consequences: Preview links must preserve the selected company and preview
  mode across shipment navigation. Invalid or cross-office company and job IDs
  return 404. Preview has a persistent banner and exit control so an operator
  cannot mistake it for a customer session.
- Revisit when: Derya needs support impersonation with audited actions. That
  requires a separate persisted approval and audit design, not writable preview.

### 2026-07-29 - Customer portal is an email-first company workspace

- Status: accepted
- Owner: product and engineering
- Context: Higher customer load volume makes email-only status, document, and
  quote coordination expensive, but forcing every freight interaction through
  a new SaaS workflow would add customer friction and create a second source of
  truth.
- Decision: Keep email as the default intake and exception channel. Add an
  authenticated, company-scoped customer workspace over canonical
  `Inquiry`, `Job`, milestone, quote-line, and document records. Preserve the
  existing one-load guest link. External identities and login codes remain
  separate from internal users. Company membership and document publication
  are explicit and revocable. Customer quote responses and uploads create
  pending review actions and never execute freight operations automatically.
- Rationale: Customers get durable shared state and self-service for repetitive
  coordination while Derya keeps one operating system, one company brain, and
  human control over consequential actions.
- Consequences: Deploy the customer portal migration before the application.
  Existing approved documents are hidden by default. Operators must grant
  company access, request uploads, publish approved files, and resolve customer
  actions from the internal Customer Portal page. The customer control tower
  and `/portal/shipments/[jobId]` detail route project canonical shipment state.
  They describe recorded operational milestones and must not imply live GPS,
  vessel, or carrier tracking without an explicit trusted integration.
- Revisit when: A customer requires SSO, API, webhook, EDI, embedded access, or
  a policy-approved class of automatic low-risk actions.

### 2026-07-29 - The load page is the operational dossier and Intel uses an explicit handoff

- Status: accepted
- Owner: product and engineering
- Context: Shipment facts, correspondence, issues, documents, route context,
  commercial strategy, and market research were split across a long record
  page and separate modules. The old map depended on public tile requests and
  silently assigned unknown locations to unrelated fallback cities.
- Decision: Treat the office-scoped load record as the canonical operational
  dossier. Its primary surface combines recorded and source-stated facts,
  conflicts, open tasks, document state, correspondence, linked market
  reviews, and a load-scoped agent. Render planned routes from checked-in map
  geometry and a conservative known-location registry. Never invent a point
  or exact port call for an unresolved location. Operator-edited Job fields
  outrank imported or AI-extracted dossier data, and parsed dossier data cannot
  mark itself operator-confirmed. Connect a load to standalone Intel only
  through an explicit privacy-safe prefill that does not auto-send,
  auto-analyze, or persist an Intel review.
- Rationale: Operators need one decision surface without allowing research,
  inferred geography, or AI extraction to impersonate shipment truth.
- Consequences: Dense commercial and operating tools remain available as
  supporting controls rather than dominating the page. Intel remains
  chat-first and context-isolated. The China load review still requires an
  operator click and preserves its read-only evidence contract. Maps are route
  plans, not tracking or carrier schedules.
- Revisit when: saved Intel reviews have an approved office-scoped schema and
  audit contract, or a live tracking provider supplies verified positions and
  event timestamps.

### 2026-07-27 - Intel is chat-first and reports attach to answers

- Status: accepted
- Owner: product and engineering
- Context: Rendering a large market report at the top of the Intel route made
  the page look like a static dashboard and pushed the question workflow out
  of the primary hierarchy.
- Decision: Keep `/dashboard/intel` as a dedicated full-page conversation.
  Render detailed research reports only under the assistant answer whose
  successful read-only tool call requested that evidence. Keep real shipment
  review as the separate `/dashboard/intel/load` workflow.
- Rationale: The operator starts with an actual question, receives a direct
  answer, and can inspect all supporting detail without losing the composer or
  switching to a second generic agent window.
- Consequences: The exact Intel page suppresses the floating dock and does not
  inherit recent jobs, customer or job memory, price prefetch, or pasted-RFQ
  ingestion. It also skips the persistent agent event log. The hardware report
  remains nonpersistent, deterministic, and explicit about unconnected
  providers and evidence limitations.
- Revisit when: Intel conversations need approved office-scoped persistence or
  a second report type requires its own deterministic attachment contract.

### 2026-07-27 - Outreach execution is a top-level workspace over CRM data

- Status: accepted
- Owner: product and engineering
- Context: Daily and weekly outreach was implemented inside the CRM contact
  page, which made the operating queue look like a secondary CRM mode and made
  it too easy to miss.
- Decision: Keep `/dashboard/crm` focused on canonical contact data and expose
  daily and weekly execution at the top-level `/dashboard/outreach` route.
  Both routes reuse the same office-scoped `Contact`, `Company`, and
  `OutreachPlanItem` records, server loader, planner, and mutation actions.
  Legacy CRM outreach URLs redirect to the new workspace.
- Rationale: CRM is where relationship data is maintained. Outreach is where
  the operator executes today's work and reviews weekly capacity. Separate
  navigation makes that distinction obvious without creating a second contact
  database or duplicating business logic.
- Consequences: Contact and outreach mutations revalidate both routes. The
  Outreach workspace links back to CRM for classification and channel fixes,
  while CRM provides a direct link into today's Outreach queue. No new schema,
  automated send behavior, or parallel outreach system is introduced.
- Revisit when: channel integrations support approved sending and delivery
  evidence, or outreach execution needs a dedicated agent context.

### 2026-07-26 - CRM outreach uses a weekly plan over canonical contacts

- Status: accepted
- Owner: product and engineering
- Context: Founder outreach needs a repeatable daily operating loop without
  creating a second contact database or implying that social and email messages
  were sent automatically.
- Decision: Keep `Contact` and `Company` as canonical relationship truth. Use
  office-scoped `OutreachPlanItem` rows to maintain seven days of capacity and
  promote daily work at fixed channel limits: 20 Bookface, 30 LinkedIn, and 30
  Email. Only Personally important and Startup contacts with an assigned
  channel are eligible. Forwarders are data-only. Operators must explicitly
  mark outreach complete; the action records an activity and touch timestamps
  but does not send a message.
- Rationale: A finite queue makes progress measurable while preserving tenant
  isolation, canonical CRM records, and human control over external contact.
  Keeping weekly planning separate from contact status also provides an
  auditable history without overloading the contact record.
- Consequences: Weekly pool gaps are visible, overdue tasks consume the next
  day's channel capacity, and completing a task does not silently refill beyond
  that day's quota. The planner ranks importance deterministically before age.
- Revisit when: channel integrations can prove delivery and an approved
  automation policy exists for outbound outreach.

### 2026-07-03 - CRM relationship OS reuses company/contact truth

- Status: accepted
- Owner: engineering
- Context: The internal CRM needs to track customers, prospects, partners,
  vendors, investors, advisors, RFQs, follow-ups, and source-linked brain
  context. The app already has `Company`, `Contact`, `Activity`, `Task`,
  `Inquiry`, `Job`, and memory models. Creating parallel `CrmCompany` and
  `CrmContact` tables would split the inbox/RFQ/load source of truth.
- Decision: V1 reuses `Company` as the account object and `Contact` as the
  person object, adds nullable relationship metadata to existing records, and
  adds only one new generic `CrmOpportunity` model for non-load/RFQ
  relationship opportunities. Contacts remain company-scoped in V1.
- Rationale: This keeps the product on the coherent path of emails to RFQs to
  active loads while adding a founder/operator relationship layer around the
  same data. It avoids Salesforce-style duplication and keeps tenant scoping
  straightforward.
- Consequences: Standalone people without a company are not first-class yet.
  Future standalone-person work should be a deliberate migration, not a quick
  duplicate table. CRM agent actions stay internal/draft-only until persisted
  approval records exist.
- Revisit when: live GBrain retrieval and CRM-specific reviewed agent
  proposals are ready for production use.

### 2026-07-01 - RFQ Brain Context V1 is read-only and draft-only

- Status: accepted
- Owner: engineering
- Context: The RFQ detail page now surfaces domestic trucking rate context and
  future GBrain/web-intelligence slots next to real RFQ data. Without explicit
  boundaries, operators or future agents could mistake mock/manual rate context
  for a sent quote, approved customer price, live provider rate, or booked load.
- Decision: RFQ Brain Context V1 must remain read-only against operational
  truth and draft-only for customer wording. It may compute deterministic
  missing-field checks, mock benchmark options, manual-rate placeholders,
  source-tagged brain context, draft economics, next questions, and audit
  previews. It must not call live providers, read provider credentials, send
  customer/vendor messages, book/tender freight, persist approval state, or
  override product RFQ/job truth.
- Rationale: This gives operators useful pricing/risk context without creating
  fake authority or hidden side effects.
- Consequences: Future live integrations must extend the provider boundary,
  persist office-scoped audit/approval records, and keep customer-facing actions
  behind explicit human approval.
- Revisit when: the approval queue, persisted rate audit model, and provider
  sandbox credentials are ready for an operator-reviewed pilot.

### 2026-07-01 - Production pentest sandbox self-repairs by cron

- Status: accepted
- Owner: engineering
- Context: Local `seed:pentest-demo -- --apply` verified the pentest account,
  but production login still failed because the deployed app uses a different
  database. The production shell/database URL is not available to every coding
  session.
- Decision: Keep the pentest sandbox provisioned through an idempotent
  `CRON_SECRET`-protected route at `/api/cron/pentest-demo`, scheduled by
  Vercel every 5 minutes. The route verifies first and only repairs the
  sandbox when missing or broken. It also removes legacy `admin@demo.local`
  rows in the target database.
- Rationale: A sandbox account that only works in the local database is useless
  to pentesters. The route uses the same auth pattern as existing cron jobs and
  avoids exposing production database URLs or secret values to local agents.
- Consequences: The pentest account is intentionally resettable and synthetic.
  Do not put real customer, supplier, token, OAuth, or production facts into
  this tenant. Remove the cron when the internal pentest window ends.
- Revisit when: there is a first-class internal admin console or controlled
  deployment task runner for one-off production data operations.

### 2026-07-01 - Public signup and sample admin access stay disabled

- Status: accepted
- Owner: engineering
- Context: The login page exposed both public office creation and a legacy
  `admin@demo.local / admin1234` sample access path. For an internal pentest
  sandbox, those controls make testers use the wrong account and allow tenant
  creation outside the prepared sandbox.
- Decision: The public login page should only allow sign-in. Do not expose
  sample/admin credentials, `?demo=1` autofill, or a public `/signup` office
  creation page. Pentest access is provisioned through the explicit
  `seed:pentest-demo` command and legacy demo admin cleanup through
  `cleanup:demo-admin`.
- Rationale: Internal test accounts should be deliberate, resettable, and
  isolated. Public sample credentials and open tenant creation are noisy and
  weaken the test surface.
- Consequences: New offices must be created through controlled setup scripts
  or future admin-only tooling, not public self-serve signup. Do not re-add
  `admin@demo.local` as a visible login hint.
- Revisit when: Derya intentionally supports public self-serve onboarding.

### 2026-06-30 - Separate top-down dashboard from focused load cockpit

- Status: accepted
- Owner: engineering
- Context: The focused `/dashboard` load view was rendering office-wide
  decision queue and control-sheet modules under the selected job. That made a
  real load like `JOB-2026-021` appear to contain unrelated sheet rows and
  under-covered RFQs from other lanes.
- Decision: `/dashboard` defaults to the focused load cockpit and should render
  only the selected job's route, pricing, timeline, documents, conversation,
  and load-scoped workflow context. Office-wide queue/control-sheet views
  live behind an explicit top-down mode at `/dashboard?view=overview`.
- Rationale: Operators need to trust that a load page is scoped to that load.
  Global prioritization is useful, but mixing it into a specific load makes the
  system look like it is hallucinating or cross-contaminating customer work.
- Consequences: Future dashboard widgets must choose one scope: focused job or
  office-wide overview. If a widget needs both, it should expose separate
  scoped variants instead of reusing the same component blindly.
- Revisit when: the product has a dedicated route structure for
  `/dashboard/overview` and `/dashboard/jobs/[jobId]/workbench`.

### 2026-06-30 - Domestic trucking pricing V1 is US-only

- Status: accepted
- Owner: engineering
- Context: The first domestic pricing page treated any `ROAD` RFQ as
  domestic, which incorrectly surfaced Turkey and Europe lanes as domestic
  trucking candidates. That is commercially misleading and makes the wedge
  look fake.
- Decision: Domestic trucking pricing V1 is limited to US pickup to US delivery
  lanes. The UI may still show non-US road RFQs as suppressed context, but only
  `US_DOMESTIC` lanes can produce mock/manual rate options or draft quote
  economics. Unknown/generic locations such as country-only `USA` remain
  blocked until city/state/ZIP is explicit.
- Rationale: US domestic truckload/LTL rating, loadboards, and DAT/Truckstop
  style provider integrations are a different product surface from
  international road or multimodal forwarding. Mixing them destroys operator
  trust.
- Consequences: Future live-provider work should start with US-only adapters,
  US location normalization, provider credential status, approval state, and
  audit persistence. International trucking can be added as a separate market
  model later.
- Revisit when: there is a deliberate non-US road provider strategy with
  coverage, contract terms, and lane-normalization rules.

### 2026-06-30 - Domestic trucking V1 is draft-only mock/manual pricing

- Status: accepted
- Owner: engineering
- Context: The approved domestic trucking wedge needs an instant pricing feel
  inside Derya, but the provider bridge and company-brain retrieval are not yet
  production integrations. Faking live quotes or letting the UI imply booking
  authority would create bad commercial risk.
- Decision: V1 exposes a domestic trucking rate workbench and RFQ-side panel
  using deterministic required-field checks, mock benchmark rates, manual-rate
  readiness, draft quote economics, approval warnings, and source-slugged
  brain-context placeholders. It does not store provider credentials, call live
  rate APIs, send customer emails, book capacity, tender to carriers, or bypass
  human approval.
- Rationale: Operators get fast missing-field diagnosis, normalized truckload
  request shape, provisional economics, and a visible bridge slot for future
  GBrain context without pretending the system has live provider truth.
- Consequences: Future provider work must extend the `DomesticRateProvider`
  boundary and keep `officeId`, provenance, credential status, and approval
  semantics explicit.
- Revisit when: provider sandbox credentials, persisted audit logs, and
  source-backed GBrain retrieval are ready for an operator-reviewed pilot.

### 2026-06-30 - RFQ-to-load conversion is reviewed and starts as inquiry

- Status: accepted
- Owner: engineering
- Context: Inbound customer emails can be complete RFQs, partial RFQs, or terse
  follow-ups where existing customers expect unchanged details to be inferred
  from previous loads. Blindly promoting an email RFQ risks hiding old
  assumptions as new facts.
- Decision: Inbox/RFQ conversion creates an editable review draft first.
  Current RFQ/email fields win. Missing operational details may be suggested
  from recent same-customer prior loads, but those fields remain visible,
  editable, and marked as prior-load context. Prior target prices are not
  silently carried forward. Confirmed loads start as `INQUIRY`.
- Rationale: Operators need one click into a useful draft, not a magical
  mutation that corrupts commercial truth. Separating load tracking from RFQ
  maturity lets Derya capture work early while keeping quoting and forwarder
  handoff gated by explicit facts.
- Consequences: Future RFQ conversion buttons should use the reviewed draft
  service, preserve source-by-field provenance, and avoid setting jobs directly
  to quoted/priced stages.
- Revisit when: reviewed examples are available to improve prior-load
  suggestion ranking with evaluated deterministic heuristics or AI assistance.

### 2026-06-30 - Treat rfq@usederya.com as a deterministic RFQ source

- Status: accepted
- Owner: engineering
- Context: Most inbound load requests are expected to arrive from or through
  `rfq@usederya.com`. Relying only on generic AI classification makes same-day
  RFQs too easy to bury under calendar, founder, and operational noise.
- Decision: `rfq@usederya.com` is the default configured RFQ source sender.
  Inbound messages from configured RFQ source senders are treated as `RFQ`
  before LLM classification, count as load/RFQ-related in Inbox filters, and
  bias auto-link/create away from skipping the thread. The list can be extended
  with `DERYA_RFQ_SOURCE_EMAILS`.
- Rationale: This is a strong deterministic production signal, not a style
  preference. The app should use the address structure the business controls
  before asking an LLM to infer intent.
- Consequences: If `rfq@usederya.com` starts receiving non-RFQ mail, route it
  somewhere else or remove it from `DERYA_RFQ_SOURCE_EMAILS`; otherwise that
  noise will intentionally surface as RFQ work.
- Revisit when: there is a richer inbound routing system with per-alias rules,
  Gmail labels, or mailbox-specific ingestion policies.

### 2026-06-29 - Sync Gmail recently every hour and backfill history by windows

- Status: accepted
- Owner: engineering
- Context: The native Derya Gmail inboxes are operational sources, not passive
  archives. A single `newer_than:365d` scan capped by thread count can miss
  older messages in busy inboxes, and daily refresh is too stale for load/RFQ
  operations.
- Decision: Keep hourly Gmail refresh focused on recent mail, and recover
  historical mail through queued monthly `GMAIL_SYNC_WINDOW` background jobs.
  Manual sync enqueues those backfill windows. Now that production runs on
  Vercel Pro, Vercel cron is the single hourly scheduler for Gmail refresh and
  background-job draining.
- Rationale: Recent mail must arrive predictably without forcing every sync to
  walk years of Gmail history. Monthly windows avoid the newest-page-only
  failure mode and give older mail a deterministic path into Derya without
  blocking the settings page on one giant request.
- Consequences: Historical backfill is progressive; counts may climb over
  several background-job runs after manual sync. Do not also run the old GitHub
  Actions hourly workflow, or production will double-hit the sync endpoints.
  Backfill messages remain separated by `EmailAccount` and still use existing
  tenant-scoped dedupe and classifier/linking flows.
- Revisit when: Gmail push notifications, Pub/Sub history IDs, or a real worker
  queue replaces cron polling and DB-backed background jobs.

### 2026-06-28 - Treat Mert and Oguzhan Gmail as native load/RFQ inboxes

- Status: accepted
- Owner: engineering
- Context: Operators need to see load/RFQ-related mail from both
  `mert@usederya.com` and `oguzhan@usederya.com` in the app without relying on
  an external Company Brain review queue or manual Gmail searching.
- Decision: Model the Derya Gmail addresses as expected native inboxes, default
  to `mert@usederya.com` and `oguzhan@usederya.com`, allow production to extend
  that required list with `DERYA_LOAD_RFQ_INBOXES`, keep account OAuth/token
  storage in existing `EmailAccount` rows, and derive `load/*` workflow labels
  from classifier and job/RFQ link state instead of adding a new email-label
  schema.
- Rationale: The existing inbox, sync, memory, and thread promotion pipeline is
  already tenant-scoped and provenance-aware. A derived label layer gives the
  operator the Company Brain-style triage language without duplicating data or
  mutating Google labels.
- Consequences: Missing/paused configured Derya inboxes are visible setup
  problems; synced mail remains separated by account; `load/rfq`,
  `load/customer`, `load/forwarder`, `load/note`, `load/linked`, and
  `load/related` labels are Derya workflow labels, not Gmail label mutations.
- Revisit when: operators need label review/apply state, manual overrides, or
  two-way Gmail label synchronization.

### 2026-06-23 - Layer Derya Brain Ops on existing Knowledge memory

- Status: accepted
- Owner: engineering
- Context: The requested Brain Ops work overlaps with the existing
  company-brain substrate (`KnowledgeSource`, `KnowledgeObject`,
  `KnowledgeChunk`, `MemoryEvent`, and `AgentProposal`). Adding a second
  `BrainSource`/`BrainDocument` schema would create duplicated truth and more
  places for agents to hallucinate from.
- Decision: Implement Brain Ops as Codex-native docs, skills, safety rails,
  docs freshness checks, and a controlled ingest/query service on top of the
  existing memory schema.
- Rationale: This preserves tenant scoping and provenance while making the repo
  more agent-legible. Calibration ingest creates reviewable proposals instead
  of silently writing customer truth.
- Consequences: Future UI/API review work should consume `AgentProposal` rows
  created by `src/lib/brain-ops/ingest.ts`. Exact-match entity linking remains
  the rule; fuzzy merges remain forbidden.
- Revisit when: proposal review/apply UI needs first-class workflow state that
  cannot be represented cleanly in `AgentProposal`.

### 2026-06-23 - Cut production over with a fresh database and cherry-pick import

- Status: accepted
- Owner: engineering
- Context: The company-brain and market-intelligence release expects the
  current Prisma schema. Preview runtime failures showed what happens when new
  code points at an older database schema. Migrating the old production
  database in place would also carry old sessions, OAuth tokens, portal tokens,
  background jobs, memory rows, and bad market-intelligence audit residue into
  the new release.
- Decision: Production cutover will use a fresh current-schema Neon production
  database, create a new real Office/Admin, and import only selected business
  records from the old database through controlled export/import scripts.
  OAuth tokens, sessions, password hashes, old portal tokens, background jobs,
  company-brain memory rows, market-intelligence rows, and AI proposal noise
  will not be copied.
- Rationale: This keeps the production launch clean, auditable, and reversible
  at the data-selection layer. It also prevents legacy integration secrets or
  bad external-intelligence residue from becoming production truth.
- Consequences: Users must reconnect Gmail after cutover. Portal links must be
  regenerated. Historical memory/market intelligence can be rebuilt after
  launch if needed. The import should be reviewed through dry run and
  validation before main is merged.
- Revisit when: production has enough clean post-cutover data to justify a
  separate memory backfill or a carefully scoped historical email import.

### 2026-06-22 - Add pre-brain Prisma baseline for deployable migration history

- Status: accepted
- Owner: engineering
- Context: Phase 1-H2 added additive company-brain and market-intelligence
  migrations, but those migrations assume the original freight CRM tables such
  as `Office`, `Company`, `Job`, `Inquiry`, and `EmailThread` already exist.
  A fresh staging database cannot run `prisma migrate deploy` unless that
  pre-brain schema exists in migration history.
- Decision: Add `00000000000000_baseline_pre_brain`, generated from
  `9727e55:prisma/schema.prisma`, as the baseline migration for the original
  freight CRM schema. Fresh staging databases run the baseline plus additive
  migrations through `prisma migrate deploy`. Existing production databases
  that already contain the pre-brain schema should mark only the baseline as
  applied with `prisma migrate resolve --applied
  00000000000000_baseline_pre_brain`, then run `prisma migrate deploy` for the
  additive migrations.
- Rationale: The release needs one migration history that works for both fresh
  staging and existing production. `db push`, `migrate dev`, and reset commands
  are not acceptable deployment tools.
- Consequences: Production rollout must include a baseline verification step
  before stamping the baseline. Code rollback does not roll back schema, so
  migrations must stay additive and forward-compatible.
- Revisit when: production already has complete Prisma migration history from
  an earlier release, or the schema baseline commit changes.

### 2026-06-22 - Gate scraped pages before market signal extraction

- Status: accepted
- Owner: engineering
- Context: The first live Firecrawl pilot against Port of Long Beach stored a
  listing/navigation page and treated page chrome/social links as freight
  intelligence. The architecture contained the blast radius through
  `MarketImpactReview` and feedback, but Morning Brief still surfaced the bad
  raw signal.
- Decision: Source/page hygiene gates market signal extraction. Derya may store
  raw research for audit, but only article-like, evidence-backed,
  quality-scored content can create `MarketSignal` rows. Poor-quality,
  dismissed, wrong-link-heavy, irrelevant, index, or navigation-derived signals
  are suppressed from Morning Brief and strategy context.
- Rationale: External intelligence is useful only when it is operationally
  interpretable and source-backed. A crawler can fetch garbage; the company
  brain must not convert garbage into recommended work.
- Consequences: Listing pages can remain visible in Research Feed, but they do
  not produce signal links or impact reviews. Suppressed signals remain
  auditable in `/dashboard/intelligence`; operators can still see what happened
  without having the bad signal influence pricing, strategy, risk, or morning
  recommendations.
- Revisit when: enough source-quality feedback exists to tune thresholds per
  source category or replace deterministic gates with evaluated extraction
  models.

### 2026-06-22 - Harden autonomy prerequisites before live intelligence expansion

- Status: accepted
- Owner: engineering
- Context: Phase 2E made live market intelligence technically possible, but the
  system still had production hazards: plaintext Gmail OAuth token storage, a
  public portal fallback from token to `job.id`, raw quote PDF HTML
  interpolation, noisy tenant-scope audit output, and live Firecrawl controls
  that needed a clearer operator safety switch.
- Decision: Before expanding autonomy or live external ingestion, harden
  secrets, public access, HTML output, tenant-scope checks, Firecrawl domain
  controls, cron gating, and live-pilot runbooks. External intelligence remains
  advisory and must not overwrite operational truth.
- Rationale: A company brain that can retrieve more context is only useful if
  operators can trust its provenance and access boundaries. Live ingestion and
  agent autonomy multiply mistakes; boring controls have to come first.
- Consequences: Gmail OAuth writes require `TOKEN_ENCRYPTION_KEY`, portal access
  requires real random portal tokens, quote PDF output is escaped, broad
  Firecrawl search is blocked, live ingestion needs explicit enablement, and
  hardening tests are part of the verification path.
- Revisit when: production secrets, source enablement, and live pilot telemetry
  are stable enough to discuss broader autonomy.

### 2026-06-22 - Rank market sources with deterministic trust and feedback before LLM ranking

- Status: accepted
- Owner: engineering
- Context: Phase 2E activates Firecrawl-backed market intelligence as a
  controlled daily system. Source ranking now affects Research Inbox, Morning
  Brief, and agent-visible market context.
- Decision: Use deterministic source quality ranking from configured trust
  level plus operator feedback/review outcomes before any LLM ranking. Official,
  regulatory, carrier, and port sources outrank freight media by default.
  External intelligence remains advisory.
- Rationale: Operators need auditable reasons for why a signal is prominent.
  Trust level, useful feedback, actioned reviews, wrong links, irrelevant
  feedback, duplicates, stale signals, zero-link signals, and failed runs are
  inspectable. LLM ranking would hide too much judgment too early.
- Consequences: Source quality can prioritize research, signals, reviews, and
  morning brief items, but it cannot mutate jobs, RFQs, quotes, prices,
  milestones, customer records, or messages. Media/context sources can still be
  useful, but require stronger review before operational influence.
- Revisit when: there is enough labeled feedback to evaluate LLM-assisted
  ranking against deterministic baselines.

### 2026-06-22 - Treat Firecrawl as a constrained fetch provider

- Status: accepted
- Owner: engineering
- Context: Phase 2D adds web intelligence ingestion for freight/logistics
  sources. A generic web crawler can easily become a noisy, unsafe, and
  unreviewable "news brain" if it is not bounded.
- Decision: Use Firecrawl only behind registry-backed source definitions,
  domain allow-lists, run limits, provenance, and `MarketIngestionRun`
  observability. Store fetched pages as `KnowledgeObject`/`KnowledgeChunk`, then
  interpret them through `MarketSignal` and `MarketImpactReview`.
- Rationale: Derya needs source-backed operational intelligence, not generic web
  scraping. Keeping Firecrawl as an adapter preserves evidence and lets humans
  review impact before anything touches pricing, jobs, customer promises, or
  outbound communication.
- Consequences: No broad crawls, no paywall/login scraping, no live-internet
  tests, and no secret logging. The Research Inbox is a review surface, not a
  separate news product.
- Revisit when: source quality metrics show enough useful feedback to justify
  scheduled ingestion, source scoring, or stricter automated prioritization.

### 2026-06-22 - Store external intelligence as MarketSignals, not just articles

- Status: accepted
- Owner: engineering
- Context: Phase 2B needs external freight/logistics intelligence to help with
  pricing, route choice, risk, strategy, morning brief, and agent answers.
  Storing articles alone would make the company brain a passive news archive.
- Decision: Store raw source updates as `KnowledgeObject`/`KnowledgeChunk`, then
  store operational interpretations as `MarketSignal` rows linked to affected
  RFQs, jobs, companies, and lanes through `MarketSignalLink`.
- Rationale: Operators do not need "more news"; they need to know which active
  customer work may be affected and what action to take. Separating raw source
  records from operational signals keeps provenance intact while giving agents a
  structured, auditable decision surface.
- Consequences: Signal extraction and linking must be conservative and
  evidence-backed. Market signals can influence morning brief, agent context,
  strategy, and risk, but they must not overwrite operational truth or mutate
  quotes/jobs/customer commitments by themselves.
- Revisit when: lane normalization, source review, and scheduled ingestion are
  mature enough to support higher-confidence automated ranking.

### 2026-06-22 - Use MarketImpactReview as the human-review bridge

- Status: accepted
- Owner: engineering
- Context: `MarketSignalLink` means "possibly affected." That is useful but
  noisy if operators cannot review, dismiss, action, or correct links.
- Decision: Keep `MarketSignal` and `MarketSignalLink` as source/evidence
  records, and add `MarketImpactReview` plus `MarketSignalFeedback` as the
  operator review and feedback loop.
- Rationale: This creates actionable work without letting external intelligence
  mutate freight truth. Feedback also becomes training/evaluation data for
  future matching, source scoring, and autonomy.
- Consequences: Agents may update review/feedback status only. Jobs, RFQs,
  quotes, prices, milestones, customer records, and outbound messages remain
  controlled by existing workflows and human approval.
- Revisit when: review feedback volume is large enough to improve source
  scoring, lane matching, or automatic prioritization.

### 2026-06-23 - Use existing public map data and validated freight geography

- Status: accepted
- Owner: engineering
- Context: The production Intelligence page rendered a handmade stylized world
  map and then overlaid market intelligence on top. That looked authoritative
  while being geographically weak. A CBP scrape also produced pseudo-lanes such
  as `Countdown -> America` and `Welcome -> U.S. Customs and Border`.
- Decision: Use Natural Earth public-domain world land data as the offline map
  base and require all market lane/entity rendering to pass deterministic
  freight-location validation. CBP/regulatory updates are modeled as
  country/customs/compliance context unless clean body evidence contains a known
  origin/destination pair.
- Rationale: The map is a trust surface. Fake geography and fake lanes are worse
  than no map. Existing public map data gives recognizable geography without a
  runtime map dependency, and strict lane validation prevents page chrome from
  becoming operational advice.
- Consequences: Unknown or boilerplate location phrases are rejected or shown as
  suppressed audit data. Operators may need to extend the known-location
  registry as new lanes/ports become relevant. External intelligence remains
  advisory and cannot mutate freight records.
- Revisit when: Derya needs a richer lane graph, port hierarchy, geospatial
  clustering, or a proper offline vector-map renderer.

### 2026-06-23 - Keep map reference geography visible even without signals

- Status: accepted
- Owner: engineering
- Context: The Intelligence page must remain understandable before a market
  source has produced many clean signals. A technically correct map base is not
  enough if the user cannot quickly identify continents, ports, and chokepoints.
- Decision: Render fixed reference geography on top of the Natural Earth base:
  continent labels, key freight ports, and chokepoints. Keep evidence IDs
  available but collapsed so operational text stays readable.
- Rationale: Operators need a fast freight mental model. Reference labels make
  the map legible and prevent signal dots from floating on an ambiguous dark
  canvas.
- Consequences: The reference layer is deterministic and static for now. It
  should be expanded carefully as new lanes matter, not generated from noisy web
  text.
- Revisit when: the registry grows large enough to need zoom, clustering, or a
  dedicated geospatial renderer.

### 2026-06-28 - Render workbench route maps from one Mercator viewport

- Status: accepted
- Owner: engineering
- Context: The focused workbench route map originally mixed a static
  OpenStreetMap world-tile background, separately projected route markers, and
  unrelated zoom panel tiles. That made plausible-looking but geographically
  wrong route views.
- Decision: Route maps in the workbench use `src/lib/route-map-viewport.ts` as
  the single source for tile selection, marker projection, route SVG paths, and
  zoom-panel route sections. Origin/destination details stay in the compact
  summary above the map instead of being duplicated as floating map cards.
- Rationale: A freight route map is a trust surface. If the map tiles and
  overlay geometry do not share the same projection, the UI can confidently show
  the wrong route. Keeping the math in a pure helper also lets tests guard the
  behavior without needing a browser.
- Consequences: Future map changes should extend the route viewport helper or
  replace it with a real map renderer/provider. Do not reintroduce independent
  static background maps, decorative tile grids, or zoom panels that do not
  draw the same route segment.
- Revisit when: Derya needs live geocoding, selectable alternative routes,
  carrier schedules, AIS-style tracking, or a production map provider/cached
  tile strategy.

### 2026-07-03 - /dashboard/crm is the only CRM surface

- Status: accepted
- Owner: engineering
- Context: The Internal CRM V1 shipped alongside the legacy
  `/dashboard/customers` workspace and `/dashboard/pipeline` kanban, giving two
  divergent UIs over the same `Company` rows and three unsynced lifecycle
  fields (`Company.status`, `Company.crmStage`, `CrmOpportunity.stage`).
- Decision: Delete the legacy customers and pipeline UI code, repoint every
  link to `/dashboard/crm`, add temporary redirects, and treat `crmStage` as
  the canonical company lifecycle. Legacy DB columns and data stay untouched.
  Documents, owner management, and the inbox-approval toggle were ported into
  the CRM company/person pages; quotes UI, saved views, bulk status, and the
  class1/class2 taxonomy editors were dropped.
- Rationale: Two account surfaces drift immediately and corrupt trust in both.
  The founder decided the old CRM code and even its data are expendable; the
  future surface is the Relationship OS.
- Consequences: `CustomerStatus` remains in the schema for old rows and the
  companies CSV export but has no editing surface. New CRM writes still set
  `status: "UNTOUCHED"` for compatibility.
- Revisit when: reports/search are modernized to read `crmStage`, or the
  `status` column is formally dropped.

### 2026-07-03 - Emails resolve to CRM touches automatically

- Status: accepted
- Owner: engineering
- Context: `lastTouchAt` was only written by manual CRM notes, so the stale
  relationships panel flagged accounts the office emails daily, and email
  history never appeared in CRM timelines.
- Decision: Every synced inbound/outbound Gmail message is resolved to a CRM
  company/contact (contact email match, then inquiry link, then job link, then
  company domain; freemail domains excluded), logged as an EMAIL `Activity`
  with `sourceRefs`/`provenance`, cached on `EmailThread.companyId/contactId`,
  and bumps `Company.lastTouchAt`/`Contact.lastTouchAt` forward-only.
  `Inquiry.companyId` is adopted only on strong (contact-email) matches.
  A batched backfill script (`npm run backfill:crm-email`) covers history.
- Rationale: The Relationship OS's core promise (staleness, next actions)
  is only trustworthy if touches reflect reality, not manual note discipline.
- Consequences: Additive migration `20260703010000_email_crm_touch` must be
  applied before deploying this code. Touch logging is wrapped so Gmail
  sync/send never fail because of CRM writes.
- Revisit when: WhatsApp or meeting sources should write touches, or domain
  matching needs a review queue for false positives.

### 2026-07-03 - CRM serves two explicit layers: office book and founder network

- Status: accepted
- Owner: engineering
- Context: Docs conflicted on whether the CRM is a sales sub-module or a
  founder relationship OS. The founder wants both: the AI-native freight
  office's customer book and the startup's investor/advisor/partner network.
- Decision: Keep one `Company` table and derive a layer from `crmCategory`
  (customer/prospect/carrier/broker/customs_broker/freight_backend = office
  book; partner/vendor/investor/advisor/software_provider/other = network).
  Companies, people, and opportunities views get layer chips; the command
  center links both views.
- Rationale: One data spine, two lenses. Splitting tables would fork every
  timeline/task/opportunity feature for no benefit at this scale.
- Consequences: A relationship that is both vendor and customer still needs a
  category call; `crmTags` can carry the nuance until categories become
  multi-valued.
- Revisit when: either layer needs different fields, permissions, or agents.

### 2026-07-03 - CRM agent suggestions persist dismissals as AgentProposal rows

- Status: accepted
- Owner: engineering
- Context: The command center's heuristic agent suggestions had no accept or
  dismiss loop and no audit trail, while the rest of the app already audits
  agent actions through `AgentProposal`.
- Decision: Suggestions stay derived-on-read, but dismissing one writes an
  `AgentProposal` row (kind `CRM_SUGGESTION`, status `DISCARDED`) that the
  command center filters against for 30 days. RFQ-created opportunities now
  populate `sourceRefs` (`rfq:` and `email_thread:` refs) so Brain Context
  panels render linked sources.
- Rationale: Reuses the existing approval/audit primitive instead of a
  parallel store, without write-on-read bloat from persisting every render.
- Consequences: Full agent-generated proposals (create/apply CRM mutations via
  the dispatcher) remain the documented next slice.
- Revisit when: an agent starts proposing CRM mutations rather than
  navigational suggestions.

### 2026-07-04 - Sign-in is email-code only, allowlisted to the founders

- Status: accepted
- Owner: engineering
- Context: The app is an internal tool for the two founders, but login was
  open email+password for any provisioned user (demo offices, pentest
  sandbox), and there was no Google sign-in.
- Decision: Sign-in sends a 6-digit single-use code (10 min TTL, 5 verify
  attempts, 3 requests/15 min) to the entered email via the office's
  connected Gmail, and every sign-in path (code, password fallback, signup
  helper) rejects emails outside the allowlist - default
  mert@usederya.com + oguzhan@usederya.com, overridable via
  LOGIN_ALLOWED_EMAILS. A password fallback stays behind a collapsed
  disclosure as break-glass for Gmail-send outages, allowlist-gated the same
  way. Codes are HMAC-hashed with AUTH_SECRET in a new LoginCode table
  (additive migration 20260704000100_login_email_codes) and never create
  inbox threads or CRM touches.
- Rationale: Internal-only by construction beats internal-only by policy;
  emailed codes remove password management for a two-person team.
- Consequences: Demo-office users, the sinan office, and the pentest sandbox
  account can no longer sign in anywhere. Google SSO remains unimplemented;
  Gmail OAuth stays mailbox-connection-only.
- Revisit when: the team grows past the allowlist, real SSO is wanted, or
  the pentest sandbox needs login again (add it via LOGIN_ALLOWED_EMAILS -
  note its .invalid domain cannot receive codes, so it would need the
  password fallback).

### 2026-07-16 - Carrier bench is a first-class operational entity

- Status: accepted
- Owner: engineering
- Context: The CA tech-freight niche (high-value, security-sensitive loads
  for hardware companies) is the US wedge, and its core moat asset is a
  hand-vetted carrier bench. Carriers were previously only representable as
  `Forwarder` rows (intl supplier email directory) or CRM Companies -
  neither carries MC/DOT, insurance limits, equipment capability, or fraud
  checks.
- Decision: New `Carrier` + `CarrierChecklistItem` models
  (migration `20260716000100_carrier_bench`) hold the vetted bench:
  deceptive-pickup defenses (verified callback phone, expected email domain,
  factoring, authority age), insurance limits/expiries with `nextReviewAt`,
  capability flags, and reserved scorecard columns. `vettingStatus` can only
  reach `approved` through the deterministic `carrierVettingGate()` over the
  checklist (`src/lib/carrier-vetting.ts`); the COI check requires
  producer-direct verification, never a carrier-supplied attachment.
  Carriers are separate from `Forwarder` and from CRM Companies (optional
  `companyId` link, never auto-created). UI at `/dashboard/carriers`.
- Rationale: In a deceptive-pickup fraud wave, the vetting process is the
  product; encoding it as data + a gate makes it consistent and auditable.
- Consequences: Scorecards are manual columns until the flywheel computes
  them from load history. FMCSA/RMIS API verification stays manual-with-
  evidence-URL in V1.
- Revisit when: bid volume justifies Highway/RMIS-style API vetting, or
  carriers need portal access.

### 2026-07-16 - Truckload quotes, bids, and outcomes persist (the flywheel)

- Status: accepted
- Owner: engineering
- Context: The 2026-06-30 "draft-only mock/manual pricing" decision and the
  2026-07-01 "RFQ Brain Context is read-only" no-persistence clause predate
  the niche strategy, whose data moat requires every quote, buy rate, and
  win/loss to accrue.
- Decision: New `CarrierBid` (buy side, per-load $) and `TruckloadQuote`
  (sell side + outcome, normalized lane states, economics, quote-speed
  stamps) persist office-scoped (migration `20260716000300_truckload_quotes`).
  RFQ status changes settle outcomes (BOOKED=>WON, MISSED=>LOST) as
  best-effort hooks that never block sheet edits. Buy rates also accrue
  `LaneRate` history under domestic mode strings (FTL/LTL/PARTIAL/DRAYAGE),
  deliberately distinct from intl `ROAD` so intl lane matching never
  cross-contaminates. `CarrierQuote` stays ocean-shaped for the intl stack;
  the dormant `Quote` model stays untouched. This partially supersedes the
  two decisions above: persistence exists now, but live rate providers,
  booking/tender, and customer sends remain out - those still require the
  env-gated provider adapter + `DomesticRateAudit` slice.
- Rationale: A niche this narrow makes small data dense - 6-12 months of
  outcomes on CA tech corridors out-prices anyone without the book.
- Consequences: Quote rows are versions (one per Record press); outcome
  reasons are operator-set on lost quotes. Reports/lane-index aggregation is
  a later slice.
- Revisit when: DAT RateView (or equivalent) credentials land - add the
  provider adapter behind `DomesticRateProvider` with audit persistence.

### 2026-07-16 - Security tiers + SOP checklists gate high-value tech loads

- Status: accepted
- Owner: engineering
- Context: CA is the national cargo-theft epicenter and electronics the top
  target; the niche sells security as the wedge. Loads had no notion of
  declared value, security handling, or first-class truck equipment.
- Decision: `Inquiry`+`Job` carry declaredValue(+currency), securityTier,
  commodityCategory (tech taxonomy incl. UN3480/3481 batteries),
  trackingType, equipmentType, teamDriversRequired (migration
  `20260716000200_high_value_security_fields`). `deriveSecurityTier()`
  (value ladder x category floor, deterministic) writes a visible,
  overridable suggestion - operator choice always wins. Tiered loads seed
  `LoadSecurityCheck` rows from `securityChecklistTemplate(tier)`
  (anti-deceptive-pickup playbook; standard tier seeds nothing). The
  domestic pricing engine prefers first-class equipment over
  containerType/parsedData guesses and returns `needs_human_review` for
  high_value/critical tiers - they never auto-rate. Prior-load carry
  includes equipment/tier but never declaredValue (same principle as target
  price).
- Rationale: SOP-as-checklist makes small-team execution consistent and is
  the artifact a customer-facing security one-pager renders from later.
- Consequences: The portal rendering, rate-con clauses, and COI-per-load
  artifacts are Phase 2. Checklist rows are never auto-deleted on tier
  downgrade. Completed checks stay part of the record.
- Revisit when: the portal one-pager ships or an insurer requires a
  different checklist shape.

### 2026-07-21 - Intel is an isolated decision layer with typed provenance

- Status: accepted
- Owner: engineering
- Context: Shipment pre-flight and public market data previously lived in
  generic library and component paths, while the company-brain market-signal
  ingestion stack already owned a different persistence and retrieval job.
  Mixing them would make source attribution, extraction, and tenant behavior
  harder to audit.
- Decision: Canonical decision logic, parsers, fetchers, source definitions,
  and public-data UI live under `src/lib/intel/` and
  `src/app/dashboard/intel/`. Outside code uses the client-safe
  `@/lib/intel` entrypoint or the build-enforced server-only
  `@/lib/intel/server` entrypoint. Old library and component paths are
  one-way compatibility shims. `/dashboard/intelligence` and
  `src/lib/market-intelligence/` remain a separate company-brain ingestion
  surface.
- Rationale: Intel answers need deterministic rules and an exact source set,
  while company-brain ingestion needs office-scoped durable memory and review
  workflows. A narrow typed boundary lets either system evolve or be extracted
  without silently importing the other's persistence model.
- Consequences: Live facts carry a data date plus cache-stable fetch time.
  Human-reviewed authority pages carry a separate review time and are never
  labeled as cached data. Citation URLs must use a registered HTTPS host and
  must not contain credentials or secret parameters. Reports persist the exact
  source snapshot and a plain-text source footer. The engine rejects any new
  finding without a registered source. Existing calendar and equipment checks
  remain behaviorally present, but their copy distinguishes public evidence
  from conservative Intel policy and links to claim-specific CargoNet, FBI,
  manufacturer, carrier, or National Weather Service material.
- Revisit when: Phase B adds `AnswerDocument`, the intent router, and the
  standalone customs, carrier, and lane resolvers.

### 2026-07-22 - Market research renders as a cited report, not a shipment check

- Status: accepted
- Owner: engineering
- Context: A broad hardware-import question was being parsed as if it described
  one shipment. That produced an irrelevant missing-field checklist and mixed
  all-mode gateway value, company-level manifest examples, and requested
  historical coverage into one weak answer.
- Decision: Research questions render from a serializable `AnswerDocument` and
  a fixed report hierarchy. The primary `/dashboard/intel` report keeps
  California destination volume separate from West Coast customs gateways,
  vessel separate from air, requested periods separate from loaded periods,
  and official aggregate data separate from manually observed company records.
  Shipment pre-flight remains available as a secondary workflow. Partial
  Census partitions are labeled as partial sums, failures are never treated as
  zero, and provider references never imply a live connection.
- Rationale: The operator needs to see the answer, its coverage, and its
  evidence state before seeing tools. This structure is easier to audit and
  prevents a polished UI from overstating incomplete data.
- Consequences: The v1 hardware basket is a declared 46-code proxy, not a claim
  to represent all startup hardware. The Census reader is bounded to two
  batches of five concurrent requests under the 60-second route limit.
  Company examples remain unqualified manual observations. Historical
  snapshots and licensed bill-of-lading coverage are explicit future unlocks.
- Revisit when: the general intent router can select report templates from any
  operator question, or a licensed provider sample passes identity, history,
  port, and commodity coverage checks.

### 2026-07-22 - Hardware import reporting uses keyless Census file snapshots

- Status: accepted
- Owner: engineering
- Context: Runtime Census API calls made a fixed five-year report depend on a
  secret key, request limits, and dozens of cold network partitions. Census
  also publishes keyless State Imports HS6 and Port Imports HS6 files that can
  be parsed once, validated, reviewed, and cited by exact file.
- Decision: The hardware-import report reads a versioned, checked-in compact
  JSON snapshot generated by
  `scripts/build-census-public-hardware-snapshot.ts`. The generator uses
  December year-to-date files for the five complete years and the latest
  available year-to-date file for the current year. It keeps California State
  Imports HS6, whose geography is state of ultimate destination, separate from
  Port Imports HS6 records for ports of unlading in West Coast districts 25,
  27, 28, 29, and 30. It preserves exact file provenance and does not write to
  tenant, CRM, job, RFQ, or company-brain records.
- Rationale: A reviewed static artifact makes the report deterministic,
  keyless at runtime, fast to render, and auditable down to each official
  source file. The two Census products answer different questions and must not
  be collapsed into a fake California market total.
- Consequences: Snapshot generation must validate fixed-width layouts,
  non-negative metrics, Schedule C country names, exact HS coverage, dimension
  reconciliation, source checksums, and secret-free source URLs before
  atomically replacing the artifact. The Schedule C file retains its own
  fetch time, revision, and SHA-256. Raw ZIPs stay in a temporary cache and are
  not committed. A warm cache preserves the original fetch time and is trusted
  only when content length, local SHA-256, and every upstream validator Census
  provides still match. The 2021 basket has 43
  applicable codes; the HS 2022 additions 8485, 8806, and 8807 bring later
  periods to 46. Full-basket 2021-to-2022 growth is not a like-for-like metric
  without a researched predecessor-code backcast. Official aggregates cannot
  establish company identity, startup status, shipment count, or lead quality.
  This supersedes only the API-partition and future-history clauses in the
  prior 2026-07-22 report decision; its fixed report hierarchy, evidence
  separation, and licensed-provider boundaries remain accepted.
- Revisit when: Census changes either file layout, Derya automates a reviewed
  monthly refresh, or a licensed company-level provider passes identity,
  history, port, commodity, and confidentiality coverage checks.

### 2026-07-23 - Corridor signals require joint Port HS6 dimensions

- Status: accepted
- Owner: engineering
- Context: Separate current totals by hardware category, country of origin,
  and West Coast gateway district could not establish which product from which
  origin used which gateway. Presenting those separate marginals as lane
  intelligence would create a polished but unsupported join.
- Decision: Census hardware snapshot schema v3 stores one current-period joint
  slice from the official Port Imports HS6 rows, keyed by startup-hardware
  category, country of origin, and port-of-unlading district. Only
  positive-vessel-value segments are retained. Vessel value, vessel weight,
  containerized vessel value, and containerized vessel weight must reconcile
  exactly to the current West Coast scope. The product calls these corridor
  signals, never port-to-port lanes.
- Rationale: Every joint dimension comes from the same official source row, so
  the result can prioritize research without a probabilistic or cross-dataset
  join. Keeping the slice current-only limits artifact growth and avoids
  inventing historical momentum that the report does not yet compare on a
  like-for-like YTD basis.
- Consequences: The May 2026 artifact contains 681 positive-value segments and
  stays below the 1.3 MB artifact budget. A segment can support an
  origin-product-gateway research queue. It cannot identify the foreign
  loading port, carrier, service, buyer, supplier, transit time, delay, freight
  rate, optimized route, or qualified lead. California destination totals
  remain separate and cannot be joined to these gateway segments.
- Revisit when: a licensed bill-of-lading sample supplies validated foreign
  loading ports, importer identity, carrier and service fields, timing, and
  commercial usage rights.

### 2026-07-23 - Origin watches are research briefs, not generic lane scores

- Status: accepted
- Owner: engineering
- Context: The all-origin hardware report could rank current aggregate
  segments, but it buried the requested China decision and implied that one
  generic corridor ranking could guide every hardware category. Power
  equipment, factory machinery, compute equipment, medical equipment, and
  drones show materially different observed gateway patterns.
- Decision: Origin-focused intelligence uses a deterministic corridor-watch
  contract built from the validated Census snapshot. The China watch is the
  first implementation. It keeps California ultimate destination separate from
  West Coast port-of-unlading districts, keeps current YTD separate from
  complete years, and produces category-specific research posture. A routing
  brief remains `research_only` until all required shipment, port, service,
  schedule, reliability, rate, handling, and company evidence is present.
- Rationale: An operator needs a bounded research queue and exact evidence
  gaps, not a polished but unsupported lane score. Category-specific
  concentration can prioritize which gateway alternatives to investigate
  without pretending that aggregate value proves feasibility, price, risk, or
  demand.
- Consequences: The product may say that the highest-value observed district in
  the current snapshot is a starting point for China hardware research. It
  derives that district on refresh and may not call it a recommended route,
  infer a foreign port, join it to California destination volume, score a lead,
  or explain a historical change causally. Company-level and port-pair
  enrichment must come from licensed shipment evidence, while schedules,
  services, rates, and transit reliability remain separate live inputs. The
  all-origin report stays available as supporting context and does not lead the
  workflow.
- Revisit when: a licensed bill-of-lading sample passes the provider gate, or
  live schedule and rate adapters can populate a shipment-specific route
  comparison with evidence and operator approval.

### 2026-07-23 - Long-run China history uses a fixed core43 basket

- Status: accepted
- Owner: engineering
- Context: The 46-code hardware proxy includes HS 8485, 8806, and 8807, which
  entered with the 2022 HS revision. Extending that exact basket before 2022
  would create a false like-for-like trend. Expanding the complete all-country
  snapshot to 2010 would also exceed the artifact budget and introduce
  historical Schedule C code problems unrelated to the China question.
- Decision: Preserve the full 46-code five-year and current-YTD snapshot for
  current market and category detail. Add one compact China-only vessel slice
  that applies the fixed 43 codes available across 2010-2026. Store every
  complete year from 2010 through 2025 and the current YTD period, with
  separate California ultimate-destination and West Coast port-of-unlading
  denominators, China marginals, category marginals, geography marginals,
  official files, and checksums.
- Rationale: A fixed basket supports a defensible long-run composition view
  without backcasting classifications, inflating the artifact, or pretending
  current categories existed under the same code structure in earlier years.
- Consequences: The report labels this series `fixed_core43`, displays nominal
  customs value and China share, and keeps the 46-code current YTD view
  separate. It does not adjust for inflation, infer causality, or apply the
  China-only slice to other origin watches. Snapshot generation fails if any
  core code, year, source, reconciliation, ordering rule, or byte limit fails.
  A December `asOfMonth` also fails explicitly until the current-period
  contract can represent a complete December file without recasting it as YTD.
- Revisit when: Derya needs an all-country long-run comparison and has a
  researched concordance for historical HS and Schedule C revisions.

### 2026-07-23 - Customs intelligence is a dated evidence workflow

- Status: accepted
- Owner: engineering
- Context: A list of customs links is not operational, but an aggregate Census
  category cannot support a duty, admissibility, or clearance conclusion.
  Current tariff actions, regulations, agency guidance, product triggers, and
  old CBP handbooks also use different date semantics and authority weight.
- Decision: Model China-to-U.S. customs work as eight deterministic gates with
  explicit missing inputs, quote effect, operator action, product triggers,
  and official authority references. Review sources in this order:
  controlling authority such as the HTS, statute, regulation, Federal Register
  notice, or enforceable order; applicable ruling or scope decision; current
  implementation guidance; then handbook context. Store rule as-of, source
  review, publication, effective start, effective end, document revision, and
  page modification, and exact boundary instants separately. Compute active,
  upcoming, expired, and historical state from the exact reviewed instant when
  a source publishes a timed cutoff; retain date-level evaluation when the
  authority provides only a date.
- Rationale: This makes the output usable for shipment evidence collection
  while preventing a recently modified webpage, an old handbook, or a
  four-digit research category from masquerading as current legal treatment.
- Consequences: The guide can block landed-cost or clearance promises and
  identify the next revalidation date. It cannot output an exact duty,
  compliance label, legal opinion, broker instruction, or clearance promise.
  UFLPA remains separate from Section 301. Product screens remain conditional
  on model-level facts and run across every hardware category so an aggregate
  category cannot suppress a feature-driven agency screen. Finished
  refrigerant-charged equipment remains separate from bulk refrigerant
  controls and its transport classification. Medical devices remain separate
  from radiation-emitting products, and regulatory branches for hazardous
  materials, vessel carriage, nuclear imports, and FIFRA devices remain
  explicit. A same-day USTR action can be added as an upcoming timed rule
  without rewriting historical Census observations or treating agency
  guidance as controlling law.
- Revisit when: Derya adds shipment-specific classification, ruling, broker,
  entry, or partner-government-agency evidence and can move an individual gate
  from research to reviewed execution.

### 2026-07-23 - Primary corridor evidence stays linear; supporting analysis is an appendix

- Status: accepted
- Owner: design and engineering
- Context: The China corridor report originally resumed numbered sections
  after a collapsed all-origin analysis, so the visible primary report appeared
  to skip a section. Its six-column annual evidence table also forced
  horizontal scanning on narrow screens and hid the geography of each source
  behind a bare source number.
- Decision: Keep the primary China report in sections 01 through 06. Label the
  supporting all-origin report Appendix A with A1 through A6. Group each
  historical year into three columns: year, West Coast value/share/source, and
  California value/share/source. Stack those geography cells on narrow
  screens and label their evidence links with `WC` or `CA`.
- Rationale: The visible sequence should match the operator's decision path.
  Exact values and sources must remain readable without horizontal panning or
  guessing which geography a citation supports.
- Consequences: The same underlying evidence and supporting report remain
  available. This changes report hierarchy and responsive presentation only;
  it does not alter data, source identity, or customs conclusions.
- Revisit when: the report adds another primary decision stage or the annual
  evidence needs a dedicated comparison view.

### 2026-07-24 - China shipment review uses a separate read-only evidence contract

- Status: accepted
- Owner: engineering
- Context: The existing `LoadIdea` contract and load pre-flight are designed
  for U.S. domestic trucking and can create a road RFQ. Reusing that shape for
  a China ocean import would collapse unknown customs facts into booleans,
  confuse trucking readiness with clearance, and risk writing an incorrect
  operational record.
- Decision: China to U.S. ocean shipment review uses a separate versioned
  input and assessment contract. V1 is authenticated but read-only, performs
  no database or provider write, preserves tri-state unknowns and field
  provenance, recomputes dated rules from the confirmed controlling customs
  event and exact timestamp, and accepts negative product screens only from
  operator-confirmed or document-backed facts. Non-ocean modes stay outside
  scope, and confirmed blockers may depend only on confirmed or documented
  facts.
- Rationale: A real shipment needs deterministic evidence gaps and source-local
  customs gates before it needs automation. Keeping the contract separate
  prevents domestic carrier logic, RFQ conversion, or AI extraction from
  pretending to establish origin, duty, admissibility, or clearance.
- Extraction boundary: a local fallback may read explicitly labeled facts
  when model extraction is absent or fails, but those values stay unconfirmed
  supplier statements and the fallback never infers a negative product screen.
- Consequences: Ready means structured for importer and broker review only.
  AI values require individual confirmation. The system may identify possible
  tariff timing, agency triggers, ISF timing gaps, and evidence requests, but
  it cannot calculate duty or issue a clearance conclusion. A future saved
  review must add explicit office scoping, audit history, and human approval
  rather than silently extending this nonpersistent V1.
- Revisit when: operators have tested several real loads and can define which
  confirmed fields, documents, broker responses, and review outcomes should be
  stored as office-scoped operational evidence.

### 2026-07-27 - Preserve legal time precision and authority context

- Status: accepted
- Owner: engineering
- Context: Some customs actions publish exact Eastern cutoff timestamps while
  other rules publish only an effective date. The previous freshness check
  considered only exact timestamps, so a date-only rule could take effect
  without invalidating an older snapshot. The load report also reduced
  authority records to links, hiding whether a citation was current,
  time-limited, upcoming, or historical.
- Decision: Store and display an exact instant only when the authority
  publishes one. Keep date-only boundaries as dates and include both precision
  levels in rules freshness. Keep each source's review timestamp independent
  from the overall guide snapshot. Carry every referenced authority's status,
  type, effective window, caveat, source, and report claim context into the
  read-only shipment assessment.
- Rationale: Invented timestamps create false cutoff certainty, while a bare
  link list makes historical handbooks look equivalent to current regulations.
  Precision and authority rank must survive from research data through the
  operator report.
- Consequences: A crossed date-only boundary can force revalidation. The UI
  labels date precision directly, distinguishes current, time-limited,
  upcoming, and historical sources, and names where each authority is used.
  The additional context does not calculate duty or establish shipment
  compliance.
- Revisit when: a provider supplies versioned filing-time HTS or agency
  instructions with trustworthy publication and effective timestamps.

### 2026-07-27 - China Intel extraction uses GPT-5.6 Structured Outputs

- Status: accepted
- Owner: engineering
- Context: The read-only China load review previously used a free-form
  Anthropic response followed by JSON substring parsing. The production
  environment already provides `OPENAI_API_KEY`, and shipment extraction needs
  a stricter output boundary than prompt-only JSON.
- Decision: Use the OpenAI Responses API with the `gpt-5.6` alias, medium
  reasoning, `store: false`, a 45-second timeout, one SDK retry, and Zod-backed
  Structured Outputs for the China hardware load extractor. Keep the local
  labeled parser when the key is absent or the model request fails. Continue
  to mark every model-derived fact as `ai_extracted` until an operator confirms
  it.
- Rationale: Structured Outputs removes the brittle JSON substring parser and
  constrains model output to the versioned shipment packet. GPT-5.6 improves
  extraction quality while deterministic code remains responsible for
  customs gates, temporal rules, missing evidence, and authority citations.
- Consequences: `OPENAI_API_KEY` now powers China Intel extraction. Existing
  Anthropic CRM paths remain unchanged. The model still cannot calculate duty,
  establish classification or origin, decide admissibility, promise clearance,
  persist the review, or trigger an operational write.
- Revisit when: representative real-load evaluations show that another
  GPT-5.6 tier or reasoning level achieves the same extraction quality at
  materially lower latency or cost.

### 2026-07-27 - GPT-5.6 is the single application reasoning model

- Status: accepted
- Owner: engineering
- Context: The application split reasoning work across direct Anthropic calls
  and a separate OpenAI China-load extractor. That duplicated provider
  configuration, request behavior, failure handling, and tool-call history.
  Production already supplies `OPENAI_API_KEY`.
- Decision: Route every active text reasoning, parsing, classification,
  drafting, document analysis, and agent function-tool path through the OpenAI
  Responses API with the `gpt-5.6` alias. Use one shared adapter with
  `store: false`, a 45-second timeout, one SDK retry, low reasoning for bounded
  single-turn work, and medium reasoning for function-tool loops. Remove the
  Anthropic SDK and `ANTHROPIC_API_KEY` runtime contract. Keep `whisper-1` only
  for audio transcription because speech-to-text is a specialized endpoint,
  not a GPT-5.6 reasoning call.
- Rationale: A single runtime contract makes model behavior, deployment,
  observability, and regression testing understandable. Keeping tool history
  conversion in one adapter preserves reasoning items, function call IDs, and
  office-scoped tool dispatch without rewriting domain actions.
- Consequences: `OPENAI_API_KEY` is now required for all AI-assisted product
  behavior. Deterministic fallbacks and approval boundaries remain in place.
  The China load extractor retains its stricter Zod Structured Outputs path.
  A static runtime test rejects Anthropic imports, Anthropic environment
  references, Claude model names, and unexpected model literals under `src`.
  This decision supersedes the provider split recorded in the earlier China
  extraction entry.
- Revisit when: production evaluations show a task-specific model improves
  measurable accuracy, latency, or cost enough to justify a documented
  exception.

### 2026-08-06 - Supply OS uses a scoped customer command-center language

- Status: accepted
- Owner: product and engineering
- Context: The first Supply OS prototype proved the workflow but looked like a
  generic dashboard. A customer-facing resilience product needs a clear
  operating picture, faster exception recognition, dense evidence, and an
  explicit boundary between modeled intelligence and connected live data.
- Decision: Keep the authenticated Supply OS inside the existing Derya shell,
  but give the workspace its own dark command-center design language. Make the
  real Natural Earth map, ranked exceptions, selected entity dossier, evidence,
  and recommended action the command surface. Reuse that state across network,
  supplier, procurement, execution, and authority views. Every surface must
  distinguish fictional or modeled records from connected feeds and external
  actions. Movement-scoped intelligence must fail closed: when an assessment,
  quote set, or approval does not belong to the selected movement, show its own
  fallback or an honest empty state instead of borrowing another record.
- Rationale: Kpler-style geospatial density and Windward-style anomaly dossiers
  support fast operational decisions, while Derya differentiates through the
  full supplier-to-execution workflow and explicit delegation policy. Scoping
  the visual language avoids destabilizing the internal application shell.
- Consequences: Supply OS may be visually denser and darker than the rest of
  the product. It still uses canonical geography, deterministic local state,
  no provider calls, no server actions, and no external writes in the current
  prototype. Tablet and mobile layouts must stack the operating surfaces rather
  than crop the desktop canvas.
- Revisit when: real office-scoped customer records and provider events are
  connected, or when customer testing shows that a specific data layer needs a
  different default hierarchy.

### 2026-08-06 - Public company research is evidence, not operating truth

- Status: accepted
- Owner: product and engineering
- Context: A useful one-minute customer demo cannot rely on the operator to
  manually restate every company fact, but a public website also does not prove
  actual suppliers, active lanes, customs treatment, freight rates, or current
  operational relationships.
- Decision: Start Supply OS case generation with one authenticated web-search
  research packet. Verify the official website against provider-attributed
  sources, retain source URLs on every supported claim, and extract bounded
  same-domain homepage metadata for the logo. Store the packet with the
  browser case. Treat likely inputs, source regions, and destinations as
  hypotheses with explicit uncertainty. Keep deterministic case logic and
  human approval responsible for route, customs, supplier, spend, and booking
  decisions. If research is unavailable, offer an explicit description-only
  fallback that does not claim public verification.
- Rationale: The customer should recognize their company immediately and see a
  credible supply-chain starting point, while Derya remains honest about the
  difference between public context and the records needed to run logistics.
  Provider-source filtering makes provenance auditable and limits fabricated
  citations. The bounded metadata fetch adds identity without creating a broad
  crawler or weakening the research trust boundary.
- Consequences: `OPENAI_API_KEY` powers company discovery. Research latency is
  part of new-case generation, research failures stay visible, and unsupported
  facts cannot silently graduate to confirmed workflow data. Cases remain
  browser-local until a later office-scoped persistence design is approved.
- Revisit when: production evaluation shows the public brief misses material
  company facts, or when office-scoped persistence and customer publishing need
  a versioned research refresh policy.

### 2026-08-07 - Company research degrades to verified official-site evidence

- Status: accepted
- Owner: product and engineering
- Context: The original company-research request failed closed when the model
  provider was unavailable and exposed no useful intermediate state. That made
  a customer demo look broken even when the operator supplied the official
  company website.
- Decision: Stream evidence-oriented research milestones to the generator. If
  public search cannot produce a valid attributable packet and the prompt has
  an explicit public website, review a maximum of four relevant pages on that
  verified domain and return a partial research packet. Extract only bounded
  official metadata, JSON-LD, product-page titles, and source links. Mark
  deterministic supply inputs and prompt-provided locations as inferred.
  Continue to offer a description-only plan when no website is available.
- Rationale: The demo should remain useful during a provider outage without
  pretending that a homepage proves a real supply chain. Visible milestones
  let the customer distinguish facts, assumptions, and blockers.
- Consequences: `OPENAI_API_KEY` remains the richer company-discovery path, but
  an explicit website is now sufficient for a partial sourced profile. The
  fallback remains subject to SSRF checks, same-domain limits, byte and page
  caps, timeouts, and human approval. It cannot confirm suppliers, lanes,
  rates, customs treatment, providers, or external actions.
- Revisit when: connected company systems provide authoritative facility,
  supplier, shipment, and customs records, or when measured fallback quality
  justifies a broader allow-listed source strategy.

### 2026-08-07 - Supply OS uses a lighter graphite customer surface

- Status: accepted
- Owner: product and design
- Context: Customer feedback found the command-center palette too close to
  black and the visual hierarchy too flat.
- Decision: Keep the scoped enterprise language but derive page and panel
  surfaces from a lighter neutral graphite scale. Use borders, spacing, and
  typography for hierarchy instead of highlights, gradients, or random colors.
- Rationale: The product should retain operational density without feeling
  oppressive or hiding controls in low-contrast surfaces.
- Consequences: The Supply OS remains visually distinct from the internal app,
  but its controls and evidence panels are easier to scan. Existing mobile,
  palette, and global-style isolation tests continue to guard the boundary.
- Revisit when: customer testing supports a full light theme or a shared
  application-wide token system.

### 2026-08-07 - Explicit company websites use official-site research first

- Status: superseded by "Company research must produce a dashboard before enrichment"
- Owner: product and engineering
- Context: Model-backed public search can exceed a request's available runtime.
  It also adds little value before reading a website the operator already gave
  us.
- Decision: When the prompt contains a valid public company website, run the
  bounded official-site research path first regardless of model configuration.
  Use model-backed public search first only for name-only prompts, or as a
  secondary path when the supplied official site cannot be reached. Bound the
  model call to 20 seconds without automatic SDK retries.
- Rationale: Customer demos need a fast terminal result. Official-site evidence
  is more attributable than a broad search and does not depend on model latency.
- Consequences: Explicit-website briefs omit third-party public sources in the
  first pass and disclose that limitation. Name-only discovery remains richer
  but can return a structured timeout recovery message.
- Revisit when: research runs asynchronously with durable office-scoped results,
  where broader enrichment no longer blocks the customer request.

### 2026-08-07 - Company research must produce a dashboard before enrichment

- Status: accepted
- Owner: product and engineering
- Context: The explicit-website path was fast and bounded, but name-only
  research still depended on one provider request. A runtime cutoff could leave
  a customer with progress text and no terminal result. The same planning
  bridge also overloaded `Sources` with both materials and geography, which
  could turn a material into a false route origin.
- Decision: Make the first useful dashboard independent of model-backed public
  search. For a name-only input, derive a small set of likely public domains,
  verify company identity against official metadata and page content, reject
  parked or mismatched sites, and select the strongest official candidate.
  Run broader public search only as bounded secondary enrichment. If every
  research path stops, automatically save a draft from the user's input. Keep
  materials in `Needs` and route origins in `Sources`; never draw a lane until
  a real endpoint is known.
- Supersedes: `Explicit company websites use official-site research first`.
- Rationale: A customer demo must always end in a useful artifact. Official
  evidence is fast, attributable, and sufficient for a first company picture.
  Optional enrichment can improve that picture but cannot be a prerequisite.
  Separating objects from places prevents polished but false maps.
- Consequences: Ambiguous names may resolve only to a description-based draft
  and ask for the official website. Domain discovery remains bounded by the
  existing public-DNS, redirect, content-type, byte, page, and timeout controls.
  Suppliers, lanes, customs treatment, rates, providers, and external actions
  remain unconfirmed until connected evidence and human approval exist.
- Revisit when: office-scoped asynchronous research can persist partial results
  across requests, or a connected company-data provider can resolve ambiguous
  legal entities without weakening provenance.

### 2026-08-07 - Supply OS leads with an inferred network and ranked changes

- Status: accepted
- Owner: product, design, and engineering
- Context: The previous customer page exposed broad planning categories and a
  route map, but it did not make a useful best-effort model of the customer's
  supplier network, processing site, buyer profile, or first operational
  improvement. Generic cards also made the product look assembled rather than
  designed around a supply-chain decision.
- Decision: Build a deterministic company-profile model that maps supplier
  clusters, the operating site, customer clusters, likely cargo, movement
  modes, confidence, and the next fact to confirm. Keep official evidence,
  third-party public evidence, customer input, and inference as separate basis
  values. Endpoint evidence does not prove a shipment; a movement is
  customer-stated only when its endpoints came directly from customer input.
  Lead the page with an interactive network and a ranked action queue. Each
  action must state the current condition, recommended change, required
  customer decision, required input, and the linked procurement,
  supplier-contact, shipment, customs, or fulfillment workstream. Candidate
  organizations may appear only as qualification targets with a direct
  capability source and an explicit note that they are not known
  relationships.
- Rationale: An early customer demo needs to be immediately useful before ERP,
  procurement, shipment, and broker systems are connected. A structured
  hypothesis plus a concrete validation path creates value without pretending
  to possess operational truth.
- Consequences: The NOX Metals profile includes domestic aerospace plate mills,
  Great Lakes buffer stock, a Southern Ontario alternate, a known operating
  site, and regional plus national buyer profiles. The interface can link into
  five reserved workstream routes, but those routes do not send messages, award
  suppliers, book freight, file customs, or commit spend. Visible official-site
  addresses are considered alongside structured metadata so stale or missing
  JSON-LD does not silently suppress the current address.
- Revisit when: connected office-scoped purchase orders, suppliers, customer
  orders, shipments, and broker records can replace inferred nodes with
  observed relationships and measured lane performance.

### 2026-08-07 - Supply OS uses a fixed map-first command view

- Status: accepted
- Owner: product, design, and engineering
- Context: The report-style dashboard and checked-in Natural Earth SVG made the
  network secondary, created document scrolling, and required application code
  to imitate map controls and symbols. It did not meet the interaction quality
  of established maritime operating products.
- Decision: Make the saved-customer dashboard one fixed-height view with a
  compact header, object rail, full map canvas, selected-object dossier, and
  bottom status strip. Use MapLibre GL JS through React MapLibre, the
  OpenFreeMap Positron vector style, Lucide operational symbols, and Radix
  controls. Hover or focus exposes the contact card, click selects an object,
  and every selected supplier, movement, customs handoff, factory,
  distribution point, or customer exposes one next action. If WebGL 2 is not
  available, preserve the object rail and dossier and show a bounded renderer
  notice instead of crashing the page.
- Supersedes: The checked-in Natural Earth map and scroll-based saved-customer
  layout described in `Supply OS leads with an inferred network and ranked
  changes`. The provenance and human-approval requirements from that decision
  remain active.
- Rationale: A logistics operating surface should lead with geography,
  movement, selection, and local operating detail. Maintained map, icon, and
  control libraries provide consistent behavior without proprietary copying or
  custom-drawn visual language.
- Consequences: The dashboard requires WebGL 2 and a network connection to the
  OpenFreeMap style for the live basemap. Provider and broker entries remain
  candidates with direct public links, not connected capacity or awarded work.
  Routes remain inferred until supported by customer or connected operating
  records. Browser-local customer storage and office/user scoping are
  unchanged.
- Revisit when: Derya has live shipment, AIS, rate, broker, and provider data,
  or when an approved self-hosted basemap is required for offline operation.

### 2026-08-07 - Supply OS basemaps fail over and analysis stays actionable

- Status: accepted
- Owner: product, design, and engineering
- Context: One vector-style provider could leave working markers over an empty
  canvas when any nested style resource was slow or unavailable. The right
  dossier also collapsed a complete company analysis into one truncated
  recommendation, and saved social-preview images could appear as logos.
- Decision: Load the low-dependency CARTO raster basemap first and treat the
  first raster source content as ready. Fall back to CARTO Positron and then
  OpenFreeMap Positron only when no usable source arrives within the bounded
  load window. Keep the object rail usable when WebGL is unavailable. Separate
  selected-object detail from ranked optimization priorities with maintained
  Radix tabs. Every priority must state the condition, Derya intervention,
  customer decision, starting input, measurable operating result, and linked
  workstream. Rank structured or visible official brand assets above icons,
  and never treat a social-preview photograph or customer-logo carousel as the
  company logo.
- Rationale: The map is the product's primary working surface, so a visible
  real basemap is more valuable than a fragile richer style. Company analysis
  must remain inspectable and operational inside the same viewport instead of
  being hidden behind a summary sentence.
- Consequences: Advanced-aircraft profiles expose eight measurable controls
  covering multi-tier BOM visibility, demand gates, serial-number kits,
  prototype and production lanes, supplier industrialization, customs and
  export passports, gateway variability, and deployment spares. Existing
  browser-local cases collapse SEO taglines back to the customer name and
  reject obvious hero images as identity assets. Candidate suppliers, routes,
  brokers, and recommendations remain hypotheses until connected records and
  human approval exist.
- Revisit when: Derya adopts an approved self-hosted basemap, durable
  office-scoped company master data, or connected procurement and shipment
  evidence that can replace the current outside-in operating model.

### 2026-08-07 - Supply OS lanes are selectable planning objects

- Status: accepted
- Owner: product, design, and engineering
- Context: The command map displayed movement markers but did not reliably
  preserve a route when research omitted coordinates, did not make the path
  itself selectable, and did not turn a movement into a usable carrier and cost
  decision. Generic global providers also failed the local pickup and delivery
  question.
- Decision: Treat each modeled edge as a first-class route with endpoints,
  cargo, mode, confidence, mapped optimization priority, local candidate
  contacts, and an optional deterministic rate envelope. Normalize only a
  bounded list of known place names when coordinates are absent, without
  changing provenance. Project solid route geometry over the maintained
  MapLibre basemap and align a 24 pixel native button to the path for pointer
  and keyboard selection. Use Recharts for network flow and rate comparisons.
- Pricing boundary: A road-rate envelope may be shown only when both endpoints
  and a road-compatible mode exist. It must state its mileage method, source
  benchmark, exclusions, and that a live quote is required. It may not imply
  capacity, equipment availability, accessorial acceptance, or an awarded
  carrier.
- Provider boundary: A local carrier card requires an official public source,
  location, phone number where available, relevant capability, and endpoint
  relevance. It remains a qualification candidate until Derya receives and a
  human approves current capacity, insurance, operating authority, service,
  and price.
- Rationale: The customer should be able to click the exact supply-chain leg
  that needs work and immediately see what Derya would compare, who could serve
  it, what it might cost, what remains unknown, and which optimization action
  belongs there.
- Consequences: The map can now support a one-minute customer demo without
  pretending that public evidence is an operating record. Added chart and map
  interaction code increases the Supply OS client bundle, currently 311 kB
  first load in the production build. This is acceptable for the authenticated
  planning surface and should be revisited when connected data makes the page
  substantially denser.
- Revisit when: connected office-scoped TMS, ERP, procurement, broker, rate,
  telematics, and shipment events can replace planning envelopes and candidate
  providers with measured lane performance and executable options.

### 2026-08-07 - Map intelligence requires cited route relevance

- Status: accepted
- Owner: product, design, and engineering
- Context: A generic warning feed would make the map look richer while risking
  false relevance. Commodity news, port events, and pricing commentary are not
  useful unless the evidence applies to a material, location, or lane in the
  customer's modeled network.
- Decision: Show a public-research finding on the command map only when it has
  an attributable URL, is not inferred, contains a decision-relevant cost,
  capacity, customs, tariff, congestion, delay, or disruption signal, and
  matches a displayed route by cargo or location. Cap the map at three current
  signals. Every card must show its source and research date. Do not claim a
  cost direction without a cited comparison, and do not claim a live rate
  without a current lane-specific source.
- Visual consequence: Keep alerts sparse and route-linked. Use flow charts
  only for multimodal or meaningfully segmented routes, use the network flow
  only when multiple movements exist, and show only unresolved checks.
- Rationale: Evidence density is not intelligence. The customer needs a small
  number of traceable exceptions that can change a shipment or sourcing
  decision without obscuring the operating network.
- Revisit when: connected rate histories, port events, customs records,
  purchase orders, and shipment telemetry can provide deterministic joins and
  measured severity instead of public-source matching.

### 2026-08-08 - Supply planning is deterministic, snapshot-bound, and append-only

- Status: accepted
- Owner: product and engineering
- Context: The shared Supply OS snapshot models made BOM, inventory, and demand
  canonical, but the existing optimization module was still a presentation
  model. Accepting browser-computed rank, feasibility, cost, or lead time would
  make planning unauditable and easy to tamper with.
- Decision: Run planning in a pure deterministic server-owned engine over one
  published snapshot plus canonical supplier terms, approved equivalence rules,
  and FCC evidence profiles. Support only current plan, alternate supplier,
  assembled subassembly, and approved equivalence scenario families. Persist
  append-only results with snapshot, normalized-input, engine-version, and
  deterministic-output hashes.
- Unknown-data rule: Missing inventory facts, price, freight, evidenced duty,
  lead time, supplier capacity, receipt timing, or compliance evidence remain
  null and appear in the unknown list. Absence is never converted to zero.
- Recommendation rule: Reject blocked scenarios, maximize units available by
  the required dates, compare landed cost only when complete, then lead time,
  supplier concentration, and stable scenario key. Do not use an AI score.
- FCC boundary: Report only `evidence_complete`, `review_required`, or
  `blocked`. Module authorization evidence never proves that a host product
  passes FCC.
- Consequences: Client requests may select only canonical scenario inputs and
  cannot author rank, cost, feasibility, or commercial facts. A newer published
  snapshot marks older results stale in reads while retaining their immutable
  audit history. Execution still requires the separate approval ledger.
- Revisit when: Real customer connectors need additional canonical term fields,
  unit conversion rules, separate inbound receipt dates, or constrained
  inter-facility transfer planning.

### 2026-08-08 - Supply OS uses an internal operator rail and restores map access

- Status: accepted
- Owner: product and design
- Context: Removing the one-link dashboard sidebar was correct, but replacing
  all in-product navigation with a horizontal tab strip made the operating
  surface harder to scan and buried the network map inside Logistics.
- Decision: Keep Supply OS as the only internal product while restoring a
  persistent sidebar inside that product. The rail may navigate only Materials,
  Network Map, Suppliers, Scenarios, and Tracking. It must not resurrect the
  retired Deal Desk, CRM, RFQ, Outreach, Intel, or report navigation.
- Map decision: Promote the existing evidence-bounded MapLibre command map to a
  primary Network Map destination and expose it from both the rail and command
  header. The map remains supporting operational context, not a replacement for
  product, inventory, demand, and sourcing decisions.
- UI library decision: Use Motion for React for interruptible interface motion,
  layout indicators, presence transitions, and gestures. Keep simple color
  transitions in CSS and keep all supply, evidence, authorization, and approval
  logic outside animation libraries.
- Accessibility: Motion must honor the user's reduced-motion preference. The
  sidebar collapses rather than consuming the analytical canvas on smaller
  screens.
- Supersedes: The no-sidebar interface choice in the 2026-08-08 full-width
  product-chrome slice. It does not supersede the single-product route cutover.

### 2026-08-09 - Sourcing is a request-to-recommendation workflow

- Status: accepted
- Owner: product, design, and engineering
- Context: A live inventory-count dashboard makes Supply OS look like a weak
  inventory-management product. Derya's useful job is turning a component need
  into an evidence-backed supplier decision and then an execution handoff.
- Decision: Inventory & sourcing opens with a sourcing request composer and a
  queue of parts that need action. Starting procurement transitions the same
  dashboard through visible trusted-source research, public discovery, a
  price/delivery/quality comparison, operator selection, and a draft logistics
  handoff. Missing commercial inputs remain unknown.
- Evidence boundary: The robotics starting candidates remain illustrative.
  Interactive research may call the authenticated public web research engine;
  every returned candidate requires attributable sources and stays
  unqualified. Modeled, sourced, and unknown commercial values remain visibly
  distinct. No supplier system is presented as connected.
- Deferred integration: `Continue procurement` prepares a local procurement
  brief only in this slice. A later change will create an approval-gated
  canonical `SupplyAction` and open Logistics with accepted order context. The
  Logistics panel is unchanged.

### 2026-08-09 - Research runs are durable procurement records

- Status: accepted
- Owner: product and engineering
- Context: A sourcing workflow is useless if leaving the comparison destroys
  the supplier evidence. Marketplace procurement products keep a request and
  its responses as a durable object that can progress toward an order.
- Decision: Interactive supplier research is stored as office-scoped
  `SupplyCapabilityRun` records with immutable input and output hashes. The
  sourcing queue uses the latest run per component and also lists saved custom
  requests. Saved results reopen directly into comparison.
- UI state: Queue actions are state-aware: start, researching, view results, or
  retry. Passive `Next step` labels are not procurement controls.
- Demo storage: Atlas demo research uses an office-scoped system workspace that
  is excluded from the company directory. This avoids duplicate company rows
  while preserving cross-refresh and cross-browser office state.
- Boundary: Research persistence does not approve a supplier or authorize
  contact, negotiation, purchase, payment, inspection, booking, or spend.

### 2026-08-09 - Supplier selection creates a durable procurement planning case

- Status: accepted
- Owner: product and engineering
- Context: A saved supplier search is not a procurement workflow until the
  chosen option, its evidence state, and its remaining gates survive navigation
  and can be audited.
- Decision: Continue procurement creates one `PROCUREMENT_CASE`
  `SupplyExecutionTask` per research run. The immutable task input binds the
  case to that run. The mutable pre-execution result holds the current selected
  option and deterministic readiness gates. Every selection change appends a
  hashed `SupplyExecutionEvent`.
- Trust boundary: For public candidates, the server re-derives supplier
  identity, official or public source, commercial values, and qualification
  state from the persisted research output. Client-authored sourced facts are
  ignored. Commercial fields count as sourced only when their evidence envelope
  is supported, attributable, and fresh. Modeled candidates may be saved only
  as modeled, source-less proposals and are stored as new and unverified.
- Gates: Supplier evidence, commercial terms, quality plan, and purchase
  approval fail closed. Purchase approval remains blocked until later
  evidence-backed review actions complete the preceding gates.
- Boundary: A procurement case is planning state, not permission to contact,
  negotiate, inspect, order, pay, book, or spend.
- Approval scope: The mutable planning case itself is not approved. A later
  purchase or outreach action must copy the exact selected supplier and terms
  into an immutable execution-task input and bind approval to that input hash.

### 2026-08-10 - Supplier shortlists create isolated quote workstreams

- Status: accepted; supersedes the one-case-per-research-run cardinality in the
  August 9 supplier-selection decision.
- Owner: product and engineering
- Context: Buyers need competing quotes without overwriting supplier evidence,
  communication, terms, or quality review each time they inspect another option.
- Decision: A research run may own one `PROCUREMENT_CASE` per shortlisted
  supplier. Supplier-specific task keys make repeated and concurrent requests
  idempotent. The sourcing queue restores the group into one competitive quote
  inbox while each child workstream retains its own evidence and approvals.
- Comparison boundary: A displayed quote uses the operator-selected response.
  Price and delivery badges require matching RFQ scope and unit; price also
  requires one currency. Missing or incompatible inputs are not ranked.
- Award boundary: Supplier qualification may progress independently, but only
  one sibling supplier may have a pending or approved award at a time. Purchase
  preparation remains impossible without the exact supplier approval scope.
- Compatibility: The singular procurement API request shape remains accepted,
  but it resolves through the same supplier-specific identity as the shortlist
  request shape.

### 2026-08-10 - Procurement qualification is sequential and approval scope is immutable

- Status: accepted
- Owner: product and engineering
- Context: A row of readiness labels is not a procurement workflow. Operators
  need durable actions for qualification, quote confirmation, quality planning,
  and approval without turning mutable planning state into permission to spend.
- Decision: The procurement case exposes sequential source-evidence,
  commercial-term, and quality-plan actions. Each action is validated on the
  server against the current supplier-selection hash and appended to the case
  event ledger.
- Approval: Once all three gates are complete, create a separate
  `PROCUREMENT_APPROVAL` task whose immutable input includes the selected
  supplier, confirmed terms, source review, and quality plan. Bind the manager
  approval to that task input hash. Separation of duties blocks self-approval
  when another eligible approver exists.
- Staleness: A supplier or gate change cancels a pending approval. An approved
  record remains historical, while the mutable case returns to an unapproved
  state for the new scope. Expired quote, delivery, quality-plan, or approval
  dates expire the pending request and return the case to the relevant review
  gate so the operator can recover in place.
- Boundary: Approval authorizes purchase preparation only. It does not contact
  a supplier, issue a PO, commit spend, book freight, file customs, or create a
  Logistics handoff.

### 2026-08-10 - Connected supplier replies remain evidence until reviewed

- Status: accepted
- Owner: product and engineering
- Context: Sending an RFQ from Supply OS but forcing the buyer to hunt through
  Gmail and paste a public URL breaks the resumable procurement workflow.
  Automatically treating an email body as confirmed price or delivery terms is
  worse because ordinary language and attachments are not safe execution input.
- Decision: A buyer may sync the connected sender account from the active quote
  cycle. Supply OS captures only replies in the delivered Gmail thread from the
  exact approved supplier address. Provider message identity, body excerpt,
  attachment metadata, sender, and observation time become immutable connected
  evidence and remain visible after leaving the workspace.
- Commercial boundary: Captured messages are `REVIEW_REQUIRED`. An operator
  must transcribe and confirm the structured quote terms. The resulting quote
  response keeps the connected evidence lineage and may then enter the existing
  commercial review and approval scopes. No extraction automatically satisfies
  a gate or authorizes purchase.
- Concurrency: Repeated and simultaneous inbox checks deduplicate by provider
  message identity and retry serialization conflicts without duplicating
  evidence or events.

### 2026-08-10 - Sourcing intake uses deterministic readiness before research

- Status: accepted
- Owner: product and engineering
- Context: The sourcing composer sent raw free text directly to public supplier
  research. Vague requests could not resolve useful terms, and `Refine request`
  discarded the request instead of collecting the missing facts.
- Decision: Parse free-text requests into a strict draft and require an item,
  quantity and unit, technical identity, delivery location, and need-by date
  before public research. GPT extracts and merges facts. Deterministic code owns
  the readiness decision and exact missing-field list.
- Storage boundary: Incomplete drafts may remain in browser storage scoped by
  office, user, and company. Once research starts, the existing canonical,
  office-scoped research run and procurement case records remain authoritative.
- Evidence boundary: Intake does not create source evidence. Public research
  remains attributable and unqualified, and all existing review and approval
  gates remain in force.
- Supplier-role boundary: Free-text material research may retain evidenced
  producers, processors, exporters, and traders in addition to manufacturers
  and distributors. Catalog component research rejects those material-only
  roles deterministically.
- Revisit when incomplete requests need cross-user collaboration or canonical
  server-side persistence before research begins.

### 2026-08-10 - Connected purchase order email has its own approval scope

- Status: accepted
- Owner: product and engineering
- Context: Final purchase authorization approves the exact supplier, terms,
  quantity, and order scope. It does not approve arbitrary outbound wording or
  prove that a supplier received an order.
- Decision: A connected Gmail purchase order release uses a separate immutable
  approval scope containing the authorized action hash, sender, recipient,
  subject, body, purchase order reference, and acknowledgment due date.
- Delivery: A Gmail receipt and the purchase release evidence are committed
  together. An unknown provider result blocks another channel and another send
  until reconciliation. A confirmed provider miss requires a manager recovery
  note before one retry.
- Alternate path: Operators may still record a manual external release when no
  connected-email delivery is active or unresolved.
- Boundary: This does not create a canonical purchase order, payment, booking,
  customs filing, or Logistics handoff.

### 2026-08-10 - Connected order replies are evidence, not acceptance

- Status: accepted
- Owner: product and engineering
- Context: A delivered purchase order is not complete until the supplier
  confirms accepted quantity and delivery. A reply such as "received" proves a
  message exists but does not prove full commercial acceptance.
- Decision: Supply OS may sync only the exact connected Gmail account, purchase
  order thread, post-send window, and approved supplier address. Matching
  replies become immutable connected-provider evidence attached to the released
  purchase action.
- Review boundary: An operator must select the reply and enter the supplier
  order reference, accepted quantity, and confirmed delivery date. The reply
  date is pinned from Gmail. One reply may support only one quantity-bearing
  acknowledgment.
- Persistence: Partial acknowledgments retain the captured inbox and connected
  release lineage so the operator can resume and capture later replies.
- Boundary: Email text is not automatically extracted into accepted quantity,
  delivery, payment, Logistics, or inventory state.

### 2026-08-10 - Supplier counteroffers are exceptions, not acknowledgments

- Status: accepted
- Owner: product and engineering
- Context: A supplier reply may change quantity, price, delivery, payment terms,
  or reject the order. Treating that reply as normal acceptance would attach new
  commercial terms to an obsolete authorization.
- Decision: Changed or rejected terms become durable supplier order exceptions
  tied to the exact release hash. Open exceptions block supplier acknowledgment.
  An operator may retain the original authorization only with a recorded reason;
  an admin may instead require a replacement authorization.
- Evidence boundary: Connected Gmail replies retain provider lineage and may be
  used for either an acknowledgment or an exception, never both. Structured
  proposed terms remain operator-confirmed rather than inferred from email text.
- Execution boundary: Reauthorization does not mutate or resend the original
  order. It marks the old scope unusable until a later workflow creates and
  approves a replacement. No payment, inventory, booking, customs, or Logistics
  state changes.

### 2026-08-11 - A revised order supersedes only when it is released

- Status: accepted
- Owner: product and engineering
- Context: A supplier may change an already released order. Treating internal
  approval of a replacement as proof that the supplier received it would erase
  the real outstanding order and create a false execution state.
- Decision: Build a separate immutable replacement draft from the supplier
  exception, obtain a fresh exact-scope admin approval, and keep the original
  released order outstanding. Only manual release evidence or a connected Gmail
  delivery receipt atomically marks the original action as superseded.
- Evidence boundary: The replacement pins the original release, exception
  evidence, supplier qualification, commercial terms, quality plan, and prior
  sourcing approval. Supplier-controlled changed terms must match the recorded
  exception; missing or expired inputs block authorization or release.
- History: The original release evidence is retained after supersession. The
  replacement action and release hash are linked from the old action, and later
  acknowledgments against the obsolete release are rejected.
- Rejection: A supplier rejection cannot retain or revise the rejected order.
  It creates a durable return-to-sourcing state and sends the buyer back to the
  supplier shortlist.
- Boundary: Revised-order authorization and release do not create payment,
  inventory, booking, customs, or Logistics state.

### 2026-08-11 - Expired replacement evidence returns the buyer to sourcing

- Status: accepted
- Owner: product and engineering
- Context: A replacement order can outlive the supplier qualification or
  quality-plan evidence copied into its authorization scope. Merely rejecting
  the next action leaves a dead replacement draft and no valid operator path.
- Decision: If supplier qualification or the quality plan expires before a
  revised order is authorized or released, cancel the replacement draft,
  purchase action, pending approvals, and unsent communication tasks. Preserve
  the original supplier-facing order and record a durable return-to-sourcing
  reason against the supplier exception and procurement case.
- Connected delivery: Revalidate before the Gmail provider call. Stale evidence
  must return the buyer to sourcing without sending a message. Uncertain or
  in-flight provider delivery must be reconciled before recovery can proceed.
- Commercial expiry: Before authorization, expired quote, delivery, or approval
  inputs keep the replacement draft recoverable in place. After authorization,
  expiry at release returns the buyer to sourcing because the approved action
  is immutable and cannot absorb refreshed commercial terms.
- Boundary: Recovery does not supersede the original order, contact another
  supplier, create a purchase order, commit spend, or open Logistics.

### 2026-08-12 - Routine application builds do not run database migrations

- Status: accepted
- Owner: product and engineering
- Context: PR #140 applied and verified the additive supply intelligence
  migration during the successful production Vercel deployment at commit
  `a361ea38bd017c418c37f1ddcc1f5a093a9225da`.
- Decision: Remove the one-time Vercel migration build hook now that the schema
  prerequisite is satisfied. Routine preview and production builds run the
  normal application build and preserve the existing connector cron.
- Rationale: A release-specific recovery hook is not durable migration
  orchestration and should not mutate the database on every production build.
- Consequences: Future migrations need their own explicit, observable rollout
  step before dependent runtime ships.
- Revisit when: Production has a dedicated migration stage outside application
  builds.

### 2026-08-11 - Customer workspace sourcing owns its procurement workstream

- Status: accepted
- Owner: product and engineering
- Context: Supplier research can run inside a customer Supply OS workspace. Resolving later procurement, email, reply, and quote-extraction work through the legacy Atlas workspace breaks that customer-scoped flow and hides valid records.
- Decision: Derive the workspace from the office-scoped research run or execution task, then authorize that exact workspace before every follow-on read or mutation. The legacy Atlas workspace remains only the fallback for research started without an explicit customer workspace.
- Safety: Task and run lookup always includes `officeId`; workspace membership and edit rights still pass through `requireSupplyWorkspace`.

### 2026-08-12 - Research failures and incomplete parts lists remain explicit

- Status: accepted
- Owner: product and engineering
- Context: A provider timeout or invalid structured response was previously
  saved as a successful research run with no candidates. Parts-list import also
  rejected useful customer rows when delivery facts were absent. Both behaviors
  confused an unavailable dependency or an incomplete request with valid empty
  data.
- Decision: Provider configuration, timeout, upstream, and schema failures use
  typed non-success responses and persist a failed research run that can be
  retried. A five-column customer parts list may publish item identity,
  specification, quantity, unit, and QA requirements while absent delivery
  location, need-by date, or open quantity remain row-level clarification facts.
- Evidence boundary: A zero-result successful search is distinct from provider
  failure. Rejected and retained source URLs remain visible for audit. Prices
  count as sourced only when amount, currency, unit, observation time, and a
  common attributable URL pass the existing evidence rule.
- Authorization: Only administrators and managers see parts import controls.
  Server-side workspace edit authorization remains the final enforcement point.
- Consequences: Failed research cannot masquerade as a completed empty search,
  incomplete customer data is not invented, and an incomplete row does not
  block unrelated valid rows from entering the sourcing queue.

### 2026-08-12 - Parts imports expand snapshots and live prices require server verification

- Status: accepted
- Owner: product and engineering
- Context: Publishing an items-only parts snapshot could hide the customer's
  locations, BOM, inventory, demand, supplier terms, compliance state, and
  product media. Model-supplied observation times could also make an old or
  misread listing look like a current public price.
- Decision: A one-file parts import copies the latest published snapshot into a
  new immutable draft and overlays items by stable item key. The draft records
  the exact published snapshot it expanded and fails at publish if that base is
  stale. Full normalized bundle imports retain replacement semantics.
- Price boundary: Provider output cannot declare a price current. Public listing
  claims may be displayed with their source link, but remain freshness unknown
  and cannot become a recommendation, benchmark, or order term. Current public
  prices require a managed retrieval connector that binds item identity,
  amount, ISO currency, unit, and source date without application-origin fetches.
  Selection persistence reapplies this downgrade to completed legacy research
  runs so old model-supplied timestamps cannot restore sourced commercial terms.
- Isolation: Fixed customer workspaces fail closed when unavailable, and local
  pending sourcing requests include workspace ID in their storage key.
- Consequences: Parts uploads cannot silently erase the operational twin,
  concurrent stale drafts cannot hide newer customer data, and unverifiable
  listings remain labeled claims rather than becoming orderable prices.

### 2026-08-13 - OpenAI supplier discovery requires independent page receipts

- Status: accepted
- Owner: product and engineering
- Context: The GUILD campaign was pinned to Exa forced-live retrieval, but the
  deployed environment could have OpenAI web search configured without Exa.
  Treating an OpenAI citation or structured model claim as validated supplier
  evidence would weaken the receipt boundary and still leave the campaign with
  zero legitimate leads.
- Decision: Choose Exa when it is configured, otherwise choose OpenAI, and pin
  that exact provider in the immutable campaign and child inputs. Never switch
  providers after a timeout, authentication failure, rate limit, or other
  runtime error. OpenAI citations are discovery only. The server independently
  retrieves each proposed public page through a pinned public IP connection,
  rejects redirects, private or reserved addresses, login and paywall pages,
  encoded or oversized responses, and unsupported content types, then applies
  deterministic company, role, and requested-capability checks to exact page
  excerpts.
- Evidence boundary: Both providers produce versioned, server-rebuilt supplier
  lead receipts. Sources remain PUBLIC. Price, stock, MOQ, lead time, location,
  certification, and availability remain unknown unless a separate trusted
  workflow proves them. The OpenAI page retriever does not establish price
  freshness and cannot create quote or order authority.
- Campaign lifecycle: Provider choice is part of campaign scope version 3.
  Superseded queued children are cancelled, and worker list and claim paths
  require the exact parent campaign to remain RUNNING with the same provider
  pin. Source URLs and sanitized warnings remain visible even when no lead
  passes receipt validation.

### 2026-08-13 - Supplier capability is distinct from exact orderability

- Status: accepted
- Owner: product and engineering
- Context: Material-stock research rejected legitimate suppliers unless one
  public page repeated the requested thickness, finish, cutting, and QA terms
  in the exact request syntax. That treated an RFQ lead as if it were already
  an orderable listing and eliminated real 6061-T6 sheet distributors.
- Decision: A material-stock supplier lead must have independently retrieved,
  same-page evidence for the supplier identity, an allowed supplier role, the
  requested base material, form, and alloy or temper when one is specified.
  Exact thickness, finish, cut size, stock, price, lead time, and documentation
  remain unknown unless separately proven and must be confirmed through the
  human-reviewed RFQ workflow.
- Evidence boundary: Store only the deterministic capability core supported by
  the page, such as `6061-T6 aluminum sheet`. Do not copy unsupported request
  qualifiers from a model proposal into the supported capability. Generic
  aluminum-sheet pages still fail when they do not prove the requested grade
  and temper.
- Discovery boundary: Search-returned URLs are discovery records, not checked
  supplier pages. Known tracking parameters may be removed for URL binding,
  but genuine query parameters remain part of the source identity. The UI must
  report discovery, retrieval, validation, and retained leads as separate
  stages.

### 2026-08-13 - Supplier discovery excludes non-commercial reference domains

- Status: accepted
- Owner: product and engineering
- Context: Public search returned Reddit, Wikipedia, YouTube, academic papers,
  and government reference documents beside real supplier catalogs. These URLs
  could not become validated supplier leads, but they consumed retrieval slots
  and made the sourcing result look like an unfiltered search page.
- Decision: Apply one deterministic, client-safe supplier-discovery URL gate
  before proposal eligibility, managed page retrieval, saved source output,
  legacy public-search normalization, and UI display. Exclude known social,
  community, encyclopedia, video, academic-reference, government, military,
  and academic domain classes. Reject local and IP-literal URLs. Continue to
  allow public supplier websites and supplier-hosted catalog PDFs.
- Evidence boundary: Domain eligibility is only an intake filter. It does not
  prove company identity, supplier role, product capability, price, stock, or
  approval. Candidate retention still requires independently retrieved page
  evidence and deterministic receipt validation.

### 2026-08-13 - GUILD supplier research continues in bounded exploration epochs

- Status: accepted
- Owner: product and engineering
- Context: The first campaign design treated nine attempts per line, twelve
  campaign generations, and the demo need-by date as terminal limits. That
  contradicts the operating goal: keep looking for three to five attributable
  supplier leads on each sourceable GUILD line while respecting provider and
  office budgets. A terminal attempt ceiling also prevented improved evidence
  validation from helping an existing failed campaign.
- Decision: Treat each group of nine attempts as an exploration epoch, not a
  terminal campaign limit. Keep the campaign durable and resumable across
  epochs. Derive the next attempt from the immutable stored attempt ordinal,
  rotate query variants and excluded domains by epoch, retain validated
  aggregate evidence across the bounded attempt window, and cap retry backoff
  at 24 hours. The fixed demo need-by date does not expire supplier discovery.
- Recovery boundary: Cron may create one immutable successor only for an older
  campaign that failed under the former attempt-exhaustion or no-retryable-work
  rules. Authentication, authorization, missing configuration, cancellation,
  superseded scope, and explicit manual-review failures remain operator-owned
  and are never retried blindly. A parent cannot complete or fail while a child
  attempt is still running.
- Evidence boundary: Perpetual exploration does not weaken admission. A lead
  still requires an independently retrieved page, company and domain binding,
  explicit supplier-role evidence, and deterministic requested-capability
  evidence. Aggregate artifacts keep at most five candidates, 64 attributable
  sources, and 20 sanitized warnings per line. Research completion does not
  qualify a supplier, contact it, approve spend, or create an order.
- Supersedes: The nine-attempt terminal limit, twelve-generation manual retry
  ceiling, and fixed-date expiry portions of the 2026-08-12 persisted supplier
  research decision. Daily provider and office caps, tenant scoping, immutable
  run lineage, human approval, and the 38 sourceable line target remain in
  force.
- Consequences: A valid running campaign can continue after the browser closes,
  through daily quota resets and new exploration epochs, until each sourceable
  line has three retained leads. Operators still must fix configuration or
  access failures, and a campaign still stops on explicit cancellation.
- Revisit when: Provider economics require a different daily budget, a managed
  external queue replaces database claiming, or the GUILD request becomes a
  versioned customer program instead of a fixed demo campaign.

### 2026-08-14 - Live supplier acceptance uses direct provider checkpoints

- Status: accepted
- Owner: product and engineering
- Context: The deployed GUILD campaign can run durably, but its browser-facing
  acceptance command only starts and polls persisted work. It cannot compare
  providers from the same zero state, explain rejected supplier pages, or
  replay captured evidence after deterministic validation changes. Blindly
  increasing campaign quota would spend more while preserving the same
  observability failure.
- Decision: Use a browser-free engineering evaluation command that calls Exa
  and OpenAI directly with the production GUILD request parser, query variants,
  provider pins, receipt validator, and campaign aggregate function. In both
  mode, keep separate immutable attempt ordinals for each provider and run the
  same baseline attempt through both providers. The command never reads or
  writes application database state and never contacts or approves a supplier.
- Evidence boundary: Store the bounded provider result and independently
  retrieved public-page capture in a local integrity-protected checkpoint so
  current validation can be replayed without another provider call. Do not
  store provider envelopes, request headers, cookies, API keys, or exception
  text. Checkpoint and scorecard files are owner-only. Console and scorecard
  diagnostics contain counts, hostnames, and deterministic rejection codes,
  never page text or evidence excerpts.
- Acceptance: Exit successfully only when all 38 `SUPPLIER_SEARCH` lines retain
  three to five distinct company and domain candidates backed by a common
  independently retrieved evidence URL. GUILD-027 remains
  `CLARIFICATION_REQUIRED`, GUILD-039 remains `REQUIREMENT_ONLY`, and neither
  receives a provider attempt. Target and retention flags cannot weaken the
  production values of three and five.
- Improvement loop: Start from a new checkpoint, run a bounded same-structure
  comparison, inspect per-line rejection codes, change deterministic logic only
  when captured evidence proves a false rejection, then use offline revalidation
  before spending another provider call. A request-fixture mismatch blocks
  append or replay, while an evidence-policy change is reported and intentionally
  allowed for offline revalidation.
- Operational boundary: Provider keys must already exist in the invoking shell.
  The command names missing configuration but never prints or reads key values
  outside the provider SDK. Keys must not be pasted into chat or committed.
### 2026-08-19 - Share one Neon database without sharing database roles

- Status: accepted
- Owner: product and engineering
- Context: The production sourcing workflow already uses the authoritative
  Neon database, while Derya login and Office records still use an older
  application database that has no data worth carrying forward. Keeping two
  physical databases adds commissioning friction and makes a fresh customer
  login look disconnected from its workflow records.
- Decision: Store the quoted Prisma application tables and lowercase workflow
  tables in one physical Neon database. Keep `DATABASE_URL` on a restricted
  `derya_app` role, keep `WORKFLOW_DATABASE_URL` on `dashboard_api`, and keep
  Bourne on its existing workflow role. Schema migrations run only as owner.
- Identity boundary: A fresh production seed creates the Office, ADMIN user,
  Company, SupplyWorkspace, and OWNER membership together. The authenticated
  Office ID still maps server-side to one workflow customer UUID. Browser input
  never chooses that customer.
- Permission boundary: `derya_app` receives CRUD only on quoted PascalCase
  Prisma tables. It receives no workflow-table privileges. `dashboard_api`
  keeps its existing limited workflow grants and receives no Prisma login-table
  access.
- Cutover boundary: Test the combined layout in a disposable database first,
  retain the old database unchanged for rollback, then switch only server-side
  production variables and smoke-test one request. Do not use `prisma db push`
  or a privileged owner URL at runtime.

### 2026-08-20 - Login codes keep a database-independent SMTP bootstrap path

- Status: accepted
- Owner: engineering
- Context: The shared Neon cutover seeds the Office and allowlisted ADMIN user,
  but a fresh database does not contain an OAuth-connected EmailAccount. The
  previous login-code implementation required that tenant mailbox row, which
  created a bootstrap deadlock: an operator had to sign in before reconnecting
  Gmail, while sign-in itself required Gmail to be connected.
- Decision: Login-code delivery still prefers an active Gmail account scoped to
  the user's Office. If that sender is missing or its OAuth delivery fails, the
  server may use the already-configured RFQ Gmail SMTP desk as a bootstrap
  fallback. Codes remain restricted to the login allowlist and an active User,
  and are persisted only after delivery succeeds.
- Security boundary: The SMTP password remains server-only. Codes are never
  logged, stored in plaintext, or sent to an address different from the
  allowlisted login identity.
- Consequences: A fresh database can complete first login without copying Gmail
  OAuth tokens across databases. Operators can then reconnect the office
  mailbox through the authenticated settings surface.
- Revisit when: Internal authentication moves to a dedicated identity provider
  or transactional email service.

### 2026-08-20 - Opportunities stays evidence-gated until comparison inputs are verified

- Status: accepted
- Owner: product and engineering
- Context: The previous Opportunities workspace looked active even when it could
  not support a defensible current-versus-alternative comparison. Fulfillment
  and Tracking also exposed empty navigation surfaces.
- Decision: Hide Fulfillment and Tracking from navigation, retire their direct
  routes to Inventory and sourcing, remove the Logistics status dot, and show
  Opportunities as an inactive preview. The preview may describe comparison
  fields, but it must not display numeric savings, speed, or margin claims
  without verified baseline and alternative evidence.
- Consequences: The sidebar reflects usable product surfaces. Opportunities
  communicates its intended shape without inventing operational outcomes.
- Revisit when: Verified comparison inputs and deterministic impact calculations
  are available for a real customer workspace.

### 2026-08-22 - Production database migrations use a protected release job

- Status: accepted
- Owner: engineering
- Context: Routine Vercel builds intentionally use a restricted application
  role and cannot run DDL. Manual local migration commands depended on a
  credential in one operator session and did not provide a durable audit path.
- Decision: Production migrations run only through the protected GitHub
  workflow on `main`, using either `workflow_dispatch` or a
  `repository_dispatch` event with type `production-database-migration`. The
  job uses the `Production` environment owner secret, requires an exact
  confirmation phrase and the latest committed migration ID, verifies
  `derya_production` and `neondb_owner`, runs `prisma migrate deploy`, and
  requires a committed read-only verification SQL file for the selected
  migration.
- Safety: The workflow token is read-only, concurrent migrations serialize,
  migration and verification paths cannot come from arbitrary input, and
  dependency lifecycle scripts cannot read the owner credential. Routine
  application builds remain unable to mutate schema.
- Consequences: Future schema releases have an observable, repeatable migration
  stage. GitHub's current private-repository plan cannot enforce a required
  reviewer, so the main-only environment rule, exact phrase, and committed
  verification contract are the available gates.

### 2026-08-22 - Workflow migrations pin the Bourne production endpoint

- Status: accepted
- Owner: engineering
- Context: The first protected supplier-contact run used a valid owner URL for
  `derya_production`, but the live procurement records are in Bourne's `neondb`
  database. Checking only the database name and role did not prove the Neon
  branch was the one served through `WORKFLOW_DATABASE_URL`.
- Decision: `WORKFLOW_DATABASE_OWNER_URL` points only to Neon project
  `plain-shape-01606176`, branch `br-long-rice-aud6ho2m`, and its direct
  `ep-summer-cake-audzi8ve` endpoint. The release workflow checks the endpoint,
  database `neondb`, and role `neondb_owner` before running Prisma.
- Safety: The owner credential remains a GitHub Production environment secret
  and is unavailable to dependency lifecycle scripts. A changed Neon endpoint
  requires an explicit code review and secret update instead of silently
  migrating a different branch.

### 2026-08-22 - Customers use the shared Supply OS with explicit workspace scope

- Status: accepted
- Owner: product and engineering
- Context: Customer login previously opened a separate shipment summary. That
  made a valid account look like a different, reduced product.
- Decision: Customer sign-in opens the shared Supply OS. Each customer account
  has a linked app identity and explicit Supply workspace membership. Customer
  sessions carry role `CUSTOMER` and freshly resolved allowed workspace IDs.
- Admin boundary: Customers may use their assigned company workspace but may
  not create companies, manage accounts, configure connectors, or access admin
  settings. Their Settings page is intentionally empty apart from navigation.
- Credential boundary: Admins may set an optional customer password and read it
  later. The retrievable value is encrypted at rest with `AUTH_SECRET`; the
  login verifier remains a separate one-way scrypt hash. Secret rotation
  requires customer password resets.
- Consequences: The separate summary portal is no longer the primary customer
  product. New Supply OS routes must use scoped access instead of assuming
  every authenticated app identity has office-wide access.

### 2026-08-23 - Customer identities live under companies, not operator accounts

- Status: accepted
- Owner: product and engineering
- Context: The first admin surface listed a migrated customer identity using
  the operator's name and email in a second top-level account section. That
  made the admin account look like a customer login and separated credentials
  from the company they actually authorize.
- Decision: Admin Settings shows one expandable company directory. Customer
  users, credentials, role, access, and user actions live inside their company.
  The signed-in operator is labeled separately and is never presented as a
  customer user.
- Identity boundary: Customer contact email is optional. When omitted, the
  server stores a unique address under `customers.derya.invalid`; this address
  is an internal identifier and is hidden as a contact field. Display name
  defaults to the company name.
- Removal boundary: Delete user is an audit-preserving removal. It revokes all
  portal and workspace access, invalidates sessions, clears credentials,
  disables the linked app identity, and hides the user. Historical customer
  actions and provenance remain stored.
- Authorization boundary: Customer-linked internal users never qualify as
  operators, even though their restricted app record uses an internal
  admin-shaped role. The management page and every mutation re-read active
  operator state and reject linked customer identities.
- Concurrency boundary: Account update and removal serialize on one
  office-and-user lock. Removed usernames are tombstones and cannot be restored
  by a stale edit.
- Consequences: Admins can manage every company and its users in one place
  without confusing an operator login with a customer identity. Customers
  remain restricted to explicit company workspace membership.
### 2026-08-23 - Live mailbox capability demos use isolated test records

- Status: accepted
- Owner: product and engineering
- Context: Operators need to prove that connected mailboxes can send, monitor,
  and reply before using them in procurement. Running ad hoc database scripts
  would either require copying encrypted credentials or bypassing the deployed
  application runtime that owns decryption and mail transport.
- Decision: A live capability demo is queued in the production database by a
  protected, manually dispatched GitHub workflow and executed by the deployed
  application. The workflow selects account IDs only. Vercel decrypts the
  existing credentials in memory. A one-time token authorizes only the exact
  queued job and is removed from the stored payload when the run completes.
- Data boundary: Demo traffic uses a clearly labeled test Company, workspace,
  execution task, and append-only events. It never qualifies a real supplier,
  creates a purchase action, authorizes spend, or represents demo values as a
  commercial quote. Test-only IMAP ingestion skips freight classification,
  memory ingestion, CRM touches, sourcing prewarms, and sync-cursor mutation,
  so the demo cannot alter real workflow state. It does not change the Office
  default sender. Threads and messages carry a persistent `DEMO_TEST_ONLY`
  marker, remain hidden from operational inboxes, and are excluded from memory
  backfills. If normal sync sees a demo message before the targeted observer,
  the marker requires a same-office durable plan matching Message-ID, sender,
  recipient, and receiving account. A subject line alone is never trusted.
- Delivery boundary: The job has one attempt. A partial failure is recorded and
  must not be automatically retried because SMTP delivery may already have
  occurred. The generic due queue excludes this job type, and the exact plan is
  durably recorded before the first SMTP call. Every send uses a deterministic
  Message-ID and records planned plus acknowledged or uncertain evidence. An
  unresolved uncertain delivery blocks a later demo.
- Audit boundary: The workflow records its GitHub actor, run ID, attempt, main
  ref, and commit SHA. System events keep `actorUserId` null unless a verified
  app identity exists. The demo does not grant workspace membership, and
  GitHub logs contain only aggregate status and counts. The deployed Vercel
  commit must equal the approved workflow SHA before any delivery begins.
- Reconciliation boundary: A separate protected workflow may consume a
  one-time database-backed token to recheck only the acknowledged deliveries
  from one completed demo. It may search the receiving Gmail account's Inbox,
  All Mail, and Junk special-use folders by the exact planned or provider
  Message-ID and persist matching test-only messages. It cannot call SMTP,
  create a new delivery plan, alter the stored demo result, or expose mailbox
  paths, addresses, bodies, credentials, or Message-IDs in workflow output.
  Special-folder scanning is demo-only, and reconciliation accepts only the
  message's own exact `Message-ID`, never a different message that references
  it. Unresolved exact messages complete the diagnostic; missing acknowledged
  events, an IMAP failure, or incomplete required-folder coverage do not.
- Consequences: The same deployed code path proves outbound SMTP, inbound IMAP,
  threading, tenant scope, and procurement conversation storage without moving
  credentials into Bourne, GitHub, or operator scripts.

### 2026-08-23 - Customer settings and logistics use customer-owned operational data

- Status: accepted
- Owner: product and engineering
- Context: Customer Settings was intentionally empty to protect the admin
  boundary, but that also prevented customers from correcting their own
  company and logistics setup. Logistics could render attributable public
  research without a customer-confirmed operating base.
- Decision: Customer Settings is a separate customer-only product surface. It
  exposes the signed-in account as read-only and permits workspace editors to
  maintain only their company website and operating base. It does not reuse or
  link to admin company, account, connector, email, channel, or office controls.
- Logistics gate: Logistics remains locked until the latest published Supply
  snapshot contains a `customer-base` facility with a name, street address,
  city, and two-letter country code. Public research and demo data cannot
  satisfy this gate.
- Revision boundary: Customer base changes and sourcing item edits or removals
  clone the latest published snapshot, preserve provenance, and publish a new
  immutable version. Removing an item also removes its dependent snapshot rows
  from the new version. Prior snapshots and saved research remain audit history.
- Authorization boundary: Every read and mutation resolves the authenticated
  Office and explicit workspace membership. Viewer customers remain read-only;
  editors and owners can manage only assigned workspaces.
- Supersedes: The 2026-08-22 decision that customer Settings stays empty is
  superseded only for these customer-owned profile and operating-base fields.
  All admin restrictions remain in force.

### 2026-08-24 - Manual company profiles remain explicitly unverified

- Status: accepted
- Owner: product and engineering
- Context: Customer tenants without a usable public web presence could not
  reach sourcing because the profile route only supported public research.
- Decision: The authenticated workspace editor may submit an explicit manual
  `SupplyCompanyResearch` payload through the existing edit-authorized route.
  The existing parser remains the input contract. The server rewrites every
  manual claim to `basis: inferred`, `confidence: low`, and `sourceUrls: []`,
  sets `status: partial`, removes findings and evidence, and adds a warning
  that the profile was supplied by the tenant and not verified against public
  sources.
- Persistence boundary: The profile is retained as an operator-input record
  with no source URI. It must not create an official-website attribution or
  fabricated evidence entry. Empty POST bodies retain the public research path.
- Location boundary: An optional tenant-supplied website is retained as
  context, not official evidence. An optional primary location populates both
  the headquarters claim and a headquarters location with no coordinates, so
  downstream planning can use the location without treating it as verified.
- Consequences: Customers can submit sourcing context for synthetic or
  private companies while the interface and stored provenance prevent the
  context from being mistaken for verified public research.

### 2026-08-24 - Customer offices sign in by username, harvest egress is guarded

- Status: accepted
- Owner: engineering
- Context: Each customer gets its own office tenant (Maneks first). Reusing an
  operator email across two offices made password login ambiguous and email
  code login resolve to the wrong tenant, and the lead generation harvest
  fetched arbitrary URLs taken from third-party search result pages.
- Login decision: A customer office admin is identified by a username, stored
  as `<username>@office.derya.invalid`. `resolveLoginIdentifier` maps a typed
  username onto that address, `isLoginEmailAllowed` accepts the reserved domain
  without adding the account to the operator allowlist, and both the code
  request and code verification paths reject the reserved domain. Only the
  password path can authenticate a customer office, so no sign-in code is ever
  addressed to an undeliverable mailbox.
- Provisioning boundary: `scripts/create-production-office.ts` accepts
  `PRODUCTION_ADMIN_USERNAME` instead of `PRODUCTION_ADMIN_EMAIL`. The same
  script stays the single entry point for creating an office, its admin, its
  company, and its primary workspace.
- Egress decision: `src/lib/leadgen/fetch-guard.ts` is the only way harvest
  requests leave the process. It permits http and https, rejects embedded
  credentials and non-web ports, rejects `localhost` and internal hostname
  suffixes, and rejects any host whose resolved addresses fall in loopback,
  link-local, carrier-grade NAT, multicast, or private ranges. Redirects are
  followed manually so every hop is validated, which also closes DNS rebinding
  through a redirect chain.
- Consequences: Lead sourcing can keep reading the open web without an explicit
  per-domain allowlist while internal network space stays unreachable, and each
  customer tenant has a login that cannot collide with operator accounts.

## 2026-08-24: Egress addresses are validated at connect time

- Decision: Harvest requests do not use global `fetch`. They go through
  `guardedRequest`, which drives `node:http`/`node:https` with a custom DNS
  `lookup` that rejects private, loopback, link local, CGNAT, and reserved
  addresses.
- Rationale: Validating a hostname and then letting `fetch` resolve it again
  leaves a rebinding window where a short TTL record can answer publicly for the
  check and privately for the connection. Resolving inside the connect path
  means the validated address is the dialed address.
- Consequences: Any new outbound crawling in the leadgen pipeline must use
  `guardedRequest`, not `fetch`. Response bodies are size capped and oversize
  responses reject rather than hanging.

### 2026-08-25 - Research and prospect data lives in Supply OS

- Status: accepted
- Decision: Surface office-scoped research and prospect records inside Supply
  OS panel 01, Sourcing & prospecting, rather than standalone Research and
  Leads pages.
- Consequence: Legacy routes redirect into the panel, while the canonical
  Leads directory remains available through an explicit panel affordance.

### 2026-08-25 - Context prospecting is bounded and review-only

- Status: accepted
- Decision: Context prospecting drafts require explicit operator intent and
  confirmation. The confirmed runner uses deterministic query planning and
  guarded public-page requests, with persisted bounds and resume offsets.
- Data boundary: Results are written only to the authenticated office's
  research list. They do not create Company or Contact rows, outreach, messages,
  threads, or sender-account records.
- Access boundary: Customer-access sessions cannot create or run prospecting
  actions. Public research does not imply that anyone was contacted.

### 2026-08-25 - Derya publishes supplier research shortlists to Bourne

- Status: accepted
- Owner: product and engineering
- Decision: When explicitly enabled, supplier research moves into Derya and
  uses the tenant's own model credits. Derya queues research in the existing
  office-scoped Supply OS capability-run system and publishes a read-only
  shortlist to Bourne.
- Ownership boundary: Bourne remains the single writer of `order_vendors`,
  drafts, `procurement_communication_messages`, and related workflow
  operational records. Bourne also owns claim and lease behavior, Inbox
  approval, and final operational state.
- Safety boundary: Derya does not create quotes, purchases, commitments, or
  supplier communication. Its RFQ output is always draft-only and no-send.
- Trigger boundary: New submissions start a best-effort Derya enqueue without
  blocking the customer response. A bounded cron backstop scans active orders
  with no suppliers and reports skipped incomplete or unauthorized work.
- Rollout boundary: The first rollout intentionally runs both engines in
  shadow. Bourne skips its own discovery only after consuming a Derya
  shortlist.
- Consequence: Bourne may consume the Derya shortlist before falling back to
  its existing research without changing its operational ownership.

## 2026-08-25: Automatic supplier replies stay deterministic and confirmed

- Status: accepted
- Owner: product and engineering
- Decision: An inbound supplier message may be answered from context only when
  every topic it raises maps to a fact recorded on the sourcing request. The
  answer text is generated from those facts by template, not by a model.
- Safety boundary: Price, payment terms, contracts, and legal or compliance
  topics are never answered automatically, regardless of stored context.
- Escalation boundary: A missing fact, an unknown topic, a wrong recipient
  notice, or a statement without an answerable question marks the thread as
  needing a human reply in Messages.
- Send boundary: Triage only prepares an editable draft. Supplier delivery still
  requires the existing explicit confirm send gate, sender account selection, and
  idempotency controls.
- Consequence: The feature cannot invent quantities, dates, or specifications,
  and it cannot send on its own.
## 2026-08-25: Leadgen search providers and directory evidence

- Status: accepted
- Owner: product and engineering
- Decision: Lead generation keeps deterministic query planning and normalizes
  all search providers through one host and domain filter. HTML search remains
  the offline-safe default, Serper is opt-in through its environment key, and
  JSONL supplies deterministic externally collected results.
- Evidence boundary: Directory mode expands one fetched document into many rows,
  each carrying the exact source URL and row index. It is explicit and does not
  change existing single-company harvesting.
- Safety boundary: Search requests use the existing egress guard, tests use
  hand-written fixtures, and no provider key or production data is stored.

## 2026-08-25: Mailboxes are shared, mail ownership is routed

- Status: accepted
- Owner: product and engineering
- Decision: Connected mailboxes are one application wide pool. Any office may
  send from any enabled mailbox, and a mailbox is stored once, never duplicated
  per office. `EmailAccount.officeId` survives only as connection provenance.
- Ownership boundary: The office that owns a message is the office that owns its
  thread, resolved deterministically from local thread identity, RFC references,
  the RFQ subject reference, then unambiguous outbound participant history. The
  mailbox never confers ownership.
- Ambiguity boundary: When provenance is missing or points at more than one
  office, the message stays unrouted rather than being guessed into an office.
  Unrouted mail is hidden from office views, memory, and CRM touches.
- Admin boundary: Administrators read one unified mail log across all companies
  and offices, with a company filter and an explicit `Unrouted mail` option.
  Non admin users stay office scoped.
- Capacity boundary: Daily send limits and reservation serialization are global
  per mailbox, so sharing cannot multiply a mailbox limit by the office count.
- Consequence: One mailbox pool serves every customer without cross office mail
  leakage, and unmatched inbound mail surfaces only to the administrator.

## 2026-08-26: The sourcing loop plans deterministically and sends only on confirmation

- Status: accepted
- Owner: product and engineering
- Decision: A sourcing request advances through repeated autopilot passes whose
  per supplier action is decided by a pure function over thread state, triage
  and draft state. No supplier facing action may happen for a reason that is not
  encoded in that plan.
- Context boundary: Every automated reply and follow up is built from the
  request's own linked and screened documents, so context and attachments never
  depend on an operator restating them.
- Send boundary: Sending is off unless the caller supplies the explicit send
  confirmation phrase. The scheduled pass drafts and reports only.
- Escalation boundary: Bounces, wrong contact notices, and anything touching
  price, quantity, dates, terms or legal wording reach an operator instead of a
  supplier, even while sending is on.
- Completion boundary: A request is PO ready only when enough recorded supplier
  quotes exist. Replies, interest and drafts never count as quotes.

## 2026-08-25: A sourcing instruction is parsed deterministically, not interpreted

- Status: accepted
- Owner: product and engineering
- Decision: Operator sourcing instructions of the form "find N more in each
  category and send" are parsed by a deterministic pattern that yields the
  count, the per category scope and whether a send was requested. The model
  never decides that suppliers should be crawled or contacted.
- Bound: The count is capped, the work runs in slices as a queued job, and one
  dedupe key per workspace means a repeated instruction cannot double the crawl
  or the outreach.
- Authorization: In the context chat the operator who typed the instruction is
  the authorization, recorded on the job with their user id and the verbatim
  instruction. The admin API is a secret rather than a person, so it keeps
  requiring its explicit confirmation phrase.
- Category boundary: Files attached to an RFQ must belong to the request and to
  the request's own sourcing category. Out of category files are withheld with a
  reason rather than sent, so a board BOM cannot reach a foam molder and mold
  geometry cannot reach a board shop.

## 2026-08-26: Leadgen profiles resolve through one deterministic registry

- Status: accepted
- Owner: product and engineering
- Decision: Leadgen commands resolve a named profile through
  `src/lib/leadgen/registry.ts`. Regular commands default to `maneks`, while
  corridor commands default to `maneks-corridor`; an explicit `--profile`
  overrides either default.
- Context boundary: Query planning, harvesting, scoring and persistence receive
  the resolved profile, while office and persistence scoping remain unchanged.
- Failure boundary: Unknown profile slugs fail before command work begins and
  list the valid profile slugs.

## 2026-08-26: Leadgen search attribution is durable

- Status: accepted
- Owner: product and engineering
- Decision: Default leadgen search tries free HTML engines in the fixed order
  DuckDuckGo, Brave and Bing, then uses Serper only when the free result pool
  is below the configured threshold. Explicit provider overrides remain direct.
- Provenance boundary: Every candidate carries the provider, engine, rank and
  original source URL from its search hit. Directory candidates use the
  document URL that produced the row, while `discoveredVia` remains the query.
- Storage boundary: Every candidate becomes a `LeadDiscovery` row, including
  below-score and no-usable-email skips. `LeadGenRun` stores office-scoped
  lifecycle counters and provider statistics, and the admin report reads only
  the session office.
- Shared persistence boundary: both CRM load and context research upsert paths
  call the same discovery recorder. A discovery's `contactFound` means any
  extracted email, while `usableContact` means the verification gate passed.
  Search call statistics are returned per call, and provider identities retain
  the HTML engine.

## 2026-08-28: Office provisioning uses one shared transaction

- Status: accepted
- Owner: product and engineering
- Decision: Office provisioning is implemented through one shared
  `provisionOffice` function. The in-app route, direct production script, and
  GitHub Actions workflow all use it.
- Authorization boundary: In-app provisioning is gated by the login allowlist,
  requires an active `ADMIN` operator session, and rejects reserved customer
  username identities.
- Tenant boundary: Office, user, company, workspace, and membership writes
  remain scoped by `officeId` where the schema supports the relationship.

## 2026-08-31: Dedicated token-authenticated ops surface

- Status: accepted
- Owner: product and engineering
- Decision: Add a dedicated token-authenticated ops surface for office
  provisioning and research-list import so shell operators can use the
  deployed app without a browser session.
- Authentication boundary: Both routes accept only the
  `OPS_PROVISIONING_SECRET` bearer token, with a minimum length of 32
  characters. Procurement and cron secrets are not accepted.
- Tenant boundary: Office resolution by name is followed by office-scoped
  provisioning or research-list operations using `officeId`.
- Human boundary: The in-app `New office` action remains the primary route for
  human operators, with the direct script and GitHub Actions paths retained as
  fallbacks.

## 2026-09-02: Batch approval reviews a bounded spot check of a pinned batch

- Status: accepted
- Owner: product and engineering
- Decision: One approval covers a whole outbound batch (an outreach campaign
  audience or a bulk RFQ run), never one recipient at a time. The reviewer sees
  a bounded sample (`spotCheckSample`: the first 3 rows plus 7 rows spread over
  the rest, seeded by the batch's own revision or batch hash) with the exact
  rendered message each sampled recipient gets, and deterministic quality
  counts over the full audience (`summarizeRecipientQuality`: repeated
  domains, role mailboxes, free mail, duplicates, invalid syntax).
- Scope boundary: What is approved is the hashed set, not the sample. Outreach
  keeps the existing campaign revision hash, and the proposal pins the
  revision the plan rendered its review items from (a draft saved on another
  revision is a tool error, not a proposal). Bulk RFQ previews return a
  `batchHash` over vendor id and address plus, per target, the subject and
  body exactly as the send renders it (greeting name included) and the
  attachment digests; a send that carries the hash is refused
  (`BulkRfqBatchChangedError`, HTTP 409) before any sender is reserved when
  either the batch or what it would send any target differs. A preview that
  cannot resolve the file package fails rather than reviewing without files.
  Rule: whatever goes into a supplier-facing or customer-facing message must
  be in the hash the approval pins, and preview and send compute that hash
  from the same inputs with the same function.
- Exclusion boundary: A reviewer can strike recipients (`excludeEmails` on
  campaigns, `excludeVendorIds` on bulk RFQ). Exclusions are part of the
  planned filters and the hash, so an approval after an exclusion cannot reach
  the struck row, and struck rows stay eligible for a later, separately
  reviewed batch. Identifiers in exclusions are normalized (trimmed,
  lowercased) at every boundary and compared normalized against the rows, so
  the letter case of a copied id can never reopen a struck recipient.
- Quality boundary: Quality signals are advisory. They never block a send and
  never replace suppression, sender reservation, or the late suppression check.
- Review boundary: A batch approval is only reachable from a surface that
  renders the pinned review content in full (action details and every
  spot-check email) before the apply control, and the apply is refused
  server-side while any spot-check item has not been marked read. Outreach
  proposals are approved in the Outreach desk Pending approvals panel; a chat
  command such as `apply <id>` or the greenlight phrase redirects there and
  never activates a campaign. Global proposals without a job or inquiry page
  must not be applied through a surface that shows only a title. A proposal
  whose stored review items carry no rendered message (planned before spot
  checks existed, or with no items) cannot be started from any surface; it is
  shown with its reason and can only be discarded and re-planned.
- Scope and roles: outreach approvals are office shared. What the review
  surface lists is what an approver can start or discard, so the apply lookup
  is office wide (the reviewer is still recorded). Starting or discarding a
  campaign requires ADMIN or MANAGER, the same roles that approve procurement;
  SALES plans campaigns and reads the pending list but does not activate
  external sends. Rights are resolved from the current `User` row (active,
  stored role) at action time, never from the session cookie alone.
- Decision boundary: A proposal decision is a compare-and-set from `PENDING`.
  A decision with an external side effect claims the proposal first
  (`APPLYING`), performs the side effect, then finalizes; a blocked or failed
  side effect releases the claim. Exactly one concurrent Start or Discard can
  win, and the loser reports "no longer pending" with no side effect. A
  review surface passes its proposal `kind` so it can only decide proposals it
  was built to render. The side effect itself is a compare-and-set from the
  reviewable state (`DRAFT` for campaigns) that stamps a durable marker
  (`approvedAt`), so approval can never restart a cancelled, paused, or
  finished target. A claim must be recoverable across process death: the
  review surface settles claims older than a bounded window by reading that
  marker, finalizing the proposal when the side effect happened and releasing
  the claim when it did not, never by re-running the side effect.
- Ownership boundary: A claim is identified by the request that made it, not
  by the `APPLYING` status alone. The claim timestamp (`reviewedAt`) is the
  ownership token: every release and finalize predicate carries the exact
  value written at claim time, recovery clears it and a new claim replaces
  it, so a request whose claim was released or re-taken can no longer touch
  the proposal. The side effect and the proposal finalize commit in one
  database transaction, and a finalize that finds the claim gone rolls the
  side effect back. Rule: a slow request must be unable to complete an
  external action after recovery or a colleague has already decided the
  proposal.
- Existence boundary: Whether an office has pending approvals is itself
  privileged. Access is resolved from the live `User` row before any
  office-wide lookup, on every surface including chat commands; a caller
  without view access is only ever matched against proposals it owns.
- Non-goal: No separate approval model. Outreach stays on `AgentProposal`
  review items; procurement stays on the secret-guarded admin route until the
  procurement workspace grows a review surface for it.

## 2026-08-31: Supplier state reconciles the workflow receipt with the thread

- Status: accepted
- Owner: engineering
- Decision: Supplier contact and response reads take the workflow receipt as
  authoritative and fall back to counting messages in the connected email
  thread, labelled as thread evidence rather than a recorded receipt.
- Evidence boundary: Thread derived counts never set `contacted` or a response
  count on a vendor record. They only describe what the connected mailbox shows,
  so an operator sees why two surfaces disagree instead of one silently winning.
- Qualification boundary: Candidates stay unqualified regardless of thread
  activity.

## 2026-09-01: Outreach approval pins audience and campaign revision

- Status: accepted
- Owner: product and engineering
- Decision: Campaign approval reuses `AgentProposal` and `apply <id>`, while
  each proposal carries a revision hash over the reviewed message, filters,
  sender, cap, and audience id set.
- Approval boundary: The campaign stores the approved audience record ids at
  activation. Later imports or edits cannot silently expand the approved
  recipient set, and a changed draft must be planned again.
- Sender boundary: Every campaign pins one sender account because the sender
  mailbox pool is shared across offices.

## 2026-09-02: Delivery feedback is read from the synced inbox and suppression is office-scoped

- Status: accepted
- Owner: engineering
- Decision: Bounces, complaints, auto-replies, and opt-outs are detected
  deterministically from the inbound messages that Gmail and IMAP sync already
  store, before any AI classification. Each such message becomes one
  `EmailDeliveryEvent`; permanent bounces, complaints, and opt-outs also upsert
  an `EmailSuppression` row keyed by `(officeId, email)`.
- Tenant boundary: Suppression is a fact about an office's relationship with a
  recipient, so it is office-scoped even though mailboxes are a shared pool.
  One office's bounce does not block another office from writing to the same
  address. Sender pausing is per mailbox because reputation belongs to the
  mailbox.
- Outbound boundary: Every automated outbound path (campaign first touch,
  follow-up, bulk RFQ, supplier nudge) consults the office suppression list
  before reserving a sender. A suppressed recipient consumes no daily-cap slot
  and never reaches the provider. New outbound paths must call
  `listSuppressedEmails` the same way. Unknown stored reasons block (as
  `MANUAL`) rather than pass.
- Sender boundary: Two complaints, or at least 5 percent permanent bounces on
  10 or more sends, within 24 hours pauses the mailbox by setting
  `sendPausedAt`. A paused mailbox is excluded from the sender pool but keeps
  syncing inbound mail so replies and further feedback still arrive. Resuming
  is an operator action.
- Non-goals: Transient bounces and auto-replies are recorded for visibility but
  never suppress. Provider webhooks and paid verification remain separate,
  later decisions.

## 2026-09-02: Delivery feedback is attributed by outbound evidence, and completion is marked last

- Status: accepted
- Owner: engineering
- Decision: A delivery report is attributed to the office whose outbound
  message it concerns. Thread routing (local thread, RFC references, RFQ
  reference, participant history) decides first. For a report that reaches a
  shared mailbox unthreaded, the mailbox's own outbound history for the
  affected addresses is consulted: exactly one office is a unique origin and
  receives the event and the suppression; several offices, or none, mean the
  event is parked on the connecting office for manual routing and no
  office-scoped suppression is written. The connecting office's `officeId` is
  never a reason to suppress on that office's behalf.
- Rationale: Suppression is office-scoped precisely so one tenant's history
  cannot leak into another's outbound behavior. Guessing an owner from mailbox
  ownership would suppress the wrong tenant, and suppressing every candidate
  office would reveal that other offices mailed the same address.
- Sender protection is exempt: mailbox reputation is a mailbox fact, so bounces
  and complaints count toward pausing regardless of attribution.
- Completion marker: `EmailMessage.deliveryKind` is set only by
  `recordDeliveryFeedback`, after event, suppression, and sender protection
  succeed. `classification = DELIVERY_FEEDBACK` with `deliveryKind = null` is
  the durable "not finished" signal that the next sync of the same provider
  message retries. Sync code must not write `deliveryKind` itself.
- Limits count sendable recipients: suppression is applied before any per-run
  limit in bulk RFQs, supplier nudges, and outreach campaign first touches.
  Suppressed rows are reported but never occupy a limit slot, a daily-cap
  slot, a sender reservation, or a send attempt.
- Batch results report the ledger after the run: a runner's outstanding or
  remaining count is re-read once its sends, skips, and released claims are
  written, never returned from the pre-send plan.
- The provider call is the suppression boundary: every outbound runner (first
  touch, follow-up, bulk RFQ, nudge) rechecks the office-scoped suppression for
  the exact recipient after its sender reservation and immediately before the
  provider call. Planning-time snapshots only decide what occupies a limit
  slot; they never authorize delivery. A late hit releases the reservation and
  settles only the current run's claim with a deterministic reason.
- Delivery reports are judged per recipient: a DSN's permanence is decided
  block by block from that recipient's own Status, Diagnostic-Code, or SMTP
  code before any wording, and transient evidence beats a generic failure
  subject. Only permanently failed recipients are suppressed; transient
  recipients on the same report are recorded, never suppressed. Recipient
  intent must be recipient-authored: `not-spam` feedback is not a complaint,
  and opt-out wording carried in an inherited `Re:`/`Fwd:` subject or a quoted
  block is campaign copy, not a request to stop.

## 2026-09-02: Outreach follow-ups are a per-step ledger inside the approved campaign

- Status: accepted
- Owner: product and engineering
- Decision: Follow-up steps are part of the campaign draft that the operator
  approves, hashed into the campaign revision, and executed by the same cron
  batch as first touches. Each `(campaign, record, step)` is one row in
  `OutreachCampaignFollowUp`, claimed through its unique key and sent with its
  own sender-pool idempotency key.
- Approval boundary: No follow-up copy is sent that was not in the reviewed
  proposal. Changing a step requires planning the campaign again.
- Sequence boundary: Only a `SENT` step advances a sequence. A reply on the
  linked local thread, a rejected or unknown delivery, or a suppressed recipient
  ends it, and the skip reason is recorded rather than retried.
- Capacity boundary: Follow-ups share the campaign daily cap and the sender-pool
  reservation with first touches, so adding steps never multiplies mailbox load
  past the approved cap. Both ledgers are counted together (`SENT` today plus
  live `QUEUED` claims) under one per-campaign advisory lock, and a run's
  `limit` is one budget across first touches and follow-ups.
- Delivery boundary: An `UNKNOWN` delivery with a live reservation is neither
  success nor failure. The campaign stays `ACTIVE` until the provider confirms
  `SENT` or the row has been `NOT_FOUND` for 24 hours, at which point the
  reservation is released and the row is recorded as `REJECTED`. A confirmed
  recovery records the reservation's `createdAt` as `sentAt`, so sequence timing
  follows delivery rather than the cron run that noticed it.
- Claim boundary: A `QUEUED` claim exists only for the run that took it. When a
  run stops early (campaign paused or cancelled, sender pool empty), it deletes
  every remaining `QUEUED` row it claimed so first touches and follow-ups can
  reuse that capacity immediately instead of waiting for the stale-claim window.
  Only capacity refusals (`POOL_EXHAUSTED`, `POOL_EMPTY`) release a claim this
  way. Any other sender-pool refusal settles the claim with an outcome: a
  `DELIVERY_UNCERTAIN` refusal with an open `RESERVED` reservation under the
  row's idempotency key records `UNKNOWN` linked to that reservation (so the
  reconciliation path above settles it), and everything else records
  `REJECTED`. A claimed row never disappears while a reservation for it exists.
- Reply boundary: A human reply is an `INBOUND` message in the linked thread
  whose `classification` is not `DELIVERY_FEEDBACK`. `deliveryKind` alone is not
  the test: it stays null while feedback persistence is unfinished and being
  retried, and a transient bounce or auto-reply in that state must not end a
  sequence as `REPLIED`.
- Pause boundary: The sender-pool reservation is not the last check. The
  provider's send-account lookup refuses a mailbox whose `sendPausedAt` is set,
  so a reputation pause that lands between reservation and delivery still stops
  the email. That refusal releases the reservation and is never a
  reauthentication prompt; reconciliation of earlier sends stays available
  while the mailbox is paused. How the recipient is handled afterwards (first
  touch rerouted, follow-up deferred) is the 2026-09-03 decision above; it is
  not a `REJECTED` outcome.

## 2026-09-02: Ops campaign actions reuse human approval

- Status: accepted
- Owner: product and engineering
- Decision: The authenticated outreach ops endpoint is not a new approval
  authority. It records a real ADMIN user as approver, requires the exact
  confirmation phrase `send outreach campaign`, and calls the existing
  `activateCampaign` flow with its stale revision guard.
- Safety boundary: The endpoint does not license unattended sending or bypass
  existing approval, sender reservation, daily cap, pinned audience, sender
  pinning, or ACTIVE-state guards. A future agent must not interpret it as
  permission to send without human instruction.

## 2026-09-02: Office mail is an operator-only projection

- Status: accepted
- Owner: engineering
- Decision: Supply OS exposes persisted email threads through an office-scoped
  Mail projection for operator accounts only. Customer and employee contexts
  are denied at the domain boundary even when other workspace surfaces are
  available.
- Access boundary: Authorization is re-read from the database on every call,
  so a deactivated or demoted account loses Mail immediately, and an operator
  restricted to their own workspaces needs whole-office access, ADMIN, or
  MANAGER to read office-wide threads.
- Evidence boundary: The projection reads stored text bodies and existing
  company and contact links. It never renders stored HTML or sends mail.
  Threads that inbound routing could not attribute to an office stay in the
  admin mail log instead of appearing under a company.
- Mailbox boundary: Because sender accounts are pooled across offices, the
  displayed mailbox is the sender of the newest outbound message, while thread
  and message reads remain scoped by the owning office.

## 2026-08-31: Supplier file replies are rechecked against live state at send time

- Status: accepted
- Owner: engineering
- Decision: A saved supplier file bearing draft is only delivered when the
  sourcing request state it was written from still matches live records. The
  state fingerprint is stored in the immutable execution task input at draft
  time and recomputed inside the send path, before any provider call.
- Safety boundary: The recheck fails closed. A missing fingerprint, a changed
  request, or a recheck that cannot complete all refuse delivery. This does not
  replace the existing operator confirmation, supplier qualification, thread,
  recipient, or idempotency guards, and it is not permission to send without
  human instruction.
- Scope boundary: Unrelated changes must not block a send. Supplier contact
  edits, request progress changes, other suppliers' drafts, unrelated company
  documents, and elapsed time are covered as negative controls in
  `scripts/state-recheck.test.ts`, which fails CI if a stale send escapes or an
  unrelated change is blocked.

## 2026-09-04: A supplier conversation task transitions under a row lock

- Status: accepted
- Owner: engineering
- Decision: Every write to `ProcurementConversationTask` reads its current
  retry state and writes the next one inside one transaction that holds
  `SELECT ... FOR UPDATE` on that thread's row. Two passes that overlap on the
  same supplier therefore serialize, and both failures count. A pass that finds
  no row creates it, and a create that loses the unique key race is retried
  once so the loser locks the row the winner created.
- Safety boundary: The lock is per conversation, not per request, so one slow
  thread never blocks another supplier's retry, and every statement stays
  scoped by `officeId`.
- Scope boundary: Retry state lives in the task row only. Supplier facing
  payloads stay authoritative in saved drafts and idempotency records, so a
  retry can change the mailbox it sends from but never the text a supplier
  receives.
- Verification: `scripts/procurement-conversation-task-database.test.ts` starts
  two concurrent failed transitions against the same task and asserts the
  attempt count reflects both.

## 2026-09-04: A pinned sender that cannot send is reported separately from an empty pool

- Status: accepted
- Owner: engineering
- Decision: `reserveEmailSender` distinguishes the shared pool having no
  connected sender (`POOL_EMPTY`) from the single mailbox a send is pinned to
  being unable to send (`SENDER_UNAVAILABLE`), and the pinned case names the
  condition: paused by sender protection with its reason, sending turned off,
  disabled, disconnected, or missing.
- Safety boundary: the pinned lookup reads only that mailbox's send state and
  never widens the pool a send may leave from, so an approved thread still sends
  from the mailbox that owns it.
- A shared pool whose connected mailboxes are all paused or have sending turned
  off also reports `SENDER_UNAVAILABLE`, since the fix is to resume a mailbox,
  not to connect one. `POOL_EMPTY` now means nothing is connected at all.
- Sender protection can pause or resume a mailbox mid reservation, so the state
  read and the filtered candidate lookup run as a bounded loop
  (`PINNED_SENDER_STATE_READS`): a mailbox that reads as sendable is looked up
  again, and the reason returned comes from the read that ended the loop. The
  bound keeps a mailbox flipping state from holding the shared pool lock.
- Scope boundary: callers treat `SENDER_UNAVAILABLE` as deferred capacity, not
  as a refusal, because sender protection pauses are reversible. A recipient
  therefore stays owed and retryable instead of being settled as rejected.
- Verification: `scripts/email-sender-pool-database.test.ts` reserves against a
  paused pinned mailbox and asserts the code and the pause reason;
  `scripts/email-sender-pool.test.ts` covers every reason branch and asserts
  each caller defers rather than refuses.

## 2026-09-04: Paid leadgen providers are advisory layers over deterministic checks

- Status: accepted
- Owner: engineering
- Decision: Email verification and named-contact enrichment are injected
  interfaces (`MailboxVerifier`, `ContactEnricher`) with the deterministic
  path as the default. The heuristic verdict (syntax, disposable, free
  provider, company domain, MX, role) is always computed first; a provider may
  sharpen it to `deliverable`, `risky` or `undeliverable`, but a missing key,
  an error, a timeout, a malformed payload, an `unknown` status or exhausted
  credits leave the heuristic verdict in place with a reason appended. A
  provider outage or a spent free tier therefore degrades quality, never
  availability, of prospecting.
- Provider selection is by environment key only (`BOUNCER_API_KEY`,
  `HUNTER_API_KEY`) and callers may pass `null` to opt out. Provider calls are
  bounded per run (verifier cap per company, `maxEnrichments` per batch,
  request timeouts, memoization) and their usage is recorded on the run so
  spend is visible before it bites.
- Safety boundary: Enrichment runs after discovery on fit-qualified domains
  only and never sends anything. Enriched addresses enter the same
  verification, suppression, `officeId` scoping and batch approval path as
  harvested ones. Provider credentials and raw payloads are never logged;
  contact evidence (source URLs, confidence, provider, timestamp) is kept in
  `sourceRefs` for provenance.
- Verification: `scripts/leadgen.test.ts` and
  `scripts/supply-os-context-prospecting.test.ts` cover every provider state
  with mocked transports and delete both keys from `process.env` so a
  credentialed machine or CI never spends credits.
