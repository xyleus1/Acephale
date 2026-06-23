import type React from "react";

export function WorldMapBase() {
  return (
    <>
      <defs>
        <radialGradient id="ocean-glow" cx="50%" cy="45%" r="72%">
          <stop offset="0%" stopColor="#12355f" />
          <stop offset="58%" stopColor="#081a2f" />
          <stop offset="100%" stopColor="#04111f" />
        </radialGradient>
        <linearGradient id="land-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#225b67" />
          <stop offset="55%" stopColor="#123f4a" />
          <stop offset="100%" stopColor="#0b2a36" />
        </linearGradient>
        <filter id="land-shadow">
          <feDropShadow dx="0" dy="5" stdDeviation="7" floodColor="#020617" floodOpacity=".55" />
        </filter>
        <filter id="hotspot-blur">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <rect width="1000" height="500" fill="url(#ocean-glow)" rx="16" />
      <LatitudeLongitudeGrid />
      <g fill="url(#land-gradient)" stroke="#76c7c4" strokeOpacity=".42" strokeWidth="1.2" filter="url(#land-shadow)">
        <NorthAmerica />
        <SouthAmerica />
        <Europe />
        <Africa />
        <Asia />
        <Australia />
        <Greenland />
      </g>
      <g opacity=".32" stroke="#7dd3fc" strokeWidth="1.1" strokeDasharray="6 9" fill="none">
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
      <g opacity=".18" stroke="#93c5fd" strokeWidth="1">
        {latLines.map((lat) => {
          const y = ((90 - lat) / 180) * 500;
          return <path key={`lat-${lat}`} d={`M 25 ${y.toFixed(1)} H 975`} />;
        })}
        {lngLines.map((lng) => {
          const x = ((lng + 180) / 360) * 1000;
          return <path key={`lng-${lng}`} d={`M ${x.toFixed(1)} 25 V 475`} />;
        })}
      </g>
      <g opacity=".52" fill="#93c5fd" fontSize="10">
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

function NorthAmerica() {
  return (
    <path d="M95 118c38-33 91-43 142-33 27 5 49 19 67 40 19 22 23 46 43 63 19 16 55 17 68 40 11 19-2 44-24 50-29 8-64-4-91 6-26 10-33 38-59 46-31 10-58-17-84-32-27-16-65-17-87-42-19-22-11-51-21-75-8-20-38-24-42-45-2-8 1-13 8-18z" />
  );
}

function SouthAmerica() {
  return (
    <path d="M278 293c31 5 56 23 70 52 13 27 3 56 13 84 9 26 37 44 28 69-9 25-45 29-63 11-18-17-18-47-32-69-17-27-48-43-58-74-9-27 2-61 42-73z" />
  );
}

function Europe() {
  return (
    <path d="M462 137c32-22 81-22 111-2 23 16 28 43 10 62-20 21-55 14-80 24-20 8-32 29-54 25-21-4-36-25-32-47 4-24 22-46 45-62z" />
  );
}

function Africa() {
  return (
    <path d="M508 226c45-9 83 17 97 60 13 41-2 83-21 119-16 31-38 58-72 52-31-6-36-43-55-65-22-27-52-42-51-78 1-42 44-80 102-88z" />
  );
}

function Asia() {
  return (
    <path d="M584 133c67-47 164-46 228-2 42 29 76 32 105 72 23 32 11 80-30 94-37 13-72-11-108-6-42 5-76 40-119 31-36-8-54-43-83-59-30-16-78-13-92-47-11-27 32-57 99-83z" />
  );
}

function Australia() {
  return (
    <path d="M755 363c41-18 94-6 126 24 27 26 15 61-23 72-45 13-98-5-128-38-23-25-11-44 25-58z" />
  );
}

function Greenland() {
  return (
    <path d="M312 52c32-29 91-26 117 6 20 25 3 57-37 66-43 10-91-13-101-45-3-10 4-20 21-27z" />
  );
}

export const worldMapBaseSize: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 430,
};
