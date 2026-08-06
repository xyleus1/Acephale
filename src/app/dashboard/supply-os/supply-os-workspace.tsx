"use client";

import { useMemo, useState } from "react";
import {
  WORLD_MAP_LAND_PATHS,
  WORLD_MAP_VIEWBOX,
} from "@/lib/market-intelligence/world-map-asset";
import styles from "./supply-os-workspace.module.css";

type ViewId = "overview" | "map" | "suppliers" | "quotes" | "execution" | "control";
type MapLayer = "network" | "risk" | "cost";
type AuthorityMode = "observe" | "assist" | "coordinate" | "execute";
type PermissionKey = "supplier" | "forwarder" | "broker" | "pickup" | "updates";
type NetworkLayerKey = "suppliers" | "ports" | "routes" | "risk" | "milestones";

type Movement = {
  id: string;
  po: string;
  supplier: string;
  cargo: string;
  route: string;
  eta: string;
  cost: string;
  status: "At risk" | "On schedule" | "Documents" | "Alternate ready";
  statusTone: "danger" | "success" | "warning" | "neutral";
  mode: string;
  timeline: Array<{ label: string; detail: string; state: "complete" | "current" | "pending" | "blocked" }>;
};

type Supplier = {
  id: string;
  name: string;
  location: string;
  product: string;
  role: string;
  score: number;
  risk: "Low" | "Medium" | "High";
  response: string;
  ready: string;
  documents: string;
  price: string;
  note: string;
};

type Quote = {
  id: string;
  partner: string;
  source: string;
  route: string;
  price: number;
  transit: string;
  reliability: string;
  valid: string;
};

type MapPoint = {
  id: string;
  label: string;
  detail: string;
  lat: number;
  lng: number;
  kind: "supplier" | "port" | "destination" | "chokepoint";
  labelSide?: "left" | "right";
  labelDx?: number;
  labelDy?: number;
};

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "map", label: "Supply map" },
  { id: "suppliers", label: "Suppliers" },
  { id: "quotes", label: "Quote room" },
  { id: "execution", label: "Execution" },
  { id: "control", label: "Control" },
];

const SUPPLIERS: Supplier[] = [
  {
    id: "kepler",
    name: "Kepler Precision",
    location: "Dongguan, China",
    product: "CNC aluminum enclosures",
    role: "Current supplier",
    score: 84,
    risk: "Medium",
    response: "3h 18m",
    ready: "88% on time",
    documents: "94% complete",
    price: "+6.2% vs last PO",
    note: "Reliable production, but 72% of enclosure volume is concentrated at this factory.",
  },
  {
    id: "novaforge",
    name: "NovaForge Manufacturing",
    location: "Penang, Malaysia",
    product: "CNC aluminum enclosures",
    role: "Qualified alternate",
    score: 91,
    risk: "Low",
    response: "1h 42m",
    ready: "95% on time",
    documents: "98% complete",
    price: "+2.1% vs target",
    note: "Higher unit cost, lower country concentration, and a cleaner document record.",
  },
  {
    id: "sierra",
    name: "Sierra Metalworks",
    location: "Monterrey, Mexico",
    product: "Machined aluminum assemblies",
    role: "Nearshore candidate",
    score: 77,
    risk: "Medium",
    response: "6h 05m",
    ready: "No history",
    documents: "Sample approved",
    price: "+11.8% vs target",
    note: "More expensive per unit, but removes ocean dependence and shortens replenishment time.",
  },
  {
    id: "forgewest",
    name: "ForgeWest Components",
    location: "Reno, United States",
    product: "Low-volume CNC enclosures",
    role: "Emergency source",
    score: 73,
    risk: "Low",
    response: "48m",
    ready: "92% on time",
    documents: "Domestic",
    price: "+28.4% vs target",
    note: "Useful as a capacity buffer for launch-critical quantities, not as the primary source.",
  },
];

const QUOTES: Quote[] = [
  { id: "blueharbor", partner: "BlueHarbor Logistics", source: "Derya network", route: "Yantian - Long Beach - Austin", price: 7780, transit: "22 to 25 days", reliability: "93%", valid: "2d 4h" },
  { id: "apex", partner: "Apex Global", source: "Your forwarder", route: "Yantian - Long Beach - Austin", price: 8050, transit: "23 to 27 days", reliability: "96%", valid: "1d 9h" },
  { id: "northstar", partner: "Northstar Freight", source: "Derya network", route: "Yantian - Houston - Austin", price: 8460, transit: "30 to 34 days", reliability: "90%", valid: "3d 1h" },
  { id: "atlasair", partner: "Atlas Air Desk", source: "Your forwarder", route: "Shenzhen - DFW - Austin", price: 28940, transit: "4 to 6 days", reliability: "97%", valid: "18h" },
];

