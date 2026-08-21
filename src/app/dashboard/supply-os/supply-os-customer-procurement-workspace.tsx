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
  CUSTOMER_PROCUREMENT_POLL_INTERVAL_MS,
  customerProcurementProgress,
  customerProcurementStatusLabel,
  customerProcurementContactSummary,
  customerProcurementEvidenceSummary,
  customerProcurementPhase,
  customerProcurementQuoteSummary,
  customerProcurementResearchComplete,
  startCustomerProcurementPolling,
  type CustomerProcurementOrderState,
  type CustomerProcurementRequestDetail,
} from "@/lib/supply-os/customer-procurement-status";
import {
  PROCUREMENT_APPROVAL_STATUSES,
  PROCUREMENT_STATUS_LABELS,
} from "@/lib/procurement-status";
import type { SupplyInventoryItem } from "@/lib/supply-os/inventory-item";
import styles from "./supply-os-logistics.module.css";

function vendorStatusLabel(status: string) {
  return PROCUREMENT_STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

function detailFromInitialState(
  orderId: string,
  item: SupplyInventoryItem,
  initialOrder: CustomerProcurementOrderState,
): CustomerProcurementRequestDetail {
  return {
    id: orderId,
    status: initialOrder.status,
    progress: initialOrder.progress,
    requestContext: {},
    neededBy: item.needByDate ?? null,
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

export function CustomerProcurementWorkspace({
  orderId,
  item,
  initialOrder,
  onBack,
}: {
  orderId: string;
  item: SupplyInventoryItem;
  initialOrder: CustomerProcurementOrderState;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [detail, setDetail] = useState(() => detailFromInitialState(orderId, item, initialOrder));
  const [refreshState, setRefreshState] = useState<"idle" | "running" | "error">("idle");
  const [startRetryState, setStartRetryState] = useState<"idle" | "running" | "requested" | "error">("idle");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshPromiseRef = useRef<Promise<CustomerProcurementRequestDetail> | null>(null);
  const automaticStartRetryRef = useRef(false);
  const phase = customerProcurementPhase(detail.status, detail.vendors.length);
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
      const next = await responseJson<CustomerProcurementRequestDetail>(response);
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

  const retryStart = useCallback(async () => {
    if (detail.status !== "new" || startRetryState === "running") return;
    setStartRetryState("running");
    try {
      const response = await fetch(`/api/procurement/requests/${encodeURIComponent(orderId)}/wake`, {
        method: "POST",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const result = await responseJson<{ workflowWakeRequested: boolean }>(response);
      setStartRetryState(result.workflowWakeRequested ? "requested" : "idle");
      await refresh();
    } catch (error) {
      setStartRetryState("error");
      setRefreshError(error instanceof Error ? error.message : "Sourcing could not be restarted.");
    }
  }, [detail.status, orderId, refresh, startRetryState]);

  useEffect(() => {
    const controller = new AbortController();
    const stop = startCustomerProcurementPolling({
      initialStatus: detail.status,
      load: () => refresh(controller.signal),
      onDetail: () => undefined,
      onError: () => undefined,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (handle) => window.clearTimeout(handle as number),
      intervalMs: CUSTOMER_PROCUREMENT_POLL_INTERVAL_MS,
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [orderId, refresh]);

  useEffect(() => {
    if (detail.status !== "new" || automaticStartRetryRef.current) return;
    const updatedAt = new Date(detail.updatedAt).valueOf();
    const elapsed = Number.isFinite(updatedAt) ? Date.now() - updatedAt : 0;
    const delay = Math.max(0, 35_000 - elapsed);
    const timer = window.setTimeout(() => {
      automaticStartRetryRef.current = true;
      void retryStart();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [detail.status, detail.updatedAt, retryStart]);

  const researchSteps = useMemo(() => {
    const claimed = detail.status !== "new";
    const suppliersFound = customerProcurementResearchComplete(detail.status, detail.vendors.length);
    return [
      { label: "Request received", detail: `${detail.quantity.toLocaleString("en-US")} ${detail.unit} confirmed`, complete: true, active: false },
      { label: "Processing start", detail: detail.status === "new" ? "Waiting to begin" : "Supplier research is active", complete: claimed, active: !claimed },
      { label: "Supplier search", detail: suppliersFound ? `${detail.vendors.length} supplier candidate${detail.vendors.length === 1 ? "" : "s"} found` : "Searching and verifying supplier candidates", complete: suppliersFound, active: claimed && !suppliersFound },
      { label: "Evidence review", detail: suppliersFound ? "Supplier evidence is ready for review" : "Starts after supplier candidates are found", complete: suppliersFound, active: false },
    ];
  }, [detail]);

  const currentStatus = customerProcurementStatusLabel(detail.status);
  const visibleProgress = customerProcurementProgress(detail.status, detail.vendors.length);
  return (
    <motion.section
      className={`${styles.procurementWorkspace} ${styles.customerProcurementWorkspace}`}
      aria-label="Supplier sourcing progress"
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
              <p>{refreshError ?? visibleProgress}</p>
            </section>
            <ol className={styles.procurementSourceLog}>
              {researchSteps.map((step) => (
                <li key={step.label} data-complete={step.complete} data-active={step.active}>
                  <span>{step.complete ? <Check size={15} /> : step.active ? <LoaderCircle size={15} /> : <Search size={15} />}</span>
                  <div><strong>{step.label}</strong><small>{step.detail}</small></div>
                </li>
              ))}
            </ol>
            <footer>
              <span><ShieldCheck size={14} /> Supplier candidates remain unqualified until reviewed.</span>
              {detail.status === "new" ? (
                <button type="button" onClick={() => void retryStart()} disabled={startRetryState === "running"}>
                  {startRetryState === "running" ? <LoaderCircle size={14} className={styles.spin} /> : <RefreshCw size={14} />}
                  {startRetryState === "requested" ? "Start requested" : startRetryState === "error" ? "Retry start" : "Start sourcing"}
                </button>
              ) : (
                <button type="button" onClick={() => void refresh().catch(() => undefined)} disabled={refreshState === "running"}>{refreshState === "running" ? <LoaderCircle size={14} className={styles.spin} /> : <RefreshCw size={14} />} Refresh now</button>
              )}
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
            <h3>{detail.status === "cancelled" ? "Request canceled" : "More information needed"}</h3>
            <p>{refreshError ?? visibleProgress}</p>
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
                <small>{approvalRequired ? "Shortlist under review" : currentStatus}</small>
                <h3>{detail.vendors.length} supplier candidate{detail.vendors.length === 1 ? "" : "s"}</h3>
                <p>{visibleProgress}</p>
              </span>
              <strong>{currentStatus}</strong>
            </section>
            <div className={styles.procurementOptionTableRegion}>
              <table className={styles.procurementOptionTable}>
                <thead><tr><th>Supplier</th><th>Contact</th><th>Evidence</th><th>Quote</th><th>Source</th></tr></thead>
                <tbody>
                  {detail.vendors.map((vendor) => {
                    const evidence = customerProcurementEvidenceSummary(vendor.research);
                    const contact = customerProcurementContactSummary(vendor.contact);
                    return (
                      <tr key={vendor.id}>
                        <td><strong>{vendor.name}</strong><small>{vendorStatusLabel(vendor.status)}</small></td>
                        <td><strong>{contact.primary}</strong><small>{contact.secondary}</small></td>
                        <td><strong>{evidence[0] ?? "Evidence pending"}</strong><small>{evidence[1] ?? "Review the supplier source before approval"}</small></td>
                        <td><strong>{customerProcurementQuoteSummary(vendor.quote)}</strong><small>{vendor.quote ? "Commercial terms saved" : "No commercial terms saved"}</small></td>
                        <td>{vendor.website ? <a href={vendor.website} target="_blank" rel="noreferrer">Open site <ExternalLink size={12} /></a> : <small>Website unavailable</small>}</td>
                      </tr>
                    );
                  })}
                  {!detail.vendors.length ? (
                    <tr><td colSpan={5}><strong>No supplier candidates yet</strong><small>Supplier candidates are still being prepared.</small></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <footer className={styles.procurementDecisionFooter}>
              <span><TriangleAlert size={14} /> Results are read-only while the shortlist is reviewed.</span>
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
            <h3>{detail.status === "ordered" ? "Order completed" : "Order under review"}</h3>
            <p>{visibleProgress}</p>
            <button type="button" onClick={() => void refresh().catch(() => undefined)}><RefreshCw size={14} /> Refresh status</button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
