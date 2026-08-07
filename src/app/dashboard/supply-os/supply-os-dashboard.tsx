"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { WORLD_MAP_LAND_PATHS, WORLD_MAP_VIEWBOX } from "@/lib/market-intelligence/world-map-asset";
import {
  upsertSupplyCase,
  type SupplyCaseDashboard,
  type SupplyCompanyResearch,
  type SupplyCoordinate,
  type SupplyEngagementScope,
} from "@/lib/supply-os-case-model";
import {
  buildSupplyEngagementPlan,
  SUPPLY_ENGAGEMENT_OPTIONS,
  type SupplyEngagementPlan,
  type SupplyNetworkFlow,
  type SupplyWorkstream,
  type SupplyWorkstreamId,
} from "@/lib/supply-os-engagement-plan";
import {
  loadSupplyCases,
  persistSupplyCases,
  removeLegacySupplyCaseStorage,
  supplyCaseStorageKeys,
  visibleSupplyCases,
  writeBrowserStorage,
} from "./supply-os-storage";
import styles from "./supply-os-workspace.module.css";

function dashboardName(dashboard: SupplyCaseDashboard) {
  return dashboard.companyName ?? "Unnamed customer";
}

function dashboardLocation(dashboard: SupplyCaseDashboard) {
  return dashboard.companyLocation ?? "Location needed";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function scopeLabel(scope: SupplyEngagementScope | undefined) {
  return SUPPLY_ENGAGEMENT_OPTIONS.find((option) => option.id === (scope ?? "full_operation"))?.shortLabel
    ?? "Full operation";
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function websiteLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Official website";
  }
}

function project(coordinates: SupplyCoordinate | null) {
  if (!coordinates) return null;
  return {
    x: ((coordinates.longitude + 180) / 360) * 1000,
    y: ((90 - coordinates.latitude) / 180) * 500,
  };
}

