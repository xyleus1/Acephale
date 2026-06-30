import type React from "react";
import { WORLD_MAP_LAND_PATHS, WORLD_MAP_VIEWBOX } from "@/lib/market-intelligence/world-map-asset";

export function WorldMapBase() {
  return (
    <>
      <defs>
        <radialGradient id="ocean-glow" cx="50%" cy="45%" r="72%">
          <stop offset="0%" stopColor="#17446f" />
          <stop offset="55%" stopColor="#09213a" />
          <stop offset="100%" stopColor="#020b16" />
        </radialGradient>
        <linearGradient id="land-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6f8fa8" />
          <stop offset="52%" stopColor="#426b8e" />
          <stop offset="100%" stopColor="#244f73" />
        </linearGradient>
        <filter id="land-shadow">
          <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#020617" floodOpacity=".55" />
        </filter>
        <filter id="coastline-glow">
          <feDropShadow dx="0" dy="0" stdDeviation="1.7" floodColor="#d8e5ef" floodOpacity=".42" />
        </filter>
        <filter id="hotspot-blur">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <rect width="1000" height="500" fill="url(#ocean-glow)" rx="16" />
      <LatitudeLongitudeGrid />
      <g fill="url(#land-gradient)" stroke="#d8e5ef" strokeOpacity=".78" strokeWidth="1.2" filter="url(#land-shadow)">
        {WORLD_MAP_LAND_PATHS.map((path, index) => (
          <path key={`natural-earth-land-${index}`} d={path} />
        ))}
      </g>
      <g fill="none" stroke="#f4f8fb" strokeOpacity=".34" strokeWidth="2.3" filter="url(#coastline-glow)">
        {WORLD_MAP_LAND_PATHS.map((path, index) => (
          <path key={`natural-earth-coastline-${index}`} d={path} />
        ))}
      </g>
      <g opacity=".32" stroke="#bfd2e2" strokeWidth="1.1" strokeDasharray="6 9" fill="none">
        <path d="M184 278 C300 205 397 203 508 245" />
        <path d="M508 245 C618 213 719 211 840 262" />
        <path d="M500 278 C520 335 545 380 590 430" />
        <path d="M330 266 C390 323 462 350 560 337" />
      </g>
    </>
  );
}

function LatitudeLongitudeGrid() {
  const latLines = [-60, -30, 0, 30, 60];
  const lngLines = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
  return (
    <g>
      <g opacity=".28" stroke="#bfd2e2" strokeWidth="1">
        {latLines.map((lat) => {
          const y = ((90 - lat) / 180) * 500;
          return <path key={`lat-${lat}`} d={`M 25 ${y.toFixed(1)} H 975`} />;
        })}
        {lngLines.map((lng) => {
          const x = ((lng + 180) / 360) * 1000;
          return <path key={`lng-${lng}`} d={`M ${x.toFixed(1)} 25 V 475`} />;
        })}
      </g>
      <g opacity=".9" fill="#eaf2f8" fontSize="10" fontWeight="700">
        {latLines.map((lat) => {
          const y = ((90 - lat) / 180) * 500;
          return <text key={`lat-label-${lat}`} x="32" y={y - 4}>{lat > 0 ? `${lat}N` : lat < 0 ? `${Math.abs(lat)}S` : "EQ"}</text>;
        })}
        {[-120, -60, 0, 60, 120].map((lng) => {
          const x = ((lng + 180) / 360) * 1000;
          return <text key={`lng-label-${lng}`} x={x + 4} y="468">{lng > 0 ? `${lng}E` : lng < 0 ? `${Math.abs(lng)}W` : "0"}</text>;
        })}
      </g>
    </g>
  );
}

export const worldMapBaseSize: React.CSSProperties = {
  width: "100%",
  height: "auto",
  aspectRatio: "2 / 1",
  display: "block",
};

export const worldMapBaseViewBox = WORLD_MAP_VIEWBOX;
