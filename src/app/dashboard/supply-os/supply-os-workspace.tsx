"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { WORLD_MAP_LAND_PATHS, WORLD_MAP_VIEWBOX } from "@/lib/market-intelligence/world-map-asset";
import {
  SAMPLE_SUPPLY_CASE_PROMPT,
  SUPPLY_CASE_STORAGE_KEY,
  generateSupplyCase,
  parseStoredSupplyCases,
  resolveSelectedSupplyCase,
  serializeSupplyCases,
  upsertSupplyCase,
  type SupplyCaseDashboard,
  type SupplyCaseStatus,
  type SupplyRouteNode,
} from "@/lib/supply-os-case-model";
import styles from "./supply-os-workspace.module.css";

type ComposerState = "idle" | "ready" | "error" | "saved";

function statusLabel(status: SupplyCaseStatus) {
  if (status === "ready") return "Ready";
  if (status === "verify") return "Verify";
  return "Need information";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function dashboardName(dashboard: SupplyCaseDashboard) {
  return dashboard.companyName ?? "Unnamed customer";
}

function dashboardLocation(dashboard: SupplyCaseDashboard) {
  return dashboard.companyLocation ?? "Location needed";
}

function listOrConfirmation(values: readonly string[]) {
  return values.length ? values.join(", ") : "Needs confirmation";
}

function readBrowserStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeBrowserStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeBrowserStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // The dashboard still works when browser storage is unavailable.
  }
}

function initialRouteNodeId(dashboard: SupplyCaseDashboard) {
  return dashboard.routeNodes.find((node) => node.kind === "source")?.id
    ?? dashboard.routeNodes.find((node) => node.kind === "receiving_gateway")?.id
    ?? dashboard.routeNodes[0]?.id
    ?? null;
}

