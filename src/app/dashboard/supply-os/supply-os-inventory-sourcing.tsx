"use client";

import {
  ArrowRight,
  CheckCircle2,
  ChevronUp,
  MapPin,
  PackageSearch,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  ATLAS_ROBOTICS_INVENTORY,
  ATLAS_SOURCING_NEED_BY,
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
} from "./supply-os-sourcing-research-types";

export type PendingSourcingQueueItem = {
  id: string;
  requestText: string;
  title: string;
  draft: SourcingRequestDraft | null;
  missingFields: SourcingRequiredField[];
  lastQuestion: string | null;
  status: "Clarification needed" | "Researching" | "Research unavailable";
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNeedBy(sku: string) {
  const value = ATLAS_SOURCING_NEED_BY[sku];
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function formatResearchDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function AtlasInventoryWorkspace({
  selectedSku,
  onSelect,
  onCreateRequest,
  pendingRequests,
  onOpenPendingRequest,
  researchRuns,
  procurementCases,
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
}: {
  selectedSku: string;
  onSelect: (sku: string) => void;
  onCreateRequest: (query: string) => void;
  pendingRequests: PendingSourcingQueueItem[];
  onOpenPendingRequest: (request: PendingSourcingQueueItem) => void;
  researchRuns: SavedSourcingResearchRun[];
  procurementCases: SavedProcurementCase[];
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
}) {
  const [query, setQuery] = useState("");
  const reduceMotion = useReducedMotion();
  const sourcingItems = ATLAS_ROBOTICS_INVENTORY.filter((item) => shortageQuantity(item) > 0);
  const runsById = new Map(researchRuns.map((run) => [run.id, run]));
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
  for (const run of researchRuns) {
    if (!latestRuns.has(run.input.componentItemKey)) latestRuns.set(run.input.componentItemKey, run);
  }
  const knownSkus = new Set(ATLAS_ROBOTICS_INVENTORY.map((item) => item.sku));
  const customRuns = [...latestRuns.values()].filter((run) => !knownSkus.has(run.input.componentItemKey));
  const currentRunIds = new Set([...latestRuns.values()].map((run) => run.id));
  const additionalRuns = researchRuns.filter((run) => !currentRunIds.has(run.id));

  function resultState(run: SavedSourcingResearchRun | undefined) {
    if (!run) return "Not researched";
    if (run.status === "RUNNING") return "Researching";
    if (run.status === "FAILED") return "Research failed";
    const count = run.output?.candidates.length ?? 0;
    return count ? `${count} sourced options` : "No sourced options";
  }

  function caseStage(procurementCase: SavedProcurementCase | undefined) {
    if (procurementCase?.result?.purchaseRelease?.state === "ACKNOWLEDGED") return "Supplier acknowledged";
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
      case "COMMERCIAL_CONFIRMATION": return "Confirm commercial terms";
      case "QUALITY_REVIEW": return "Quality plan required";
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
    const procurementCase = cases[0];
    if (cases.length > 1) return "Open quote inbox";
    if (procurementCase?.result?.purchaseRelease) return "Review supplier acknowledgment";
    if (procurementCase?.purchaseAction) return "Review purchase action";
    if (procurementCase?.purchaseDraft) return "Review order draft";
    if (procurementCase?.result?.stage === "COMMERCIAL_CONFIRMATION" && procurementCase.result.quoteCycle) return "Review quote cycle";
    if (procurementCase) return "Continue procurement";
    if (run?.status === "SUCCEEDED") return "View results";
    if (run?.status === "RUNNING") return "Researching";
    if (run?.status === "FAILED") return "Retry research";
    return "Start research";
  }

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dataState !== "ready") return;
    const normalized = query.trim();
    if (!normalized) return;
    onCreateRequest(normalized);
    setQuery("");
  }

  return (
    <motion.section
      className={styles.inventoryWorkspace}
      aria-label="Atlas Robotics sourcing queue"
      initial={reduceMotion ? false : { opacity: 0.82, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, x: -10 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
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
        <button type="submit" aria-label="Research sourcing request" disabled={!query.trim() || dataState !== "ready"}><span>{dataState === "loading" ? "Loading" : dataState === "error" ? "Unavailable" : "Research"}</span><ArrowRight size={15} /></button>
      </form>

      <header className={styles.sourcingQueueHeader}>
        <h2>Sourcing queue</h2>
        {dataState === "error"
          ? <button type="button" onClick={onRetryData}>Retry saved work</button>
          : <span>{dataState === "loading" ? "Loading saved work" : pendingRequests.length ? `${pendingRequests.length} request${pendingRequests.length === 1 ? "" : "s"} need input` : "Office-shared work"}</span>}
      </header>

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
                    <button type="button" onClick={() => onOpenPendingRequest(request)}>
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
                  <td><button type="button" className={styles.sourcingQueueAction} onClick={() => onOpenPendingRequest(request)}>Continue <ArrowRight size={13} /></button></td>
                </tr>
              );
            })}
            {sourcingItems.map((item) => {
              const run = latestRuns.get(item.sku);
              const runCases = run ? casesByRunId.get(run.id) ?? [] : [];
              return (
              <tr key={item.sku} data-active={item.sku === selectedSku} data-status="shortage">
                <td>
                  <button type="button" aria-pressed={item.sku === selectedSku} onClick={() => onSelect(item.sku)}>
                    <span className={styles.inventoryStatusDot} />
                    <span><small>{item.sku}</small><strong>{item.name}</strong><em>{item.specification}</em></span>
                  </button>
                </td>
                <td>{shortageQuantity(item)} units</td>
                <td>{formatNeedBy(item.sku)}</td>
                <td>{workstreamSummary(runCases) ?? resultState(run)}</td>
                <td>
                  <button
                    className={styles.sourcingQueueAction}
                    type="button"
                    disabled={dataState !== "ready" || run?.status === "RUNNING"}
                    onClick={() => run?.status === "SUCCEEDED" ? onOpenSavedResearch(run) : onStartItemResearch(item)}
                  >
                    {dataState === "loading" ? "Loading" : dataState === "error" ? "Unavailable" : queueActionLabel(run, runCases)}
                    <ArrowRight size={13} />
                  </button>
                </td>
              </tr>
              );
            })}
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
                    disabled={dataState !== "ready" || run.status === "RUNNING"}
                    onClick={() => run.status === "SUCCEEDED" ? onOpenSavedResearch(run) : onCreateRequest(run.input.requestText)}
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
                    <button type="button" onClick={() => run.status === "SUCCEEDED" && onOpenSavedResearch(run)} disabled={run.status !== "SUCCEEDED"}>
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
                      disabled={dataState !== "ready" || run.status === "RUNNING"}
                      onClick={() => run.status === "SUCCEEDED" ? onOpenSavedResearch(run) : onCreateRequest(run.input.requestText)}
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
}: {
  item: AtlasInventoryItem;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
  onShowCandidateSource: (candidateId: string) => void;
  onStartProcurement: () => void;
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
        </section>

        <dl className={styles.sourcingRequestFacts}>
          <div><dt>Requirement</dt><dd>{shortage} units</dd></div>
          <div><dt>Need by</dt><dd>{formatNeedBy(item.sku)}</dd></div>
          <div><dt>Deliver to</dt><dd>Austin</dd></div>
        </dl>

        <section className={styles.sourcingCandidates}>
          <header>
            <span><small>Starting sources</small><h3>Candidate preview</h3></span>
            {selectedCandidate ? (
              <button type="button" onClick={() => onShowCandidateSource(selectedCandidate.id)}><MapPin size={13} /> Show source</button>
            ) : null}
          </header>
          <div className={styles.candidateProvenance}>Demo candidates · unqualified</div>
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
        <button type="button" onClick={onStartProcurement} disabled={!shortage}>
          <PackageSearch size={15} /> Start procurement
        </button>
      </footer>
      <footer className={styles.sourcingBoundary}>
        <TriangleAlert size={13} /> Demo request and modeled terms. Research does not contact or approve a supplier.
      </footer>
    </motion.aside>
  );
}
