"use client";

import { useMemo, useState } from "react";
import type React from "react";
import type { IntelligenceHotspot, IntelligenceMapData } from "@/lib/market-intelligence/intelligence-map";
import { IntelligenceHotspotPanel } from "./intelligence-hotspot-panel";
import { IntelligenceSourceCard } from "./intelligence-source-card";
import { WorldMapBase, worldMapBaseSize, worldMapBaseViewBox } from "./world-map-base";

function project(lat: number, lng: number) {
  return {
    x: ((lng + 180) / 360) * 1000,
    y: ((90 - lat) / 180) * 500,
  };
}

type ReferencePoint = {
  label: string;
  lat: number;
  lng: number;
  align?: "left" | "right";
  dx?: number;
  dy?: number;
};

const CONTINENT_LABELS: ReferencePoint[] = [
  { label: "North America", lat: 49, lng: -107 },
  { label: "South America", lat: -18, lng: -61 },
  { label: "Europe", lat: 54, lng: 18 },
  { label: "Africa", lat: 3, lng: 22 },
  { label: "Asia", lat: 39, lng: 92 },
  { label: "Middle East", lat: 26, lng: 47 },
  { label: "Oceania", lat: -25, lng: 137 },
];

const REFERENCE_PORTS: ReferencePoint[] = [
  { label: "Los Angeles", lat: 33.74, lng: -118.26, align: "right", dx: -8, dy: -7 },
  { label: "Long Beach", lat: 33.75, lng: -118.2, dx: 8, dy: 11 },
  { label: "Rotterdam", lat: 51.92, lng: 4.48, align: "right", dx: -8, dy: -8 },
  { label: "Hamburg", lat: 53.55, lng: 9.99, dx: 8, dy: -13 },
  { label: "Istanbul", lat: 41.01, lng: 28.97, dx: 8, dy: 12 },
  { label: "Singapore", lat: 1.29, lng: 103.85, dx: 8, dy: 10 },
  { label: "Shanghai", lat: 31.23, lng: 121.47, dx: 8, dy: -8 },
];

const REFERENCE_CHOKEPOINTS: ReferencePoint[] = [
  { label: "Panama Canal", lat: 9.08, lng: -79.68, align: "right", dx: -9, dy: -8 },
  { label: "Suez Canal", lat: 30.45, lng: 32.35, dx: 9, dy: -10 },
  { label: "Strait of Hormuz", lat: 26.56, lng: 56.25, dx: 10, dy: -3 },
  { label: "Bab el-Mandeb", lat: 12.58, lng: 43.33, align: "right", dx: -9, dy: 12 },
  { label: "Strait of Malacca", lat: 3, lng: 101, dx: 9, dy: 10 },
  { label: "Bosporus", lat: 41.12, lng: 29.07, dx: 9, dy: 12 },
  { label: "Gibraltar", lat: 35.96, lng: -5.6, align: "right", dx: -9, dy: 12 },
];

