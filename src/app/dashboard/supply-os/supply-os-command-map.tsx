"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import {
  Layer,
  Map,
  Marker,
  Popup,
  Source,
  type MapRef,
} from "@vis.gl/react-maplibre";
import type { StyleSpecification } from "maplibre-gl";
import {
  AlertTriangle,
  Factory,
  LocateFixed,
  MapPin,
  PackageSearch,
  Plane,
  ShieldAlert,
  Ship,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SupplyCommandMap,
  SupplyCommandInsight,
  SupplyCommandObject,
  SupplyCommandObjectKind,
  SupplyCommandRouteSegment,
} from "@/lib/supply-os-command-map";
import type { SupplyOsPanel } from "@/lib/supply-os/panel-routing";
import styles from "./supply-os-logistics.module.css";

const CARTO_POSITRON_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const CARTO_RASTER_STYLE: StyleSpecification = {
  version: 8,
  name: "carto-raster",
  sources: {
    "carto-raster": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 512,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    },
  },
  layers: [
    {
      id: "carto-background",
      type: "background",
      paint: { "background-color": "#f2f4f5" },
    },
    {
      id: "carto-raster",
      type: "raster",
      source: "carto-raster",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

const BASEMAPS = [
  { id: "carto-raster", label: "CARTO raster", style: CARTO_RASTER_STYLE },
  { id: "carto-positron", label: "CARTO Positron", style: CARTO_POSITRON_STYLE },
  { id: "openfreemap-positron", label: "OpenFreeMap Positron", style: OPEN_FREE_MAP_STYLE },
] as const;

const ROUTE_HIT_LAYER_ID = "supply-route-hit";

type RoutePath = {
  route: SupplyCommandMap["routes"][number];
  segment: SupplyCommandRouteSegment;
  coordinates: Array<[number, number]>;
  directionPoints: Array<{ longitude: number; latitude: number; angle: number }>;
};

function quadraticPoint(
  from: [number, number],
  control: [number, number],
  to: [number, number],
  t: number,
): [number, number] {
  const remaining = 1 - t;
  return [
    remaining * remaining * from[0] + 2 * remaining * t * control[0] + t * t * to[0],
    remaining * remaining * from[1] + 2 * remaining * t * control[1] + t * t * to[1],
  ];
}

function buildRoutePath(
  route: SupplyCommandMap["routes"][number],
  segment: SupplyCommandRouteSegment,
  index: number,
): RoutePath {
  const from: [number, number] = [segment.from.longitude, segment.from.latitude];
  const to: [number, number] = [segment.to.longitude, segment.to.latitude];
  const deltaLongitude = to[0] - from[0];
  const deltaLatitude = to[1] - from[1];
  const span = Math.max(0.01, Math.hypot(deltaLongitude, deltaLatitude));
  const bend = span < 1 ? span * 0.22 : Math.min(10, Math.max(0.35, span * 0.085));
  const northward = deltaLongitude >= 0 ? 1 : -1;
  const routeSeparation = index % 2 === 0 ? 1 : 0.82;
  const control: [number, number] = [
    (from[0] + to[0]) / 2 - (deltaLatitude / span) * bend * northward * routeSeparation,
    (from[1] + to[1]) / 2 + (deltaLongitude / span) * bend * northward * routeSeparation,
  ];
  const coordinates = Array.from({ length: 33 }, (_, pointIndex) => (
    quadraticPoint(from, control, to, pointIndex / 32)
  ));
  const directionPoints = (segment.mode === "customs" ? [0.5] : [0.34, 0.66]).map((t) => {
    const point = quadraticPoint(from, control, to, t);
    const next = quadraticPoint(from, control, to, Math.min(1, t + 0.015));
    return {
      longitude: point[0],
      latitude: point[1],
      angle: segment.mode === "customs" ? 0 : Math.atan2(-(next[1] - point[1]), next[0] - point[0]) * 180 / Math.PI,
    };
  });
  return { route, segment, coordinates, directionPoints };
}

function segmentIcon(segment: SupplyCommandRouteSegment): LucideIcon {
  if (segment.mode === "ocean") return Ship;
  if (segment.mode === "air") return Plane;
  if (segment.mode === "customs") return ShieldAlert;
  return Truck;
}

function objectIcon(object: SupplyCommandObject): LucideIcon {
  if (object.kind === "supplier") return PackageSearch;
  if (object.kind === "factory") return Factory;
  if (object.kind === "distribution") return Warehouse;
  if (object.kind === "customer") return MapPin;
  if (object.kind === "customs") return ShieldAlert;
  const mode = object.location.toLowerCase();
  if (mode.includes("ocean")) return Ship;
  if (mode.includes("air") && !mode.includes("road")) return Plane;
  return Truck;
}

function objectKindLabel(kind: SupplyCommandObjectKind) {
  if (kind === "supplier") return "Supplier";
  if (kind === "factory") return "Factory";
  if (kind === "distribution") return "Distribution";
  if (kind === "customer") return "Customer";
  if (kind === "customs") return "Customs";
  return "Movement";
}

function markerOffset(kind: SupplyCommandObjectKind): [number, number] | undefined {
  if (kind === "customs") return [16, -16];
  if (kind === "movement") return [-8, 8];
  return undefined;
}

function HoverObjectCard({ object }: { object: SupplyCommandObject }) {
  const Icon = objectIcon(object);
  return (
    <div className={styles.mapHoverCard}>
      <header>
        <span className={styles.hoverObjectIcon} data-kind={object.kind}><Icon size={14} strokeWidth={1.8} /></span>
        <span>
          <small>{objectKindLabel(object.kind)}</small>
          <strong>{object.label}</strong>
        </span>
        <i data-status={object.status}>{object.statusLabel}</i>
      </header>
      <p>{object.location}</p>
      {object.priority ? (
        <div className={styles.hoverPriority}>
          <span>P{String(object.priority.priority).padStart(2, "0")}</span>
          <strong>{object.priority.title}</strong>
        </div>
      ) : null}
      {object.rateEstimate ? (
        <div className={styles.hoverRate}>
          <span>{object.rateEstimate.distanceMiles.toLocaleString()} road mi</span>
          <strong>${object.rateEstimate.low.toLocaleString()} to ${object.rateEstimate.high.toLocaleString()}</strong>
          <small>Modeled range, live quote required</small>
        </div>
      ) : null}
      {object.contacts.length ? (
        <div className={styles.hoverContacts}>
          <span>{object.kind === "supplier" ? "Candidates" : "Local contacts"}</span>
          {object.contacts.slice(0, 2).map((contact) => (
            <div key={contact.id}><strong>{contact.name}</strong><small>{contact.role}</small></div>
          ))}
        </div>
      ) : null}
      <footer>{object.kind === "movement" ? "Click the lane for carrier and cost comparison" : "Click for full operating detail"}</footer>
    </div>
  );
}

function InsightCard({ insight }: { insight: SupplyCommandInsight }) {
  return (
    <div className={styles.mapInsightCard} data-severity={insight.severity}>
      <header>
        <AlertTriangle size={14} strokeWidth={1.9} />
        <span><small>Sourced lane signal</small><strong>{insight.title}</strong></span>
      </header>
      <p>{insight.detail}</p>
      <div><strong>Operating implication</strong><span>{insight.implication}</span></div>
      <footer>
        <a href={insight.sourceUrls[0]} target="_blank" rel="noreferrer">{insight.sourceLabel}</a>
        <time dateTime={insight.researchedAt}>Checked {new Date(insight.researchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time>
      </footer>
    </div>
  );
}

export function SupplyOsCommandMap({
  commandMap,
  selectedObject,
  onSelectObject,
  activePanel,
}: {
  commandMap: SupplyCommandMap;
  selectedObject: SupplyCommandObject | null;
  onSelectObject: (object: SupplyCommandObject) => void;
  activePanel: SupplyOsPanel;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const fallbackPendingRef = useRef(false);
  const basemapReadyRef = useRef(false);
  const previousSelectedObjectIdRef = useRef(selectedObject?.id);
  const previousActivePanelRef = useRef(activePanel);
  const [hoveredObject, setHoveredObject] = useState<SupplyCommandObject | null>(null);
  const [hoveredInsight, setHoveredInsight] = useState<SupplyCommandInsight | null>(null);
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);
  const [mapRevision, setMapRevision] = useState(0);
  const [basemapIndex, setBasemapIndex] = useState(0);
  const [basemapState, setBasemapState] = useState<"loading" | "ready" | "retrying" | "failed">("loading");
  const [mapCapability, setMapCapability] = useState<"checking" | "ready" | "unavailable">("checking");
  const basemap = BASEMAPS[basemapIndex] ?? BASEMAPS[0];
  const visibleObjectKinds = useMemo<SupplyCommandObjectKind[]>(() => {
    if (activePanel === "materials") return ["supplier", "factory", "distribution"];
    if (activePanel === "suppliers") return ["supplier", "factory"];
    if (activePanel === "logistics") return ["movement", "customs", "factory", "distribution", "customer"];
    if (activePanel === "tracking") return ["movement", "customs", "factory", "customer"];
    return ["supplier", "factory", "distribution", "customer", "customs", "movement"];
  }, [activePanel]);
  const visibleMapObjects = useMemo(
    () => commandMap.objects.filter((object) => visibleObjectKinds.includes(object.kind)),
    [commandMap.objects, visibleObjectKinds],
  );
  const supplierFocusObjects = useMemo(
    () => commandMap.objects
      .filter((object) => object.kind === "supplier")
      .sort((left, right) => (left.priority?.priority ?? 99) - (right.priority?.priority ?? 99))
      .slice(0, 4),
    [commandMap.objects],
  );
  const supplierFocusRanks = useMemo(
    () => new globalThis.Map(supplierFocusObjects.map((object, index) => [object.id, index + 1])),
    [supplierFocusObjects],
  );
  const routePaths = useMemo(
    () => commandMap.routes
      .flatMap((route) => route.segments.map((segment) => ({ route, segment })))
      .map(({ route, segment }, index) => buildRoutePath(route, segment, index)),
    [commandMap.routes],
  );
  const routeFeatures = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: routePaths.map(({ route, segment, coordinates }) => ({
      type: "Feature" as const,
      properties: {
        routeId: route.id,
        segmentId: segment.id,
        mode: segment.mode,
        edgeId: route.edgeId,
        active: route.edgeId === selectedObject?.edgeId ? 1 : 0,
        hovered: segment.id === hoveredRouteId ? 1 : 0,
      },
      geometry: { type: "LineString" as const, coordinates },
    })),
  }), [hoveredRouteId, routePaths, selectedObject?.edgeId]);
  const projectedRoutePaths = useMemo(() => {
    const map = mapRef.current?.getMap();
    if (!map) return [];
    return routePaths.map(({ route, segment, coordinates }) => {
      const points = coordinates.map(([longitude, latitude]) => map.project([longitude, latitude]));
      return {
        route,
        segment,
        points,
        path: points.map((point, index) => {
          return `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        }).join(" "),
      };
    });
  }, [basemapState, mapRevision, routePaths]);
  const hoveredRouteObject = hoveredRouteId
    ? commandMap.objects.find((object) => object.kind === "movement"
      && commandMap.routes.some((route) => route.edgeId === object.edgeId && route.segments.some((segment) => segment.id === hoveredRouteId))) ?? null
    : null;
  const popupCandidate = hoveredObject ?? hoveredRouteObject;
  const popupObject = hoveredInsight || popupCandidate?.id === selectedObject?.id ? null : popupCandidate;

  const selectRoute = useCallback((routeId: string) => {
    const route = commandMap.routes.find((candidate) => candidate.id === routeId || candidate.segments.some((segment) => segment.id === routeId));
    const object = route
      ? commandMap.objects.find((candidate) => candidate.kind === "movement" && candidate.edgeId === route.edgeId)
      : null;
    if (object) onSelectObject(object);
  }, [commandMap.objects, commandMap.routes, onSelectObject]);

  const fitCoordinates = useCallback((
    coordinates: Array<{ longitude: number; latitude: number }>,
    animate = true,
    singleZoom = 7.6,
    maxZoom = 7.2,
  ) => {
    if (!coordinates.length || !mapRef.current) return;
    const west = Math.min(...coordinates.map((point) => point.longitude));
    const east = Math.max(...coordinates.map((point) => point.longitude));
    const south = Math.min(...coordinates.map((point) => point.latitude));
    const north = Math.max(...coordinates.map((point) => point.latitude));
    const compact = window.innerWidth < 1180;
    if (west === east && south === north) {
      mapRef.current.easeTo({ center: [west, south], zoom: singleZoom, duration: animate ? 440 : 0 });
      return;
    }
    mapRef.current.fitBounds([[west, south], [east, north]], {
      padding: compact
        ? { top: 60, right: 52, bottom: 60, left: 52 }
        : { top: 68, right: 68, bottom: 68, left: 68 },
      maxZoom,
      duration: animate ? 480 : 0,
    });
  }, []);

  const focusRoute = useCallback((edgeId: string, animate = true) => {
    const coordinates = routePaths
      .filter(({ route }) => route.edgeId === edgeId)
      .flatMap(({ coordinates: path }) => path.map(([longitude, latitude]) => ({ longitude, latitude })));
    fitCoordinates(coordinates, animate, 6.8, 6.8);
  }, [fitCoordinates, routePaths]);

  const focusObject = useCallback((object: SupplyCommandObject, animate = true) => {
    if (object.kind === "movement" && object.edgeId) {
      focusRoute(object.edgeId, animate);
      return;
    }
    const zoom = object.kind === "supplier"
      ? 6.2
      : object.kind === "factory"
        ? 8.8
        : object.kind === "customer"
          ? 8.2
          : 7.8;
    fitCoordinates([object.coordinates], animate, zoom, zoom);
  }, [fitCoordinates, focusRoute]);

  const focusActivePanel = useCallback((animate = true) => {
    if (activePanel === "materials") {
      const object = visibleMapObjects.find((object) => object.kind === "factory")
        ?? visibleMapObjects.find((object) => object.kind === "distribution")
        ?? visibleMapObjects[0];
      if (object) focusObject(object, animate);
      return;
    }
    if (activePanel === "suppliers") {
      const suppliers = supplierFocusObjects.filter((object) => object.kind === "supplier");
      fitCoordinates(suppliers.map((object) => object.coordinates), animate, 6.2, 5.8);
      return;
    }
    if (activePanel === "scenarios") {
      const customers = visibleMapObjects.filter((object) => object.kind === "customer");
      if (customers.length) {
        fitCoordinates(customers.map((object) => object.coordinates), animate, 8.2, 7.4);
        return;
      }
    }
    if (activePanel === "tracking") {
      const movement = visibleMapObjects.find((object) => object.kind === "movement" && object.edgeId);
      if (movement?.edgeId) {
        focusRoute(movement.edgeId, animate);
        return;
      }
    }
    const routeCoordinates = routePaths.flatMap(({ coordinates: path }) => (
      path.map(([longitude, latitude]) => ({ longitude, latitude }))
    ));
    fitCoordinates(routeCoordinates, animate, 5.8, 5.8);
  }, [activePanel, fitCoordinates, focusObject, focusRoute, routePaths, supplierFocusObjects, visibleMapObjects]);

  useEffect(() => {
    if (mapRef.current) focusActivePanel(true);
  }, [activePanel, focusActivePanel]);

  useEffect(() => {
    const previousId = previousSelectedObjectIdRef.current;
    const panelChanged = previousActivePanelRef.current !== activePanel;
    previousSelectedObjectIdRef.current = selectedObject?.id;
    previousActivePanelRef.current = activePanel;
    if (
      !selectedObject
      || previousId === selectedObject.id
      || panelChanged
      || !mapRef.current
    ) return;
    focusObject(selectedObject, true);
  }, [activePanel, focusObject, selectedObject]);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    setMapCapability(context ? "ready" : "unavailable");
  }, []);

  const advanceBasemap = useCallback(() => {
    if (fallbackPendingRef.current || basemapState === "ready") return;
    fallbackPendingRef.current = true;
    if (basemapIndex >= BASEMAPS.length - 1) {
      setBasemapState("failed");
      return;
    }
    setBasemapState("retrying");
    window.setTimeout(() => {
      setBasemapIndex((current) => Math.min(current + 1, BASEMAPS.length - 1));
      setBasemapState("loading");
    }, 120);
  }, [basemapIndex, basemapState]);

  useEffect(() => {
    fallbackPendingRef.current = false;
    basemapReadyRef.current = false;
  }, [basemapIndex]);

  const markBasemapReady = useCallback(() => {
    if (basemapReadyRef.current) return;
    basemapReadyRef.current = true;
    fallbackPendingRef.current = false;
    setBasemapState("ready");
    focusActivePanel(false);
  }, [focusActivePanel]);

  useEffect(() => {
    if (mapCapability !== "ready" || basemapReadyRef.current || basemapState === "failed") return;
    const timeout = window.setTimeout(advanceBasemap, 6500);
    return () => window.clearTimeout(timeout);
  }, [advanceBasemap, basemapIndex, basemapState, mapCapability]);

  if (mapCapability !== "ready") {
    return (
      <div className={styles.commandMap} aria-label="Map renderer status">
        <div className={styles.mapUnavailable} data-state={mapCapability}>
          <MapPin size={19} strokeWidth={1.6} />
          <strong>{mapCapability === "checking" ? "Starting map" : "Map renderer unavailable"}</strong>
          {mapCapability === "checking" ? <span>Checking WebGL 2 support.</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.commandMap} data-domain={activePanel} aria-label={`${activePanel} network map`}>
      <Map
        key={basemap.id}
        ref={mapRef}
        initialViewState={{ longitude: -93, latitude: 40, zoom: 3.1 }}
        mapStyle={basemap.style}
        attributionControl={false}
        cooperativeGestures
        interactiveLayerIds={[ROUTE_HIT_LAYER_ID]}
        onLoad={() => {
          setMapRevision((current) => current + 1);
          markBasemapReady();
        }}
        onMove={() => setMapRevision((current) => current + 1)}
        onResize={() => setMapRevision((current) => current + 1)}
        onMouseMove={(event) => {
          const routeId = event.features?.[0]?.properties?.segmentId;
          setHoveredRouteId(typeof routeId === "string" ? routeId : null);
          const canvas = mapRef.current?.getMap().getCanvas();
          if (canvas) canvas.style.cursor = routeId ? "pointer" : "";
        }}
        onMouseLeave={() => {
          setHoveredRouteId(null);
          const canvas = mapRef.current?.getMap().getCanvas();
          if (canvas) canvas.style.cursor = "";
        }}
        onClick={(event) => {
          const routeId = event.features?.[0]?.properties?.segmentId;
          if (typeof routeId === "string") selectRoute(routeId);
        }}
        onSourceData={(event) => {
          if (
            basemap.id === "carto-raster"
            && event.sourceId === "carto-raster"
            && event.sourceDataType === "content"
          ) {
            markBasemapReady();
          }
        }}
        onError={() => {
          if (!basemapReadyRef.current) setBasemapState("loading");
        }}
      >
        <Source id="supply-routes" type="geojson" data={routeFeatures}>
          <Layer
            id="supply-route-casing"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "#ffffff",
              "line-width": ["case", ["==", ["get", "active"], 1], 11, 8],
              "line-opacity": 0.96,
            }}
          />
          <Layer
            id="supply-route-core"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "#29485c",
              "line-width": [
                "case",
                ["any", ["==", ["get", "active"], 1], ["==", ["get", "hovered"], 1]],
                6,
                4,
              ],
              "line-opacity": ["case", ["==", ["get", "active"], 1], 1, 0.84],
              "line-dasharray": activePanel === "logistics" || activePanel === "tracking" ? [1, 0] : [2, 2],
            }}
          />
          <Layer
            id={ROUTE_HIT_LAYER_ID}
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": "#172027", "line-width": 24, "line-opacity": 0.01 }}
          />
        </Source>

        {routePaths.flatMap(({ route, segment, directionPoints }) => directionPoints.map((point, index) => {
          const DirectionIcon = segmentIcon(segment);
          return (
          <Marker
            key={`direction:${segment.id}:${index}`}
            longitude={point.longitude}
            latitude={point.latitude}
            anchor="center"
          >
            <span
              className={styles.routeDirectionMarker}
              data-mode={segment.mode}
              data-active={route.edgeId === selectedObject?.edgeId}
              data-hovered={segment.id === hoveredRouteId}
              style={{ transform: `rotate(${point.angle}deg)` }}
              aria-hidden="true"
            >
              <DirectionIcon size={12} strokeWidth={2.2} />
            </span>
          </Marker>
          );
        }))}

        {commandMap.routes.flatMap((route) => route.segments.slice(0, -1).map((segment, index) => {
          const gatewayMode = segment.mode === "road" ? route.segments[index + 1]?.mode ?? "road" : segment.mode;
          const GatewayIcon = gatewayMode === "ocean" ? Ship : gatewayMode === "air" ? Plane : gatewayMode === "customs" ? ShieldAlert : Truck;
          return (
            <Marker key={`gateway:${segment.id}`} longitude={segment.to.longitude} latitude={segment.to.latitude} anchor="center">
              <button
                type="button"
                className={styles.routeGatewayMarker}
                data-mode={gatewayMode}
                data-active={route.edgeId === selectedObject?.edgeId}
                aria-label={`${segment.toLabel}. Open ${route.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  selectRoute(segment.id);
                }}
                onMouseEnter={() => setHoveredRouteId(segment.id)}
                onMouseLeave={() => setHoveredRouteId((current) => current === segment.id ? null : current)}
              >
                <GatewayIcon size={14} strokeWidth={1.9} />
                <span>{segment.toLabel}</span>
              </button>
            </Marker>
          );
        }))}

        {visibleMapObjects.map((object) => {
          const Icon = objectIcon(object);
          const supplierFocusRank = supplierFocusRanks.get(object.id);
          const routePath = object.kind === "movement"
            ? routePaths.find(({ route, segment }) => route.edgeId === object.edgeId && (segment.mode === "ocean" || segment.mode === "air"))
              ?? routePaths.find(({ route }) => route.edgeId === object.edgeId)
            : null;
          const routeMidpoint = routePath?.coordinates[Math.floor(routePath.coordinates.length / 2)];
          const coordinates = routeMidpoint
            ? { longitude: routeMidpoint[0], latitude: routeMidpoint[1] }
            : object.coordinates;
          return (
            <Marker
              key={object.id}
              longitude={coordinates.longitude}
              latitude={coordinates.latitude}
              anchor="center"
              offset={markerOffset(object.kind)}
            >
              <button
                type="button"
                className={styles.mapMarker}
                data-kind={object.kind}
                data-status={object.status}
                data-active={object.id === selectedObject?.id}
                data-supplier-focus={supplierFocusRank ? "true" : undefined}
                aria-label={`${objectKindLabel(object.kind)}: ${object.label}. ${object.statusLabel}${supplierFocusRank ? `. Supplier focus ${supplierFocusRank}` : ""}`}
                aria-pressed={object.id === selectedObject?.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectObject(object);
                }}
                onMouseEnter={() => setHoveredObject(object)}
                onMouseLeave={() => setHoveredObject((current) => current?.id === object.id ? null : current)}
                onFocus={() => setHoveredObject(object)}
                onBlur={() => setHoveredObject((current) => current?.id === object.id ? null : current)}
              >
                <Icon size={object.kind === "movement" ? 14 : 16} strokeWidth={1.9} />
                {supplierFocusRank ? <span className={styles.supplierFocusBadge} aria-hidden="true">S{supplierFocusRank}</span> : null}
                {object.kind === "movement" && object.id === selectedObject?.id ? <span className={styles.routeMarkerText}>Lane detail</span> : null}
                {object.priority ? (
                  <span className={styles.mapPriorityBadge}>P{object.priority.priority}</span>
                ) : null}
                <span className={styles.markerStatusDot} />
              </button>
            </Marker>
          );
        })}

        {(activePanel === "logistics" || activePanel === "scenarios" || activePanel === "tracking" ? commandMap.insights : []).map((insight) => (
          <Marker
            key={insight.id}
            longitude={insight.coordinates.longitude}
            latitude={insight.coordinates.latitude}
            anchor="center"
          >
            <button
              type="button"
              className={styles.mapInsightMarker}
              data-severity={insight.severity}
              aria-label={`Sourced lane signal: ${insight.title}`}
              onMouseEnter={() => setHoveredInsight(insight)}
              onMouseLeave={() => setHoveredInsight((current) => current?.id === insight.id ? null : current)}
              onFocus={() => setHoveredInsight(insight)}
              onBlur={() => setHoveredInsight((current) => current?.id === insight.id ? null : current)}
              onClick={() => window.open(insight.sourceUrls[0], "_blank", "noopener,noreferrer")}
            >
              <AlertTriangle size={13} strokeWidth={2.1} />
            </button>
          </Marker>
        ))}

        {popupObject ? (
          <Popup
            longitude={popupObject.coordinates.longitude}
            latitude={popupObject.coordinates.latitude}
            anchor="bottom"
            offset={26}
            closeButton={false}
            closeOnClick={false}
            className={styles.commandMapPopup}
          >
            <HoverObjectCard object={popupObject} />
          </Popup>
        ) : null}

        {hoveredInsight ? (
          <Popup
            longitude={hoveredInsight.coordinates.longitude}
            latitude={hoveredInsight.coordinates.latitude}
            anchor="bottom"
            offset={20}
            closeButton={false}
            closeOnClick={false}
            className={styles.commandMapPopup}
          >
            <InsightCard insight={hoveredInsight} />
          </Popup>
        ) : null}

      </Map>

      <svg className={styles.routeOverlay} aria-hidden="true">
        {projectedRoutePaths.map(({ route, segment, path }) => (
          <g
            key={segment.id}
            className={styles.routeGeometry}
            data-mode={segment.mode}
            data-active={route.edgeId === selectedObject?.edgeId}
            data-hovered={segment.id === hoveredRouteId}
          >
            <path className={styles.routeGeometryCasing} d={path} />
            <path className={styles.routeGeometryLine} d={path} />
            <path className={styles.routeGeometryFlow} d={path} />
          </g>
        ))}
      </svg>

      <Tooltip.Provider delayDuration={250}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              className={styles.fitMapButton}
              aria-label={`Refocus ${activePanel} on map`}
              onClick={() => focusActivePanel()}
            >
              <LocateFixed size={16} strokeWidth={1.8} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className={styles.mapTooltip} side="left" sideOffset={8}>
              Refocus {activePanel}
              <Tooltip.Arrow className={styles.mapTooltipArrow} />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>

      {basemapState !== "ready" ? (
        <div className={styles.mapError} data-state={basemapState} aria-live="polite">
          {basemapState === "failed"
            ? "Basemap unavailable. Network objects remain available in the route list."
            : `${basemapState === "retrying" ? "Switching to" : "Loading"} ${basemap.label}`}
        </div>
      ) : null}
    </div>
  );
}
