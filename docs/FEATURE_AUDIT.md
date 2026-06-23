# Derya Feature Audit

Last audited: 2026-06-21

## Working Now

- Job workbench loads a focused job, timeline, documents, rates, quote lines, email threads, and the agent sidecar.
- Agent can inspect readiness, create next-action plans, find stale follow-ups, draft customer updates, search records, summarize rates/offers, update jobs, move stages, and draft replies.
- Carrier quote comparison works when quotes exist; selecting a carrier quote updates job cost.
- Customer quote PDF preview works from the workbench.
- Stage email panel can draft stage-specific emails with AI and save/log outbound drafts.
- Portal links work and now show document open links when real document URLs exist.
- Document status transitions work. AI analysis runs on approval when the document has a real URL.
- Job documents can be uploaded as real files into local private storage and viewed through the authenticated document endpoint.

## Fixed In This Pass

- Agent sidecar is now collapsible instead of permanently eating the right side of the dashboard.
- Agent controls are compact; the old oversized 2x2 blocks made the activity feed harder to scan.
- Warm beige/pastel palette is back, with muted sage/clay accents instead of harsh dark blue/red accents.
- Loud tech gradients are suppressed on the main job surfaces; the app now reads closer to a freight control center than a generic SaaS demo.
- Favicon and product mark now use the same warm identity.
- Job note, customer portal, draft email, and counter-offer UI are on shared modal/composer classes instead of inline one-off styling.
- Pasted RFQs are no longer treated as mature when required shipment facts are missing.
- When pasting freight messages while focused on a job, the agent now creates a reviewable diff proposal and waits for `apply update <id>` before writing. It no longer silently mutates operational data.
- Pending agent paste proposals now appear on the Job page with proposed changes, skipped existing fields, readiness state, and Apply/Discard actions.
- Agent proposal review now supports per-field accept/reject with current value, proposed value, and source paste excerpt when available.
- Inbox now has an explicit contact approval flag plus an "Approved contacts" filter. The old worked/in-progress-company inference remains as a compatibility fallback.
- RFQ conversion is server-gated by maturity. Missing weight/DG/customs/FCL-LCL details/target answer blocks job creation and forwarder handoff.
- Missing-info customer drafts can be generated from an immature RFQ and copied/reviewed before sending.
- Target price changes now write to `TargetPriceHistory` across RFQ edit, manual RFQ creation, pricing desk updates, job edit, new job creation, agent proposals, and email-populate flows.
- The old fake forwarder fan-out was disabled. Mature RFQs now hard-stop with a configuration note until real sender, signature, and forwarder directory details exist.
- Pricing Desk now has a real forwarder directory and can generate saved, reviewed outbound RFQ drafts for mature RFQs. It still does not send.
- Pricing Desk can now send reviewed forwarder drafts one by one from allowed Gmail senders only: mert@usederya.com or oguzhan@usederya.com. Successful sends create a pending forwarder quote row.
- Desk now has a small "Needs attention" queue for immature RFQs, mature RFQs waiting for forwarder drafts, and inbound threads awaiting reply.
- RFQ and Job pages now show internal target-price history instead of hiding the audit trail in the database.
- The dark “Control desk” hero is now a quieter job summary panel.
- The workbench no longer tells users to “use the agent” for carrier rates while hiding the working form. The rate form is now in the carrier section.
- Disabled “Send to customer” placeholder is now a working jump to the email composer as “Compose customer email.”
- Customer portal documents now show real “Open” links when a URL exists, and “File pending” when it does not.

## Minimum Scope Status

Status against the current product priority list:

