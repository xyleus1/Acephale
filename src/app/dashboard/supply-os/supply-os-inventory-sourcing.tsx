"use client";

import {
  ArrowRight,
  CheckCircle2,
  ChevronUp,
  LoaderCircle,
  MapPin,
  PackageSearch,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  sourcingNeedByDate,
  sourcingRequestQuantity,
  shortageQuantity,
  type AtlasInventoryItem,
} from "@/lib/supply-os/atlas-robotics-inventory";
import type {
  SourcingRequestDraft,
  SourcingRequiredField,
} from "@/lib/supply-os/sourcing-request-contract";
import styles from "./supply-os-logistics.module.css";
import type {
  SavedProcurementCase,
  SavedSourcingResearchRun,
  SupplyIntelligenceProfile,
  SupplierResearchCampaign,
} from "./supply-os-sourcing-research-types";
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

export type ExternalWorkflowSummary = {
  configured: boolean;
  triggerConfigured: boolean;
  materialCount: number;
  latestRun: {
    id: string;
    status: "QUEUED" | "DISPATCHED" | "RUNNING" | "SUCCEEDED" | "FAILED";
    error: string | null;
  } | null;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNeedBy(item: AtlasInventoryItem) {
  const value = sourcingNeedByDate(item);
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function formatResearchDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function AtlasInventoryWorkspace({
  selectedSku,
  items = [],
  workspaceId,
  canImportSupplyData,
  onSnapshotPublished,
  onSelect,
  onCreateRequest,
  onRetryResearch,
  pendingRequests,
  onOpenPendingRequest,
  researchRuns,
  procurementCases,
  intelligenceProfile,
  researchCampaign,
  researchCampaignState,
  researchCampaignError,
  onRetryResearchCampaign,
  externalWorkflow,
  externalWorkflowState,
  externalWorkflowError,
  onStartExternalWorkflow,
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
  companyName = "Atlas Robotics",
}: {
  selectedSku: string;
  items?: AtlasInventoryItem[];
  workspaceId?: string | null;
  canImportSupplyData: boolean;
  onSnapshotPublished?: () => void;
  onSelect: (sku: string) => void;
  onCreateRequest: (query: string) => void;
  onRetryResearch: (run: SavedSourcingResearchRun) => void;
  pendingRequests: PendingSourcingQueueItem[];
  onOpenPendingRequest: (request: PendingSourcingQueueItem) => void;
  researchRuns: SavedSourcingResearchRun[];
  procurementCases: SavedProcurementCase[];
  intelligenceProfile: SupplyIntelligenceProfile | null;
  researchCampaign?: SupplierResearchCampaign | null;
  researchCampaignState?: "idle" | "running" | "complete" | "error";
  researchCampaignError?: string | null;
  onRetryResearchCampaign?: () => void;
  externalWorkflow?: ExternalWorkflowSummary | null;
  externalWorkflowState?: "idle" | "loading" | "starting" | "ready" | "error";
  externalWorkflowError?: string | null;
  onStartExternalWorkflow?: () => void;
  researchWorkspaceReady?: boolean;
  dataState: "loading" | "ready" | "error";
  hasMore: boolean;
  pageState: "idle" | "loading" | "error";
  onRetryData: () => void;
  onLoadMore: () => void;
  onStartItemResearch: (item: AtlasInventoryItem) => void;
  onOpenSavedResearch: (run: SavedSourcingResearchRun) => void;
  sourceMap?: ReactNode;
  sourceName?: string;
  sourceLocation?: string;
  onHideSourceMap?: () => void;
  companyName?: string;
}) {
  const [query, setQuery] = useState("");
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
  const campaignItems = new Map((researchCampaign?.items ?? []).map((item) => [item.componentItemKey, item]));
  const retryUnavailableCampaign = !researchWorkspaceReady && researchCampaignState === "error"
    ? onRetryResearchCampaign
    : undefined;

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
        <button type="submit" aria-label="Research sourcing request" disabled={!query.trim() || !researchWorkspaceReady}><span>{researchWorkspaceReady ? "Research" : researchCampaignState === "error" ? "Research unavailable" : "Preparing workspace"}</span><ArrowRight size={15} /></button>
      </form>

      <header className={styles.sourcingQueueHeader}>
        <h2>Sourcing queue</h2>
        {dataState === "error"
          ? <button type="button" onClick={onRetryData}>Retry saved work</button>
          : <span>{dataState === "loading" ? "Loading saved work" : pendingRequests.length ? `${pendingRequests.length} request${pendingRequests.length === 1 ? "" : "s"} need input` : "Office-shared work"}</span>}
      </header>

      {externalWorkflowState && externalWorkflowState !== "idle" ? (
        <section className={styles.sourcingCampaignSummary} aria-label="GUILD2 workflow status">
          <span>
            {externalWorkflowState === "error" || externalWorkflow?.latestRun?.status === "FAILED"
              ? <TriangleAlert size={17} />
              : externalWorkflow?.latestRun?.status === "SUCCEEDED"
                ? <CheckCircle2 size={17} />
                : <LoaderCircle size={17} />}
            <span>
              <small>New workflow database</small>
              <strong>{externalWorkflowState === "loading"
                ? "Loading GUILD2"
                : `${externalWorkflow?.materialCount ?? 0} materials in GUILD2`}</strong>
            </span>
          </span>
          <dl>
            <div><dt>Database</dt><dd>{externalWorkflow?.configured ? "Connected" : "Missing"}</dd></div>
            <div><dt>Workflow</dt><dd>{externalWorkflow?.triggerConfigured ? "Connected" : "Needs trigger"}</dd></div>
            <div><dt>Latest run</dt><dd>{externalWorkflow?.latestRun?.status ?? "Not run"}</dd></div>
          </dl>
          <p>{externalWorkflowError
            ?? externalWorkflow?.latestRun?.error
            ?? (externalWorkflow?.triggerConfigured
              ? "Run creates a durable record in the new database and dispatches the sourcing workflow."
              : "Add the web agent trigger before running. The materials are already stored in the new database.")}</p>
          {onStartExternalWorkflow ? (
            <button
              type="button"
              onClick={onStartExternalWorkflow}
              disabled={externalWorkflowState === "loading" || externalWorkflowState === "starting" || !externalWorkflow?.triggerConfigured || ["QUEUED", "DISPATCHED", "RUNNING"].includes(externalWorkflow?.latestRun?.status ?? "")}
            >
              {externalWorkflowState === "starting" ? "Starting" : "Run workflow"}
            </button>
          ) : null}
        </section>
      ) : null}

      {researchCampaignState !== "idle" ? (
        <section className={styles.sourcingCampaignSummary} aria-label="Bulk supplier research status">
          <span>
            {researchCampaignState === "error" ? <TriangleAlert size={17} /> : researchCampaignState === "complete" ? <CheckCircle2 size={17} /> : <LoaderCircle size={17} />}
            <span>
              <small>Bulk supplier research</small>
              <strong>{researchCampaign
                ? `${researchCampaign.totals.targetMet} of ${researchCampaign.totals.supplierSearchable} sourceable lines covered`
                : researchCampaignState === "error" ? "Supplier research unavailable" : "Starting 38 sourceable lines"}</strong>
            </span>
          </span>
          {researchCampaign ? (
            <dl>
              <div><dt>Source-backed candidates</dt><dd>{researchCampaign.leadCount}</dd></div>
              <div><dt>Active attempts</dt><dd>{researchCampaign.totals.queued + researchCampaign.totals.running}</dd></div>
              <div><dt>Blocked</dt><dd>{researchCampaign.totals.needsClarification + researchCampaign.totals.requirementOnly}</dd></div>
            </dl>
          ) : null}
          <p>{researchCampaignState === "error"
            ? researchCampaignError ?? "Supplier research stopped. Saved results remain available for review."
            : researchCampaign?.state === "DAILY_CAP"
              ? "The daily research limit is reached. Work resumes automatically after the limit resets."
              : researchCampaignState === "complete"
                ? "Each covered line has 3 to 5 distinct, attributable candidates pending human qualification. No supplier was contacted."
                : "Background attempts continue after you leave this page. Item 027 needs clarification; item 039 is applied as an award requirement."}</p>
          {researchCampaignState === "error" && onRetryResearchCampaign ? <button type="button" onClick={onRetryResearchCampaign}>Retry research</button> : null}
        </section>
      ) : null}

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
                      disabled={!researchWorkspaceReady && !retryUnavailableCampaign}
                      onClick={() => {
                        if (retryUnavailableCampaign) {
                          retryUnavailableCampaign();
                          return;
                        }
                        onOpenPendingRequest(request);
                      }}
                    >
                      <span className={styles.inventoryStatusDot} />
                      <span>
                        <small>{`NEW-${String(index + 1).padStart(3, "0")}`}</small>
                        <strong>{request.title}</strong>
                        <em>{draft?.specification ?? request.requestText}</em>
                      </span>
                    </button>
                  </td>
                  <td>{draft?.quantity && draft.unit ? `${draft.quantity.toLocaleString("en-US")} ${draft.unit}` : "Not set"}</td>
                  <td>{draft?.needByDate ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${draft.needByDate}T12:00:00Z`)) : "Not set"}</td>
                  <td>{request.status}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.sourcingQueueAction}
                      disabled={!researchWorkspaceReady && !retryUnavailableCampaign}
                      onClick={() => {
                        if (retryUnavailableCampaign) {
                          retryUnavailableCampaign();
                          return;
                        }
                        onOpenPendingRequest(request);
                      }}
                    >
                      {retryUnavailableCampaign ? "Retry research" : researchWorkspaceReady ? "Continue" : "Preparing workspace"} <ArrowRight size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {sourcingItems.map((item) => {
              const campaignItem = campaignItems.get(item.sku);
              const run = campaignItem?.aggregateRun ?? latestRuns.get(item.sku);
              const runCases = run ? casesByRunId.get(run.id) ?? [] : [];
              const requestedQuantity = sourcingRequestQuantity(item);
              const campaignInProgress = campaignItem?.classification === "SUPPLIER_SEARCH"
                && !campaignItem.aggregateRun
                && campaignItem.state !== "COMPLETE";
              const campaignRequirementOnly = campaignItem?.classification === "REQUIREMENT_ONLY";
              return (
              <tr key={item.sku} data-active={item.sku === selectedSku} data-status="shortage">
                <td>
                  <button type="button" aria-pressed={item.sku === selectedSku} onClick={() => onSelect(item.sku)}>
                    <span className={styles.inventoryStatusDot} />
                    <span><small>{item.sku}</small><strong>{item.name}</strong><em>{item.specification}</em></span>
                  </button>
                </td>
                <td>{item.requirementLabel ?? (requestedQuantity === null ? "Quantity unknown" : `${requestedQuantity.toLocaleString("en-US")} ${item.requestedUnit ?? item.unitOfMeasure ?? "units"}`)}</td>
                <td>{formatNeedBy(item)}</td>
                <td>{workstreamSummary(runCases)
                  ?? (retryUnavailableCampaign
                    ? "Research unavailable"
                    : campaignItem?.leadCount
                      ? `${campaignItem.leadCount} source-backed candidate${campaignItem.leadCount === 1 ? "" : "s"}${campaignItem.state === "COMPLETE" ? "" : ", researching"}`
                      : campaignItem?.state === "CLARIFICATION_REQUIRED"
                        ? "Clarification required"
                        : campaignRequirementOnly
                          ? "Award requirement"
                          : campaignInProgress
                            ? "Background research"
                            : resultState(run))}</td>
                <td>
                  <button
                    className={styles.sourcingQueueAction}
                    type="button"
                    disabled={!retryUnavailableCampaign && (campaignInProgress || campaignRequirementOnly || !researchWorkspaceReady)}
                    onClick={() => {
                      if (retryUnavailableCampaign) {
                        retryUnavailableCampaign();
                        return;
                      }
                      if (run && run.status !== "FAILED") onOpenSavedResearch(run);
                      else onStartItemResearch(item);
                    }}
                  >
                    {retryUnavailableCampaign ? "Retry research" : campaignRequirementOnly ? "Applied to awards" : !researchWorkspaceReady ? "Preparing workspace" : campaignInProgress ? "Campaign running" : queueActionLabel(run, runCases)}
                    <ArrowRight size={13} />
                  </button>
                </td>
              </tr>
              );
            })}
            {!pendingRequests.length && !sourcingItems.length && !customRuns.length && !additionalRuns.length ? (
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
                    <span><small>Custom request</small><strong>{run.input.componentName}</strong><em>{run.input.specification || run.input.requestText}</em></span>
                  </button>
                </td>
                <td>Custom request</td>
                <td>Not set</td>
                <td>{workstreamSummary(runCases) ?? resultState(run)}</td>
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
                      <span><small>Saved research · {formatResearchDate(run.createdAt)}</small><strong>{run.input.componentName}</strong><em>{run.input.specification || run.input.requestText}</em></span>
                    </button>
                  </td>
                  <td>{run.input.componentItemKey}</td>
                  <td>{formatResearchDate(run.createdAt)}</td>
                  <td>{workstreamSummary(runCases) ?? resultState(run)}</td>
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
    </motion.section>
  );
}

export function AtlasSourcingInspector({
  item,
  selectedCandidateId,
  onSelectCandidate,
  onShowCandidateSource,
  onStartProcurement,
  canStartProcurement = true,
}: {
  item: AtlasInventoryItem;
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
          <div className={styles.candidateProvenance}>{item.source === "published-snapshot" ? `Published snapshot v${item.snapshotVersion}` : "Demo candidates · unqualified"}</div>
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
        <TriangleAlert size={13} /> {item.source === "published-snapshot" ? "Published customer input. Research does not contact or approve a supplier." : "Demo request and modeled terms. Research does not contact or approve a supplier."}
      </footer>
    </motion.aside>
  );
}
