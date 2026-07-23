import { fetchMarketBaseline, formatUsdCompact } from "@/lib/market-indicators";

function pct(value: number | null): string | null {
  if (value == null) return null;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] ?? m} ${year}`;
}

function Stat({ label, value, sub, title }: { label: string; value: string; sub?: string | null; title?: string }) {
  return (
    <div className="intel-stat" title={title}>
      <span className="intel-stat-label">{label}</span>
      <span className="intel-stat-value">
        {value}
        {sub && <em>{sub}</em>}
      </span>
    </div>
  );
}

const SOURCES_NOTE =
  "EIA · BLS · FMCSA · US Census open feeds, auto-refreshed (6-24 h cache). Carrier counts = active CA for-hire carriers.";

// Async server component - streams in behind Suspense as a one-line ticker
// under the composer. When every feed is down it says so explicitly instead
// of vanishing: a silently missing strip is undiagnosable from a screenshot.
export async function MarketBaseline() {
  const { indicators, customs, failures } = await fetchMarketBaseline();

  if (indicators.length === 0 && !customs) {
    return (
      <div className="intel-ticker">
        <span className="intel-ticker-live" title={SOURCES_NOTE}>
          <span className="intel-live-dot is-off" /> Market pulse
        </span>
        <span className="intel-ticker-note">
          Open feeds are quiet right now ({failures.join(", ") || "no feeds attempted"}); they retry on the next load.
        </span>
      </div>
    );
  }

  return (
    <div className="intel-ticker">
      <span className="intel-ticker-live" title={SOURCES_NOTE}>
        <span className="intel-live-dot" /> Market pulse
      </span>
      <div className="intel-ticker-track">
        {indicators.map((indicator) => {
          const yoy = pct(indicator.yoyPct);
          const ytd = pct(indicator.ytdPct);
          const sub = yoy ? `${yoy} YoY` : ytd ? `${ytd} YTD` : null;
          return (
            <Stat
              key={indicator.key}
              label={indicator.label}
              value={indicator.display}
              sub={sub}
              title={`${indicator.source}${indicator.asOf ? ` · as of ${indicator.asOf}` : ""}`}
            />
          );
        })}
        {customs && (
          <Stat
            label="CA tech imports"
            value={formatUsdCompact(customs.totalValue)}
            sub={pct(customs.totalYoyPct) ? `${pct(customs.totalYoyPct)} YoY` : null}
            title={`US Census customs · ${monthLabel(customs.latestMonth)} · LA + SF + San Diego districts`}
          />
        )}
        {customs?.byCommodity.map((entry) => (
          <Stat
            key={entry.code}
            label={entry.label}
            value={formatUsdCompact(entry.value)}
            sub={pct(entry.yoyPct)}
            title={`HS ${entry.code} · ${monthLabel(customs.latestMonth)}`}
          />
        ))}
        {failures.length > 0 && (
          <Stat label="Offline" value={failures.join(", ")} title="These feeds did not respond; they retry on the next page load." />
        )}
      </div>
    </div>
  );
}