const MOVEMENTS: Movement[] = [
  {
    id: "po-1048",
    po: "PO-1048",
    supplier: "Kepler Precision",
    cargo: "12,000 CNC enclosures",
    route: "Yantian - Long Beach - Austin",
    eta: "Sep 9",
    cost: "$7,780",
    status: "At risk",
    statusTone: "danger",
    mode: "Ocean FCL",
    timeline: [
      { label: "Supply confirmed", detail: "12,000 units", state: "complete" },
      { label: "Documents", detail: "6 of 7 ready", state: "current" },
      { label: "Broker review", detail: "HTS 7616.99 open", state: "blocked" },
      { label: "Ocean booking", detail: "Plan approval required", state: "pending" },
      { label: "Final delivery", detail: "Austin, Sep 9", state: "pending" },
    ],
  },
  {
    id: "po-1052",
    po: "PO-1052",
    supplier: "NovaForge",
    cargo: "8,400 sensor housings",
    route: "Penang - Singapore - Long Beach",
    eta: "Sep 14",
    cost: "$8,210",
    status: "On schedule",
    statusTone: "success",
    mode: "Ocean LCL",
    timeline: [
      { label: "Supplier confirmed", detail: "Capacity reserved", state: "complete" },
      { label: "Export documents", detail: "Packet complete", state: "complete" },
      { label: "Origin pickup", detail: "Booked for Aug 18", state: "current" },
      { label: "Ocean movement", detail: "ETD Aug 21", state: "pending" },
      { label: "Receiving", detail: "Long Beach, Sep 14", state: "pending" },
    ],
  },
  {
    id: "po-1037",
    po: "PO-1037",
    supplier: "Sierra Metalworks",
    cargo: "3,200 battery brackets",
    route: "Monterrey - Laredo - Austin",
    eta: "Aug 23",
    cost: "$3,460",
    status: "Documents",
    statusTone: "warning",
    mode: "Truck FTL",
    timeline: [
      { label: "Production", detail: "Cargo ready", state: "complete" },
      { label: "Commercial invoice", detail: "Revision requested", state: "current" },
      { label: "Broker packet", detail: "Waiting for invoice", state: "blocked" },
      { label: "Border crossing", detail: "Laredo slot held", state: "pending" },
      { label: "Final delivery", detail: "Austin, Aug 23", state: "pending" },
    ],
  },
  {
    id: "po-1061",
    po: "PO-1061",
    supplier: "ForgeWest Components",
    cargo: "900 launch-critical enclosures",
    route: "Reno - Austin",
    eta: "Aug 17",
    cost: "$5,930",
    status: "Alternate ready",
    statusTone: "neutral",
    mode: "Truck LTL",
    timeline: [
      { label: "Capacity check", detail: "900 units available", state: "complete" },
      { label: "Quality evidence", detail: "Prior lot accepted", state: "complete" },
      { label: "Price approval", detail: "+28.4% emergency premium", state: "current" },
      { label: "Pickup", detail: "Can dispatch in 24h", state: "pending" },
      { label: "Final delivery", detail: "Austin, Aug 17", state: "pending" },
    ],
  },
];

const MAP_POINTS: MapPoint[] = [
  { id: "dongguan", label: "Dongguan", detail: "Current supplier", lat: 23.02, lng: 113.75, kind: "supplier", labelSide: "left", labelDx: -12, labelDy: -11 },
  { id: "penang", label: "Penang", detail: "Qualified alternate", lat: 5.41, lng: 100.34, kind: "supplier", labelSide: "left", labelDx: -10, labelDy: -8 },
  { id: "monterrey", label: "Monterrey", detail: "Nearshore candidate", lat: 25.69, lng: -100.32, kind: "supplier", labelSide: "right", labelDx: 10, labelDy: 18 },
  { id: "reno", label: "Reno", detail: "Emergency source", lat: 39.53, lng: -119.81, kind: "supplier", labelSide: "right", labelDx: 10, labelDy: -9 },
  { id: "yantian", label: "Yantian", detail: "Origin port", lat: 22.58, lng: 114.27, kind: "port", labelSide: "right", labelDx: 12, labelDy: 15 },
  { id: "long-beach", label: "Long Beach", detail: "Receiving port", lat: 33.75, lng: -118.2, kind: "port", labelSide: "left", labelDx: -10, labelDy: 15 },
  { id: "austin", label: "Austin", detail: "Final delivery", lat: 30.27, lng: -97.74, kind: "destination", labelSide: "right", labelDx: 10, labelDy: -8 },
  { id: "singapore", label: "Singapore", detail: "Transshipment port", lat: 1.29, lng: 103.85, kind: "port", labelSide: "right", labelDx: 10, labelDy: 15 },
  { id: "shanghai", label: "Shanghai", detail: "Regional port", lat: 31.23, lng: 121.47, kind: "port", labelSide: "left", labelDx: -10, labelDy: -9 },
  { id: "rotterdam", label: "Rotterdam", detail: "European gateway", lat: 51.92, lng: 4.48, kind: "port", labelSide: "right", labelDx: 10, labelDy: -7 },
  { id: "suez", label: "Suez", detail: "Modeled chokepoint", lat: 29.97, lng: 32.55, kind: "chokepoint", labelSide: "right", labelDx: 10, labelDy: 14 },
  { id: "panama", label: "Panama", detail: "Modeled chokepoint", lat: 9.08, lng: -79.68, kind: "chokepoint", labelSide: "left", labelDx: -10, labelDy: 14 },
];

const PERMISSIONS: Array<{ key: PermissionKey; label: string; detail: string }> = [
  { key: "supplier", label: "Supplier follow-up", detail: "Request missing facts, documents, and cargo-ready dates." },
  { key: "forwarder", label: "Forwarder RFQs", detail: "Contact your preferred forwarders before using Derya's network." },
  { key: "broker", label: "Customs preparation", detail: "Prepare the evidence packet. A broker still reviews classification and filing." },
  { key: "pickup", label: "Pickup scheduling", detail: "Schedule after the shipment plan and spend are approved." },
  { key: "updates", label: "Stakeholder updates", detail: "Draft milestone updates for an approved channel." },
];

