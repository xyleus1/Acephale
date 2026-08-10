"use client";

import {
  CheckCircle2,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  MapPin,
  PackageSearch,
  TriangleAlert,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import {
  ATLAS_ROBOT_DEMAND,
  ATLAS_ROBOTICS_INVENTORY,
  atlasInventorySummary,
  inventoryStatus,
  projectedAvailable,
  requiredForDemand,
  shortageQuantity,
  type AtlasInventoryItem,
} from "@/lib/supply-os/atlas-robotics-inventory";
import styles from "./supply-os-logistics.module.css";

export type SourcingStage = "idle" | "shortlist" | "review";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function stageLabel(stage: SourcingStage) {
  if (stage === "shortlist") return "Shortlist in progress";
  if (stage === "review") return "Approval required";
  return "Not started";
}

export function AtlasInventoryWorkspace({
  selectedSku,
  onSelect,
  sourceMap,
  sourceName,
  sourceLocation,
  onHideSourceMap,
}: {
  selectedSku: string;
  onSelect: (sku: string) => void;
  sourceMap?: ReactNode;
  sourceName?: string;
  sourceLocation?: string;
  onHideSourceMap?: () => void;
}) {
  const summary = atlasInventorySummary();
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      className={styles.inventoryWorkspace}
      aria-label="Atlas Robotics component inventory"
      initial={reduceMotion ? false : { opacity: 0.82, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className={styles.inventoryWorkspaceHeader}>
        <span>
          <small>Inventory & sourcing</small>
          <h2>Component inventory</h2>
        </span>
        <div className={styles.inventoryWorkspaceSummary}>
          <span><strong>{summary.itemCount}</strong> parts</span>
          <span data-alert="true"><strong>{summary.shortageCount}</strong> shortages</span>
          <span><strong>{summary.buildableWithInbound} / {summary.demandUnits}</strong> buildable</span>
          <i>Illustrative</i>
        </div>
      </header>
      {sourceMap ? (
        <motion.section
          className={styles.inventoryMapDisclosure}
          aria-label={`Source location for ${sourceName}`}
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 286 }}
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
              <th>Component</th>
              <th>Per robot</th>
              <th>Required</th>
              <th>On hand</th>
              <th>Allocated</th>
              <th>Inbound</th>
              <th>Projected</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ATLAS_ROBOTICS_INVENTORY.map((item) => {
              const status = inventoryStatus(item);
              const shortage = shortageQuantity(item);
              return (
                <tr key={item.sku} data-active={item.sku === selectedSku} data-status={status}>
                  <td>
                    <button type="button" aria-pressed={item.sku === selectedSku} onClick={() => onSelect(item.sku)}>
                      <span className={styles.inventoryStatusDot} />
                      <span><small>{item.sku}</small><strong>{item.name}</strong><em>{item.location}</em></span>
                    </button>
                  </td>
                  <td>{item.quantityPerRobot}</td>
                  <td>{requiredForDemand(item)}</td>
                  <td>{item.onHand}</td>
                  <td>{item.allocated}</td>
                  <td>{item.confirmedInbound}</td>
                  <td>{projectedAvailable(item)}</td>
                  <td><span className={styles.inventoryStatusLabel}>{shortage ? `${shortage} short` : status === "watch" ? "Watch" : "Covered"}</span></td>
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
  stage,
  selectedCandidateId,
  onSelectCandidate,
  onShowCandidateSource,
  onAdvance,
}: {
  item: AtlasInventoryItem;
  stage: SourcingStage;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
  onShowCandidateSource: (candidateId: string) => void;
  onAdvance: () => void;
}) {
  const shortage = shortageQuantity(item);
  const status = inventoryStatus(item);
  const selectedCandidate = item.candidates.find((candidate) => candidate.id === selectedCandidateId)
    ?? item.candidates[0]
    ?? null;
  const reduceMotion = useReducedMotion();
  const canSource = shortage > 0 && item.candidates.length > 0;

  return (
    <motion.aside
      key={item.sku}
      className={`${styles.commandInspector} ${styles.sourcingInspector}`}
      aria-label={`Sourcing dossier for ${item.name}`}
      initial={reduceMotion ? false : { opacity: 0.84, x: 4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className={styles.sourcingInspectorHeader}>
        <span className={styles.sourcingInspectorIcon}><PackageSearch size={18} /></span>
        <span><small>Inventory & sourcing</small><h2>{item.name}</h2><em>{item.sku}</em></span>
        <i data-status={status}>{shortage ? `${shortage} short` : status === "watch" ? "Watch" : "Covered"}</i>
      </header>

      <div className={styles.sourcingInspectorBody}>
        <section className={styles.sourcingSpecification}>
          <small>Required specification</small>
          <p>{item.specification}</p>
        </section>

        <dl className={styles.sourcingFacts}>
          <div><dt>Per robot</dt><dd>{item.quantityPerRobot}</dd></div>
          <div><dt>Demand</dt><dd>{ATLAS_ROBOT_DEMAND} robots</dd></div>
          <div><dt>On hand</dt><dd>{item.onHand}</dd></div>
          <div><dt>Allocated</dt><dd>{item.allocated}</dd></div>
          <div><dt>Confirmed inbound</dt><dd>{item.confirmedInbound}</dd></div>
          <div data-alert={shortage > 0}><dt>Projected gap</dt><dd>{shortage || "None"}</dd></div>
        </dl>

        <section className={styles.sourcingLocation}>
          <MapPin size={14} />
          <span><small>Inventory point</small><strong>{item.location}</strong></span>
        </section>

        <section className={styles.sourcingCandidates}>
          <header>
            <span><small>Unqualified candidates</small><h3>{item.candidates.length ? "Compare supply options" : "No sourcing required"}</h3></span>
            {selectedCandidate ? (
              <button type="button" onClick={() => onShowCandidateSource(selectedCandidate.id)}><MapPin size={13} /> Show source</button>
            ) : null}
          </header>
          {item.candidates.length ? <div className={styles.candidateProvenance}>Demo candidates · unqualified</div> : null}
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
          {!item.candidates.length ? <p className={styles.sourcingCoveredMessage}>Current projected supply covers this production wave. Add a resilience review only when a second source is actually needed.</p> : null}
        </section>

        <section className={styles.sourcingWorkflow} aria-label="Sourcing workflow">
          <header><h3>Sourcing workflow</h3><span data-stage={stage}>{stageLabel(stage)}</span></header>
          <ol>
            <li data-complete={canSource}><TriangleAlert size={14} /><span><strong>Shortage scoped</strong><small>{shortage ? `${shortage} parts required for the 24-robot wave.` : "No demand gap."}</small></span></li>
            <li data-complete={stage !== "idle"}><PackageSearch size={14} /><span><strong>Candidate selected</strong><small>{stage === "idle" ? "Start sourcing to create the shortlist." : selectedCandidate?.name ?? "Selection required"}</small></span></li>
            <li data-complete={stage === "review"}><FileCheck2 size={14} /><span><strong>Approval gate</strong><small>{stage === "review" ? "Technical and commercial review is required." : "No outreach or award yet."}</small></span></li>
          </ol>
          {selectedCandidate && stage !== "idle" ? (
            <div className={styles.sourcingDraftSummary}>
              <CircleDollarSign size={14} />
              <p>Draft: request {Math.max(shortage, selectedCandidate.minimumOrderQuantity)} units from {selectedCandidate.name}; modeled material exposure {formatCurrency(Math.max(shortage, selectedCandidate.minimumOrderQuantity) * selectedCandidate.modeledUnitCostUsd)}.</p>
            </div>
          ) : null}
        </section>
      </div>

      <footer className={styles.sourcingActionFooter} aria-live="polite">
        <button type="button" onClick={onAdvance} disabled={!canSource || stage === "review"}>
          {stage === "idle" ? <><PackageSearch size={15} /> Start sourcing</> : stage === "shortlist" ? <><FileCheck2 size={15} /> Prepare approval</> : <><Clock3 size={15} /> Awaiting approval</>}
        </button>
      </footer>
      <footer className={styles.sourcingBoundary}>
        <TriangleAlert size={13} /> Illustrative inventory and modeled commercial terms. No supplier has been contacted or approved.
      </footer>
    </motion.aside>
  );
}
