"use client";

import { useMemo, useState, type ReactNode } from "react";
import styles from "./supply-os.module.css";

type ViewId = "command" | "map" | "suppliers" | "quotes" | "shipments" | "control";
type MapLayer = "network" | "risk" | "cost";
type AuthorityMode = "observe" | "assist" | "coordinate" | "execute" | "managed";
type PermissionKey =
  | "supplierMessaging"
  | "existingForwarderRfqs"
  | "networkRfqs"
  | "rateNegotiation"
  | "pickupScheduling"
  | "customsPreparation"
  | "domesticLoadPosting"
  | "customerUpdates";

type IconName =
  | "command"
  | "map"
  | "supplier"
  | "quotes"
  | "shipment"
  | "control"
  | "spark"
  | "arrow"
  | "check"
  | "alert"
  | "clock"
  | "box"
  | "ship"
  | "truck"
  | "file"
  | "chevron"
  | "search"
  | "lock"
  | "plus"
  | "activity";

type Supplier = {
  id: string;
  name: string;
  location: string;
  role: string;
  product: string;
  score: number;
  status: "Current" | "Approved alternate" | "Candidate";
  risk: "Low" | "Medium" | "High";
  response: string;
  cargoReady: string;
  documentQuality: string;
  priceSignal: string;
  evidence: number;
  note: string;
};

type Quote = {
  id: string;
  partner: string;
  source: string;
  route: string;
  price: number;
  transit: string;
  reliability: number;
  expires: string;
  badges: string[];
  note: string;
};

const NAV_ITEMS: Array<{ id: ViewId; label: string; icon: IconName }> = [
  { id: "command", label: "Command center", icon: "command" },
  { id: "map", label: "Supply map", icon: "map" },
  { id: "suppliers", label: "Suppliers", icon: "supplier" },
  { id: "quotes", label: "Quote room", icon: "quotes" },
  { id: "shipments", label: "Execution", icon: "shipment" },
  { id: "control", label: "Derya control", icon: "control" },
];

const SUPPLIERS: Supplier[] = [
  {
    id: "kepler",
    name: "Kepler Precision",
    location: "Dongguan, China",
    role: "Current supplier",
    product: "CNC aluminum enclosures",
    score: 84,
    status: "Current",
    risk: "Medium",
    response: "3h 18m",
    cargoReady: "88% on time",
    documentQuality: "94% complete",
    priceSignal: "+6.2% vs last PO",
    evidence: 38,
    note: "Reliable production, but 72% of enclosure volume is concentrated at this factory.",
  },
  {
    id: "novaforge",
    name: "NovaForge Manufacturing",
    location: "Penang, Malaysia",
    role: "Qualified alternate",
    product: "CNC aluminum enclosures",
    score: 91,
    status: "Approved alternate",
    risk: "Low",
    response: "1h 42m",
    cargoReady: "95% on time",
    documentQuality: "98% complete",
    priceSignal: "+2.1% vs target",
    evidence: 26,
    note: "Slightly higher unit cost, with lower country concentration and a cleaner document record.",
  },
  {
    id: "sierra",
    name: "Sierra Metalworks",
    location: "Monterrey, Mexico",
    role: "Nearshore candidate",
    product: "Machined aluminum assemblies",
    score: 77,
    status: "Candidate",
    risk: "Medium",
    response: "6h 05m",
    cargoReady: "No history",
    documentQuality: "Sample approved",
    priceSignal: "+11.8% vs target",
    evidence: 12,
    note: "More expensive at the unit level, but cuts transport time and removes ocean dependence.",
  },
  {
    id: "forgewest",
    name: "ForgeWest Components",
    location: "Reno, United States",
    role: "Emergency source",
    product: "Low-volume CNC enclosures",
    score: 73,
    status: "Candidate",
    risk: "Low",
    response: "48m",
    cargoReady: "92% on time",
    documentQuality: "Domestic",
    priceSignal: "+28.4% vs target",
    evidence: 17,
    note: "Best used as a capacity buffer for launch-critical quantities, not the primary source.",
  },
];

const QUOTES: Quote[] = [
  {
    id: "blueharbor",
    partner: "BlueHarbor Logistics",
    source: "Derya network",
    route: "Yantian to Long Beach to Austin",
    price: 7780,
    transit: "22 to 25 days",
    reliability: 93,
    expires: "2d 4h",
    badges: ["Best value", "Tech cargo"],
    note: "Fastest ocean plan with verified destination capacity and a two-day schedule buffer.",
  },
  {
    id: "apex",
    partner: "Apex Global",
    source: "Your forwarder",
    route: "Yantian to Long Beach to Austin",
    price: 8050,
    transit: "23 to 27 days",
    reliability: 96,
    expires: "1d 9h",
    badges: ["Existing relationship"],
    note: "Your established partner. Strongest historical reliability, but the quote is 3.5% higher.",
  },
  {
    id: "northstar",
    partner: "Northstar Freight",
    source: "Derya network",
    route: "Yantian to Houston to Austin",
    price: 8460,
    transit: "30 to 34 days",
    reliability: 90,
    expires: "3d 1h",
    badges: ["Lower disruption risk"],
    note: "Longer sailing avoids the West Coast transfer and reduces handoffs before final delivery.",
  },
  {
    id: "atlasair",
    partner: "Atlas Air Desk",
    source: "Your forwarder",
    route: "Shenzhen to DFW to Austin",
    price: 28940,
    transit: "4 to 6 days",
    reliability: 97,
    expires: "18h",
    badges: ["Launch protection"],
    note: "Reserve for 1,500 critical units if the ocean cargo-ready date slips by more than five days.",
  },
];

const MODES: Array<{ id: AuthorityMode; label: string; description: string }> = [
  { id: "observe", label: "Observe", description: "Watch work and surface risks. Never contact anyone." },
  { id: "assist", label: "Assist", description: "Draft requests and follow-ups for your team to send." },
  { id: "coordinate", label: "Coordinate", description: "Chase suppliers and partners. Ask before commitments." },
  { id: "execute", label: "Execute", description: "Run approved workflows inside spending and risk limits." },
  { id: "managed", label: "Managed", description: "Derya owns day-to-day logistics, with exception approvals." },
];

