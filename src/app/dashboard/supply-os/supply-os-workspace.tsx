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
  kind: "supplier" | "port" | "destination";
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

const MAP_POINTS: MapPoint[] = [
  { id: "dongguan", label: "Dongguan", detail: "Current supplier", lat: 23.02, lng: 113.75, kind: "supplier", labelSide: "left", labelDx: -12, labelDy: -11 },
  { id: "penang", label: "Penang", detail: "Qualified alternate", lat: 5.41, lng: 100.34, kind: "supplier", labelSide: "left", labelDx: -10, labelDy: -8 },
  { id: "monterrey", label: "Monterrey", detail: "Nearshore candidate", lat: 25.69, lng: -100.32, kind: "supplier", labelSide: "right", labelDx: 10, labelDy: 18 },
  { id: "reno", label: "Reno", detail: "Emergency source", lat: 39.53, lng: -119.81, kind: "supplier", labelSide: "right", labelDx: 10, labelDy: -9 },
  { id: "yantian", label: "Yantian", detail: "Origin port", lat: 22.58, lng: 114.27, kind: "port", labelSide: "right", labelDx: 12, labelDy: 15 },
  { id: "long-beach", label: "Long Beach", detail: "Receiving port", lat: 33.75, lng: -118.2, kind: "port", labelSide: "left", labelDx: -10, labelDy: 15 },
  { id: "austin", label: "Austin", detail: "Final delivery", lat: 30.27, lng: -97.74, kind: "destination", labelSide: "right", labelDx: 10, labelDy: -8 },
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

function SupplyNetworkMap({ layer, compact = false }: { layer: MapLayer; compact?: boolean }) {
  const yantian = project(pointById("yantian").lat, pointById("yantian").lng);
  const longBeach = project(pointById("long-beach").lat, pointById("long-beach").lng);
  const penang = project(pointById("penang").lat, pointById("penang").lng);

  return (
    <figure className={styles.mapFigure} data-layer={layer} data-compact={compact}>
      <svg viewBox={WORLD_MAP_VIEWBOX} role="img" aria-label="World map showing modeled suppliers, ports, and transport lanes">
        <rect width="1000" height="500" className={styles.mapOcean} />
        <g className={styles.mapGrid}>
          {[125, 250, 375].map((y) => <path key={`lat-${y}`} d={`M 0 ${y} H 1000`} />)}
          {[250, 500, 750].map((x) => <path key={`lng-${x}`} d={`M ${x} 0 V 500`} />)}
        </g>
        <g className={styles.mapLand}>
          {WORLD_MAP_LAND_PATHS.map((path, index) => <path key={`land-${index}`} d={path} />)}
        </g>
        <g className={styles.mapRoutes}>
          <path className={styles.feederRoute} d={landPath("dongguan", "yantian")} />
          <path className={styles.primaryRoute} d={`M ${yantian.x.toFixed(1)} ${yantian.y.toFixed(1)} Q 920 118 998 210`} />
          <path className={styles.primaryRoute} d={`M 2 210 Q 88 126 ${longBeach.x.toFixed(1)} ${longBeach.y.toFixed(1)}`} />
          <path className={styles.secondaryRoute} d={`M ${penang.x.toFixed(1)} ${penang.y.toFixed(1)} Q 918 205 998 245`} />
          <path className={styles.secondaryRoute} d={`M 2 245 Q 90 170 ${longBeach.x.toFixed(1)} ${longBeach.y.toFixed(1)}`} />
          <path className={styles.feederRoute} d={landPath("long-beach", "austin")} />
          <path className={styles.secondaryRoute} d={landPath("monterrey", "austin")} />
          <path className={styles.secondaryRoute} d={landPath("reno", "austin")} />
        </g>
        <g className={styles.mapPoints}>
          {MAP_POINTS.map((point) => {
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
      <figcaption>
        <span>Natural Earth 1:110m geography</span>
        <span>Modeled network, not live tracking</span>
      </figcaption>
    </figure>
  );
}

export function SupplyOsWorkspace() {
  const [view, setView] = useState<ViewId>("overview");
  const [layer, setLayer] = useState<MapLayer>("network");
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
        />
      ) : null}
      {view === "map" ? <MapView layer={layer} setLayer={setLayer} setView={setView} /> : null}
      {view === "suppliers" ? <SuppliersView supplier={supplier} setSupplierId={setSupplierId} /> : null}
      {view === "quotes" ? <QuoteView quote={quote} setQuoteId={setQuoteId} approvedQuoteId={approvedQuoteId} setApprovedQuoteId={setApprovedQuoteId} /> : null}
      {view === "execution" ? <ExecutionView approvedQuoteId={approvedQuoteId} setView={setView} /> : null}
      {view === "control" ? <ControlView mode={mode} setMode={setMode} permissions={permissions} setPermissions={setPermissions} /> : null}

      <p className={styles.prototypeNote}>Prototype only. No messages, bookings, filings, posts, or external writes occur on this page.</p>
    </div>
  );
}

function Overview({ request, setRequest, planUpdated, rebuild, setView }: {
  request: string;
  setRequest: (value: string) => void;
  planUpdated: boolean;
  rebuild: () => void;
  setView: (view: ViewId) => void;
}) {
  return (
    <div className={styles.view}>
      <section className={styles.requestBar}>
        <label htmlFor="supply-request">Current supply need</label>
        <textarea id="supply-request" value={request} onChange={(event) => setRequest(event.target.value)} />
        <button type="button" className={styles.primaryButton} onClick={rebuild}>{planUpdated ? "Plan updated" : "Update plan"}</button>
      </section>

      <div className={styles.statusStrip}>
        <div><span>Supplier</span><strong>Kepler Precision</strong><small>Current source</small></div>
        <div><span>Primary route</span><strong>Yantian - Long Beach</strong><small>22 to 25 days</small></div>
        <div><span>Best quote</span><strong>$7,780</strong><small>$720 below target</small></div>
        <div><span>Delivery</span><strong>September 9</strong><small>6 day buffer</small></div>
      </div>

      <div className={styles.overviewGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><h2>Supply network</h2><p>Current source, alternate capacity, and receiving route.</p></div>
            <a href="#map" className={styles.textLink} onClick={(event) => { event.preventDefault(); setView("map"); }}>Open map</a>
          </div>
          <SupplyNetworkMap layer="network" compact />
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Decisions</h2><p>One approval blocks execution.</p></div></div>
          <div className={styles.decisionList}>
            <a href="#quotes" onClick={(event) => { event.preventDefault(); setView("quotes"); }}>
              <span data-tone="action">Approval</span>
              <strong>Select a transport plan</strong>
              <small>Four quotes compared against cost, transit, and reliability.</small>
            </a>
            <a href="#suppliers" onClick={(event) => { event.preventDefault(); setView("suppliers"); }}>
              <span data-tone="watch">Concentration</span>
              <strong>Qualify NovaForge for 20%</strong>
              <small>Reduces China concentration with a modeled 2.1% premium.</small>
            </a>
            <a href="#execution" onClick={(event) => { event.preventDefault(); setView("execution"); }}>
              <span data-tone="blocked">Broker review</span>
              <strong>Confirm proposed HTS 7616.99</strong>
              <small>Classification and aluminum derivative exposure remain open.</small>
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function MapView({ layer, setLayer, setView }: { layer: MapLayer; setLayer: (layer: MapLayer) => void; setView: (view: ViewId) => void }) {
  return (
    <div className={styles.view}>
      <div className={styles.viewHeader}>
        <div><h2>Supply map</h2><p>Supplier, port, and destination geography for PO-1048.</p></div>
        <div className={styles.layerTabs}>
          {(["network", "risk", "cost"] as MapLayer[]).map((item) => (
            <a key={item} href={`#map-${item}`} data-active={layer === item} onClick={(event) => { event.preventDefault(); setLayer(item); }}>{item}</a>
          ))}
        </div>
      </div>
      <section className={styles.panel}>
        <SupplyNetworkMap layer={layer} />
      </section>
      <section className={styles.tablePanel}>
        <table>
          <thead><tr><th>Lane</th><th>Role</th><th>Transit</th><th>Cost signal</th><th>Risk</th><th /></tr></thead>
          <tbody>
            <tr><td>Yantian - Long Beach - Austin</td><td>Primary</td><td>22 to 25 days</td><td>$7,780 best quote</td><td><span className={styles.risk} data-risk="medium">Medium</span></td><td><a href="#quotes" onClick={(event) => { event.preventDefault(); setView("quotes"); }}>Quotes</a></td></tr>
            <tr><td>Penang - Long Beach - Austin</td><td>Supplier alternate</td><td>25 to 29 days</td><td>+3.4% modeled</td><td><span className={styles.risk} data-risk="low">Low</span></td><td><a href="#suppliers" onClick={(event) => { event.preventDefault(); setView("suppliers"); }}>Supplier</a></td></tr>
            <tr><td>Monterrey - Austin</td><td>Nearshore alternate</td><td>2 to 4 days</td><td>+11.8% unit cost</td><td><span className={styles.risk} data-risk="low">Low</span></td><td><a href="#suppliers" onClick={(event) => { event.preventDefault(); setView("suppliers"); }}>Supplier</a></td></tr>
          </tbody>
        </table>
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
