"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Globe2,
  LoaderCircle,
  PackageCheck,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import {
  ATLAS_SOURCING_NEED_BY,
  shortageQuantity,
  type AtlasInventoryItem,
  type AtlasSourcingCandidate,
} from "@/lib/supply-os/atlas-robotics-inventory";
import styles from "./supply-os-logistics.module.css";

type ProcurementPhase = "researching" | "compare" | "handoff";
type SourceClass = "Official" | "Trusted" | "New";
type QualityState = "Strong" | "Conditional" | "Unverified";

type ProcurementOption = AtlasSourcingCandidate & {
  sourceClass: SourceClass;
  sourceLabel: string;
  quality: QualityState;
  qualityEvidence: string;
  deliveryDate: string;
};

const DISCOVERED_OPTIONS: Record<string, AtlasSourcingCandidate> = {
  "SEN-LDR-220": {
    id: "tristate-safety-automation",
    name: "TriState Safety Automation",
    location: "Pittsburgh, PA",
    coordinates: { longitude: -79.9959, latitude: 40.4406 },
    role: "Distributor",
    leadTimeDays: 12,
    minimumOrderQuantity: 2,
    modeledUnitCostUsd: 2190,
    fit: "Public catalog match; authorization, allocation, and safety-file coverage are unverified.",
  },
  "VIS-DPT-410": {
    id: "opticore-industrial-vision",
    name: "Opticore Industrial Vision",
    location: "Boston, MA",
    coordinates: { longitude: -71.0589, latitude: 42.3601 },
    role: "Distributor",
    leadTimeDays: 10,
    minimumOrderQuantity: 4,
    modeledUnitCostUsd: 512,
    fit: "Public listing matches the mechanical envelope; calibration and lifecycle evidence are missing.",
  },
  "CMP-IPC-180": {
    id: "frontier-edge-systems",
    name: "Frontier Edge Systems",
    location: "Denver, CO",
    coordinates: { longitude: -104.9903, latitude: 39.7392 },
    role: "Contract manufacturer",
    leadTimeDays: 18,
    minimumOrderQuantity: 3,
    modeledUnitCostUsd: 1225,
    fit: "Public capability match; thermal configuration and image-control process require review.",
  },
  "DRV-MCU-220": {
    id: "nova-motion-supply",
    name: "Nova Motion Supply",
    location: "Charlotte, NC",
    coordinates: { longitude: -80.8431, latitude: 35.2271 },
    role: "Distributor",
    leadTimeDays: 9,
    minimumOrderQuantity: 2,
    modeledUnitCostUsd: 845,
    fit: "Public electrical match; firmware revision and manufacturer authorization are unverified.",
  },
  "PWR-BAT-512": {
    id: "gulf-energy-integration",
    name: "Gulf Energy Integration",
    location: "New Orleans, LA",
    coordinates: { longitude: -90.0715, latitude: 29.9511 },
    role: "Contract manufacturer",
    leadTimeDays: 17,
    minimumOrderQuantity: 4,
    modeledUnitCostUsd: 2290,
    fit: "Public integration capability found; UN 38.3 evidence and cell traceability remain unresolved.",
  },
};

