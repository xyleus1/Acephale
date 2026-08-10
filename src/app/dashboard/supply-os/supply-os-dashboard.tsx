"use client";

import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowRight,
  ExternalLink,
  Factory,
  ListChecks,
  LoaderCircle,
  MapPin,
  PackageOpen,
  PackageSearch,
  Phone,
  ShieldAlert,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ResponsiveContainer,
  Sankey,
  Tooltip as ChartTooltip,
} from "recharts";
import {
  generateSupplyCase,
  SAMPLE_SUPPLY_CASE_PROMPT,
  type SupplyCaseDashboard,
} from "@/lib/supply-os-case-model";
import {
  buildSupplyCommandMap,
  type SupplyCommandObject,
  type SupplyCommandRoute,
} from "@/lib/supply-os-command-map";
import { companyNameHint } from "@/lib/supply-os-company-identity";
import { buildSupplyOptimizationModel } from "@/lib/supply-os-optimization-engine";
import type { SupplyOsPanel } from "@/lib/supply-os/panel-routing";
import {
  loadSupplyCases,
  removeLegacySupplyCaseStorage,
  supplyCaseStorageKeys,
  visibleSupplyCases,
} from "./supply-os-storage";
import {
  ATLAS_ROBOTICS_INVENTORY,
  shortageQuantity,
} from "@/lib/supply-os/atlas-robotics-inventory";
import { SupplyOsCommandMap } from "./supply-os-command-map";
import { SupplyOsAutomations } from "./supply-os-automations";
import {
  AtlasInventoryRail,
  AtlasSourcingInspector,
  type SourcingStage,
} from "./supply-os-inventory-sourcing";
import styles from "./supply-os-logistics.module.css";

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

