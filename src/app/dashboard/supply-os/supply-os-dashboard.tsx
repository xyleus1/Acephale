"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { WORLD_MAP_LAND_PATHS, WORLD_MAP_VIEWBOX } from "@/lib/market-intelligence/world-map-asset";
import type { SupplyCaseDashboard, SupplyRouteNode } from "@/lib/supply-os-case-model";
import {
  buildSupplyOperatingPlan,
  type SupplyCostRange,
  type SupplyMovementPlan,
} from "@/lib/supply-os-operating-plan";
import {
  loadSupplyCases,
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

function formatUsdRange(cost: SupplyCostRange | null) {
  if (!cost) return "Input needed";
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: cost.currency,
    maximumFractionDigits: 0,
  });
  return `${formatter.format(cost.low)} - ${formatter.format(cost.high)}`;
}

function movementLabel(movement: SupplyMovementPlan) {
  const source = movement.source?.label ?? movement.originGateway.label;
  const destination = movement.destination?.label ?? movement.receivingGateway?.label ?? "Destination needed";
  return `${source} to ${destination}`;
}

function ownerLabel(value: string) {
  return value.replaceAll("_", " ");
}

function project(lat: number | null, lng: number | null) {
  if (lat === null || lng === null) return null;
  return { x: ((lng + 180) / 360) * 1000, y: ((90 - lat) / 180) * 500 };
}