const RESEARCH_STEPS = [
  { label: "Approved source library", detail: "Prior candidates and qualification notes", sourceClass: "Trusted" },
  { label: "Manufacturer catalogs", detail: "Official product and technical documentation", sourceClass: "Official" },
  { label: "Distributor catalogs", detail: "Modeled price, lead time, MOQ, and availability", sourceClass: "Trusted" },
  { label: "Open web discovery", detail: "New candidates held for human qualification", sourceClass: "New" },
] as const;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function deliveryDate(leadTimeDays: number) {
  const date = new Date("2026-08-09T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + leadTimeDays);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatNeedBy(item: AtlasInventoryItem | null) {
  if (!item) return "Not set";
  const value = ATLAS_SOURCING_NEED_BY[item.sku];
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function buildProcurementOptions(item: AtlasInventoryItem | null): ProcurementOption[] {
  if (!item) return [];
  const known = item.candidates.map((candidate, index): ProcurementOption => ({
    ...candidate,
    sourceClass: index === 0 ? "Official" : "Trusted",
    sourceLabel: index === 0 ? "Manufacturer catalog" : "Approved source library",
    quality: index === 0 ? "Strong" : "Conditional",
    qualityEvidence: index === 0
      ? "Technical match found in manufacturer documentation; sample validation remains open."
      : "Prior source record found; current authorization and allocation require review.",
    deliveryDate: deliveryDate(candidate.leadTimeDays),
  }));
  const discovered = DISCOVERED_OPTIONS[item.sku];
  if (!discovered) return known;
  return [...known, {
    ...discovered,
    sourceClass: "New",
    sourceLabel: "Public supplier page",
    quality: "Unverified",
    qualityEvidence: "Public listing only; supplier identity, authorization, and technical fit require qualification.",
    deliveryDate: deliveryDate(discovered.leadTimeDays),
  }];
}

export function AtlasProcurementWorkspace({
  item,
  requestText,
  onBack,
}: {
  item: AtlasInventoryItem | null;
  requestText: string;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const options = useMemo(() => buildProcurementOptions(item), [item]);
  const recommended = options[1] ?? options[0] ?? null;
  const [phase, setPhase] = useState<ProcurementPhase>("researching");
  const [completedSources, setCompletedSources] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState(recommended?.id ?? "");
  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? recommended;

  useEffect(() => {
    if (phase !== "researching") return;
    if (reduceMotion) {
      setCompletedSources(RESEARCH_STEPS.length);
      const finish = window.setTimeout(() => setPhase("compare"), 120);
      return () => window.clearTimeout(finish);
    }
    const timers = RESEARCH_STEPS.map((_, index) => (
      window.setTimeout(() => setCompletedSources(index + 1), 520 + index * 480)
    ));
    timers.push(window.setTimeout(() => setPhase("compare"), 2600));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase, reduceMotion]);

  return (
    <motion.section
      className={styles.procurementWorkspace}
      aria-label="Procurement research"
      initial={reduceMotion ? false : { opacity: 0, x: 14 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, x: 14 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className={styles.procurementHeader}>
        <button type="button" onClick={onBack}><ArrowLeft size={15} /> Back</button>
        <span>
          <small>{item?.sku ?? "New request"}</small>
          <h2>{item?.name ?? requestText}</h2>
        </span>
        <i>Illustrative research</i>
      </header>

      <nav className={styles.procurementProgress} aria-label="Procurement progress">
        <span data-active={phase === "researching"} data-complete={phase !== "researching"}><b>01</b> Research</span>
        <span data-active={phase === "compare"} data-complete={phase === "handoff"}><b>02</b> Compare</span>
        <span data-active={phase === "handoff"}><b>03</b> Handoff</span>
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
              <span className={styles.procurementResearchIcon}><Sparkles size={20} /></span>
              <small>Researching</small>
              <h3>{requestText}</h3>
              <p>Checking trusted records first, then official catalogs and new public sources.</p>
            </section>
            <ol className={styles.procurementSourceLog}>
              {RESEARCH_STEPS.map((step, index) => {
                const complete = completedSources > index;
                const active = completedSources === index;
                return (
                  <li key={step.label} data-complete={complete} data-active={active}>
                    <span>{complete ? <Check size={15} /> : active ? <LoaderCircle size={15} /> : <Search size={15} />}</span>
                    <p><strong>{step.label}</strong><small>{step.detail}</small></p>
                    <i>{step.sourceClass}</i>
                  </li>
                );
              })}
            </ol>
            <footer><TriangleAlert size={14} /> Demo sequence. No live supplier system or website is connected.</footer>
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
            {recommended ? (
              <>
                <section className={styles.procurementRecommendation}>
                  <CheckCircle2 size={19} />
                  <span><small>Suggested option</small><h3>{recommended.name}</h3><p>Meets the modeled need-by date with a reviewed source record. Technical and commercial approval remain required.</p></span>
                  <strong>{formatCurrency(recommended.modeledUnitCostUsd)} / unit</strong>
                </section>
                <div className={styles.procurementOptionTableRegion}>
                  <table className={styles.procurementOptionTable}>
                    <thead><tr><th>Supplier</th><th>Source</th><th>Price</th><th>Delivery</th><th>Quality</th><th /></tr></thead>
                    <tbody>
                      {options.map((option) => (
                        <tr key={option.id} data-selected={option.id === selectedOption?.id} data-recommended={option.id === recommended.id}>
                          <td><strong>{option.name}</strong><small>{option.role} · {option.location}</small>{option.id === recommended.id ? <i>Suggested</i> : null}</td>
                          <td><strong>{option.sourceClass}</strong><small>{option.sourceLabel}</small></td>
                          <td><strong>{formatCurrency(option.modeledUnitCostUsd)}</strong><small>Modeled · MOQ {option.minimumOrderQuantity}</small></td>
                          <td><strong>{option.deliveryDate}</strong><small>{option.leadTimeDays} days modeled</small></td>
                          <td><strong>{option.quality}</strong><small>{option.qualityEvidence}</small></td>
                          <td><button type="button" onClick={() => setSelectedOptionId(option.id)}>{option.id === selectedOption?.id ? <Check size={14} /> : null}{option.id === selectedOption?.id ? "Selected" : "Choose"}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <footer className={styles.procurementDecisionFooter}>
                  <span><TriangleAlert size={14} /> Prices and delivery dates are modeled. No supplier has been contacted.</span>
                  <button type="button" disabled={!selectedOption} onClick={() => setPhase("handoff")}>Send to logistics <ArrowRight size={15} /></button>
                </footer>
              </>
            ) : (
              <section className={styles.procurementUnknownState}>
                <Globe2 size={24} />
                <h3>Request added, terms still unknown</h3>
                <p>The research run could not resolve a manufacturer or part number, so price, delivery, and quality remain unknown.</p>
                <button type="button" onClick={onBack}>Refine request</button>
              </section>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="handoff"
            className={styles.procurementHandoff}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            <PackageCheck size={28} />
            <small>Handoff prepared</small>
            <h3>{selectedOption?.name}</h3>
            <dl>
              <div><dt>Part</dt><dd>{item?.name ?? requestText}</dd></div>
              <div><dt>Quantity</dt><dd>{item ? Math.max(shortageQuantity(item), selectedOption?.minimumOrderQuantity ?? 0) : "Unknown"}</dd></div>
              <div><dt>Pickup</dt><dd>{selectedOption?.location ?? "Unknown"}</dd></div>
              <div><dt>Destination</dt><dd>Austin, TX</dd></div>
              <div><dt>Modeled delivery</dt><dd>{selectedOption?.deliveryDate ?? "Unknown"}</dd></div>
              <div><dt>Need by</dt><dd>{formatNeedBy(item)}</dd></div>
            </dl>
            <p><ShieldCheck size={15} /> Draft only. No purchase order, supplier contact, booking, or spend was created.</p>
            <button type="button" onClick={onBack}><ArrowLeft size={15} /> Back to sourcing</button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
