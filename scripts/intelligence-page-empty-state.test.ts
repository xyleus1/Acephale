import "dotenv/config";
import {
  MARKET_BRAIN_EMPTY_STATE,
  shouldShowMarketBrainEmptyState,
} from "../src/lib/market-intelligence/intelligence-page-state";
import {
  SAFE_MANUAL_MARKET_BUNDLE_SOURCE_IDS,
  getManualMarketIngestionRuntimeStatus,
  validateManualMarketIngestionRequest,
} from "../src/lib/market-intelligence/manual-ingestion";
import { intelligenceIconKindForCategory } from "../src/components/intelligence/intelligence-visual-icons";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(
    shouldShowMarketBrainEmptyState({ researchItems: 0, marketSignals: 0, impactReviews: 0 }),
    "Expected empty state when research/signals/reviews are all zero.",
  );
  assert(
    !shouldShowMarketBrainEmptyState({ researchItems: 1, marketSignals: 0, impactReviews: 0 }),
    "Research items should hide first-ingestion empty state.",
  );
  assert(
    !shouldShowMarketBrainEmptyState({ researchItems: 0, marketSignals: 1, impactReviews: 0 }),
    "MarketSignals should hide first-ingestion empty state.",
  );
  assert(
    !shouldShowMarketBrainEmptyState({ researchItems: 0, marketSignals: 0, impactReviews: 1 }),
    "ImpactReviews should hide first-ingestion empty state.",
  );
  assert(MARKET_BRAIN_EMPTY_STATE.title === "Feed the market brain", "Unexpected empty-state title.");
  assert(MARKET_BRAIN_EMPTY_STATE.body.includes("No live research has been ingested yet"), "Unexpected empty-state body.");

  const disabledRuntime = getManualMarketIngestionRuntimeStatus({
    MARKET_INTELLIGENCE_CRON_ENABLED: "false",
    MARKET_INTELLIGENCE_PROVIDER: "firecrawl",
    FIRECRAWL_API_KEY: "test-firecrawl-key",
  } as NodeJS.ProcessEnv);
  assert(!disabledRuntime.manualLiveEnabled, "Manual live should be disabled when live env flag is missing.");
  assert(
    disabledRuntime.liveDisabledReason === MARKET_BRAIN_EMPTY_STATE.liveDisabledMessage,
    "Missing live env should produce the exact empty-state disabled message.",
  );

  assert(
    JSON.stringify(SAFE_MANUAL_MARKET_BUNDLE_SOURCE_IDS) === JSON.stringify(["maersk-news-advisories", "drewry-world-container-index", "cbp-csms"]),
    "Safe bundle source list drifted.",
  );
  for (const sourceId of SAFE_MANUAL_MARKET_BUNDLE_SOURCE_IDS) {
    assert(!/freightwaves|journal-of-commerce|joc/i.test(sourceId), `Safe bundle includes blocked media source: ${sourceId}`);
  }

  const blockedMedia = validateManualMarketIngestionRequest({
    role: "ADMIN",
    sourceId: "freightwaves-maritime",
    mode: "live",
    env: {
      MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED: "true",
      MARKET_INTELLIGENCE_CRON_ENABLED: "false",
      FIRECRAWL_API_KEY: "test-firecrawl-key",
    } as NodeJS.ProcessEnv,
  });
  assert(!blockedMedia.ok, "FreightWaves should stay blocked by default.");

  assert(intelligenceIconKindForCategory("rate") === "rate", "Rate category should use rate icon.");
  assert(intelligenceIconKindForCategory("rate_index") === "rate", "Rate-index source category should use rate icon.");
  assert(intelligenceIconKindForCategory("customs") === "customs", "Customs category should use customs icon.");
  assert(intelligenceIconKindForCategory("regulatory") === "customs", "Regulatory source category should use customs icon.");
  assert(intelligenceIconKindForCategory("port_disruption") === "port", "Port disruption should use port icon.");
  assert(intelligenceIconKindForCategory("carrier") === "carrier", "Carrier source category should use carrier icon.");

  console.log(JSON.stringify({
    ok: true,
    emptyState: MARKET_BRAIN_EMPTY_STATE,
    disabledRuntime: {
      manualLiveEnabled: disabledRuntime.manualLiveEnabled,
      cronEnabled: disabledRuntime.cronEnabled,
      firecrawlConfigured: disabledRuntime.firecrawlConfigured,
      liveDisabledReason: disabledRuntime.liveDisabledReason,
    },
    safeBundle: [...SAFE_MANUAL_MARKET_BUNDLE_SOURCE_IDS],
    iconKinds: {
      rate: intelligenceIconKindForCategory("rate"),
      rateIndex: intelligenceIconKindForCategory("rate_index"),
      customs: intelligenceIconKindForCategory("customs"),
      regulatory: intelligenceIconKindForCategory("regulatory"),
      port: intelligenceIconKindForCategory("port_disruption"),
      carrier: intelligenceIconKindForCategory("carrier"),
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
