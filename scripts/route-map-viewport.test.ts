import { buildRouteViewport, routeZoomPanels, type RouteMapPoint, type RouteMapViewport } from "../src/lib/route-map-viewport";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const STATIC_WORLD_TILE_SET = new Set([
  "https://tile.openstreetmap.org/2/0/1.png",
  "https://tile.openstreetmap.org/2/1/1.png",
  "https://tile.openstreetmap.org/2/2/1.png",
  "https://tile.openstreetmap.org/2/3/1.png",
  "https://tile.openstreetmap.org/2/0/2.png",
  "https://tile.openstreetmap.org/2/1/2.png",
  "https://tile.openstreetmap.org/2/2/2.png",
  "https://tile.openstreetmap.org/2/3/2.png",
]);

function point(label: string, country: string, countryCode: string, lon: number, lat: number): RouteMapPoint {
  return { label, country, countryCode, lon, lat };
}

function assertViewport(viewport: RouteMapViewport, expectedPointCount: number) {
  assert(viewport.tiles.length > 0, `${viewport.key}: expected map tiles`);
  assert(viewport.points.length === expectedPointCount, `${viewport.key}: expected projected points`);
  assert((viewport.path.match(/L/g) ?? []).length === expectedPointCount - 1, `${viewport.key}: expected route line segments`);

  for (const projected of viewport.points) {
    assert(projected.x >= 0 && projected.x <= 100, `${viewport.key}: ${projected.label} x ${projected.x} outside viewport`);
    assert(projected.y >= 0 && projected.y <= 100, `${viewport.key}: ${projected.label} y ${projected.y} outside viewport`);
    assert(projected.markerStyle.left === `${projected.x}%`, `${viewport.key}: marker left should use projected x`);
    assert(projected.markerStyle.top === `${projected.y}%`, `${viewport.key}: marker top should use projected y`);
  }
}

function assertRoute(route: RouteMapPoint[], label: string) {
  const overview = buildRouteViewport(`${label}-overview`, route, {
    minZoom: 2,
    maxZoom: 5,
    maxTiles: 18,
    aspectRatio: 2.88,
    paddingRatio: 0.18,
  });
  assertViewport(overview, route.length);
  assert(!overview.tiles.every((tile) => STATIC_WORLD_TILE_SET.has(tile.src)), `${label}: overview fell back to the old static world tile grid`);
  assert(overview.tiles.some((tile) => /left:|-/.test(JSON.stringify(tile.style))), `${label}: expected positioned tiles, not grid slots`);

  const zoomPanels = routeZoomPanels(route);
  assert(zoomPanels.length === 3, `${label}: expected origin/corridor/destination zoom panels`);
  for (const panel of zoomPanels) {
    assertViewport(panel.viewport, panel.viewport.points.length);
    assert(panel.viewport.points.length >= 2, `${label}: ${panel.key} panel should include a route segment, not unrelated map tiles`);
    assert(panel.viewport.path.includes("L"), `${label}: ${panel.key} panel should draw a route overlay`);
  }
}

const portKlangToIstanbul = [
  point("Port Klang, MY", "Malaysia", "MY", 101.397, 2.999),
  point("Singapore / Malacca", "Singapore", "SG", 103.852, 1.29),
  point("Colombo sea lane", "Sri Lanka", "LK", 79.861, 6.927),
  point("Suez Canal", "Egypt", "EG", 32.55, 29.97),
  point("Istanbul, TR", "Turkey", "TR", 28.978, 41.008),
];

const shanghaiToMersin = [
  point("Shanghai, CN", "China", "CN", 121.474, 31.23),
  point("Hong Kong approach", "China", "CN", 114.109, 22.396),
  point("Singapore / Malacca", "Singapore", "SG", 103.852, 1.29),
  point("Colombo sea lane", "Sri Lanka", "LK", 79.861, 6.927),
  point("Suez Canal", "Egypt", "EG", 32.55, 29.97),
  point("Mersin, TR", "Turkey", "TR", 34.641, 36.812),
];

assertRoute(portKlangToIstanbul, "Port Klang to Istanbul");
assertRoute(shanghaiToMersin, "Shanghai to Mersin");

console.log(JSON.stringify({
  ok: true,
  routes: [
    { label: "Port Klang to Istanbul", points: portKlangToIstanbul.length },
    { label: "Shanghai to Mersin", points: shanghaiToMersin.length },
  ],
}, null, 2));
