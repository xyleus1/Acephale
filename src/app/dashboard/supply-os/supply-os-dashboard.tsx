"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowRight,
  Boxes,
  Check,
  ChevronDown,
  ExternalLink,
  Factory,
  ListChecks,
  MapPin,
  Phone,
  ShieldAlert,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ResponsiveContainer,
  Sankey,
  Tooltip as ChartTooltip,
} from "recharts";
import {
  generateSupplyCase,
  SAMPLE_SUPPLY_CASE_PROMPT,
  upsertSupplyCase,
  type SupplyCaseDashboard,
  type SupplyEngagementScope,
} from "@/lib/supply-os-case-model";
import {
  buildSupplyCommandMap,
  type SupplyCommandObject,
  type SupplyCommandRoute,
} from "@/lib/supply-os-command-map";
import { SUPPLY_ENGAGEMENT_OPTIONS } from "@/lib/supply-os-engagement-plan";
import { companyNameHint } from "@/lib/supply-os-company-identity";
import { buildSupplyOptimizationModel } from "@/lib/supply-os-optimization-engine";
import {
  loadSupplyCases,
  persistSupplyCases,
  removeLegacySupplyCaseStorage,
  supplyCaseStorageKeys,
  visibleSupplyCases,
  writeBrowserStorage,
} from "./supply-os-storage";
import { SupplyOsCommandMap } from "./supply-os-command-map";
import styles from "./supply-os-workspace.module.css";

function dashboardName(dashboard: SupplyCaseDashboard) {
  const storedName = dashboard.companyName?.trim();
  const hintedName = companyNameHint(dashboard.sourcePrompt);
  if (
    storedName
    && hintedName
    && storedName.toLowerCase().startsWith(`${hintedName.toLowerCase()}:`)
  ) {
    return hintedName;
  }
  return storedName || "Unnamed customer";
}

function companyLogoUrl(dashboard: SupplyCaseDashboard) {
  const logoUrl = dashboard.research?.company.logoUrl;
  if (!logoUrl) return null;
  try {
    const url = new URL(logoUrl);
    const file = url.pathname.split("/").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
    const company = dashboardName(dashboard).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (company && file.includes(company)) return url.toString();
    if (/^(?:logo|brandlogo|headerlogo|sitelogo|favicon|icon|wordmark)/.test(file)) return url.toString();
    const website = new URL(dashboard.research?.company.website ?? "");
    return website.hostname === url.hostname ? new URL("/logo.svg", website).toString() : null;
  } catch {
    return null;
  }
}

function dashboardLocation(dashboard: SupplyCaseDashboard) {
  return dashboard.productionLocation ?? dashboard.companyLocation ?? "Operating site to confirm";
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

function websiteLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Official website";
  }
}

function objectIcon(kind: SupplyCommandObject["kind"]): LucideIcon {
  if (kind === "supplier") return Boxes;
  if (kind === "factory") return Factory;
  if (kind === "distribution") return Warehouse;
  if (kind === "customer") return MapPin;
  if (kind === "customs") return ShieldAlert;
  return Truck;
}

function objectKindLabel(kind: SupplyCommandObject["kind"]) {
  if (kind === "supplier") return "Supplier";
  if (kind === "factory") return "Factory";
  if (kind === "distribution") return "Distribution";
  if (kind === "customer") return "Customer";
  if (kind === "customs") return "Customs";
  return "Movement";
}

function orderedNetworkObjects(objects: SupplyCommandObject[]) {
  const order: Record<SupplyCommandObject["kind"], number> = {
    supplier: 1,
    customs: 2,
    factory: 3,
    distribution: 4,
    customer: 5,
    movement: 6,
  };
  return objects
    .filter((object) => object.kind !== "movement")
    .sort((left, right) => order[left.kind] - order[right.kind]);
}

