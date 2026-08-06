import { buildRouteViewport } from "../src/lib/route-map-viewport";
import { routeLegPoints, routeMapPoint } from "../src/lib/workbench-route-map";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertKnownPoint(label: string, actual: number, expected: number) {
  assert(Math.abs(actual - expected) < 0.02, `${label}: expected ${expected}, got ${actual}`);
}

function requiredPoint(
  value: string,
  role: "origin" | "destination"
) {
  const point = routeMapPoint(value, role);
  assert(point, `${value} should resolve to a known route point`);
  return point;
}

const giresun = requiredPoint("Giresun, Turkey", "origin");
const ancona = requiredPoint("Ancona, Italy", "destination");

assert(giresun.countryCode === "TR", "Giresun should resolve to Turkey");
assert(ancona.countryCode === "IT", "Ancona should resolve to Italy");
assertKnownPoint("Giresun longitude", giresun.lon, 38.3895);
assertKnownPoint("Giresun latitude", giresun.lat, 40.9128);
assertKnownPoint("Ancona longitude", ancona.lon, 13.5189);
assertKnownPoint("Ancona latitude", ancona.lat, 43.6158);

const giresunRoute = routeLegPoints(giresun, ancona, "SEA-FCL");
const giresunRouteLabels = giresunRoute.map((point) => point.label);
assert(giresunRoute.length === 5, "Giresun to Ancona SEA-FCL should use Black Sea to Adriatic waypoints");
assert(giresunRouteLabels.includes("Bosphorus"), "Giresun route should include Bosphorus");
assert(giresunRouteLabels.includes("Dardanelles"), "Giresun route should include Dardanelles");
assert(giresunRouteLabels.includes("Adriatic approach"), "Giresun route should include Adriatic approach");

const overview = buildRouteViewport("giresun-ancona", giresunRoute, {
  minZoom: 2,
  maxZoom: 5,
  maxTiles: 18,
  aspectRatio: 2.88,
  paddingRatio: 0.18,
});

assert(overview.tiles.length > 0, "Giresun route should render map tiles");
assert((overview.path.match(/L/g) ?? []).length === giresunRoute.length - 1, "Giresun route should render all path segments");
for (const point of overview.points) {
  assert(point.x >= 0 && point.x <= 100, `${point.label}: x ${point.x} outside viewport`);
  assert(point.y >= 0 && point.y <= 100, `${point.label}: y ${point.y} outside viewport`);
}

const turkeyFallback = routeMapPoint("Turkey", "origin");
assert(turkeyFallback === null, "Country-only Turkey should stay unresolved instead of silently becoming Istanbul");
assert(routeMapPoint("United States", "destination") === null, "Country-only United States should stay unresolved instead of silently becoming Houston");
assert(routeMapPoint("Unknown factory", "origin") === null, "Unknown locations should stay unresolved");

const shenzhen = requiredPoint("Shenzhen, China", "origin");
const berlin = requiredPoint("Berlin, Germany", "destination");
const shenzhenRoute = routeLegPoints(shenzhen, berlin, "SEA-LCL");
assert(shenzhen.countryCode === "CN", "Shenzhen should resolve to China");
assert(berlin.countryCode === "DE", "Berlin should resolve to Germany");
assert(shenzhenRoute.length >= 5, "Shenzhen to Berlin sea route should include corridor waypoints");
assert(shenzhenRoute.some((point) => point.label === "Suez Canal"), "Asia to Europe sea route should include Suez");

const yangshan = requiredPoint("Yangshan, China", "origin");
const portOfLosAngeles = requiredPoint("Port of Los Angeles", "destination");
const portOfLongBeach = requiredPoint("Port of Long Beach", "destination");
const irvine = requiredPoint("Irvine, CA", "destination");
assert(yangshan.countryCode === "CN", "Yangshan should resolve to China");
assert(portOfLosAngeles.countryCode === "US", "Port of Los Angeles should resolve to the United States");
assert(portOfLongBeach.countryCode === "US", "Port of Long Beach should resolve to the United States");
assert(irvine.countryCode === "US", "Irvine should resolve to the United States");

console.log(JSON.stringify({
  ok: true,
  routes: [
    { label: "Giresun to Ancona", points: giresunRouteLabels },
    { label: "Shenzhen to Berlin", points: shenzhenRoute.map((point) => point.label) },
  ],
}, null, 2));
