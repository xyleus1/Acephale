"use client";

import type React from "react";
import type { IntelligenceHotspot } from "@/lib/market-intelligence/intelligence-map";
import { EntityBadge, IntelligenceIcon } from "./intelligence-visual-icons";

export function IntelligenceHotspotPanel({ hotspot }: { hotspot: IntelligenceHotspot | null }) {
  if (!hotspot) {
    return (
      <aside style={panelStyle}>
        <div style={eyebrowStyle}>Select a hotspot</div>
        <h3 style={titleStyle}>Live market context</h3>
        <p style={mutedStyle}>Click a glowing point or lane to inspect related research, signals, reviews, evidence, and recommended operator actions.</p>
      </aside>
    );
  }

  return (
    <aside style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={severityDot(hotspot.severity)} />
        <div>
          <div style={eyebrowStyle}>{hotspot.type} / {hotspot.category}</div>
          <h3 style={titleStyle}>{hotspot.label}</h3>
        </div>
      </div>
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
          )) : <span style={mutedStyle}>No linked jobs/RFQs/customers yet.</span>}
        </div>
      </section>
      <section style={sectionStyle}>
        <div style={sectionHeadingStyle}>Evidence</div>
        <div style={pillWrapStyle}>
          {hotspot.evidenceRefs.slice(0, 8).map((ref) => <code key={ref} style={codePillStyle}>{ref}</code>)}
        </div>
      </section>
      {hotspot.sourceName && (
        <p style={mutedStyle}>Source: {hotspot.sourceName}{hotspot.sourceId ? ` (${hotspot.sourceId})` : ""}</p>
      )}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ padding: 10, border: "1px solid rgba(148,163,184,.22)", borderRadius: 8, background: "rgba(15,23,42,.55)" }}>
      <div style={{ color: "#94a3b8", fontSize: 11 }}>{label}</div>
      <div style={{ color: "#e5eefb", fontWeight: 700, fontSize: 16 }}>{value}</div>
    </div>
  );
}

function severityDot(severity: string): React.CSSProperties {
  const color = severity === "critical" ? "#fb7185" : severity === "high" ? "#f59e0b" : severity === "medium" ? "#38bdf8" : "#34d399";
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
  border: "1px solid rgba(148,163,184,.24)",
  background: "linear-gradient(180deg, rgba(15,23,42,.94), rgba(8,13,24,.96))",
  borderRadius: 10,
  padding: 16,
  minHeight: 360,
  color: "#dbeafe",
};
const eyebrowStyle: React.CSSProperties = { color: "#7dd3fc", fontSize: 11, textTransform: "uppercase", letterSpacing: 0, fontWeight: 700 };
const titleStyle: React.CSSProperties = { color: "#f8fafc", fontSize: 20, margin: "2px 0 0" };
const bodyStyle: React.CSSProperties = { color: "#cbd5e1", fontSize: 13, lineHeight: 1.55 };
const mutedStyle: React.CSSProperties = { color: "#94a3b8", fontSize: 12, lineHeight: 1.45, margin: 0 };
const metricGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, margin: "14px 0" };
const warningStyle: React.CSSProperties = { border: "1px solid rgba(251,113,133,.35)", background: "rgba(127,29,29,.24)", color: "#fecdd3", borderRadius: 8, padding: 10, fontSize: 12 };
const sectionStyle: React.CSSProperties = { marginTop: 14 };
const sectionHeadingStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, color: "#e2e8f0", fontWeight: 700, fontSize: 13, marginBottom: 8 };
const listStyle: React.CSSProperties = { margin: 0, paddingLeft: 18, color: "#cbd5e1", fontSize: 12, lineHeight: 1.5 };
const pillWrapStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6 };
const pillStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid rgba(125,211,252,.22)", background: "rgba(14,165,233,.1)", color: "#dbeafe", borderRadius: 999, padding: "4px 8px", fontSize: 11 };
const codePillStyle: React.CSSProperties = { border: "1px solid rgba(148,163,184,.2)", background: "rgba(15,23,42,.8)", color: "#bae6fd", borderRadius: 6, padding: "4px 6px", fontSize: 10 };
