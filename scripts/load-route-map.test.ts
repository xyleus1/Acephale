import { readFileSync } from "node:fs";
import {
  buildLoadRoutePlan,
  loadRouteSvgPath,
  projectLoadRoutePoint,
  resolveLoadRouteEndpoint,
} from "../src/lib/load-route-map";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function resolvedPoint(value: string, role: "origin" | "destination") {
  const endpoint = resolveLoadRouteEndpoint(value, role);
  assert(endpoint.point, `${value} should resolve to a known freight location`);
  return endpoint.point;
}

for (const [value, role, countryCode] of [
  ["Shanghai, China", "origin", "CN"],
  ["Yangshan Deep-Water Port", "origin", "CN"],
  ["Port of Los Angeles", "destination", "US"],
  ["Port of Long Beach", "destination", "US"],
  ["Irvine, CA", "destination", "US"],
] as const) {
  assert(
    resolvedPoint(value, role).countryCode === countryCode,
    `${value} should resolve to ${countryCode}`
  );
}

assert(
  resolveLoadRouteEndpoint("United States", "destination").point === null,
  "Country-only United States should remain unresolved"
);
assert(
  resolveLoadRouteEndpoint("Some unnamed warehouse", "origin").point === null,
  "Unknown warehouses should remain unresolved"
);

const irvinePlan = buildLoadRoutePlan({
  origin: "Shanghai, China",
  destination: "Irvine, CA",
  mode: "SEA-FCL",
});

assert(irvinePlan.canRender, "Shanghai to Irvine should produce a route plan");
assert(
  irvinePlan.legs.map((leg) => leg.mode).join(",") === "OCEAN",
  "Shanghai to Irvine should show a coarse ocean corridor until exact ports are known"
);
assert(
  irvinePlan.stops.map((stop) => stop.point.label).join("|")
    === "Shanghai, China|Irvine, CA",
  "Shanghai to Irvine should not invent operational port handoffs"
);
assert(
  irvinePlan.unresolvedLabels.join("|") === "Exact origin port|Exact destination port",
  "Shanghai to Irvine should keep both exact ports unresolved"
);
assert(
  irvinePlan.routeNotice?.includes("city-area corridor only"),
  "Shanghai to Irvine should visibly label the city-area precision"
);

const oceanLeg = irvinePlan.legs.find((leg) => leg.mode === "OCEAN");
assert(oceanLeg, "Shanghai to Irvine should include an ocean leg");
assert(
  oceanLeg.pathSegments.length === 2,
  "The transpacific route should split into two dateline-safe SVG segments"
);
assert(
  !oceanLeg.pathPoints.some((point) => point.label.includes("Suez")),
  "Shanghai to Southern California must not route through Suez"
);
assert(
  !oceanLeg.pathPoints.some((point) => (
    point.label.includes("Yangshan")
    || point.label.includes("Port of Los Angeles")
    || point.label.includes("Port of Long Beach")
  )),
  "City-level inputs must not inject exact ports into route geometry"
);

for (const segment of oceanLeg.pathSegments) {
  assert(segment.length >= 2, "Each dateline-safe path segment should be drawable");
  assert(loadRouteSvgPath(segment).startsWith("M "), "Each SVG route segment should start with M");
  for (let index = 1; index < segment.length; index += 1) {
    assert(
      Math.abs(segment[index].lon - segment[index - 1].lon) <= 180,
      "Dateline-safe segments must not draw across the entire world"
    );
  }
  for (const point of segment) {
    const projected = projectLoadRoutePoint(point);
    assert(projected.x >= 0 && projected.x <= 1000, "Projected x should stay inside the world map");
    assert(projected.y >= 0 && projected.y <= 500, "Projected y should stay inside the world map");
  }
}

const longBeachPlan = buildLoadRoutePlan({
  origin: "Shanghai",
  destination: "Long Beach",
  mode: "SEA-FCL",
});
assert(longBeachPlan.canRender, "Shanghai to Long Beach should produce a route plan");
assert(
  longBeachPlan.stops.map((stop) => stop.point.label).join("|") === "Shanghai|Long Beach",
  "Bare Long Beach should remain a city-area endpoint, not become POLB"
);
assert(
  longBeachPlan.unresolvedLabels.includes("Exact destination port"),
  "Bare Long Beach should leave the exact destination port unresolved"
);
assert(
  !longBeachPlan.stops.some((stop) => stop.point.label === "Port of Long Beach"),
  "Bare Long Beach must not display Port of Long Beach as fact"
);

const explicitPortPlan = buildLoadRoutePlan({
  origin: "Yangshan Deep-Water Port",
  destination: "Port of Los Angeles",
  mode: "SEA-FCL",
});
assert(explicitPortPlan.canRender, "Explicit transpacific ports should produce a route");
assert(
  explicitPortPlan.stops.map((stop) => stop.point.label).join("|")
    === "Yangshan Deep-Water Port|Port of Los Angeles",
  "Explicit ports should remain operational endpoints"
);
assert(
  explicitPortPlan.routeNotice === null && explicitPortPlan.unresolvedLabels.length === 0,
  "Explicit ports should not show an unresolved-port warning"
);

const unresolvedPlan = buildLoadRoutePlan({
  origin: "Unknown factory",
  destination: "United States",
  mode: "SEA-FCL",
});
assert(!unresolvedPlan.canRender, "Unknown endpoints should not produce a misleading map");
assert(unresolvedPlan.legs.length === 0, "Unknown endpoints should not produce route legs");

const missingModePlan = buildLoadRoutePlan({
  origin: "Shanghai, China",
  destination: "Irvine, CA",
  mode: null,
});
assert(!missingModePlan.canRender, "A missing mode should not produce a misleading route leg");
assert(
  missingModePlan.unresolvedLabels.join(",") === "Transport mode",
  "A missing transport mode should be named as unresolved"
);

const dashboardSource = readFileSync("src/app/dashboard/page.tsx", "utf8");
const componentSource = readFileSync("src/components/load-route-map.tsx", "utf8");
assert(
  !dashboardSource.includes("tile.openstreetmap.org"),
  "The dashboard should not fetch OpenStreetMap tiles directly"
);
assert(
  !componentSource.includes("tile.openstreetmap.org"),
  "The load route map should remain offline"
);
assert(
  componentSource.includes("WorldMapBase"),
  "The load route map should use the checked-in Natural Earth world map"
);
assert(
  componentSource.includes("Planned route, not live tracking"),
  "The route map should clearly distinguish a plan from live tracking"
);
assert(
  componentSource.includes("plan.routeNotice"),
  "The route map should visibly render port-resolution notices"
);

console.log(JSON.stringify({
  ok: true,
  route: irvinePlan.stops.map((stop) => stop.point.label),
  datelineSegments: oceanLeg.pathSegments.length,
}, null, 2));
