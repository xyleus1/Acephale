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
import styles from "./supply-os-logistics.module.css";
import type {
  SavedProcurementCase,
  SavedSourcingResearchRun,
} from "./supply-os-sourcing-research-types";

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

export function AtlasInventoryWorkspace({
  selectedSku,
  onSelect,
  onCreateRequest,
  researchRuns,
  procurementCases,
  dataState,
  onRetryData,
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
  researchRuns: SavedSourcingResearchRun[];
  procurementCases: SavedProcurementCase[];
  dataState: "loading" | "ready" | "error";
  onRetryData: () => void;
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
  const casesByRunId = new Map(procurementCases.map((procurementCase) => [procurementCase.input.researchRunId, procurementCase]));
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

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dataState !== "ready") return;
    const normalized = query.trim();
    if (!normalized) return;
    onCreateRequest(normalized);
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
          : <span>{dataState === "loading" ? "Loading saved work" : "Illustrative requests"}</span>}
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
            {sourcingItems.map((item) => {
              const run = latestRuns.get(item.sku);
              const procurementCase = run ? casesByRunId.get(run.id) : undefined;
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
                <td>{caseStage(procurementCase) ?? resultState(run)}</td>
                <td>
                  <button
                    className={styles.sourcingQueueAction}
                    type="button"
                    disabled={dataState !== "ready" || run?.status === "RUNNING"}
                    onClick={() => run?.status === "SUCCEEDED" ? onOpenSavedResearch(run) : onStartItemResearch(item)}
                  >
                    {dataState === "loading" ? "Loading" : dataState === "error" ? "Unavailable" : procurementCase?.result?.purchaseRelease ? "Review supplier acknowledgment" : procurementCase?.purchaseAction ? "Review purchase action" : procurementCase?.purchaseDraft ? "Review order draft" : procurementCase?.result?.stage === "COMMERCIAL_CONFIRMATION" && procurementCase.result.quoteCycle ? "Review quote cycle" : procurementCase ? "Continue procurement" : run?.status === "SUCCEEDED" ? "View results" : run?.status === "RUNNING" ? "Researching" : run?.status === "FAILED" ? "Retry research" : "Start research"}
                    <ArrowRight size={13} />
                  </button>
                </td>
              </tr>
              );
            })}
            {customRuns.map((run) => {
              const procurementCase = casesByRunId.get(run.id);
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
                <td>{caseStage(procurementCase) ?? resultState(run)}</td>
                <td>
                  <button
                    className={styles.sourcingQueueAction}
                    type="button"
                    disabled={dataState !== "ready" || run.status === "RUNNING"}
                    onClick={() => run.status === "SUCCEEDED" ? onOpenSavedResearch(run) : onCreateRequest(run.input.requestText)}
                  >
                    {dataState === "loading" ? "Loading" : dataState === "error" ? "Unavailable" : procurementCase?.result?.purchaseRelease ? "Review supplier acknowledgment" : procurementCase?.purchaseAction ? "Review purchase action" : procurementCase?.purchaseDraft ? "Review order draft" : procurementCase?.result?.stage === "COMMERCIAL_CONFIRMATION" && procurementCase.result.quoteCycle ? "Review quote cycle" : procurementCase ? "Continue procurement" : run.status === "SUCCEEDED" ? "View results" : run.status === "RUNNING" ? "Researching" : "Retry research"} <ArrowRight size={13} />
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
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