function primaryRouteSequence(dashboard: SupplyCaseDashboard) {
  const nodesById = new Map(dashboard.routeNodes.map((node) => [node.id, node]));
  const firstSegmentByNode = new Map<string, SupplyCaseDashboard["routeSegments"][number]>();
  for (const segment of dashboard.routeSegments) {
    if (!firstSegmentByNode.has(segment.fromNodeId)) firstSegmentByNode.set(segment.fromNodeId, segment);
  }

  const sequence: SupplyRouteNode[] = [];
  const visited = new Set<string>();
  let current = dashboard.routeNodes.find((node) => node.kind === "source") ?? null;
  while (current && !visited.has(current.id) && sequence.length < 7) {
    sequence.push(current);
    visited.add(current.id);
    const nextId = firstSegmentByNode.get(current.id)?.toNodeId;
    current = nextId ? nodesById.get(nextId) ?? null : null;
  }
  return sequence;
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function project(lat: number | null, lng: number | null) {
  if (lat === null || lng === null) return null;
  return {
    x: ((lng + 180) / 360) * 1000,
    y: ((90 - lat) / 180) * 500,
  };
}

function routePath(from: SupplyRouteNode, to: SupplyRouteNode) {
  const start = project(from.lat, from.lng);
  const end = project(to.lat, to.lng);
  if (!start || !end) return null;
  const directDistance = Math.abs(end.x - start.x);
  const wrappedEndX = directDistance > 500
    ? end.x + (start.x > end.x ? 1000 : -1000)
    : end.x;
  const distance = Math.abs(wrappedEndX - start.x);
  const lift = Math.min(88, Math.max(24, distance * 0.14));
  const middleX = (start.x + wrappedEndX) / 2;
  const middleY = Math.max(28, Math.min(start.y, end.y) - lift);
  if (directDistance <= 500) {
    return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${middleX.toFixed(1)} ${middleY.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  }

  const boundaryX = wrappedEndX > 1000 ? 1000 : 0;
  const t = (boundaryX - start.x) / (wrappedEndX - start.x);
  const firstControl = {
    x: start.x + (middleX - start.x) * t,
    y: start.y + (middleY - start.y) * t,
  };
  const secondControl = {
    x: middleX + (wrappedEndX - middleX) * t,
    y: middleY + (end.y - middleY) * t,
  };
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

export function SupplyOsWorkspace({ storageScope }: { storageScope: string }) {
  const storageKey = `${SUPPLY_CASE_STORAGE_KEY}:${storageScope}`;
  const selectedStorageKey = `${storageKey}:selected`;
  const [prompt, setPrompt] = useState("");
  const [activeCase, setActiveCase] = useState<SupplyCaseDashboard | null>(null);
  const [savedCases, setSavedCases] = useState<SupplyCaseDashboard[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [composerState, setComposerState] = useState<ComposerState>("idle");
  const [composerMessage, setComposerMessage] = useState("Describe a company to begin.");
  const [storageReady, setStorageReady] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const visibleSavedCases = useMemo(
    () => savedCases
      .filter((item) => !item.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [savedCases],
  );
  const canSave = Boolean(activeCase && prompt.trim() === activeCase.sourcePrompt);

  useEffect(() => {
    function hydrateFromStorage() {
      const stored = parseStoredSupplyCases(readBrowserStorage(storageKey));
      const selectedId = readBrowserStorage(selectedStorageKey);
      const selected = resolveSelectedSupplyCase(stored, selectedId);
      setSavedCases(stored);
      if (selected) {
        setActiveCase(selected);
        setPrompt(selected.sourcePrompt);
        setSelectedNodeId(initialRouteNodeId(selected));
        setComposerState("saved");
        setComposerMessage(`Opened ${dashboardName(selected)}.`);
      } else {
        setActiveCase(null);
        setPrompt("");
        setSelectedNodeId(null);
        setComposerState("idle");
        setComposerMessage("Describe a company to begin.");
      }
      setStorageReady(true);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== storageKey) return;
      setSavedCases(parseStoredSupplyCases(event.newValue));
    }

    removeBrowserStorage(SUPPLY_CASE_STORAGE_KEY);
    removeBrowserStorage(`${SUPPLY_CASE_STORAGE_KEY}:selected`);
    hydrateFromStorage();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [selectedStorageKey, storageKey]);

  function scrollToResults() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }));
    });
  }

  function buildDashboard() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setComposerState("error");
      setComposerMessage("Add the company, location, sourcing needs, or destination first.");
      return;
    }

    const nextCase = generateSupplyCase(normalizedPrompt, new Date());
    setActiveCase(nextCase);
    setPrompt(nextCase.sourcePrompt);
    setSelectedNodeId(initialRouteNodeId(nextCase));
    setComposerState("ready");
    setComposerMessage(`Dashboard built for ${dashboardName(nextCase)}. Review the open checks before using it.`);
    removeBrowserStorage(selectedStorageKey);
    scrollToResults();
  }

  function saveDashboard() {
    if (!activeCase || prompt.trim() !== activeCase.sourcePrompt) {
      setComposerState("error");
      setComposerMessage("Build the edited prompt before saving this dashboard.");
      return;
    }
    const storedCases = parseStoredSupplyCases(readBrowserStorage(storageKey));
    const nextCases = upsertSupplyCase(storedCases, activeCase);
    const didSave = writeBrowserStorage(storageKey, serializeSupplyCases(nextCases));
    if (!didSave) {
      setComposerState("error");
      setComposerMessage("Browser storage is unavailable. The dashboard remains open but was not saved.");
      return;
    }
    writeBrowserStorage(selectedStorageKey, activeCase.id);
    setSavedCases(nextCases);
    setComposerState("saved");
    setComposerMessage(`${dashboardName(activeCase)} is saved in this browser.`);
  }

  function openDashboard(item: SupplyCaseDashboard) {
    setActiveCase(item);
    setPrompt(item.sourcePrompt);
    setSelectedNodeId(initialRouteNodeId(item));
    setComposerState("saved");
    setComposerMessage(`Opened ${dashboardName(item)}.`);
    writeBrowserStorage(selectedStorageKey, item.id);
    scrollToResults();
  }

  function startNewCase() {
    setPrompt("");
    setActiveCase(null);
    setSelectedNodeId(null);
    setComposerState("idle");
    setComposerMessage("Describe a company to begin.");
    removeBrowserStorage(selectedStorageKey);
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
  }

  return (
    <div className={`${styles.workspace} supply-os-workspace`}>
      <header className={styles.topBar}>
        <div className={styles.brandBlock}>
          <h1>Supply OS</h1>
          {activeCase ? <span>{dashboardName(activeCase)}</span> : <span>New customer case</span>}
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.secondaryButton} onClick={startNewCase}>
            <Icon name="plus" size={14} /> New case
          </button>
          <button type="button" className={styles.primaryButton} onClick={saveDashboard} disabled={!canSave}>
            <Icon name="file-check" size={14} /> Save dashboard
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.caseBuilder} aria-labelledby="case-builder-title">
          <div className={styles.builderHeader}>
            <div>
              <span className={styles.eyebrow}>Build a customer case</span>
              <h2 id="case-builder-title">What should Derya map?</h2>
            </div>
            <span className={styles.demoTag}>Demo data</span>
          </div>

          <label className={styles.composerLabel} htmlFor="supply-case-prompt">
            Company, location, sourcing needs, likely source regions, and shipping destinations
          </label>
          <textarea
            id="supply-case-prompt"
            className={styles.composer}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setComposerState("idle");
              setComposerMessage("Ready to build a new dashboard.");
            }}
            rows={5}
            placeholder="Example: Atlas Robotics builds warehouse robots in Austin. It needs motors, LiDAR, batteries, and aluminum enclosures from China and Malaysia, then ships finished systems across the US and Germany."
          />

          <div className={styles.composerFooter}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setPrompt(SAMPLE_SUPPLY_CASE_PROMPT);
                setComposerState("idle");
                setComposerMessage("Example loaded. Build the dashboard when ready.");
              }}
            >
              Use example
            </button>
            <span className={styles.composerHint}>Incomplete details stay marked for confirmation.</span>
            <button type="button" className={styles.primaryButton} onClick={buildDashboard}>
              Build dashboard <Icon name="arrow-right" size={14} />
            </button>
          </div>
          <p className={styles.statusLine} data-state={composerState} aria-live="polite">{composerMessage}</p>
        </section>

        <section className={styles.savedSection} aria-labelledby="saved-cases-title">
          <header className={styles.sectionHeading}>
            <div>
              <h2 id="saved-cases-title">Customer dashboards</h2>
              <span>{storageReady ? `${visibleSavedCases.length} saved in this browser` : "Loading saved dashboards"}</span>
            </div>
          </header>
          {visibleSavedCases.length ? (
            <div className={styles.savedGrid}>
              {visibleSavedCases.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.savedCard}
                  data-active={item.id === activeCase?.id}
                  aria-pressed={item.id === activeCase?.id}
                  onClick={() => openDashboard(item)}
                >
                  <span><strong>{dashboardName(item)}</strong><small>{dashboardLocation(item)}</small></span>
                  <span><strong>{item.summary.primaryLane}</strong><small>{item.summary.openCheckCount} open checks</small></span>
                  <time>{formatTimestamp(item.updatedAt)}</time>
                  <Icon name="chevron-right" size={14} />
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.savedEmpty}>Save a generated case to reopen it here.</p>
          )}
        </section>

        <div ref={resultsRef} className={styles.resultsAnchor}>
          {activeCase ? (
            <CaseDashboard
              dashboard={activeCase}
              selectedNodeId={selectedNodeId}
              setSelectedNodeId={setSelectedNodeId}
            />
          ) : (
            <section className={styles.emptyResult}>
              <Icon name="layers" size={20} />
              <div>
                <h2>No case built yet</h2>
                <p>Describe the customer above. Derya will map the likely supply route, shipping options, customs checks, and risks.</p>
              </div>
            </section>
          )}
        </div>
      </main>

      <footer className={styles.workspaceFooter}>
        <p>Supplier profiles, rates, transit times, risks, and customs checks are indicative. Verify them before execution.</p>
      </footer>
    </div>
  );
}

