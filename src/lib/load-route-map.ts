import { routeMapPoint } from "@/lib/workbench-route-map";
import type { RouteMapPoint } from "@/lib/route-map-viewport";

export type LoadRouteMode = "OCEAN" | "ROAD" | "AIR" | "RAIL";

export type LoadRouteEndpoint = {
  input: string | null;
  label: string;
  resolved: boolean;
  point: RouteMapPoint | null;
  reason: string;
};

export type LoadRoutePathPoint = {
  lon: number;
  lat: number;
};

export type LoadRouteLeg = {
  id: string;
  mode: LoadRouteMode;
  label: string;
  from: RouteMapPoint;
  to: RouteMapPoint;
  pathPoints: RouteMapPoint[];
  pathSegments: LoadRoutePathPoint[][];
};

export type LoadRouteStop = {
  id: string;
  eyebrow: string;
  point: RouteMapPoint;
  modeAfter: LoadRouteMode | null;
};

export type LoadRoutePlan = {
  origin: LoadRouteEndpoint;
  destination: LoadRouteEndpoint;
  canRender: boolean;
  unresolvedLabels: string[];
  routeNotice: string | null;
  stops: LoadRouteStop[];
  legs: LoadRouteLeg[];
};

export type ProjectedLoadRoutePoint = LoadRoutePathPoint & {
  x: number;
  y: number;
};

const PACIFIC_WAYPOINTS: RouteMapPoint[] = [
  {
    label: "North Pacific west",
    country: "Pacific Ocean",
    countryCode: null,
    lon: 150,
    lat: 38,
  },
  {
    label: "International Date Line west",
    country: "Pacific Ocean",
    countryCode: null,
    lon: 179,
    lat: 43,
  },
  {
    label: "International Date Line east",
    country: "Pacific Ocean",
    countryCode: null,
    lon: -179,
    lat: 43,
  },
  {
    label: "North Pacific east",
    country: "Pacific Ocean",
    countryCode: null,
    lon: -145,
    lat: 40,
  },
];

