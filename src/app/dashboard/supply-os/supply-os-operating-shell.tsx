"use client";

import {
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogoMark } from "@/components/logo-mark";
import { SUPPLY_OS_DEMO_COMPANY } from "@/lib/supply-os/demo-company";
import { SupplyOsCompanyIndex } from "./supply-os-company-index";
import { SupplyOsDashboardWorkspace } from "./supply-os-dashboard";
import type { SupplyOsWorkspaceSelection } from "./supply-os-shared-workspace";
import { normalizeSupplyOsPanel, supplyOsPanelHref, type SupplyOsPanel } from "@/lib/supply-os/panel-routing";
import styles from "./supply-os-operating-shell.module.css";

type PanelDefinition = {
  id: SupplyOsPanel;
  shortLabel: string;
};

const PANELS: PanelDefinition[] = [
  { id: "materials", shortLabel: "Inventory & sourcing" },
  { id: "logistics", shortLabel: "Logistics" },
  { id: "fulfillment", shortLabel: "Fulfillment" },
  { id: "scenarios", shortLabel: "Opportunities" },
  { id: "tracking", shortLabel: "Tracking" },
  { id: "automations", shortLabel: "Automations" },
];

function panelFromCurrentUrl() {
  if (typeof window === "undefined") return "materials";
  return normalizeSupplyOsPanel(new URLSearchParams(window.location.search).get("panel"));
}

export function SupplyOsOperatingShell({
  storageScope,
  presentationMode,
  initialPanel,
  canCreateCompany,
  canApproveProcurement,
  canAuthorizePurchase,
}: {
  storageScope: string;
  presentationMode: boolean;
  initialPanel?: string;
  canCreateCompany: boolean;
  canApproveProcurement: boolean;
  canAuthorizePurchase: boolean;
}) {
  const [activePanel, setActivePanel] = useState<SupplyOsPanel>(() => normalizeSupplyOsPanel(initialPanel));
  const [companyIndexOpen, setCompanyIndexOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workspaceSelection, setWorkspaceSelection] = useState<SupplyOsWorkspaceSelection>(null);
  const panelNavRef = useRef<HTMLElement>(null);
  const openWorkspace = useCallback((selection: SupplyOsWorkspaceSelection) => {
    setWorkspaceSelection(selection);
    setCompanyIndexOpen(false);
  }, []);
  const companyName = workspaceSelection?.workspaceName ?? SUPPLY_OS_DEMO_COMPANY.name;
  const companyLogoUrl = workspaceSelection ? workspaceSelection.logoUrl : SUPPLY_OS_DEMO_COMPANY.logoUrl;
  const companyInitials = useMemo(
    () => companyName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
    [companyName],
  );

  useEffect(() => {
    const syncPanelFromUrl = () => setActivePanel(panelFromCurrentUrl());
    window.addEventListener("popstate", syncPanelFromUrl);
    return () => window.removeEventListener("popstate", syncPanelFromUrl);
  }, []);

  useEffect(() => {
    const nav = panelNavRef.current;
    const button = nav?.querySelector<HTMLButtonElement>(`button[data-panel-id="${activePanel}"]`);
    if (!nav || !button) return;
    const buttonStart = button.offsetLeft;
    const buttonEnd = buttonStart + button.offsetWidth;
    if (buttonStart < nav.scrollLeft) nav.scrollTo({ left: buttonStart });
    else if (buttonEnd > nav.scrollLeft + nav.clientWidth) {
      nav.scrollTo({ left: buttonEnd - nav.clientWidth });
    }
  }, [activePanel]);

  const selectPanel = useCallback((panel: SupplyOsPanel) => {
    window.history.pushState({}, "", supplyOsPanelHref(window.location.href, panel));
    setActivePanel(panel);
    setCompanyIndexOpen(false);
  }, []);

  if (presentationMode) {
    return <SupplyOsDashboardWorkspace storageScope={storageScope} presentationMode activePanel={activePanel} canApproveProcurement={canApproveProcurement} canAuthorizePurchase={canAuthorizePurchase} />;
  }

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <main
        className={`${styles.shell} supply-os-workspace`}
        data-panel={activePanel}
        data-company-index={companyIndexOpen}
        data-sidebar-collapsed={sidebarCollapsed}
      >
        <motion.aside
          className={styles.operatingSidebar}
          initial={{ x: -12, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          aria-label="Workspace navigation"
        >
          <div className={styles.sidebarHeader}>
            <a className={styles.operatingBrand} href="/dashboard/supply-os" aria-label="Derya home">
              <LogoMark mini />
              <strong>Derya</strong>
            </a>
            <button
              className={styles.sidebarToggle}
              type="button"
              aria-controls="supply-os-panel-navigation"
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
              title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
              onClick={() => setSidebarCollapsed((current) => !current)}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            </button>
          </div>
          <nav id="supply-os-panel-navigation" ref={panelNavRef} className={styles.panelNav} aria-label="Workspace sections">
            {PANELS.map((panel, index) => {
              const active = panel.id === activePanel;
              return (
                <motion.button
                  key={panel.id}
                  type="button"
                  aria-label={`${String(index + 1).padStart(2, "0")} ${panel.shortLabel}`}
                  aria-pressed={active}
                  data-active={active}
                  data-panel-id={panel.id}
                  onClick={() => selectPanel(panel.id)}
                  whileHover={sidebarCollapsed ? undefined : { x: 2 }}
                  whileTap={{ scale: 0.985 }}
                >
                  {active ? <motion.span className={styles.activeRail} layoutId="supply-os-active-panel" /> : null}
                  <span className={styles.navIndex}>{String(index + 1).padStart(2, "0")}</span>
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
              <span className={styles.companyAvatar} aria-hidden="true">
                {companyIndexOpen ? "CO" : companyInitials}
                {!companyIndexOpen && companyLogoUrl ? (
                  <img src={companyLogoUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
                ) : null}
              </span>
              <div>
                <h1>{companyIndexOpen ? "Companies" : companyName}</h1>
              </div>
            </div>
            <div className={styles.workspaceControls}>
              <dl>
                <div><dt>Facility</dt><dd>{workspaceSelection ? "Published locations" : "Austin"}</dd></div>
                <div><dt>Data</dt><dd>{workspaceSelection?.snapshotVersion ? `Snapshot v${workspaceSelection.snapshotVersion}` : "Demo"}</dd></div>
              </dl>
              <motion.button type="button" onClick={() => setCompanyIndexOpen(true)} whileTap={{ scale: 0.98 }} disabled={companyIndexOpen}>
                <ArrowLeft size={15} /> Companies
              </motion.button>
            </div>
          </header>

          <div className={styles.panelStage}>
            {companyIndexOpen ? (
              <SupplyOsCompanyIndex canCreateCompany={canCreateCompany} onOpenWorkspace={openWorkspace} />
            ) : (
              <SupplyOsDashboardWorkspace
                storageScope={storageScope}
                presentationMode={false}
                activePanel={activePanel}
                canApproveProcurement={canApproveProcurement}
                canAuthorizePurchase={canAuthorizePurchase}
              />
            )}
          </div>

        </section>
      </main>
    </MotionConfig>
  );
}