function CaseDashboard({
  dashboard,
  selectedNodeId,
  setSelectedNodeId,
}: {
  dashboard: SupplyCaseDashboard;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string) => void;
}) {
  const primaryRouteNodes = primaryRouteSequence(dashboard);

  return (
    <article className={styles.caseDashboard} aria-labelledby="active-case-title">
      <header className={styles.caseHeader}>
        <div className={styles.caseIdentity}>
          <span className={styles.eyebrow}>{dashboardLocation(dashboard)}</span>
          <h2 id="active-case-title">{dashboardName(dashboard)}</h2>
          <p>{dashboard.overview}</p>
        </div>
        <dl className={styles.caseHeaderMeta}>
          <div><dt>Primary lane</dt><dd>{dashboard.summary.primaryLane}</dd></div>
          <div><dt>Open checks</dt><dd>{dashboard.summary.openCheckCount}</dd></div>
          <div><dt>Updated</dt><dd>{formatTimestamp(dashboard.updatedAt)}</dd></div>
        </dl>
      </header>

      <nav className={styles.caseNav} aria-label={`${dashboardName(dashboard)} dashboard sections`}>
        <a href="#supply-route">Route</a>
        <a href="#supplier-search">Suppliers</a>
        <a href="#shipping-options">Shipping</a>
        <a href="#customs-risks">Customs and risks</a>
      </nav>

      <section className={styles.summaryStrip} aria-label="Case inputs">
        <div><span>Located</span><strong>{dashboardLocation(dashboard)}</strong></div>
        <div><span>Needs to source</span><strong>{listOrConfirmation(dashboard.sourcingNeeds)}</strong></div>
        <div><span>Likely sources</span><strong>{listOrConfirmation(dashboard.sourceRegions)}</strong></div>
        <div><span>Ships to</span><strong>{listOrConfirmation(dashboard.destinations)}</strong></div>
      </section>

      <section id="supply-route" className={styles.primaryGrid}>
        <SupplyMap
          dashboard={dashboard}
          selectedNodeId={selectedNodeId}
          setSelectedNodeId={setSelectedNodeId}
        />
        <aside className={styles.routeBrief}>
          <header>
            <span className={styles.eyebrow}>Recommended first move</span>
            <h2>{dashboard.summary.recommendedAction}</h2>
          </header>
          <div className={styles.briefBlock}>
            <span>Supply pattern</span>
            <p>{dashboard.summary.supplyPattern}</p>
          </div>
          <div className={styles.briefBlock}>
            <span>Route sequence</span>
            <ol>
              {primaryRouteNodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    aria-pressed={selectedNodeId === node.id}
                    aria-controls="supply-map-node-inspector"
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    <i data-status={node.status} />
                    <span><strong>{node.label}</strong><small>{node.detail}</small></span>
                    <span className={styles.srOnly}>{statusLabel(node.status)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className={styles.briefBlock}>
            <span>Questions to close</span>
            <ul className={styles.questionList}>
              {dashboard.openQuestions.map((question) => <li key={question}>{question}</li>)}
            </ul>
          </div>
        </aside>
      </section>

      <section id="supplier-search" className={styles.dataSection}>
        <header className={styles.sectionTitle}>
          <div><span className={styles.eyebrow}>Sourcing</span><h2 id="supplier-search-title">Supplier search briefs</h2></div>
          <p>Profiles to validate, not claimed supplier relationships.</p>
        </header>
        <div className={styles.tableWrap} role="region" aria-labelledby="supplier-search-title" tabIndex={0}>
          <table className={styles.dataTable}>
            <thead><tr><th>Search profile</th><th>Region</th><th>Capability</th><th>Why it fits</th><th>Lead time</th><th>Status</th></tr></thead>
            <tbody>
              {dashboard.supplierOptions.map((option) => (
                <tr key={option.id}>
                  <td><strong>{option.title}</strong><small>{option.basis}</small></td>
                  <td>{option.region}</td>
                  <td>{option.capability}</td>
                  <td>{option.fitReason}</td>
                  <td>{option.leadTime}</td>
                  <td><span className={styles.statusPill} data-status={option.status}>{statusLabel(option.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="shipping-options" className={styles.dataSection}>
        <header className={styles.sectionTitle}>
          <div><span className={styles.eyebrow}>Freight</span><h2 id="shipping-options-title">Indicative shipping options</h2></div>
          <p>Modeled for comparison. No provider response or booking is connected.</p>
        </header>
        <div className={styles.tableWrap} role="region" aria-labelledby="shipping-options-title" tabIndex={0}>
          <table className={styles.dataTable}>
            <thead><tr><th>Provider</th><th>Service</th><th>Route</th><th>Transit</th><th>Indicative cost</th><th>Reliability</th><th>Best for</th><th>Status</th></tr></thead>
            <tbody>
              {dashboard.shippingOptions.map((option) => (
                <tr key={option.id}>
                  <td><strong>{option.provider}</strong><small>{option.basis}</small></td>
                  <td>{option.service}<small>{option.mode}</small></td>
                  <td>{option.route}</td>
                  <td>{option.transit}</td>
                  <td className={styles.numeric}>{option.indicativeCost}</td>
                  <td>{option.reliability}</td>
                  <td>{option.bestFor}</td>
                  <td><span className={styles.statusPill} data-status={option.status}>{statusLabel(option.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="customs-risks" className={styles.dataSection}>
        <header className={styles.sectionTitle}>
          <div><span className={styles.eyebrow}>Review</span><h2>Customs and risk checks</h2></div>
          <p>Items to confirm before requesting quotes or moving goods.</p>
        </header>
        <div className={styles.riskGrid}>
          <div className={styles.riskList}>
            <h3>Operating risks</h3>
            {dashboard.risks.map((risk) => (
              <article key={risk.id} className={styles.riskRow} data-severity={risk.severity}>
                <div><span>{risk.category}</span><strong>{risk.title}</strong></div>
                <p>{risk.why}</p>
                <dl><div><dt>Check</dt><dd>{risk.check}</dd></div></dl>
                <span className={styles.statusPill} data-status={risk.status}>{statusLabel(risk.status)}</span>
              </article>
            ))}
          </div>
          <div className={styles.customsList}>
            <h3>Customs readiness</h3>
            {dashboard.customsChecks.map((check) => (
              <article key={check.id} className={styles.customsRow}>
                <div><i data-status={check.status} /><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>
                <p>{check.needed.join(", ")}</p>
                <span className={styles.statusPill} data-status={check.status}>{statusLabel(check.status)}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </article>
  );
}

function SupplyMap({
  dashboard,
  selectedNodeId,
  setSelectedNodeId,
}: {
  dashboard: SupplyCaseDashboard;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string) => void;
}) {
  const selectedNode = dashboard.routeNodes.find((node) => node.id === selectedNodeId) ?? dashboard.routeNodes[0];
  const nodesById = useMemo(
    () => new Map(dashboard.routeNodes.map((node) => [node.id, node])),
    [dashboard.routeNodes],
  );

  return (
    <figure className={styles.mapPanel} aria-labelledby="supply-map-title">
      <header className={styles.panelHeader}>
        <div><span className={styles.eyebrow}>Route</span><h2 id="supply-map-title">Supply map</h2></div>
        <span>{dashboard.routeSegments.length} modeled legs</span>
      </header>
      <div className={styles.mapCanvas}>
        <svg className={styles.mapSvg} viewBox={WORLD_MAP_VIEWBOX} role="img" aria-labelledby="supply-map-svg-title">
          <title id="supply-map-svg-title">Modeled supply route for {dashboardName(dashboard)}</title>
          <rect width="1000" height="500" className={styles.mapOcean} />
          <g className={styles.mapGrid}>
            {[125, 250, 375].map((y) => <path key={`lat-${y}`} d={`M 0 ${y} H 1000`} />)}
            {[200, 400, 600, 800].map((x) => <path key={`lng-${x}`} d={`M ${x} 0 V 500`} />)}
          </g>
          <g className={styles.mapLand}>
            {WORLD_MAP_LAND_PATHS.map((path, index) => <path key={`land-${index}`} d={path} />)}
          </g>
          <g className={styles.routePaths}>
            {dashboard.routeSegments.map((segment) => {
              const from = nodesById.get(segment.fromNodeId);
              const to = nodesById.get(segment.toNodeId);
              if (!from || !to) return null;
              const path = routePath(from, to);
              return path ? <path key={segment.id} d={path} /> : null;
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
                  data-kind={node.kind}
                  data-status={node.status}
                  data-selected={isSelected}
                >
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
          <div id="supply-map-node-inspector" className={styles.nodeInspector} aria-live="polite">
            <span>{selectedNode.kind.replaceAll("_", " ")}</span>
            <strong>{selectedNode.label}</strong>
            <p>{selectedNode.detail}</p>
            <small>{statusLabel(selectedNode.status)}</small>
          </div>
        ) : null}
        <div className={styles.mapLegend} aria-label="Map legend">
          <span><i data-kind="source" /> Supplier</span>
          <span><i data-kind="origin_gateway" /> Gateway</span>
          <span><i data-kind="customs" /> Customs</span>
          <span><i data-kind="destination" /> Destination</span>
        </div>
      </div>
      <figcaption>Natural Earth geography. Routes and checkpoints are generated for this demo and are not live tracking.</figcaption>
    </figure>
  );
}