function routePath(from: SupplyRouteNode, to: SupplyRouteNode) {
  const start = project(from.lat, from.lng);
  const end = project(to.lat, to.lng);
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

export function SupplyOsDashboardWorkspace({ storageScope }: { storageScope: string }) {
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

  const visibleCases = useMemo(() => visibleSupplyCases(savedCases), [savedCases]);

  function openDashboard(item: SupplyCaseDashboard) {
    writeBrowserStorage(keys.selected, item.id);
    setActiveCase(item);
  }

  return (
    <div className={`${styles.workspace} supply-os-workspace`}>
      <header className={styles.topBar}>
        <div className={styles.brandBlock}>
          <h1>Supply OS</h1>
          <span>{activeCase ? dashboardName(activeCase) : "Customer dashboards"}</span>
        </div>
        <Link className={styles.primaryButton} href="/dashboard/supply-os/new">
          <Icon name="plus" size={14} /> New customer
        </Link>
      </header>

      <main className={styles.main}>
        {!storageReady ? (
          <section className={styles.emptyResult}><p>Loading customer dashboards...</p></section>
        ) : visibleCases.length ? (
          <>
            <section className={styles.customerBrowser} aria-labelledby="saved-cases-title">
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
                    <span><strong>{item.summary.primaryLane}</strong><small>{item.summary.openCheckCount} inputs needed</small></span>
                    <time>{formatTimestamp(item.updatedAt)}</time>
                    <Icon name="chevron-right" size={14} />
                  </button>
                ))}
              </div>
            </section>
            {activeCase ? <CaseDashboard key={activeCase.id} dashboard={activeCase} /> : null}
          </>
        ) : (
          <section className={styles.emptyResult}>
            <Icon name="layers" size={22} />
            <div>
              <h2>No customer dashboards</h2>
              <p>Create a customer case to map its route, costs, customs steps, and open inputs.</p>
              <Link className={styles.primaryButton} href="/dashboard/supply-os/new">Create first customer</Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function CaseDashboard({ dashboard }: { dashboard: SupplyCaseDashboard }) {
  const operatingPlan = useMemo(() => buildSupplyOperatingPlan(dashboard), [dashboard]);
  const [selectedMovementId, setSelectedMovementId] = useState(operatingPlan.movements[0]?.movementId ?? "");
  const selectedMovement = operatingPlan.movements.find((item) => item.movementId === selectedMovementId)
    ?? operatingPlan.movements[0]
    ?? null;
  const [selectedNodeId, setSelectedNodeId] = useState(
    selectedMovement?.source?.nodeId ?? selectedMovement?.originGateway.nodeId ?? dashboard.routeNodes[0]?.id ?? null,
  );

  function selectMovement(movement: SupplyMovementPlan) {
    setSelectedMovementId(movement.movementId);
    setSelectedNodeId(movement.source?.nodeId ?? movement.originGateway.nodeId);
  }

  return (
    <article className={styles.caseDashboard} aria-labelledby="active-case-title">
      <header className={styles.caseHeader}>
        <div>
          <span className={styles.eyebrow}>{dashboardLocation(dashboard)}</span>
          <h2 id="active-case-title">{dashboardName(dashboard)}</h2>
          <p>{dashboard.overview}</p>
        </div>
      </header>

      {operatingPlan.movements.length > 1 ? (
        <div className={styles.movementSelector} aria-label="Customer movements">
          {operatingPlan.movements.map((movement) => (
            <button
              key={movement.movementId}
              type="button"
              data-active={movement.movementId === selectedMovement?.movementId}
              aria-pressed={movement.movementId === selectedMovement?.movementId}
              onClick={() => selectMovement(movement)}
            >
              {movementLabel(movement)}
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.planGrid} data-movement-id={selectedMovement?.movementId}>
        <SupplyMap
          dashboard={dashboard}
          movement={selectedMovement}
          selectedNodeId={selectedNodeId}
          setSelectedNodeId={setSelectedNodeId}
        />
        <RecommendedPlan movement={selectedMovement} />
      </div>

      <ExecutionPlan movement={selectedMovement} />

      <div className={styles.decisionGrid}>
        <CustomsSummary movement={selectedMovement} />
        <RiskSummary dashboard={dashboard} movement={selectedMovement} />
      </div>

      <p className={styles.disclaimer}>Planning ranges and routes are estimates. Confirm live rates, capacity, customs treatment, and provider acceptance before execution.</p>
    </article>
  );
}

function RecommendedPlan({ movement }: { movement: SupplyMovementPlan | null }) {
  const execution = movement?.executionPlan ?? null;
  const gateway = movement?.portOptions[0] ?? null;
  const linehaul = execution?.legs.find((leg) => leg.type === "international_linehaul" || leg.type === "domestic_linehaul");
  const actions = movement?.quoteBlockers.slice(0, 3) ?? [];

  return (
    <aside className={styles.recommendedPlan}>
      <header><span className={styles.eyebrow}>Recommended plan</span><h2>{movement ? movementLabel(movement) : "Movement needed"}</h2></header>
      <dl className={styles.planMetrics}>
        <div><dt>Gateway</dt><dd>{gateway?.port ?? movement?.receivingGateway?.label ?? "Confirm route"}</dd></div>
        <div><dt>Expected cost</dt><dd>{formatUsdRange(execution?.total ?? null)}</dd></div>
        <div><dt>Transit</dt><dd>{linehaul?.transitAssumption ?? "Confirm schedule"}</dd></div>
      </dl>
      {gateway ? <p className={styles.planReason}>{gateway.bestFor}</p> : null}
      <div className={styles.nextActions}>
        <h3>Next actions</h3>
        {actions.length ? (
          <ol>{actions.map((item) => <li key={item.id}>{item.field}</li>)}</ol>
        ) : <p>No planning actions are available.</p>}
      </div>
    </aside>
  );
}

function ExecutionPlan({ movement }: { movement: SupplyMovementPlan | null }) {
  const legs = movement?.executionPlan.legs ?? [];
  return (
    <section className={styles.executionSection} data-movement-id={movement?.movementId}>
      <header className={styles.sectionHeader}><h2>Door-to-door plan</h2><span>{legs.length} steps</span></header>
      {legs.length ? (
        <div className={styles.executionList}>
          {legs.map((leg) => (
            <article key={leg.id}>
              <span className={styles.stepNumber}>{leg.sequence}</span>
              <div className={styles.stepRoute}>
                <strong>{ownerLabel(leg.type)}</strong>
                <small>{leg.from} to {leg.to}</small>
              </div>
              <div><strong>{leg.providers[0]?.provider ?? "Provider needed"}</strong><small>{leg.mode}</small></div>
              <div><strong>{leg.transitAssumption}</strong><small>Transit</small></div>
              <div className={styles.numeric}><strong>{formatUsdRange(leg.costRange)}</strong><small>Expected cost</small></div>
            </article>
          ))}
        </div>
      ) : <p className={styles.sectionEmpty}>Add complete origin and destination details to build the route.</p>}
    </section>
  );
}

function CustomsSummary({ movement }: { movement: SupplyMovementPlan | null }) {
  const plan = movement?.customsPlan;
  return (
    <section className={styles.summaryPanel} data-movement-id={movement?.movementId}>
      <header className={styles.sectionHeader}><h2>Customs</h2><span>{plan?.importRequired ? "Import" : "Review"}</span></header>
      <dl className={styles.compactFacts}>
        <div><dt>Entry gateway</dt><dd>{plan?.recommendedEntryGateway ?? "Confirm customs boundary"}</dd></div>
        <div><dt>Broker to qualify</dt><dd>{plan?.brokerOptions[0]?.firm ?? "Not selected"}</dd></div>
      </dl>
      {plan?.workflow.length ? (
        <ol className={styles.checklist}>
          {plan.workflow.slice(0, 5).map((step) => <li key={step.sequence}>{step.title}</li>)}
        </ol>
      ) : <p className={styles.sectionEmpty}>No import workflow applies to this movement.</p>}
    </section>
  );
}

function RiskSummary({ dashboard, movement }: { dashboard: SupplyCaseDashboard; movement: SupplyMovementPlan | null }) {
  const movementRisks = movement?.intelligenceChecks.slice(0, 2) ?? [];
  const caseRisk = dashboard.risks[0];
  return (
    <section className={styles.summaryPanel} data-movement-id={movement?.movementId}>
      <header className={styles.sectionHeader}><h2>Risks to verify</h2><span>{movementRisks.length + (caseRisk ? 1 : 0)} checks</span></header>
      <div className={styles.riskList}>
        {movementRisks.map((risk) => (
          <article key={risk.id}><strong>{risk.title}</strong><p>{risk.decisionRule}</p></article>
        ))}
        {caseRisk ? <article><strong>{caseRisk.title}</strong><p>{caseRisk.check}</p></article> : null}
      </div>
    </section>
  );
}

function SupplyMap({
  dashboard,
  movement,
  selectedNodeId,
  setSelectedNodeId,
}: {
  dashboard: SupplyCaseDashboard;
  movement: SupplyMovementPlan | null;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string) => void;
}) {
  const selectedNode = dashboard.routeNodes.find((node) => node.id === selectedNodeId) ?? dashboard.routeNodes[0];
  const nodesById = useMemo(() => new Map(dashboard.routeNodes.map((node) => [node.id, node])), [dashboard.routeNodes]);
  const activeSegmentIds = new Set(movement?.pathSegmentIds ?? []);
  const activeNodeIds = new Set([
    movement?.source?.nodeId,
    movement?.originGateway.nodeId,
    movement?.receivingGateway?.nodeId,
    movement?.customsNode?.nodeId,
    movement?.destination?.nodeId,
  ].flatMap((id) => id ? [id] : []));

  return (
    <figure className={styles.mapPanel} aria-labelledby="supply-map-title">
      <header className={styles.mapHeader}><h2 id="supply-map-title">Supply map</h2></header>
      <div className={styles.mapCanvas}>
        <svg className={styles.mapSvg} viewBox={WORLD_MAP_VIEWBOX} role="img" aria-labelledby="supply-map-svg-title">
          <title id="supply-map-svg-title">Supply route for {dashboardName(dashboard)}</title>
          <rect width="1000" height="500" className={styles.mapOcean} />
          <g className={styles.mapGrid}>
            {[125, 250, 375].map((y) => <path key={`lat-${y}`} d={`M 0 ${y} H 1000`} />)}
            {[200, 400, 600, 800].map((x) => <path key={`lng-${x}`} d={`M ${x} 0 V 500`} />)}
          </g>
          <g className={styles.mapLand}>{WORLD_MAP_LAND_PATHS.map((path, index) => <path key={`land-${index}`} d={path} />)}</g>
          <g className={styles.routePaths}>
            {dashboard.routeSegments.map((segment) => {
              const from = nodesById.get(segment.fromNodeId);
              const to = nodesById.get(segment.toNodeId);
              const path = from && to ? routePath(from, to) : null;
              return path ? <path key={segment.id} d={path} data-active={!movement || activeSegmentIds.has(segment.id)} /> : null;
            })}
          </g>
          <g>
            {dashboard.routeNodes.map((node) => {
              const point = project(node.lat, node.lng);
              if (!point) return null;
              const isSelected = selectedNode?.id === node.id;
              return (
                <g
                  key={node.id}
                  className={styles.mapNode}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect ${node.label}`}
                  data-kind={node.kind}
                  data-selected={isSelected}
                  data-active={!movement || activeNodeIds.has(node.id)}
                  onClick={() => setSelectedNodeId(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedNodeId(node.id);
                    }
                  }}
                >
                  <circle className={styles.mapNodeHitArea} cx={point.x} cy={point.y} r={22} />
                  <circle cx={point.x} cy={point.y} r={isSelected ? 7 : 5} />
                  {node.kind === "source" || node.kind === "receiving_gateway" || isSelected
                    ? <text x={point.x + 10} y={point.y - 8}>{node.label}</text>
                    : null}
                </g>
              );
            })}
          </g>
        </svg>
        {selectedNode ? (
          <div className={styles.nodeInspector} aria-live="polite">
            <span>{selectedNode.kind.replaceAll("_", " ")}</span>
            <strong>{selectedNode.label}</strong>
            <p>{selectedNode.detail}</p>
          </div>
        ) : null}
      </div>
      <figcaption>Modeled route. Confirm live schedules and operational conditions before execution.</figcaption>
    </figure>
  );
}
