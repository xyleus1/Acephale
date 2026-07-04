import type React from "react";
import { WORLD_MAP_LAND_PATHS, WORLD_MAP_VIEWBOX } from "@/lib/market-intelligence/world-map-asset";

export function WorldMapBase() {
  return (
    <>
      <defs>
        <radialGradient id="ocean-glow" cx="48%" cy="43%" r="76%">
          <stop offset="0%" stopColor="#155e75" />
          <stop offset="48%" stopColor="#0f2f4f" />
          <stop offset="100%" stopColor="#06111f" />
        </radialGradient>
        <linearGradient id="land-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6f8fa8" />
          <stop offset="52%" stopColor="#426b8e" />
          <stop offset="100%" stopColor="#244f73" />
        </linearGradient>
        <linearGradient id="shelf-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d8e5ef" stopOpacity=".14" />
          <stop offset="100%" stopColor="#6f8fa8" stopOpacity=".04" />
        </linearGradient>
        <filter id="land-shadow">
          <feDropShadow dx="0" dy="5" stdDeviation="6" floodColor="#020617" floodOpacity=".62" />
        </filter>
        <filter id="coastline-glow">
          <feDropShadow dx="0" dy="0" stdDeviation="1.9" floodColor="#d8e5ef" floodOpacity=".48" />
        </filter>
        <filter id="hotspot-blur">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <rect width="1000" height="500" fill="url(#ocean-glow)" rx="16" />
      <LatitudeLongitudeGrid />
      <g fill="none" stroke="url(#shelf-gradient)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        {WORLD_MAP_LAND_PATHS.map((path, index) => (
          <path key={`natural-earth-shelf-${index}`} d={path} />
        ))}
      </g>
      <g fill="url(#land-gradient)" stroke="#d8e5ef" strokeOpacity=".78" strokeWidth="1.2" filter="url(#land-shadow)">
        {WORLD_MAP_LAND_PATHS.map((path, index) => (
          <path key={`natural-earth-land-${index}`} d={path} />
        ))}
      </g>
      <g fill="none" stroke="#f4f8fb" strokeOpacity=".44" strokeWidth="1.9" filter="url(#coastline-glow)">
        {WORLD_MAP_LAND_PATHS.map((path, index) => (
          <path key={`natural-earth-coastline-${index}`} d={path} />
        ))}
      </g>
      <g opacity=".38" stroke="#bfd2e2" strokeWidth="1.2" strokeDasharray="8 10" fill="none">
        <path d="M184 278 C300 205 397 203 508 245" />
        <path d="M508 245 C618 213 719 211 840 262" />
        <path d="M500 278 C520 335 545 380 590 430" />
        <path d="M330 266 C390 323 462 350 560 337" />
        <path d="M585 249 C650 230 714 230 786 244" />
      </g>
    </>
  );
}

function LatitudeLongitudeGrid() {
  const latLines = [-60, -30, 0, 30, 60];
  const lngLines = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
  return (
    <g>
      <g opacity=".3" stroke="#bfd2e2" strokeWidth=".9">
        {latLines.map((lat) => {
          const y = ((90 - lat) / 180) * 500;
          return <path key={`lat-${lat}`} d={`M 25 ${y.toFixed(1)} H 975`} />;
        })}
        {lngLines.map((lng) => {
          const x = ((lng + 180) / 360) * 1000;
          return <path key={`lng-${lng}`} d={`M ${x.toFixed(1)} 25 V 475`} />;
        })}
      </g>
      <g opacity=".9" fill="#eaf2f8" fontSize="10" fontWeight="800">
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
