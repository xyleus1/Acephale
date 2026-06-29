import type React from "react";
import type { IntelligenceMapData } from "@/lib/market-intelligence/intelligence-map";

type SourceHealth = IntelligenceMapData["sourceHealth"][number];

export function IntelligenceSourceCard({ source }: { source: SourceHealth }) {
  const tone = source.scoreBand === "poor"
    ? "var(--danger)"
    : source.scoreBand === "watch"
      ? "var(--warning)"
      : source.scoreBand === "good"
        ? "var(--info)"
        : "var(--success)";
  return (
    <article style={{
      border: "1px solid rgba(191,210,226,.34)",
      borderRadius: 8,
      padding: 12,
      backgroundColor: "var(--derya-navy)",
      backgroundImage: "none",
      color: "#f8fafc",
      minWidth: 190,
      boxShadow: "0 12px 28px rgba(2,8,23,.18)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ fontSize: 13, color: "#ffffff" }}>{source.name}</strong>
        <span style={{ color: tone, fontWeight: 800, fontSize: 13 }}>{source.score}</span>
      </div>
      <div style={{ color: "#cbd5e1", fontSize: 11, fontWeight: 700, marginTop: 4 }}>{source.sourceCategory} / {source.trustLevel}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <span style={pillStyle}>{source.scoreBand}</span>
        <span style={pillStyle}>{source.objectCount} research</span>
        <span style={pillStyle}>{source.signalCount} signals</span>
      </div>
      <div style={{ color: "#cbd5e1", fontSize: 11, marginTop: 8 }}>
        Last run: {source.lastRunAt ? new Date(source.lastRunAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never"}
      </div>
    </article>
  );
}

const pillStyle: React.CSSProperties = {
  border: "1px solid rgba(191,210,226,.28)",
  borderRadius: 999,
  padding: "3px 7px",
  color: "#dbe7f1",
  fontSize: 11,
  fontWeight: 700,
  backgroundColor: "#12395f",
};
