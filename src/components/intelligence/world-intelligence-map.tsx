"use client";

import { useMemo, useState } from "react";
import type React from "react";
import type { IntelligenceHotspot, IntelligenceMapData } from "@/lib/market-intelligence/intelligence-map";
import { IntelligenceHotspotPanel } from "./intelligence-hotspot-panel";
import { IntelligenceSourceCard } from "./intelligence-source-card";

function project(lat: number, lng: number) {
  return {
    x: ((lng + 180) / 360) * 1000,
    y: ((90 - lat) / 180) * 500,
  };
}

function severityColor(severity: string) {
  if (severity === "critical") return "#fb7185";
  if (severity === "high") return "#f59e0b";
  if (severity === "medium") return "#38bdf8";
  return "#34d399";
}

function arcPath(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const a = project(from.lat, from.lng);
  const b = project(to.lat, to.lng);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lift = Math.min(140, Math.max(45, Math.abs(dx) * 0.18));
  const cx = a.x + dx / 2;
  const cy = a.y + dy / 2 - lift;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

export function WorldIntelligenceMap({ data }: { data: IntelligenceMapData }) {
  const [selectedId, setSelectedId] = useState<string | null>(data.hotspots[0]?.id ?? null);
  const selected = useMemo<IntelligenceHotspot | null>(
    () => data.hotspots.find((hotspot) => hotspot.id === selectedId) ?? data.hotspots[0] ?? null,
    [data.hotspots, selectedId],
  );

  return (
    <section style={shellStyle}>
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Live intelligence map</div>
          <h2 style={headingStyle}>Markets, lanes, and pending impact work</h2>
        </div>
        <div style={metricsStyle}>
          <MapMetric label="24h research" value={data.metrics.researchItems24h} />
          <MapMetric label="7d research" value={data.metrics.researchItems7d} />
          <MapMetric label="pending reviews" value={data.metrics.pendingImpactReviews} />
          <MapMetric label="source avg" value={data.metrics.sourceQualityAverage ?? "n/a"} />
        </div>
      </div>

      <div style={layoutStyle}>
        <div style={mapCardStyle}>
          <svg viewBox="0 0 1000 500" role="img" aria-label="Freight market intelligence world map" style={{ width: "100%", height: "100%", minHeight: 390 }}>
            <defs>
              <radialGradient id="ocean-glow" cx="50%" cy="45%" r="70%">
                <stop offset="0%" stopColor="#12355f" />
                <stop offset="60%" stopColor="#081a2f" />
                <stop offset="100%" stopColor="#04111f" />
              </radialGradient>
              <filter id="hotspot-blur">
                <feGaussianBlur stdDeviation="4" />
              </filter>
            </defs>
            <rect width="1000" height="500" fill="url(#ocean-glow)" rx="16" />
            <g opacity=".24" fill="#5eead4">
              <path d="M120 140c50-70 130-85 200-45 54 31 50 90-10 120-65 32-148 12-198-30-22-18-20-25 8-45Z" />
              <path d="M415 125c68-52 170-50 229 8 47 47 31 116-35 139-89 30-201-12-235-82-10-21 0-45 41-65Z" />
              <path d="M690 155c67-31 146-22 190 31 44 54 25 132-51 154-80 24-175-20-196-83-16-47 3-78 57-102Z" />
              <path d="M280 310c45-23 116-10 148 25 29 32 16 78-31 93-58 19-127-8-148-55-12-27-1-48 31-63Z" />
              <path d="M555 330c52-25 132-11 166 31 31 39 10 86-45 99-62 14-134-19-153-68-10-27 0-48 32-62Z" />
            </g>
            <g opacity=".18" stroke="#93c5fd" strokeWidth="1">
              {Array.from({ length: 9 }).map((_, index) => <path key={`lat-${index}`} d={`M 30 ${70 + index * 42} H 970`} />)}
              {Array.from({ length: 11 }).map((_, index) => <path key={`lng-${index}`} d={`M ${70 + index * 86} 35 V 465`} />)}
            </g>
            <g>
              {data.lanes.map((lane) => (
                <path
                  key={lane.id}
                  d={arcPath(lane.from, lane.to)}
                  fill="none"
                  stroke={severityColor(lane.severity)}
                  strokeWidth={Math.min(5, 1.4 + lane.signalCount)}
                  strokeOpacity=".62"
                />
              ))}
            </g>
            <g>
              {data.hotspots.map((hotspot) => {
                const point = project(hotspot.lat, hotspot.lng);
                const color = severityColor(hotspot.severity);
                const active = selected?.id === hotspot.id;
                const radius = Math.min(18, 7 + hotspot.signalCount * 2 + hotspot.pendingReviewCount);
                return (
                  <g
                    key={hotspot.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${hotspot.label}`}
                    onClick={() => setSelectedId(hotspot.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(hotspot.id);
                      }
                    }}
                    style={{ cursor: "pointer", outline: "none" }}
                  >
                    <circle cx={point.x} cy={point.y} r={radius + 8} fill={color} opacity={active ? ".25" : ".13"} filter="url(#hotspot-blur)" />
                    <circle cx={point.x} cy={point.y} r={radius} fill={color} opacity={hotspot.suppressed ? ".45" : ".88"} stroke="#eff6ff" strokeWidth={active ? 2.2 : 1} />
                    <circle cx={point.x} cy={point.y} r={radius + 5} fill="none" stroke={color} strokeWidth="1.5" opacity=".55">
                      <animate attributeName="r" values={`${radius + 5};${radius + 13};${radius + 5}`} dur="2.8s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values=".55;.08;.55" dur="2.8s" repeatCount="indefinite" />
                    </circle>
                    <text x={point.x + radius + 7} y={point.y + 4} fill="#dbeafe" fontSize="13" fontWeight={active ? 800 : 600}>{hotspot.label}</text>
                  </g>
                );
              })}
            </g>
          </svg>
          <div style={legendStyle}>
            <span><b style={{ color: "#34d399" }}>●</b> low</span>
            <span><b style={{ color: "#38bdf8" }}>●</b> medium</span>
            <span><b style={{ color: "#f59e0b" }}>●</b> high</span>
            <span><b style={{ color: "#fb7185" }}>●</b> critical</span>
          </div>
        </div>
        <IntelligenceHotspotPanel hotspot={selected} />
      </div>

      <div style={sourceStripStyle}>
        {data.sourceHealth.slice(0, 5).map((source) => <IntelligenceSourceCard key={source.sourceId} source={source} />)}
      </div>
    </section>
  );
}

function MapMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={metricStyle}>
      <span style={{ color: "#93c5fd", fontSize: 11 }}>{label}</span>
      <strong style={{ color: "#f8fafc", fontSize: 18 }}>{value}</strong>
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  border: "1px solid rgba(15,23,42,.12)",
  background: "linear-gradient(135deg, #061524 0%, #0b2036 52%, #07111f 100%)",
  borderRadius: 12,
  padding: 18,
  boxShadow: "0 18px 60px rgba(2,8,23,.22)",
};
const headerStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap" };
const eyebrowStyle: React.CSSProperties = { color: "#67e8f9", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0 };
const headingStyle: React.CSSProperties = { color: "#f8fafc", margin: "3px 0 0", fontSize: 24 };
const metricsStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, minmax(90px, 1fr))", gap: 8 };
const metricStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, border: "1px solid rgba(125,211,252,.18)", background: "rgba(15,23,42,.6)", borderRadius: 8, padding: "8px 10px" };
const layoutStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.8fr) minmax(280px, .8fr)", gap: 14 };
const mapCardStyle: React.CSSProperties = { position: "relative", overflow: "hidden", border: "1px solid rgba(125,211,252,.16)", borderRadius: 12, background: "#04111f", minHeight: 410 };
const legendStyle: React.CSSProperties = { position: "absolute", left: 14, bottom: 12, display: "flex", gap: 12, flexWrap: "wrap", color: "#cbd5e1", fontSize: 12, background: "rgba(2,6,23,.55)", border: "1px solid rgba(148,163,184,.16)", borderRadius: 999, padding: "6px 10px" };
const sourceStripStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginTop: 14 };