const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string }> = {
  supplierMessaging: { label: "Message suppliers", description: "Request missing facts, documents, and cargo-ready updates." },
  existingForwarderRfqs: { label: "RFQ existing forwarders", description: "Use your relationships first and keep you as relationship owner." },
  networkRfqs: { label: "Expand to Derya network", description: "Invite qualified partners when your bench lacks coverage or price tension." },
  rateNegotiation: { label: "Negotiate rates", description: "Counter within your target and approved commercial guardrails." },
  pickupScheduling: { label: "Schedule pickup", description: "Confirm appointments only after the chosen plan is approved." },
  customsPreparation: { label: "Prepare customs packet", description: "Assemble evidence and questions for your broker. Never file or decide clearance." },
  domesticLoadPosting: { label: "Post domestic loads", description: "Create an approved load-board draft after import availability is confirmed." },
  customerUpdates: { label: "Send stakeholder updates", description: "Send milestone updates from your connected channel and approved template." },
};

function Glyph({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    command: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M17.5 14v7"/></>,
    map: <><polygon points="3 6 8 3 16 6 21 3 21 18 16 21 8 18 3 21 3 6"/><path d="M8 3v15M16 6v15"/></>,
    supplier: <><path d="M3 21V8l7-4v17M10 10l6-3v14M16 13l5-2v10"/><path d="M6 10h1M6 14h1M13 12h1M13 16h1M19 15h1"/></>,
    quotes: <><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h7M9 16h5"/><path d="M3 6v14h3"/></>,
    shipment: <><rect x="2" y="6" width="13" height="10" rx="1"/><path d="M15 9h4l3 4v3h-7z"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,
    control: <><path d="M4 21v-7M4 10V3M12 21v-4M12 13V3M20 21v-9M20 8V3"/><path d="M1 14h6M9 13h6M17 8h6"/></>,
    spark: <><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/><path d="M19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7z"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    check: <path d="M20 6L9 17l-5-5"/>,
    alert: <><path d="M12 3L2.5 20h19z"/><path d="M12 9v4M12 17h.01"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    box: <><path d="M4 7l8-4 8 4-8 4z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></>,
    ship: <><path d="M3 14l9-4 9 4-2 5H5z"/><path d="M7 12V6h10v6M10 6V3h4v3M3 21c2 0 2-1.5 4-1.5S9 21 11 21s2-1.5 4-1.5S17 21 19 21"/></>,
    truck: <><rect x="2" y="6" width="13" height="10" rx="1"/><path d="M15 9h4l3 4v3h-7z"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,
    file: <><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
    chevron: <path d="M9 6l6 6-6 6"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    activity: <path d="M3 12h4l2-6 4 12 2-6h6"/>,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Metric({ value, label, trend }: { value: string; label: string; trend?: string }) {
  return (
    <div className={styles.metric}>
      <div className={styles.metricTop}>
        <strong>{value}</strong>
        {trend ? <span>{trend}</span> : null}
      </div>
      <p>{label}</p>
    </div>
  );
}

function StatusDot({ tone = "green" }: { tone?: "green" | "amber" | "red" | "blue" }) {
  return <span className={styles.statusDot} data-tone={tone} />;
}

function ScoreRing({ score }: { score: number }) {
  return (
    <div className={styles.scoreRing} style={{ "--score": score } as React.CSSProperties}>
      <span>{score}</span>
    </div>
  );
}

export function SupplyOsPrototype() {
  const [activeView, setActiveView] = useState<ViewId>("command");
  const [mapLayer, setMapLayer] = useState<MapLayer>("network");
  const [selectedSupplierId, setSelectedSupplierId] = useState("kepler");
  const [selectedQuoteId, setSelectedQuoteId] = useState("blueharbor");
  const [authorityMode, setAuthorityMode] = useState<AuthorityMode>("coordinate");
  const [needText, setNeedText] = useState(
    "I need 12,000 CNC-machined 6061 aluminum enclosures from our supplier in Dongguan to Austin by September 15. Keep landed logistics under $8,500 and protect the launch date.",
  );
  const [planState, setPlanState] = useState<"ready" | "building" | "built">("built");
  const [rfqApproved, setRfqApproved] = useState(false);
  const [executionApproved, setExecutionApproved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>({
    supplierMessaging: true,
    existingForwarderRfqs: true,
    networkRfqs: true,
    rateNegotiation: false,
    pickupScheduling: true,
    customsPreparation: true,
    domesticLoadPosting: false,
    customerUpdates: false,
  });

  const selectedSupplier = useMemo(
    () => SUPPLIERS.find((supplier) => supplier.id === selectedSupplierId) ?? SUPPLIERS[0],
    [selectedSupplierId],
  );
  const selectedQuote = useMemo(
    () => QUOTES.find((quote) => quote.id === selectedQuoteId) ?? QUOTES[0],
    [selectedQuoteId],
  );

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  function buildPlan() {
    setPlanState("building");
    setRfqApproved(false);
    setExecutionApproved(false);
    window.setTimeout(() => {
      setPlanState("built");
      notify("Supply plan rebuilt from the request");
    }, 900);
  }

  function navigate(view: ViewId) {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className={styles.prototypeShell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <div className={styles.brandMark}>D</div>
          <div>
            <div className={styles.brandName}>Derya</div>
            <div className={styles.brandSub}>Supply OS</div>
          </div>
        </div>

        <div className={styles.workspaceCard}>
          <div className={styles.workspaceIcon}>AR</div>
          <div>
            <strong>Atlas Robotics</strong>
            <span>Synthetic workspace</span>
          </div>
          <Glyph name="chevron" size={14} />
        </div>

        <nav className={styles.nav} aria-label="Prototype navigation">
          <span className={styles.navLabel}>Operate</span>
          {NAV_ITEMS.slice(0, 5).map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.navItem}
              data-active={activeView === item.id}
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <Glyph name={item.icon} />
              <span>{item.label}</span>
              {item.id === "quotes" ? <em>4</em> : null}
              {item.id === "shipments" ? <StatusDot tone="green" /> : null}
            </button>
          ))}
          <span className={styles.navLabel}>Configure</span>
          {NAV_ITEMS.slice(5).map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.navItem}
              data-active={activeView === item.id}
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <Glyph name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.autonomyMini}>
            <span><StatusDot tone="blue" /> Derya is coordinating</span>
            <button type="button" onClick={() => navigate("control")}>Change control</button>
          </div>
          <div className={styles.userRow}>
            <div className={styles.userAvatar}>MT</div>
            <div><strong>Mert Turna</strong><span>Admin</span></div>
            <button type="button" aria-label="Open user menu">•••</button>
          </div>
        </div>
      </aside>

      <section className={styles.mainArea}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}>
            <span>Atlas Robotics</span>
            <Glyph name="chevron" size={12} />
            <strong>{NAV_ITEMS.find((item) => item.id === activeView)?.label}</strong>
          </div>
          <div className={styles.topActions}>
            <span className={styles.demoBadge}><StatusDot tone="amber" /> Prototype data only</span>
            <button type="button" className={styles.iconButton} aria-label="Search"><Glyph name="search" /></button>
            <button type="button" className={styles.secondaryButton} onClick={() => notify("No external action was sent")}>Activity</button>
            <button type="button" className={styles.primarySmall} onClick={() => navigate("command")}><Glyph name="plus" size={15} /> New supply need</button>
          </div>
        </header>

        <div className={styles.page}>
          {activeView === "command" ? (
            <CommandCenter
              needText={needText}
              setNeedText={setNeedText}
              planState={planState}
              buildPlan={buildPlan}
              rfqApproved={rfqApproved}
              approveRfq={() => {
                setRfqApproved(true);
                notify("RFQ wave approved in this prototype");
              }}
              navigate={navigate}
            />
          ) : null}
          {activeView === "map" ? <SupplyMap layer={mapLayer} setLayer={setMapLayer} navigate={navigate} /> : null}
          {activeView === "suppliers" ? (
            <SuppliersView supplier={selectedSupplier} selectSupplier={setSelectedSupplierId} navigate={navigate} />
          ) : null}
          {activeView === "quotes" ? (
            <QuoteRoom
              selectedQuote={selectedQuote}
              selectQuote={setSelectedQuoteId}
              approved={executionApproved}
              approve={() => {
                setExecutionApproved(true);
                notify(selectedQuote.partner + " approved for execution");
              }}
              navigate={navigate}
            />
          ) : null}
          {activeView === "shipments" ? <ExecutionView approved={executionApproved} navigate={navigate} /> : null}
          {activeView === "control" ? (
            <ControlView
              mode={authorityMode}
              setMode={setAuthorityMode}
              permissions={permissions}
              setPermissions={setPermissions}
              notify={notify}
            />
          ) : null}
        </div>
      </section>

      {toast ? <div className={styles.toast}><Glyph name="check" size={16} /> {toast}</div> : null}
    </main>
  );
}

