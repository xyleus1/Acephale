"use client";

import {
  Boxes,
  Database,
  Factory,
  GitCompareArrows,
  Globe2,
  MapPinned,
  PackageSearch,
  Radio,
  ShieldCheck,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SteelSupplierFinder } from "../supplier-finder/steel-supplier-finder";
import { SupplyOsDashboardWorkspace } from "./supply-os-dashboard";
import { SupplyOsSharedWorkspace, type SupplyOsWorkspaceSelection } from "./supply-os-shared-workspace";
import { SupplyOsSnapshotTwin } from "./supply-os-snapshot-twin";
import { normalizeSupplyOsPanel, supplyOsPanelHref, type SupplyOsPanel } from "@/lib/supply-os/panel-routing";
import styles from "./supply-os-operating-shell.module.css";

type PanelDefinition = {
  id: SupplyOsPanel;
  shortLabel: string;
  icon: LucideIcon;
};

const PANELS: PanelDefinition[] = [
  { id: "materials", shortLabel: "Materials", icon: Boxes },
  { id: "logistics", shortLabel: "Network", icon: Globe2 },
  { id: "suppliers", shortLabel: "Suppliers", icon: PackageSearch },
  { id: "scenarios", shortLabel: "Scenarios", icon: GitCompareArrows },
  { id: "tracking", shortLabel: "Tracking", icon: Radio },
];

