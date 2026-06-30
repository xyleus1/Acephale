Status: current-state
Owner: engineering
Last-verified: 2026-06-23
Source-of-truth: `docs/COMPANY_BRAIN.md`, `src/lib/brain-ops/`

# Derya Brain

The brain is a source-grounded operating memory for Derya Freight OS. It helps answer what happened, what was promised, what risks exist, what decisions changed direction, and which source supports a claim.

It is not a magic chatbot memory, a fuzzy customer-merge system, or an autonomous write engine.

Data model:

- Existing canonical substrate: `KnowledgeSource`, `KnowledgeObject`, `KnowledgeChunk`, `EntityMention`, `MemoryEvent`, `AgentMemory`.
- Review substrate: `AgentProposal`.
- Brain Ops service layer: `src/lib/brain-ops/ingest.ts` and `src/lib/brain-ops/query.ts`.

Granola meeting notes:

- Use `source.source_type: "granola_meeting_note"` for pasted/exported Granola notes.
- Store the full note text in `source.raw_text` when policy allows it; otherwise store the Granola URL or internal reference in `source.source_uri`.
- Granola notes must include at least one of `source.raw_text` or `source.source_uri`.
- Add `operational_refs` to link the note to exact company, job, RFQ, or contact records.
- Supported refs include `company` by exact name/id, `job` by exact reference/id, `inquiry` by exact subject/id, and `contact` by exact email/name.
- Id-only refs are supported for `email_thread`, `email_message`, `job_document`, and `strategy_assessment`; email thread/message refs may also use provider external ids.
- Unmatched or ambiguous refs stay unresolved. Do not "fix" names or references by guessing.
- Re-running the exact same payload is idempotent and returns the existing source/proposal rows.

One write path:

- Use Brain Ops ingest for note/memo/manual payloads that need proposal review.
- Use established memory helpers only for product-backed canonical event/object writes.
- Do not write ad hoc brain records from random routes or scripts.

Calibration vs trusted:

- Calibration creates source/proposal rows for review.
- Trusted mode still requires review for decisions, commitments, pricing, legal, scope, and customer-facing claims.

Entity linking:

- Organization links use exact normalized names only.
- If no exact match exists, keep `unresolved_organization_name`.
- If an exact ref matches multiple non-unique records, keep it unresolved instead of picking the first row.

Source citations:

- Important facts need source metadata.
- Commitments, decisions, risks, and open questions need `source_quote` unless explicitly manual.

Human approval:

- AI may draft and propose.
- Humans approve trusted writes and risky customer-facing changes.

Adding a source:

1. Capture title, source type, optional URI/date, and raw text.
2. Build a Brain Ops ingest payload.
3. Run validation or calibration ingest.
4. Review proposals before applying any trusted business state.

Querying:

- Use `searchBrain`, `getOrganizationDossier`, `getOpenCommitments`, `getDecisionTimeline`, `getBrainSource`, and `getUnresolvedIngestProposals`.
- Use `getOperationalBrainContext` when a job, RFQ, or customer workflow needs related Brain Ops notes such as Granola meeting context.
- Return evidence with claims.
