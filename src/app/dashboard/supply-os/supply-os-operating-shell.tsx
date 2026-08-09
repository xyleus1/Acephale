"use client";

import {
  Boxes,
  Database,
  Factory,
  GitCompareArrows,
  MapPinned,
  PackageSearch,
  Radio,
  Route,
  ShieldCheck,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SteelSupplierFinder } from "../supplier-finder/steel-supplier-finder";
import { SupplyOsDashboardWorkspace } from "./supply-os-dashboard";
import { SupplyOsSharedWorkspace, type SupplyOsWorkspaceSelection } from "./supply-os-shared-workspace";
import { SupplyOsSnapshotTwin } from "./supply-os-snapshot-twin";
import { normalizeSupplyOsPanel, supplyOsPanelHref, type SupplyOsPanel } from "@/lib/supply-os/panel-routing";
import styles from "./supply-os-operating-shell.module.css";

type PanelDefinition = {
  id: SupplyOsPanel;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
};

const PANELS: PanelDefinition[] = [
  { id: "materials", label: "Product and materials", shortLabel: "Materials", icon: Boxes },
  { id: "suppliers", label: "Supplier qualification", shortLabel: "Suppliers", icon: PackageSearch },
  { id: "scenarios", label: "Sourcing scenarios", shortLabel: "Scenarios", icon: GitCompareArrows },
  { id: "logistics", label: "Logistics and customs", shortLabel: "Logistics", icon: Route },
  { id: "tracking", label: "Tracking and cost", shortLabel: "Tracking", icon: Radio },
];

const PRODUCT_IMAGE_URL = "https://upload.wikimedia.org/wikipedia/commons/8/8e/Autonomous_Mobile_Robot_AMR.png";

const EXECUTION_ROWS = [
  {
    id: "vision",
    reference: "VIS-410 qualification",
    status: "Decision required",
    place: "Taipei to Austin",
    timing: "Target award Aug 12",
    cost: "$23,520 modeled",
    progress: 36,
    tone: "attention",
  },
  {
    id: "drives",
    reference: "DRV-220 confirmed lot",
    status: "Supplier confirmed",
    place: "Osaka to Austin",
    timing: "ETA Sep 03",
    cost: "$16,080 committed",
    progress: 58,
    tone: "moving",
  },
  {
    id: "frames",
    reference: "FRM-240 frame release",
    status: "Receiving scheduled",
    place: "Monterrey to Austin",
    timing: "Dock Aug 15",
    cost: "$17,250 committed",
    progress: 82,
    tone: "ready",
  },
] as const;

function panelFromCurrentUrl() {
  if (typeof window === "undefined") return "materials";
  return normalizeSupplyOsPanel(new URLSearchParams(window.location.search).get("panel"));
}

function TrackingAndCostPanel() {
  return (
    <section className={styles.trackingPanel} aria-labelledby="supply-os-tracking-title">
      <header className={styles.panelIntro}>
        <div>
          <span>Execution ledger</span>
          <h2 id="supply-os-tracking-title">Parts, movement, customs, and landed cost in one queue</h2>
          <p>Illustrative records show the intended operating model. No carrier booking, filing, invoice, or spend action is live.</p>
        </div>
        <dl>
          <div><dt>Modeled exposure</dt><dd>$56,850</dd></div>
          <div><dt>Open decisions</dt><dd>1</dd></div>
          <div><dt>At-risk builds</dt><dd>3</dd></div>
        </dl>
      </header>

      <div className={styles.executionGrid}>
        <section className={styles.executionQueue}>
          <header><span>Active material paths</span><small>Illustrative fixture</small></header>
          {EXECUTION_ROWS.map((row) => (
            <article key={row.id}>
              <div className={styles.routeMark} data-tone={row.tone}>
                {row.id === "frames" ? <Truck size={17} /> : <Factory size={17} />}
              </div>
              <div className={styles.executionIdentity}>
                <strong>{row.reference}</strong>
                <span><MapPinned size={12} /> {row.place}</span>
              </div>
              <div className={styles.executionState}>
                <strong data-tone={row.tone}>{row.status}</strong>
                <span>{row.timing}</span>
              </div>
              <div className={styles.executionCost}>
                <strong>{row.cost}</strong>
                <span className={styles.progressTrack}><i style={{ width: `${row.progress}%` }} /></span>
              </div>
            </article>
          ))}
        </section>

        <aside className={styles.controlBoundary}>
          <span><ShieldCheck size={16} /> Control boundary</span>
          <h3>Humans release every external action</h3>
          <ol>
            <li><b>01</b><span><strong>Evidence gathered</strong><small>Source, quote, and constraint attached</small></span></li>
            <li><b>02</b><span><strong>Scenario approved</strong><small>Cost, timing, and compliance reviewed</small></span></li>
            <li><b>03</b><span><strong>Execution released</strong><small>Supplier, carrier, and customs tasks created</small></span></li>
          </ol>
        </aside>
      </div>
    </section>
  );
}