function project(lat: number, lng: number) {
  return {
    x: ((lng + 180) / 360) * 1000,
    y: ((90 - lat) / 180) * 500,
  };
}

function pointById(id: string) {
  return MAP_POINTS.find((point) => point.id === id) ?? MAP_POINTS[0];
}

function landPath(fromId: string, toId: string) {
  const from = project(pointById(fromId).lat, pointById(fromId).lng);
  const to = project(pointById(toId).lat, pointById(toId).lng);
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} L ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function SupplyNetworkMap({
  layer,
  setLayer,
  selectedMovementId,
  onSelectMovement,
  layers,
  setLayers,
  compact = false,
}: {
  layer: MapLayer;
  setLayer: (layer: MapLayer) => void;
  selectedMovementId: string;
  onSelectMovement: (id: string) => void;
  layers: Record<NetworkLayerKey, boolean>;
  setLayers: (layers: Record<NetworkLayerKey, boolean>) => void;
  compact?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const yantian = project(pointById("yantian").lat, pointById("yantian").lng);
  const longBeach = project(pointById("long-beach").lat, pointById("long-beach").lng);
  const penang = project(pointById("penang").lat, pointById("penang").lng);
  const singapore = project(pointById("singapore").lat, pointById("singapore").lng);
  const rotterdam = project(pointById("rotterdam").lat, pointById("rotterdam").lng);
  const suez = project(pointById("suez").lat, pointById("suez").lng);
  const selectedMovement = MOVEMENTS.find((movement) => movement.id === selectedMovementId) ?? MOVEMENTS[0];
  const zoomedWidth = 1000 / zoom;
  const zoomedHeight = 500 / zoom;
  const viewBox = zoom === 1
    ? WORLD_MAP_VIEWBOX
    : `${((1000 - zoomedWidth) / 2).toFixed(1)} ${((500 - zoomedHeight) / 2).toFixed(1)} ${zoomedWidth.toFixed(1)} ${zoomedHeight.toFixed(1)}`;
  const normalizedSearch = search.trim().toLowerCase();
  const searchResults = normalizedSearch.length < 2
    ? []
    : [
      ...MOVEMENTS.map((movement) => ({ id: movement.id, label: `${movement.po} ${movement.supplier}`, detail: movement.route, type: "movement" as const })),
      ...MAP_POINTS.map((point) => ({ id: point.id, label: point.label, detail: point.detail, type: "point" as const })),
    ].filter((result) => `${result.label} ${result.detail}`.toLowerCase().includes(normalizedSearch)).slice(0, 6);
  const visiblePoints = MAP_POINTS.filter((point) => {
    if (point.kind === "supplier") return layers.suppliers;
    if (point.kind === "port" || point.kind === "chokepoint") return layers.ports;
    return true;
  });
  const routeClass = (movementId: string, routeStyle: "primary" | "secondary" | "feeder") => [
    styles.networkRoute,
    routeStyle === "primary" ? styles.primaryRoute : routeStyle === "secondary" ? styles.secondaryRoute : styles.feederRoute,
    selectedMovementId === movementId ? styles.selectedRoute : styles.unselectedRoute,
  ].join(" ");
  const filterEntries: Array<{ key: NetworkLayerKey; label: string; count: string }> = [
    { key: "suppliers", label: "Suppliers", count: "4" },
    { key: "ports", label: "Ports and crossings", count: "7" },
    { key: "routes", label: "Planned lanes", count: "4" },
    { key: "milestones", label: "Modeled milestones", count: "8" },
    { key: "risk", label: "Risk areas", count: "3" },
  ];

  return (
    <figure className={styles.mapFigure} data-layer={layer} data-compact={compact}>
      <div className={styles.mapToolbar}>
        <div className={styles.mapSearch}>
          <label htmlFor={compact ? "overview-map-search" : "supply-map-search"}>Search network</label>
          <input
            id={compact ? "overview-map-search" : "supply-map-search"}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search supplier, port, or PO"
          />
          {searchResults.length > 0 ? (
            <div className={styles.mapSearchResults}>
              {searchResults.map((result) => (
                <a
                  key={`${result.type}-${result.id}`}
                  href={`#network-${result.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    if (result.type === "movement") onSelectMovement(result.id);
                    else setZoom(1.45);
                    setSearch("");
                  }}
                >
                  <strong>{result.label}</strong>
                  <small>{result.detail}</small>
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div className={styles.mapLayerTabs} aria-label="Map analysis">
          {(["network", "risk", "cost"] as MapLayer[]).map((item) => (
            <a key={item} href={`#map-${item}`} data-active={layer === item} onClick={(event) => { event.preventDefault(); setLayer(item); }}>{item}</a>
          ))}
        </div>
        <a className={styles.filterControl} href="#map-filters" data-active={filtersOpen} onClick={(event) => { event.preventDefault(); setFiltersOpen(!filtersOpen); }}>
          Filters <span>{filterEntries.filter((entry) => layers[entry.key]).length}</span>
        </a>
      </div>

      <div className={styles.mapToolRail} aria-label="Map controls">
        <a href="#map-fit" onClick={(event) => { event.preventDefault(); setZoom(1); }}>Fit</a>
        <a href="#map-route" onClick={(event) => { event.preventDefault(); setZoom(1.35); }}>Route</a>
        <a href="#map-risk" data-active={layer === "risk"} onClick={(event) => { event.preventDefault(); setLayer("risk"); }}>Risk</a>
      </div>

      <svg viewBox={viewBox} role="img" aria-label="World map showing modeled suppliers, ports, transport lanes, and movement milestones">
        <rect width="1000" height="500" className={styles.mapOcean} />
        <g className={styles.mapGrid}>
          {[125, 250, 375].map((y) => <path key={`lat-${y}`} d={`M 0 ${y} H 1000`} />)}
          {[250, 500, 750].map((x) => <path key={`lng-${x}`} d={`M ${x} 0 V 500`} />)}
        </g>
        <g className={styles.mapLand}>
          {WORLD_MAP_LAND_PATHS.map((path, index) => <path key={`land-${index}`} d={path} />)}
        </g>
        {layers.risk ? (
          <g className={styles.riskZones}>
            <ellipse cx={yantian.x} cy={yantian.y} rx="28" ry="18" />
            <ellipse cx={longBeach.x} cy={longBeach.y} rx="32" ry="20" />
            <ellipse cx={suez.x} cy={suez.y} rx="24" ry="14" />
          </g>
        ) : null}
        {layers.routes ? (
          <g className={styles.mapRoutes}>
            <path className={styles.referenceRoute} d={`M ${rotterdam.x.toFixed(1)} ${rotterdam.y.toFixed(1)} Q ${suez.x.toFixed(1)} ${(suez.y - 35).toFixed(1)} ${suez.x.toFixed(1)} ${suez.y.toFixed(1)} Q 690 310 ${singapore.x.toFixed(1)} ${singapore.y.toFixed(1)}`} />
            <g role="button" tabIndex={0} data-movement="po-1048" onClick={() => onSelectMovement("po-1048")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectMovement("po-1048"); }}>
              <title>PO-1048, Yantian to Long Beach to Austin</title>
              <path className={routeClass("po-1048", "feeder")} d={landPath("dongguan", "yantian")} />
              <path className={routeClass("po-1048", "primary")} d={`M ${yantian.x.toFixed(1)} ${yantian.y.toFixed(1)} Q 920 118 998 210`} />
              <path className={routeClass("po-1048", "primary")} d={`M 2 210 Q 88 126 ${longBeach.x.toFixed(1)} ${longBeach.y.toFixed(1)}`} />
              <path className={routeClass("po-1048", "feeder")} d={landPath("long-beach", "austin")} />
            </g>
            <g role="button" tabIndex={0} data-movement="po-1052" onClick={() => onSelectMovement("po-1052")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectMovement("po-1052"); }}>
              <title>PO-1052, Penang to Singapore to Long Beach</title>
              <path className={routeClass("po-1052", "feeder")} d={landPath("penang", "singapore")} />
              <path className={routeClass("po-1052", "secondary")} d={`M ${singapore.x.toFixed(1)} ${singapore.y.toFixed(1)} Q 925 210 998 245`} />
              <path className={routeClass("po-1052", "secondary")} d={`M 2 245 Q 90 170 ${longBeach.x.toFixed(1)} ${longBeach.y.toFixed(1)}`} />
            </g>
            <g role="button" tabIndex={0} data-movement="po-1037" onClick={() => onSelectMovement("po-1037")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectMovement("po-1037"); }}>
              <title>PO-1037, Monterrey to Austin</title>
              <path className={routeClass("po-1037", "secondary")} d={landPath("monterrey", "austin")} />
            </g>
            <g role="button" tabIndex={0} data-movement="po-1061" onClick={() => onSelectMovement("po-1061")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectMovement("po-1061"); }}>
              <title>PO-1061, Reno to Austin</title>
              <path className={routeClass("po-1061", "secondary")} d={landPath("reno", "austin")} />
            </g>
          </g>
        ) : null}
        {layers.milestones ? (
          <g className={styles.movementMarkers}>
            <polygon data-selected={selectedMovementId === "po-1048"} points="0,-6 10,0 0,6 2,0" transform="translate(963 192) rotate(18)" />
            <polygon data-selected={selectedMovementId === "po-1048"} points="0,-6 10,0 0,6 2,0" transform="translate(55 186) rotate(-20)" />
            <polygon data-selected={selectedMovementId === "po-1052"} points="0,-5 9,0 0,5 2,0" transform="translate(945 231) rotate(14)" />
            <polygon data-selected={selectedMovementId === "po-1052"} points="0,-5 9,0 0,5 2,0" transform="translate(82 222) rotate(-18)" />
          </g>
        ) : null}
        <g className={styles.mapPoints}>
          {visiblePoints.map((point) => {
            const position = project(point.lat, point.lng);
            const left = point.labelSide === "left";
            return (
              <g key={point.id}>
                <title>{`${point.label}: ${point.detail}`}</title>
                <circle cx={position.x} cy={position.y} r="10" className={styles.pointHalo} />
                <circle cx={position.x} cy={position.y} r="4.5" data-kind={point.kind} />
                <text x={position.x + (point.labelDx ?? (left ? -10 : 10))} y={position.y + (point.labelDy ?? -8)} textAnchor={left ? "end" : "start"}>
                  {point.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {filtersOpen ? (
        <aside className={styles.mapFilters} id="map-filters">
          <header><div><span>Network layers</span><strong>Map filters</strong></div><a href="#hide-filters" onClick={(event) => { event.preventDefault(); setFiltersOpen(false); }}>Hide</a></header>
          <div className={styles.filterGroup}>
            <span>Operational network</span>
            {filterEntries.map((entry) => (
              <label key={entry.key}>
                <input type="checkbox" checked={layers[entry.key]} onChange={() => setLayers({ ...layers, [entry.key]: !layers[entry.key] })} />
                <i />
                <strong>{entry.label}</strong>
                <small>{entry.count}</small>
              </label>
            ))}
          </div>
          <div className={styles.filterSummary}>
            <span>Scope</span>
            <strong>Atlas Robotics</strong>
            <small>4 suppliers, 4 movements, 3 risk areas</small>
          </div>
        </aside>
      ) : null}

      <aside className={styles.mapInspector}>
        <div className={styles.inspectorHeader}>
          <div><span>Selected movement</span><strong>{selectedMovement.po}</strong></div>
          <span className={styles.movementStatus} data-tone={selectedMovement.statusTone}>{selectedMovement.status}</span>
        </div>
        <h3>{selectedMovement.supplier}</h3>
        <p>{selectedMovement.cargo}</p>
        <dl>
          <div><dt>Route</dt><dd>{selectedMovement.route}</dd></div>
          <div><dt>Mode</dt><dd>{selectedMovement.mode}</dd></div>
          <div><dt>ETA</dt><dd>{selectedMovement.eta}</dd></div>
          <div><dt>Plan</dt><dd>{selectedMovement.cost}</dd></div>
        </dl>
        {!compact ? (
          <nav className={styles.movementQuickList} aria-label="Modeled movements">
            {MOVEMENTS.map((movement) => (
              <a key={movement.id} href={`#${movement.id}`} data-active={movement.id === selectedMovementId} onClick={(event) => { event.preventDefault(); onSelectMovement(movement.id); }}>
                <span>{movement.po}</span><strong>{movement.supplier}</strong><small>{movement.status}</small>
              </a>
            ))}
          </nav>
        ) : null}
      </aside>

      <div className={styles.mapZoom} aria-label="Map zoom">
        <a href="#zoom-in" aria-label="Zoom in" onClick={(event) => { event.preventDefault(); setZoom(Math.min(1.8, zoom + 0.2)); }}>+</a>
        <span>{Math.round(zoom * 100)}%</span>
        <a href="#zoom-out" aria-label="Zoom out" onClick={(event) => { event.preventDefault(); setZoom(Math.max(1, zoom - 0.2)); }}>−</a>
      </div>

      <figcaption>
        <span>Natural Earth 1:110m geography</span>
        <span>Modeled network, not live tracking or AIS</span>
      </figcaption>
    </figure>
  );
}

export function SupplyOsWorkspace() {
  const [view, setView] = useState<ViewId>("overview");
  const [layer, setLayer] = useState<MapLayer>("network");
  const [selectedMovementId, setSelectedMovementId] = useState("po-1048");
  const [networkLayers, setNetworkLayers] = useState<Record<NetworkLayerKey, boolean>>({ suppliers: true, ports: true, routes: true, risk: true, milestones: true });
  const [supplierId, setSupplierId] = useState("kepler");
  const [quoteId, setQuoteId] = useState("blueharbor");
  const [request, setRequest] = useState("12,000 CNC-machined 6061 aluminum enclosures from Dongguan to Austin by September 15. Keep logistics under $8,500 and protect the launch date.");
  const [planUpdated, setPlanUpdated] = useState(false);
  const [approvedQuoteId, setApprovedQuoteId] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthorityMode>("coordinate");
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>({ supplier: true, forwarder: true, broker: true, pickup: false, updates: false });
  const supplier = useMemo(() => SUPPLIERS.find((item) => item.id === supplierId) ?? SUPPLIERS[0], [supplierId]);
  const quote = useMemo(() => QUOTES.find((item) => item.id === quoteId) ?? QUOTES[0], [quoteId]);

  return (
    <div className={styles.workspace}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Supply OS</h1>
          <p>Map suppliers, compare routes, and approve execution.</p>
        </div>
        <div className={styles.headerMeta}>
          <span>Atlas Robotics</span>
          <span className={styles.prototypeBadge}>Prototype data only</span>
        </div>
      </header>

      <nav className={styles.viewTabs} aria-label="Supply OS sections">
        {VIEWS.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            data-active={view === item.id}
            aria-current={view === item.id ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              setView(item.id);
            }}
          >
            {item.label}
            {item.id === "quotes" ? <span>4</span> : null}
          </a>
        ))}
      </nav>

      {view === "overview" ? (
        <Overview
          request={request}
          setRequest={setRequest}
          planUpdated={planUpdated}
          rebuild={() => {
            setPlanUpdated(true);
            window.setTimeout(() => setPlanUpdated(false), 1800);
          }}
          setView={setView}
          layer={layer}
          setLayer={setLayer}
          selectedMovementId={selectedMovementId}
          setSelectedMovementId={setSelectedMovementId}
          networkLayers={networkLayers}
          setNetworkLayers={setNetworkLayers}
        />
      ) : null}
      {view === "map" ? (
        <MapView
          layer={layer}
          setLayer={setLayer}
          selectedMovementId={selectedMovementId}
          setSelectedMovementId={setSelectedMovementId}
          networkLayers={networkLayers}
          setNetworkLayers={setNetworkLayers}
        />
      ) : null}
      {view === "suppliers" ? <SuppliersView supplier={supplier} setSupplierId={setSupplierId} /> : null}
      {view === "quotes" ? <QuoteView quote={quote} setQuoteId={setQuoteId} approvedQuoteId={approvedQuoteId} setApprovedQuoteId={setApprovedQuoteId} /> : null}
      {view === "execution" ? <ExecutionView approvedQuoteId={approvedQuoteId} setView={setView} /> : null}
      {view === "control" ? <ControlView mode={mode} setMode={setMode} permissions={permissions} setPermissions={setPermissions} /> : null}

      <p className={styles.prototypeNote}>Prototype only. No messages, bookings, filings, posts, or external writes occur on this page.</p>
    </div>
  );
}

function Overview({
  request,
  setRequest,
  planUpdated,
  rebuild,
  setView,
  layer,
  setLayer,
  selectedMovementId,
  setSelectedMovementId,
  networkLayers,
  setNetworkLayers,
}: {
  request: string;
  setRequest: (value: string) => void;
  planUpdated: boolean;
  rebuild: () => void;
  setView: (view: ViewId) => void;
  layer: MapLayer;
  setLayer: (layer: MapLayer) => void;
  selectedMovementId: string;
  setSelectedMovementId: (id: string) => void;
  networkLayers: Record<NetworkLayerKey, boolean>;
  setNetworkLayers: (layers: Record<NetworkLayerKey, boolean>) => void;
}) {
  const selectedMovement = MOVEMENTS.find((movement) => movement.id === selectedMovementId) ?? MOVEMENTS[0];

  return (
    <div className={styles.view}>
      <section className={styles.commandBar}>
        <div className={styles.commandLabel}><span>Planning input</span><strong>Current supply need</strong></div>
        <label htmlFor="supply-request">Current supply need</label>
        <textarea id="supply-request" value={request} onChange={(event) => setRequest(event.target.value)} />
        <button type="button" className={styles.primaryButton} onClick={rebuild}>{planUpdated ? "Plan updated" : "Update plan"}</button>
      </section>

      <section className={styles.controlTower}>
        <div className={styles.operationsPane}>
          <header className={styles.operationsHeader}>
            <div><span>Scenario snapshot</span><h2>Network operations</h2></div>
            <div><strong>Atlas Robotics</strong><small>Updated 08:42 PT</small></div>
          </header>

          <div className={styles.exceptionBand}>
            <div data-tone="danger"><span>Critical</span><strong>1</strong><small>Broker hold</small></div>
            <div data-tone="warning"><span>At risk</span><strong>3</strong><small>Needs action</small></div>
            <div data-tone="success"><span>On schedule</span><strong>8</strong><small>Within plan</small></div>
            <div data-tone="neutral"><span>Alternates</span><strong>2</strong><small>Ready to use</small></div>
          </div>

          <div className={styles.analyticsBand}>
            <section className={styles.exposurePanel}>
              <header><span>Exposure</span><a href="#suppliers" onClick={(event) => { event.preventDefault(); setView("suppliers"); }}>Review suppliers</a></header>
              <div className={styles.exposureRow}><div><strong>China source concentration</strong><small>72% of enclosure volume</small></div><span>72%</span><i><b style={{ width: "72%" }} /></i></div>
              <div className={styles.exposureRow}><div><strong>Long Beach dependency</strong><small>2 active ocean movements</small></div><span>61%</span><i><b style={{ width: "61%" }} /></i></div>
              <div className={styles.exposureRow}><div><strong>Document readiness</strong><small>1 packet is blocked</small></div><span>86%</span><i><b style={{ width: "86%" }} /></i></div>
            </section>
            <section className={styles.coveragePanel}>
              <header><span>Forwarder coverage</span><strong>4 quotes</strong></header>
              <div className={styles.coverageChart}>
                <svg viewBox="0 0 72 72" aria-label="Two Derya network quotes and two existing forwarder quotes">
                  <circle cx="36" cy="36" r="25" className={styles.coverageTrack} />
                  <circle cx="36" cy="36" r="25" className={styles.coverageOwned} />
                  <circle cx="36" cy="36" r="25" className={styles.coverageExisting} />
                </svg>
                <div><strong>2 + 2</strong><small>network mix</small></div>
              </div>
              <ul><li><i data-tone="brand" />Derya network <strong>2</strong></li><li><i data-tone="accent" />Your forwarders <strong>2</strong></li></ul>
            </section>
          </div>

          <section className={styles.movementLedger}>
            <header><div><span>Active movements</span><strong>4 modeled plans</strong></div><a href="#full-map" onClick={(event) => { event.preventDefault(); setView("map"); }}>Open full map</a></header>
            <div className={styles.movementTable} role="table" aria-label="Active modeled movements">
              <div className={styles.movementTableHead} role="row"><span>PO / supplier</span><span>ETA</span><span>Status</span></div>
              {MOVEMENTS.map((movement) => (
                <a key={movement.id} href={`#${movement.id}`} role="row" data-active={movement.id === selectedMovementId} onClick={(event) => { event.preventDefault(); setSelectedMovementId(movement.id); }}>
                  <span><strong>{movement.po}</strong><small>{movement.supplier}</small></span>
                  <span><strong>{movement.eta}</strong><small>{movement.mode}</small></span>
                  <span className={styles.movementStatus} data-tone={movement.statusTone}>{movement.status}</span>
                </a>
              ))}
            </div>
          </section>

          <section className={styles.movementTimeline}>
            <header><div><span>Selected workflow</span><strong>{selectedMovement.po}, {selectedMovement.supplier}</strong></div><a href="#execution" onClick={(event) => { event.preventDefault(); setView("execution"); }}>Execution detail</a></header>
            <div>
              {selectedMovement.timeline.map((event) => (
                <article key={event.label} data-state={event.state}><i /><div><strong>{event.label}</strong><small>{event.detail}</small></div><span>{event.state === "complete" ? "Done" : event.state === "current" ? "Now" : event.state === "blocked" ? "Hold" : "Next"}</span></article>
              ))}
            </div>
          </section>
        </div>

        <div className={styles.overviewMap}>
          <SupplyNetworkMap
            layer={layer}
            setLayer={setLayer}
            selectedMovementId={selectedMovementId}
            onSelectMovement={setSelectedMovementId}
            layers={networkLayers}
            setLayers={setNetworkLayers}
            compact
          />
        </div>
      </section>
    </div>
  );
}

function MapView({ layer, setLayer, selectedMovementId, setSelectedMovementId, networkLayers, setNetworkLayers }: {
  layer: MapLayer;
  setLayer: (layer: MapLayer) => void;
  selectedMovementId: string;
  setSelectedMovementId: (id: string) => void;
  networkLayers: Record<NetworkLayerKey, boolean>;
  setNetworkLayers: (layers: Record<NetworkLayerKey, boolean>) => void;
}) {
  return (
    <div className={styles.view}>
      <div className={styles.viewHeader}>
        <div><h2>Supply map</h2><p>Suppliers, ports, planned lanes, exceptions, and modeled milestones.</p></div>
        <span className={styles.mapDataNotice}>Scenario data, no live AIS or GPS</span>
      </div>
      <section className={styles.fullMapWorkspace}>
        <SupplyNetworkMap
          layer={layer}
          setLayer={setLayer}
          selectedMovementId={selectedMovementId}
          onSelectMovement={setSelectedMovementId}
          layers={networkLayers}
          setLayers={setNetworkLayers}
        />
      </section>
    </div>
  );
}

function SuppliersView({ supplier, setSupplierId }: { supplier: Supplier; setSupplierId: (id: string) => void }) {
  return (
    <div className={styles.view}>
      <div className={styles.viewHeader}><div><h2>Suppliers</h2><p>Operating evidence for the current product family.</p></div></div>
      <div className={styles.supplierGrid}>
        <section className={styles.tablePanel}>
          <table>
            <thead><tr><th>Supplier</th><th>Role</th><th>Score</th><th>Risk</th></tr></thead>
            <tbody>
              {SUPPLIERS.map((item) => (
                <tr key={item.id} data-active={item.id === supplier.id} onClick={() => setSupplierId(item.id)}>
                  <td><a href={`#supplier-${item.id}`} onClick={(event) => { event.preventDefault(); setSupplierId(item.id); }}><strong>{item.name}</strong><small>{item.location}</small></a></td>
                  <td>{item.role}</td><td>{item.score}</td><td><span className={styles.risk} data-risk={item.risk.toLowerCase()}>{item.risk}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className={styles.detailPanel}>
          <div className={styles.detailHeader}><div><span>{supplier.role}</span><h2>{supplier.name}</h2><p>{supplier.location}</p></div><strong>{supplier.score}<small>/100</small></strong></div>
          <p className={styles.supplierNote}>{supplier.note}</p>
          <dl className={styles.factList}>
            <div><dt>Product</dt><dd>{supplier.product}</dd></div>
            <div><dt>Median response</dt><dd>{supplier.response}</dd></div>
            <div><dt>Cargo ready</dt><dd>{supplier.ready}</dd></div>
            <div><dt>Document quality</dt><dd>{supplier.documents}</dd></div>
            <div><dt>Price signal</dt><dd>{supplier.price}</dd></div>
            <div><dt>Evidence</dt><dd>POs, specifications, invoices, and shipment records</dd></div>
          </dl>
          <div className={styles.reviewNote}><strong>Recommended next step</strong><p>{supplier.id === "kepler" ? "Counter the increase and place a 20% qualification order with NovaForge." : "Request a paid sample and validate production and export documents."}</p></div>
        </section>
      </div>
    </div>
  );
}

function QuoteView({ quote, setQuoteId, approvedQuoteId, setApprovedQuoteId }: { quote: Quote; setQuoteId: (id: string) => void; approvedQuoteId: string | null; setApprovedQuoteId: (id: string) => void }) {
  const approved = approvedQuoteId === quote.id;
  return (
    <div className={styles.view}>
      <div className={styles.viewHeader}><div><h2>Quote room</h2><p>PO-1048, Yantian to Austin. Existing partners are included.</p></div><span className={styles.deadline}>Closes in 18h 24m</span></div>
      <section className={styles.tablePanel}>
        <table>
          <thead><tr><th>Partner</th><th>Source</th><th>Route</th><th>Total</th><th>Transit</th><th>Reliability</th><th>Valid</th></tr></thead>
          <tbody>
            {QUOTES.map((item) => (
              <tr key={item.id} data-active={item.id === quote.id} onClick={() => setQuoteId(item.id)}>
                <td><a href={`#quote-${item.id}`} onClick={(event) => { event.preventDefault(); setQuoteId(item.id); }}><strong>{item.partner}</strong></a></td><td>{item.source}</td><td>{item.route}</td><td><strong>${item.price.toLocaleString()}</strong></td><td>{item.transit}</td><td>{item.reliability}</td><td>{item.valid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className={styles.approvalBar}>
        <div><span>Selected</span><strong>{quote.partner}, ${quote.price.toLocaleString()}</strong><small>{quote.price <= 8500 ? `$${(8500 - quote.price).toLocaleString()} below target` : `$${(quote.price - 8500).toLocaleString()} above target`}</small></div>
        <p>Approval records the choice in this prototype. It does not contact or book with the partner.</p>
        <button type="button" className={approved ? "btn btn-secondary" : styles.primaryButton} disabled={approved} onClick={() => setApprovedQuoteId(quote.id)}>{approved ? "Plan approved" : "Approve plan"}</button>
      </section>
    </div>
  );
}

function ExecutionView({ approvedQuoteId, setView }: { approvedQuoteId: string | null; setView: (view: ViewId) => void }) {
  const approvedQuote = QUOTES.find((item) => item.id === approvedQuoteId) ?? null;
  const approved = approvedQuote !== null;
  const stages = [
    ["Supply confirmed", "Kepler, 12,000 units", "Aug 12", "Complete"],
    ["Documents", "6 of 7 ready", "Aug 13", "In review"],
    ["Booking", approvedQuote ? `${approvedQuote.partner} selected` : "Waiting for plan approval", "Aug 14", approved ? "Ready" : "Blocked"],
    ["Origin movement", "Dongguan to Yantian", "Aug 31", "Planned"],
    ["Ocean transit", "Yantian to Long Beach", "Sep 1", "Planned"],
    ["Customs and delivery", "Long Beach to Austin", "Sep 9", "Planned"],
  ];
  return (
    <div className={styles.view}>
      <div className={styles.viewHeader}><div><h2>Execution</h2><p>SHP-2048. Every handoff stays tied to evidence and approval.</p></div><span className={styles.stateBadge} data-state={approved ? "ready" : "blocked"}>{approved ? "Ready to book" : "Approval required"}</span></div>
      <section className={styles.tablePanel}>
        <table>
          <thead><tr><th>Step</th><th>Detail</th><th>Planned</th><th>Status</th></tr></thead>
          <tbody>{stages.map(([step, detail, date, state], index) => <tr key={step}><td><span className={styles.stepNumber}>{index + 1}</span><strong>{step}</strong></td><td>{detail}</td><td>{date}</td><td><span className={styles.stateBadge} data-state={state.toLowerCase()}>{state}</span></td></tr>)}</tbody>
        </table>
      </section>
      {!approved ? <section className={styles.approvalBar}><div><span>Decision needed</span><strong>Approve a transport plan</strong><small>Booking remains blocked.</small></div><p>Four quotes are ready. No partner is contacted from this prototype.</p><button type="button" className={styles.primaryButton} onClick={() => setView("quotes")}>Review quotes</button></section> : null}
    </div>
  );
}

function ControlView({ mode, setMode, permissions, setPermissions }: {
  mode: AuthorityMode;
  setMode: (mode: AuthorityMode) => void;
  permissions: Record<PermissionKey, boolean>;
  setPermissions: (permissions: Record<PermissionKey, boolean>) => void;
}) {
  const modes: Array<{ id: AuthorityMode; label: string; detail: string }> = [
    { id: "observe", label: "Observe", detail: "Track work and flag risks." },
    { id: "assist", label: "Assist", detail: "Draft work for your team to send." },
    { id: "coordinate", label: "Coordinate", detail: "Follow up, but stop before commitments." },
    { id: "execute", label: "Execute", detail: "Act inside approved spend and risk limits." },
  ];
  return (
    <div className={styles.view}>
      <div className={styles.viewHeader}><div><h2>Control</h2><p>Set what Derya can do and where a person must approve.</p></div></div>
      <div className={styles.controlGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Operating mode</h2><p>Default for this workspace.</p></div></div>
          <div className={styles.modeList}>{modes.map((item) => <a href={`#mode-${item.id}`} key={item.id} data-active={mode === item.id} onClick={(event) => { event.preventDefault(); setMode(item.id); }}><span>{mode === item.id ? "Selected" : ""}</span><strong>{item.label}</strong><small>{item.detail}</small></a>)}</div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Action permissions</h2><p>Customer and supplier commitments remain approval-gated.</p></div></div>
          <div className={styles.permissionList}>{PERMISSIONS.map((item) => <div key={item.key}><div><strong>{item.label}</strong><p>{item.detail}</p></div><label className={styles.permissionToggle}><input type="checkbox" checked={permissions[item.key]} onChange={() => setPermissions({ ...permissions, [item.key]: !permissions[item.key] })} aria-label={item.label} /><span><i /></span></label></div>)}</div>
        </section>
      </div>
    </div>
  );
}
