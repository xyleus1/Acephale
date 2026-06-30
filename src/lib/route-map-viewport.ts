import type { CSSProperties } from "react";

export type RouteMapPoint = {
  label: string;
  country: string;
  countryCode: string | null;
  lon: number;
  lat: number;
};

export type RouteTile = {
  key: string;
  src: string;
  style: CSSProperties;
};

export type RouteProjectedPoint = RouteMapPoint & {
  x: number;
  y: number;
  markerStyle: CSSProperties;
};

export type RouteMapViewport = {
  key: string;
  zoom: number;
  tiles: RouteTile[];
  points: RouteProjectedPoint[];
  path: string;
};

export type RouteZoomPanel = {
  key: string;
  eyebrow: string;
  title: string;
  viewport: RouteMapViewport;
};

type WorldPoint = {
  point: RouteMapPoint;
  x: number;
  y: number;
};

type RouteViewportFrame = {
  zoom: number;
  left: number;
  top: number;
  width: number;
  height: number;
  tileCount: number;
  worldPoints: WorldPoint[];
};

const OSM_TILE_SIZE = 256;

function mercatorTileY(lat: number) {
  const latRad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
}

function worldPixel(point: RouteMapPoint, zoom: number) {
  const worldSize = OSM_TILE_SIZE * (2 ** zoom);
  return {
    x: ((point.lon + 180) / 360) * worldSize,
    y: mercatorTileY(Math.max(-85.0511, Math.min(85.0511, point.lat))) * worldSize,
  };
}

function routeWorldPoints(points: RouteMapPoint[], zoom: number): WorldPoint[] {
  const worldSize = OSM_TILE_SIZE * (2 ** zoom);
  return points.reduce<WorldPoint[]>((acc, point) => {
    const raw = worldPixel(point, zoom);
    if (acc.length === 0) {
      acc.push({ point, x: raw.x, y: raw.y });
      return acc;
    }

    const previous = acc[acc.length - 1];
    let x = raw.x;
    while (x - previous.x > worldSize / 2) x -= worldSize;
    while (previous.x - x > worldSize / 2) x += worldSize;
    acc.push({ point, x, y: raw.y });
    return acc;
  }, []);
}

