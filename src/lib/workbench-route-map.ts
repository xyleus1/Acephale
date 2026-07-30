import type { RouteMapPoint } from "@/lib/route-map-viewport";

type RouteGeoEntry = {
  match: string[];
  label: string;
  country: string;
  countryCode: string;
  lon: number;
  lat: number;
};

const ROUTE_GEO_LOOKUP: RouteGeoEntry[] = [
  { match: ["port klang", "klang"], label: "Port Klang", country: "Malaysia", countryCode: "MY", lon: 101.397, lat: 2.999 },
  { match: ["shannon"], label: "Shannon", country: "Ireland", countryCode: "IE", lon: -8.864, lat: 52.713 },
  { match: ["giresun"], label: "Giresun", country: "Turkey", countryCode: "TR", lon: 38.3895, lat: 40.9128 },
  { match: ["ancona"], label: "Ancona", country: "Italy", countryCode: "IT", lon: 13.5189, lat: 43.6158 },
  { match: ["istanbul"], label: "Istanbul", country: "Turkey", countryCode: "TR", lon: 28.978, lat: 41.008 },
  { match: ["ambarlı", "ambarli", "körfez", "korfez"], label: "Ambarli", country: "Turkey", countryCode: "TR", lon: 28.685, lat: 40.969 },
  { match: ["singapore"], label: "Singapore", country: "Singapore", countryCode: "SG", lon: 103.852, lat: 1.29 },
  { match: ["constanta", "constanța"], label: "Constanta", country: "Romania", countryCode: "RO", lon: 28.634, lat: 44.159 },
  { match: ["hamburg"], label: "Hamburg", country: "Germany", countryCode: "DE", lon: 9.993, lat: 53.551 },
  { match: ["berlin"], label: "Berlin", country: "Germany", countryCode: "DE", lon: 13.405, lat: 52.52 },
  { match: ["mersin"], label: "Mersin", country: "Turkey", countryCode: "TR", lon: 34.641, lat: 36.812 },
  { match: ["izmir"], label: "Izmir", country: "Turkey", countryCode: "TR", lon: 27.142, lat: 38.423 },
  { match: ["adana"], label: "Adana", country: "Turkey", countryCode: "TR", lon: 35.321, lat: 37.0 },
  { match: ["gemlik"], label: "Gemlik", country: "Turkey", countryCode: "TR", lon: 29.159, lat: 40.431 },
  { match: ["shenzhen"], label: "Shenzhen", country: "China", countryCode: "CN", lon: 114.0579, lat: 22.5431 },
  { match: ["yangshan"], label: "Yangshan Deep-Water Port", country: "China", countryCode: "CN", lon: 122.071, lat: 30.626 },
  { match: ["shanghai"], label: "Shanghai", country: "China", countryCode: "CN", lon: 121.474, lat: 31.23 },
  { match: ["ningbo"], label: "Ningbo", country: "China", countryCode: "CN", lon: 121.55, lat: 29.868 },
  { match: ["rotterdam"], label: "Rotterdam", country: "Netherlands", countryCode: "NL", lon: 4.48, lat: 51.924 },
  { match: ["dubai", "jebel ali"], label: "Jebel Ali", country: "UAE", countryCode: "AE", lon: 55.027, lat: 24.985 },
  { match: ["jeddah"], label: "Jeddah", country: "Saudi Arabia", countryCode: "SA", lon: 39.197, lat: 21.485 },
  { match: ["ashgabat"], label: "Ashgabat", country: "Turkmenistan", countryCode: "TM", lon: 58.383, lat: 37.96 },
  { match: ["port sudan"], label: "Port Sudan", country: "Sudan", countryCode: "SD", lon: 37.216, lat: 19.615 },
  { match: ["munich"], label: "Munich", country: "Germany", countryCode: "DE", lon: 11.582, lat: 48.135 },
  { match: ["port of long beach", "long beach", "polb"], label: "Port of Long Beach", country: "United States", countryCode: "US", lon: -118.216, lat: 33.754 },
  { match: ["port of los angeles", "los angeles", "la port", "san pedro"], label: "Port of Los Angeles", country: "United States", countryCode: "US", lon: -118.264, lat: 33.739 },
  { match: ["irvine"], label: "Irvine", country: "United States", countryCode: "US", lon: -117.8265, lat: 33.6846 },
  { match: ["houston"], label: "Houston", country: "United States", countryCode: "US", lon: -95.369, lat: 29.76 },
  { match: ["guadalajara"], label: "Guadalajara", country: "Mexico", countryCode: "MX", lon: -103.3496, lat: 20.6597 },
];

