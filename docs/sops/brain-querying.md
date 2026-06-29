Status: current-state
Owner: engineering
Last-verified: 2026-06-23
Source-of-truth: `src/lib/brain-ops/query.ts`, `src/lib/memory/search-memory.ts`

# Brain Querying SOP

When answering "where do we stand?", separate sourced facts from interpretation.

Required answer shape:

1. Direct answer.
2. Evidence used.
3. Open commitments.
4. Open questions.
5. Risks or contradictions.
6. Recommended next actions.

Evidence format:

```json
{
  "claim": "",
  "source": {
    "id": "",
    "title": "",
    "source_type": "",
    "occurred_at": "",
    "source_uri": ""
  },
  "quote": "",
  "confidence": null
}
```

If a source is missing, say the source is missing. Do not fill the gap with a confident guess.

If sources contradict, report the contradiction and the dates/sources. Do not silently pick the more convenient answer.

Use exact organization names for dossiers. If the exact organization is not found, return unresolved rather than fuzzy matching.