const PRODUCT_MEDIA = {
  src: "/supply-os/demo/vector3dhd-amr.jpg",
  sourcePage: "https://commons.wikimedia.org/wiki/File:Vector3DHD_autonomous_mobile_robot_and_EnZone_wireless_charging.jpg",
  creator: "PattyK33",
  license: "CC BY-SA 4.0",
  dimensions: "900 x 900 display crop",
  originalDimensions: "2220 x 1480",
  retrievedAt: "2026-08-08",
} as const;

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
          <h2 id="supply-os-tracking-title">Tracking</h2>
          <p>Demo only. No booking, filing, invoice, or spend action is live.</p>
        </div>
        <dl>
          <div><dt>Modeled exposure</dt><dd>$56,850</dd></div>
          <div><dt>Open decisions</dt><dd>1</dd></div>
          <div><dt>At-risk builds</dt><dd>3</dd></div>
        </dl>
      </header>

      <div className={styles.executionGrid}>
        <section className={styles.executionQueue}>
          <header><span>Material paths</span><small>Demo</small></header>
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
          <span><ShieldCheck size={16} /> Approval required</span>
          <h3>External actions stay blocked</h3>
          <ol>
            <li><b>01</b><span><strong>Evidence</strong><small>Attach source and quote</small></span></li>
            <li><b>02</b><span><strong>Review</strong><small>Check cost, timing, compliance</small></span></li>
            <li><b>03</b><span><strong>Release</strong><small>Create external tasks</small></span></li>
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
  const activePanelDefinition = PANELS.find((panel) => panel.id === activePanel) ?? PANELS[0];
  const ActivePanelIcon = activePanelDefinition.icon;

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
    <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <main className={`${styles.shell} supply-os-workspace`} data-panel={activePanel}>
        <motion.aside
          className={styles.operatingSidebar}
          initial={{ x: -12, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          aria-label="Supply OS navigation"
        >
          <div className={styles.sidebarHeading}>
            <span className={styles.sidebarMark}><Boxes size={17} /></span>
            <strong>Supply OS</strong>
          </div>

          <nav className={styles.panelNav} aria-label="Supply OS operating panels">
            {PANELS.map((panel) => {
              const Icon = panel.icon;
              const active = panel.id === activePanel;
              return (
                <motion.button
                  key={panel.id}
                  type="button"
                  aria-pressed={active}
                  data-active={active}
                  onClick={() => selectPanel(panel.id)}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.985 }}
                >
                  {active ? <motion.span className={styles.activeRail} layoutId="supply-os-active-panel" /> : null}
                  <span className={styles.navIcon}><Icon size={16} /></span>
                  <span className={styles.navCopy}>
                    <strong>{panel.shortLabel}</strong>
                  </span>
                  {panel.id === "logistics" ? <span className={styles.liveMapDot} aria-label="Network map available" /> : null}
                </motion.button>
              );
            })}
          </nav>

        </motion.aside>

        <section className={styles.workspace}>
          <header className={styles.commandHeader}>
            <div className={styles.identity}>
              <span className={styles.mark}><ActivePanelIcon size={18} /></span>
              <div>
                <h1>{workspaceSelection?.workspaceName ?? "Atlas Robotics"}</h1>
              </div>
            </div>
            <div className={styles.workspaceControls}>
              <dl>
                <div><dt>Site</dt><dd>{workspaceSelection ? "Published locations" : "Austin"}</dd></div>
                <div><dt>Data</dt><dd>{workspaceSelection?.snapshotVersion ? `Snapshot v${workspaceSelection.snapshotVersion}` : "Demo"}</dd></div>
              </dl>
              <motion.button type="button" onClick={() => setDataControlsOpen(true)} whileTap={{ scale: 0.98 }}>
                <Database size={15} /> Data
              </motion.button>
            </div>
          </header>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className={styles.panelStage}
              key={activePanel}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
            >
              {activePanel === "materials" ? (
                <SupplyOsSnapshotTwin
                  workspaceId={publishedWorkspaceId}
                  fallbackImageUrl={PRODUCT_MEDIA.src}
                  fallbackImageAttribution={{
                    href: PRODUCT_MEDIA.sourcePage,
                    label: "Photo",
                    title: `${PRODUCT_MEDIA.creator}, ${PRODUCT_MEDIA.license}. ${PRODUCT_MEDIA.dimensions}, original ${PRODUCT_MEDIA.originalDimensions}, retrieved ${PRODUCT_MEDIA.retrievedAt}`,
                  }}
                />
              ) : null}
              {activePanel === "suppliers" ? (
                <div className={styles.embeddedPanel}>
                  <SteelSupplierFinder storageScope={storageScope} />
                </div>
              ) : null}
              {activePanel === "scenarios" ? (
                <div className={styles.scenarioFrame}>
                  {intelligencePanel}
                  <SupplyOsSnapshotTwin
                    workspaceId={publishedWorkspaceId}
                    fallbackImageUrl={PRODUCT_MEDIA.src}
                    fallbackImageAttribution={{
                      href: PRODUCT_MEDIA.sourcePage,
                      label: "Photo",
                      title: `${PRODUCT_MEDIA.creator}, ${PRODUCT_MEDIA.license}. ${PRODUCT_MEDIA.dimensions}, original ${PRODUCT_MEDIA.originalDimensions}, retrieved ${PRODUCT_MEDIA.retrievedAt}`,
                    }}
                    view="scenarios"
                  />
                </div>
              ) : null}
              {activePanel === "logistics" ? (
                <SupplyOsDashboardWorkspace storageScope={storageScope} presentationMode={false} />
              ) : null}
              {activePanel === "tracking" ? <TrackingAndCostPanel /> : null}
            </motion.div>
          </AnimatePresence>

        </section>

        <AnimatePresence>
          {dataControlsOpen ? (
            <motion.div
              className={styles.dataOverlay}
              role="presentation"
              onMouseDown={() => setDataControlsOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.section
                className={styles.dataDialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="supply-os-data-dialog-title"
                onMouseDown={(event) => event.stopPropagation()}
                initial={{ opacity: 0, y: 14, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.995 }}
              >
                <header>
                  <h2 id="supply-os-data-dialog-title">Data</h2>
                  <button type="button" aria-label="Close data controls" autoFocus onClick={() => setDataControlsOpen(false)}><X size={17} /></button>
                </header>
                <div className={styles.dataDialogBody}><SupplyOsSharedWorkspace onSelectionChange={handleWorkspaceSelection} /></div>
              </motion.section>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}
