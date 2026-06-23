# Market Intelligence Live Pilot Runbook

Use this runbook before enabling live Firecrawl-backed market intelligence for
an office. The goal is reviewed freight intelligence, not an unsupervised news
crawler.

## Safety Rules

- External intelligence is advisory only.
- Do not let market signals mutate jobs, RFQs, quotes, prices, milestones,
  customer records, documents, or outbound messages.
- Do not run broad web searches. Every Firecrawl source must have allowed
  domains.
- Do not ingest login, paywall, checkout, or subscriber-only pages.
- Do not log provider keys, OAuth tokens, or customer secrets.
- Start with one official, carrier, port, or regulator source. Leave media
  sources disabled until feedback quality is proven.

## Required Environment

```bash
FIRECRAWL_API_KEY="..."
MARKET_INTELLIGENCE_PROVIDER="firecrawl"
MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED="false"
MARKET_INTELLIGENCE_CRON_ENABLED="false"
MARKET_INTELLIGENCE_MAX_RESULTS_PER_RUN="10"
MARKET_INTELLIGENCE_MAX_PAGES_PER_RUN="20"
MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN="3"
MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET="100"
MARKET_INTELLIGENCE_FIRECRAWL_TIMEOUT_MS="60000"
CRON_SECRET="..."
```

Keep `MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=false` until dry-runs and
source previews look sane.

## Preflight

1. Run `npm run market:doctor`.
2. Confirm Firecrawl key shows configured yes/no only. The key value must never
   print.
3. Confirm no enabled Firecrawl source is missing allowed domains.
4. Confirm risky broad fetch configuration is empty.
5. Confirm estimated pages are within the daily budget.
6. Run `/api/cron/market-intelligence?dryRun=1` with a valid cron secret.
7. Review the dry-run source list and estimated page count.

## One-Source Pilot

1. Enable exactly one reviewed source in `MARKET_INTELLIGENCE_SOURCES_JSON` or
   code.
2. Keep `MARKET_INTELLIGENCE_CRON_ENABLED=false`.
3. Preview the source from the Research Inbox or agent tool.
4. If preview quality is acceptable, temporarily set:

```bash
MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED="true"
```

5. Run one source manually:

```bash
npm run market:ingest:firecrawl -- --office <officeId> --source <sourceId> --confirm-live
```

6. Run `npm run market:doctor` again.
7. Review `MarketIngestionRun`, Research Feed, `MarketSignal`, and
   `MarketImpactReview` rows.
8. Mark wrong links and irrelevant signals. Source quality depends on this
   feedback.

## Cron Activation

Enable cron only after the one-source pilot produces useful, source-backed
signals.

```bash
MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED="true"
MARKET_INTELLIGENCE_CRON_ENABLED="true"
```

Keep `MARKET_INTELLIGENCE_MAX_SOURCES_PER_RUN` and
`MARKET_INTELLIGENCE_DAILY_CREDIT_BUDGET` low during the first week.

## Rollback

Set both switches false:

```bash
MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED="false"
MARKET_INTELLIGENCE_CRON_ENABLED="false"
```

Do not delete source objects during a bad run. Mark bad links/signals through
feedback so source quality can learn from the failure.

## Post-Pilot Review

Collect:

- useful/actioned review count
- wrong-link and irrelevant feedback count
- failed ingestion runs
- high/critical signals with zero links
- source domains and terms-policy notes
- operator complaints about noisy or stale signals

Do not expand source count until quality is boring and predictable.
