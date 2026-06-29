Status: current-state
Owner: engineering
Last-verified: 2026-06-23
Source-of-truth: `src/lib/brain-ops/`, `docs/COMPANY_BRAIN.md`

# Brain Ops

Derya Brain Ops is the operating layer around the existing company-brain memory system. It makes business/product memory agent-legible, source-grounded, and reviewable.

The implementation uses the existing tenant-scoped memory substrate:

- `KnowledgeSource` identifies the source family.
- `KnowledgeObject` stores source and durable memory objects.
- `KnowledgeChunk` stores source text.
- `MemoryEvent` stores canonical event history.
- `AgentProposal` stores reviewable ingest proposals.

The first controlled ingest path is `applyBrainIngest` in `src/lib/brain-ops/ingest.ts`. Calibration mode writes a source object and proposal rows only. It does not create or merge companies. Organization linking uses exact normalized names.

Granola meeting notes are supported as a first-class Brain Ops source type via `granola_meeting_note`. Notes can carry `operational_refs` for exact company, job, RFQ/inquiry, and contact linkage. Exact job/RFQ/customer refs make the note searchable from operational context without mutating job, RFQ, quote, milestone, or customer records.

Granola ingest is idempotent for the exact same payload. Ambiguous exact matches, such as duplicate contact emails or duplicate RFQ subjects, remain unresolved instead of using first-row database behavior. Granola notes must include `source.raw_text` or `source.source_uri`.

The first read service is `src/lib/brain-ops/query.ts`. It returns source metadata with results and does not mutate state. Use `getOperationalBrainContext` when a workflow needs meeting-note context for a specific customer, job, or RFQ.
