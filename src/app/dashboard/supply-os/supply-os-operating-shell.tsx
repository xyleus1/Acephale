"use client";

import {
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogoMark } from "@/components/logo-mark";
import { SupplyOsCompanyIndex } from "./supply-os-company-index";
import { SupplyOsDashboardWorkspace } from "./supply-os-dashboard";
import type { SupplyOsWorkspaceSelection } from "./supply-os-shared-workspace";
import { normalizeSupplyOsPanel, supplyOsPanelHref, type SupplyOsPanel } from "@/lib/supply-os/panel-routing";
import styles from "./supply-os-operating-shell.module.css";

type PanelDefinition = {
  id: SupplyOsPanel;
  shortLabel: string;
  inactive?: boolean;
};

const PANELS: PanelDefinition[] = [
  { id: "materials", shortLabel: "Inventory & sourcing" },
  { id: "logistics", shortLabel: "Logistics" },
  { id: "scenarios", shortLabel: "Opportunities", inactive: true },
  { id: "context", shortLabel: "Context" },
];

function panelFromCurrentUrl() {
  if (typeof window === "undefined") return "materials";
  return normalizeSupplyOsPanel(new URLSearchParams(window.location.search).get("panel"));
}

export function SupplyOsOperatingShell({
  storageScope,
  accountRole,
  initialPanel,
  canCreateCompany,
  canImportSupplyData,
  canApproveProcurement,
  canAuthorizePurchase,
  contextEnabled,
}: {
  storageScope: string;
  accountRole: string;
  initialPanel?: string;
  canCreateCompany: boolean;
  canImportSupplyData: boolean;
  canApproveProcurement: boolean;
  canAuthorizePurchase: boolean;
  contextEnabled: boolean;
}) {
  const settingsLabel = `${accountRole.slice(0, 1)}${accountRole.slice(1).toLowerCase()} settings`;
  const [activePanel, setActivePanel] = useState<SupplyOsPanel>(() => normalizeSupplyOsPanel(initialPanel));
  const [companyIndexOpen, setCompanyIndexOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workspaceSelection, setWorkspaceSelection] = useState<SupplyOsWorkspaceSelection>(null);
  const [workspaceToRestore, setWorkspaceToRestore] = useState<string | null | undefined>(undefined);
  const [workspaceProfile, setWorkspaceProfile] = useState<{
    companyName: string;
    logoUrl: string | null;
    facilityLabel: string | null;
    locationCount: number;
  } | null>(null);
  const panelNavRef = useRef<HTMLElement>(null);
  const workspaceStorageKey = `derya:supply-os:last-workspace:${storageScope}`;
  const openWorkspace = useCallback((selection: SupplyOsWorkspaceSelection) => {
    if (!selection) return;
    try {
      window.localStorage.setItem(workspaceStorageKey, selection.workspaceId);
    } catch {
      // Browser privacy settings can disable storage. The workspace still opens for this session.
    }
    setWorkspaceToRestore(null);
    setWorkspaceSelection(selection);
    setWorkspaceProfile(null);
    setCompanyIndexOpen(false);
  }, [workspaceStorageKey]);
  const clearStoredWorkspace = useCallback(() => {
    try {
      window.localStorage.removeItem(workspaceStorageKey);
    } catch {
      // Storage may be unavailable. Clearing the in-memory restore target is sufficient.
    }
    setWorkspaceToRestore(null);
  }, [workspaceStorageKey]);
  const companyName = workspaceProfile?.companyName
    ?? workspaceSelection?.workspaceName
    ?? "Company";
  const companyLogoUrl = workspaceProfile?.logoUrl
    ?? workspaceSelection?.logoUrl
    ?? null;
  const companyInitials = useMemo(
    () => companyName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
    [companyName],
  );

  useEffect(() => {
    try {
      setWorkspaceToRestore(window.localStorage.getItem(workspaceStorageKey));
    } catch {
      setWorkspaceToRestore(null);
    }
  }, [workspaceStorageKey]);

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
    setCompanyIndexOpen(!workspaceSelection);
  }, [workspaceSelection]);

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
            {PANELS.filter((panel) => panel.id !== "context" || contextEnabled).map((panel, index) => {
              const active = panel.id === activePanel;
              return (
                <motion.button
                  key={panel.id}
                  type="button"
                  aria-label={`${String(index + 1).padStart(2, "0")} ${panel.shortLabel}${panel.inactive ? " inactive preview" : ""}`}
                  aria-pressed={active}
                  data-active={active}
                  data-availability={panel.inactive ? "inactive" : "active"}
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
                  {panel.inactive ? <span className={styles.inactiveLabel}>Inactive</span> : null}
                </motion.button>
              );
            })}
          </nav>
          <div className={styles.sidebarUtilityArea}>
            <a
              className={styles.sidebarUtility}
              href="/dashboard/settings"
              aria-label={settingsLabel}
              title={settingsLabel}
            >
              <Settings size={18} aria-hidden="true" />
              <span>{settingsLabel}</span>
            </a>
          </div>
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
                <div>
                  <dt>Facility</dt>
                  <dd>
                    {companyIndexOpen
                      ? "None selected"
                      : workspaceProfile?.facilityLabel ?? "No verified location"}
                  </dd>
                </div>
                <div>
                  <dt>Data</dt>
                  <dd>
                    {workspaceSelection?.snapshotVersion
                      ? `Snapshot v${workspaceSelection.snapshotVersion}`
                      : workspaceProfile ? "Company profile" : "No inventory"}
                  </dd>
                </div>
              </dl>
              <motion.button
                type="button"
                onClick={() => setCompanyIndexOpen(true)}
                whileTap={{ scale: 0.98 }}
                disabled={companyIndexOpen}
              >
                <ArrowLeft size={15} /> Companies
              </motion.button>
            </div>
          </header>

          <div className={styles.panelStage}>
            {companyIndexOpen ? (
              <SupplyOsCompanyIndex
                canCreateCompany={canCreateCompany}
                preferredWorkspaceId={workspaceToRestore}
                onPreferredWorkspaceUnavailable={clearStoredWorkspace}
                autoOpenFirstWorkspace={
                  activePanel === "context"
                    && !workspaceSelection
                }
                onOpenWorkspace={openWorkspace}
              />
            ) : (
              <SupplyOsDashboardWorkspace
                storageScope={storageScope}
                workspaceId={workspaceSelection?.workspaceId ?? null}
                workspaceName={workspaceSelection?.workspaceName ?? null}
                activePanel={activePanel}
                canImportSupplyData={canImportSupplyData}
                canApproveProcurement={canApproveProcurement}
                canAuthorizePurchase={canAuthorizePurchase}
                onOpenContext={() => selectPanel("context")}
                onWorkspaceProfile={setWorkspaceProfile}
              />
            )}
          </div>

        </section>
      </main>
    </MotionConfig>
  );
}