export function SupplyOsOperatingShell({
  storageScope,
  presentationMode,
  initialPanel,
  intelligencePanel,
}: {
  storageScope: string;
  presentationMode: boolean;
  initialPanel?: string;
  intelligencePanel?: ReactNode;
}) {
  const [activePanel, setActivePanel] = useState<SupplyOsPanel>(() => normalizeSupplyOsPanel(initialPanel));
  const [dataControlsOpen, setDataControlsOpen] = useState(false);
  const [workspaceSelection, setWorkspaceSelection] = useState<SupplyOsWorkspaceSelection>(null);
  const handleWorkspaceSelection = useCallback((selection: SupplyOsWorkspaceSelection) => {
    setWorkspaceSelection(selection);
  }, []);
  const publishedWorkspaceId = workspaceSelection?.snapshotId ? workspaceSelection.workspaceId : null;

  useEffect(() => {
    const syncPanelFromUrl = () => setActivePanel(panelFromCurrentUrl());
    window.addEventListener("popstate", syncPanelFromUrl);
    return () => window.removeEventListener("popstate", syncPanelFromUrl);
  }, []);

  useEffect(() => {
    if (!dataControlsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDataControlsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dataControlsOpen]);

  const selectPanel = useCallback((panel: SupplyOsPanel) => {
    window.history.pushState({}, "", supplyOsPanelHref(window.location.href, panel));
    setActivePanel(panel);
  }, []);

  if (presentationMode) {
    return <SupplyOsDashboardWorkspace storageScope={storageScope} presentationMode />;
  }

  return (
    <main className={styles.shell} data-panel={activePanel}>
      <header className={styles.commandHeader}>
        <div className={styles.identity}>
          <span className={styles.mark}><Boxes size={18} /></span>
          <div>
            <small>Derya Supply OS</small>
            <h1>{workspaceSelection?.workspaceName ?? "Atlas Robotics operating workspace"}</h1>
          </div>
        </div>
        <div className={styles.workspaceControls}>
          <dl>
            <div><dt>Facility</dt><dd>{workspaceSelection ? "Published locations" : "Austin assembly"}</dd></div>
            <div><dt>Freshness</dt><dd>{workspaceSelection?.snapshotVersion ? `Snapshot v${workspaceSelection.snapshotVersion}` : "Illustrative demo"}</dd></div>
          </dl>
          <button type="button" onClick={() => setDataControlsOpen(true)}>
            <Database size={15} /> Import and data
          </button>
        </div>
      </header>

      <nav className={styles.panelNav} aria-label="Supply OS operating panels">
        {PANELS.map((panel) => {
          const Icon = panel.icon;
          const active = panel.id === activePanel;
          return (
            <button
              key={panel.id}
              type="button"
              aria-pressed={active}
              data-active={active}
              onClick={() => selectPanel(panel.id)}
            >
              <Icon size={15} />
              <span>{panel.shortLabel}</span>
              <small>{panel.label}</small>
            </button>
          );
        })}
      </nav>

      {dataControlsOpen ? (
        <div className={styles.dataOverlay} role="presentation" onMouseDown={() => setDataControlsOpen(false)}>
          <section
            className={styles.dataDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="supply-os-data-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>Shared office data</span>
                <h2 id="supply-os-data-dialog-title">Workspaces, snapshots, and CSV import</h2>
              </div>
              <button type="button" aria-label="Close data controls" autoFocus onClick={() => setDataControlsOpen(false)}><X size={17} /></button>
            </header>
            <div className={styles.dataDialogBody}><SupplyOsSharedWorkspace onSelectionChange={handleWorkspaceSelection} /></div>
          </section>
        </div>
      ) : null}

      <div className={styles.panelStage} key={activePanel}>
        {activePanel === "materials" ? (
          <SupplyOsSnapshotTwin workspaceId={publishedWorkspaceId} fallbackImageUrl={PRODUCT_IMAGE_URL} />
        ) : null}
        {activePanel === "suppliers" ? (
          <div className={styles.embeddedPanel}>
            <SteelSupplierFinder storageScope={storageScope} />
          </div>
        ) : null}
        {activePanel === "scenarios" ? (
          <div className={styles.scenarioFrame}>
            <div className={styles.focusBanner}>
              <span><GitCompareArrows size={15} /> Decision mode</span>
              <p>Select a sourcing plan in the scenario table, then inspect its evidence and human approval boundary.</p>
            </div>
            {intelligencePanel}
            <SupplyOsSnapshotTwin workspaceId={publishedWorkspaceId} fallbackImageUrl={PRODUCT_IMAGE_URL} />
          </div>
        ) : null}
        {activePanel === "logistics" ? (
          <SupplyOsDashboardWorkspace storageScope={storageScope} presentationMode={false} />
        ) : null}
        {activePanel === "tracking" ? <TrackingAndCostPanel /> : null}
      </div>

      <footer className={styles.sourceFooter}>
        <span>Visual evidence</span>
        <a href="https://commons.wikimedia.org/wiki/File:Autonomous_Mobile_Robot_AMR.png" target="_blank" rel="noreferrer">
          AMR image by Rlistmedia, CC BY 4.0
        </a>
      </footer>
    </main>
  );
}
