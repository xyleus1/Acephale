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
import { SUPPLY_ENGAGEMENT_OPTIONS } from "@/lib/supply-os-engagement-plan";
import {
  buildSupplyOptimizationModel,
  type SupplyOptimizationBasis,
  type SupplyOptimizationEdge,
  type SupplyOptimizationModel,
  type SupplyOptimizationNode,
} from "@/lib/supply-os-optimization-engine";
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
  return dashboard.productionLocation ?? dashboard.companyLocation ?? "Operating site needed";
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
  const lift = Math.min(70, Math.max(13, distance * 0.1));
  const middleX = (start.x + wrappedEndX) / 2;
  const middleY = Math.max(18, Math.min(start.y, end.y) - lift);
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

function mapViewBox(nodes: readonly SupplyOptimizationNode[]) {
  const points = nodes.flatMap((node) => {
    const point = project(node.coordinates);
    return point ? [point] : [];
  });
  if (points.length < 2) return WORLD_MAP_VIEWBOX;

  let minX = Math.min(...points.map((point) => point.x));
  let maxX = Math.max(...points.map((point) => point.x));
  let minY = Math.min(...points.map((point) => point.y));
  let maxY = Math.max(...points.map((point) => point.y));
  let width = Math.max(145, maxX - minX + 72);
  let height = Math.max(92, maxY - minY + 56);
  const targetRatio = 1.72;
  if (width / height < targetRatio) width = height * targetRatio;
  if (width / height > targetRatio) height = width / targetRatio;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  minX = Math.max(0, Math.min(1000 - width, centerX - width / 2));
  minY = Math.max(0, Math.min(500 - height, centerY - height / 2));
  maxX = minX + Math.min(width, 1000);
  maxY = minY + Math.min(height, 500);
  return `${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`;
}

function basisLabel(basis: SupplyOptimizationBasis) {
  if (basis === "official") return "Official evidence";
  if (basis === "public") return "Public evidence";
  if (basis === "customer_stated") return "Customer input";
  return "Inferred pattern";
}

function confidenceLabel(value: SupplyOptimizationNode["confidence"]) {
  return `${value[0]?.toUpperCase()}${value.slice(1)} confidence`;
}

function nodeKindLabel(kind: SupplyOptimizationNode["kind"]) {
  if (kind === "supplier_cluster") return "Source market";
  if (kind === "processing_site") return "Operating site";
  if (kind === "distribution") return "Distribution";
  return "Customer market";
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
                    <span><strong>{scopeLabel(item.engagementScope)}</strong><small>Optimization case</small></span>
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
              <p>Create a customer case to infer the operating network and identify the first supply-chain improvements.</p>
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
  const [scopeError, setScopeError] = useState("");
  const model = useMemo(() => buildSupplyOptimizationModel(dashboard), [dashboard]);

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
          <span className={styles.eyebrow}>{dashboardLocation(dashboard)}</span>
          <h2 id="active-case-title">{dashboardName(dashboard)}</h2>
          <p>{dashboard.research?.company.description.value ?? dashboard.companyDescription}</p>
          <div className={styles.companyMeta}>
            <span>{model.profile}</span>
            {dashboard.research ? (
              <>
                <a href={dashboard.research.company.website} target="_blank" rel="noreferrer">
                  {websiteLabel(dashboard.research.company.website)} <span aria-hidden="true">↗</span>
                </a>
                <span>{countLabel(dashboard.research.evidence.length, "source")}</span>
                <span>Updated {formatTimestamp(dashboard.research.researchedAt)}</span>
              </>
            ) : <span>Built from customer input</span>}
          </div>
        </div>
        <div className={styles.caseHeaderActions}>
          <a className={styles.primaryButton} href={`mailto:mert@usederya.com?subject=${encodeURIComponent(`${dashboardName(dashboard)} supply chain kickoff`)}`}>
            Start with BOM or shipment <Icon name="arrow-right" size={14} />
          </a>
        </div>
      </header>

      <section className={styles.scopeBar} aria-label="Derya operating scope">
        <div>
          <span className={styles.eyebrow}>Operating scope</span>
          <strong>{scopeLabel(selectedScope)}</strong>
          <small>Choose where Derya starts. The optimization model stays visible across the full operation.</small>
        </div>
        <div className={styles.scopeSelector}>
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
      </section>

      <section className={styles.operatingBrief}>
        <div>
          <span className={styles.eyebrow}>Inferred operating model</span>
          <h2>{model.networkSummary}</h2>
        </div>
        <dl>
          <div><dt>Mapped stages</dt><dd>{model.nodes.length}</dd></div>
          <div><dt>Priority moves</dt><dd>{model.actions.length}</dd></div>
          <div><dt>Official sources</dt><dd>{dashboard.research?.evidence.length ?? 0}</dd></div>
        </dl>
      </section>

      <SupplyNetworkWorkspace dashboard={dashboard} model={model} />
      <OptimizationQueue dashboard={dashboard} model={model} />
      <KickoffStrip dashboard={dashboard} model={model} />
      <CompanyEvidence research={dashboard.research} model={model} dashboard={dashboard} />

      <p className={styles.disclaimer}>Official facts, customer inputs, and inferred operating patterns are kept separate. Supplier awards, routes, rates, customs treatment, bookings, and spend still require current evidence and approval.</p>
    </article>
  );
}