function orderedTransportObjects(objects: SupplyCommandObject[]) {
  return objects
    .filter((object) => object.kind === "movement")
    .sort((left, right) => (left.edgeId ?? "").localeCompare(right.edgeId ?? ""));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function RouteFlowChart({ route }: { route: SupplyCommandRoute }) {
  const flowNodes = [route.segments[0]?.fromLabel ?? route.fromLabel, ...route.segments.map((segment) => segment.toLabel)];
  const data = {
    nodes: flowNodes.map((name) => ({ name })),
    links: flowNodes.slice(1).map((_, index) => ({ source: index, target: index + 1, value: 1 })),
  };
  return (
    <div className={styles.routeFlowPanel} aria-label={`${route.fromLabel} to ${route.toLabel} transport flow`}>
      <div className={styles.routeFlowChart}>
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={data}
            nodePadding={18}
            nodeWidth={8}
            margin={{ top: 8, right: 12, bottom: 8, left: 12 }}
            link={{ stroke: "#aeb7bd", fill: "none", strokeOpacity: 0.52 }}
            node={{ fill: "#29485c", stroke: "#172027", strokeWidth: 1 }}
          >
            <ChartTooltip />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <div className={styles.routeFlowLabels} aria-hidden="true">
        {route.segments.map((segment) => (
          <span key={segment.id}><small>{segment.label}</small><strong>{segment.mode}</strong></span>
        ))}
      </div>
    </div>
  );
}

function routeNeedsFlowChart(route: SupplyCommandRoute) {
  return route.segments.length >= 3 || new Set(route.segments.map((segment) => segment.mode)).size > 1;
}

function NetworkFlowChart({ model }: { model: ReturnType<typeof buildSupplyOptimizationModel> }) {
  const availableNodes = model.nodes.filter((node) => node.coordinates);
  const nodeIndex = new Map(availableNodes.map((node, index) => [node.id, index]));
  const data = {
    nodes: availableNodes.map((node) => ({ name: node.label })),
    links: model.edges.flatMap((edge) => {
      const source = nodeIndex.get(edge.fromNodeId);
      const target = nodeIndex.get(edge.toNodeId);
      return source === undefined || target === undefined ? [] : [{ source, target, value: 1 }];
    }),
  };
  if (!data.links.length) return null;
  const flowLabels = availableNodes.length <= 3
    ? availableNodes
    : [availableNodes[0], availableNodes.find((node) => node.kind === "processing_site"), availableNodes.at(-1)]
      .filter((node): node is (typeof availableNodes)[number] => Boolean(node));
  return (
    <section className={styles.networkFlowPanel}>
      <h3>Network flow</h3>
      <div className={styles.networkFlowChart} aria-label="Supplier to factory to customer flow">
        <div>
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={data}
              nodePadding={12}
              nodeWidth={7}
              margin={{ top: 5, right: 10, bottom: 5, left: 10 }}
              link={{ stroke: "#aeb7bd", fill: "none", strokeOpacity: 0.48 }}
              node={{ fill: "#29485c", stroke: "#172027", strokeWidth: 1 }}
            >
              <ChartTooltip />
            </Sankey>
          </ResponsiveContainer>
        </div>
        <div className={styles.networkFlowLabels} aria-hidden="true">
          {flowLabels.map((node) => <span key={node.id}>{node.label}</span>)}
        </div>
      </div>
    </section>
  );
}

function workspaceForObject(
  object: SupplyCommandObject,
  model: ReturnType<typeof buildSupplyOptimizationModel>,
) {
  return model.workspaces.find((workspace) => workspace.id === object.workstreamId) ?? null;
}

const ILLUSTRATIVE_NETWORK_DATE = new Date("2026-08-08T12:00:00.000Z");

function illustrativeNetworkCase() {
  return generateSupplyCase(SAMPLE_SUPPLY_CASE_PROMPT, ILLUSTRATIVE_NETWORK_DATE, "full_operation");
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
      const cases = stored.cases.length ? stored.cases : [illustrativeNetworkCase()];
      setSavedCases(cases);
      setActiveCase(stored.selected ?? cases[0]);
      setStorageReady(true);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== keys.cases && event.key !== keys.selected) return;
      const stored = loadSupplyCases(storageScope);
      const cases = stored.cases.length ? stored.cases : [illustrativeNetworkCase()];
      setSavedCases(cases);
      setActiveCase(stored.selected ?? cases[0]);
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
  const currentCase = activeCase && visibleCases.some((item) => item.id === activeCase.id)
    ? activeCase
    : visibleCases[0] ?? null;

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
    <div className={`${styles.workspace} ${styles.commandWorkspace} ${presentationMode ? styles.presentationWorkspace : ""} supply-os-workspace`}>
      {!storageReady ? (
        <CommandState title="Loading customer network" detail="Opening saved customer data from this browser." />
      ) : currentCase ? (
        <CaseCommandCenter
          key={currentCase.id}
          dashboard={currentCase}
          savedCases={visibleCases}
          presentationMode={presentationMode}
          onOpenDashboard={openDashboard}
          onScopeChange={(scope) => updateDashboardScope(currentCase, scope)}
        />
      ) : null}
    </div>
  );
}

