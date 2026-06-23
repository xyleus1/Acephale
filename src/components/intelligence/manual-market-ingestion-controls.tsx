"use client";

import { useActionState } from "react";
import type React from "react";
import { runManualMarketIngestionAction } from "@/app/dashboard/intelligence/actions";
import { initialManualMarketIngestionState } from "@/app/dashboard/intelligence/manual-action-types";

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
}: {
  sources: ManualMarketSourceOption[];
  isAdmin: boolean;
}) {
  const [state, formAction, pending] = useActionState(runManualMarketIngestionAction, initialManualMarketIngestionState);
  const defaultSource = sources.find((source) => source.id === "maersk-news-advisories")?.id ?? sources[0]?.id ?? "";

  return (
    <section style={shellStyle}>
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

      <form action={formAction} style={formStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Source</span>
          <select name="source_id" defaultValue={defaultSource} disabled={!isAdmin || pending || sources.length === 0} style={selectStyle}>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <div style={buttonRowStyle}>
          <button className="btn btn-secondary btn-sm" type="submit" name="mode" value="preview" disabled={!isAdmin || pending || sources.length === 0}>
            {pending ? "Working..." : "Preview"}
          </button>
          <button className="btn btn-sm" type="submit" name="mode" value="live" disabled={!isAdmin || pending || sources.length === 0}>
            Pull Market Data Now
          </button>
        </div>
      </form>

      {!isAdmin && <p style={warningStyle}>Only ADMIN users can run manual market ingestion.</p>}
      {sources.length === 0 && <p style={warningStyle}>No safe Firecrawl sources are available for manual ingestion.</p>}

      <div style={sourceGridStyle}>
        {sources.map((source) => (
          <article key={source.id} style={sourceCardStyle}>
            <strong>{source.name}</strong>
            <span>{source.sourceCategory} / {source.trustLevel}</span>
            <span>{source.allowedDomains.join(", ")}</span>
          </article>
        ))}
      </div>

      {state.summary && (
        <div style={resultStyle}>
          <div style={resultHeaderStyle}>
            <span style={state.ok ? liveBadgeStyle : blockedBadgeStyle}>{state.mode}</span>
            <strong>{state.summary.sourceName}</strong>
          </div>
          <p style={mutedStyle}>{state.message}</p>
          <div style={resultGridStyle}>
            <ResultMetric label="Research Feed" value={state.summary.researchItemsCreated} />
            <ResultMetric label="MarketSignals" value={state.summary.marketSignalsCreated} />
            <ResultMetric label="Links" value={state.summary.marketSignalLinksCreated} />
            <ResultMetric label="Impact Reviews" value={state.summary.marketImpactReviewsCreated} />
            <ResultMetric label="Extraction skips" value={state.summary.extractionSkips} />
            <ResultMetric label="Duplicates/skips" value={state.summary.duplicateOrSkippedCandidates} />
          </div>
          {state.summary.runIds.length > 0 && (
            <div style={smallListStyle}>
              <span style={labelStyle}>Run ids</span>
              {state.summary.runIds.map((id) => <code key={id} style={codeStyle}>{id}</code>)}
            </div>
          )}
          {state.summary.candidateUrls.length > 0 && (
            <div style={smallListStyle}>
              <span style={labelStyle}>Candidate URLs</span>
              {state.summary.candidateUrls.slice(0, 6).map((url) => <code key={url} style={codeStyle}>{url}</code>)}
            </div>
          )}
          {state.summary.providerErrors.length > 0 && (
            <div style={errorBoxStyle}>
              {state.summary.providerErrors.map((error) => <div key={error}>{error}</div>)}
            </div>
          )}
        </div>
      )}
    </section>
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
  border: "1px solid rgba(14,165,233,.18)",
  borderRadius: 10,
  padding: 14,
  background: "linear-gradient(180deg, rgba(8,47,73,.08), rgba(15,23,42,.04))",
};
const headerStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 };
const eyebrowStyle: React.CSSProperties = { color: "#0369a1", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0 };
const titleStyle: React.CSSProperties = { margin: "2px 0 4px", fontSize: 18 };
const mutedStyle: React.CSSProperties = { color: "#64748b", fontSize: 12, lineHeight: 1.45, margin: 0 };
const formStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto", gap: 10, alignItems: "end" };
const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5 };
const labelStyle: React.CSSProperties = { color: "#475569", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0 };
const selectStyle: React.CSSProperties = { minHeight: 36, border: "1px solid #cbd5e1", borderRadius: 8, padding: "0 10px", background: "#fff" };
const buttonRowStyle: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const liveBadgeStyle: React.CSSProperties = { border: "1px solid rgba(16,185,129,.3)", background: "rgba(16,185,129,.1)", color: "#047857", borderRadius: 999, padding: "4px 9px", fontSize: 11, fontWeight: 800 };
const blockedBadgeStyle: React.CSSProperties = { border: "1px solid rgba(244,63,94,.3)", background: "rgba(244,63,94,.1)", color: "#be123c", borderRadius: 999, padding: "4px 9px", fontSize: 11, fontWeight: 800 };
const warningStyle: React.CSSProperties = { margin: "10px 0 0", color: "#be123c", fontSize: 12 };
const sourceGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginTop: 12 };
const sourceCardStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, border: "1px solid #e2e8f0", borderRadius: 8, padding: 9, fontSize: 12, color: "#475569", background: "#fff" };
const resultStyle: React.CSSProperties = { marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 12 };
const resultHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 };
const resultGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 };
const metricStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, fontSize: 11, color: "#64748b", background: "#fff" };
const smallListStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, marginTop: 10 };
const codeStyle: React.CSSProperties = { display: "block", whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 6px", fontSize: 11, color: "#0f172a", background: "#f8fafc" };
const errorBoxStyle: React.CSSProperties = { marginTop: 10, border: "1px solid rgba(244,63,94,.25)", borderRadius: 8, padding: 9, color: "#be123c", background: "rgba(244,63,94,.06)", fontSize: 12 };
