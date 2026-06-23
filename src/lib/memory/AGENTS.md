# Company Brain Memory Guidance

- Use the canonical taxonomy in `canonical-types.ts`; do not invent new canonical types casually.
- Memory writes must be idempotent and scoped by `officeId`.
- Provenance and evidence are required. Store source type, source id, timestamps, and enough references for auditability.
- Do not add vector search or embedding-dependent behavior unless explicitly requested.
- Preserve conservative linking. Only connect memory to customers, jobs, RFQs, or threads when the evidence supports it.
- When canonical types change, update the memory doctor, docs, tests, and any search/relevance mappings in the same task.