function routePath(from: SupplyCoordinate | null, to: SupplyCoordinate | null) {
  const start = project(from);
  const end = project(to);
  if (!start || !end) return null;
  const directDistance = Math.abs(end.x - start.x);
  const wrappedEndX = directDistance > 500 ? end.x + (start.x > end.x ? 1000 : -1000) : end.x;
  const distance = Math.abs(wrappedEndX - start.x);
  const lift = Math.min(88, Math.max(24, distance * 0.14));
  const middleX = (start.x + wrappedEndX) / 2;
  const middleY = Math.max(28, Math.min(start.y, end.y) - lift);
  if (directDistance <= 500) {
    return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${middleX.toFixed(1)} ${middleY.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  }

  const boundaryX = wrappedEndX > 1000 ? 1000 : 0;
  const t = (boundaryX - start.x) / (wrappedEndX - start.x);
  const firstControl = { x: start.x + (middleX - start.x) * t, y: start.y + (middleY - start.y) * t };
  const secondControl = { x: middleX + (wrappedEndX - middleX) * t, y: middleY + (end.y - middleY) * t };
  const edge = {
    x: firstControl.x + (secondControl.x - firstControl.x) * t,
    y: firstControl.y + (secondControl.y - firstControl.y) * t,
  };
  const wrapShift = wrappedEndX > 1000 ? -1000 : 1000;
  return [
    `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${firstControl.x.toFixed(1)} ${firstControl.y.toFixed(1)} ${edge.x.toFixed(1)} ${edge.y.toFixed(1)}`,
    `M ${(boundaryX + wrapShift).toFixed(1)} ${edge.y.toFixed(1)} Q ${(secondControl.x + wrapShift).toFixed(1)} ${secondControl.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
  ].join(" ");
}

function scopeWorkstream(scope: SupplyEngagementScope): SupplyWorkstreamId {
  if (scope === "supplier_sourcing") return "supplier_sourcing";
  if (scope === "inbound_logistics") return "inbound_logistics";
  if (scope === "customs") return "customs";
  if (scope === "finished_goods_delivery") return "finished_goods_delivery";
  return "supplier_sourcing";
}

export function SupplyOsDashboardWorkspace({
  storageScope,
  presentationMode = false,
}: {
  storageScope: string;
  presentationMode?: boolean;
}) {
  const keys = useMemo(() => supplyCaseStorageKeys(storageScope), [storageScope]);
  const [savedCases, setSavedCases] = useState<SupplyCaseDashboard[]>([]);
  const [activeCase, setActiveCase] = useState<SupplyCaseDashboard | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    function hydrate() {
      const stored = loadSupplyCases(storageScope);
      setSavedCases(stored.cases);
      setActiveCase(stored.selected);
      setStorageReady(true);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== keys.cases && event.key !== keys.selected) return;
      const stored = loadSupplyCases(storageScope);
      setSavedCases(stored.cases);
      setActiveCase(stored.selected);
    }

    removeLegacySupplyCaseStorage();
    hydrate();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [keys.cases, keys.selected, storageScope]);

  useEffect(() => {
    if (!presentationMode) return;
    const agentDockWasOpen = document.documentElement.classList.contains("agent-dock-open");
    document.documentElement.classList.remove("agent-dock-open");
    document.body.classList.add("supply-os-presentation");
    return () => {
      document.body.classList.remove("supply-os-presentation");
      if (agentDockWasOpen) document.documentElement.classList.add("agent-dock-open");
    };
  }, [presentationMode]);

  const visibleCases = useMemo(() => visibleSupplyCases(savedCases), [savedCases]);

  function openDashboard(item: SupplyCaseDashboard) {
    writeBrowserStorage(keys.selected, item.id);
    setActiveCase(item);
  }

  function updateDashboardScope(item: SupplyCaseDashboard, engagementScope: SupplyEngagementScope): boolean {
    const latestCases = loadSupplyCases(storageScope).cases;
    const latestItem = latestCases.find((candidate) => candidate.id === item.id) ?? item;
    const updated = { ...latestItem, engagementScope, updatedAt: new Date().toISOString() };
    const nextCases = upsertSupplyCase(latestCases, updated);
    if (!persistSupplyCases(storageScope, nextCases, updated.id)) return false;
    setSavedCases(nextCases);
    setActiveCase(updated);
    return true;
  }

  return (
    <div className={`${styles.workspace} ${presentationMode ? styles.presentationWorkspace : ""} supply-os-workspace`}>
      <header className={styles.topBar}>
        <div className={styles.brandBlock}>
          <h1>{presentationMode ? "Derya" : "Supply OS"}</h1>
          <span>{activeCase ? dashboardName(activeCase) : "Customer dashboards"}</span>
        </div>
        <div className={styles.topBarActions}>
          {presentationMode ? <Link className={styles.secondaryButton} href="/dashboard/supply-os">All customers</Link> : null}
          <Link className={styles.primaryButton} href="/dashboard/supply-os/new">
            <Icon name="plus" size={14} /> New customer
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        {!storageReady ? (
          <section className={styles.emptyResult}><p>Loading customer dashboards...</p></section>
        ) : visibleCases.length ? (
          <>
            {!presentationMode ? <section className={styles.customerBrowser} aria-labelledby="saved-cases-title">
              <header>
                <h2 id="saved-cases-title">Customers</h2>
                <span>{visibleCases.length} saved in this browser</span>
              </header>
              <div className={styles.customerList}>
                {visibleCases.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.customerButton}
                    data-active={item.id === activeCase?.id}
                    aria-pressed={item.id === activeCase?.id}
                    onClick={() => openDashboard(item)}
                  >
                    <span><strong>{dashboardName(item)}</strong><small>{dashboardLocation(item)}</small></span>
                    <span><strong>{scopeLabel(item.engagementScope)}</strong><small>3 kickoff inputs</small></span>
                    <time>{formatTimestamp(item.updatedAt)}</time>
                    <Icon name="chevron-right" size={14} />
                  </button>
                ))}
              </div>
            </section> : null}
            {activeCase ? (
              <CaseDashboard
                key={activeCase.id}
                dashboard={activeCase}
                onScopeChange={(scope) => updateDashboardScope(activeCase, scope)}
              />
            ) : null}
          </>
        ) : (
          <section className={styles.emptyResult}>
            <Icon name="layers" size={22} />
            <div>
              <h2>No customer dashboards</h2>
              <p>Create a customer case to see what Derya can take over from suppliers through customer delivery.</p>
              <Link className={styles.primaryButton} href="/dashboard/supply-os/new">Create first customer</Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function CaseDashboard({
  dashboard,
  onScopeChange,
}: {
  dashboard: SupplyCaseDashboard;
  onScopeChange: (scope: SupplyEngagementScope) => boolean;
}) {
  const selectedScope = dashboard.engagementScope ?? "full_operation";
  const [selectedWorkstreamId, setSelectedWorkstreamId] = useState<SupplyWorkstreamId>(scopeWorkstream(selectedScope));
  const [scopeError, setScopeError] = useState("");
  const plan = useMemo(
    () => buildSupplyEngagementPlan(dashboard, selectedScope),
    [dashboard, selectedScope],
  );
  const selectedWorkstream = plan.workstreams.find((item) => item.id === selectedWorkstreamId)
    ?? plan.workstreams[0];
  const [selectedFlowId, setSelectedFlowId] = useState(plan.flows[0]?.id ?? "");

  useEffect(() => {
    setSelectedWorkstreamId(scopeWorkstream(selectedScope));
    setScopeError("");
  }, [selectedScope]);

  function selectScope(scope: SupplyEngagementScope) {
    if (scope === selectedScope) return;
    if (!onScopeChange(scope)) {
      setScopeError("Browser storage is unavailable. The coverage change was not saved.");
    }
  }

  return (
    <article className={styles.caseDashboard} aria-labelledby="active-case-title">
      <header className={styles.caseHeader}>
        <div className={styles.companyIdentity}>
          <CompanyLogo dashboard={dashboard} />
          <div>
            <span className={styles.eyebrow}>{dashboardLocation(dashboard)}</span>
            <h2 id="active-case-title">{dashboardName(dashboard)}</h2>
            <p>{dashboard.companyDescription}</p>
            {dashboard.research ? (
              <div className={styles.companyMeta}>
                <a href={dashboard.research.company.website} target="_blank" rel="noreferrer">
                  {websiteLabel(dashboard.research.company.website)}
                </a>
                <span>{countLabel(dashboard.research.evidence.length, "public source")}</span>
                <span>Researched {formatTimestamp(dashboard.research.researchedAt)}</span>
              </div>
            ) : (
              <div className={styles.companyMeta}><span>Built from customer description</span></div>
            )}
          </div>
        </div>
        <a className={styles.primaryButton} href={`mailto:mert@usederya.com?subject=${encodeURIComponent(`${dashboardName(dashboard)} supply chain kickoff`)}`}>
          Send BOM or upcoming shipment
        </a>
      </header>

      <div className={styles.planGrid}>
        <SupplyNetworkMap
          dashboard={dashboard}
          plan={plan}
          selectedFlowId={selectedFlowId}
          setSelectedFlowId={setSelectedFlowId}
        />
        <CompanyResearchSummary research={dashboard.research} dashboard={dashboard} />
      </div>

      <section className={styles.engagementSection} aria-labelledby="engagement-title">
        <div className={styles.engagementPromise}>
          <span className={styles.eyebrow}>Derya coverage</span>
          <h2 id="engagement-title">{plan.headline}</h2>
          <p>{plan.summary}</p>
          <div className={styles.scopeSelector} aria-label="Choose Derya coverage">
            {SUPPLY_ENGAGEMENT_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                data-active={option.id === selectedScope}
                aria-pressed={option.id === selectedScope}
                onClick={() => selectScope(option.id)}
              >
                {option.shortLabel}
              </button>
            ))}
          </div>
          {scopeError ? <p className={styles.scopeError} role="alert">{scopeError}</p> : null}
        </div>
        <aside className={styles.kickoffPanel}>
          <span className={styles.eyebrow}>Start today</span>
          <h2>Derya needs these 3 things</h2>
          <ol>
            {plan.kickoffInputs.map((item) => <li key={item}>{item}</li>)}
          </ol>
          <p>{plan.kickoffNote}</p>
        </aside>
      </section>

      <section className={styles.workstreamSection} aria-labelledby="workstreams-title">
        <header className={styles.sectionHeader}>
          <h2 id="workstreams-title">What Derya takes over</h2>
          <span>{plan.scopeLabel}</span>
        </header>
        <div className={styles.workstreamRail}>
          {plan.workstreams.map((workstream) => (
            <button
              key={workstream.id}
              type="button"
              data-covered={workstream.state !== "available"}
              data-selected={workstream.id === selectedWorkstream?.id}
              aria-pressed={workstream.id === selectedWorkstream?.id}
              onClick={() => setSelectedWorkstreamId(workstream.id)}
            >
              <span className={styles.workstreamNumber}>{workstream.number}</span>
              <small>{workstream.stateLabel}</small>
              <strong>{workstream.label}</strong>
              <p>{workstream.outcome}</p>
            </button>
          ))}
        </div>
      </section>

      {selectedWorkstream ? <WorkstreamDetail workstream={selectedWorkstream} /> : null}

      <div className={styles.decisionGrid}>
        <CustomsBoundary dashboard={dashboard} />
        <CommitChecks dashboard={dashboard} />
      </div>

      <ExecutionDetail plan={plan} />

      <p className={styles.disclaimer}>This case is a scoping plan. Exact suppliers, routes, prices, capacity, customs treatment, and bookings require current evidence and approval.</p>
    </article>
  );
}

function CompanyLogo({ dashboard }: { dashboard: SupplyCaseDashboard }) {
  const [failed, setFailed] = useState(false);
  const logoUrl = dashboard.research?.company.logoUrl;
  const initial = dashboardName(dashboard).slice(0, 1).toUpperCase();
  return (
    <div className={styles.companyLogo} aria-label={`${dashboardName(dashboard)} logo`}>
      <span>{initial}</span>
      {logoUrl && !failed ? (
        <img src={logoUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : null}
    </div>
  );
}

function CompanyResearchSummary({
  research,
  dashboard,
}: {
  research?: SupplyCompanyResearch;
  dashboard: SupplyCaseDashboard;
}) {
  if (!research) {
    return (
      <aside className={styles.researchSummary}>
        <header><span className={styles.eyebrow}>Customer input</span><h2>What we can map now</h2></header>
        <div className={styles.researchFactList}>
          <article><strong>{countLabel(dashboard.sourcingNeeds.length, "input")}</strong><span>Materials or components named</span></article>
          <article><strong>{countLabel(dashboard.sourceRegions.length, "source region")}</strong><span>Origins named</span></article>
          <article><strong>{countLabel(dashboard.destinations.length, "destination")}</strong><span>Delivery markets named</span></article>
        </div>
        <p>Official website research was not attached to this case. Confirm the company facts before using the map operationally.</p>
      </aside>
    );
  }
  const findings = research.findings.slice(0, 3);
  const inputs = research.company.likelyInputs.slice(0, 5);
  return (
    <aside className={styles.researchSummary}>
      <header>
        <span className={styles.eyebrow}>Public company picture</span>
        <h2>What matters for the supply chain</h2>
      </header>
      <div className={styles.findingList}>
        {findings.map((finding) => (
          <article key={finding.title}>
            <div><strong>{finding.title}</strong><span data-basis={finding.basis}>{finding.basis}</span></div>
            <p>{finding.detail}</p>
            <small>{finding.implication}</small>
          </article>
        ))}
      </div>
      {inputs.length ? (
        <div className={styles.inputHypotheses}>
          <span>Inputs to confirm</span>
          <p>{inputs.map((item) => item.value).join(", ")}</p>
        </div>
      ) : null}
      <details className={styles.researchEvidence}>
        <summary>Company research and {countLabel(research.evidence.length, "source")}</summary>
        <div>
          <p>{research.company.description.value}</p>
          {research.company.products.length ? <p><strong>Products:</strong> {research.company.products.map((item) => item.value).join(", ")}</p> : null}
          {research.company.locations.length ? <p><strong>Locations:</strong> {research.company.locations.map((item) => `${item.value} (${item.role})`).join(", ")}</p> : null}
          {research.company.customerMarkets.length ? <p><strong>Markets:</strong> {research.company.customerMarkets.map((item) => item.value).join(", ")}</p> : null}
          <ul>
            {research.evidence.map((source) => (
              <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><span>{source.sourceType === "official_website" ? "Official" : "Public"}</span></li>
            ))}
          </ul>
          {research.warnings.length ? <p><strong>Confirm:</strong> {research.warnings.join(" ")}</p> : null}
        </div>
      </details>
    </aside>
  );
}

function WorkstreamDetail({ workstream }: { workstream: SupplyWorkstream }) {
  return (
    <aside className={styles.workstreamDetail}>
      <header>
        <span className={styles.eyebrow}>{workstream.stateLabel}</span>
        <h2>{workstream.label}</h2>
        <p>{workstream.outcome}</p>
      </header>
      <div>
        <h3>How Derya runs it</h3>
        <ol>
          {workstream.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
      <footer>Human approval stays at supplier awards, spend, customs treatment, and booking commitments.</footer>
    </aside>
  );
}

function CustomsBoundary({ dashboard }: { dashboard: SupplyCaseDashboard }) {
  const domesticCheck = dashboard.customsChecks.find((check) => check.id === "domestic-regulatory-review");
  const unknownCheck = dashboard.customsChecks.find((check) => check.id === "customs-scope-confirmation");
  const productCheck = dashboard.customsChecks.find((check) => /classification|machine|part-level/i.test(check.label));
  if (domesticCheck) {
    return (
      <section className={styles.summaryPanel}>
        <header className={styles.sectionHeader}><h2>Regulatory handoff</h2><span>Domestic movement</span></header>
        <div className={styles.boundaryList}>
          <article>
            <span>Derya confirms</span>
            <strong>Origin, destination, commodity transport rules, carrier requirements, and receiving constraints</strong>
          </article>
          <article>
            <span>Customer approves</span>
            <strong>Product handling, commercial terms, delivery requirements, and carrier commitment</strong>
          </article>
          <p>{domesticCheck.detail}</p>
        </div>
      </section>
    );
  }
  if (unknownCheck) {
    return (
      <section className={styles.summaryPanel}>
        <header className={styles.sectionHeader}><h2>Customs scope</h2><span>Location needed</span></header>
        <div className={styles.boundaryList}>
          <article>
            <span>Derya confirms</span>
            <strong>Exact supplier country, destination country, border or gateway, commodity, and transaction facts</strong>
          </article>
          <article>
            <span>Then</span>
            <strong>Engage a licensed broker only if the confirmed movement requires an import entry</strong>
          </article>
          <p>{unknownCheck.detail}</p>
        </div>
      </section>
    );
  }
  return (
    <section className={styles.summaryPanel}>
      <header className={styles.sectionHeader}><h2>Customs handoff</h2><span>Broker controlled</span></header>
      <div className={styles.boundaryList}>
        <article>
          <span>Derya prepares</span>
          <strong>Product facts, document checks, classification candidates, broker comparison, and release follow-up</strong>
        </article>
        <article>
          <span>Licensed broker approves</span>
          <strong>Destination classification, entry treatment, admissibility, and filing</strong>
        </article>
        {productCheck ? <p>{productCheck.detail}</p> : null}
      </div>
    </section>
  );
}

function CommitChecks({ dashboard }: { dashboard: SupplyCaseDashboard }) {
  const checks = [
    ...dashboard.risks.slice(0, 2).map((risk) => ({ title: risk.title, detail: risk.check })),
    {
      title: "Live route and provider acceptance",
      detail: "Tender the same scope, compare current capacity and total delivered cost, then confirm the operating provider before booking.",
    },
  ].slice(0, 3);
  return (
    <section className={styles.summaryPanel}>
      <header className={styles.sectionHeader}><h2>Checks before we commit</h2><span>{checks.length} checks</span></header>
      <div className={styles.riskList}>
        {checks.map((check) => (
          <article key={check.title}><strong>{check.title}</strong><p>{check.detail}</p></article>
        ))}
      </div>
    </section>
  );
}

function ExecutionDetail({ plan }: { plan: SupplyEngagementPlan }) {
  return (
    <details className={styles.executionDetail}>
      <summary>
        <span><strong>Execution detail</strong><small>Show the operational handoffs behind the simple plan</small></span>
        <Icon name="chevron-down" size={14} />
      </summary>
      <div className={styles.executionFlows}>
        {plan.executionSections.map((section) => (
          <article key={section.id}>
            <span className={styles.eyebrow}>{section.label}</span>
            <h3>{section.summary}</h3>
            <ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          </article>
        ))}
      </div>
    </details>
  );
}

type NetworkPoint = {
  label: string;
  coordinates: SupplyCoordinate;
  kind: "source" | "production" | "destination";
};

function pointsForFlows(flows: readonly SupplyNetworkFlow[]): NetworkPoint[] {
  const points = new Map<string, NetworkPoint>();
  function add(label: string, coordinates: SupplyCoordinate | null, kind: NetworkPoint["kind"]) {
    if (!coordinates) return;
    const existing = points.get(label);
    if (existing?.kind === "production") return;
    points.set(label, { label, coordinates, kind });
  }
  for (const flow of flows) {
    add(flow.from.label, flow.from.coordinates, flow.kind === "inbound" ? "source" : "production");
    add(flow.to.label, flow.to.coordinates, flow.kind === "inbound" ? "production" : "destination");
  }
  return [...points.values()];
}

function SupplyNetworkMap({
  dashboard,
  plan,
  selectedFlowId,
  setSelectedFlowId,
}: {
  dashboard: SupplyCaseDashboard;
  plan: SupplyEngagementPlan;
  selectedFlowId: string;
  setSelectedFlowId: (id: string) => void;
}) {
  const points = pointsForFlows(plan.flows);
  const selectedFlow = plan.flows.find((flow) => flow.id === selectedFlowId) ?? plan.flows[0] ?? null;
  return (
    <figure className={styles.mapPanel} aria-labelledby="supply-map-title">
      <header className={styles.mapHeader}>
        <h2 id="supply-map-title">Operating network</h2>
        <span>Components in, finished goods out</span>
      </header>
      <div className={styles.flowSelector} aria-label="Supply chain flows">
        {plan.flows.map((flow) => (
          <button
            key={flow.id}
            type="button"
            data-active={flow.id === selectedFlow?.id}
            aria-pressed={flow.id === selectedFlow?.id}
            onClick={() => setSelectedFlowId(flow.id)}
          >
            <span>{flow.kind}</span>
            <strong>{flow.from.label} to {flow.to.label}</strong>
          </button>
        ))}
      </div>
      <div className={styles.mapCanvas}>
        <svg className={styles.mapSvg} viewBox={WORLD_MAP_VIEWBOX} role="img" aria-labelledby="supply-map-svg-title">
          <title id="supply-map-svg-title">Inbound and outbound supply network for {dashboardName(dashboard)}</title>
          <rect width="1000" height="500" className={styles.mapOcean} />
          <g className={styles.mapGrid}>
            {[125, 250, 375].map((y) => <path key={`lat-${y}`} d={`M 0 ${y} H 1000`} />)}
            {[200, 400, 600, 800].map((x) => <path key={`lng-${x}`} d={`M ${x} 0 V 500`} />)}
          </g>
          <g className={styles.mapLand}>{WORLD_MAP_LAND_PATHS.map((path, index) => <path key={`land-${index}`} d={path} />)}</g>
          <g className={styles.routePaths}>
            {plan.flows.map((flow) => {
              const path = routePath(flow.from.coordinates, flow.to.coordinates);
              return path ? <path key={flow.id} d={path} data-active={flow.id === selectedFlow?.id} /> : null;
            })}
          </g>
          <g>
            {points.map((point) => {
              const position = project(point.coordinates);
              if (!position) return null;
              return (
                <g key={point.label} className={styles.mapNode} data-kind={point.kind}>
                  <circle cx={position.x} cy={position.y} r={point.kind === "production" ? 7 : 5} />
                  <text x={position.x + 10} y={position.y - 8}>{point.label}</text>
                </g>
              );
            })}
          </g>
        </svg>
        {selectedFlow ? (
          <div className={styles.nodeInspector} aria-live="polite">
            <span>{selectedFlow.label}</span>
            <strong>{selectedFlow.from.label} to {selectedFlow.to.label}</strong>
            <p>{selectedFlow.detail}</p>
          </div>
        ) : null}
      </div>
      <figcaption>Network intent only. Derya confirms supplier sites, live routes, gateways, and delivery constraints before execution.</figcaption>
    </figure>
  );
}