function normalized(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isShanghaiArea(point: RouteMapPoint) {
  return point.countryCode === "CN"
    && point.lon >= 120.5
    && point.lon <= 123
    && point.lat >= 30
    && point.lat <= 32.5;
}

function isSouthernCalifornia(point: RouteMapPoint) {
  return point.countryCode === "US"
    && point.lon >= -119.2
    && point.lon <= -117
    && point.lat >= 32.8
    && point.lat <= 34.5;
}

function isExplicitYangshanPort(value: string | null) {
  const input = normalized(value);
  return input.includes("yangshan");
}

function isExplicitSouthernCaliforniaPort(value: string | null) {
  const input = normalized(value);
  return (
    input.includes("port of los angeles")
    || input.includes("los angeles port")
    || input === "la port"
    || input.includes("port of long beach")
    || input.includes("long beach port")
    || input === "polb"
  );
}

function portResolutionNotice(originPortExplicit: boolean, destinationPortExplicit: boolean) {
  if (originPortExplicit && destinationPortExplicit) return null;
  if (!originPortExplicit && !destinationPortExplicit) {
    return "Exact origin and destination ports are unresolved. This map shows a city-area corridor only, not operational port calls.";
  }
  if (!originPortExplicit) {
    return "The exact origin port is unresolved. This map shows an origin-area corridor only, not an operational origin port call.";
  }
  return "The exact destination port is unresolved. This map shows a destination-area corridor only, not an operational destination port call.";
}

function isSeaMode(mode: string | null | undefined) {
  const value = normalized(mode);
  return value.includes("sea") || value.includes("ocean") || value.includes("fcl") || value.includes("lcl");
}

function loadRouteMode(mode: string | null | undefined): LoadRouteMode | null {
  const value = normalized(mode);
  if (value.includes("air")) return "AIR";
  if (value.includes("rail")) return "RAIL";
  if (isSeaMode(value)) return "OCEAN";
  if (value.includes("road") || value.includes("truck") || value.includes("courier")) return "ROAD";
  return null;
}

function endpoint(value: string | null | undefined, role: "origin" | "destination"): LoadRouteEndpoint {
  const input = String(value ?? "").trim() || null;
  if (!input) {
    return {
      input: null,
      label: role === "origin" ? "Origin unresolved" : "Destination unresolved",
      resolved: false,
      point: null,
      reason: `${role === "origin" ? "Origin" : "Destination"} is missing.`,
    };
  }

  const point = routeMapPoint(input, role);
  if (!point) {
    return {
      input,
      label: input,
      resolved: false,
      point: null,
      reason: `${input} does not match a known freight location.`,
    };
  }

  return {
    input,
    label: point.label,
    resolved: true,
    point,
    reason: `Resolved ${input} to ${point.label}.`,
  };
}

export function resolveLoadRouteEndpoint(
  value: string | null | undefined,
  role: "origin" | "destination"
) {
  return endpoint(value, role);
}

function crossingPoint(
  previous: LoadRoutePathPoint,
  current: LoadRoutePathPoint
): {
  previousEdge: LoadRoutePathPoint;
  nextEdge: LoadRoutePathPoint;
} {
  if (previous.lon > 0 && current.lon < 0) {
    const adjustedCurrentLon = current.lon + 360;
    const ratio = (180 - previous.lon) / (adjustedCurrentLon - previous.lon);
    const lat = previous.lat + ((current.lat - previous.lat) * ratio);
    return {
      previousEdge: { lon: 180, lat },
      nextEdge: { lon: -180, lat },
    };
  }

  const adjustedCurrentLon = current.lon - 360;
  const ratio = (-180 - previous.lon) / (adjustedCurrentLon - previous.lon);
  const lat = previous.lat + ((current.lat - previous.lat) * ratio);
  return {
    previousEdge: { lon: -180, lat },
    nextEdge: { lon: 180, lat },
  };
}

export function splitLoadRouteAtDateline(
  points: ReadonlyArray<LoadRoutePathPoint>
): LoadRoutePathPoint[][] {
  if (points.length === 0) return [];

  const segments: LoadRoutePathPoint[][] = [[{ ...points[0] }]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (Math.abs(current.lon - previous.lon) <= 180) {
      segments[segments.length - 1].push({ ...current });
      continue;
    }

    const crossing = crossingPoint(previous, current);
    segments[segments.length - 1].push(crossing.previousEdge);
    segments.push([crossing.nextEdge, { ...current }]);
  }
  return segments.filter((segment) => segment.length >= 2);
}

export function projectLoadRoutePoint(point: LoadRoutePathPoint): ProjectedLoadRoutePoint {
  return {
    ...point,
    x: ((point.lon + 180) / 360) * 1000,
    y: ((90 - point.lat) / 180) * 500,
  };
}

export function loadRouteSvgPath(points: ReadonlyArray<LoadRoutePathPoint>) {
  return points
    .map((point, index) => {
      const projected = projectLoadRoutePoint(point);
      return `${index === 0 ? "M" : "L"} ${projected.x.toFixed(1)} ${projected.y.toFixed(1)}`;
    })
    .join(" ");
}

function makeLeg(
  id: string,
  mode: LoadRouteMode,
  label: string,
  pathPoints: RouteMapPoint[]
): LoadRouteLeg {
  return {
    id,
    mode,
    label,
    from: pathPoints[0],
    to: pathPoints[pathPoints.length - 1],
    pathPoints,
    pathSegments: splitLoadRouteAtDateline(pathPoints),
  };
}

function stop(
  id: string,
  eyebrow: string,
  point: RouteMapPoint,
  modeAfter: LoadRouteMode | null
): LoadRouteStop {
  return { id, eyebrow, point, modeAfter };
}

export function buildLoadRoutePlan(input: {
  origin: string | null | undefined;
  destination: string | null | undefined;
  mode: string | null | undefined;
}): LoadRoutePlan {
  const origin = endpoint(input.origin, "origin");
  const destination = endpoint(input.destination, "destination");
  const unresolvedLabels = [
    !origin.resolved ? origin.label : null,
    !destination.resolved ? destination.label : null,
  ].filter((value): value is string => Boolean(value));

  if (!origin.point || !destination.point) {
    return {
      origin,
      destination,
      canRender: false,
      unresolvedLabels,
      routeNotice: null,
      stops: [],
      legs: [],
    };
  }

  const mode = loadRouteMode(input.mode);
  if (!mode) {
    return {
      origin,
      destination,
      canRender: false,
      unresolvedLabels: ["Transport mode"],
      routeNotice: null,
      stops: [],
      legs: [],
    };
  }
  if (
    mode === "OCEAN"
    && isShanghaiArea(origin.point)
    && isSouthernCalifornia(destination.point)
  ) {
    const originPortExplicit = isExplicitYangshanPort(origin.input);
    const destinationPortExplicit = isExplicitSouthernCaliforniaPort(destination.input);
    const unresolvedPorts = [
      !originPortExplicit ? "Exact origin port" : null,
      !destinationPortExplicit ? "Exact destination port" : null,
    ].filter((value): value is string => Boolean(value));
    const leg = makeLeg(
      "transpacific-ocean",
      "OCEAN",
      `${origin.point.label}${originPortExplicit ? "" : " area"} to ${destination.point.label}${destinationPortExplicit ? "" : " area"}`,
      [origin.point, ...PACIFIC_WAYPOINTS, destination.point]
    );

    return {
      origin,
      destination,
      canRender: true,
      unresolvedLabels: unresolvedPorts,
      routeNotice: portResolutionNotice(originPortExplicit, destinationPortExplicit),
      stops: [
        stop("origin", originPortExplicit ? "Origin port" : "Origin area", origin.point, "OCEAN"),
        stop("destination", destinationPortExplicit ? "Destination port" : "Destination area", destination.point, null),
      ],
      legs: [leg],
    };
  }

  const leg = makeLeg(
    "primary-leg",
    mode,
    `${origin.point.label} to ${destination.point.label}`,
    [origin.point, destination.point]
  );
  return {
    origin,
    destination,
    canRender: true,
    unresolvedLabels: [],
    routeNotice: null,
    stops: [
      stop("origin", "Origin", origin.point, mode),
      stop("destination", "Destination", destination.point, null),
    ],
    legs: [leg],
  };
}
