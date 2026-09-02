"use client";

import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowRight,
  CheckCircle2,
  ChevronUp,
  MapPin,
  MessageSquare,
  PackageSearch,
  Pencil,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import {
  customerProcurementProgress,
  customerProcurementStatusLabel,
  type CustomerProcurementOrderState,
} from "@/lib/supply-os/customer-procurement-status";
import {
} from "@/lib/procurement-status";
import {
  sourcingNeedByDate,
  sourcingRequestQuantity,
  shortageQuantity,
  type SupplyInventoryItem,
} from "@/lib/supply-os/inventory-item";
import {
  customerProcurementItem,
  customerProcurementOrderState,
  type CustomerProcurementListItem,
} from "@/lib/supply-os/customer-procurement";
import type {
  SourcingRequestDraft,
  SourcingRequiredField,
} from "@/lib/supply-os/sourcing-request-contract";
import styles from "./supply-os-logistics.module.css";
import type {
  SavedProcurementCase,
  SavedSourcingResearchRun,
  SupplyIntelligenceProfile,
} from "./supply-os-sourcing-research-types";
import { ActiveSourcingWorkspace } from "./supply-os-active-sourcing";
import { SupplyOsProspects } from "./supply-os-prospects";
import { SupplyOsOutreach } from "./supply-os-outreach";
import { SupplyOsSharedWorkspace } from "./supply-os-shared-workspace";

export type PendingSourcingQueueItem = {
  id: string;
  requestText: string;
  title: string;
  draft: SourcingRequestDraft | null;
  missingFields: SourcingRequiredField[];
  lastQuestion: string | null;
  status: "Clarification needed" | "Researching" | "Research unavailable";
};

