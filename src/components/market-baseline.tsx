import { fetchMarketBaseline } from "@/lib/market-indicators";
import { Icon } from "@/components/icon";

function pct(value: number | null): string | null {
  if (value == null) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

// Async server component — streams in behind Suspense and disappears entirely
// if every open feed is down, so the pricing page never depends on it.
export async function MarketBaseline() {
  const { indicators, failures } = await fetchMarketBaseline();
  if (indicators.length === 0) return null;

  return (
    <div className="record-panel" style={{ marginBottom: 16 }}>
      <div className="record-card-header">
        <div className="record-card-title">
          <Icon name="trending-up" size={13} /> Market baseline — open public feeds
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
          {indicators.map((indicator) => {
            const yoy = pct(indicator.yoyPct);
            const ytd = pct(indicator.ytdPct);
            return (
              <div key={indicator.key} title={indicator.source}>
                <div style={{ fontSize: 11, opacity: 0.6 }}>{indicator.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{indicator.display}</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  {[yoy && `${yoy} YoY`, ytd && `${ytd} YTD`].filter(Boolean).join(" · ") || "snapshot"}
                  {indicator.asOf && <span style={{ opacity: 0.6 }}> · {indicator.asOf}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 10 }}>
          FRED + FMCSA census, keyless, cached 6–24 h. Carrier counts = active CA for-hire carriers (bench recruiting pool).
          {failures.length > 0 && ` Feeds unavailable right now: ${failures.join(", ")}.`}
        </div>
      </div>
    </div>
  );
}