function CommandCenter({
  needText,
  setNeedText,
  planState,
  buildPlan,
  rfqApproved,
  approveRfq,
  navigate,
}: {
  needText: string;
  setNeedText: (value: string) => void;
  planState: "ready" | "building" | "built";
  buildPlan: () => void;
  rfqApproved: boolean;
  approveRfq: () => void;
  navigate: (view: ViewId) => void;
}) {
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>Command center</span>
          <h1>Ask for goods. Get an executable supply plan.</h1>
          <p>Derya turns a request into supplier, customs, freight, and delivery work while you decide what it is allowed to do.</p>
        </div>
        <div className={styles.headingStatus}>
          <span><StatusDot tone="green" /> 3 workflows active</span>
          <small>Last intelligence refresh: 14 min ago</small>
        </div>
      </div>

      <section className={styles.needComposer}>
        <div className={styles.composerTop}>
          <div className={styles.sparkBadge}><Glyph name="spark" /></div>
          <div>
            <strong>What do you need moved or sourced?</strong>
            <span>Use plain English, upload a PO, or forward an email.</span>
          </div>
          <span className={styles.privateBadge}><Glyph name="lock" size={12} /> Private workspace</span>
        </div>
        <textarea value={needText} onChange={(event) => setNeedText(event.target.value)} aria-label="Supply need" />
        <div className={styles.composerFooter}>
          <div className={styles.attachmentButtons}>
            <button type="button"><Glyph name="file" size={15} /> Purchase order</button>
            <button type="button"><Glyph name="box" size={15} /> Product spec</button>
          </div>
          <button type="button" className={styles.buildButton} onClick={buildPlan} disabled={planState === "building"}>
            <Glyph name="spark" size={16} />
            {planState === "building" ? "Building plan..." : "Build executable plan"}
          </button>
        </div>
      </section>

      {planState === "building" ? (
        <section className={styles.buildingState}>
          <div className={styles.loaderOrb}><Glyph name="spark" size={22} /></div>
          <div>
            <strong>Structuring the supply need</strong>
            <p>Matching supplier history, route options, customs questions, and partner coverage.</p>
          </div>
          <div className={styles.loadingBar}><span /></div>
        </section>
      ) : null}

      {planState === "built" ? (
        <>
          <div className={styles.summaryStrip}>
            <Metric value="4" label="supplier options" trend="2 qualified" />
            <Metric value="4" label="route plans" trend="1 recommended" />
            <Metric value="14" label="matched forwarders" trend="4 responded" />
            <Metric value="$7,780" label="best landed logistics" trend="8.5% below target" />
            <Metric value="Sep 09" label="predicted delivery" trend="6d buffer" />
          </div>

          <div className={styles.commandGrid}>
            <section className={styles.planCard}>
              <div className={styles.cardHeader}>
                <div>
                  <span className={styles.cardKicker}>Recommended plan 01</span>
                  <h2>Keep production. Create a launch-safe alternate.</h2>
                </div>
                <span className={styles.confidenceBadge}>87% confidence</span>
              </div>

              <div className={styles.routeLine}>
                <div><span className={styles.routeIcon}><Glyph name="supplier" /></span><strong>Kepler Precision</strong><small>Dongguan</small></div>
                <span className={styles.routeConnector}><i />18d<i /></span>
                <div><span className={styles.routeIcon}><Glyph name="ship" /></span><strong>Yantian to Long Beach</strong><small>Ocean, 17 to 20d</small></div>
                <span className={styles.routeConnector}><i />4d<i /></span>
                <div><span className={styles.routeIcon}><Glyph name="truck" /></span><strong>Austin assembly</strong><small>Delivery by Sep 09</small></div>
              </div>

              <div className={styles.decisionRows}>
                <div>
                  <span className={styles.decisionIcon} data-tone="green"><Glyph name="check" /></span>
                  <div><strong>Move 10,500 units on the primary ocean plan</strong><p>BlueHarbor is $270 below your incumbent with comparable transit and verified tech-cargo handling.</p></div>
                  <button type="button" onClick={() => navigate("quotes")}>Compare 4 quotes <Glyph name="arrow" size={14} /></button>
                </div>
                <div>
                  <span className={styles.decisionIcon} data-tone="blue"><Glyph name="activity" /></span>
                  <div><strong>Qualify NovaForge for 20% of the next order</strong><p>The alternate reduces country concentration while keeping modeled landed cost within 3%.</p></div>
                  <button type="button" onClick={() => navigate("suppliers")}>Review supplier <Glyph name="arrow" size={14} /></button>
                </div>
                <div>
                  <span className={styles.decisionIcon} data-tone="amber"><Glyph name="alert" /></span>
                  <div><strong>Hold booking until classification is confirmed</strong><p>Proposed HTS 7616.99 and aluminum derivative exposure need broker review. Derya has prepared the packet.</p></div>
                  <button type="button">Open evidence <Glyph name="arrow" size={14} /></button>
                </div>
              </div>

              <div className={styles.planActions}>
                <div>
                  <span className={styles.avatarStack}><i>KP</i><i>AG</i><i>CP</i><i>+11</i></span>
                  <p>RFQ packet is ready for 2 existing and 12 matched partners.</p>
                </div>
                <button type="button" className={rfqApproved ? styles.approvedButton : styles.primaryButton} onClick={approveRfq}>
                  <Glyph name={rfqApproved ? "check" : "arrow"} size={16} />
                  {rfqApproved ? "RFQ wave approved" : "Approve RFQ wave"}
                </button>
              </div>
            </section>

            <aside className={styles.commandRail}>
              <section className={styles.railCard}>
                <div className={styles.railHeader}><h3>What changed</h3><button type="button">View all</button></div>
                <div className={styles.feedItem}>
                  <span className={styles.feedIcon} data-tone="amber"><Glyph name="activity" /></span>
                  <div><strong>Supplier price moved against inputs</strong><p>Kepler increased unit price 6.2% while the modeled aluminum input moved 1.4%.</p><small>17 min ago · 4 evidence records</small></div>
                </div>
                <div className={styles.feedItem}>
                  <span className={styles.feedIcon} data-tone="green"><Glyph name="quotes" /></span>
                  <div><strong>BlueHarbor returned a complete quote</strong><p>$7,780 all-in with destination capacity confirmed.</p><small>42 min ago · Partner inbox</small></div>
                </div>
                <div className={styles.feedItem}>
                  <span className={styles.feedIcon} data-tone="blue"><Glyph name="supplier" /></span>
                  <div><strong>NovaForge document pack cleared review</strong><p>Alternate supplier now has 98% document completeness.</p><small>2h ago · Supplier workspace</small></div>
                </div>
              </section>

              <section className={styles.railCard}>
                <div className={styles.railHeader}><h3>Derya needs approval</h3><span className={styles.countBadge}>3</span></div>
                <button type="button" className={styles.approvalRow} onClick={() => navigate("quotes")}>
                  <span><Glyph name="ship" /></span><div><strong>Book ocean movement</strong><small>$7,780 · BlueHarbor</small></div><Glyph name="chevron" />
                </button>
                <button type="button" className={styles.approvalRow} onClick={() => navigate("control")}>
                  <span><Glyph name="activity" /></span><div><strong>Counter Kepler pricing</strong><small>Target 3.5% reduction</small></div><Glyph name="chevron" />
                </button>
                <button type="button" className={styles.approvalRow}>
                  <span><Glyph name="file" /></span><div><strong>Send broker review pack</strong><small>7 files · no filing action</small></div><Glyph name="chevron" />
                </button>
              </section>
            </aside>
          </div>
        </>
      ) : null}
    </>
  );
}

