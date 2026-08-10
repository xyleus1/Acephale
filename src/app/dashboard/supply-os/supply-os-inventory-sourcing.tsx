"use client";

import {
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  MapPin,
  PackageSearch,
  TriangleAlert,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
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

export function AtlasInventoryRail({
  selectedSku,
  onSelect,
}: {
  selectedSku: string;
  onSelect: (sku: string) => void;
}) {
  const summary = atlasInventorySummary();
  const reduceMotion = useReducedMotion();

  return (
    <motion.aside
      className={`${styles.routeRail} ${styles.inventoryRail}`}
      aria-label="Atlas Robotics component inventory"
      initial={reduceMotion ? false : { opacity: 0.82, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <header>
        <span>Atlas component inventory</span>
        <div className={styles.inventoryRailSummary}>
          <small>{summary.itemCount} stocked parts</small>
          <small data-alert="true">{summary.shortageCount} shortages</small>
          <small>{summary.buildableWithInbound} / {summary.demandUnits} robots</small>
          <small>Illustrative demo</small>
        </div>
      </header>
      <div className={styles.inventoryRailList}>
        {ATLAS_ROBOTICS_INVENTORY.map((item) => {
          const status = inventoryStatus(item);
          const shortage = shortageQuantity(item);
          return (
            <button
              key={item.sku}
              type="button"
              data-active={item.sku === selectedSku}
              data-status={status}
              aria-pressed={item.sku === selectedSku}
              onClick={() => onSelect(item.sku)}
            >
              <span className={styles.inventoryStatusDot} />
              <span className={styles.inventoryItemCopy}>
                <small>{item.sku}</small>
                <strong>{item.name}</strong>
                <em>{item.location}</em>
              </span>
              <span className={styles.inventoryQuantity}>
                <small>Projected</small>
                <strong>{projectedAvailable(item)} / {requiredForDemand(item)}</strong>
                <em>{shortage ? `${shortage} short` : status === "watch" ? "Below target" : "Covered"}</em>
              </span>
            </button>
          );
        })}
      </div>
    </motion.aside>
  );
}

export function AtlasSourcingInspector({
  item,
  stage,
  selectedCandidateId,
  onSelectCandidate,
  onAdvance,
}: {
  item: AtlasInventoryItem;
  stage: SourcingStage;
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
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
            {item.candidates.length ? <i>Demo candidates</i> : null}
          </header>
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
