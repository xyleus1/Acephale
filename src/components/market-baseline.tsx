import { fetchMarketBaseline, formatUsdCompact } from "@/lib/market-indicators";
import { Icon } from "@/components/icon";

function pct(value: number | null): string | null {
  if (value == null) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] ?? m} ${year}`;
}

// Async server component — streams in behind Suspense. When every feed is
// down it says so explicitly instead of vanishing: a silently missing card is
// undiagnosable from a screenshot.
export async function MarketBaseline() {
  const { indicators, customs, failures } = await fetchMarketBaseline();
  if (indicators.length === 0 && !customs) {
    return (
      <div className="record-panel" style={{ marginBottom: 16 }}>
        <div className="record-card-header">
          <div className="record-card-title">
            <Icon name="trending-up" size={13} /> Market baseline — open public feeds
          </div>
        </div>
        <div className="card-body" style={{ fontSize: 12, opacity: 0.7 }}>
          None of the open feeds responded just now ({failures.join(", ") || "no feeds attempted"}). They retry on the
          next page load — if this persists, the server can&apos;t reach FRED / data.transportation.gov.
        </div>
      </div>
    );
  }

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
        {customs && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border, rgba(128,128,128,0.25))" }}>
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <strong>CA tech imports (customs)</strong> · {monthLabel(customs.latestMonth)}:{" "}
              <strong>{formatUsdCompact(customs.totalValue)}</strong>
              {customs.totalYoyPct != null && <span style={{ opacity: 0.75 }}> · {pct(customs.totalYoyPct)} YoY</span>}
              <span style={{ opacity: 0.5 }}> · LA + SF + San Diego districts</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {customs.byCommodity.map((entry) => (
                <div key={entry.code} title={`HS ${entry.code}`}>
                  <div style={{ fontSize: 11, opacity: 0.6 }}>{entry.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {formatUsdCompact(entry.value)}
                    {entry.yoyPct != null && (
                      <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}> {pct(entry.yoyPct)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 10 }}>
          EIA · BLS · FMCSA · US Census, auto-refreshed (6–24 h cache). Carrier counts = active CA for-hire carriers.
          {failures.length > 0 && ` Unavailable right now: ${failures.join(", ")}.`}
        </div>
      </div>
    </div>
  );
}