function SupplyMap({ layer, setLayer, navigate }: { layer: MapLayer; setLayer: (layer: MapLayer) => void; navigate: (view: ViewId) => void }) {
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <span className={styles.eyebrow}>Supply map</span>
          <h1>Your supply chain, from source to customer.</h1>
          <p>Every node is tied to products, evidence, operational history, and a next action.</p>
        </div>
        <div className={styles.segmented}>
          {(["network", "risk", "cost"] as MapLayer[]).map((item) => (
            <button key={item} type="button" data-active={layer === item} onClick={() => setLayer(item)}>{item[0].toUpperCase() + item.slice(1)}</button>
          ))}
        </div>
      </div>

      <div className={styles.mapStats}>
        <Metric value="4" label="supplier nodes" />
        <Metric value="3" label="active lanes" />
        <Metric value="72%" label="top-source concentration" trend="Needs action" />
        <Metric value="18" label="source records refreshed" trend="Today" />
      </div>

      <section className={styles.mapCard}>
        <div className={styles.mapToolbar}>
          <div><strong>Enclosure supply network</strong><span>12,000 units · PO-1048 · September launch</span></div>
          <div className={styles.mapLegend}>
            <span><i data-tone="green" /> Healthy</span><span><i data-tone="amber" /> Watch</span><span><i data-tone="red" /> Action needed</span>
          </div>
        </div>
        <div className={styles.mapCanvas} data-layer={layer}>
          <svg viewBox="0 0 1000 470" role="img" aria-label="Synthetic supply network map from Asia and Mexico to Austin">
            <defs>
              <linearGradient id="oceanFade" x1="0" x2="1"><stop offset="0" stopColor="#f7f8f5"/><stop offset="1" stopColor="#eef4f1"/></linearGradient>
              <filter id="softShadow"><feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity="0.12"/></filter>
            </defs>
            <rect width="1000" height="470" fill="url(#oceanFade)"/>
            <g className={styles.mapGrid}>
              <path d="M0 94h1000M0 188h1000M0 282h1000M0 376h1000M167 0v470M334 0v470M501 0v470M668 0v470M835 0v470"/>
            </g>
            <g className={styles.landMass}>
              <path d="M55 70l100-32 85 17 48 43-13 39-46 12-8 46-42 34-38-21-36 13-27-44-39-20 16-87z"/>
              <path d="M181 250l46 15 26 50-9 60-37 64-28-38 8-52-26-55z"/>
              <path d="M537 79l70-39 116 15 54 34 75 3 79 49-25 47-67-2-31 33-60-16-43 31-49-43-53-4-47-43z"/>
              <path d="M530 181l85 16 37 54-16 111-47 59-36-54 10-60-36-72z"/>
              <path d="M821 321l70-22 60 32-14 46-90 10-37-28z"/>
            </g>
            <g className={styles.laneLines}>
              <path className={styles.primaryLane} d="M760 184 C650 74 335 73 180 168"/>
              <path className={styles.secondaryLane} d="M760 184 C730 315 470 390 227 265"/>
              <path className={styles.domesticLane} d="M180 168 C193 206 212 236 227 265"/>
              <path className={styles.altLane} d="M690 251 C535 294 360 300 227 265"/>
            </g>
            <g className={styles.mapNodes} filter="url(#softShadow)">
              <g transform="translate(760 184)"><circle r="12" data-tone="amber"/><circle r="4"/><text x="18" y="-5">Dongguan</text><text x="18" y="13">Kepler · 72% volume</text></g>
              <g transform="translate(744 208)"><circle r="8" data-tone="green"/><circle r="3"/><text x="13" y="4">Yantian</text></g>
              <g transform="translate(690 251)"><circle r="10" data-tone="green"/><circle r="4"/><text x="16" y="-4">Penang</text><text x="16" y="13">Qualified alternate</text></g>
              <g transform="translate(180 168)"><circle r="10" data-tone="amber"/><circle r="4"/><text x="-15" y="-19">Long Beach</text><text x="-15" y="-3">2.8d modeled dwell</text></g>
              <g transform="translate(227 265)"><circle r="13" data-tone="green"/><circle r="4"/><text x="17" y="-3">Austin</text><text x="17" y="14">Final assembly</text></g>
              <g transform="translate(202 236)"><circle r="8" data-tone="blue"/><circle r="3"/><text x="-85" y="3">Monterrey alt.</text></g>
            </g>
          </svg>
          <div className={styles.mapCallout}>
            <div><span className={styles.decisionIcon} data-tone={layer === "risk" ? "amber" : "blue"}><Glyph name={layer === "risk" ? "alert" : layer === "cost" ? "quotes" : "activity"} /></span></div>
            <div>
              <span>{layer === "risk" ? "Concentration risk" : layer === "cost" ? "Landed cost insight" : "Derya recommendation"}</span>
              <strong>{layer === "risk" ? "72% of volume depends on one factory" : layer === "cost" ? "Ocean plan is 8.5% below your logistics target" : "Shift 20% of the next order to Penang"}</strong>
              <p>{layer === "risk" ? "Qualify the approved alternate before the next PO to reduce recovery time." : layer === "cost" ? "Supplier price variance matters more than current freight variance." : "Modeled landed cost rises 2.7%, but single-country exposure falls to 58%."}</p>
            </div>
            <button type="button" onClick={() => navigate(layer === "cost" ? "quotes" : "suppliers")}>Open decision <Glyph name="arrow" size={14} /></button>
          </div>
        </div>
      </section>

      <div className={styles.mapLowerGrid}>
        <section className={styles.tableCard}>
          <div className={styles.cardHeaderCompact}><div><h3>Critical paths</h3><p>Modeled against the September 15 launch date.</p></div><button type="button">All paths</button></div>
          <div className={styles.pathRow}><span><StatusDot tone="green" /></span><div><strong>Primary ocean movement</strong><p>Dongguan · Yantian · Long Beach · Austin</p></div><b>6d buffer</b><small>87% confidence</small></div>
          <div className={styles.pathRow}><span><StatusDot tone="amber" /></span><div><strong>Supplier recovery path</strong><p>Penang · Port Klang · Long Beach · Austin</p></div><b>2d buffer</b><small>72% confidence</small></div>
          <div className={styles.pathRow}><span><StatusDot tone="blue" /></span><div><strong>Emergency launch cover</strong><p>Reno · Austin, 1,500 units only</p></div><b>11d buffer</b><small>91% confidence</small></div>
        </section>
        <section className={styles.tableCard}>
          <div className={styles.cardHeaderCompact}><div><h3>Intelligence coverage</h3><p>Every claim shows its evidence state.</p></div></div>
          <div className={styles.coverageRow}><span>Supplier operations</span><div><i style={{ width: "92%" }} /></div><b>92%</b></div>
          <div className={styles.coverageRow}><span>Product and customs</span><div><i style={{ width: "71%" }} /></div><b>71%</b></div>
          <div className={styles.coverageRow}><span>Lane and partner</span><div><i style={{ width: "84%" }} /></div><b>84%</b></div>
          <div className={styles.coverageRow}><span>Last mile</span><div><i style={{ width: "63%" }} /></div><b>63%</b></div>
          <p className={styles.coverageNote}><Glyph name="lock" size={13} /> Prototype values are synthetic and do not represent connected data.</p>
        </section>
      </div>
    </>
  );
}

