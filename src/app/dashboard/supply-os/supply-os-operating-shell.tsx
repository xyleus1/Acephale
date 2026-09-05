"use client";

import {
  ArrowLeft,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Ship,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/logo-mark";
import type { SwitchableOffice } from "@/lib/office-switch";
import { SupplyOsCompanyIndex } from "./supply-os-company-index";
import { SupplyOsDashboardWorkspace } from "./supply-os-dashboard";
import { SupplyOsHeaderSlotContext } from "./supply-os-header-slot";
import type { SupplyProjectSelection } from "./supply-os-inventory-sourcing";
import type { SupplyOsWorkspaceSelection } from "./supply-os-shared-workspace";
import { normalizeSupplyOsPanel, supplyOsPanelHref, type SupplyOsPanel } from "@/lib/supply-os/panel-routing";
import { useSupplyOsPanelAlerts } from "./use-supply-os-panel-alerts";
import styles from "./supply-os-operating-shell.module.css";

type PanelDefinition = {
  id: SupplyOsPanel;
  shortLabel: string;
  icon: LucideIcon;
  inactive?: boolean;
};

type OfficeSwitchAction = (formData: FormData) => void | Promise<void>;

const PANELS: PanelDefinition[] = [
  { id: "materials", shortLabel: "Sales Agent", icon: UserRound },
  { id: "logistics", shortLabel: "Logistics", icon: Ship },
  { id: "context", shortLabel: "Chat", icon: MessagesSquare },
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
  canCreateOffice,
  canImportSupplyData,
  canApproveProcurement,
  canAuthorizePurchase,
  contextEnabled,
  allowedWorkspaceIds,
  initialWorkspaceId,
  initialMaterialsView,
  initialProject,
  initialResearchListSlug,
  initialResearchQuery,
  initialResearchStatus,
  initialResearchPage,
  previewMode = false,
  canViewWholeOffice,
  switchableOffices,
  switchOfficeAction,
}: {
  storageScope: string;
  accountRole: string;
  initialPanel?: string;
  canCreateCompany: boolean;
  canCreateOffice?: boolean;
  canImportSupplyData: boolean;
  canApproveProcurement: boolean;
  canAuthorizePurchase: boolean;
  contextEnabled: boolean;
  allowedWorkspaceIds?: string[];
  initialWorkspaceId?: string;
  initialMaterialsView?: "projects" | "messages";
  initialProject?: SupplyProjectSelection;
  initialResearchListSlug?: string;
  initialResearchQuery?: string;
  initialResearchStatus?: "all" | "new" | "reviewed" | "rejected";
  initialResearchPage?: number;
  previewMode?: boolean;
  canViewWholeOffice: boolean;
  switchableOffices?: SwitchableOffice[];
  switchOfficeAction?: OfficeSwitchAction;
}) {
  const settingsLabel = `${accountRole.slice(0, 1)}${accountRole.slice(1).toLowerCase()} settings`;
  const [activePanel, setActivePanel] = useState<SupplyOsPanel>(() => normalizeSupplyOsPanel(initialPanel));
  const [companyIndexOpen, setCompanyIndexOpen] = useState(true);
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workspaceSelection, setWorkspaceSelection] = useState<SupplyOsWorkspaceSelection>(null);
  const [workspaceToRestore, setWorkspaceToRestore] = useState<string | null | undefined>(undefined);
  const [workspaceProfile, setWorkspaceProfile] = useState<{
    companyName: string;
    logoUrl: string | null;
    facilityLabel: string | null;
    facilityVerified: boolean;
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
  const settingsHref = previewMode
    ? `/dashboard/settings?preview=customer${workspaceSelection?.workspaceId ? `&workspaceId=${encodeURIComponent(workspaceSelection.workspaceId)}` : ""}`
    : `/dashboard/settings${workspaceSelection?.workspaceId ? `?workspaceId=${encodeURIComponent(workspaceSelection.workspaceId)}` : ""}`;

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

  const panelAlerts = useSupplyOsPanelAlerts({
    storageScope,
    workspaceId: companyIndexOpen ? null : workspaceSelection?.workspaceId ?? null,
    activePanel,
    contextEnabled,
  });

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
            {PANELS.filter((panel) => panel.id !== "context" || contextEnabled).map((panel) => {
              const active = panel.id === activePanel;
              const alert = panel.id === "context" ? panelAlerts.context : panel.id === "materials" ? panelAlerts.materials : null;
              return (
                <motion.button
                  key={panel.id}
                  type="button"
                  aria-label={`${panel.shortLabel}${panel.inactive ? ", inactive preview" : ""}${alert ? `, ${alert.label}` : ""}`}
                  aria-pressed={active}
                  data-active={active}
                  data-availability={panel.inactive ? "inactive" : "active"}
                  data-panel-id={panel.id}
                  onClick={() => selectPanel(panel.id)}
                  whileHover={sidebarCollapsed ? undefined : { x: 2 }}
                  whileTap={{ scale: 0.985 }}
                >
                  {active ? <motion.span className={styles.activeRail} layoutId="supply-os-active-panel" /> : null}
                  <span className={styles.navIcon}>
                    <panel.icon size={17} aria-hidden="true" />
                  </span>
                  <span className={styles.navCopy}>
                    <strong>{panel.shortLabel}</strong>
                  </span>
                  {alert ? (
                    <span className={styles.navAlert} title={alert.label}>
                      {alert.count > 1 ? alert.count : null}
                    </span>
                  ) : null}
                  {panel.inactive ? <span className={styles.inactiveLabel}>Inactive</span> : null}
                </motion.button>
              );
            })}
          </nav>
          <div className={styles.sidebarUtilityArea}>
            <a
              className={styles.sidebarUtility}
              href={settingsHref}
              aria-label={settingsLabel}
              title={settingsLabel}
            >
              <Settings size={18} aria-hidden="true" />
              <span>{settingsLabel}</span>
            </a>
          </div>
        </motion.aside>

        <section className={styles.workspace} data-preview={previewMode}>
          <SupplyOsHeaderSlotContext.Provider value={headerSlot}>
            {previewMode ? (
              <div className={styles.previewBar}>
                <span>Customer preview</span>
                <a href="/dashboard/settings/customers">Exit preview</a>
              </div>
            ) : null}
            <header className={styles.commandHeader}>
              <div className={styles.identity}>
                <h1>{companyIndexOpen ? "Companies" : companyName}</h1>
                {!companyIndexOpen ? (
                  <p className={styles.identityMeta}>
                    {workspaceProfile?.facilityVerified && workspaceProfile.facilityLabel ? (
                      <span>{workspaceProfile.facilityLabel}</span>
                    ) : (
                      <button type="button" onClick={() => selectPanel("logistics")}>
                        {workspaceProfile?.facilityLabel
                          ? `Verify facility: ${workspaceProfile.facilityLabel}`
                          : "Set operating facility"}
                      </button>
                    )}
                    <span aria-hidden="true">/</span>
                    <span>
                      {workspaceSelection?.snapshotVersion
                        ? `Snapshot v${workspaceSelection.snapshotVersion}`
                        : workspaceProfile ? "Company profile" : "No inventory"}
                    </span>
                  </p>
                ) : null}
              </div>
              {!companyIndexOpen ? <div ref={setHeaderSlot} className={styles.headerStatusSlot} /> : null}
              <motion.button
                className={styles.companiesButton}
                type="button"
                onClick={() => setCompanyIndexOpen(true)}
                whileTap={{ scale: 0.98 }}
                disabled={companyIndexOpen}
              >
                <ArrowLeft size={15} /> Companies
              </motion.button>
            </header>

            <div className={styles.panelStage}>
              {companyIndexOpen ? (
                <SupplyOsCompanyIndex
                  canCreateCompany={canCreateCompany}
                  canCreateOffice={canCreateOffice}
                  allowedWorkspaceIds={allowedWorkspaceIds}
                  crossOffice={Boolean(!previewMode && switchableOffices && switchableOffices.length > 1)}
                  switchOfficeAction={switchOfficeAction}
                  preferredWorkspaceId={initialWorkspaceId ?? workspaceToRestore}
                  onPreferredWorkspaceUnavailable={clearStoredWorkspace}
                  autoOpenFirstWorkspace={
                    (activePanel === "context" || allowedWorkspaceIds !== undefined || Boolean(initialMaterialsView))
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
                  previewMode={previewMode}
                  canShowProspects={!previewMode && accountRole !== "CUSTOMER"}
                  canShowProjectStatus={!previewMode && accountRole !== "CUSTOMER"}
                  canShowMail={
                    !previewMode &&
                    accountRole !== "CUSTOMER" &&
                    accountRole !== "EMPLOYEE" &&
                    (canViewWholeOffice || accountRole === "ADMIN" || accountRole === "MANAGER")
                  }
                  initialMaterialsView={initialMaterialsView}
                  initialProject={initialProject}
                  initialResearchListSlug={initialResearchListSlug}
                  initialResearchQuery={initialResearchQuery}
                  initialResearchStatus={initialResearchStatus}
                  initialResearchPage={initialResearchPage}
                  onOpenContext={() => selectPanel("context")}
                  onWorkspaceProfile={setWorkspaceProfile}
                />
              )}
            </div>
          </SupplyOsHeaderSlotContext.Provider>
        </section>
      </main>
    </MotionConfig>
  );
}
