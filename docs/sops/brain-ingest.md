Status: current-state
Owner: engineering
Last-verified: 2026-06-23
Source-of-truth: `src/lib/brain-ops/ingest.ts`

# Brain Ingest SOP

Use Brain Ops ingest when notes, docs, or memos should become reviewable company/product memory.

Payload shape:

```json
{
  "mode": "calibration",
  "source": {
    "title": "Customer meeting",
    "source_type": "meeting_note",
    "source_uri": "optional",
    "occurred_at": "2026-06-23",
    "raw_text": "source text"
  },
  "operational_refs": [
    { "type": "company", "name": "Acme" },
    { "type": "job", "reference": "JOB-2026-001" }
  ],
  "commitments": [
    {
      "organization_name": "Acme",
      "owner_text": "Ops",
      "description": "Send revised quote",
      "source_quote": "Ops will send revised quote",
      "confidence": 0.8
    }
  ]
}
```

Granola notes:

- Export or paste the Granola note into `source.raw_text`.
- Set `source.source_type` to `granola_meeting_note`; the CLI defaults to this if omitted.
- Put the Granola share URL or internal note URL in `source.source_uri` when available.
- Include either `source.raw_text` or `source.source_uri`; evidence-less Granola notes are rejected.
- Add exact `operational_refs` for the company, job, RFQ/inquiry, or contact discussed.
- Run:

```bash
npm run brain:ingest:granola -- --office=<officeId> --file=<payload.json>
```

Validation rules:

- `source.title` is required.
- `source.source_type` is required.
- Commitments, decisions, risks, and open questions require `source_quote` unless `manually_entered` is true.
- Organization names link only by exact normalized company name.
- Operational refs link only by exact scoped ids, company names, job references, inquiry subjects, or contact emails/names.
- Email thread/message, job document, and strategy assessment refs are accepted only through scoped exact ids or provider external ids where available.
- Similar names remain unresolved.
- Ambiguous exact matches remain unresolved.
- Invalid statuses fail validation.
- If `userId` is supplied, it must belong to the same office as the ingest.

Review process:

- Calibration mode creates a source object and `AgentProposal` rows.
- Re-running the exact same payload returns the existing source object/proposal rows instead of writing duplicates.
- Reviewers approve or reject proposal rows in a future UI/API layer.
- Until reviewed, proposal facts are not trusted customer truth.

Apply process:

- Use `applyBrainIngest` for source/proposal creation.
- Future trusted apply work must use a transaction and preserve source/proposal provenance.

Failure modes:

- Missing source metadata: reject.
- Missing source quote for risky facts: reject.
- Unresolved organization: keep proposal and flag `unresolved_organization_name`.
- Unresolved operational refs: keep proposal/source rows and flag the unresolved ref for review.
- Ambiguous customer names: do not link.