| Priority | Item | Status |
| --- | --- | --- |
| -3 | WhatsApp API | Blocked by external setup. Backend first version exists for Meta webhook verification, signed inbound ingest, RFQ classification/linking, and session-protected outbound text. Production use still needs Meta credentials, a public callback URL, and UI review controls. |
| -2 | Paste many messages into chatbox and update relevant records | Working first version. Scoped job paste parses explicit facts, preserves existing fields, reports missing fields, and creates a visible Job-page proposal with per-field accept/reject. |
| -1 | Pull product data from Google Sheets | Blocked by external setup. Importer first version exists for the provided `Andelog Derya Yük Takip` sheet: `06/2026 Talepler` becomes RFQs and `Operasyonlar` becomes Jobs with customer, cost, revenue, margin, route, mode, and status. Production sync still needs credentials, sharing access, and conflict rules. |
| 0 | Inbox filters for approved/known people | Working first version. `Contact.isApprovedForInbox` exists, CRM can toggle it, and the inbox filter uses it with legacy CRM-status fallback. |
| 1 | Mature incoming RFQs before forwarding | Working first version. Required fields and target-price/no-target answer gate RFQ maturity in UI, server conversion, queue actions, and agent readiness. Missing-info draft is wired. |
| 2 | Split incoming mails under Jobs by job and criticality | Working first version. Inbox has thread, by-load, and RFQ views, then sorts active threads by explicit criticality scoring. Needs tuning after real mailbox use. |
| 3 | CBM from dimensions | Done for structured dimensions. |
| 4 | LCL non-stackable top-load toggle with warning | Done. |
| 5 | Simplify shipment timeline | Working first version. Main statuses show RFQ, Pricing, Booked/Waiting Cargo, En Route, Delivered. Customs/ETD/ETA remain in schema and legacy routes for compatibility. |
| 6 | Store target prices visible only internally | Working first version. Latest target remains on RFQ/job, material target changes write history rows, and RFQ/job pages show the internal history. |
| 7 | Take operations offline for now | Working first version. Reports/activity are out of main nav and visible customer/job surfaces; legacy routes/components remain for compatibility. |
| 8 | Focus product on sales + pricing communication | Working first version. Current nav is Desk, Inbox, Pipeline, Pricing Desk, CRM, Email/Admin. |
| 9 | Send approved RFQ to FF/carriers by API/email | Blocked by external setup. Reviewed email-draft/send path exists one forwarder at a time, gated by maturity and allowed senders. Production use still needs `mert@usederya.com` / `oguzhan@usederya.com` Gmail send scope and real forwarder recipients. Forwarder API send is deferred. |
| 10 | Visibility + arrangement; only mature RFQs go out | Working first version. Maturity enforcement exists before conversion and outbound handoff. Real forwarder send remains blocked until configured. |

## Still Placeholder Or Incomplete

- Email sending from the stage email panel is still a saved/logged draft flow, not guaranteed Gmail send. The UI should keep saying “draft” until direct send is wired for this flow.
- Document upload now works on the job workbench and dashboard with local private storage. Production storage is still not chosen.
- Forwarder email send is implemented but operationally blocked until the allowed Gmail sender accounts are connected and the directory has real forwarder recipients.
- Demo seed data still uses generated placeholder document PDFs. Fine for demos, not production evidence.
- Dashboard decision queue now shows proof gaps from the canonical decision brief, but ranking still needs real operating feedback after live inbox use.
- Agent proposals and agent-run events are durable enough for this local slice. They show prompts, tool calls, source preview/source evidence when available, decision impact, field-level accept/reject, reviewer, timestamp, and notes. Exact source spans from linked email bodies are still a later audit upgrade.
- External setup gates are now visible on Email & WhatsApp settings. They intentionally say setup required or blocked instead of pretending WhatsApp, Sheets, storage, or forwarder API work is production-ready.

## Next Working Versions To Build

- Add exact source-message spans to agent proposals created from linked emails, not just pasted text/source previews.
- Replace local document storage with production storage and signed file access.
- Wire stage email “Send” to `sendReplyToThread` when an existing thread exists, otherwise create a new outbound Gmail message flow.
- Add WhatsApp-based forwarder outreach/review after Meta credentials and target workflow are confirmed.
- Promote setup gates into an install checklist once the real Gmail, Sheet, WhatsApp, and storage resources are provided.
