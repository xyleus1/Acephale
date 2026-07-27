import { fetchMarketBaseline, formatUsdCompact } from "@/lib/intel/server";
import { Icon } from "@/components/icon";
import { SourcesChip } from "./sources-chip";

function pct(value: number | null): string | null {
  if (value == null) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] ?? m} ${year}`;
}

// Async server component - streams in behind Suspense. When every feed is
// down it says so explicitly instead of vanishing: a silently missing card is
// undiagnosable from a screenshot.
export async function MarketBaseline() {
  const { indicators, customs, failures, sources } = await fetchMarketBaseline();
  if (indicators.length === 0 && !customs) {
    return (
      <div className="record-panel" style={{ marginBottom: 16 }}>
        <div className="record-card-header">
          <div className="record-card-title">
            <Icon name="trending-up" size={13} /> Market baseline - open public feeds
          </div>
          <SourcesChip sources={[]} />
        </div>
        <div className="card-body" style={{ fontSize: 12, opacity: 0.7 }}>
          None of the configured open feeds responded just now ({failures.join(", ") || "no feeds attempted"}). They
          retry after their cache windows. Missing EIA or Census keys skip those feeds without reporting a failure.
        </div>
      </div>
    );
  }

  return (
    <div className="record-panel" style={{ marginBottom: 16 }}>
      <div className="record-card-header">
        <div className="record-card-title">
          <Icon name="trending-up" size={13} /> Market baseline - open public feeds
        </div>
        <SourcesChip sources={sources} />
      </div>
      <div className="card-body">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
          {indicators.map((indicator) => {
            const yoy = pct(indicator.yoyPct);
            const ytd = pct(indicator.ytdPct);
            return (
              <div key={indicator.key} title={indicator.source} style={{ position: "relative", paddingRight: 58 }}>
                <div style={{ position: "absolute", top: 0, right: 0 }}>
                  <SourcesChip sources={[indicator]} />
                </div>
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
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 12 }}>
                <strong>CA tech imports (customs)</strong> · {monthLabel(customs.latestMonth)}:{" "}
                <strong>{formatUsdCompact(customs.totalValue)}</strong>
                {customs.totalYoyPct != null && <span style={{ opacity: 0.75 }}> · {pct(customs.totalYoyPct)} YoY</span>}
                <span style={{ opacity: 0.5 }}> · LA + SF + San Diego districts</span>
              </div>
              <SourcesChip sources={customs.sourceUses} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {customs.byCommodity.map((entry) => (
                <div key={entry.code} title={`HS ${entry.code}`} style={{ position: "relative", paddingRight: 58 }}>
                  <div style={{ position: "absolute", top: 0, right: 0 }}>
                    <SourcesChip sources={customs.sourceUsesByCommodity[entry.code] ?? []} />
                  </div>
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
          Successful feeds are cached according to the source registry. Carrier counts are active CA for-hire carriers.
          {failures.length > 0 && ` Unavailable right now: ${failures.join(", ")}.`}
        </div>
      </div>
    </div>
  );
}
