import type React from "react";
import type { IntelligenceMapData } from "@/lib/market-intelligence/intelligence-map";

type SourceHealth = IntelligenceMapData["sourceHealth"][number];

export function IntelligenceSourceCard({ source }: { source: SourceHealth }) {
  const tone = source.scoreBand === "poor" ? "#fb7185" : source.scoreBand === "watch" ? "#f59e0b" : source.scoreBand === "good" ? "#38bdf8" : "#34d399";
  return (
    <article style={{
      border: "1px solid rgba(148,163,184,.18)",
      borderRadius: 8,
      padding: 12,
      background: "rgba(15,23,42,.72)",
      color: "#dbeafe",
      minWidth: 190,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{source.name}</strong>
        <span style={{ color: tone, fontWeight: 800, fontSize: 13 }}>{source.score}</span>
      </div>
      <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 4 }}>{source.sourceCategory} / {source.trustLevel}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <span style={pillStyle}>{source.scoreBand}</span>
        <span style={pillStyle}>{source.objectCount} research</span>
        <span style={pillStyle}>{source.signalCount} signals</span>
      </div>
      <div style={{ color: "#64748b", fontSize: 11, marginTop: 8 }}>
        Last run: {source.lastRunAt ? new Date(source.lastRunAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never"}
      </div>
    </article>
  );
}

const pillStyle: React.CSSProperties = {
  border: "1px solid rgba(125,211,252,.18)",
  borderRadius: 999,
  padding: "3px 7px",
  color: "#bfdbfe",
  fontSize: 11,
  background: "rgba(14,165,233,.08)",
};
