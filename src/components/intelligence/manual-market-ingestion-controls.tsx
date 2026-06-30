"use client";

import { useActionState } from "react";
import type React from "react";
import { runManualMarketIngestionAction, runSafeMarketIngestionBundleAction } from "@/app/dashboard/intelligence/actions";
import { initialManualMarketIngestionState } from "@/app/dashboard/intelligence/manual-action-types";
import type { ManualMarketIngestionRuntimeStatus } from "@/lib/market-intelligence/manual-ingestion";
import { MARKET_BRAIN_EMPTY_STATE } from "@/lib/market-intelligence/intelligence-page-state";
import { IntelligenceIcon } from "./intelligence-visual-icons";

export type ManualMarketSourceOption = {
  id: string;
  name: string;
  sourceCategory: string;
  trustLevel: string;
  allowedDomains: string[];
};

export function ManualMarketIngestionControls({
  sources,
  isAdmin,
  isEmpty,
  runtimeStatus,
}: {
  sources: ManualMarketSourceOption[];
  isAdmin: boolean;
  isEmpty: boolean;
  runtimeStatus: ManualMarketIngestionRuntimeStatus;
}) {
  const [state, formAction, pending] = useActionState(runManualMarketIngestionAction, initialManualMarketIngestionState);
  const [bundleState, bundleAction, bundlePending] = useActionState(runSafeMarketIngestionBundleAction, initialManualMarketIngestionState);
  const defaultSource = sources.find((source) => source.id === "maersk-news-advisories")?.id ?? sources[0]?.id ?? "";
  const liveBlocked = !isAdmin || !runtimeStatus.manualLiveEnabled || runtimeStatus.cronEnabled || !runtimeStatus.firecrawlConfigured;
  const running = pending || bundlePending;
  const displaySummaries = bundleState.bundleSummary?.summaries ?? (state.summary ? [state.summary] : []);

  return (
    <section style={shellStyle}>
      {isEmpty && (
        <div style={emptyHeroStyle} data-testid="intelligence-empty-state">
          <div>
            <div style={eyebrowStyle}>First ingestion</div>
            <h2 style={emptyTitleStyle}>{MARKET_BRAIN_EMPTY_STATE.title}</h2>
            <p style={emptyBodyStyle}>
              {MARKET_BRAIN_EMPTY_STATE.body}
            </p>
          </div>
          {runtimeStatus.liveDisabledReason && (
            <div style={emptyWarningStyle}>
              {runtimeStatus.liveDisabledReason}
            </div>
          )}
        </div>
      )}
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Manual pull</div>
          <h3 style={titleStyle}>Pull Market Data Now</h3>
          <p style={mutedStyle}>
            Admin-only, one curated source, three results/pages max. Cron stays disabled; intelligence stays advisory.
          </p>
        </div>
        <span style={isAdmin ? liveBadgeStyle : blockedBadgeStyle}>{isAdmin ? "Admin" : "Locked"}</span>
      </div>

      <div style={statusGridStyle}>
        <StatusBadge label="Cron" value={runtimeStatus.cronEnabled ? "enabled" : "disabled"} good={!runtimeStatus.cronEnabled} />
        <StatusBadge label="Manual live" value={runtimeStatus.manualLiveEnabled ? "enabled" : "disabled"} good={runtimeStatus.manualLiveEnabled} />
        <StatusBadge label="Firecrawl" value={runtimeStatus.firecrawlConfigured ? "configured" : "missing"} good={runtimeStatus.firecrawlConfigured} />
        <StatusBadge label="Provider" value={runtimeStatus.provider} good={runtimeStatus.provider === "firecrawl"} />
        <StatusBadge label="Clamp" value={`${runtimeStatus.maxResultsPerRun}/${runtimeStatus.maxPagesPerRun}`} good />
        <StatusBadge label="Safe sources" value={runtimeStatus.safeSourceCount} good={runtimeStatus.safeSourceCount > 0} />
      </div>

      <form action={formAction} style={formStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Source</span>
          <select name="source_id" defaultValue={defaultSource} disabled={!isAdmin || running || sources.length === 0} style={selectStyle}>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <div style={buttonRowStyle}>
          <button className="btn btn-secondary btn-sm" type="submit" name="mode" value="preview" disabled={!isAdmin || running || sources.length === 0}>
            {running ? "Working..." : "Preview source"}
          </button>
          <button className="btn btn-sm" type="submit" name="mode" value="live" disabled={liveBlocked || running || sources.length === 0}>
            Pull one
          </button>
        </div>
      </form>

      <div style={quickGridStyle}>
        {sources.map((source) => (
          <form action={formAction} key={source.id} style={quickCardStyle}>
            <input type="hidden" name="source_id" value={source.id} />
            <div style={quickTopStyle}>
              <span style={quickIconStyle}><IntelligenceIcon type={source.sourceCategory} size={17} /></span>
              <strong>{source.name}</strong>
            </div>
            <span>{source.trustLevel} / {source.sourceCategory}</span>
            <span>max 3 pages / 3 results</span>
            <span>advisory-only, cron remains off</span>
            <div style={buttonRowStyle}>
              <button className="btn btn-secondary btn-sm" type="submit" name="mode" value="preview" disabled={!isAdmin || running}>
                Preview
              </button>
              <button className="btn btn-sm" type="submit" name="mode" value="live" disabled={liveBlocked || running}>
                Pull {source.id === "maersk-news-advisories" ? "Maersk" : source.name.split(" ")[0]}
              </button>
            </div>
          </form>
        ))}
      </div>

      <form action={bundleAction} style={bundleStyle}>
        <input type="hidden" name="mode" value="live" />
        <div>
          <strong>Safe bundle</strong>
          <p style={mutedStyle}>
            Pulls Maersk Advisories, Drewry WCI, and CBP CSMS only. No media, no broad crawl, no scheduled cron.
          </p>
        </div>
        <button className="btn btn-sm" type="submit" disabled={liveBlocked || running}>
          Pull safe bundle
        </button>
      </form>

      {!isAdmin && <p style={warningStyle}>Only ADMIN users can run manual market ingestion.</p>}
      {runtimeStatus.liveDisabledReason && <p style={warningStyle}>{runtimeStatus.liveDisabledReason}</p>}
      {sources.length === 0 && <p style={warningStyle}>No safe Firecrawl sources are available for manual ingestion.</p>}

      {(state.summary || bundleState.bundleSummary) && (
        <div style={resultStyle}>
          <div style={resultHeaderStyle}>
            <span style={(state.ok || bundleState.ok) ? liveBadgeStyle : blockedBadgeStyle}>{bundleState.bundleSummary ? bundleState.mode : state.mode}</span>
            <strong>{bundleState.bundleSummary ? "Safe bundle" : state.summary?.sourceName}</strong>
          </div>
          <p style={mutedStyle}>{bundleState.bundleSummary ? bundleState.message : state.message}</p>
          <div style={resultGridStyle}>
            <ResultMetric label="Research Feed" value={(bundleState.bundleSummary ?? state.summary)?.researchItemsCreated ?? 0} />
            <ResultMetric label="MarketSignals" value={(bundleState.bundleSummary ?? state.summary)?.marketSignalsCreated ?? 0} />
            <ResultMetric label="Links" value={(bundleState.bundleSummary ?? state.summary)?.marketSignalLinksCreated ?? 0} />
            <ResultMetric label="Impact Reviews" value={(bundleState.bundleSummary ?? state.summary)?.marketImpactReviewsCreated ?? 0} />
            <ResultMetric label="Extraction skips" value={(bundleState.bundleSummary ?? state.summary)?.extractionSkips ?? 0} />
            <ResultMetric label="Duplicates/skips" value={(bundleState.bundleSummary ?? state.summary)?.duplicateOrSkippedCandidates ?? 0} />
          </div>
          {displaySummaries.some((summary) => summary.runIds.length > 0) && (
            <div style={smallListStyle}>
              <span style={labelStyle}>Run ids</span>
              {displaySummaries.flatMap((summary) => summary.runIds).map((id) => <code key={id} style={codeStyle}>{id}</code>)}
            </div>
          )}
          {displaySummaries.some((summary) => summary.candidateUrls.length > 0) && (
            <div style={smallListStyle}>
              <span style={labelStyle}>Candidate URLs</span>
              {displaySummaries.flatMap((summary) => summary.candidateUrls).slice(0, 9).map((url) => <code key={url} style={codeStyle}>{url}</code>)}
            </div>
          )}
          {((bundleState.bundleSummary ?? state.summary)?.providerErrors.length ?? 0) > 0 && (
            <div style={errorBoxStyle}>
              {(bundleState.bundleSummary ?? state.summary)?.providerErrors.map((error) => <div key={error}>{error}</div>)}
            </div>
          )}
          {bundleState.bundleSummary && (
            <div style={sourceGridStyle}>
              {bundleState.bundleSummary.summaries.map((summary) => (
                <article key={summary.sourceId} style={sourceCardStyle}>
                  <strong>{summary.sourceName}</strong>
                  <span>{summary.ok ? "ok" : "blocked/failed"} / {summary.mode}</span>
                  <span>{summary.researchItemsCreated} research / {summary.marketSignalsCreated} signals / {summary.marketImpactReviewsCreated} reviews</span>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ label, value, good }: { label: string; value: string | number; good: boolean }) {
  return (
    <div style={good ? statusGoodStyle : statusBadStyle}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ResultMetric({ label, value }: { label: string; value: number }) {
  return (
    <div style={metricStyle}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 14,
  background: "var(--surface)",
};
const emptyHeroStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(220px, .45fr)", gap: 14, alignItems: "center", border: "1px solid var(--info-border)", borderRadius: 10, padding: 14, marginBottom: 14, background: "var(--info-bg)" };
const emptyTitleStyle: React.CSSProperties = { fontSize: 26, margin: "2px 0 6px", color: "var(--text)" };
const emptyBodyStyle: React.CSSProperties = { color: "var(--text-2)", fontSize: 14, lineHeight: 1.5, margin: 0 };
const emptyWarningStyle: React.CSSProperties = { border: "1px solid var(--danger-border)", background: "var(--danger-bg)", borderRadius: 8, color: "var(--danger)", fontWeight: 700, padding: 12, fontSize: 13 };
const headerStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 };
const eyebrowStyle: React.CSSProperties = { color: "var(--info)", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0 };
const titleStyle: React.CSSProperties = { margin: "2px 0 4px", fontSize: 18 };
const mutedStyle: React.CSSProperties = { color: "var(--text-3)", fontSize: 12, lineHeight: 1.45, margin: 0 };
const formStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto", gap: 10, alignItems: "end" };
const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5 };
const labelStyle: React.CSSProperties = { color: "var(--text-2)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0 };
const selectStyle: React.CSSProperties = { minHeight: 36, border: "1px solid var(--border)", borderRadius: 8, padding: "0 10px", background: "#fff" };
const buttonRowStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const statusGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 12 };
const statusGoodStyle: React.CSSProperties = { display: "flex", flexDirection: "column", border: "1px solid var(--success-border)", borderRadius: 8, padding: "7px 9px", background: "var(--success-bg)", color: "var(--success)", fontSize: 11 };
const statusBadStyle: React.CSSProperties = { display: "flex", flexDirection: "column", border: "1px solid var(--danger-border)", borderRadius: 8, padding: "7px 9px", background: "var(--danger-bg)", color: "var(--danger)", fontSize: 11 };
const liveBadgeStyle: React.CSSProperties = { border: "1px solid var(--success-border)", background: "var(--success-bg)", color: "var(--success)", borderRadius: 999, padding: "4px 9px", fontSize: 11, fontWeight: 800 };
const blockedBadgeStyle: React.CSSProperties = { border: "1px solid var(--danger-border)", background: "var(--danger-bg)", color: "var(--danger)", borderRadius: 999, padding: "4px 9px", fontSize: 11, fontWeight: 800 };
const warningStyle: React.CSSProperties = { margin: "10px 0 0", color: "var(--danger)", fontSize: 12 };
const sourceGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginTop: 12 };
const sourceCardStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, border: "1px solid var(--border)", borderRadius: 8, padding: 9, fontSize: 12, color: "var(--text-2)", background: "#fff" };
const quickGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginTop: 12 };
const quickCardStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--border)", borderRadius: 9, padding: 10, background: "#fff", color: "var(--text-2)", fontSize: 12 };
const quickTopStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, color: "var(--text)" };
const quickIconStyle: React.CSSProperties = { display: "inline-grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, background: "var(--info-bg)", color: "var(--info)" };
const bundleStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", border: "1px solid rgba(15,23,42,.1)", borderRadius: 9, padding: 12, background: "rgba(15,23,42,.03)", marginTop: 12, flexWrap: "wrap" };
const resultStyle: React.CSSProperties = { marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 };
const resultHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 };
const resultGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 };
const metricStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontSize: 11, color: "var(--text-3)", background: "#fff" };
const smallListStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, marginTop: 10 };
const codeStyle: React.CSSProperties = { display: "block", whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid var(--border)", borderRadius: 6, padding: "5px 6px", fontSize: 11, color: "var(--text)", background: "var(--surface-2)" };
const errorBoxStyle: React.CSSProperties = { marginTop: 10, border: "1px solid var(--danger-border)", borderRadius: 8, padding: 9, color: "var(--danger)", background: "var(--danger-bg)", fontSize: 12 };
