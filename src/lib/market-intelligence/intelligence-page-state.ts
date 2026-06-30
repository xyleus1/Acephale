export const MARKET_BRAIN_EMPTY_STATE = {
  title: "Feed the market brain",
  body: "No live research has been ingested yet. Pull a trusted source to create Research Feed items, MarketSignals, and Impact Reviews.",
  liveDisabledMessage: "Live manual ingestion is disabled. Set MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED=true.",
} as const;

export function shouldShowMarketBrainEmptyState(input: {
  researchItems: number;
  marketSignals: number;
  impactReviews: number;
}) {
  return input.researchItems === 0 && input.marketSignals === 0 && input.impactReviews === 0;
}