const SOURCE_BUTTON_LABELS = ["Maersk", "Drewry", "CBP", "Port of LA"];

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
          <svg viewBox={worldMapBaseViewBox} role="img" aria-label="Freight market intelligence world map" style={worldMapBaseSize}>
            <WorldMapBase />
            <ReferenceGeographyLayer />
            <g>
              {data.lanes.map((lane) => (
                <path
                  key={lane.id}
                  d={arcPath(lane.from, lane.to)}
                  fill="none"
                  stroke={severityColor(lane.severity)}
                  strokeWidth={Math.min(5, 1.4 + lane.signalCount)}
                  strokeOpacity=".62"
                  strokeLinecap="round"
                />
              ))}
            </g>
            {data.hotspots.length === 0 && (
              <g>
                <rect x="318" y="200" width="364" height="104" rx="14" fill="#020617" fillOpacity=".72" stroke="#7dd3fc" strokeOpacity=".58" />
                <circle cx="350" cy="235" r="24" fill="#38bdf8" opacity=".18" />
                <circle cx="350" cy="235" r="10" fill="#38bdf8" opacity=".72" />
                <text x="382" y="232" fill="#f8fafc" stroke="#020617" strokeWidth="4" paintOrder="stroke" fontSize="16" fontWeight="900">Pull trusted market data to light up the map</text>
                <text x="382" y="253" fill="#dbeafe" stroke="#020617" strokeWidth="3" paintOrder="stroke" fontSize="12" fontWeight="700">Use official carrier, rate, customs, and port sources.</text>
                {SOURCE_BUTTON_LABELS.map((label, index) => (
                  <g key={`empty-source-${label}`} transform={`translate(${382 + index * 72} 270)`}>
                    <rect width={index === 3 ? 64 : 58} height="20" rx="10" fill="#0f2a3d" stroke="#bae6fd" strokeOpacity=".58" />
                    <text x={(index === 3 ? 32 : 29)} y="14" textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="900">{label}</text>
                  </g>
                ))}
              </g>
            )}
            <g>
              {data.hotspots.map((hotspot) => {
                const point = project(hotspot.lat, hotspot.lng);
                const color = severityColor(hotspot.severity);
                const active = selected?.id === hotspot.id;
                const radius = Math.min(18, 7 + hotspot.signalCount * 2 + hotspot.pendingReviewCount);
                const isChokepoint = hotspot.type === "chokepoint";
                const isComplianceCountry = hotspot.type === "country" && (hotspot.category === "customs" || hotspot.category === "compliance");
                const labelOffset = hotspot.type === "country" ? 14 : radius + 7;
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
                    {hotspot.pendingReviewCount > 0 && (
                      <circle cx={point.x} cy={point.y} r={radius + 12} fill="none" stroke="#fef3c7" strokeWidth="2" opacity=".72" />
                    )}
                    {isComplianceCountry ? (
                      <g>
                        <path
                          d={`M ${point.x.toFixed(1)} ${(point.y - radius - 7).toFixed(1)} L ${(point.x + radius + 7).toFixed(1)} ${(point.y - radius + 1).toFixed(1)} L ${(point.x + radius + 3).toFixed(1)} ${(point.y + radius + 8).toFixed(1)} Q ${point.x.toFixed(1)} ${(point.y + radius + 15).toFixed(1)} ${(point.x - radius - 3).toFixed(1)} ${(point.y + radius + 8).toFixed(1)} L ${(point.x - radius - 7).toFixed(1)} ${(point.y - radius + 1).toFixed(1)} Z`}
                          fill="#0f766e"
                          opacity={hotspot.suppressed ? ".42" : ".94"}
                          stroke="#fef3c7"
                          strokeWidth={active ? 2.8 : 1.4}
                          strokeDasharray={hotspot.suppressed ? "3 3" : undefined}
                        />
                        <text
                          x={point.x}
                          y={point.y + 5}
                          textAnchor="middle"
                          fill="#fef3c7"
                          stroke="#082f49"
                          strokeWidth="2"
                          paintOrder="stroke"
                          fontSize="12"
                          fontWeight="950"
                        >
                          CBP
                        </text>
                      </g>
                    ) : isChokepoint ? (
                      <path
                        d={`M ${point.x.toFixed(1)} ${(point.y - radius).toFixed(1)} L ${(point.x + radius).toFixed(1)} ${point.y.toFixed(1)} L ${point.x.toFixed(1)} ${(point.y + radius).toFixed(1)} L ${(point.x - radius).toFixed(1)} ${point.y.toFixed(1)} Z`}
                        fill={color}
                        opacity={hotspot.suppressed ? ".38" : ".9"}
                        stroke="#eff6ff"
                        strokeWidth={active ? 2.6 : 1.2}
                        strokeDasharray={hotspot.suppressed ? "3 3" : undefined}
                      />
                    ) : (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={radius}
                        fill={color}
                        opacity={hotspot.suppressed ? ".38" : ".88"}
                        stroke="#eff6ff"
                        strokeWidth={active ? 2.4 : 1}
                        strokeDasharray={hotspot.suppressed ? "3 3" : undefined}
                      />
                    )}
                    {!isComplianceCountry && <HotspotGlyph category={hotspot.category} type={hotspot.type} x={point.x - 7} y={point.y - 7} suppressed={hotspot.suppressed} />}
                    <circle cx={point.x} cy={point.y} r={radius + 5} fill="none" stroke={color} strokeWidth="1.5" opacity={hotspot.suppressed ? ".18" : ".55"}>
                      <animate attributeName="r" values={`${radius + 5};${radius + 13};${radius + 5}`} dur="2.8s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values={hotspot.suppressed ? ".18;.03;.18" : ".55;.08;.55"} dur="2.8s" repeatCount="indefinite" />
                    </circle>
                    <text
                      x={point.x + labelOffset}
                      y={point.y + (isComplianceCountry ? 27 : 4)}
                      fill={hotspot.suppressed ? "#cbd5e1" : "#f8fafc"}
                      stroke="#020617"
                      strokeWidth="3"
                      paintOrder="stroke"
                      fontSize="13"
                      fontWeight={active ? 900 : 800}
                    >
                      {isComplianceCountry ? `${hotspot.label} compliance` : hotspot.label}
                    </text>
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

function ReferenceGeographyLayer() {
  return (
    <g aria-hidden="true" pointerEvents="none">
      <g>
        {CONTINENT_LABELS.map((item) => {
          const point = project(item.lat, item.lng);
          return (
            <text
              key={`continent-${item.label}`}
              x={point.x}
              y={point.y}
              textAnchor="middle"
              fill="#dbeafe"
              stroke="#020617"
              strokeWidth="3.5"
              paintOrder="stroke"
              fontSize="16"
              fontWeight="900"
              opacity=".66"
            >
              {item.label}
            </text>
          );
        })}
      </g>
      <g>
        {REFERENCE_CHOKEPOINTS.map((item) => {
          const point = project(item.lat, item.lng);
          const offset = item.align === "right" ? (item.dx ?? -9) : (item.dx ?? 9);
          return (
            <g key={`chokepoint-${item.label}`}>
              <path
                d={`M ${point.x.toFixed(1)} ${(point.y - 5).toFixed(1)} L ${(point.x + 5).toFixed(1)} ${point.y.toFixed(1)} L ${point.x.toFixed(1)} ${(point.y + 5).toFixed(1)} L ${(point.x - 5).toFixed(1)} ${point.y.toFixed(1)} Z`}
                fill="#fde68a"
                stroke="#020617"
                strokeWidth="1.4"
                opacity=".86"
              />
              <text
                x={point.x + offset}
                y={point.y + (item.dy ?? 4)}
                textAnchor={item.align === "right" ? "end" : "start"}
                fill="#fef3c7"
                stroke="#020617"
                strokeWidth="3"
                paintOrder="stroke"
                fontSize="9"
                fontWeight="900"
                opacity=".95"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </g>
      <g>
        {REFERENCE_PORTS.map((item) => {
          const point = project(item.lat, item.lng);
          const textAnchor = item.align === "right" ? "end" : "start";
          return (
            <g key={`reference-port-${item.label}`}>
              <circle cx={point.x} cy={point.y} r="3.5" fill="#67e8f9" stroke="#020617" strokeWidth="1.2" opacity=".88" />
              <text
                x={point.x + (item.dx ?? 6)}
                y={point.y + (item.dy ?? -5)}
                textAnchor={textAnchor}
                fill="#bae6fd"
                stroke="#020617"
                strokeWidth="2.5"
                paintOrder="stroke"
                fontSize="8.5"
                fontWeight="800"
                opacity=".84"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
}

function HotspotGlyph({
  category,
  type,
  x,
  y,
  suppressed,
}: {
  category: string;
  type: string;
  x: number;
  y: number;
  suppressed: boolean;
}) {
  const stroke = suppressed ? "#cbd5e1" : "#082f49";
  const common = { fill: "none", stroke, strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (category === "rate") {
    return <g transform={`translate(${x} ${y})`}><path {...common} d="M1 13h12M3 11l3-4 3 2 3-6M12 3H9M12 3v3" /></g>;
  }
  if (category === "customs" || category === "compliance") {
    return <g transform={`translate(${x} ${y})`}><path {...common} d="M3 1h6l4 4v10H3zM9 1v5h4M5 9h6M5 12h5" /></g>;
  }
  if (type === "chokepoint") {
    return <g transform={`translate(${x} ${y})`}><path {...common} d="M2 8h11M5 4l3-3 3 3M8 1v13M4 12c2 1.5 6 1.5 8 0" /></g>;
  }
  if (category === "port_disruption") {
    return <g transform={`translate(${x} ${y})`}><path {...common} d="M1 14h13M4 12V5l3-3 3 3v7M7 2v12M5 12V9h5v3" /></g>;
  }
  return <g transform={`translate(${x} ${y})`}><path {...common} d="M1 10l2-5h8l3 5M3 10c2 2 4 2 6 0 2 2 3 2 5 0M5 5V2h5v3" /></g>;
}

function MapMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={metricStyle}>
      <span style={{ color: "#bfdbfe", fontSize: 11, fontWeight: 700 }}>{label}</span>
      <strong style={{ color: "#ffffff", fontSize: 18 }}>{value}</strong>
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  border: "1px solid rgba(14,116,144,.34)",
  backgroundColor: "#08111f",
  backgroundImage: "linear-gradient(135deg, #07111f 0%, #0b2036 52%, #08111f 100%)",
  borderRadius: 12,
  padding: 18,
  boxShadow: "0 18px 60px rgba(2,8,23,.28)",
  color: "#f8fafc",
};
const headerStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap" };
const eyebrowStyle: React.CSSProperties = { color: "#67e8f9", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0 };
const headingStyle: React.CSSProperties = { color: "#ffffff", margin: "3px 0 0", fontSize: 24, textShadow: "0 2px 14px rgba(0,0,0,.45)" };
const metricsStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, minmax(90px, 1fr))", gap: 8 };
const metricStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2, border: "1px solid rgba(125,211,252,.34)", backgroundColor: "#13243a", backgroundImage: "linear-gradient(180deg, rgba(14,165,233,.18), rgba(15,23,42,.12))", borderRadius: 8, padding: "8px 10px", boxShadow: "0 10px 24px rgba(2,8,23,.18)" };
const layoutStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.8fr) minmax(280px, .8fr)", gap: 14 };
const mapCardStyle: React.CSSProperties = { position: "relative", overflow: "hidden", border: "1px solid rgba(125,211,252,.32)", borderRadius: 12, backgroundColor: "#04111f", minHeight: 440, boxShadow: "inset 0 0 0 1px rgba(255,255,255,.04)" };
const legendStyle: React.CSSProperties = { position: "absolute", left: 14, bottom: 12, display: "flex", gap: 12, flexWrap: "wrap", color: "#e2e8f0", fontSize: 12, fontWeight: 700, backgroundColor: "rgba(2,6,23,.82)", border: "1px solid rgba(148,163,184,.28)", borderRadius: 999, padding: "6px 10px" };
const sourceStripStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginTop: 14 };