function routePathFromProjectedPoints(points: RouteProjectedPoint[]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

function osmTileUrl(zoom: number, x: number, y: number) {
  const n = 2 ** zoom;
  const wrappedX = ((x % n) + n) % n;
  const clampedY = Math.max(0, Math.min(n - 1, y));
  return `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${clampedY}.png`;
}

function buildRouteFrame(points: RouteMapPoint[], zoom: number, aspectRatio: number, paddingRatio: number): RouteViewportFrame {
  const worldPoints = routeWorldPoints(points, zoom);
  const worldSize = OSM_TILE_SIZE * (2 ** zoom);
  const xs = worldPoints.map((point) => point.x);
  const ys = worldPoints.map((point) => point.y);
  let left = Math.min(...xs);
  let right = Math.max(...xs);
  let top = Math.min(...ys);
  let bottom = Math.max(...ys);
  const routeWidth = Math.max(1, right - left);
  const routeHeight = Math.max(1, bottom - top);

  left -= Math.max(80, routeWidth * paddingRatio);
  right += Math.max(80, routeWidth * paddingRatio);
  top -= Math.max(48, routeHeight * paddingRatio);
  bottom += Math.max(48, routeHeight * paddingRatio);

  let width = Math.max(220, right - left);
  let height = Math.max(140, bottom - top);
  const currentAspect = width / height;

  if (currentAspect < aspectRatio) {
    const targetWidth = height * aspectRatio;
    left -= (targetWidth - width) / 2;
    width = targetWidth;
  } else {
    const targetHeight = width / aspectRatio;
    top -= (targetHeight - height) / 2;
    height = targetHeight;
  }

  if (height > worldSize) {
    top = 0;
    height = worldSize;
  } else {
    top = Math.max(0, Math.min(worldSize - height, top));
  }

  const minTileX = Math.floor(left / OSM_TILE_SIZE);
  const maxTileX = Math.floor((left + width) / OSM_TILE_SIZE);
  const minTileY = Math.max(0, Math.floor(top / OSM_TILE_SIZE));
  const maxTileY = Math.min((2 ** zoom) - 1, Math.floor((top + height) / OSM_TILE_SIZE));

  return {
    zoom,
    left,
    top,
    width,
    height,
    tileCount: (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1),
    worldPoints,
  };
}

function chooseRouteFrame(points: RouteMapPoint[], minZoom: number, maxZoom: number, maxTiles: number, aspectRatio: number, paddingRatio: number) {
  let fallback = buildRouteFrame(points, minZoom, aspectRatio, paddingRatio);

  for (let zoom = maxZoom; zoom >= minZoom; zoom -= 1) {
    const candidate = buildRouteFrame(points, zoom, aspectRatio, paddingRatio);
    fallback = candidate;
    if (candidate.tileCount <= maxTiles) return candidate;
  }

  return fallback;
}

export function buildRouteViewport(key: string, points: RouteMapPoint[], options: { minZoom: number; maxZoom: number; maxTiles: number; aspectRatio: number; paddingRatio: number; }): RouteMapViewport {
  const frame = chooseRouteFrame(points, options.minZoom, options.maxZoom, options.maxTiles, options.aspectRatio, options.paddingRatio);
  const tileN = 2 ** frame.zoom;
  const minTileX = Math.floor(frame.left / OSM_TILE_SIZE);
  const maxTileX = Math.floor((frame.left + frame.width) / OSM_TILE_SIZE);
  const minTileY = Math.max(0, Math.floor(frame.top / OSM_TILE_SIZE));
  const maxTileY = Math.min(tileN - 1, Math.floor((frame.top + frame.height) / OSM_TILE_SIZE));
  const tiles: RouteTile[] = [];

  for (let y = minTileY; y <= maxTileY; y += 1) {
    for (let x = minTileX; x <= maxTileX; x += 1) {
      tiles.push({
        key: `${frame.zoom}-${x}-${y}`,
        src: osmTileUrl(frame.zoom, x, y),
        style: {
          left: `${(((x * OSM_TILE_SIZE) - frame.left) / frame.width) * 100}%`,
          top: `${(((y * OSM_TILE_SIZE) - frame.top) / frame.height) * 100}%`,
          width: `${(OSM_TILE_SIZE / frame.width) * 100}%`,
          height: `${(OSM_TILE_SIZE / frame.height) * 100}%`,
        },
      });
    }
  }

  const projectedPoints = frame.worldPoints.map<RouteProjectedPoint>(({ point, x, y }) => {
    const percentX = ((x - frame.left) / frame.width) * 100;
    const percentY = ((y - frame.top) / frame.height) * 100;
    return {
      ...point,
      x: percentX,
      y: percentY,
      markerStyle: {
        left: `${percentX}%`,
        top: `${percentY}%`,
      },
    };
  });

  return {
    key,
    zoom: frame.zoom,
    tiles,
    points: projectedPoints,
    path: routePathFromProjectedPoints(projectedPoints),
  };
}

export function routeZoomPanels(points: RouteMapPoint[]): RouteZoomPanel[] {
  if (points.length < 3) return [];

  const middleIndex = Math.max(1, Math.floor(points.length / 2));
  const panelPointSets = [
    { key: "origin", eyebrow: "Origin leg", title: points[0].label, points: points.slice(0, Math.min(3, points.length)) },
    { key: "corridor", eyebrow: "Route corridor", title: points[middleIndex].label, points: points.slice(Math.max(0, middleIndex - 1), Math.min(points.length, middleIndex + 2)) },
    { key: "destination", eyebrow: "Destination leg", title: points[points.length - 1].label, points: points.slice(Math.max(0, points.length - 3)) },
  ];

  return panelPointSets.map((panel) => ({
    key: panel.key,
    eyebrow: panel.eyebrow,
    title: panel.title,
    viewport: buildRouteViewport(`zoom-${panel.key}`, panel.points, {
      minZoom: 3,
      maxZoom: 6,
      maxTiles: 12,
      aspectRatio: 2.55,
      paddingRatio: 0.42,
    }),
  }));
}
