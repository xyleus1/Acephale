"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GUILD2_PROCUREMENT_POLL_INTERVAL_MS,
  guild2ProcurementContactSummary,
  guild2ProcurementEvidenceSummary,
  guild2ProcurementPhase,
  guild2ProcurementQuoteSummary,
  guild2ProcurementResearchComplete,
  startGuild2ProcurementPolling,
  type Guild2ProcurementOrderState,
  type Guild2ProcurementRequestDetail,
} from "@/lib/supply-os/guild2-procurement";
import {
  PROCUREMENT_APPROVAL_STATUSES,
  PROCUREMENT_STATUS_LABELS,
} from "@/lib/procurement-status";
import type { AtlasInventoryItem } from "@/lib/supply-os/atlas-robotics-inventory";
import styles from "./supply-os-logistics.module.css";

function statusLabel(status: string) {
  return PROCUREMENT_STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

function detailFromInitialState(
  orderId: string,
  item: AtlasInventoryItem,
  initialOrder: Guild2ProcurementOrderState,
): Guild2ProcurementRequestDetail {
  return {
    id: orderId,
    status: initialOrder.status,
    progress: initialOrder.progress,
    requestContext: {},
    neededBy: "2026-09-30",
    quantity: item.requestedQuantity ?? 0,
    unit: item.requestedUnit ?? item.unitOfMeasure ?? "units",
    material: item.name,
    specification: item.specification,
    approvalRequestedAt: null,
    decisionSnapshot: null,
    vendors: initialOrder.vendors,
    updatedAt: new Date().toISOString(),
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(payload?.error ?? "The procurement request could not be refreshed.");
  return payload as T;
}

export function BourneProcurementWorkspace({
  orderId,
  item,
  initialOrder,
  onBack,
}: {
  orderId: string;
  item: AtlasInventoryItem;
  initialOrder: Guild2ProcurementOrderState;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [detail, setDetail] = useState(() => detailFromInitialState(orderId, item, initialOrder));
  const [refreshState, setRefreshState] = useState<"idle" | "running" | "error">("idle");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<Guild2ProcurementRequestDetail> | null>(null);
  const phase = guild2ProcurementPhase(detail.status, detail.vendors.length);
  const approvalRequired = PROCUREMENT_APPROVAL_STATUSES.has(detail.status);

  const refresh = useCallback((signal?: AbortSignal) => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    setRefreshState("running");
    const pending = (async () => {
      const response = await fetch(`/api/procurement/requests/${encodeURIComponent(orderId)}`, {
        cache: "no-store",
        signal,
        headers: { accept: "application/json" },
      });
      const next = await responseJson<Guild2ProcurementRequestDetail>(response);
      setDetail(next);
      setRefreshError(null);
      setRefreshState("idle");
      return next;
    })().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      setRefreshError(error instanceof Error ? error.message : "Status refresh failed.");
      setRefreshState("error");
      throw error;
    }).finally(() => {
      refreshPromiseRef.current = null;
    });
    refreshPromiseRef.current = pending;
    return pending;
  }, [orderId]);

  useEffect(() => {
    const controller = new AbortController();
    const stop = startGuild2ProcurementPolling({
      initialStatus: detail.status,
      load: () => refresh(controller.signal),
      onDetail: () => undefined,
      onError: () => undefined,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (handle) => window.clearTimeout(handle as number),
      intervalMs: GUILD2_PROCUREMENT_POLL_INTERVAL_MS,
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [orderId, refresh]);

  const researchSteps = useMemo(() => {
    const claimed = detail.status !== "new";
    const suppliersFound = guild2ProcurementResearchComplete(detail.status, detail.vendors.length);
    return [
      { label: "Request accepted", detail: `${detail.quantity.toLocaleString("en-US")} ${detail.unit} saved in Neon`, complete: true, active: false },
      { label: "Workflow claimed", detail: detail.status === "new" ? "Waiting for Bourne to claim the queued order" : "Bourne has claimed the order", complete: claimed, active: !claimed },
      { label: "Supplier search", detail: suppliersFound ? `${detail.vendors.length} supplier candidate${detail.vendors.length === 1 ? "" : "s"} saved` : detail.progress ?? "Searching supplier sources", complete: suppliersFound, active: claimed && !suppliersFound },
      { label: "Evidence review", detail: suppliersFound ? "Supplier evidence is ready for operator review" : "Starts after supplier candidates are found", complete: suppliersFound, active: false },
    ];
  }, [detail]);

  const currentStatus = statusLabel(detail.status);
  return (
    <motion.section
      className={styles.procurementWorkspace}
      aria-label="Bourne procurement research"
      initial={reduceMotion ? false : { opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, x: 14 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className={styles.procurementHeader}>
        <button type="button" onClick={onBack}><ArrowLeft size={15} /> Back to sourcing queue</button>
        <span><small>{item.sku}</small><h2>{detail.material}</h2></span>
        <i>{refreshState === "running" ? "Refreshing" : currentStatus}</i>
      </header>

      <nav className={styles.procurementProgress} aria-label="Procurement progress">
        <span data-active={false} data-complete={true}><b>01</b> Request</span>
        <span data-active={phase === "researching"} data-complete={phase !== "researching"}><b>02</b> Research</span>
        <span data-active={phase === "compare"} data-complete={phase === "procure"}><b>03</b> Compare</span>
        <span data-active={phase === "procure"}><b>04</b> Procure</span>
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        {phase === "researching" ? (
          <motion.div
            key="researching"
            className={styles.procurementResearch}
            initial={reduceMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
            transition={{ duration: 0.16 }}
          >
            <section className={styles.procurementResearchLead}>
              <span className={styles.procurementResearchIcon}><Sparkles size={22} /></span>
              <small>{currentStatus}</small>
              <h3>{detail.material}</h3>
              <p>{refreshError ?? detail.progress ?? "The request is queued. This page checks Neon every seven seconds while Bourne works."}</p>
            </section>
            <ol className={styles.procurementSourceLog}>
              {researchSteps.map((step) => (
                <li key={step.label} data-complete={step.complete} data-active={step.active}>
                  <span>{step.complete ? <Check size={15} /> : step.active ? <LoaderCircle size={15} /> : <Search size={15} />}</span>
                  <span><strong>{step.label}</strong><small>{step.detail}</small></span>
                </li>
              ))}
            </ol>
            <footer>
              <span><ShieldCheck size={14} /> Bourne performs research and writes supplier results. Derya only reads the customer-scoped workflow record.</span>
              <button type="button" onClick={() => void refresh().catch(() => undefined)} disabled={refreshState === "running"}>{refreshState === "running" ? <LoaderCircle size={14} className={styles.spin} /> : <RefreshCw size={14} />} Refresh now</button>
            </footer>
          </motion.div>
        ) : phase === "attention" ? (
          <motion.div
            key="attention"
            className={styles.procurementUnknownState}
            initial={reduceMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
            transition={{ duration: 0.16 }}
          >
            <TriangleAlert size={28} />
            <h3>{detail.status === "cancelled" ? "Request canceled" : "Human intervention required"}</h3>
            <p>{refreshError ?? detail.progress ?? "Open the Bourne run to resolve the workflow issue, then refresh this status."}</p>
            <button type="button" onClick={() => void refresh().catch(() => undefined)}><RefreshCw size={14} /> Refresh status</button>
          </motion.div>
        ) : phase === "compare" ? (
          <motion.div
            key="compare"
            className={styles.procurementComparison}
            initial={reduceMotion ? false : { opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, x: -10 }}
            transition={{ duration: 0.18 }}
          >
            <section className={styles.procurementRecommendation}>
              {approvalRequired ? <ShieldCheck size={20} /> : <CheckCircle2 size={24} />}
              <span>
                <small>{approvalRequired ? "Approval required in Bourne Inbox" : currentStatus}</small>
                <h3>{detail.vendors.length} supplier candidate{detail.vendors.length === 1 ? "" : "s"}</h3>
                <p>{detail.progress ?? "Compare the supplier evidence. Workflow decisions remain in Bourne."}</p>
              </span>
              <strong>{currentStatus}</strong>
            </section>
            <div className={styles.procurementOptionTableRegion}>
              <table className={styles.procurementOptionTable}>
                <thead><tr><th>Supplier</th><th>Contact</th><th>Evidence</th><th>Quote</th><th>Source</th></tr></thead>
                <tbody>
                  {detail.vendors.map((vendor) => {
                    const evidence = guild2ProcurementEvidenceSummary(vendor.research);
                    const contact = guild2ProcurementContactSummary(vendor.contact);
                    return (
                      <tr key={vendor.id}>
                        <td><strong>{vendor.name}</strong><small>{statusLabel(vendor.status)}</small></td>
                        <td><strong>{contact.primary}</strong><small>{contact.secondary}</small></td>
                        <td><strong>{evidence[0] ?? "Evidence pending"}</strong><small>{evidence[1] ?? "Review the supplier source before approval"}</small></td>
                        <td><strong>{guild2ProcurementQuoteSummary(vendor.quote)}</strong><small>{vendor.quote ? "Review in Bourne before approval" : "No commercial terms saved"}</small></td>
                        <td>{vendor.website ? <a href={vendor.website} target="_blank" rel="noreferrer">Open site <ExternalLink size={12} /></a> : <small>Website unavailable</small>}</td>
                      </tr>
                    );
                  })}
                  {!detail.vendors.length ? (
                    <tr><td colSpan={5}><strong>No supplier candidates saved</strong><small>Refresh after Bourne finishes writing the shortlist.</small></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <footer className={styles.procurementDecisionFooter}>
              <span><TriangleAlert size={14} /> This table is read-only. Approve or reject the shortlist in Bourne Inbox.</span>
              <button type="button" onClick={() => void refresh().catch(() => undefined)} disabled={refreshState === "running"}>{refreshState === "running" ? "Refreshing" : "Refresh results"} <RefreshCw size={14} /></button>
            </footer>
          </motion.div>
        ) : (
          <motion.div
            key="procure"
            className={styles.procurementUnknownState}
            initial={reduceMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
            transition={{ duration: 0.16 }}
          >
            {detail.status === "ordered" ? <CheckCircle2 size={28} /> : <ShieldCheck size={28} />}
            <h3>{detail.status === "ordered" ? "Order completed" : "Final approval required in Bourne Inbox"}</h3>
            <p>{detail.progress ?? "The dashboard stays read-only while Bourne owns the final workflow decision."}</p>
            <button type="button" onClick={() => void refresh().catch(() => undefined)}><RefreshCw size={14} /> Refresh status</button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