function routePointFromGeo(label: string, country: string, countryCode: string | null, lon: number, lat: number): RouteMapPoint {
  return {
    label,
    country,
    countryCode,
    lon,
    lat,
  };
}

function matchesGeoEntry(normalized: string, entry: RouteGeoEntry) {
  return entry.match.some((token) => normalized.includes(token));
}

export function flagEmoji(countryCode: string | null) {
  if (!countryCode || countryCode.length !== 2) return "";
  const code = countryCode.toUpperCase();
  return String.fromCodePoint(...[...code].map((char) => 127397 + char.charCodeAt(0)));
}

export function routeMapPoint(
  value: string | null | undefined,
  _fallback: "origin" | "destination"
): RouteMapPoint | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const hit = ROUTE_GEO_LOOKUP.find((entry) => matchesGeoEntry(normalized, entry));
  if (hit) {
    return routePointFromGeo(raw || hit.label, hit.country, hit.countryCode, hit.lon, hit.lat);
  }
  return null;
}

const ROUTE_KNOWN_WAYPOINTS = {
  hongKong: routePointFromGeo("Hong Kong approach", "China", "CN", 114.109, 22.396),
  singapore: routePointFromGeo("Singapore / Malacca", "Singapore", "SG", 103.852, 1.29),
  colombo: routePointFromGeo("Colombo sea lane", "Sri Lanka", "LK", 79.861, 6.927),
  suez: routePointFromGeo("Suez Canal", "Egypt", "EG", 32.55, 29.97),
  bosphorus: routePointFromGeo("Bosphorus", "Turkey", "TR", 29.05, 41.02),
  dardanelles: routePointFromGeo("Dardanelles", "Turkey", "TR", 26.42, 40.15),
  adriatic: routePointFromGeo("Adriatic approach", "Italy", "IT", 15.2, 42.35),
};

export function routeLegPoints(origin: RouteMapPoint, destination: RouteMapPoint, mode: string | null | undefined) {
  const seaMode = (mode ?? "").toUpperCase().includes("SEA");
  const asiaOrigin = origin.lon >= 70 && origin.lon <= 130;
  const turkeyDestination = destination.countryCode === "TR" || (destination.lon >= 24 && destination.lon <= 45 && destination.lat >= 35);
  const europeanDestination = destination.lon >= -10 && destination.lon <= 40 && destination.lat >= 35 && destination.lat <= 60;
  const blackSeaTurkeyOrigin = origin.countryCode === "TR" && origin.lon >= 34 && origin.lat >= 40;
  const adriaticDestination = ["IT", "SI", "HR", "ME", "AL"].includes(destination.countryCode ?? "")
    || (destination.lon >= 12 && destination.lon <= 20 && destination.lat >= 39 && destination.lat <= 46);

  if (seaMode && blackSeaTurkeyOrigin && adriaticDestination) {
    return [
      origin,
      ROUTE_KNOWN_WAYPOINTS.bosphorus,
      ROUTE_KNOWN_WAYPOINTS.dardanelles,
      ROUTE_KNOWN_WAYPOINTS.adriatic,
      destination,
    ];
  }

  if (seaMode && asiaOrigin && (turkeyDestination || europeanDestination)) {
    return [
      origin,
      ...(origin.lon > 112 ? [ROUTE_KNOWN_WAYPOINTS.hongKong] : []),
      ROUTE_KNOWN_WAYPOINTS.singapore,
      ROUTE_KNOWN_WAYPOINTS.colombo,
      ROUTE_KNOWN_WAYPOINTS.suez,
      destination,
    ];
  }

  return [origin, destination];
}

export function transitSummary(etd: Date | null | undefined, eta: Date | null | undefined) {
  if (!etd || !eta) return "Transit TBD";
  const days = Math.max(1, Math.round((eta.getTime() - etd.getTime()) / 86400000));
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function modeSummary(modeLabel: string, transitLabel: string) {
  return transitLabel === "Transit TBD" ? `${modeLabel} · timing TBD` : `${modeLabel} · ${transitLabel}`;
}