function SuppliersView({ supplier, selectSupplier, navigate }: { supplier: Supplier; selectSupplier: (id: string) => void; navigate: (view: ViewId) => void }) {
  return (
    <>
      <div className={styles.pageHeading}>
        <div><span className={styles.eyebrow}>Supplier intelligence</span><h1>Know who can actually keep your promise.</h1><p>Supplier profiles combine commercial, operational, product, customs, and transport evidence.</p></div>
        <button type="button" className={styles.primaryButton}><Glyph name="plus" size={16} /> Add supplier</button>
      </div>
      <div className={styles.supplierLayout}>
        <section className={styles.supplierListCard}>
          <div className={styles.listSearch}><Glyph name="search" size={16} /><input aria-label="Search suppliers" placeholder="Search suppliers or products" /></div>
          <div className={styles.listFilters}><button type="button" data-active="true">All 4</button><button type="button">Approved 2</button><button type="button">Needs review 2</button></div>
          <div className={styles.supplierList}>
            {SUPPLIERS.map((item) => (
              <button type="button" key={item.id} data-active={item.id === supplier.id} onClick={() => selectSupplier(item.id)}>
                <div className={styles.supplierMonogram}>{item.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
                <div><strong>{item.name}</strong><span>{item.location}</span><small>{item.product}</small></div>
                <div className={styles.listScore}><b>{item.score}</b><span data-risk={item.risk.toLowerCase()}>{item.risk}</span></div>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.passportCard}>
          <div className={styles.passportHeader}>
            <div className={styles.passportIdentity}>
              <div className={styles.supplierBigMonogram}>{supplier.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
              <div><span>{supplier.role}</span><h2>{supplier.name}</h2><p>{supplier.location} · {supplier.product}</p></div>
            </div>
            <ScoreRing score={supplier.score} />
          </div>

          <div className={styles.passportTabs}><button type="button" data-active="true">Overview</button><button type="button">Products</button><button type="button">Performance</button><button type="button">Evidence {supplier.evidence}</button></div>

          <div className={styles.supplierInsight}>
            <div className={styles.sparkBadge}><Glyph name="spark" /></div>
            <div><span>Derya read</span><strong>{supplier.note}</strong><p>Recommended next step: {supplier.id === "kepler" ? "counter the price increase and place a 20% qualification order with NovaForge." : supplier.id === "novaforge" ? "run one paid production batch and validate export-document consistency." : "request a production capability pack before sending a live PO."}</p></div>
            <button type="button" onClick={() => navigate("control")}>Let Derya follow up</button>
          </div>

          <div className={styles.supplierMetrics}>
            <div><span>Response time</span><strong>{supplier.response}</strong><small>Median over recent requests</small></div>
            <div><span>Cargo ready</span><strong>{supplier.cargoReady}</strong><small>Against committed date</small></div>
            <div><span>Document quality</span><strong>{supplier.documentQuality}</strong><small>Before first correction</small></div>
            <div><span>Price signal</span><strong>{supplier.priceSignal}</strong><small>Product vs modeled inputs</small></div>
          </div>

          <div className={styles.passportGrid}>
            <div className={styles.passportSection}>
              <div className={styles.cardHeaderCompact}><div><h3>Product passport</h3><p>Facts Derya uses to source and move this item.</p></div><button type="button">View all</button></div>
              <dl>
                <div><dt>Product</dt><dd>CNC-machined 6061-T6 enclosure</dd></div>
                <div><dt>Current unit price</dt><dd>$18.42 <span data-tone="amber">+6.2%</span></dd></div>
                <div><dt>Lead time</dt><dd>18 production days</dd></div>
                <div><dt>Proposed HS</dt><dd>7616.99 <small>Broker review required</small></dd></div>
                <div><dt>Shipment profile</dt><dd>4,920 kg · 18.4 cbm · non-hazardous</dd></div>
                <div><dt>Evidence</dt><dd>PO, spec, invoice, 9 shipments</dd></div>
              </dl>
            </div>
            <div className={styles.passportSection}>
              <div className={styles.cardHeaderCompact}><div><h3>Risk and leverage</h3><p>Decision signals, not generic news.</p></div></div>
              <div className={styles.riskRow}><span className={styles.decisionIcon} data-tone="amber"><Glyph name="alert" /></span><div><strong>Source concentration</strong><p>72% of annual enclosure volume</p></div><b>High</b></div>
              <div className={styles.riskRow}><span className={styles.decisionIcon} data-tone="blue"><Glyph name="activity" /></span><div><strong>Commodity leverage</strong><p>Supplier price outpaced modeled inputs</p></div><b>Use</b></div>
              <div className={styles.riskRow}><span className={styles.decisionIcon} data-tone="green"><Glyph name="file" /></span><div><strong>Documentation</strong><p>One correction across last 9 shipments</p></div><b>Good</b></div>
              <div className={styles.riskRow}><span className={styles.decisionIcon} data-tone="amber"><Glyph name="ship" /></span><div><strong>Lane dependence</strong><p>Primary plan depends on Yantian</p></div><b>Watch</b></div>
            </div>
          </div>

          <div className={styles.evidenceFooter}><Glyph name="lock" size={13} /><span>38 synthetic evidence records</span><span>·</span><span>Every score can be traced to a record in a production implementation.</span><button type="button">Open evidence ledger</button></div>
        </section>
      </div>
    </>
  );
}

function QuoteRoom({ selectedQuote, selectQuote, approved, approve, navigate }: { selectedQuote: Quote; selectQuote: (id: string) => void; approved: boolean; approve: () => void; navigate: (view: ViewId) => void }) {
  const spread = selectedQuote.price - 7780;
  return (
    <>
      <div className={styles.pageHeading}>
        <div><span className={styles.eyebrow}>Quote room · PO-1048</span><h1>Compare the whole plan, not just the rate.</h1><p>Existing relationships are included first. Derya adds market tension only where you allow it.</p></div>
        <div className={styles.quoteDeadline}><Glyph name="clock" /><div><span>Quote window closes</span><strong>18h 24m</strong></div></div>
      </div>

      <div className={styles.quoteSummary}>
        <div><span>Target</span><strong>$8,500</strong><small>All-in logistics</small></div>
        <div><span>Best quote</span><strong>$7,780</strong><small>BlueHarbor</small></div>
        <div><span>90-day lane model</span><strong>$8,140</strong><small>Synthetic benchmark</small></div>
        <div><span>Responses</span><strong>4 / 14</strong><small>2 existing · 2 network</small></div>
      </div>

      <div className={styles.quoteLayout}>
        <section className={styles.quoteTableCard}>
          <div className={styles.quoteTableHead}><span>Partner and source</span><span>Total</span><span>Transit</span><span>Reliability</span><span>Valid</span><span /></div>
          {QUOTES.map((quote) => (
            <button type="button" className={styles.quoteRow} data-active={selectedQuote.id === quote.id} key={quote.id} onClick={() => selectQuote(quote.id)}>
              <div className={styles.quotePartner}><span className={styles.supplierMonogram}>{quote.partner.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><strong>{quote.partner}</strong><small>{quote.source}</small><em>{quote.badges.map((badge) => <i key={badge}>{badge}</i>)}</em></div></div>
              <strong>${quote.price.toLocaleString()}</strong>
              <span>{quote.transit}</span>
              <span><b>{quote.reliability}%</b><small>on plan</small></span>
              <span>{quote.expires}</span>
              <span className={styles.radio} data-checked={selectedQuote.id === quote.id}>{selectedQuote.id === quote.id ? <i /> : null}</span>
            </button>
          ))}
          <div className={styles.waitingQuotes}><span className={styles.loaderTiny} /><div><strong>10 more partners invited</strong><p>Derya is following up with 3 and waiting on 7.</p></div><button type="button">View outreach</button></div>
        </section>

        <aside className={styles.quoteDecisionCard}>
          <div className={styles.cardKicker}>Selected plan</div>
          <h2>{selectedQuote.partner}</h2>
          <p>{selectedQuote.note}</p>
          <div className={styles.quotePrice}><strong>${selectedQuote.price.toLocaleString()}</strong><span>all-in logistics</span></div>
          <div className={styles.priceDelta} data-positive={spread <= 0}><Glyph name={spread <= 0 ? "check" : "activity"} size={14} /> {spread === 0 ? "$720 below target" : "$" + spread.toLocaleString() + " above best quote"}</div>
          <dl className={styles.quoteBreakdown}>
            <div><dt>Origin and ocean</dt><dd>${Math.round(selectedQuote.price * 0.49).toLocaleString()}</dd></div>
            <div><dt>Destination and drayage</dt><dd>${Math.round(selectedQuote.price * 0.31).toLocaleString()}</dd></div>
            <div><dt>Broker coordination</dt><dd>${Math.round(selectedQuote.price * 0.08).toLocaleString()}</dd></div>
            <div><dt>Contingency</dt><dd>${Math.round(selectedQuote.price * 0.12).toLocaleString()}</dd></div>
          </dl>
          <div className={styles.guardrail}><Glyph name="alert" /><div><strong>Approval stops before booking</strong><p>This prototype records your selection only. A production flow would create an auditable booking approval.</p></div></div>
          <button type="button" className={approved ? styles.approvedButton : styles.primaryButton} onClick={approve}><Glyph name={approved ? "check" : "arrow"} />{approved ? "Plan approved" : "Approve this plan"}</button>
          <button type="button" className={styles.textButton} onClick={() => navigate("control")}>Review Derya's authority first</button>
        </aside>
      </div>
    </>
  );
}

function ExecutionView({ approved, navigate }: { approved: boolean; navigate: (view: ViewId) => void }) {
  const stages = [
    { label: "Supply confirmed", detail: "Kepler · 12,000 units", date: "Aug 12", state: "done" },
    { label: "Documents ready", detail: "6 of 7 evidence files", date: "Aug 13", state: "active" },
    { label: "Booking", detail: approved ? "BlueHarbor selected" : "Waiting for plan approval", date: "Aug 14", state: approved ? "active" : "blocked" },
    { label: "Origin movement", detail: "Dongguan to Yantian", date: "Aug 31", state: "future" },
    { label: "Ocean transit", detail: "Yantian to Long Beach", date: "Sep 01", state: "future" },
    { label: "Customs and delivery", detail: "Long Beach to Austin", date: "Sep 09", state: "future" },
  ];
  return (
    <>
      <div className={styles.pageHeading}>
        <div><span className={styles.eyebrow}>Execution room · SHP-2048</span><h1>One plan. Every handoff. Clear authority.</h1><p>Derya coordinates the work, records the evidence, and stops at the approval boundary.</p></div>
        <span className={styles.executionState}><StatusDot tone={approved ? "green" : "amber"} /> {approved ? "Plan approved" : "Approval required"}</span>
      </div>

      <div className={styles.executionMetrics}>
        <Metric value="Sep 09" label="predicted delivery" trend="6d ahead" />
        <Metric value="1" label="open decision" trend="Human approval" />
        <Metric value="6 / 7" label="documents ready" trend="1 broker question" />
        <Metric value="$7,780" label="approved plan cost" trend="Within target" />
      </div>

      <div className={styles.executionGrid}>
        <section className={styles.timelineCard}>
          <div className={styles.cardHeaderCompact}><div><h3>Execution timeline</h3><p>Planned dates update as evidence arrives.</p></div><button type="button">View Gantt</button></div>
          <div className={styles.timeline}>
            {stages.map((stage) => (
              <div className={styles.timelineItem} data-state={stage.state} key={stage.label}>
                <div className={styles.timelineMark}>{stage.state === "done" ? <Glyph name="check" size={13} /> : <i />}</div>
                <div><strong>{stage.label}</strong><p>{stage.detail}</p></div>
                <time>{stage.date}</time>
              </div>
            ))}
          </div>
        </section>

        <aside className={styles.executionRail}>
          {!approved ? (
            <section className={styles.actionCard}>
              <span className={styles.decisionIcon} data-tone="amber"><Glyph name="alert" /></span>
              <div><span>Decision needed</span><h3>Approve the booking plan</h3><p>BlueHarbor's quote expires in 2 days. Derya will not commit spend without approval.</p></div>
              <button type="button" className={styles.primaryButton} onClick={() => navigate("quotes")}>Review quote <Glyph name="arrow" size={15} /></button>
            </section>
          ) : (
            <section className={styles.actionCard} data-complete="true">
              <span className={styles.decisionIcon} data-tone="green"><Glyph name="check" /></span>
              <div><span>Approved</span><h3>Plan is ready to hand off</h3><p>In production, Derya would now send the booking request and wait for confirmation.</p></div>
              <button type="button" className={styles.secondaryButton}>View approval record</button>
            </section>
          )}
          <section className={styles.railCard}>
            <div className={styles.railHeader}><h3>Active conversations</h3><span className={styles.countBadge}>4</span></div>
            <div className={styles.conversationRow}><span>KP</span><div><strong>Kepler Precision</strong><p>Cargo-ready confirmation due today</p></div><small>12m</small></div>
            <div className={styles.conversationRow}><span>BH</span><div><strong>BlueHarbor Logistics</strong><p>Destination capacity confirmed</p></div><small>42m</small></div>
            <div className={styles.conversationRow}><span>CP</span><div><strong>ClearPort Brokerage</strong><p>1 classification question open</p></div><small>1h</small></div>
          </section>
          <section className={styles.railCard}>
            <div className={styles.railHeader}><h3>Evidence readiness</h3><strong>86%</strong></div>
            <div className={styles.coverageRow}><span>Commercial</span><div><i style={{ width: "100%" }} /></div><b>5/5</b></div>
            <div className={styles.coverageRow}><span>Transport</span><div><i style={{ width: "86%" }} /></div><b>6/7</b></div>
            <div className={styles.coverageRow}><span>Customs review</span><div><i style={{ width: "71%" }} /></div><b>5/7</b></div>
          </section>
        </aside>
      </div>
    </>
  );
}

function ControlView({
  mode,
  setMode,
  permissions,
  setPermissions,
  notify,
}: {
  mode: AuthorityMode;
  setMode: (mode: AuthorityMode) => void;
  permissions: Record<PermissionKey, boolean>;
  setPermissions: (permissions: Record<PermissionKey, boolean>) => void;
  notify: (message: string) => void;
}) {
  const selectedMode = MODES.find((item) => item.id === mode) ?? MODES[2];
  return (
    <>
      <div className={styles.pageHeading}>
        <div><span className={styles.eyebrow}>Derya control</span><h1>You decide how much of logistics Derya owns.</h1><p>Keep your partner relationships, delegate the busywork, and set explicit limits for every action.</p></div>
        <div className={styles.controlStatus}><Glyph name="lock" /><div><span>Current authority</span><strong>{selectedMode.label}</strong></div></div>
      </div>

      <section className={styles.modeCard}>
        <div className={styles.cardHeaderCompact}><div><h3>Operating mode</h3><p>Choose the default. Override it for any supplier, shipment, or partner.</p></div></div>
        <div className={styles.modeOptions}>
          {MODES.map((item, index) => (
            <button type="button" data-active={mode === item.id} key={item.id} onClick={() => setMode(item.id)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.label}</strong>
              <p>{item.description}</p>
              <i>{mode === item.id ? <Glyph name="check" size={13} /> : null}</i>
            </button>
          ))}
        </div>
      </section>

      <div className={styles.controlGrid}>
        <section className={styles.permissionsCard}>
          <div className={styles.cardHeaderCompact}><div><h3>Action permissions</h3><p>Derya always records what it did, why, and which evidence it used.</p></div><button type="button">Reset</button></div>
          <div className={styles.permissionsList}>
            {(Object.keys(PERMISSION_LABELS) as PermissionKey[]).map((key) => (
              <div key={key}>
                <span className={styles.permissionIcon}><Glyph name={key.includes("customs") ? "file" : key.includes("pickup") || key.includes("Load") ? "truck" : key.includes("Forwarder") || key.includes("network") ? "quotes" : "activity"} /></span>
                <div><strong>{PERMISSION_LABELS[key].label}</strong><p>{PERMISSION_LABELS[key].description}</p></div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={permissions[key]}
                  className={styles.switch}
                  data-active={permissions[key]}
                  onClick={() => setPermissions({ ...permissions, [key]: !permissions[key] })}
                ><i /></button>
              </div>
            ))}
          </div>
        </section>

        <aside className={styles.controlRail}>
          <section className={styles.limitCard}>
            <div className={styles.cardHeaderCompact}><div><h3>Commercial limits</h3><p>Anything outside these limits stops for approval.</p></div></div>
            <label><span>Maximum autonomous spend</span><div><b>$</b><input defaultValue="2,500" aria-label="Maximum autonomous spend"/><small>per shipment</small></div></label>
            <label><span>Maximum rate variance</span><div><input defaultValue="3.0" aria-label="Maximum rate variance"/><b>%</b><small>above approved target</small></div></label>
            <label><span>Minimum evidence confidence</span><div><input defaultValue="85" aria-label="Minimum evidence confidence"/><b>%</b><small>before recommendation</small></div></label>
          </section>

          <section className={styles.partnerPolicyCard}>
            <div className={styles.cardHeaderCompact}><div><h3>Relationship policy</h3><p>Your partners remain yours.</p></div></div>
            <label><input type="radio" name="owner" defaultChecked/><span><strong>My team owns the relationship</strong><small>Derya follows up in the background and keeps us copied.</small></span></label>
            <label><input type="radio" name="owner"/><span><strong>Derya owns the workflow</strong><small>Derya becomes the operating contact within the limits above.</small></span></label>
            <div className={styles.preferredPartners}><span>Preferred partners first</span><strong>Apex Global · ClearPort · Lone Star</strong><button type="button">Edit bench</button></div>
          </section>

          <button type="button" className={styles.saveControl} onClick={() => notify("Prototype control policy saved locally")}><Glyph name="check" /> Save control policy</button>
          <p className={styles.prototypeNote}>Prototype only. No messages, bookings, filings, posts, or external writes occur on this page.</p>
        </aside>
      </div>
    </>
  );
}
