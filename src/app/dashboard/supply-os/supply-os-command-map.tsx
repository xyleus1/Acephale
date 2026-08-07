"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import {
  AttributionControl,
  Layer,
  Map,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  Source,
  type MapRef,
} from "@vis.gl/react-maplibre";
import type { FeatureCollection, LineString } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import {
  Boxes,
  Factory,
  LocateFixed,
  MapPin,
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
  SupplyCommandObject,
  SupplyCommandObjectKind,
} from "@/lib/supply-os-command-map";
import styles from "./supply-os-workspace.module.css";

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

function objectIcon(object: SupplyCommandObject): LucideIcon {
  if (object.kind === "supplier") return Boxes;
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

function routeFeatureCollection(
  commandMap: SupplyCommandMap,
  selectedObject: SupplyCommandObject | null,
): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: commandMap.routes.map((route) => ({
      type: "Feature",
      id: route.id,
      properties: {
        stage: route.stage,
        basis: route.basis,
        selected: route.edgeId === selectedObject?.edgeId,
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [route.from.longitude, route.from.latitude],
          [route.to.longitude, route.to.latitude],
        ],
      },
    })),
  };
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
      {object.contacts.length ? (
        <div className={styles.hoverContacts}>
          <span>{object.kind === "supplier" ? "Candidates" : "Local contacts"}</span>
          {object.contacts.slice(0, 2).map((contact) => (
            <div key={contact.id}><strong>{contact.name}</strong><small>{contact.role}</small></div>
          ))}
        </div>
      ) : null}
      <footer>Click for full operating detail</footer>
    </div>
  );
}

export function SupplyOsCommandMap({
  commandMap,
  selectedObject,
  onSelectObject,
}: {
  commandMap: SupplyCommandMap;
  selectedObject: SupplyCommandObject | null;
  onSelectObject: (object: SupplyCommandObject) => void;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const fallbackPendingRef = useRef(false);
  const basemapReadyRef = useRef(false);
  const [hoveredObject, setHoveredObject] = useState<SupplyCommandObject | null>(null);
  const [basemapIndex, setBasemapIndex] = useState(0);
  const [basemapState, setBasemapState] = useState<"loading" | "ready" | "retrying" | "failed">("loading");
  const [mapCapability, setMapCapability] = useState<"checking" | "ready" | "unavailable">("checking");
  const basemap = BASEMAPS[basemapIndex] ?? BASEMAPS[0];
  const routes = useMemo(
    () => routeFeatureCollection(commandMap, selectedObject),
    [commandMap, selectedObject],
  );

  const fitNetwork = useCallback((animate = true) => {
    const coordinates = commandMap.objects.map((object) => object.coordinates);
    if (!coordinates.length || !mapRef.current) return;
    const west = Math.min(...coordinates.map((point) => point.longitude));
    const east = Math.max(...coordinates.map((point) => point.longitude));
    const south = Math.min(...coordinates.map((point) => point.latitude));
    const north = Math.max(...coordinates.map((point) => point.latitude));
    const compact = window.innerWidth < 1180;
    if (west === east && south === north) {
      mapRef.current.easeTo({ center: [west, south], zoom: 6, duration: animate ? 450 : 0 });
      return;
    }
    mapRef.current.fitBounds([[west, south], [east, north]], {
      padding: compact
        ? { top: 88, right: 70, bottom: 84, left: 70 }
        : { top: 86, right: 372, bottom: 82, left: 300 },
      maxZoom: 6.4,
      duration: animate ? 450 : 0,
    });
  }, [commandMap.objects]);

  useEffect(() => {
    if (mapRef.current?.loaded()) fitNetwork(false);
  }, [fitNetwork]);

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
    fitNetwork(false);
  }, [fitNetwork]);

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
          <span>{mapCapability === "checking" ? "Checking WebGL 2 support." : "Use the network list to inspect suppliers, customs handoffs, and destinations."}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.commandMap} aria-label="Supplier, factory, customs, and delivery network">
      <Map
        key={basemap.id}
        ref={mapRef}
        initialViewState={{ longitude: -93, latitude: 40, zoom: 3.1 }}
        mapStyle={basemap.style}
        attributionControl={false}
        cooperativeGestures
        onLoad={markBasemapReady}
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
        <Source id="supply-routes" type="geojson" data={routes}>
          <Layer
            id="supply-route-casing"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "#ffffff",
              "line-opacity": 0.92,
              "line-width": ["case", ["boolean", ["get", "selected"], false], 7, 5],
            }}
          />
          <Layer
            id="supply-route-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "#29485c",
              "line-opacity": ["case", ["boolean", ["get", "selected"], false], 0.95, 0.62],
              "line-width": ["case", ["boolean", ["get", "selected"], false], 3.5, 2],
              "line-dasharray": [2, 1.5],
            }}
          />
        </Source>

        {commandMap.objects.map((object) => {
          const Icon = objectIcon(object);
          return (
            <Marker
              key={object.id}
              longitude={object.coordinates.longitude}
              latitude={object.coordinates.latitude}
              anchor="center"
              offset={markerOffset(object.kind)}
            >
              <button
                type="button"
                className={styles.mapMarker}
                data-kind={object.kind}
                data-status={object.status}
                data-active={object.id === selectedObject?.id}
                aria-label={`${objectKindLabel(object.kind)}: ${object.label}. ${object.statusLabel}`}
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
                <span className={styles.markerStatusDot} />
              </button>
            </Marker>
          );
        })}

        {hoveredObject ? (
          <Popup
            longitude={hoveredObject.coordinates.longitude}
            latitude={hoveredObject.coordinates.latitude}
            anchor="bottom"
            offset={26}
            closeButton={false}
            closeOnClick={false}
            className={styles.commandMapPopup}
          >
            <HoverObjectCard object={hoveredObject} />
          </Popup>
        ) : null}

        <NavigationControl position="bottom-left" showCompass visualizePitch />
        <ScaleControl position="bottom-left" unit="imperial" />
        <AttributionControl position="bottom-right" compact />
      </Map>

      <Tooltip.Provider delayDuration={250}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button type="button" className={styles.fitMapButton} aria-label="Fit network on map" onClick={() => fitNetwork()}>
              <LocateFixed size={16} strokeWidth={1.8} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className={styles.mapTooltip} side="left" sideOffset={8}>
              Fit network
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
