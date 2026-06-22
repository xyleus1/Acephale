# Market Intelligence Guidance

- External intelligence is advisory, not operational truth. Do not let it override live customer, carrier, job, or RFQ records without review.
- Store source updates as `KnowledgeObject` records with provenance.
- Extract `MarketSignal`-style outputs with confidence, severity, source references, and timestamps.
- Link intelligence conservatively to customers, jobs, RFQs, lanes, or strategies only when the source evidence supports the link.
- Use `MarketImpactReview` as the human-review bridge before operational action. Review state and feedback can change; jobs, quotes, prices, milestones, customer records, and messages must not be mutated from market intelligence alone.
- Do not write live-internet-dependent tests unless the task explicitly asks for them. Use fixtures or deterministic samples instead.
- Keep market intelligence separate from committed customer quotes until a human or deterministic strategy rule approves the action.
- Firecrawl is a fetch adapter, not an intelligence authority. Use
  `source-registry.ts` and `source-policy.ts` before ingesting anything.
- Never run broad Firecrawl searches without allowed domains, never scrape
  login/paywall/subscribe flows, and never log API keys or scraped secrets.
- Source quality ranking must remain deterministic until there is labeled
  evaluation data. Use trust level plus review/feedback outcomes before any LLM
  ranking.
- Chat-triggered ingestion must be single-source and explicit. Do not let agent
  tools trigger broad crawls or arbitrary source activation.
