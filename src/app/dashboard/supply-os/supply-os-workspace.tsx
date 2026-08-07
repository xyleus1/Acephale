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
import {
  buildSupplyOperatingPlan,
  type PlanningClaimStatus,
  type SupplyCostRange,
  type SupplyEvidenceRef,
  type SupplyMovementPlan,
} from "@/lib/supply-os-operating-plan";
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

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function planningStatusLabel(status: PlanningClaimStatus) {
  if (status === "modeled") return "Modeled";
  if (status === "connection_required") return "Connection required";
  return "Verify";
}

function movementLabel(movement: SupplyMovementPlan) {
  const source = movement.source?.label ?? movement.originGateway.label;
  const destination = movement.destination?.label ?? movement.receivingGateway?.label ?? "Destination to confirm";
  return `${source} to ${destination}`;
}

function formatUsdRange(cost: SupplyCostRange | null) {
  if (!cost) return "Range withheld";
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: cost.currency,
    maximumFractionDigits: 0,
  });
  return `${formatter.format(cost.low)} - ${formatter.format(cost.high)}`;
}

function ownerLabel(value: string) {
  return value.replaceAll("_", " ");
}

function isPublicSourceUrl(value: string) {
  return value.startsWith("https://") || value.startsWith("http://");
}

function EvidenceLinks({
  evidenceIds,
  evidenceRefs,
}: {
  evidenceIds: readonly string[];
  evidenceRefs: readonly SupplyEvidenceRef[];
}) {
  const sources = evidenceIds.flatMap((id) => {
    const source = evidenceRefs.find((item) => item.id === id);
    return source ? [source] : [];
  });
  if (!sources.length) return <span className={styles.sourceEmpty}>No source connected</span>;
  return (
    <span className={styles.sourceLinks}>
      {sources.map((source) => (
        <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
          {source.publisher}: {source.title}
        </a>
      ))}
    </span>
  );
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
              key={activeCase.id}
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
  const operatingPlan = useMemo(() => buildSupplyOperatingPlan(dashboard), [dashboard]);
  const [selectedMovementId, setSelectedMovementId] = useState(
    operatingPlan.movements[0]?.movementId ?? "",
  );
  const selectedMovement = operatingPlan.movements.find(
    (movement) => movement.movementId === selectedMovementId,
  ) ?? operatingPlan.movements[0] ?? null;

  function selectMovement(movement: SupplyMovementPlan) {
    setSelectedMovementId(movement.movementId);
    setSelectedNodeId(movement.source?.nodeId ?? movement.originGateway.nodeId);
  }

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
        <a href="#current-conditions">Current conditions</a>
        <a href="#port-customs-plan">Port and customs plan</a>
        <a href="#door-to-door-execution">Door-to-door execution</a>
        <a href="#supplier-search">Suppliers</a>
        <a href="#open-checks">Open checks</a>
      </nav>

      <section className={styles.summaryStrip} aria-label="Case inputs">
        <div><span>Located</span><strong>{dashboardLocation(dashboard)}</strong></div>
        <div><span>Needs to source</span><strong>{listOrConfirmation(dashboard.sourcingNeeds)}</strong></div>
        <div><span>Likely sources</span><strong>{listOrConfirmation(dashboard.sourceRegions)}</strong></div>
        <div><span>Ships to</span><strong>{listOrConfirmation(dashboard.destinations)}</strong></div>
      </section>

      <section className={styles.movementPanel} aria-labelledby="movement-selector-title">
        <header className={styles.movementHeader}>
          <div>
            <span className={styles.eyebrow}>Movement scope</span>
            <h2 id="movement-selector-title">Select one lane before reviewing the plan</h2>
          </div>
          <span className={styles.statusPill} data-status={operatingPlan.status}>
            {planningStatusLabel(operatingPlan.status)}
          </span>
        </header>
        {operatingPlan.movements.length ? (
          <div className={styles.movementSelector}>
            {operatingPlan.movements.map((movement, index) => (
              <button
                key={movement.movementId}
                type="button"
                className={styles.movementButton}
                data-active={movement.movementId === selectedMovement?.movementId}
                aria-pressed={movement.movementId === selectedMovement?.movementId}
                aria-controls="current-conditions"
                onClick={() => selectMovement(movement)}
              >
                <span>Movement {index + 1}</span>
                <strong>{movementLabel(movement)}</strong>
                <small>{ownerLabel(movement.scope)} · {movement.originGateway.label}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.planEmpty}>No complete movement could be derived. Confirm source, gateway, and destination geography first.</p>
        )}
        <dl className={styles.scenarioStrip}>
          <div><dt>Planning unit</dt><dd>{operatingPlan.scenario.equipment}</dd></div>
          <div><dt>Cargo profile</dt><dd>{operatingPlan.scenario.cargoProfile}</dd></div>
          <div><dt>Commercial term</dt><dd>{operatingPlan.scenario.commercialTerm}</dd></div>
          <div><dt>Pricing boundary</dt><dd>{operatingPlan.scenario.exclusions}</dd></div>
        </dl>
      </section>

      <CurrentConditions
        dashboard={dashboard}
        movement={selectedMovement}
        selectedNodeId={selectedNodeId}
        setSelectedNodeId={setSelectedNodeId}
      />
      <PortAndCustomsPlan movement={selectedMovement} connectors={operatingPlan.customsConnectors} />
      <DoorToDoorExecution movement={selectedMovement} />
      <SupplierSearch dashboard={dashboard} />
      <OpenChecks dashboard={dashboard} movement={selectedMovement} />
    </article>
  );
}

function CurrentConditions({
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
  return (
    <section
      id="current-conditions"
      className={styles.currentConditions}
      data-movement-id={movement?.movementId}
    >
      <header className={styles.sectionTitle}>
        <div><span className={styles.eyebrow}>Current conditions</span><h2>What must be checked for this movement</h2></div>
        <p>Every finding remains source-bound. No terminal, carrier, commodity, rate, or customs callback is connected.</p>
      </header>
      <div className={styles.primaryGrid}>
        <SupplyMap
          dashboard={dashboard}
          movement={movement}
          selectedNodeId={selectedNodeId}
          setSelectedNodeId={setSelectedNodeId}
        />
        <aside className={styles.routeBrief}>
          <header>
            <span className={styles.eyebrow}>Ranked gateway options</span>
            <h2>{movement ? movementLabel(movement) : "Movement geography needed"}</h2>
          </header>
          {movement?.portOptions.length ? (
            <div className={styles.portRankList}>
              {movement.portOptions.map((option) => (
                <article key={option.id} className={styles.portOption}>
                  <header>
                    <span>Rank {option.rank}</span>
                    <span className={styles.statusPill} data-status={option.status}>{planningStatusLabel(option.status)}</span>
                  </header>
                  <h3>{option.port}</h3>
                  <p>{option.bestFor}</p>
                  <dl>
                    <div><dt>Tradeoffs</dt><dd>{option.tradeoffs}</dd></div>
                    <div><dt>Inland plan</dt><dd>{option.inlandPlan}</dd></div>
                  </dl>
                  <div className={styles.compactChecks}>
                    <span>Check before selection</span>
                    <ul>{option.checksBeforeSelection.map((check) => <li key={check}>{check}</li>)}</ul>
                  </div>
                  <EvidenceLinks evidenceIds={option.evidenceRefIds} evidenceRefs={movement.evidenceRefs} />
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.planEmpty}>No import-port ranking applies to this movement, or the gateway geography is not complete enough to rank.</p>
          )}
        </aside>
      </div>

      <div className={styles.conditionGrid}>
        {movement?.intelligenceChecks.length ? movement.intelligenceChecks.map((check) => (
          <article key={check.id} className={styles.conditionCard} data-status={check.status}>
            <header>
              <span>{check.commodities.length ? check.commodities.join(", ") : "Movement check"}</span>
              <span className={styles.statusPill} data-status={check.status}>{planningStatusLabel(check.status)}</span>
            </header>
            <h3>{check.title}</h3>
            <p className={styles.conditionQuestion}>{check.question}</p>
            <dl>
              <div><dt>Current finding</dt><dd>{check.currentFinding}</dd></div>
              <div><dt>Why it changes the plan</dt><dd>{check.whyItChangesThePlan}</dd></div>
              <div><dt>Decision rule</dt><dd>{check.decisionRule}</dd></div>
              <div><dt>Freshness target</dt><dd>{check.freshnessTarget}</dd></div>
            </dl>
            <div className={styles.requirementLinks}>
              <span>Required sources</span>
              {check.sourceRequirements.length ? check.sourceRequirements.map((source) => {
                const content = <><strong>{source.label}</strong><small>{source.freshnessTarget}</small></>;
                return isPublicSourceUrl(source.url) ? (
                  <a key={`${check.id}-${source.id}`} href={source.url} target="_blank" rel="noreferrer">
                    {content}
                  </a>
                ) : (
                  <span key={`${check.id}-${source.id}`} className={styles.requirementRecord}>
                    {content}
                  </span>
                );
              }) : <span className={styles.sourceEmpty}>No authoritative feed selected yet</span>}
            </div>
          </article>
        )) : (
          <p className={styles.planEmpty}>Select a derived movement to review prompt-specific intelligence checks.</p>
        )}
      </div>
    </section>
  );
}

function PortAndCustomsPlan({
  movement,
  connectors,
}: {
  movement: SupplyMovementPlan | null;
  connectors: ReturnType<typeof buildSupplyOperatingPlan>["customsConnectors"];
}) {
  const plan = movement?.customsPlan ?? null;
  const movementConnectors = plan
    ? connectors.filter((connector) => plan.connectorIds.includes(connector.id))
    : [];
  return (
    <section
      id="port-customs-plan"
      className={styles.dataSection}
      data-movement-id={movement?.movementId}
    >
      <header className={styles.sectionTitle}>
        <div><span className={styles.eyebrow}>Port and customs plan</span><h2>Broker-controlled entry workflow</h2></div>
        <p>{plan?.note ?? "Select a movement to resolve the customs boundary."}</p>
      </header>
      {plan ? (
        <>
          <dl className={styles.planFacts}>
            <div><dt>Import required</dt><dd>{plan.importRequired === null ? "Confirm" : plan.importRequired ? "Yes" : "No"}</dd></div>
            <div><dt>Entry gateway</dt><dd>{plan.recommendedEntryGateway ?? "Not applicable or not resolved"}</dd></div>
            <div><dt>Status</dt><dd>{planningStatusLabel(plan.status)}</dd></div>
          </dl>
          <div className={styles.customsPlanGrid}>
            <div className={styles.planColumn}>
              <h3>Customs workflow</h3>
              {plan.workflow.length ? (
                <ol className={styles.workflowList}>
                  {plan.workflow.map((step) => (
                    <li key={`${movement?.movementId}-${step.sequence}`}>
                      <span className={styles.sequenceNumber}>{step.sequence}</span>
                      <div>
                        <header><strong>{step.title}</strong><span className={styles.statusPill} data-status={step.status}>{planningStatusLabel(step.status)}</span></header>
                        <p>{step.gate}</p>
                        <dl><div><dt>Owner</dt><dd>{ownerLabel(step.owner)}</dd></div><div><dt>Output</dt><dd>{step.output}</dd></div></dl>
                        <EvidenceLinks evidenceIds={step.evidenceRefIds} evidenceRefs={movement?.evidenceRefs ?? []} />
                      </div>
                    </li>
                  ))}
                </ol>
              ) : <p className={styles.planEmpty}>No import filing workflow is modeled for this movement. Confirm the customs territory before relying on that assumption.</p>}
            </div>
            <div className={styles.planColumn}>
              <h3>Commercial invoice guidance</h3>
              {plan.invoiceGuidance.length ? (
                <div className={styles.guidanceList}>
                  {plan.invoiceGuidance.map((item) => (
                    <article key={item.id}>
                      <header><strong>{item.field}</strong><span className={styles.statusPill} data-status={item.status}>{planningStatusLabel(item.status)}</span></header>
                      <p>{item.instruction}</p>
                      <small>{item.validation}</small>
                      <EvidenceLinks evidenceIds={item.evidenceRefIds} evidenceRefs={movement?.evidenceRefs ?? []} />
                    </article>
                  ))}
                </div>
              ) : <p className={styles.planEmpty}>Commercial invoice guidance appears when an import movement is resolved.</p>}

              <h3>Broker options to qualify</h3>
              {plan.brokerOptions.length ? (
                <div className={styles.brokerList}>
                  {plan.brokerOptions.map((broker) => (
                    <article key={broker.id}>
                      <header><a href={broker.url} target="_blank" rel="noreferrer">{broker.firm}</a><span className={styles.statusPill} data-status={broker.status}>{planningStatusLabel(broker.status)}</span></header>
                      <strong>{broker.service}</strong>
                      <p>{broker.selectionReason}</p>
                      <ul>{broker.qualificationChecks.map((check) => <li key={check}>{check}</li>)}</ul>
                    </article>
                  ))}
                </div>
              ) : <p className={styles.planEmpty}>No broker is implied for a non-import movement. Verify the destination customs boundary.</p>}
            </div>
          </div>
          <div className={styles.connectorSection}>
            <header>
              <div><span className={styles.eyebrow}>Connector readiness</span><h3>Official integration paths, not active connections</h3></div>
              <p>Each connector needs commercial entitlement, jurisdiction checks, and an approval-safe implementation.</p>
            </header>
            {movementConnectors.length ? (
              <div className={styles.connectorGrid}>
                {movementConnectors.map((connector) => (
                  <article key={connector.id}>
                    <header><a href={connector.url} target="_blank" rel="noreferrer">{connector.name}</a><span className={styles.statusPill} data-status={connector.status}>{planningStatusLabel(connector.status)}</span></header>
                    <span>{ownerLabel(connector.category)}</span>
                    <p>{connector.useInDerya}</p>
                    <dl><div><dt>Integration</dt><dd>{connector.integrationMode}</dd></div><div><dt>Boundary</dt><dd>{connector.approvalBoundary}</dd></div></dl>
                  </article>
                ))}
              </div>
            ) : <p className={styles.planEmpty}>No customs connector is assigned to this movement.</p>}
          </div>
        </>
      ) : <p className={styles.planEmpty}>No movement is selected.</p>}
    </section>
  );
}

function DoorToDoorExecution({ movement }: { movement: SupplyMovementPlan | null }) {
  const execution = movement?.executionPlan ?? null;
  return (
    <section
      id="door-to-door-execution"
      className={styles.dataSection}
      data-movement-id={movement?.movementId}
    >
      <header className={styles.sectionTitle}>
        <div><span className={styles.eyebrow}>Door-to-door execution</span><h2>Ordered service and provider plan</h2></div>
        <p>Amounts are deterministic demo fixtures. They are not provider rates, capacity, bookings, or delivered-duty quotes.</p>
      </header>
      {execution?.legs.length ? (
        <>
          <div className={styles.tableWrap} role="region" aria-labelledby="execution-plan-title" tabIndex={0}>
            <table className={`${styles.dataTable} ${styles.executionTable}`}>
              <caption id="execution-plan-title" className={styles.srOnly}>Movement-specific execution legs</caption>
              <thead><tr><th>Seq.</th><th>Service leg</th><th>Route and instruction</th><th>Provider candidates</th><th>Transit assumption</th><th>Modeled USD range</th><th>Status</th></tr></thead>
              <tbody>
                {execution.legs.map((leg) => (
                  <tr key={`${movement?.movementId}-${leg.id}`}>
                    <td className={styles.numeric} data-label="Sequence">{leg.sequence}</td>
                    <td data-label="Service leg"><strong>{ownerLabel(leg.type)}</strong><small>{leg.mode}</small></td>
                    <td data-label="Route and instruction"><strong>{leg.from} to {leg.to}</strong><small>{leg.instruction}</small><small>Quote inputs: {leg.quoteInputs.join(", ")}</small><small>Handoff: {leg.handoff}</small></td>
                    <td data-label="Provider candidates">
                      <span className={styles.providerStack}>
                        {leg.providers.length ? leg.providers.map((provider) => (
                          <span key={provider.id}>
                            {isPublicSourceUrl(provider.url) ? (
                              <a href={provider.url} target="_blank" rel="noreferrer">{provider.provider}</a>
                            ) : (
                              <strong>{provider.provider}</strong>
                            )}
                            <small>{provider.service}</small>
                            <small>Request: {provider.request}</small>
                            <small>Verify: {provider.verification}</small>
                          </span>
                        )) : <small>Provider selection required</small>}
                      </span>
                    </td>
                    <td data-label="Transit assumption">{leg.transitAssumption}</td>
                    <td className={styles.numeric} data-label="Modeled USD range"><strong>{formatUsdRange(leg.costRange)}</strong><small>{leg.costRange?.basis ?? "Inputs required before modeling"}</small></td>
                    <td data-label="Status"><span className={styles.statusPill} data-status={leg.status}>{planningStatusLabel(leg.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.executionSummary}>
            <div><span>Total planning range</span><strong>{formatUsdRange(execution.total)}</strong><small>{execution.totalLabel}</small></div>
            <div><span>Scenario</span><strong>{execution.scenario?.equipment ?? "Scenario withheld"}</strong><small>{execution.scenario?.cargoProfile ?? "Resolve route geography and cargo profile"}</small></div>
            <div><span>Commercial term</span><strong>{execution.scenario?.commercialTerm ?? "Confirm"}</strong><small>{execution.scenario?.quantityBasis ?? "Quantity basis needed"}</small></div>
            <div><span>Excluded</span><strong>Not in total</strong><small>{execution.total?.exclusions.join(", ") ?? "No numeric total is available"}</small></div>
          </div>
        </>
      ) : <p className={styles.planEmpty}>The movement does not have enough resolved geography for an ordered numeric execution plan.</p>}

      <div className={styles.blockerSection}>
        <header><div><span className={styles.eyebrow}>Quote blockers</span><h3>Inputs required before a real quote request</h3></div><span>{movement?.quoteBlockers.length ?? 0} open</span></header>
        {movement?.quoteBlockers.length ? (
          <div className={styles.blockerGrid}>
            {movement.quoteBlockers.map((blocker) => (
              <article key={blocker.id}>
                <header><strong>{blocker.field}</strong><span className={styles.statusPill} data-status={blocker.status}>{planningStatusLabel(blocker.status)}</span></header>
                <p>{blocker.reason}</p>
                <small>Owner: {ownerLabel(blocker.owner)}</small>
              </article>
            ))}
          </div>
        ) : <p className={styles.planEmpty}>No movement-specific quote blockers are available.</p>}
      </div>
    </section>
  );
}

function SupplierSearch({ dashboard }: { dashboard: SupplyCaseDashboard }) {
  return (
    <section id="supplier-search" className={styles.dataSection}>
      <header className={styles.sectionTitle}>
        <div><span className={styles.eyebrow}>Suppliers</span><h2 id="supplier-search-title">Supplier search briefs</h2></div>
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
  );
}

function OpenChecks({ dashboard, movement }: { dashboard: SupplyCaseDashboard; movement: SupplyMovementPlan | null }) {
  return (
    <section id="open-checks" className={styles.dataSection} data-movement-id={movement?.movementId}>
      <header className={styles.sectionTitle}>
        <div><span className={styles.eyebrow}>Open checks</span><h2>Case risks and missing inputs</h2></div>
        <p>These checks remain unresolved even when a movement plan can be modeled.</p>
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
          <h3>Case readiness</h3>
          {dashboard.customsChecks.map((check) => (
            <article key={check.id} className={styles.customsRow}>
              <div><i data-status={check.status} /><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>
              <p>{check.needed.join(", ")}</p>
              <span className={styles.statusPill} data-status={check.status}>{statusLabel(check.status)}</span>
            </article>
          ))}
          {dashboard.openQuestions.length ? (
            <div className={styles.openQuestionBlock}>
              <span className={styles.eyebrow}>Questions from the prompt</span>
              <ul className={styles.questionList}>{dashboard.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
            </div>
          ) : null}
        </div>
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
  const nodesById = useMemo(
    () => new Map(dashboard.routeNodes.map((node) => [node.id, node])),
    [dashboard.routeNodes],
  );
  const activeSegmentIds = new Set(movement?.pathSegmentIds ?? []);
  const activeNodeIds = new Set([
    movement?.source?.nodeId,
    movement?.originGateway.nodeId,
    movement?.receivingGateway?.nodeId,
    movement?.customsNode?.nodeId,
    movement?.destination?.nodeId,
  ].flatMap((id) => id ? [id] : []));
  const signalNodeIds = new Set(movement?.intelligenceChecks.flatMap((check) => check.relatedNodeIds) ?? []);

  return (
    <figure className={styles.mapPanel} aria-labelledby="supply-map-title">
      <header className={styles.panelHeader}>
        <div><span className={styles.eyebrow}>Route</span><h2 id="supply-map-title">Supply map</h2></div>
        <span>{movement ? `${movement.pathSegmentIds.length} selected path segments` : "Movement selection required"}</span>
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
              return path ? <path key={segment.id} d={path} data-active={!movement || activeSegmentIds.has(segment.id)} /> : null;
            })}
          </g>
          <g>
            {dashboard.routeNodes.map((node) => {
              const point = project(node.lat, node.lng);
              if (!point) return null;
              const isSelected = selectedNode?.id === node.id;
              const hasSignal = signalNodeIds.has(node.id);
              return (
                <g
                  key={node.id}
                  className={styles.mapNode}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect ${node.label}`}
                  data-kind={node.kind}
                  data-status={node.status}
                  data-selected={isSelected}
                  data-active={!movement || activeNodeIds.has(node.id)}
                  data-signal={hasSignal}
                  onClick={() => setSelectedNodeId(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedNodeId(node.id);
                    }
                  }}
                >
                  <circle className={styles.mapNodeHitArea} cx={point.x} cy={point.y} r={22} />
                  {hasSignal ? <circle className={styles.mapSignalRing} cx={point.x} cy={point.y} r={isSelected ? 12 : 10} /> : null}
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
          <span><i data-kind="signal" /> Check required</span>
        </div>
      </div>
      <figcaption>Natural Earth geography. The selected movement is emphasized; routes, signals, and checkpoints are modeled and are not live tracking.</figcaption>
    </figure>
  );
}
