"use client";

import type React from "react";
import type { IntelligenceHotspot } from "@/lib/market-intelligence/intelligence-map";
import { EntityBadge, IntelligenceIcon } from "./intelligence-visual-icons";

export function IntelligenceHotspotPanel({ hotspot }: { hotspot: IntelligenceHotspot | null }) {
  if (!hotspot) {
    return (
      <aside style={panelStyle}>
        <div style={eyebrowStyle}>Select a hotspot</div>
        <h3 style={titleStyle}>Market context</h3>
      </aside>
    );
  }
  const isComplianceCountry = hotspot.type === "country" && (hotspot.category === "customs" || hotspot.category === "compliance");

  return (
    <aside style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={severityDot(hotspot.severity)} />
        <div>
          <div style={eyebrowStyle}>{hotspot.type} / {hotspot.category}</div>
          <h3 style={titleStyle}>{hotspot.label}</h3>
        </div>
      </div>
      {isComplianceCountry && (
        <div style={contextBoxStyle}>
          <div><strong>Country:</strong> {hotspot.label}</div>
          <div><strong>Type:</strong> Customs/compliance context</div>
          <div><strong>Source:</strong> {hotspot.sourceName ?? hotspot.sourceId ?? "market source"}</div>
          <div><strong>Action:</strong> Review customs/document requirements before treating this as lane-specific exposure.</div>
        </div>
      )}
      <p style={bodyStyle}>{hotspot.latestSummary || "No summary yet."}</p>
      <div style={metricGridStyle}>
        <Metric label="Signals" value={hotspot.signalCount} />
        <Metric label="Reviews" value={hotspot.reviewCount} />
        <Metric label="Pending" value={hotspot.pendingReviewCount} />
        <Metric label="Confidence" value={`${Math.round(hotspot.confidence * 100)}%`} />
      </div>
      {hotspot.suppressed && (
        <div style={warningStyle}>
          Suppressed from recommendations: {hotspot.suppressionReasons.join(", ") || "quality gate"}
        </div>
      )}
      <section style={sectionStyle}>
        <div style={sectionHeadingStyle}><IntelligenceIcon type={hotspot.category} /> Recommended actions</div>
        {hotspot.recommendedActions.length ? (
          <ul style={listStyle}>
            {hotspot.recommendedActions.slice(0, 4).map((action) => <li key={action}>{action}</li>)}
          </ul>
        ) : <p style={mutedStyle}>No recommended actions generated yet.</p>}
      </section>
      <section style={sectionStyle}>
        <div style={sectionHeadingStyle}>Affected work</div>
        <div style={pillWrapStyle}>
          {hotspot.affectedEntities.length ? hotspot.affectedEntities.slice(0, 8).map((entity) => (
            <span key={`${entity.type}:${entity.id}`} style={pillStyle}>
              <EntityBadge label={entity.label} />
              {entity.type}: {entity.label}
            </span>
          )) : <span style={mutedStyle}>No validated lane/job/RFQ/customer links yet.</span>}
        </div>
      </section>
      {hotspot.suppressedEntities.length > 0 && (
        <section style={sectionStyle}>
          <div style={sectionHeadingStyle}>Suppressed / rejected links</div>
          <div style={pillWrapStyle}>
            {hotspot.suppressedEntities.slice(0, 8).map((entity) => (
              <span key={`${entity.type}:${entity.id}`} style={suppressedPillStyle}>
                {entity.type}: {entity.label} · {entity.reason}
              </span>
            ))}
          </div>
        </section>
      )}
      <section style={sectionStyle}>
        <details style={evidenceDetailsStyle}>
          <summary style={evidenceSummaryStyle}>Evidence refs ({hotspot.evidenceRefs.length})</summary>
          <div style={pillWrapStyle}>
            {hotspot.evidenceRefs.length
              ? hotspot.evidenceRefs.slice(0, 8).map((ref, index) => <code key={`${ref}:${index}`} style={codePillStyle}>{ref}</code>)
              : <span style={mutedStyle}>No evidence refs available.</span>}
          </div>
        </details>
      </section>
      {hotspot.sourceName && (
        <p style={mutedStyle}>Source: {hotspot.sourceName}{hotspot.sourceId ? ` (${hotspot.sourceId})` : ""}</p>
      )}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ padding: 10, border: "1px solid rgba(125,211,252,.3)", borderRadius: 8, backgroundColor: "#13243a" }}>
      <div style={{ color: "#bfdbfe", fontSize: 11, fontWeight: 700 }}>{label}</div>
      <div style={{ color: "#ffffff", fontWeight: 800, fontSize: 16 }}>{value}</div>
    </div>
  );
}