function CommandState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.commandState}>
      <Boxes size={22} strokeWidth={1.6} />
      <h1>{title}</h1>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function CaseCommandCenter({
  dashboard,
  savedCases,
  presentationMode,
  onOpenDashboard,
  onScopeChange,
}: {
  dashboard: SupplyCaseDashboard;
  savedCases: SupplyCaseDashboard[];
  presentationMode: boolean;
  onOpenDashboard: (item: SupplyCaseDashboard) => void;
  onScopeChange: (scope: SupplyEngagementScope) => boolean;
}) {
  const selectedScope = dashboard.engagementScope ?? "full_operation";
  const [scopeError, setScopeError] = useState("");
  const modelDashboard = useMemo(() => {
    const name = dashboardName(dashboard);
    return name === dashboard.companyName ? dashboard : { ...dashboard, companyName: name };
  }, [dashboard]);
  const model = useMemo(() => buildSupplyOptimizationModel(modelDashboard), [modelDashboard]);
  const commandMap = useMemo(() => buildSupplyCommandMap(model, modelDashboard), [model, modelDashboard]);
  const initialObject = commandMap.objects.find((object) => object.kind === "factory")
    ?? commandMap.objects.find((object) => object.kind === "supplier")
    ?? commandMap.objects[0]
    ?? null;
  const [selectedObjectId, setSelectedObjectId] = useState(initialObject?.id ?? "");
  const [inspectorMode, setInspectorMode] = useState<"object" | "optimization">("optimization");
  const selectedObject = commandMap.objects.find((object) => object.id === selectedObjectId) ?? initialObject;
  const networkObjects = useMemo(() => orderedNetworkObjects(commandMap.objects), [commandMap.objects]);
  const transportObjects = useMemo(() => orderedTransportObjects(commandMap.objects), [commandMap.objects]);
  const supplierCount = commandMap.objects.filter((object) => object.kind === "supplier").length;
  const customsCount = commandMap.objects.filter((object) => object.kind === "customs").length;
  const logoUrl = companyLogoUrl(dashboard);
  const isIllustrativeNetwork = dashboard.sourcePrompt === SAMPLE_SUPPLY_CASE_PROMPT && !dashboard.research;

  function selectScope(scope: SupplyEngagementScope) {
    if (scope === selectedScope) return;
    if (!onScopeChange(scope)) {
      setScopeError("Coverage could not be saved in this browser.");
      return;
    }
    setScopeError("");
  }

  function selectNetworkObject(object: SupplyCommandObject) {
    setSelectedObjectId(object.id);
    setInspectorMode("object");
  }

  function focusOptimizationAction(actionId: string) {
    const related = commandMap.objects.find((object) => object.optimizationIds.includes(actionId));
    if (related) setSelectedObjectId(related.id);
  }

  return (
    <article className={styles.commandCenter} aria-labelledby="supply-command-title">
      <header className={styles.commandHeader}>
        <div className={styles.commandIdentity}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              onError={(event) => { event.currentTarget.hidden = true; }}
            />
          ) : null}
          <span>
            <h1 id="supply-command-title">{dashboardName(dashboard)}</h1>
            <small>{dashboardLocation(dashboard)}</small>
          </span>
        </div>

        <div className={styles.commandMetrics} aria-label="Network coverage">
          {isIllustrativeNetwork ? <span className={styles.commandFixtureBadge}>Demo</span> : null}
          <span><strong>{supplierCount}</strong> suppliers</span>
          <span><strong>{commandMap.routes.length}</strong> lanes</span>
          <span><strong>{customsCount}</strong> customs</span>
          <span>Updated {formatTimestamp(dashboard.updatedAt)}</span>
        </div>

        <div className={styles.commandActions}>
          {dashboard.research ? (
            <a className={styles.commandIconLink} href={dashboard.research.company.website} target="_blank" rel="noreferrer" aria-label={`Open ${websiteLabel(dashboard.research.company.website)}`}>
              <ExternalLink size={15} />
            </a>
          ) : null}

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className={styles.commandMenuButton}>
                {dashboardName(dashboard)} <ChevronDown size={14} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={styles.commandMenu} align="end" sideOffset={7} collisionPadding={12}>
                <DropdownMenu.Label>Customer dashboards</DropdownMenu.Label>
                {savedCases.map((item) => (
                  <DropdownMenu.Item
                    key={item.id}
                    className={styles.commandMenuItem}
                    onSelect={() => onOpenDashboard(item)}
                  >
                    <span><strong>{dashboardName(item)}</strong><small>{dashboardLocation(item)}</small></span>
                    {item.id === dashboard.id ? <Check size={14} /> : null}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className={styles.commandMenuButton}>
                {scopeLabel(selectedScope)} <ChevronDown size={14} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={styles.commandMenu} align="end" alignOffset={388} sideOffset={7} avoidCollisions={false}>
                <DropdownMenu.Label>Derya coverage</DropdownMenu.Label>
                {SUPPLY_ENGAGEMENT_OPTIONS.map((option) => (
                  <DropdownMenu.Item
                    key={option.id}
                    className={styles.commandMenuItem}
                    onSelect={() => selectScope(option.id)}
                  >
                    <span><strong>{option.shortLabel}</strong><small>{option.label}</small></span>
                    {option.id === selectedScope ? <Check size={14} /> : null}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

        </div>
      </header>

      {scopeError ? <div className={styles.commandError} role="alert">{scopeError}</div> : null}

      <div className={styles.commandMapStage}>
        <SupplyOsCommandMap
          commandMap={commandMap}
          selectedObject={selectedObject}
          onSelectObject={selectNetworkObject}
        />

        <aside className={styles.routeRail} aria-label="Operating network objects">
          <header>
            <span>Network</span>
            <small>{networkObjects.length} points, {transportObjects.length} legs</small>
          </header>
          <div className={styles.routeRailList}>
            <div className={styles.routeRailGroupLabel}>Operating points</div>
            {networkObjects.map((object) => {
              const Icon = objectIcon(object.kind);
              return (
                <button
                  key={object.id}
                  type="button"
                  data-active={object.id === selectedObject?.id}
                  data-status={object.status}
                  aria-pressed={object.id === selectedObject?.id}
                  onClick={() => selectNetworkObject(object)}
                >
                  <span className={styles.routeRailIcon}><Icon size={15} strokeWidth={1.8} /></span>
                  <span className={styles.routeRailCopy}>
                    <small>{objectKindLabel(object.kind)}</small>
                    <strong>{object.label}</strong>
                    <em>{object.location}</em>
                  </span>
                  <i className={styles.routeRailStatus} />
                </button>
              );
            })}
            {transportObjects.length ? <div className={styles.routeRailGroupLabel}>Transport legs</div> : null}
            {transportObjects.map((object) => {
              const Icon = objectIcon(object.kind);
              return (
                <button
                  key={object.id}
                  type="button"
                  className={styles.routeRailLeg}
                  data-active={object.id === selectedObject?.id}
                  data-status={object.status}
                  aria-pressed={object.id === selectedObject?.id}
                  onClick={() => selectNetworkObject(object)}
                >
                  <span className={styles.routeRailIcon}><Icon size={15} strokeWidth={1.8} /></span>
                  <span className={styles.routeRailCopy}>
                    <small>{object.location}</small>
                    <strong>{object.label}</strong>
                    <em>{object.rateEstimate ? `${object.rateEstimate.distanceMiles.toLocaleString()} mi, ${formatCurrency(object.rateEstimate.low)} to ${formatCurrency(object.rateEstimate.high)}` : "Open for carrier comparison"}</em>
                  </span>
                  {object.priority ? <i className={styles.routeRailPriority}>P{object.priority.priority}</i> : <i className={styles.routeRailStatus} />}
                </button>
              );
            })}
          </div>
        </aside>

        {selectedObject ? (
          <CommandInspector
            dashboard={modelDashboard}
            model={model}
            object={selectedObject}
            route={commandMap.routes.find((route) => route.edgeId === selectedObject.edgeId) ?? null}
            mode={inspectorMode}
            onModeChange={setInspectorMode}
            onFocusAction={focusOptimizationAction}
          />
        ) : null}

        <footer className={styles.commandMapFooter}>
          <div className={styles.commandLegend} aria-label="Map legend">
            <span><i data-kind="node" /> Operating point</span>
            <span><i data-kind="route" /> Planned route</span>
            {commandMap.insights.length ? <span><i data-kind="insight" /> Sourced signal</span> : null}
          </div>
        </footer>
      </div>
    </article>
  );
}

function CommandInspector({
  dashboard,
  model,
  object,
  route,
  mode,
  onModeChange,
  onFocusAction,
}: {
  dashboard: SupplyCaseDashboard;
  model: ReturnType<typeof buildSupplyOptimizationModel>;
  object: SupplyCommandObject;
  route: SupplyCommandRoute | null;
  mode: "object" | "optimization";
  onModeChange: (mode: "object" | "optimization") => void;
  onFocusAction: (actionId: string) => void;
}) {
  const Icon = objectIcon(object.kind);
  const workspace = workspaceForObject(object, model);
  const action = model.actions.find((candidate) => candidate.id === object.priority?.id)
    ?? model.actions.find((candidate) => candidate.workstreamId === object.workstreamId)
    ?? model.actions[0]
    ?? null;
  const [selectedActionId, setSelectedActionId] = useState(model.actions[0]?.id ?? "");
  const selectedAction = model.actions.find((candidate) => candidate.id === selectedActionId)
    ?? model.actions[0]
    ?? null;
  const actionWorkspace = selectedAction
    ? model.workspaces.find((candidate) => candidate.id === selectedAction.workstreamId) ?? null
    : null;
  const openChecks = object.checks.filter((check) => check.status !== "ready");

  useEffect(() => {
    setSelectedActionId(model.actions[0]?.id ?? "");
  }, [model]);

  return (
    <aside className={styles.commandInspector} aria-live="polite">
      <Tabs.Root
        className={styles.inspectorTabsRoot}
        value={mode}
        onValueChange={(value) => onModeChange(value as "object" | "optimization")}
      >
        <Tabs.List className={styles.inspectorTabsList} aria-label="Inspector view">
          <Tabs.Trigger value="object">{object.kind === "movement" ? "Transport leg" : "Details"}</Tabs.Trigger>
          <Tabs.Trigger value="optimization">Priorities <small>{model.actions.length}</small></Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="object" className={styles.inspectorTabPanel}>
          <header className={styles.inspectorHeader}>
            <span className={styles.inspectorIcon} data-kind={object.kind}><Icon size={17} strokeWidth={1.8} /></span>
            <span>
              <small>{objectKindLabel(object.kind)}</small>
              <h2>{object.label}</h2>
            </span>
            <i data-status={object.status}>{object.statusLabel}</i>
          </header>

          <div className={styles.inspectorBody}>
            <p className={styles.inspectorLocation}>{object.location}</p>
            <p className={styles.inspectorDetail}>{object.detail}</p>

            {route && routeNeedsFlowChart(route) ? <RouteFlowChart route={route} /> : null}

            <dl className={styles.inspectorFacts}>
              <div><dt>Cargo</dt><dd>{object.cargo}</dd></div>
              <div><dt>{object.rateEstimate ? "Road distance" : "Confidence"}</dt><dd>{object.rateEstimate ? `${object.rateEstimate.distanceMiles.toLocaleString()} mi estimated` : object.confidence}</dd></div>
            </dl>

            {object.rateEstimate ? (
              <section className={styles.inspectorRatePlan}>
                <header>
                  <span><small>Planning range</small><strong>{formatCurrency(object.rateEstimate.low)} to {formatCurrency(object.rateEstimate.high)}</strong></span>
                  <span><small>Rate model</small><strong>${object.rateEstimate.ratePerMileLow.toFixed(2)} to ${object.rateEstimate.ratePerMileHigh.toFixed(2)} / mi</strong></span>
                </header>
                <p>{object.rateEstimate.basis}</p>
                <a href={object.rateEstimate.sourceUrl} target="_blank" rel="noreferrer">{object.rateEstimate.sourceLabel} <ExternalLink size={11} /></a>
                <small>Modeled, not a live quote. {object.rateEstimate.exclusions.join(". ")}.</small>
              </section>
            ) : route ? (
              <section className={styles.inspectorRatePending}>
                <strong>Live quote required</strong>
                <p>Dimensions, weight, ready date, Incoterm, service level, exact addresses, and cargo restrictions are required before Derya can compare a defensible price.</p>
              </section>
            ) : null}

            {openChecks.length ? (
              <section className={styles.inspectorChecks}>
                <h3>Open checks</h3>
                {openChecks.map((check) => (
                  <div key={check.label}><i data-check={check.status} /><span>{check.label}</span><small>{check.status}</small></div>
                ))}
              </section>
            ) : null}

            {object.contacts.length ? (
              <section className={styles.inspectorContacts}>
                <h3>
                  {object.kind === "supplier" ? "Supplier candidates" : object.kind === "movement" ? "Carrier shortlist" : "Provider contacts"}
                  <span>{object.contacts.length} options</span>
                </h3>
                {object.contacts.slice(0, object.kind === "movement" ? 9 : 3).map((contact) => (
                  <div key={contact.id} className={styles.inspectorContact}>
                    <span><strong>{contact.name}</strong><small>{contact.role}</small></span>
                    {contact.proximity ? <b>{contact.proximity}</b> : null}
                    <p>{contact.fit}</p>
                    {contact.location ? <address>{contact.location}</address> : null}
                    <div className={styles.inspectorContactActions}>
                      {contact.phone ? <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`} aria-label={`Call ${contact.name}`}><Phone size={12} /> {contact.phone}</a> : null}
                      {contact.url ? <a href={contact.url} target="_blank" rel="noreferrer" aria-label={`Open ${contact.name}`}><ExternalLink size={12} /> {contact.sourceLabel ?? "Source"}</a> : null}
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            <section className={styles.inspectorAction}>
              <h3>{object.priority ? `Priority P${String(object.priority.priority).padStart(2, "0")}` : "Next action"}</h3>
              {object.priority ? <strong>{object.priority.title}</strong> : null}
              <p>{action?.recommendation ?? object.nextAction}</p>
              <small>{object.nextAction}</small>
            </section>
          </div>

          {workspace ? (
            <Link className={styles.inspectorWorkspaceLink} href={{ pathname: workspace.route, query: { case: dashboard.id } }}>
              Open {workspace.shortLabel} <ArrowRight size={14} />
            </Link>
          ) : null}
        </Tabs.Content>

        <Tabs.Content value="optimization" className={`${styles.inspectorTabPanel} ${styles.optimizationInspector}`}>
          <header className={styles.inspectorHeader}>
            <span className={styles.inspectorIcon}><ListChecks size={17} strokeWidth={1.8} /></span>
            <span>
              <h2>{model.profile}</h2>
            </span>
            <i>{model.actions.length} priorities</i>
          </header>

          <div className={styles.analysisBody}>
            <section className={styles.analysisThesis}>
              <p>{model.networkSummary}</p>
            </section>

            {model.nodes.length >= 3 && model.edges.length >= 2 ? <NetworkFlowChart model={model} /> : null}

            <div className={styles.analysisPriorityList} aria-label="Ranked optimization priorities">
              {model.actions.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  data-active={candidate.id === selectedAction?.id}
                  aria-pressed={candidate.id === selectedAction?.id}
                  onClick={() => {
                    setSelectedActionId(candidate.id);
                    onFocusAction(candidate.id);
                  }}
                >
                  <small>{String(candidate.priority).padStart(2, "0")}</small>
                  <span><strong>{candidate.title}</strong><em>{candidate.measure}</em></span>
                </button>
              ))}
            </div>

            {selectedAction ? (
              <section className={styles.analysisDetail}>
                <header><small>Priority {String(selectedAction.priority).padStart(2, "0")}</small><strong>{selectedAction.title}</strong></header>
                <dl>
                  <div><dt>Condition</dt><dd>{selectedAction.currentCondition}</dd></div>
                  <div><dt>Action</dt><dd>{selectedAction.recommendation}</dd></div>
                  <div><dt>Decision</dt><dd>{selectedAction.decision}</dd></div>
                  <div><dt>Needs</dt><dd>{selectedAction.requiredInput}</dd></div>
                </dl>
                <p><strong>Track</strong>{selectedAction.measure}</p>
              </section>
            ) : null}
          </div>

          {actionWorkspace ? (
            <Link className={styles.inspectorWorkspaceLink} href={{ pathname: actionWorkspace.route, query: { case: dashboard.id } }}>
              Open {actionWorkspace.shortLabel} <ArrowRight size={14} />
            </Link>
          ) : null}
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}