function objectIcon(kind: SupplyCommandObject["kind"]): LucideIcon {
  if (kind === "supplier") return PackageSearch;
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

const PRODUCT_MEDIA = {
  src: "/supply-os/demo/vector3dhd-amr.jpg",
  sourcePage: "https://commons.wikimedia.org/wiki/File:Vector3DHD_autonomous_mobile_robot_and_EnZone_wireless_charging.jpg",
  creator: "PattyK33",
  license: "CC BY-SA 4.0",
} as const;

const DOMAIN_CONFIG: Record<SupplyOsPanel, {
  railTitle: string;
  railSummary: string;
  objectKinds: SupplyCommandObject["kind"][];
  defaultInspector: "object" | "optimization";
}> = {
  materials: {
    railTitle: "Inventory & sourcing",
    railSummary: "Stock, demand, and supply options",
    objectKinds: ["supplier", "factory", "distribution"],
    defaultInspector: "object",
  },
  logistics: {
    railTitle: "Logistics network",
    railSummary: "Routes and controls",
    objectKinds: ["movement", "customs", "factory", "distribution", "customer"],
    defaultInspector: "object",
  },
  fulfillment: {
    railTitle: "Customer fulfillment",
    railSummary: "Allocation and delivery readiness",
    objectKinds: ["factory", "distribution", "customer", "movement"],
    defaultInspector: "object",
  },
  scenarios: {
    railTitle: "Opportunity network",
    railSummary: "Candidate paths",
    objectKinds: ["supplier", "factory", "distribution", "customer", "customs", "movement"],
    defaultInspector: "optimization",
  },
  tracking: {
    railTitle: "Execution network",
    railSummary: "Movement and exceptions",
    objectKinds: ["movement", "customs", "factory", "customer"],
    defaultInspector: "object",
  },
  automations: {
    railTitle: "Automations",
    railSummary: "Draft workflows",
    objectKinds: [],
    defaultInspector: "object",
  },
};

const PANEL_FOCUS_KINDS: Record<SupplyOsPanel, SupplyCommandObject["kind"][]> = {
  materials: ["factory", "distribution", "supplier"],
  logistics: ["movement", "customs", "factory"],
  fulfillment: ["customer", "distribution", "movement", "factory"],
  scenarios: ["customer", "distribution", "supplier"],
  tracking: ["movement", "customs", "customer"],
  automations: [],
};

function preferredPanelObject(panel: SupplyOsPanel, objects: SupplyCommandObject[]) {
  for (const kind of PANEL_FOCUS_KINDS[panel]) {
    const match = objects.find((object) => object.kind === kind);
    if (match) return match;
  }
  return objects[0] ?? null;
}

type OpportunityPlayId = "supply" | "logistics" | "production" | "network";

type OpportunityPlay = {
  id: OpportunityPlayId;
  label: string;
  scope: string;
  icon: LucideIcon;
  action: ReturnType<typeof buildSupplyOptimizationModel>["actions"][number];
};

const OPPORTUNITY_PLAY_CONFIG: Array<{
  id: OpportunityPlayId;
  label: string;
  scope: string;
  icon: LucideIcon;
  matches: (action: ReturnType<typeof buildSupplyOptimizationModel>["actions"][number]) => boolean;
}> = [
  {
    id: "supply",
    label: "Supply",
    scope: "Sources, terms, and availability",
    icon: PackageOpen,
    matches: (action) => action.workstreamId === "procurement" || action.workstreamId === "supplier_outreach",
  },
  {
    id: "logistics",
    label: "Logistics",
    scope: "Modes, lanes, customs, and timing",
    icon: Truck,
    matches: (action) => action.workstreamId === "shipment_planning" || action.workstreamId === "customs",
  },
  {
    id: "production",
    label: "Production",
    scope: "Build continuity, capacity, and release",
    icon: Factory,
    matches: (action) => /production|build|inventory|release|capacity|shortage|kit|line stop/i.test(
      `${action.title} ${action.currentCondition} ${action.recommendation} ${action.measure}`,
    ),
  },
  {
    id: "network",
    label: "Network",
    scope: "Facilities, handoffs, and customer reach",
    icon: MapPin,
    matches: (action) => action.workstreamId === "fulfillment",
  },
];

function productionCopy(value: string) {
  return value
    .replace(/\bsubassemblies\b/gi, "integrated modules")
    .replace(/\bsubassembly\b/gi, "integrated module")
    .replace(/\bassemblies\b/gi, "production units")
    .replace(/\bassembly\b/gi, "production")
    .replace(/\bassembled\b/gi, "prebuilt")
    .replace(/\bassemble\b/gi, "prepare");
}

function buildOpportunityPlays(model: ReturnType<typeof buildSupplyOptimizationModel>): OpportunityPlay[] {
  const usedActionIds = new Set<string>();
  return OPPORTUNITY_PLAY_CONFIG.flatMap((config) => {
    const action = model.actions.find((candidate) => !usedActionIds.has(candidate.id) && config.matches(candidate))
      ?? model.actions.find((candidate) => !usedActionIds.has(candidate.id))
      ?? model.actions[0];
    if (!action) return [];
    usedActionIds.add(action.id);
    return [{ ...config, action }];
  });
}

function OpportunityScenarioWorkbench({
  model,
  company,
}: {
  model: ReturnType<typeof buildSupplyOptimizationModel>;
  company: string;
}) {
  const plays = useMemo(() => buildOpportunityPlays(model), [model]);
  const [selectedPlayId, setSelectedPlayId] = useState<OpportunityPlayId>(plays[0]?.id ?? "supply");
  const [playedPlayId, setPlayedPlayId] = useState<OpportunityPlayId>(plays[0]?.id ?? "supply");
  const [runCount, setRunCount] = useState(0);
  const reduceMotion = useReducedMotion();
  const outputRef = useRef<HTMLElement>(null);
  const selectedPlay = plays.find((play) => play.id === selectedPlayId) ?? plays[0];
  const playedPlay = plays.find((play) => play.id === playedPlayId) ?? selectedPlay;

  useEffect(() => {
    if (runCount === 0) return;
    outputRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }, [reduceMotion, runCount]);

  if (!selectedPlay || !playedPlay) return null;

  return (
    <section className={styles.scenarioWorkbench} aria-labelledby="opportunity-workbench-title">
      <header className={styles.scenarioWorkbenchHeader}>
        <span>
          <h2 id="opportunity-workbench-title">Explore opportunities</h2>
          <p>Supply, logistics, production, and network scenarios</p>
        </span>
        <small>Modeled from {company}</small>
      </header>

      <div className={styles.scenarioWorkbenchBody}>
        <nav className={styles.scenarioPlayList} aria-label="Opportunity scenarios">
          <header><span>Scenario plays</span><small>{plays.length}</small></header>
          {plays.map((play) => {
            const Icon = play.icon;
            const selected = play.id === selectedPlay.id;
            return (
              <button
                key={play.id}
                type="button"
                aria-pressed={selected}
                data-active={selected}
                onClick={() => setSelectedPlayId(play.id)}
              >
                <span className={styles.scenarioPlayIcon}><Icon size={17} strokeWidth={1.8} /></span>
                <span><strong>{play.label}</strong><small>{play.scope}</small></span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            );
          })}
        </nav>

        <section className={styles.scenarioDraft} aria-label={`${selectedPlay.label} scenario inputs`}>
          <header><small>{selectedPlay.label} play</small><strong>{productionCopy(selectedPlay.action.title)}</strong></header>
          <dl>
            <div><dt>Current condition</dt><dd>{productionCopy(selectedPlay.action.currentCondition)}</dd></div>
            <div><dt>Change to test</dt><dd>{productionCopy(selectedPlay.action.recommendation)}</dd></div>
            <div><dt>Inputs required</dt><dd>{productionCopy(selectedPlay.action.requiredInput)}</dd></div>
          </dl>
          <button
            type="button"
            className={styles.scenarioRunButton}
            onClick={() => {
              setPlayedPlayId(selectedPlay.id);
              setRunCount((count) => count + 1);
            }}
          >
            Run scenario <ArrowRight size={15} />
          </button>
        </section>

        <motion.section
          ref={outputRef}
          key={`${playedPlay.id}:${runCount}`}
          className={styles.scenarioOutput}
          aria-label="Scenario output"
          aria-live="polite"
          initial={reduceMotion ? false : { opacity: 0.82, x: 5 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          <header><span>Scenario output</span><small>{playedPlay.label}</small></header>
          <div className={styles.scenarioComparison}>
            <article>
              <small>Current</small>
              <p>{productionCopy(playedPlay.action.currentCondition)}</p>
            </article>
            <ArrowRight size={18} aria-hidden="true" />
            <article data-scenario="true">
              <small>With change</small>
              <p>{productionCopy(playedPlay.action.recommendation)}</p>
            </article>
          </div>
          <dl className={styles.scenarioOutcomeGrid}>
            <div><dt>Measure</dt><dd>{productionCopy(playedPlay.action.measure)}</dd></div>
            <div><dt>Decision</dt><dd>{productionCopy(playedPlay.action.decision)}</dd></div>
            <div><dt>Evidence state</dt><dd>Company model plus current inputs. Missing facts stay open.</dd></div>
            <div><dt>Approval</dt><dd>Human decision required before any external action.</dd></div>
          </dl>
        </motion.section>
      </div>

      <footer className={styles.scenarioBoundary}>
        <ShieldAlert size={15} />
        <p>Planning output only. No supplier, booking, filing, or spend action is approved.</p>
      </footer>
    </section>
  );
}

function illustrativeNetworkCase() {
  return generateSupplyCase(SAMPLE_SUPPLY_CASE_PROMPT, ILLUSTRATIVE_NETWORK_DATE, "full_operation");
}

export function SupplyOsDashboardWorkspace({
  storageScope,
  presentationMode = false,
  activePanel = "materials",
}: {
  storageScope: string;
  presentationMode?: boolean;
  activePanel?: SupplyOsPanel;
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

  return (
    <div className={`${styles.workspace} ${styles.commandWorkspace} ${presentationMode ? styles.presentationWorkspace : ""} supply-os-workspace`}>
      {!storageReady ? (
        <CommandState title="Loading customer network" detail="Opening saved customer data from this browser." />
      ) : currentCase ? (
        activePanel === "automations" ? (
          <SupplyOsAutomations key={currentCase.id} company={dashboardName(currentCase)} />
        ) : (
          <CaseCommandCenter
            key={currentCase.id}
            dashboard={currentCase}
            presentationMode={presentationMode}
            activePanel={activePanel}
          />
        )
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
      <LoaderCircle size={22} strokeWidth={1.6} />
      <h1>{title}</h1>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function CaseCommandCenter({
  dashboard,
  presentationMode,
  activePanel,
}: {
  dashboard: SupplyCaseDashboard;
  presentationMode: boolean;
  activePanel: SupplyOsPanel;
}) {
  const modelDashboard = useMemo(() => {
    const name = dashboardName(dashboard);
    return name === dashboard.companyName ? dashboard : { ...dashboard, companyName: name };
  }, [dashboard]);
  const model = useMemo(() => buildSupplyOptimizationModel(modelDashboard), [modelDashboard]);
  const commandMap = useMemo(() => buildSupplyCommandMap(model, modelDashboard), [model, modelDashboard]);
  const domain = DOMAIN_CONFIG[activePanel];
  const initialObject = commandMap.objects.find((object) => object.kind === "factory")
    ?? commandMap.objects.find((object) => object.kind === "supplier")
    ?? commandMap.objects[0]
    ?? null;
  const [selection, setSelection] = useState({ panel: activePanel, objectId: initialObject?.id ?? "" });
  const [inspectorMode, setInspectorMode] = useState<"object" | "optimization">("optimization");
  const [selectedInventorySku, setSelectedInventorySku] = useState(
    ATLAS_ROBOTICS_INVENTORY.find((item) => shortageQuantity(item) > 0)?.sku
      ?? ATLAS_ROBOTICS_INVENTORY[0]?.sku
      ?? "",
  );
  const [sourcingStages, setSourcingStages] = useState<Record<string, SourcingStage>>({});
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Record<string, string>>({});
  const domainObjects = useMemo(
    () => commandMap.objects.filter((object) => domain.objectKinds.includes(object.kind)),
    [commandMap.objects, domain.objectKinds],
  );
  const preferredObject = useMemo(
    () => preferredPanelObject(activePanel, domainObjects),
    [activePanel, domainObjects],
  );
  const selectedObject = selection.panel === activePanel
    ? commandMap.objects.find((object) => object.id === selection.objectId) ?? preferredObject ?? initialObject
    : preferredObject ?? initialObject;
  const networkObjects = useMemo(() => orderedNetworkObjects(domainObjects), [domainObjects]);
  const transportObjects = useMemo(() => orderedTransportObjects(domainObjects), [domainObjects]);
  const selectedInventoryItem = ATLAS_ROBOTICS_INVENTORY.find((item) => item.sku === selectedInventorySku)
    ?? ATLAS_ROBOTICS_INVENTORY[0];
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setInspectorMode(domain.defaultInspector);
  }, [activePanel, domain.defaultInspector]);

  function selectNetworkObject(object: SupplyCommandObject) {
    setSelection({ panel: activePanel, objectId: object.id });
    setInspectorMode("object");
  }

  function focusOptimizationAction(actionId: string) {
    const related = commandMap.objects.find((object) => object.optimizationIds.includes(actionId));
    if (related) setSelection({ panel: activePanel, objectId: related.id });
  }

  function advanceSourcingWorkflow() {
    if (!selectedInventoryItem || shortageQuantity(selectedInventoryItem) === 0) return;
    const currentStage = sourcingStages[selectedInventoryItem.sku] ?? "idle";
    if (currentStage === "review") return;
    if (!selectedCandidateIds[selectedInventoryItem.sku] && selectedInventoryItem.candidates[0]) {
      setSelectedCandidateIds((current) => ({
        ...current,
        [selectedInventoryItem.sku]: selectedInventoryItem.candidates[0].id,
      }));
    }
    setSourcingStages((current) => ({
      ...current,
      [selectedInventoryItem.sku]: currentStage === "idle" ? "shortlist" : "review",
    }));
  }

  return (
    <article
      className={styles.commandCenter}
      aria-label={`${domain.railTitle} workspace`}
      data-domain={activePanel}
      data-embedded={!presentationMode}
    >
      <div className={styles.commandMapStage}>
        <section className={styles.mapPanel} aria-label={`${domain.railTitle} map`}>
          <SupplyOsCommandMap
            commandMap={commandMap}
            selectedObject={selectedObject}
            onSelectObject={selectNetworkObject}
            activePanel={activePanel}
          />

        </section>

        {activePanel === "materials" ? (
          <AtlasInventoryRail selectedSku={selectedInventoryItem?.sku ?? ""} onSelect={setSelectedInventorySku} />
        ) : (
          <motion.aside
            key={activePanel}
            className={styles.routeRail}
            aria-label="Operating network objects"
            initial={reduceMotion ? false : { opacity: 0.82, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          >
            <header>
              <span>{domain.railTitle}</span>
              <div className={styles.routeRailMeta}>
                <small>{domainObjects.length} objects</small>
                <small className={styles.mapDataSources} aria-label="Map data attribution">
                  Map data
                  {" "}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OSM</a>
                  {" · "}<a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>
                  {" · "}<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OFM</a>
                </small>
              </div>
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
          </motion.aside>
        )}

        {activePanel === "materials" && selectedInventoryItem ? (
          <AtlasSourcingInspector
            item={selectedInventoryItem}
            stage={sourcingStages[selectedInventoryItem.sku] ?? "idle"}
            selectedCandidateId={selectedCandidateIds[selectedInventoryItem.sku] ?? null}
            onSelectCandidate={(candidateId) => setSelectedCandidateIds((current) => ({ ...current, [selectedInventoryItem.sku]: candidateId }))}
            onAdvance={advanceSourcingWorkflow}
          />
        ) : selectedObject ? (
          <CommandInspector
            dashboard={modelDashboard}
            model={model}
            object={selectedObject}
            route={commandMap.routes.find((route) => route.edgeId === selectedObject.edgeId) ?? null}
            mode={inspectorMode}
            onModeChange={setInspectorMode}
            onFocusAction={focusOptimizationAction}
            activePanel={activePanel}
          />
        ) : null}

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
  activePanel,
}: {
  dashboard: SupplyCaseDashboard;
  model: ReturnType<typeof buildSupplyOptimizationModel>;
  object: SupplyCommandObject;
  route: SupplyCommandRoute | null;
  mode: "object" | "optimization";
  onModeChange: (mode: "object" | "optimization") => void;
  onFocusAction: (actionId: string) => void;
  activePanel: SupplyOsPanel;
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
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setSelectedActionId(model.actions[0]?.id ?? "");
  }, [model]);

  return (
    <motion.aside
      key={`${activePanel}:${object.id}:${mode}`}
      className={styles.commandInspector}
      aria-live="polite"
      initial={reduceMotion ? false : { opacity: 0.84, x: 4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
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
            {activePanel === "materials" ? (
              <figure className={styles.inspectorProductMedia}>
                <img src={PRODUCT_MEDIA.src} alt="Autonomous mobile robot in an industrial workspace" />
                <figcaption>
                  Product reference
                  <a href={PRODUCT_MEDIA.sourcePage} target="_blank" rel="noreferrer">
                    {PRODUCT_MEDIA.creator}, {PRODUCT_MEDIA.license}
                  </a>
                </figcaption>
              </figure>
            ) : null}
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
    </motion.aside>
  );
}