function severityDot(severity: string): React.CSSProperties {
  const color = severity === "critical" || severity === "high" ? "#7f1d2d" : severity === "medium" ? "#1d5b8f" : "#9bb2c8";
  return {
    width: 14,
    height: 14,
    borderRadius: 999,
    background: color,
    boxShadow: `0 0 20px ${color}`,
    flex: "0 0 auto",
  };
}

const panelStyle: React.CSSProperties = {
  border: "1px solid rgba(125,211,252,.3)",
  backgroundColor: "#07111f",
  backgroundImage: "linear-gradient(180deg, #0b1728, #07111f)",
  borderRadius: 10,
  padding: 16,
  minHeight: 360,
  color: "#f8fafc",
  boxShadow: "0 18px 44px rgba(2,8,23,.24)",
};
const eyebrowStyle: React.CSSProperties = { color: "#bfd2e2", fontSize: 11, textTransform: "uppercase", letterSpacing: 0, fontWeight: 900 };
const titleStyle: React.CSSProperties = { color: "#ffffff", fontSize: 20, margin: "2px 0 0", fontWeight: 900 };
const bodyStyle: React.CSSProperties = { color: "#e2e8f0", fontSize: 13, lineHeight: 1.55, fontWeight: 600 };
const mutedStyle: React.CSSProperties = { color: "#cbd5e1", fontSize: 12, lineHeight: 1.45, margin: 0 };
const metricGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, margin: "14px 0" };
const warningStyle: React.CSSProperties = { border: "1px solid rgba(220,184,192,.55)", backgroundColor: "#2a1016", color: "#f7e8eb", borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 700 };
const contextBoxStyle: React.CSSProperties = { border: "1px solid rgba(125,211,252,.38)", backgroundColor: "#0f2a3d", color: "#f8fafc", borderRadius: 8, padding: 10, marginTop: 12, fontSize: 12, lineHeight: 1.55, fontWeight: 650 };
const sectionStyle: React.CSSProperties = { marginTop: 14 };
const sectionHeadingStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, color: "#ffffff", fontWeight: 900, fontSize: 13, marginBottom: 8 };
const listStyle: React.CSSProperties = { margin: 0, paddingLeft: 18, color: "#e2e8f0", fontSize: 12, lineHeight: 1.55, fontWeight: 650 };
const pillWrapStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6 };
const pillStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid rgba(125,211,252,.38)", backgroundColor: "#123047", color: "#f8fafc", borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 700 };
const suppressedPillStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid rgba(215,179,138,.42)", backgroundColor: "#0a1f3a", color: "#eaf2f8", borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 800 };
const codePillStyle: React.CSSProperties = { border: "1px solid rgba(148,163,184,.35)", backgroundColor: "#0f172a", color: "#e0f2fe", borderRadius: 6, padding: "4px 6px", fontSize: 10, fontWeight: 700 };
const evidenceDetailsStyle: React.CSSProperties = { borderTop: "1px solid rgba(148,163,184,.18)", paddingTop: 10 };
const evidenceSummaryStyle: React.CSSProperties = { color: "#bfdbfe", cursor: "pointer", fontSize: 12, fontWeight: 850, marginBottom: 8 };
