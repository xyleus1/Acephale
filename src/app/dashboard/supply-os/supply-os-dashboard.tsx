"use client";

import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowRight,
  ExternalLink,
  Factory,
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
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ResponsiveContainer,
  Sankey,
  Tooltip as ChartTooltip,
} from "recharts";
import {
  generateSupplyCase,
  SAMPLE_SUPPLY_CASE_PROMPT,
  type SupplyCaseDashboard,
  type SupplyCompanyResearch,
} from "@/lib/supply-os-case-model";
import { parseSupplyCompanyResearch } from "@/lib/supply-os/company-profile";
import {
  buildSupplyCommandMap,
  type SupplyCommandMap,
  type SupplyCommandObject,
  type SupplyCommandRoute,
} from "@/lib/supply-os-command-map";
import { companyNameHint } from "@/lib/supply-os-company-identity";
import { buildSupplyOptimizationModel } from "@/lib/supply-os-optimization-engine";
import type { SupplyOsPanel } from "@/lib/supply-os/panel-routing";
import {
  missingSourcingFields,
  normalizeSourcingRequestDraft,
  shouldLoadSourcingHistory,
  sourcingRequestStorageKey,
} from "@/lib/supply-os/sourcing-request-contract";
import { sourcingDraftFromResearchInput } from "@/lib/supply-os/sourcing-research-navigation";
import {
  loadSupplyCases,
  removeLegacySupplyCaseStorage,
  supplyCaseStorageKeys,
  visibleSupplyCases,
} from "./supply-os-storage";
import {
  ATLAS_ROBOTICS_INVENTORY,
  sourcingDeliveryLocation,
  sourcingNeedByDate,
  sourcingRequestQuantity,
  shortageQuantity,
  type AtlasInventoryItem,
} from "@/lib/supply-os/atlas-robotics-inventory";
import { GUILD_SOURCING_ITEMS } from "@/lib/supply-os/guild-sourcing-items";
import { SUPPLY_OS_DEMO_COMPANIES, type SupplyOsDemoCompanyId } from "@/lib/supply-os/demo-company";
import { snapshotResponseToSourcingItems } from "@/lib/supply-os/snapshot-sourcing";
import type { SupplyWorkspaceSnapshotResponse } from "@/lib/supply-os/snapshot-twin";
import { SupplyOsCommandMap } from "./supply-os-command-map";
import { SupplyOsAutomations } from "./supply-os-automations";
import {
  AtlasInventoryWorkspace,
  AtlasSourcingInspector,
  type PendingSourcingQueueItem,
} from "./supply-os-inventory-sourcing";
import { AtlasProcurementWorkspace } from "./supply-os-procurement-workspace";
import type {
  SavedProcurementCase,
  SavedSourcingResearchRun,
  SupplyIntelligenceProfile,
  SourcingQueuePage,
  SupplierSenderAccount,
} from "./supply-os-sourcing-research-types";
import styles from "./supply-os-logistics.module.css";

function storedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return normalized || null;
}

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
  workspaceId,
  workspaceName,
  presentationMode = false,
  activePanel = "materials",
  canImportSupplyData = false,
  canApproveProcurement = false,
  canAuthorizePurchase = false,
  demoCompanyId,
  onWorkspaceProfile,
}: {
  storageScope: string;
  workspaceId?: string | null;
  workspaceName?: string | null;
  presentationMode?: boolean;
  activePanel?: SupplyOsPanel;
  canImportSupplyData?: boolean;
  canApproveProcurement?: boolean;
  canAuthorizePurchase?: boolean;
  demoCompanyId?: SupplyOsDemoCompanyId;
  onWorkspaceProfile?: (profile: {
    companyName: string;
    logoUrl: string | null;
    facilityLabel: string | null;
    locationCount: number;
  }) => void;
}) {
  const keys = useMemo(() => supplyCaseStorageKeys(storageScope), [storageScope]);
  const [savedCases, setSavedCases] = useState<SupplyCaseDashboard[]>([]);
  const [activeCase, setActiveCase] = useState<SupplyCaseDashboard | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [workspaceResearch, setWorkspaceResearch] = useState<SupplyCompanyResearch | null>(null);
  const [profileState, setProfileState] = useState<"idle" | "loading" | "researching" | "ready" | "error">("idle");
  const [profileRevision, setProfileRevision] = useState(0);

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
    if (!workspaceId) {
      setWorkspaceResearch(null);
      setProfileState("idle");
      return;
    }
    const controller = new AbortController();
    const profileUrl = `/api/supply-os/workspaces/${encodeURIComponent(workspaceId)}/company-profile`;
    setWorkspaceResearch(null);
    setProfileState("loading");

    void (async () => {
      const getResponse = await fetch(profileUrl, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const getBody = await getResponse.json().catch(() => ({})) as { research?: unknown };
      if (!getResponse.ok) throw new Error("Company profile could not be loaded.");
      let research = parseSupplyCompanyResearch(getBody.research);

      if (!research) {
        setProfileState("researching");
        const researchResponse = await fetch(profileUrl, {
          method: "POST",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        const researchBody = await researchResponse.json().catch(() => ({})) as { research?: unknown };
        if (!researchResponse.ok) throw new Error("Company profile research did not finish.");
        research = parseSupplyCompanyResearch(researchBody.research);
      }
      if (!research) throw new Error("Company profile research returned no attributable profile.");

      setWorkspaceResearch(research);
      onWorkspaceProfile?.({
        companyName: research.company.name.value,
        logoUrl: research.company.logoUrl,
        facilityLabel: research.company.headquarters?.value ?? research.company.locations[0]?.value ?? null,
        locationCount: research.company.locations.length,
      });
      setProfileState("ready");
    })().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setWorkspaceResearch(null);
      setProfileState("error");
    });

    return () => controller.abort();
  }, [onWorkspaceProfile, profileRevision, workspaceId]);

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
  const workspaceCase = useMemo(() => {
    if (!workspaceId || !workspaceName || profileState !== "ready" || !workspaceResearch) return null;
    return generateSupplyCase(
      workspaceResearch.query || `Company: ${workspaceName}`,
      new Date(workspaceResearch.researchedAt),
      "full_operation",
      workspaceResearch,
    );
  }, [profileState, workspaceId, workspaceName, workspaceResearch]);
  const browserCase = activeCase && visibleCases.some((item) => item.id === activeCase.id)
    ? activeCase
    : visibleCases[0] ?? null;
  const currentCase = workspaceId ? workspaceCase : browserCase;
  const resolvedDemoCompanyId = workspaceId ? null : demoCompanyId ?? "atlas-robotics";

  return (
    <div className={`${styles.workspace} ${styles.commandWorkspace} ${presentationMode ? styles.presentationWorkspace : ""} supply-os-workspace`}>
      {!storageReady || (workspaceId && ["loading", "researching"].includes(profileState)) ? (
        <CommandState
          title={profileState === "researching" ? "Researching company profile" : "Loading customer network"}
          detail={profileState === "researching"
            ? "Checking the official website and attributable public sources."
            : workspaceId ? "Opening the shared company profile." : "Opening saved customer data from this browser."}
        />
      ) : workspaceId && profileState === "error" ? (
        <CommandState
          title="Company profile unavailable"
          detail="No demo locations or inventory were substituted. Retry the public research."
          action={<button type="button" onClick={() => setProfileRevision((revision) => revision + 1)}>Retry profile</button>}
        />
      ) : currentCase ? (
        activePanel === "automations" ? (
          <SupplyOsAutomations key={currentCase.id} company={dashboardName(currentCase)} />
        ) : (
          <CaseCommandCenter
            key={`${currentCase.id}:${workspaceId ?? "demo"}`}
            dashboard={currentCase}
            presentationMode={presentationMode}
            activePanel={activePanel}
            storageScope={storageScope}
            workspaceId={workspaceId}
            canImportSupplyData={canImportSupplyData}
            canApproveProcurement={canApproveProcurement}
            canAuthorizePurchase={canAuthorizePurchase}
            demoCompanyId={resolvedDemoCompanyId}
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
  storageScope,
  workspaceId,
  canImportSupplyData,
  canApproveProcurement,
  canAuthorizePurchase,
  demoCompanyId,
}: {
  dashboard: SupplyCaseDashboard;
  presentationMode: boolean;
  activePanel: SupplyOsPanel;
  storageScope: string;
  workspaceId?: string | null;
  canImportSupplyData: boolean;
  canApproveProcurement: boolean;
  canAuthorizePurchase: boolean;
  demoCompanyId: SupplyOsDemoCompanyId | null;
}) {
  const demoInventoryItems = demoCompanyId === "guild"
    ? GUILD_SOURCING_ITEMS
    : demoCompanyId === "atlas-robotics" ? ATLAS_ROBOTICS_INVENTORY : [];
  const companyName = demoCompanyId
    ? SUPPLY_OS_DEMO_COMPANIES[demoCompanyId].name
    : dashboardName(dashboard);
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
    demoInventoryItems.find((item) => shortageQuantity(item) > 0)?.sku
      ?? demoInventoryItems[0]?.sku
      ?? "",
  );
  const [workspaceInventoryItems, setWorkspaceInventoryItems] = useState<AtlasInventoryItem[]>([]);
  const [workspaceSnapshotRevision, setWorkspaceSnapshotRevision] = useState(0);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Record<string, string>>({});
  const [sourceMapCandidateId, setSourceMapCandidateId] = useState<string | null>(null);
  const [sourceMapObjectId, setSourceMapObjectId] = useState("");
  const [pendingSourcingRequests, setPendingSourcingRequests] = useState<PendingSourcingQueueItem[]>([]);
  const [pendingSourcingStorageReady, setPendingSourcingStorageReady] = useState(false);
  const [procurementRequest, setProcurementRequest] = useState<{
    requestId: string | null;
    requestText: string;
    itemSku: string | null;
    initialDraft: PendingSourcingQueueItem["draft"];
    initialMissingFields: PendingSourcingQueueItem["missingFields"];
    initialQuestion: string | null;
    savedRun?: SavedSourcingResearchRun | null;
    savedCase?: SavedProcurementCase | null;
    savedCases?: SavedProcurementCase[];
  } | null>(null);
  const [researchRuns, setResearchRuns] = useState<SavedSourcingResearchRun[]>([]);
  const [procurementCases, setProcurementCases] = useState<SavedProcurementCase[]>([]);
  const [supplierSenderAccounts, setSupplierSenderAccounts] = useState<SupplierSenderAccount[]>([]);
  const [intelligenceProfile, setIntelligenceProfile] = useState<SupplyIntelligenceProfile | null>(null);
  const [sourcingDataState, setSourcingDataState] = useState<"loading" | "ready" | "error">("loading");
  const [sourcingNextCursor, setSourcingNextCursor] = useState<string | null>(null);
  const [sourcingPageState, setSourcingPageState] = useState<"idle" | "loading" | "error">("idle");
  const [sourcingLoadRevision, setSourcingLoadRevision] = useState(0);
  const commandStageRef = useRef<HTMLDivElement | null>(null);
  const activePendingRequestIdRef = useRef<string | null>(null);
  const pendingSourcingStorageKey = useMemo(
    () => sourcingRequestStorageKey({ storageScope, dashboardId: modelDashboard.id, workspaceId }),
    [modelDashboard.id, storageScope, workspaceId],
  );
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
  const inventoryItems = workspaceId ? workspaceInventoryItems : demoInventoryItems;
  const selectedInventoryItem = inventoryItems.find((item) => item.sku === selectedInventorySku)
    ?? inventoryItems[0];
  const selectedSourceCandidate = selectedInventoryItem?.candidates.find((candidate) => candidate.id === sourceMapCandidateId)
    ?? null;
  const sourceMapContext = useMemo(() => {
    if (!selectedInventoryItem || !selectedSourceCandidate) return null;
    const factory = commandMap.objects.find((object) => object.kind === "factory") ?? null;
    const supplier: SupplyCommandObject = {
      id: `demo-source:${selectedSourceCandidate.id}`,
      kind: "supplier",
      label: selectedSourceCandidate.name,
      location: selectedSourceCandidate.location,
      coordinates: selectedSourceCandidate.coordinates,
      detail: selectedSourceCandidate.fit,
      cargo: selectedInventoryItem.name,
      basis: "inferred",
      confidence: "low",
      status: "review",
      statusLabel: "Demo candidate",
      nextAction: "Qualify technical fit and commercial terms before outreach.",
      workstreamId: "supplier_outreach",
      contacts: [],
      checks: [{ label: "Qualification evidence", status: "missing" }],
      priority: null,
      optimizationIds: [],
    };
    const objects = factory ? [supplier, factory] : [supplier];
    const routes: SupplyCommandRoute[] = factory ? [{
      id: `demo-source-route:${selectedSourceCandidate.id}`,
      edgeId: `demo-source-edge:${selectedSourceCandidate.id}`,
      from: supplier.coordinates,
      to: factory.coordinates,
      fromLabel: supplier.label,
      toLabel: factory.label,
      label: `${supplier.location} to ${factory.location}`,
      mode: supplier.location.includes("USA") || /, (CA|IL|TX)$/.test(supplier.location) ? "road" : "ocean",
      cargo: selectedInventoryItem.name,
      stage: "inbound",
      basis: "inferred",
      confidence: "low",
      priority: null,
      rateEstimate: null,
      segments: [{
        id: `demo-source-segment:${selectedSourceCandidate.id}`,
        sequence: 1,
        mode: supplier.location.includes("USA") || /, (CA|IL|TX)$/.test(supplier.location) ? "road" : "ocean",
        label: "Modeled source route",
        from: supplier.coordinates,
        to: factory.coordinates,
        fromLabel: supplier.label,
        toLabel: factory.label,
        status: "inferred",
      }],
    }] : [];
    const map: SupplyCommandMap = { objects, routes, insights: [] };
    return { map, supplier };
  }, [commandMap.objects, selectedInventoryItem, selectedSourceCandidate]);
  const selectedSourceMapObject = sourceMapContext?.map.objects.find((object) => object.id === sourceMapObjectId)
    ?? sourceMapContext?.supplier
    ?? null;
  const procurementItem = procurementRequest?.itemSku
    ? inventoryItems.find((item) => item.sku === procurementRequest.itemSku) ?? null
    : null;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setInspectorMode(domain.defaultInspector);
  }, [activePanel, domain.defaultInspector]);

  useEffect(() => {
    if (!workspaceId) {
      setWorkspaceInventoryItems([]);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/supply-os/workspaces/${encodeURIComponent(workspaceId)}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as Partial<SupplyWorkspaceSnapshotResponse> & { error?: string };
      if (!response.ok || !body.workspace) throw new Error(body.error || "Published parts are unavailable.");
      setWorkspaceInventoryItems(snapshotResponseToSourcingItems(body as SupplyWorkspaceSnapshotResponse));
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setWorkspaceInventoryItems([]);
    });
    return () => controller.abort();
  }, [workspaceId, workspaceSnapshotRevision]);

  useEffect(() => {
    if (inventoryItems.some((item) => item.sku === selectedInventorySku)) return;
    setSelectedInventorySku(inventoryItems[0]?.sku ?? "");
    setSourceMapCandidateId(null);
    setSourceMapObjectId("");
  }, [inventoryItems, selectedInventorySku]);

  useEffect(() => {
    activePendingRequestIdRef.current = procurementRequest?.requestId ?? null;
  }, [procurementRequest?.requestId]);

  useEffect(() => {
    setPendingSourcingStorageReady(false);
    try {
      const parsed = JSON.parse(window.localStorage.getItem(pendingSourcingStorageKey) ?? "[]") as unknown;
      const statuses = new Set<PendingSourcingQueueItem["status"]>([
        "Clarification needed",
        "Researching",
        "Research unavailable",
      ]);
      const requests = Array.isArray(parsed) ? parsed.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const request = value as Record<string, unknown>;
        const id = storedText(request.id, 100);
        const requestText = storedText(request.requestText, 240);
        const title = storedText(request.title, 240);
        if (!id || !requestText || !title || !statuses.has(request.status as PendingSourcingQueueItem["status"])) return [];
        const draft = request.draft && typeof request.draft === "object" && !Array.isArray(request.draft)
          ? normalizeSourcingRequestDraft(request.draft)
          : null;
        return [{
          id,
          requestText,
          title,
          draft,
          missingFields: draft ? missingSourcingFields(draft) : [],
          lastQuestion: storedText(request.lastQuestion, 500),
          status: request.status as PendingSourcingQueueItem["status"],
        } satisfies PendingSourcingQueueItem];
      }).slice(0, 20) : [];
      setPendingSourcingRequests(requests);
    } catch {
      setPendingSourcingRequests([]);
    }
    setPendingSourcingStorageReady(true);
  }, [pendingSourcingStorageKey]);

  useEffect(() => {
    if (!pendingSourcingStorageReady) return;
    try {
      window.localStorage.setItem(pendingSourcingStorageKey, JSON.stringify(pendingSourcingRequests.slice(0, 20)));
    } catch {
      // Browser storage is optional. The mounted queue remains usable.
    }
  }, [pendingSourcingRequests, pendingSourcingStorageKey, pendingSourcingStorageReady]);

  useEffect(() => {
    if (!procurementRequest) return;
    commandStageRef.current?.scrollTo({ top: 0, left: 0 });
    window.scrollTo({ top: 0, left: 0 });
  }, [procurementRequest]);

  useEffect(() => {
    if (!shouldLoadSourcingHistory({ workspaceId, demoCompanyId })) {
      setResearchRuns([]);
      setProcurementCases([]);
      setSupplierSenderAccounts([]);
      setSourcingNextCursor(null);
      setSourcingPageState("idle");
      setSourcingDataState("ready");
      return;
    }
    const controller = new AbortController();
    setSourcingDataState("loading");
    setSourcingNextCursor(null);
    setSourcingPageState("idle");
    const params = workspaceId ? new URLSearchParams({ workspaceId }) : null;
    void fetch(`/api/supply-os/supplier-research${params ? `?${params.toString()}` : ""}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    }).then(async (response) => {
      if (!response.ok) throw new Error("Saved sourcing work is unavailable.");
      const payload = await response.json() as { runs?: SavedSourcingResearchRun[]; cases?: SavedProcurementCase[]; senderAccounts?: SupplierSenderAccount[]; intelligenceProfile?: SupplyIntelligenceProfile | null; page?: SourcingQueuePage };
      setResearchRuns(payload.runs ?? []);
      setProcurementCases(payload.cases ?? []);
      setSupplierSenderAccounts(payload.senderAccounts ?? []);
      setIntelligenceProfile(payload.intelligenceProfile ?? null);
      setSourcingNextCursor(payload.page?.nextCursor ?? null);
      setSourcingDataState("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setSourcingDataState("error");
    });
    return () => controller.abort();
  }, [demoCompanyId, sourcingLoadRevision, workspaceId]);

  async function loadOlderSourcingWork() {
    if (!sourcingNextCursor || sourcingPageState === "loading") return;
    setSourcingPageState("loading");
    try {
      const params = new URLSearchParams({ cursor: sourcingNextCursor });
      if (workspaceId) params.set("workspaceId", workspaceId);
      const response = await fetch(`/api/supply-os/supplier-research?${params.toString()}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Older sourcing work is unavailable.");
      const payload = await response.json() as { runs?: SavedSourcingResearchRun[]; cases?: SavedProcurementCase[]; senderAccounts?: SupplierSenderAccount[]; page?: SourcingQueuePage };
      setResearchRuns((current) => {
        const currentIds = new Set(current.map((run) => run.id));
        return [...current, ...(payload.runs ?? []).filter((run) => !currentIds.has(run.id))];
      });
      setProcurementCases((current) => {
        const currentIds = new Set(current.map((procurementCase) => procurementCase.id));
        return [...current, ...(payload.cases ?? []).filter((procurementCase) => !currentIds.has(procurementCase.id))];
      });
      setSupplierSenderAccounts((current) => {
        const currentIds = new Set(current.map((account) => account.id));
        return [...current, ...(payload.senderAccounts ?? []).filter((account) => !currentIds.has(account.id))];
      });
      setSourcingNextCursor(payload.page?.nextCursor ?? null);
      setSourcingPageState("idle");
    } catch {
      setSourcingPageState("error");
    }
  }

  const saveResearchRun = useCallback((run: SavedSourcingResearchRun) => {
    setResearchRuns((current) => [run, ...current.filter((candidate) => candidate.id !== run.id)]);
    const requestId = activePendingRequestIdRef.current;
    if (requestId) {
      setPendingSourcingRequests((current) => current.filter((request) => request.id !== requestId));
    }
    setProcurementRequest((current) => current?.requestText === run.input.requestText
      ? { ...current, requestId: null, savedRun: run }
      : current);
  }, []);

  const saveProcurementCase = useCallback((procurementCase: SavedProcurementCase) => {
    setProcurementCases((current) => [
      procurementCase,
      ...current.filter((candidate) => candidate.id !== procurementCase.id),
    ]);
    setProcurementRequest((current) => {
      if (!current || current.savedRun?.id !== procurementCase.input.researchRunId) return current;
      const savedCases = [
        procurementCase,
        ...(current.savedCases ?? []).filter((candidate) => candidate.id !== procurementCase.id),
      ];
      return {
        ...current,
        savedCases,
        savedCase: current.savedCase?.id === procurementCase.id ? procurementCase : current.savedCase ?? procurementCase,
      };
    });
  }, []);

  function selectNetworkObject(object: SupplyCommandObject) {
    setSelection({ panel: activePanel, objectId: object.id });
    setInspectorMode("object");
  }

  function focusOptimizationAction(actionId: string) {
    const related = commandMap.objects.find((object) => object.optimizationIds.includes(actionId));
    if (related) setSelection({ panel: activePanel, objectId: related.id });
  }

  function selectInventoryItem(sku: string) {
    setSelectedInventorySku(sku);
    setSourceMapCandidateId(null);
    setSourceMapObjectId("");
  }

  function showCandidateSource(candidateId: string) {
    setSelectedCandidateIds((current) => ({ ...current, [selectedInventoryItem.sku]: candidateId }));
    setSourceMapCandidateId(candidateId);
    setSourceMapObjectId(`demo-source:${candidateId}`);
  }

  function startProcurement(item: typeof selectedInventoryItem, requestText?: string) {
    if (!item) return;
    setSourceMapCandidateId(null);
    setSourceMapObjectId("");
    const requestedQuantity = sourcingRequestQuantity(item);
    const needByDate = sourcingNeedByDate(item);
    const deliveryLocation = sourcingDeliveryLocation(item);
    const completePublishedItem = item.source === "published-snapshot"
      && requestedQuantity !== null
      && Boolean(needByDate)
      && Boolean(deliveryLocation);
    const generatedRequestText = requestText
      ?? (item.source === "published-snapshot"
        ? `${requestedQuantity ?? "Unknown quantity"} ${item.unitOfMeasure ?? "units"} of ${item.name}. ${item.specification}`
        : [
          `${item.requirementLabel ?? `${shortageQuantity(item)} ${item.requestedUnit ?? "units"}`} of ${item.name}`,
          item.specification,
          item.supplierDeliverable ? `Supplier QA: ${item.supplierDeliverable}` : null,
          `Company: ${companyName}`,
        ].filter(Boolean).join(". "));
    setProcurementRequest({
      requestId: null,
      itemSku: completePublishedItem || item.source !== "published-snapshot" ? item.sku : null,
      requestText: generatedRequestText,
      initialDraft: item.source === "published-snapshot" ? {
        productName: item.name,
        quantity: requestedQuantity,
        unit: item.requestedUnit ?? item.unitOfMeasure ?? null,
        manufacturer: item.manufacturer ?? null,
        partNumber: item.mpn ?? null,
        specification: item.specification,
        sourceRegion: null,
        deliveryLocation,
        needByDate,
      } : null,
      initialMissingFields: item.source === "published-snapshot" ? missingSourcingFields({
        productName: item.name,
        quantity: requestedQuantity,
        unit: item.requestedUnit ?? item.unitOfMeasure ?? null,
        manufacturer: item.manufacturer ?? null,
        partNumber: item.mpn ?? null,
        specification: item.specification,
        sourceRegion: null,
        deliveryLocation,
        needByDate,
      }) : [],
      initialQuestion: completePublishedItem || item.source !== "published-snapshot"
        ? null
        : "Provide the missing quantity, delivery location, or need-by date before research starts.",
    });
  }

  function createProcurementRequest(requestText: string) {
    const normalized = requestText.toLowerCase();
    const matchedItem = inventoryItems.find((item) => (
      normalized.includes(item.sku.toLowerCase())
      || normalized.includes(item.name.toLowerCase())
    )) ?? null;
    if (matchedItem) setSelectedInventorySku(matchedItem.sku);
    setSourceMapCandidateId(null);
    setSourceMapObjectId("");
    if (matchedItem) {
      setProcurementRequest({
        requestId: null,
        requestText,
        itemSku: matchedItem.sku,
        initialDraft: null,
        initialMissingFields: [],
        initialQuestion: null,
      });
      return;
    }
    const requestId = crypto.randomUUID();
    const request: PendingSourcingQueueItem = {
      id: requestId,
      requestText,
      title: requestText,
      draft: null,
      missingFields: [],
      lastQuestion: null,
      status: "Clarification needed",
    };
    setPendingSourcingRequests((current) => [request, ...current]);
    setProcurementRequest({
      requestId,
      requestText,
      itemSku: null,
      initialDraft: null,
      initialMissingFields: [],
      initialQuestion: null,
    });
  }

  function openPendingSourcingRequest(request: PendingSourcingQueueItem) {
    setSourceMapCandidateId(null);
    setSourceMapObjectId("");
    setProcurementRequest({
      requestId: request.id,
      requestText: request.requestText,
      itemSku: null,
      initialDraft: request.draft,
      initialMissingFields: request.missingFields,
      initialQuestion: request.lastQuestion,
    });
  }

  function updatePendingSourcingRequest(requestId: string, update: Partial<PendingSourcingQueueItem>) {
    setPendingSourcingRequests((current) => current.map((request) => (
      request.id === requestId
        ? { ...request, ...update, id: request.id, requestText: request.requestText }
        : request
    )));
  }

  function openSavedResearch(run: SavedSourcingResearchRun) {
    const matchedItem = inventoryItems.find((item) => item.sku === run.input.componentItemKey) ?? null;
    if (matchedItem) setSelectedInventorySku(matchedItem.sku);
    setSourceMapCandidateId(null);
    setSourceMapObjectId("");
    const savedCases = procurementCases.filter((candidate) => candidate.input.researchRunId === run.id);
    const savedCase = savedCases.find((candidate) => candidate.result?.sourcingReturn)
      ?? savedCases.find((candidate) => candidate.result?.purchaseRevision)
      ?? savedCases.find((candidate) => candidate.result?.purchaseRelease?.revisionRequiredCount)
      ?? savedCases.find((candidate) => candidate.result?.purchaseRelease?.openSupplierExceptionCount)
      ?? savedCases.find((candidate) => candidate.quoteCycle?.result?.responses.length)
      ?? savedCases.find((candidate) => candidate.quoteCycle?.result?.state === "AWAITING_RESPONSE")
      ?? savedCases[0]
      ?? null;
    setProcurementRequest({
      requestId: null,
      requestText: run.input.requestText || run.input.componentName,
      itemSku: matchedItem?.sku ?? null,
      initialDraft: matchedItem ? null : sourcingDraftFromResearchInput(run.input),
      initialMissingFields: [],
      initialQuestion: null,
      savedRun: run,
      savedCase,
      savedCases,
    });
  }

  function retrySavedResearch(run: SavedSourcingResearchRun) {
    const matchedItem = inventoryItems.find((item) => item.sku === run.input.componentItemKey) ?? null;
    if (matchedItem) setSelectedInventorySku(matchedItem.sku);
    setSourceMapCandidateId(null);
    setSourceMapObjectId("");
    setProcurementRequest({
      requestId: null,
      requestText: run.input.requestText || run.input.componentName,
      itemSku: matchedItem?.sku ?? null,
      initialDraft: sourcingDraftFromResearchInput(run.input),
      initialMissingFields: [],
      initialQuestion: null,
      savedRun: null,
      savedCase: null,
      savedCases: [],
    });
  }

  return (
    <article
      className={styles.commandCenter}
      aria-label={`${domain.railTitle} workspace`}
      data-domain={activePanel}
      data-embedded={!presentationMode}
      data-procurement={activePanel === "materials" && Boolean(procurementRequest)}
    >
      <div ref={commandStageRef} className={styles.commandMapStage}>
        <AnimatePresence mode="wait" initial={false}>
        {activePanel === "materials" && procurementRequest ? (
          <AtlasProcurementWorkspace
            key={`procurement:${procurementRequest.itemSku ?? procurementRequest.requestText}`}
            item={procurementItem}
            requestText={procurementRequest.requestText}
            workspaceId={workspaceId}
            initialDraft={procurementRequest.initialDraft}
            initialMissingFields={procurementRequest.initialMissingFields}
            initialQuestion={procurementRequest.initialQuestion}
            initialRun={procurementRequest.savedRun}
            initialCase={procurementRequest.savedCase}
            initialCases={procurementRequest.savedCases}
            canApproveProcurement={canApproveProcurement}
            canAuthorizePurchase={canAuthorizePurchase}
            senderAccounts={supplierSenderAccounts}
            onIntelligenceUpdated={setIntelligenceProfile}
            onResearchSaved={saveResearchRun}
            onProcurementCaseSaved={saveProcurementCase}
            onRequestUpdate={procurementRequest.requestId
              ? (update) => updatePendingSourcingRequest(procurementRequest.requestId!, update)
              : undefined}
            onBack={() => setProcurementRequest(null)}
          />
        ) : activePanel === "materials" ? (
          <AtlasInventoryWorkspace
            key={`sourcing-queue:${workspaceId ?? demoCompanyId ?? modelDashboard.id}`}
            selectedSku={selectedInventoryItem?.sku ?? ""}
            items={inventoryItems}
            companyName={companyName}
            workspaceId={workspaceId}
            canImportSupplyData={canImportSupplyData}
            onSnapshotPublished={() => setWorkspaceSnapshotRevision((revision) => revision + 1)}
            onSelect={selectInventoryItem}
            onCreateRequest={createProcurementRequest}
            onRetryResearch={retrySavedResearch}
            pendingRequests={pendingSourcingRequests}
            onOpenPendingRequest={openPendingSourcingRequest}
            researchRuns={researchRuns}
            procurementCases={procurementCases}
            intelligenceProfile={intelligenceProfile}
            dataState={sourcingDataState}
            hasMore={Boolean(sourcingNextCursor)}
            pageState={sourcingPageState}
            onRetryData={() => setSourcingLoadRevision((revision) => revision + 1)}
            onLoadMore={loadOlderSourcingWork}
            onStartItemResearch={(item) => startProcurement(item)}
            onOpenSavedResearch={openSavedResearch}
            sourceName={selectedSourceCandidate?.name}
            sourceLocation={selectedSourceCandidate?.location}
            onHideSourceMap={() => {
              setSourceMapCandidateId(null);
              setSourceMapObjectId("");
            }}
            sourceMap={sourceMapContext ? (
              <SupplyOsCommandMap
                key={selectedSourceCandidate?.id}
                commandMap={sourceMapContext.map}
                selectedObject={selectedSourceMapObject}
                onSelectObject={(object) => setSourceMapObjectId(object.id)}
                activePanel="materials"
              />
            ) : undefined}
          />
        ) : (
          <>
            <section className={styles.mapPanel} aria-label={`${domain.railTitle} map`}>
              <SupplyOsCommandMap
                commandMap={commandMap}
                selectedObject={selectedObject}
                onSelectObject={selectNetworkObject}
                activePanel={activePanel}
              />
            </section>
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
          </>
        )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
        {activePanel === "materials" && selectedInventoryItem && !procurementRequest ? (
          <AtlasSourcingInspector
            key={`sourcing-inspector:${selectedInventoryItem.sku}`}
            item={selectedInventoryItem}
            selectedCandidateId={selectedCandidateIds[selectedInventoryItem.sku] ?? null}
            onSelectCandidate={(candidateId) => {
              setSelectedCandidateIds((current) => ({ ...current, [selectedInventoryItem.sku]: candidateId }));
              setSourceMapCandidateId(null);
              setSourceMapObjectId("");
            }}
            onShowCandidateSource={showCandidateSource}
            onStartProcurement={() => startProcurement(selectedInventoryItem)}
          />
        ) : activePanel !== "materials" && selectedObject ? (
          <CommandInspector
            key={`command-inspector:${activePanel}:${selectedObject.id}`}
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
        </AnimatePresence>

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
          <Tabs.Trigger value="optimization">Priorities</Tabs.Trigger>
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