function SupplyNetworkWorkspace({
  dashboard,
  model,
}: {
  dashboard: SupplyCaseDashboard;
  model: SupplyOptimizationModel;
}) {
  const firstNode = model.nodes.find((node) => node.kind === "processing_site") ?? model.nodes[0] ?? null;
  const [selectedNodeId, setSelectedNodeId] = useState(firstNode?.id ?? "");
  const selectedNode = model.nodes.find((node) => node.id === selectedNodeId) ?? firstNode;
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const viewBox = mapViewBox(model.nodes);
  const viewBoxWidth = Number(viewBox.split(" ")[2]) || 1000;
  const mapGlyphScale = Math.max(0.14, Math.min(1, viewBoxWidth / 1000));

  function selectNode(node: SupplyOptimizationNode) {
    setSelectedNodeId(node.id);
  }

  return (
    <section className={styles.networkSection} aria-labelledby="supply-network-title">
      <header className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Supplier to customer</span>
          <h2 id="supply-network-title">Operating network</h2>
        </div>
        <div className={styles.mapLegend} aria-label="Network evidence legend">
          <span data-basis="official">Official</span>
          <span data-basis="public">Public</span>
          <span data-basis="customer_stated">Customer input</span>
          <span data-basis="inferred">Inferred</span>
        </div>
      </header>

      <div className={styles.networkWorkspace}>
        <nav className={styles.networkStageList} aria-label="Supply network stages">
          {model.nodes.map((node, index) => (
            <button
              key={node.id}
              type="button"
              data-active={node.id === selectedNode?.id}
              data-basis={node.basis}
              aria-pressed={node.id === selectedNode?.id}
              onClick={() => selectNode(node)}
            >
              <span className={styles.stageIndex}>{String(index + 1).padStart(2, "0")}</span>
              <span>
                <small>{nodeKindLabel(node.kind)}</small>
                <strong>{node.label}</strong>
                <em>{node.location}</em>
              </span>
            </button>
          ))}
        </nav>

        <figure className={styles.mapPanel}>
          <div className={styles.mapCanvas}>
            <svg className={styles.mapSvg} viewBox={viewBox} role="img" aria-labelledby="supply-map-svg-title">
              <title id="supply-map-svg-title">Inferred supplier, operating-site, and customer network for {dashboardName(dashboard)}</title>
              <defs>
                <marker id="supply-route-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 7 3.5 L 0 7 z" className={styles.mapArrow} />
                </marker>
              </defs>
              <rect width="1000" height="500" className={styles.mapOcean} />
              <g className={styles.mapGrid}>
                {[125, 250, 375].map((y) => <path key={`lat-${y}`} d={`M 0 ${y} H 1000`} />)}
                {[200, 400, 600, 800].map((x) => <path key={`lng-${x}`} d={`M ${x} 0 V 500`} />)}
              </g>
              <g className={styles.mapLand}>{WORLD_MAP_LAND_PATHS.map((path, index) => <path key={`land-${index}`} d={path} />)}</g>
              <g className={styles.routePaths}>
                {model.edges.map((edge) => {
                  const from = nodesById.get(edge.fromNodeId);
                  const to = nodesById.get(edge.toNodeId);
                  const path = routePath(from?.coordinates ?? null, to?.coordinates ?? null);
                  const active = edge.fromNodeId === selectedNode?.id || edge.toNodeId === selectedNode?.id;
                  return path ? <path key={edge.id} d={path} data-basis={edge.basis} data-active={active} markerEnd="url(#supply-route-arrow)" /> : null;
                })}
              </g>
              <g>
                {model.nodes.map((node) => {
                  const position = project(node.coordinates);
                  if (!position) return null;
                  return (
                    <g
                      key={node.id}
                      className={styles.mapNode}
                      data-kind={node.kind}
                      data-basis={node.basis}
                      data-active={node.id === selectedNode?.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${node.label}, ${basisLabel(node.basis)}`}
                      onClick={() => selectNode(node)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectNode(node);
                        }
                      }}
                    >
                      <circle
                        cx={position.x}
                        cy={position.y}
                        r={(node.kind === "processing_site" ? 6.5 : 4.8) * mapGlyphScale}
                      />
                      {node.id === selectedNode?.id ? (
                        <text
                          x={position.x + (9 * mapGlyphScale)}
                          y={position.y - (7 * mapGlyphScale)}
                          style={{ fontSize: `${Math.max(1.5, 10 * mapGlyphScale)}px` }}
                        >
                          {node.kind === "processing_site" ? dashboardName(dashboard) : node.label}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
          <figcaption>Routes are operating hypotheses. Connect supplier, purchase-order, and shipment records to replace inferred links with observed movements.</figcaption>
        </figure>

        {selectedNode ? <NetworkInspector node={selectedNode} edges={model.edges} nodesById={nodesById} /> : null}
      </div>
    </section>
  );
}

function NetworkInspector({
  node,
  edges,
  nodesById,
}: {
  node: SupplyOptimizationNode;
  edges: SupplyOptimizationEdge[];
  nodesById: Map<string, SupplyOptimizationNode>;
}) {
  const related = edges.filter((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id);
  return (
    <aside className={styles.networkInspector} aria-live="polite">
      <div className={styles.inspectorStatus}>
        <span data-basis={node.basis}>{basisLabel(node.basis)}</span>
        <span>{confidenceLabel(node.confidence)}</span>
      </div>
      <span className={styles.eyebrow}>{nodeKindLabel(node.kind)}</span>
      <h3>{node.label}</h3>
      <p className={styles.inspectorLocation}>{node.location}</p>
      <p>{node.detail}</p>
      <dl>
        <div><dt>Likely cargo</dt><dd>{node.cargo}</dd></div>
        {related.slice(0, 2).map((edge) => {
          const otherId = edge.fromNodeId === node.id ? edge.toNodeId : edge.fromNodeId;
          const other = nodesById.get(otherId);
          return (
            <div key={edge.id}>
              <dt>{edge.stage === "inbound" ? "Inbound pattern" : "Outbound pattern"}</dt>
              <dd>{edge.mode}{other ? `, ${other.location}` : ""}</dd>
            </div>
          );
        })}
      </dl>
      {node.qualificationTargets.length ? (
        <div className={styles.qualificationTargets}>
          <span>{node.kind === "supplier_cluster" ? "Organizations to qualify" : "Buyer profiles to test"}</span>
          <ul>
            {node.qualificationTargets.map((target) => (
              <li key={target.name}>
                {target.url ? <a href={target.url} target="_blank" rel="noreferrer">{target.name}</a> : <strong>{target.name}</strong>}
                <small>{target.fit}</small>
              </li>
            ))}
          </ul>
          <p>Inferred candidates, not known relationships.</p>
        </div>
      ) : null}
      <div className={styles.confirmNext}>
        <span>Confirm next</span>
        <p>{node.confirmNext}</p>
      </div>
    </aside>
  );
}

function OptimizationQueue({
  dashboard,
  model,
}: {
  dashboard: SupplyCaseDashboard;
  model: SupplyOptimizationModel;
}) {
  return (
    <section className={styles.optimizationSection} aria-labelledby="optimization-title">
      <header className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Ordered by expected impact</span>
          <h2 id="optimization-title">Where Derya can improve the operation</h2>
        </div>
        <span>{model.actions.length} workstreams</span>
      </header>
      <div className={styles.optimizationList}>
        {model.actions.map((action) => {
          const workspace = model.workspaces.find((item) => item.id === action.workstreamId);
          return (
            <details key={action.id} className={styles.optimizationRow} open={action.priority === 1 ? true : undefined}>
              <summary>
                <span className={styles.actionPriority}>{String(action.priority).padStart(2, "0")}</span>
                <span className={styles.actionHeading}>
                  <small>{workspace?.shortLabel ?? action.workstreamId}</small>
                  <strong>{action.title}</strong>
                  <p>{action.currentCondition}</p>
                </span>
                <Icon name="chevron-down" size={15} />
              </summary>
              <div className={styles.actionDetail}>
                <div>
                  <span>Recommended change</span>
                  <p>{action.recommendation}</p>
                </div>
                <div>
                  <span>Decision to make</span>
                  <p>{action.decision}</p>
                </div>
                <div>
                  <span>Input required</span>
                  <p>{action.requiredInput}</p>
                </div>
                {workspace ? (
                  <Link className={styles.workspaceLink} href={{ pathname: workspace.route, query: { case: dashboard.id } }}>
                    Open {workspace.shortLabel} workspace <Icon name="arrow-right" size={14} />
                  </Link>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function KickoffStrip({ dashboard, model }: { dashboard: SupplyCaseDashboard; model: SupplyOptimizationModel }) {
  return (
    <section className={styles.kickoffStrip} aria-labelledby="kickoff-title">
      <div>
        <span className={styles.eyebrow}>Start the first pass</span>
        <h2 id="kickoff-title">Three inputs unlock the highest-priority work.</h2>
        <p>Derya can begin with incomplete data, then replace assumptions as supplier, order, and shipment evidence arrives.</p>
      </div>
      <ol>
        {model.actions.slice(0, 3).map((action) => <li key={action.id}>{action.requiredInput}</li>)}
      </ol>
      <a className={styles.primaryButton} href={`mailto:mert@usederya.com?subject=${encodeURIComponent(`${dashboardName(dashboard)} optimization kickoff`)}`}>
        Send the first file <Icon name="arrow-right" size={14} />
      </a>
    </section>
  );
}

function CompanyEvidence({
  research,
  model,
  dashboard,
}: {
  research?: SupplyCompanyResearch;
  model: SupplyOptimizationModel;
  dashboard: SupplyCaseDashboard;
}) {
  return (
    <section className={styles.evidenceSection} aria-labelledby="evidence-title">
      <header className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Traceability</span>
          <h2 id="evidence-title">Evidence and assumptions</h2>
        </div>
        <span>{research ? countLabel(research.evidence.length, "official source") : "Customer input only"}</span>
      </header>
      <div className={styles.evidenceGrid}>
        <details>
          <summary>Company facts used in this model <Icon name="chevron-down" size={14} /></summary>
          <div>
            <p>{research?.company.description.value ?? dashboard.companyDescription}</p>
            {research?.company.products.length ? <p><strong>Products:</strong> {research.company.products.map((item) => item.value).join(", ")}</p> : null}
            {research?.company.locations.length ? <p><strong>Known locations:</strong> {research.company.locations.map((item) => `${item.value} (${item.role})`).join(", ")}</p> : null}
            {research?.evidence.length ? (
              <ul>
                {research.evidence.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                    <span>Official</span>
                  </li>
                ))}
              </ul>
            ) : <p>No public research is attached. Add the official website to ground the company profile.</p>}
          </div>
        </details>
        <details>
          <summary>Likely customer profile <Icon name="chevron-down" size={14} /></summary>
          <div>
            <ul className={styles.plainList}>{model.customerSegments.map((segment) => <li key={segment}>{segment}</li>)}</ul>
          </div>
        </details>
        <details>
          <summary>Model assumptions <Icon name="chevron-down" size={14} /></summary>
          <div>
            <ul className={styles.plainList}>{model.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
          </div>
        </details>
      </div>
    </section>
  );
}