export type SupplyInventoryWorkspaceView = "inventory" | "messages" | "prospects" | "outreach";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNeedBy(item: SupplyInventoryItem) {
  const value = sourcingNeedByDate(item);
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function formatResearchDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function SupplyInventoryWorkspace({
  activeView,
  onViewChange,
  selectedSku,
  items = [],
  workspaceId,
  canImportSupplyData,
  onSnapshotPublished,
  onSelect,
  onCreateRequest,
  onRetryResearch,
  pendingRequests,
  customerProcurementOrders,
  onOpenPendingRequest,
  onDeletePendingRequest,
  onOpenCustomerProcurement,
  researchRuns,
  procurementCases,
  messageResearchRuns = [],
  messageProcurementCases = [],
  intelligenceProfile,
  researchWorkspaceReady = true,
  dataState,
  hasMore,
  pageState,
  onRetryData,
  onLoadMore,
  onStartItemResearch,
  onOpenSavedResearch,
  sourceMap,
  sourceName,
  sourceLocation,
  onHideSourceMap,
  companyName,
  canShowProspects = false,
  canShowOutreach = false,
  storageScope,
  initialResearchListSlug,
  initialResearchQuery,
  initialResearchStatus,
  initialResearchPage,
}: {
  activeView: SupplyInventoryWorkspaceView;
  onViewChange: (view: SupplyInventoryWorkspaceView) => void;
  selectedSku: string;
  items?: SupplyInventoryItem[];
  workspaceId?: string | null;
  canImportSupplyData: boolean;
  onSnapshotPublished?: () => void;
  onSelect: (sku: string) => void;
  onCreateRequest: (query: string) => void;
  onRetryResearch: (run: SavedSourcingResearchRun) => void;
  pendingRequests: PendingSourcingQueueItem[];
  customerProcurementOrders: CustomerProcurementListItem[];
  onOpenPendingRequest: (request: PendingSourcingQueueItem) => void;
  onDeletePendingRequest: (requestId: string) => void;
  onOpenCustomerProcurement: (item: SupplyInventoryItem, order: CustomerProcurementOrderState) => void;
  researchRuns: SavedSourcingResearchRun[];
  procurementCases: SavedProcurementCase[];
  messageResearchRuns?: SavedSourcingResearchRun[];
  messageProcurementCases?: SavedProcurementCase[];
  intelligenceProfile: SupplyIntelligenceProfile | null;
  researchWorkspaceReady?: boolean;
  dataState: "loading" | "ready" | "error";
  hasMore: boolean;
  pageState: "idle" | "loading" | "error";
  onRetryData: () => void;
  onLoadMore: () => void;
  onStartItemResearch: (item: SupplyInventoryItem) => void;
  onOpenSavedResearch: (run: SavedSourcingResearchRun) => void;
  sourceMap?: ReactNode;
  sourceName?: string;
  sourceLocation?: string;
  onHideSourceMap?: () => void;
  companyName: string;
  canShowProspects?: boolean;
  canShowOutreach?: boolean;
  storageScope: string;
  initialResearchListSlug?: string;
  initialResearchQuery?: string;
  initialResearchStatus?: "all" | "new" | "reviewed" | "rejected";
  initialResearchPage?: number;
}) {
  const [query, setQuery] = useState("");
  const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState({
    name: "",
    description: "",
    manufacturer: "",
    mpn: "",
    unitOfMeasure: "EA",
    requestedQuantity: "",
    requestedUnit: "EA",
    supplierDeliverable: "",
    deliveryLocation: "",
    needByDate: "",
  });
  const [itemMutationState, setItemMutationState] = useState<"idle" | "saving" | "deleting" | "error">("idle");
  const [itemMutationError, setItemMutationError] = useState("");
  const reduceMotion = useReducedMotion();
  const visibleResearchRuns = researchRuns.filter((run) => {
    const campaignInput = run.input as SavedSourcingResearchRun["input"] & {
      campaignId?: string;
      campaignArtifactKind?: string;
    };
    return !campaignInput.campaignId || campaignInput.campaignArtifactKind === "AGGREGATE";
  });
  const sourcingItems = workspaceId
    ? items
    : items.filter((item) => shortageQuantity(item) > 0);
  const runsById = new Map(visibleResearchRuns.map((run) => [run.id, run]));
  const casesByRunId = new Map<string, SavedProcurementCase[]>();
  for (const procurementCase of procurementCases) {
    const runCases = casesByRunId.get(procurementCase.input.researchRunId) ?? [];
    runCases.push(procurementCase);
    casesByRunId.set(procurementCase.input.researchRunId, runCases);
  }
  const latestRuns = new Map<string, SavedSourcingResearchRun>();
  for (const procurementCase of procurementCases) {
    const run = runsById.get(procurementCase.input.researchRunId);
    if (run && !latestRuns.has(run.input.componentItemKey)) latestRuns.set(run.input.componentItemKey, run);
  }
  for (const run of visibleResearchRuns) {
    if (!latestRuns.has(run.input.componentItemKey)) latestRuns.set(run.input.componentItemKey, run);
  }
  const knownSkus = new Set(items.map((item) => item.sku));
  const customRuns = [...latestRuns.values()].filter((run) => !knownSkus.has(run.input.componentItemKey));
  const currentRunIds = new Set([...latestRuns.values()].map((run) => run.id));
  const additionalRuns = visibleResearchRuns.filter((run) => !currentRunIds.has(run.id));

  function editItem(item: SupplyInventoryItem) {
    if (!item.itemKey) return;
    setEditingItemKey(item.itemKey);
    setItemDraft({
      name: item.name,
      description: item.specification,
      manufacturer: item.manufacturer ?? "",
      mpn: item.mpn ?? "",
      unitOfMeasure: item.unitOfMeasure ?? item.requestedUnit ?? "EA",
      requestedQuantity: sourcingRequestQuantity(item)?.toString() ?? "",
      requestedUnit: item.requestedUnit ?? item.unitOfMeasure ?? "EA",
      supplierDeliverable: item.supplierDeliverable ?? "",
      deliveryLocation: item.deliveryLocation ?? "",
      needByDate: item.needByDate ?? "",
    });
    setItemMutationState("idle");
    setItemMutationError("");
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !editingItemKey || itemMutationState === "saving") return;
    setItemMutationState("saving");
    setItemMutationError("");
    const response = await fetch(`/api/supply-os/workspaces/${encodeURIComponent(workspaceId)}/items/${encodeURIComponent(editingItemKey)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...itemDraft,
        requestedQuantity: itemDraft.requestedQuantity ? Number(itemDraft.requestedQuantity) : null,
      }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setItemMutationState("error");
      setItemMutationError(body.error || "Sourcing item could not be saved.");
      return;
    }
    setEditingItemKey(null);
    setItemMutationState("idle");
    onSnapshotPublished?.();
  }

  async function deleteItem(item: SupplyInventoryItem) {
    if (!workspaceId || !item.itemKey || itemMutationState === "deleting") return;
    if (!window.confirm(`Delete ${item.name} from the current sourcing snapshot? Saved research and prior snapshots stay in history.`)) return;
    setItemMutationState("deleting");
    setItemMutationError("");
    const response = await fetch(`/api/supply-os/workspaces/${encodeURIComponent(workspaceId)}/items/${encodeURIComponent(item.itemKey)}`, {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setEditingItemKey(item.itemKey);
      setItemMutationState("error");
      setItemMutationError(body.error || "Sourcing item could not be deleted.");
      return;
    }
    setEditingItemKey(null);
    setItemMutationState("idle");
    onSnapshotPublished?.();
  }
  function resultState(run: SavedSourcingResearchRun | undefined) {
    if (!run) return "Not researched";
    if (["QUEUED", "RUNNING"].includes(run.status)) return "Researching";
    if (run.status === "FAILED") return "Research failed";
    const count = run.output?.candidates.length ?? 0;
    return count ? `${count} source-backed candidate${count === 1 ? "" : "s"}, unqualified` : "No source-backed candidates";
  }

  function caseStage(procurementCase: SavedProcurementCase | undefined) {
    if (procurementCase?.result?.sourcingReturn?.state === "REQUIRED") {
      return procurementCase.result.sourcingReturn.reasonCode === "SUPPLIER_REJECTED"
        ? "Supplier rejected, choose another source"
        : "Approval evidence expired, choose another source";
    }
    if (procurementCase?.result?.purchaseRevision?.state === "APPROVAL_PENDING") return "Revised order approval pending";
    if (procurementCase?.result?.purchaseRevision?.state === "REJECTED") return "Revised order needs changes";
    if (procurementCase?.result?.purchaseRevision?.state === "AUTHORIZED") return "Revised order authorized";
    if (procurementCase?.result?.purchaseRevision?.state === "DRAFT") return "Revised order draft ready";
    if (procurementCase?.result?.purchaseRelease?.revisionRequiredCount) return "New order authorization required";
    if (procurementCase?.result?.purchaseRelease?.openSupplierExceptionCount) return "Supplier order exception review";
    if (["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"].includes(procurementCase?.purchaseOrderFollowUpAction?.result?.state ?? "")) return "Follow-up delivery unresolved";
    if (procurementCase?.result?.purchaseRelease?.state === "ACKNOWLEDGED") return "Supplier acknowledged";
    if (procurementCase?.purchaseOrderFollowUpAction?.result?.state === "SENT") return "Supplier follow-up sent";
    if (procurementCase?.purchaseOrderFollowUpAction?.approval?.status === "PENDING") return "Follow-up approval pending";
    if (procurementCase?.purchaseOrderFollowUpDraft) return "Supplier follow-up draft";
    if (procurementCase?.result?.purchaseRelease?.state === "PARTIALLY_ACKNOWLEDGED") {
      const release = procurementCase.result.purchaseRelease;
      return `${release.acknowledgedQuantity} ${release.unitOfMeasure} accepted, ${release.remainingQuantity} open`;
    }
    if (procurementCase?.purchaseAction?.approval?.status === "APPROVED") return "Approved to issue";
    if (procurementCase?.purchaseAction?.approval?.status === "PENDING") return "Final purchase approval pending";
    if (procurementCase?.purchaseAction?.approval?.status === "REJECTED") return "Purchase action revision required";
    if (procurementCase?.purchaseDraft?.result?.state === "DRAFT") return "Order draft ready";
    if (procurementCase?.result?.stage === "COMMERCIAL_CONFIRMATION") {
      if (procurementCase.result.quoteCycle?.state === "DRAFT") return "Quote request draft";
      if (procurementCase.result.quoteCycle?.state === "AWAITING_RESPONSE") return "Awaiting supplier quote";
      if (procurementCase.result.quoteCycle?.state === "RESPONSES_RECEIVED") {
        const count = procurementCase.result.quoteCycle.responseCount;
        return `${count} quote ${count === 1 ? "response" : "responses"}`;
      }
    }
    switch (procurementCase?.result?.stage) {
      case "SOURCE_EVIDENCE": return "Source evidence required";
      case "SUPPLIER_REJECTED": return "Supplier rejected";
      case "COMMERCIAL_CONFIRMATION": return "Confirm commercial terms";
      case "QUALITY_REVIEW": return procurementCase?.result?.qualityPlan?.outcome === "FAIL" ? "Quality verification failed" : "Quality evidence required";
      case "APPROVAL": return "Ready for approval request";
      case "APPROVAL_PENDING": return "Manager approval pending";
      case "PURCHASE_READY": return "Approved for purchase preparation";
      default: return null;
    }
  }

  function workstreamSummary(cases: SavedProcurementCase[]) {
    if (!cases.length) return null;
    const quoted = cases.filter((procurementCase) => procurementCase.quoteCycle?.result?.responses.length).length;
    const active = cases.find((procurementCase) => procurementCase.quoteCycle?.result?.responses.length)
      ?? cases.find((procurementCase) => procurementCase.quoteCycle?.result?.state === "AWAITING_RESPONSE")
      ?? cases[0];
    const prefix = `${cases.length} supplier workstream${cases.length === 1 ? "" : "s"}`;
    return quoted ? `${prefix} · ${quoted} quoted` : `${prefix} · ${caseStage(active)}`;
  }

  function queueActionLabel(run: SavedSourcingResearchRun | undefined, cases: SavedProcurementCase[]) {
    const procurementCase = cases.find((candidate) => candidate.result?.sourcingReturn)
      ?? cases.find((candidate) => candidate.result?.purchaseRevision)
      ?? cases.find((candidate) => candidate.result?.purchaseRelease?.revisionRequiredCount)
      ?? cases.find((candidate) => candidate.result?.purchaseRelease?.openSupplierExceptionCount)
      ?? cases.find((candidate) => candidate.result?.purchaseRelease)
      ?? cases.find((candidate) => candidate.purchaseAction)
      ?? cases.find((candidate) => candidate.purchaseDraft)
      ?? cases[0];
    const release = procurementCase?.result?.purchaseRelease;
    if (procurementCase?.result?.sourcingReturn?.state === "REQUIRED") return "Choose another supplier";
    if (procurementCase?.result?.purchaseRevision?.state === "APPROVAL_PENDING") return "Review revised order approval";
    if (procurementCase?.result?.purchaseRevision?.state === "REJECTED") return "Revise replacement order";
    if (procurementCase?.result?.purchaseRevision?.state === "AUTHORIZED") return "Issue revised order";
    if (procurementCase?.result?.purchaseRevision?.state === "DRAFT") return "Review revised order draft";
    if (release?.revisionRequiredCount) return "Prepare revised order authorization";
    if (release?.openSupplierExceptionCount) return "Review supplier order exception";
    if (["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"].includes(procurementCase?.purchaseOrderFollowUpAction?.result?.state ?? "")) return "Resolve follow-up delivery";
    if (procurementCase?.purchaseOrderFollowUpAction?.approval?.status === "PENDING") return "Review follow-up approval";
    if (procurementCase?.purchaseOrderFollowUpAction?.approval?.status === "APPROVED") return "Send supplier follow-up";
    if (procurementCase?.purchaseOrderFollowUpDraft && procurementCase.purchaseOrderFollowUpDraft.status !== "SUCCEEDED") return "Review follow-up draft";
    if (procurementCase?.purchaseOrderFollowUpAction?.result?.state === "SENT") return "Check supplier reply";
    if (release?.release && release.state !== "ACKNOWLEDGED" && release.release.acknowledgmentDueOn <= new Date().toISOString().slice(0, 10)) return "Chase supplier acknowledgment";
    if (release?.state !== "ACKNOWLEDGED" && release?.unreviewedConnectedReplyCount) return "Review supplier order reply";
    if (procurementCase?.result?.purchaseRelease?.state === "RELEASED") return "Record supplier acknowledgment";
    if (procurementCase?.result?.purchaseRelease) return "Review supplier acknowledgment";
    if (procurementCase?.purchaseAction) return "Review purchase action";
    if (procurementCase?.purchaseDraft) return "Review order draft";
    if (cases.length > 1) return "Open quote inbox";
    if (procurementCase?.result?.stage === "COMMERCIAL_CONFIRMATION" && procurementCase.result.quoteCycle) return "Review quote cycle";
    if (procurementCase?.result?.stage === "SUPPLIER_REJECTED") return "Review rejection";
    if (procurementCase?.result?.stage === "QUALITY_REVIEW") return procurementCase.result.qualityPlan?.outcome === "FAIL" ? "Review failed quality check" : "Record quality evidence";
    if (procurementCase) return "Continue procurement";
    if (run?.status === "SUCCEEDED") return "View results";
    if (["QUEUED", "RUNNING"].includes(run?.status ?? "")) return "View progress";
    if (run?.status === "FAILED") return "Retry research";
    return "Start research";
  }

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!researchWorkspaceReady) return;
    const normalized = query.trim();
    if (!normalized) return;
    onCreateRequest(normalized);
    setQuery("");
  }

  return (
    <motion.section
      className={styles.inventoryWorkspace}
      aria-label={`${companyName} sourcing queue`}
      initial={reduceMotion ? false : { opacity: 0.82, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, x: -10 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <Tabs.Root
        className={styles.inventoryTabs}
        value={activeView}
        onValueChange={(value) => onViewChange(
          value === "messages"
            ? "messages"
            : value === "prospects"
              ? "prospects"
              : value === "outreach"
                ? "outreach"
                : "inventory",
        )}
      >
        <Tabs.List className={styles.inventoryTabList} aria-label="Inventory, messages, prospects, and outreach views">
          <Tabs.Trigger value="inventory">Inventory</Tabs.Trigger>
          <Tabs.Trigger value="messages"><MessageSquare size={14} /> Messages</Tabs.Trigger>
          {canShowProspects ? <Tabs.Trigger value="prospects">Prospects</Tabs.Trigger> : null}
          {canShowOutreach ? <Tabs.Trigger value="outreach">Outreach</Tabs.Trigger> : null}
        </Tabs.List>
        <Tabs.Content value="inventory" className={styles.inventoryTabPanel}>
      {workspaceId && canImportSupplyData ? (
        <details className={styles.sourcingCsvImport}>
          <summary>Import parts CSV</summary>
          <SupplyOsSharedWorkspace
            workspaceId={workspaceId}
            onPublished={onSnapshotPublished}
          />
        </details>
      ) : null}

      <form className={styles.sourcingComposer} onSubmit={submitRequest}>
        <Sparkles size={17} aria-hidden="true" />
        <label htmlFor="new-sourcing-request">
          <span>New sourcing request</span>
          <input
            id="new-sourcing-request"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={240}
            placeholder="Describe the part, quantity, specification, and need-by date"
          />
        </label>
        <button type="submit" aria-label="Research sourcing request" disabled={!query.trim() || !researchWorkspaceReady}><span>{researchWorkspaceReady ? "Research" : "Select a company"}</span><ArrowRight size={15} /></button>
      </form>

      <header className={styles.sourcingQueueHeader}>
        <h2>Sourcing queue</h2>
        {dataState === "error"
          ? <button type="button" onClick={onRetryData}>Retry saved work</button>
          : <span>{dataState === "loading" ? "Loading saved work" : pendingRequests.length ? `${pendingRequests.length} request${pendingRequests.length === 1 ? "" : "s"} need input` : "Office-shared work"}</span>}
      </header>

      {intelligenceProfile ? (
        <section className={styles.supplyIntelligenceSummary} aria-label="Customer supply profile">
          <header>
            <span><small>Customer supply profile</small><strong>{intelligenceProfile.customer.workspaceName}</strong></span>
            <dl>
              <div><dt>Needs observed</dt><dd>{intelligenceProfile.customer.factCount}</dd></div>
              <div><dt>Supplier universe</dt><dd>{intelligenceProfile.supplierCount}</dd></div>
            </dl>
          </header>
          <div>
            {intelligenceProfile.suppliers.slice(0, 6).map((supplier) => {
              const price = supplier.priceObservations[0] ?? null;
              const priceAge = price ? Date.now() - new Date(price.observedAt).getTime() : null;
              const fresh = priceAge !== null && priceAge >= 0 && priceAge <= 60 * 86_400_000;
              return (
                <article key={supplier.id}>
                  <span>
                    <strong>{supplier.companyName}</strong>
                    <small>{Array.isArray(supplier.roles) && supplier.roles.length ? supplier.roles.join(" / ").toLowerCase() : "Candidate supplier"}</small>
                  </span>
                  {price ? (
                    <span>
                      <strong>{Number(price.amount).toLocaleString("en-US")} {price.currency} / {price.unitOfMeasure}</strong>
                      <small>{price.observationType === "PUBLIC_LIST_PRICE" ? fresh ? "Forced-live public listing. RFQ confirmation required" : "Historical public listing" : "Reviewed supplier price"} · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(price.observedAt))}</small>
                    </span>
                  ) : <span><strong>Price unavailable</strong><small>RFQ required</small></span>}
                  <span>
                    {price ? <a href={price.sourceUrl} target="_blank" rel="noreferrer">Open price</a> : null}
                    {!price && supplier.website ? <a href={supplier.website} target="_blank" rel="noreferrer">Open supplier</a> : null}
                  </span>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {sourceMap ? (
        <motion.section
          className={styles.inventoryMapDisclosure}
          aria-label={`Source location for ${sourceName}`}
          initial={reduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <header>
            <span><small>Source location</small><strong>{sourceName}</strong><em>{sourceLocation}</em></span>
            <button type="button" onClick={onHideSourceMap}><ChevronUp size={15} /> Hide map</button>
          </header>
          <div>{sourceMap}</div>
        </motion.section>
      ) : null}

      <div className={styles.inventoryTableRegion}>
        <table className={styles.inventoryTable}>
          <thead>
            <tr>
              <th>Part</th>
              <th>Requirement</th>
              <th>Need by</th>
              <th>Source state</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pendingRequests.map((request, index) => {
              const draft = request.draft;
              return (
                <tr key={request.id} data-status="watch">
                  <td>
                    <button
                      type="button"
                      disabled={!researchWorkspaceReady}
                      onClick={() => onOpenPendingRequest(request)}
                    >
                      <span className={styles.inventoryStatusDot} />
                      <span>
                        <small>{`NEW-${String(index + 1).padStart(3, "0")}`}</small>
                        <strong title={request.title}>{request.title}</strong>
                        <em title={draft?.specification ?? request.requestText}>{draft?.specification ?? request.requestText}</em>
                      </span>
                    </button>
                  </td>
                  <td>{draft?.quantity && draft.unit ? `${draft.quantity.toLocaleString("en-US")} ${draft.unit}` : "Not set"}</td>
                  <td>{draft?.needByDate ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${draft.needByDate}T12:00:00Z`)) : "Not set"}</td>
                  <td className={styles.inventorySourceState} title={request.status}>{request.status}</td>
                  <td>
                    <div className={styles.sourcingRowActions}>
                      <button
                        type="button"
                        className={styles.sourcingQueueAction}
                        disabled={!researchWorkspaceReady}
                        onClick={() => onOpenPendingRequest(request)}
                      >
                        {researchWorkspaceReady ? "Edit details" : "Select a company"} <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        className={styles.sourcingDeleteAction}
                        onClick={() => {
                          if (window.confirm(`Delete the draft ${request.title}? This cannot be undone.`)) {
                            onDeletePendingRequest(request.id);
                          }
                        }}
                        aria-label={`Delete ${request.title}`}
                      ><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {customerProcurementOrders.map((request) => {
              const item = customerProcurementItem(request);
              const order = customerProcurementOrderState(request);
              const sourceState = request.status === "awaiting_shortlist_approval"
                ? "Shortlist under review"
                : request.status === "awaiting_order_approval"
                  ? "Order under review"
                  : customerProcurementStatusLabel(request.status);
              const sourceStateDetail = customerProcurementProgress(request.status, 0, request.progress);
              return (
                <tr key={request.id} data-status="request">
                  <td>
                    <button type="button" onClick={() => onOpenCustomerProcurement(item, order)}>
                      <span className={styles.inventoryStatusDot} />
                      <span><small>{item.sku}</small><strong title={request.material}>{request.material}</strong><em title={request.specification ?? undefined}>{request.specification ?? "Specification not provided"}</em></span>
                    </button>
                  </td>
                  <td>{request.quantity.toLocaleString("en-US")} {request.unit}</td>
                  <td>{request.neededBy ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${request.neededBy}T12:00:00Z`)) : "Not set"}</td>
                  <td className={styles.inventorySourceState} title={`${sourceState}. ${sourceStateDetail}`}>{sourceState}</td>
                  <td>
                    <button className={styles.sourcingQueueAction} type="button" onClick={() => onOpenCustomerProcurement(item, order)}>
                      {request.status === "new"
                        ? "Start sourcing"
                        : request.status === "needs_attention"
                          ? "Resolve blocker"
                          : request.status === "awaiting_shortlist_approval"
                            ? "Review shortlist"
                            : request.status === "awaiting_order_approval"
                              ? "Review order"
                              : ["researching", "sourcing"].includes(request.status) ? "View progress" : "View results"} <ArrowRight size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {sourcingItems.map((item) => {
              const run = latestRuns.get(item.sku);
              const runCases = run ? casesByRunId.get(run.id) ?? [] : [];
              const requestedQuantity = sourcingRequestQuantity(item);
              return (
              <Fragment key={item.itemKey ?? item.sku}>
              <tr data-active={item.sku === selectedSku} data-status="shortage">
                <td>
                  <button type="button" aria-pressed={item.sku === selectedSku} onClick={() => onSelect(item.sku)}>
                    <span className={styles.inventoryStatusDot} />
                    <span><small>{item.sku}</small><strong title={item.name}>{item.name}</strong><em title={item.specification}>{item.specification}</em></span>
                  </button>
                </td>
                <td>{item.requirementLabel ?? (requestedQuantity === null ? "Quantity unknown" : `${requestedQuantity.toLocaleString("en-US")} ${item.requestedUnit ?? item.unitOfMeasure ?? "unit not provided"}`)}</td>
                <td>{formatNeedBy(item)}</td>
                <td className={styles.inventorySourceState} title={workstreamSummary(runCases) ?? resultState(run)}>{workstreamSummary(runCases) ?? resultState(run)}</td>
                <td>
                  <div className={styles.sourcingRowActions}>
                    <button
                      className={styles.sourcingQueueAction}
                      type="button"
                      disabled={!researchWorkspaceReady}
                      onClick={() => {
                        if (run && run.status !== "FAILED") onOpenSavedResearch(run);
                        else onStartItemResearch(item);
                      }}
                    >
                      {!researchWorkspaceReady ? "Select a company" : queueActionLabel(run, runCases)}
                      <ArrowRight size={13} />
                    </button>
                    {canImportSupplyData && item.itemKey ? (
                      <>
                        <button type="button" className={styles.sourcingEditAction} onClick={() => editItem(item)} aria-label={`Edit ${item.name}`}><Pencil size={13} /></button>
                        <button type="button" className={styles.sourcingDeleteAction} onClick={() => void deleteItem(item)} aria-label={`Delete ${item.name}`}><Trash2 size={13} /></button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
              {editingItemKey === item.itemKey ? (
                <tr className={styles.sourcingEditRow}>
                  <td colSpan={5}>
                    <form onSubmit={saveItem}>
                      <header><strong>Edit sourcing item</strong><span>{item.sku}</span></header>
                      <div>
                        <label>Name<input value={itemDraft.name} onChange={(event) => setItemDraft((current) => ({ ...current, name: event.target.value }))} required /></label>
                        <label>Manufacturer<input value={itemDraft.manufacturer} onChange={(event) => setItemDraft((current) => ({ ...current, manufacturer: event.target.value }))} /></label>
                        <label>Part number<input value={itemDraft.mpn} onChange={(event) => setItemDraft((current) => ({ ...current, mpn: event.target.value }))} /></label>
                        <label>Quantity<input type="number" min="0.000001" step="any" value={itemDraft.requestedQuantity} onChange={(event) => setItemDraft((current) => ({ ...current, requestedQuantity: event.target.value }))} /></label>
                        <label>Unit<input value={itemDraft.requestedUnit} onChange={(event) => setItemDraft((current) => ({ ...current, requestedUnit: event.target.value }))} required /></label>
                        <label>Need by<input type="date" value={itemDraft.needByDate} onChange={(event) => setItemDraft((current) => ({ ...current, needByDate: event.target.value }))} /></label>
                        <label className={styles.sourcingEditWide}>Deliver to<input value={itemDraft.deliveryLocation} onChange={(event) => setItemDraft((current) => ({ ...current, deliveryLocation: event.target.value }))} /></label>
                        <label className={styles.sourcingEditWide}>Specification<textarea value={itemDraft.description} onChange={(event) => setItemDraft((current) => ({ ...current, description: event.target.value }))} rows={3} /></label>
                        <label className={styles.sourcingEditWide}>Supplier deliverable or QA<textarea value={itemDraft.supplierDeliverable} onChange={(event) => setItemDraft((current) => ({ ...current, supplierDeliverable: event.target.value }))} rows={2} /></label>
                      </div>
                      {itemMutationError ? <p>{itemMutationError}</p> : null}
                      <footer>
                        <button type="button" onClick={() => setEditingItemKey(null)}>Cancel</button>
                        <button type="submit" disabled={itemMutationState === "saving"}>{itemMutationState === "saving" ? "Saving" : "Save item"}</button>
                      </footer>
                    </form>
                  </td>
                </tr>
              ) : null}
              </Fragment>
              );
            })}
            {!pendingRequests.length && !customerProcurementOrders.length && !sourcingItems.length && !customRuns.length && !additionalRuns.length ? (
              <tr data-status="empty">
                <td colSpan={5}>No sourceable parts are published. Import a parts CSV with quantity, delivery location, and need-by date.</td>
              </tr>
            ) : null}
            {customRuns.map((run) => {
              const runCases = casesByRunId.get(run.id) ?? [];
              return (
              <tr key={run.id} data-status="request">
                <td>
                  <button type="button" onClick={() => onOpenSavedResearch(run)}>
                    <span className={styles.inventoryStatusDot} />
                    <span><small>Custom request</small><strong title={run.input.componentName}>{run.input.componentName}</strong><em title={run.input.specification || run.input.requestText}>{run.input.specification || run.input.requestText}</em></span>
                  </button>
                </td>
                <td>Custom request</td>
                <td>Not set</td>
                <td className={styles.inventorySourceState} title={workstreamSummary(runCases) ?? resultState(run)}>{workstreamSummary(runCases) ?? resultState(run)}</td>
                <td>
                  <button
                    className={styles.sourcingQueueAction}
                    type="button"
                    onClick={() => run.status === "FAILED" ? onRetryResearch(run) : onOpenSavedResearch(run)}
                  >
                    {dataState === "loading" ? "Loading" : dataState === "error" ? "Unavailable" : queueActionLabel(run, runCases)} <ArrowRight size={13} />
                  </button>
                </td>
              </tr>
              );
            })}
            {additionalRuns.map((run) => {
              const runCases = casesByRunId.get(run.id) ?? [];
              return (
                <tr key={run.id} data-status="history">
                  <td>
                  <button type="button" onClick={() => run.status !== "FAILED" && onOpenSavedResearch(run)} disabled={run.status === "FAILED"}>
                      <span className={styles.inventoryStatusDot} />
                      <span><small>Saved research · {formatResearchDate(run.createdAt)}</small><strong title={run.input.componentName}>{run.input.componentName}</strong><em title={run.input.specification || run.input.requestText}>{run.input.specification || run.input.requestText}</em></span>
                    </button>
                  </td>
                  <td>{run.input.componentItemKey}</td>
                  <td>{formatResearchDate(run.createdAt)}</td>
                  <td className={styles.inventorySourceState} title={workstreamSummary(runCases) ?? resultState(run)}>{workstreamSummary(runCases) ?? resultState(run)}</td>
                  <td>
                  <button
                    className={styles.sourcingQueueAction}
                    type="button"
                    onClick={() => run.status === "FAILED" ? onRetryResearch(run) : onOpenSavedResearch(run)}
                    >
                      {dataState === "loading" ? "Loading" : dataState === "error" ? "Unavailable" : queueActionLabel(run, runCases)} <ArrowRight size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasMore || pageState === "error" ? (
          <div className={styles.sourcingQueuePagination} aria-live="polite">
            <button type="button" onClick={onLoadMore} disabled={pageState === "loading"}>
              {pageState === "loading" ? "Loading older work" : pageState === "error" ? "Retry older work" : "Load older requests"}
            </button>
            {pageState === "error" ? <span>Older saved work could not be loaded.</span> : null}
          </div>
        ) : null}
      </div>
        </Tabs.Content>
        <Tabs.Content value="messages" className={styles.inventoryTabPanel}>
          <ActiveSourcingWorkspace
            workflowRequests={customerProcurementOrders}
            historicalRuns={messageResearchRuns}
            historicalCases={messageProcurementCases}
            onOpenWorkflowRequest={(request) => onOpenCustomerProcurement(
              customerProcurementItem(request),
              customerProcurementOrderState(request),
            )}
            onOpenHistoricalRun={onOpenSavedResearch}
            hasMoreHistorical={hasMore}
            historicalPageState={pageState}
            onLoadOlderHistorical={onLoadMore}
          />
        </Tabs.Content>
        {canShowProspects ? (
          <Tabs.Content value="prospects" className={styles.inventoryTabPanel}>
            <SupplyOsProspects
              storageScope={storageScope}
              initialListSlug={initialResearchListSlug}
              initialQuery={initialResearchQuery}
              initialStatus={initialResearchStatus}
              initialPage={initialResearchPage}
            />
          </Tabs.Content>
        ) : null}
        {canShowOutreach ? (
          <Tabs.Content value="outreach" className={`${styles.inventoryTabPanel} ${styles.outreachTabPanel}`}>
            <SupplyOsOutreach />
          </Tabs.Content>
        ) : null}
      </Tabs.Root>
    </motion.section>
  );
}

export function SupplySourcingInspector({
  item,
  selectedCandidateId,
  onSelectCandidate,
  onShowCandidateSource,
  onStartProcurement,
  canStartProcurement = true,
}: {
  item: SupplyInventoryItem;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
  onShowCandidateSource: (candidateId: string) => void;
  onStartProcurement: () => void;
  canStartProcurement?: boolean;
}) {
  const shortage = shortageQuantity(item);
  const selectedCandidate = item.candidates.find((candidate) => candidate.id === selectedCandidateId)
    ?? item.candidates[0]
    ?? null;
  const reduceMotion = useReducedMotion();

  return (
    <motion.aside
      key={item.sku}
      className={`${styles.commandInspector} ${styles.sourcingInspector}`}
      aria-label={`Sourcing request for ${item.name}`}
      initial={reduceMotion ? false : { opacity: 0.84, x: 4 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, x: 10 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className={styles.sourcingInspectorHeader}>
        <span className={styles.sourcingInspectorIcon}><PackageSearch size={18} /></span>
        <span><small>Sourcing request</small><h2>{item.name}</h2><em>{item.sku}</em></span>
        <i data-status="shortage">Open</i>
      </header>

      <div className={styles.sourcingInspectorBody}>
        <section className={styles.sourcingSpecification}>
          <small>Specification</small>
          <p>{item.specification}</p>
          {item.supplierDeliverable ? <p><strong>QA:</strong> {item.supplierDeliverable}</p> : null}
        </section>

        <dl className={styles.sourcingRequestFacts}>
          <div><dt>Requirement</dt><dd>{item.requirementLabel ?? (sourcingRequestQuantity(item) === null ? "Unknown" : `${sourcingRequestQuantity(item)?.toLocaleString("en-US")} ${item.requestedUnit ?? item.unitOfMeasure ?? "units"}`)}</dd></div>
          <div><dt>Need by</dt><dd>{formatNeedBy(item)}</dd></div>
          <div><dt>Deliver to</dt><dd>{item.deliveryLocation ?? "Not supplied"}</dd></div>
        </dl>

        <section className={styles.sourcingCandidates}>
          <header>
            <span><small>Starting sources</small><h3>Candidate preview</h3></span>
            {selectedCandidate ? (
              <button type="button" onClick={() => onShowCandidateSource(selectedCandidate.id)}><MapPin size={13} /> Show source</button>
            ) : null}
          </header>
          <div className={styles.candidateProvenance}>{item.source === "published-snapshot" ? `Published snapshot v${item.snapshotVersion}` : "Unpublished input"}</div>
          {!item.candidates.length ? <div className={styles.candidateProvenance}>No candidates yet. Start research to find and qualify sources.</div> : null}
          {item.candidates.map((candidate) => {
            const active = candidate.id === selectedCandidate?.id;
            return (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={active}
                data-active={active}
                onClick={() => onSelectCandidate(candidate.id)}
              >
                <span className={styles.candidateChoice}>{active ? <CheckCircle2 size={16} /> : <span />}</span>
                <span className={styles.candidateIdentity}><strong>{candidate.name}</strong><small>{candidate.role} · {candidate.location}</small></span>
                <span className={styles.candidateCommercial}><strong>{formatCurrency(candidate.modeledUnitCostUsd)}</strong><small>{candidate.leadTimeDays} days · MOQ {candidate.minimumOrderQuantity}</small></span>
                <p>{candidate.fit}</p>
              </button>
            );
          })}
        </section>
      </div>

      <footer className={styles.sourcingActionFooter}>
        <button type="button" onClick={onStartProcurement} disabled={!canStartProcurement || (item.source !== "published-snapshot" && !shortage)}>
          <PackageSearch size={15} /> {canStartProcurement ? "Start procurement" : "Preparing workspace"}
        </button>
      </footer>
      <footer className={styles.sourcingBoundary}>
        <TriangleAlert size={13} /> {item.source === "published-snapshot" ? "Published customer input. Research does not contact or approve a supplier." : "Unpublished input. Publish customer data before procurement."}
      </footer>
    </motion.aside>
  );
}
