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
import type {
  PublicResearchResult,
  SavedProcurementCase,
  SavedSourcingResearchRun,
} from "./supply-os-sourcing-research-types";

type ProcurementPhase = "researching" | "compare" | "procure";
type SourceClass = "Official" | "Trusted" | "New";
type QualityState = "Strong" | "Conditional" | "Unverified";

type ProcurementOption = {
  id: string;
  name: string;
  location: string;
  coordinates: { longitude: number; latitude: number };
  role: string;
  leadTimeDays: number;
  minimumOrderQuantity: number;
  modeledUnitCostUsd: number;
  currency: string | null;
  fit: string;
  sourceClass: SourceClass;
  sourceLabel: string;
  quality: QualityState;
  qualityEvidence: string;
  deliveryDate: string;
  priceType: "Modeled" | "Sourced" | "Unknown";
  deliveryType: "Modeled" | "Sourced" | "Unknown";
  sourceUrl: string | null;
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

function formatCurrency(value: number, currency: string | null = "USD") {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return `${value.toLocaleString("en-US")} currency unknown`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMoney(value: string, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency)) return `${value} ${currency}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function deliveryDate(leadTimeDays: number) {
  const date = new Date("2026-08-09T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + leadTimeDays);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function researchDeliveryDate(leadTimeDays: number | null) {
  return leadTimeDays === null ? "Unknown" : deliveryDate(leadTimeDays);
}

function isSourcedEvidence(value: { state: string; sources: unknown[]; freshness: string }) {
  return value.state === "SUPPORTED" && value.sources.length > 0 && value.freshness === "FRESH";
}

function displayStoredDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00Z`));
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
    currency: "USD",
    priceType: "Modeled",
    deliveryType: "Modeled",
    sourceUrl: null,
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
    currency: "USD",
    priceType: "Modeled",
    deliveryType: "Modeled",
    sourceUrl: null,
  }];
}

function publicResearchOptions(result: PublicResearchResult | null): ProcurementOption[] {
  if (!result) return [];
  return result.candidates.map((candidate) => {
    const priceSourced = isSourcedEvidence(candidate.price) && isSourcedEvidence(candidate.currency);
    const deliverySourced = isSourcedEvidence(candidate.leadTimeDays);
    const moqSourced = isSourcedEvidence(candidate.minimumOrderQuantity);
    return ({
    id: `public:${candidate.id}`,
    name: candidate.companyName,
    location: candidate.facility.value ?? candidate.country.value ?? "Location unknown",
    coordinates: { longitude: 0, latitude: 0 },
    role: candidate.roles.map((role) => role.toLowerCase()).join(" / ") || "Supplier candidate",
    leadTimeDays: deliverySourced ? candidate.leadTimeDays.value ?? 0 : 0,
    minimumOrderQuantity: moqSourced ? candidate.minimumOrderQuantity.value ?? 0 : 0,
    modeledUnitCostUsd: priceSourced ? candidate.price.value ?? 0 : 0,
    currency: priceSourced ? candidate.currency.value?.toUpperCase().match(/^[A-Z]{3}$/)?.[0] ?? null : null,
    fit: candidate.productCapability.value ?? "Product capability requires review.",
    sourceClass: candidate.website ? "Official" : "New",
    sourceLabel: candidate.website ? "Official supplier page" : "Public web source",
    quality: candidate.status === "REVIEW_REQUIRED" ? "Conditional" : "Unverified",
    qualityEvidence: candidate.cautions[0] ?? `${candidate.productCapability.state.toLowerCase()} product-capability evidence`,
    deliveryDate: researchDeliveryDate(deliverySourced ? candidate.leadTimeDays.value : null),
    priceType: priceSourced ? "Sourced" : "Unknown",
    deliveryType: deliverySourced ? "Sourced" : "Unknown",
    sourceUrl: candidate.website ?? candidate.sourceUrls[0] ?? null,
    });
  });
}

export function AtlasProcurementWorkspace({
  item,
  requestText,
  initialRun,
  initialCase,
  canApproveProcurement,
  onResearchSaved,
  onProcurementCaseSaved,
  onBack,
}: {
  item: AtlasInventoryItem | null;
  requestText: string;
  initialRun?: SavedSourcingResearchRun | null;
  initialCase?: SavedProcurementCase | null;
  canApproveProcurement: boolean;
  onResearchSaved: (run: SavedSourcingResearchRun) => void;
  onProcurementCaseSaved: (procurementCase: SavedProcurementCase) => void;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [currentRun, setCurrentRun] = useState<SavedSourcingResearchRun | null>(initialRun ?? null);
  const [currentCase, setCurrentCase] = useState<SavedProcurementCase | null>(initialCase ?? null);
  const [caseSaveState, setCaseSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [gateActionState, setGateActionState] = useState<"idle" | "saving" | "error">("idle");
  const [gateActionError, setGateActionError] = useState("");
  const [sourceReviewNote, setSourceReviewNote] = useState("");
  const [commercialForm, setCommercialForm] = useState(() => ({
    price: String(initialCase?.result?.confirmedTerms?.price ?? initialCase?.result?.selectedOption.price ?? ""),
    currency: initialCase?.result?.confirmedTerms?.currency ?? initialCase?.result?.selectedOption.currency ?? "USD",
    minimumOrderQuantity: String(initialCase?.result?.confirmedTerms?.minimumOrderQuantity ?? initialCase?.result?.selectedOption.minimumOrderQuantity ?? ""),
    unitOfMeasure: initialCase?.result?.confirmedTerms?.unitOfMeasure ?? (item ? "EA" : ""),
    deliveryDate: initialCase?.result?.confirmedTerms?.deliveryDate ?? initialCase?.result?.selectedOption.deliveryDate ?? "",
    evidenceUrl: initialCase?.result?.confirmedTerms?.evidenceUrl ?? initialCase?.result?.selectedOption.sourceUrl ?? "",
    quoteReference: initialCase?.result?.confirmedTerms?.quoteReference ?? "",
    validUntil: initialCase?.result?.confirmedTerms?.validUntil ?? "",
  }));
  const [qualityForm, setQualityForm] = useState(() => ({
    method: initialCase?.result?.qualityPlan?.method ?? "SAMPLE",
    acceptanceCriteria: initialCase?.result?.qualityPlan?.acceptanceCriteria ?? "",
    owner: initialCase?.result?.qualityPlan?.owner ?? "",
    targetDate: initialCase?.result?.qualityPlan?.targetDate ?? "",
  }));
  const [purchaseForm, setPurchaseForm] = useState(() => ({
    quantity: initialCase?.purchaseDraft?.result?.order.quantity
      ?? String(item ? Math.max(shortageQuantity(item), initialCase?.result?.confirmedTerms?.minimumOrderQuantity ?? 0) : ""),
    needBy: initialCase?.purchaseDraft?.result?.order.needBy
      ?? (item ? ATLAS_SOURCING_NEED_BY[item.sku] ?? initialCase?.result?.confirmedTerms?.deliveryDate ?? "" : initialCase?.result?.confirmedTerms?.deliveryDate ?? ""),
    shipTo: initialCase?.purchaseDraft?.result?.order.shipTo ?? (item ? "Austin assembly plant" : ""),
    incoterm: initialCase?.purchaseDraft?.result?.order.incoterm ?? "DAP",
    paymentTerms: initialCase?.purchaseDraft?.result?.order.paymentTerms ?? "",
    buyerReference: initialCase?.purchaseDraft?.result?.order.buyerReference ?? "",
    notes: initialCase?.purchaseDraft?.result?.order.notes ?? "",
  }));
  const [approvalReason, setApprovalReason] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [publicResearch, setPublicResearch] = useState<PublicResearchResult | null>(initialRun?.output ?? null);
  const [researchState, setResearchState] = useState<"running" | "complete" | "degraded">(
    initialRun ? initialRun.output?.degraded ? "degraded" : "complete" : "running",
  );
  const options = useMemo(() => [...buildProcurementOptions(item), ...publicResearchOptions(publicResearch)], [item, publicResearch]);
  const recommended = options.find((option) => option.sourceClass === "Trusted") ?? options[0] ?? null;
  const [phase, setPhase] = useState<ProcurementPhase>(initialCase ? "procure" : initialRun ? "compare" : "researching");
  const [completedSources, setCompletedSources] = useState(initialRun ? RESEARCH_STEPS.length : 0);
  const [selectedOptionId, setSelectedOptionId] = useState(initialCase?.result?.selectedOption.id ?? recommended?.id ?? "");
  const comparisonOption = options.find((option) => option.id === selectedOptionId) ?? recommended;
  const savedSelection = currentCase?.result?.selectedOption;
  const selectedOption = savedSelection && comparisonOption?.id === savedSelection.id
    ? {
        ...comparisonOption,
        name: savedSelection.name,
        sourceClass: savedSelection.sourceClass,
        sourceUrl: savedSelection.sourceUrl,
        modeledUnitCostUsd: currentCase?.result?.confirmedTerms?.price ?? savedSelection.price ?? 0,
        currency: currentCase?.result?.confirmedTerms?.currency ?? savedSelection.currency,
        minimumOrderQuantity: currentCase?.result?.confirmedTerms?.minimumOrderQuantity ?? savedSelection.minimumOrderQuantity ?? 0,
        priceType: savedSelection.priceType,
        deliveryDate: displayStoredDate(currentCase?.result?.confirmedTerms?.deliveryDate ?? savedSelection.deliveryDate),
        deliveryType: savedSelection.deliveryType,
        quality: savedSelection.quality,
    }
    : comparisonOption;

  useEffect(() => {
    const result = currentCase?.result;
    if (!result) return;
    const terms = result.confirmedTerms;
    setSourceReviewNote("");
    setCommercialForm({
      price: String(terms?.price ?? result.selectedOption.price ?? ""),
      currency: terms?.currency ?? result.selectedOption.currency ?? "USD",
      minimumOrderQuantity: String(terms?.minimumOrderQuantity ?? result.selectedOption.minimumOrderQuantity ?? ""),
      unitOfMeasure: terms?.unitOfMeasure ?? (item ? "EA" : ""),
      deliveryDate: terms?.deliveryDate ?? result.selectedOption.deliveryDate ?? "",
      evidenceUrl: terms?.evidenceUrl ?? result.selectedOption.sourceUrl ?? "",
      quoteReference: terms?.quoteReference ?? "",
      validUntil: terms?.validUntil ?? "",
    });
    setQualityForm({
      method: result.qualityPlan?.method ?? "SAMPLE",
      acceptanceCriteria: result.qualityPlan?.acceptanceCriteria ?? "",
      owner: result.qualityPlan?.owner ?? "",
      targetDate: result.qualityPlan?.targetDate ?? "",
    });
    setApprovalReason("");
    setApprovalNote("");
    setGateActionError("");
    setGateActionState("idle");
  }, [currentCase?.result?.selectionHash]);

  useEffect(() => {
    const draft = currentCase?.purchaseDraft?.result;
    setPurchaseForm({
      quantity: draft?.order.quantity
        ?? String(item ? Math.max(shortageQuantity(item), currentCase?.result?.confirmedTerms?.minimumOrderQuantity ?? 0) : ""),
      needBy: draft?.order.needBy
        ?? (item ? ATLAS_SOURCING_NEED_BY[item.sku] ?? currentCase?.result?.confirmedTerms?.deliveryDate ?? "" : currentCase?.result?.confirmedTerms?.deliveryDate ?? ""),
      shipTo: draft?.order.shipTo ?? (item ? "Austin assembly plant" : ""),
      incoterm: draft?.order.incoterm ?? "DAP",
      paymentTerms: draft?.order.paymentTerms ?? "",
      buyerReference: draft?.order.buyerReference ?? "",
      notes: draft?.order.notes ?? "",
    });
  }, [currentCase?.purchaseDraft?.id, currentCase?.purchaseDraft?.result?.revision, currentCase?.result?.confirmedTerms?.deliveryDate, currentCase?.result?.confirmedTerms?.minimumOrderQuantity, item]);

  useEffect(() => {
    if (initialRun) return;
    const controller = new AbortController();
    setResearchState("running");
    setPublicResearch(null);
    void fetch("/api/supply-os/supplier-research", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        componentItemKey: item?.sku ?? `request:${requestText.slice(0, 120)}`,
        componentName: item?.name ?? requestText,
        specification: item?.specification ?? requestText,
        targetCountry: "United States",
        requestText,
      }),
    }).then(async (response) => {
      if (!response.ok) throw new Error("Supplier research did not finish.");
      const payload = await response.json() as { result?: PublicResearchResult; run?: SavedSourcingResearchRun };
      const result = payload.result ?? { candidates: [], degraded: true, warnings: ["Supplier research returned no result."] };
      setPublicResearch(result);
      setResearchState(result.degraded ? "degraded" : "complete");
      if (payload.run) {
        setCurrentRun(payload.run);
        onResearchSaved(payload.run);
      }
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setPublicResearch({ candidates: [], degraded: true, warnings: [error instanceof Error ? error.message : "Supplier research did not finish."] });
      setResearchState("degraded");
    });
    return () => controller.abort();
  }, [initialRun, item, onResearchSaved, requestText]);

  useEffect(() => {
    if (phase !== "researching") return;
    if (reduceMotion) {
      setCompletedSources(RESEARCH_STEPS.length);
      return;
    }
    const timers = RESEARCH_STEPS.map((_, index) => (
      window.setTimeout(() => setCompletedSources(index + 1), 520 + index * 480)
    ));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase, reduceMotion]);

  useEffect(() => {
    if (phase !== "researching" || completedSources < RESEARCH_STEPS.length || researchState === "running") return;
    const finish = window.setTimeout(() => setPhase("compare"), reduceMotion ? 120 : 240);
    return () => window.clearTimeout(finish);
  }, [completedSources, phase, reduceMotion, researchState]);

  async function continueProcurement() {
    if (!currentRun || !selectedOption || caseSaveState === "saving") return;
    setCaseSaveState("saving");
    try {
      const response = await fetch("/api/supply-os/procurement-cases", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          researchRunId: currentRun.id,
          selection: {
            id: selectedOption.id,
            name: selectedOption.name,
            sourceClass: selectedOption.sourceClass,
            sourceUrl: selectedOption.sourceUrl,
            price: selectedOption.priceType === "Unknown" ? null : selectedOption.modeledUnitCostUsd,
            currency: selectedOption.currency,
            minimumOrderQuantity: selectedOption.minimumOrderQuantity || null,
            priceType: selectedOption.priceType,
            deliveryDate: selectedOption.deliveryDate === "Unknown" ? null : selectedOption.deliveryDate,
            deliveryType: selectedOption.deliveryType,
            quality: selectedOption.quality,
          },
        }),
      });
      const payload = await response.json().catch(() => ({})) as { procurementCase?: SavedProcurementCase };
      if (!response.ok || !payload.procurementCase) throw new Error("Procurement case could not be saved.");
      setCurrentCase(payload.procurementCase);
      onProcurementCaseSaved(payload.procurementCase);
      setCaseSaveState("idle");
      setPhase("procure");
    } catch {
      setCaseSaveState("error");
    }
  }

  async function runCaseAction(path: string, body: Record<string, unknown>) {
    if (!currentCase?.result || gateActionState === "saving") return;
    setGateActionState("saving");
    setGateActionError("");
    try {
      const response = await fetch(path, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as { procurementCase?: SavedProcurementCase; error?: string };
      if (!response.ok || !payload.procurementCase) throw new Error(payload.error ?? "Procurement review could not be saved.");
      setCurrentCase(payload.procurementCase);
      onProcurementCaseSaved(payload.procurementCase);
      setGateActionState("idle");
    } catch (error) {
      setGateActionState("error");
      setGateActionError(error instanceof Error ? error.message : "Procurement review could not be saved.");
    }
  }

  function reviewSourceEvidence() {
    if (!currentCase?.result) return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/review`, {
      gate: "SOURCE_EVIDENCE",
      expectedSelectionHash: currentCase.result.selectionHash,
      note: sourceReviewNote,
    });
  }

  function confirmCommercialTerms() {
    if (!currentCase?.result) return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/review`, {
      gate: "COMMERCIAL_TERMS",
      expectedSelectionHash: currentCase.result.selectionHash,
      price: Number(commercialForm.price),
      currency: commercialForm.currency,
      minimumOrderQuantity: Number(commercialForm.minimumOrderQuantity),
      unitOfMeasure: commercialForm.unitOfMeasure,
      deliveryDate: commercialForm.deliveryDate,
      evidenceUrl: commercialForm.evidenceUrl,
      quoteReference: commercialForm.quoteReference,
      validUntil: commercialForm.validUntil || null,
    });
  }

  function saveQualityPlan() {
    if (!currentCase?.result) return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/review`, {
      gate: "QUALITY_PLAN",
      expectedSelectionHash: currentCase.result.selectionHash,
      ...qualityForm,
    });
  }

  function requestApproval() {
    if (!currentCase?.result) return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/approval`, {
      expectedSelectionHash: currentCase.result.selectionHash,
      reason: approvalReason,
    });
  }

  function decideApproval(decision: "APPROVE" | "REJECT") {
    const approvalId = currentCase?.result?.approval?.id;
    if (!approvalId) return;
    void runCaseAction(`/api/supply-os/procurement-approvals/${approvalId}/decision`, {
      decision,
      note: approvalNote || null,
    });
  }

  function savePurchaseDraft() {
    const approval = currentCase?.result?.approval;
    if (!currentCase?.result || !approval || approval.status !== "APPROVED") return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/purchase-draft`, {
      expectedApprovalId: approval.id,
      expectedApprovalScopeHash: approval.scopeHash,
      expectedRevision: currentCase.purchaseDraft?.result?.revision ?? 0,
      quantity: Number(purchaseForm.quantity),
      needBy: purchaseForm.needBy,
      shipTo: purchaseForm.shipTo,
      incoterm: purchaseForm.incoterm,
      paymentTerms: purchaseForm.paymentTerms,
      buyerReference: purchaseForm.buyerReference || null,
      notes: purchaseForm.notes || null,
    });
  }

  const purchaseFormComplete = Number(purchaseForm.quantity) > 0
    && Boolean(purchaseForm.needBy)
    && Boolean(purchaseForm.shipTo.trim())
    && Boolean(purchaseForm.paymentTerms.trim());

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
        <i>{initialRun ? "Saved research" : "Public research"}</i>
      </header>

      <nav className={styles.procurementProgress} aria-label="Procurement progress">
        <span data-active={phase === "researching"} data-complete={phase !== "researching"}><b>01</b> Research</span>
        <span data-active={phase === "compare"} data-complete={phase === "procure"}><b>02</b> Compare</span>
        <span data-active={phase === "procure"}><b>03</b> Procure</span>
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
                const waitingForWeb = index === RESEARCH_STEPS.length - 1
                  && completedSources >= RESEARCH_STEPS.length
                  && researchState === "running";
                const complete = completedSources > index && !waitingForWeb;
                const active = completedSources === index || waitingForWeb;
                return (
                  <li key={step.label} data-complete={complete} data-active={active}>
                    <span>{complete ? <Check size={15} /> : active ? <LoaderCircle size={15} /> : <Search size={15} />}</span>
                    <p><strong>{step.label}</strong><small>{step.detail}</small></p>
                    <i>{step.sourceClass}</i>
                  </li>
                );
              })}
            </ol>
            <footer><TriangleAlert size={14} /> {researchState === "running" ? "Live public web research is running. No supplier system is connected." : researchState === "complete" ? "Public results are attributable and unqualified. No supplier was contacted." : publicResearch?.warnings[0] ?? "Public research is unavailable; modeled demo options remain."}</footer>
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
                  <strong>{formatCurrency(recommended.modeledUnitCostUsd, recommended.currency)} / unit</strong>
                </section>
                <div className={styles.procurementOptionTableRegion}>
                  <table className={styles.procurementOptionTable}>
                    <thead><tr><th>Supplier</th><th>Source</th><th>Price</th><th>Delivery</th><th>Quality</th><th /></tr></thead>
                    <tbody>
                      {options.map((option) => (
                        <tr key={option.id} data-selected={option.id === selectedOption?.id} data-recommended={option.id === recommended.id}>
                          <td><strong>{option.name}</strong><small>{option.role} · {option.location}</small>{option.id === recommended.id ? <i>Suggested</i> : null}</td>
                          <td><strong>{option.sourceClass}</strong><small>{option.sourceLabel}</small>{option.sourceUrl ? <a href={option.sourceUrl} target="_blank" rel="noreferrer">View source</a> : null}</td>
                          <td><strong>{option.priceType === "Unknown" ? "Unknown" : formatCurrency(option.modeledUnitCostUsd, option.currency)}</strong><small>{option.priceType} · MOQ {option.minimumOrderQuantity || "unknown"}</small></td>
                          <td><strong>{option.deliveryDate}</strong><small>{option.leadTimeDays ? `${option.leadTimeDays} days ${option.deliveryType.toLowerCase()}` : "Lead time unknown"}</small></td>
                          <td><strong>{option.quality}</strong><small>{option.qualityEvidence}</small></td>
                          <td><button type="button" onClick={() => setSelectedOptionId(option.id)}>{option.id === selectedOption?.id ? <Check size={14} /> : null}{option.id === selectedOption?.id ? "Selected" : "Choose"}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <footer className={styles.procurementDecisionFooter}>
                  <span role={caseSaveState === "error" ? "alert" : undefined}><TriangleAlert size={14} /> {caseSaveState === "error" ? "Procurement progress could not be saved. Try again." : "Terms state whether evidence is modeled, sourced, or unknown. No supplier has been contacted."}</span>
                  <button type="button" disabled={!selectedOption || !currentRun || caseSaveState === "saving"} onClick={() => void continueProcurement()}>{caseSaveState === "saving" ? "Saving" : currentCase ? "Update procurement" : "Continue procurement"} <ArrowRight size={15} /></button>
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
            key="procure"
            className={styles.procurementHandoff}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            <PackageCheck size={28} />
            <small>Procurement brief</small>
            <h3>{selectedOption?.name}</h3>
            <dl>
              <div><dt>Part</dt><dd>{item?.name ?? requestText}</dd></div>
              <div><dt>Quantity</dt><dd>{item ? Math.max(shortageQuantity(item), selectedOption?.minimumOrderQuantity ?? 0) : "Unknown"}</dd></div>
              <div><dt>Source location</dt><dd>{selectedOption?.location ?? "Unknown"}</dd></div>
              <div><dt>Destination</dt><dd>Austin, TX</dd></div>
              <div><dt>Modeled delivery</dt><dd>{selectedOption?.deliveryDate ?? "Unknown"}</dd></div>
              <div><dt>Need by</dt><dd>{formatNeedBy(item)}</dd></div>
            </dl>
            {currentCase?.result ? (
              <section className={styles.procurementGateGrid} aria-label="Procurement readiness">
                <div><span data-status={currentCase.result.gates.sourceEvidence} /><p><strong>Supplier evidence</strong><small>{currentCase.result.gates.sourceEvidence === "EVIDENCE_COMPLETE" ? "Supplier source reviewed" : currentCase.result.gates.sourceEvidence === "BLOCKED" ? "Attributable source required" : "Human qualification required"}</small></p></div>
                <div><span data-status={currentCase.result.gates.commercialTerms} /><p><strong>Commercial terms</strong><small>{currentCase.result.gates.commercialTerms === "EVIDENCE_COMPLETE" ? "Quote terms confirmed" : "Confirm price, currency, MOQ, and delivery"}</small></p></div>
                <div><span data-status={currentCase.result.gates.qualityPlan} /><p><strong>Quality plan</strong><small>{currentCase.result.gates.qualityPlan === "EVIDENCE_COMPLETE" ? "Acceptance plan recorded" : "Sample or inspection plan required"}</small></p></div>
                <div><span data-status={currentCase.result.gates.purchaseApproval} /><p><strong>Purchase approval</strong><small>{currentCase.result.gates.purchaseApproval === "APPROVED" ? "Approved for purchase preparation" : currentCase.result.gates.purchaseApproval === "PENDING" ? "Manager decision pending" : currentCase.result.gates.purchaseApproval === "REJECTED" ? "Revision required" : "Blocked until review gates are complete"}</small></p></div>
              </section>
            ) : null}
            {currentCase?.result ? (
              <section className={styles.procurementGateAction} aria-live="polite">
                {currentCase.result.stage === "SOURCE_EVIDENCE" ? (
                  <>
                    <header><small>Gate 1 of 4</small><h4>Qualify the supplier source</h4><p>Open the attributed source, verify that the company and component match, then record what you checked.</p></header>
                    {currentCase.result.selectedOption.sourceUrl ? <a href={currentCase.result.selectedOption.sourceUrl} target="_blank" rel="noreferrer">Open attributed supplier source <ArrowRight size={14} /></a> : null}
                    <label>Review note<textarea value={sourceReviewNote} onChange={(event) => setSourceReviewNote(event.target.value)} placeholder="Verified company identity, product match, and source ownership." /></label>
                    <button type="button" disabled={gateActionState === "saving" || !currentCase.result.selectedOption.sourceUrl} onClick={reviewSourceEvidence}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <Check size={14} />} Confirm supplier evidence</button>
                  </>
                ) : currentCase.result.stage === "COMMERCIAL_CONFIRMATION" ? (
                  <>
                    <header><small>Gate 2 of 4</small><h4>Confirm quote and delivery terms</h4><p>Web research is a lead, not a quote. Record the commercial source that a buyer can defend.</p></header>
                    <div className={styles.procurementFormGrid}>
                      <label>Unit price<input type="number" min="0.01" step="0.01" value={commercialForm.price} onChange={(event) => setCommercialForm((current) => ({ ...current, price: event.target.value }))} /></label>
                      <label>Currency<input maxLength={3} value={commercialForm.currency} onChange={(event) => setCommercialForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></label>
                      <label>MOQ<input type="number" min="0.01" step="0.01" value={commercialForm.minimumOrderQuantity} onChange={(event) => setCommercialForm((current) => ({ ...current, minimumOrderQuantity: event.target.value }))} /></label>
                      <label>Unit<input maxLength={20} value={commercialForm.unitOfMeasure} onChange={(event) => setCommercialForm((current) => ({ ...current, unitOfMeasure: event.target.value.toUpperCase() }))} placeholder="EA" /></label>
                      <label>Delivery date<input type="date" value={commercialForm.deliveryDate} onChange={(event) => setCommercialForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
                      <label>Quote reference<input value={commercialForm.quoteReference} onChange={(event) => setCommercialForm((current) => ({ ...current, quoteReference: event.target.value }))} placeholder="Quote number or dated offer" /></label>
                      <label>Valid until<input type="date" value={commercialForm.validUntil} onChange={(event) => setCommercialForm((current) => ({ ...current, validUntil: event.target.value }))} /></label>
                      <label className={styles.procurementWideField}>Evidence URL<input type="url" value={commercialForm.evidenceUrl} onChange={(event) => setCommercialForm((current) => ({ ...current, evidenceUrl: event.target.value }))} placeholder="https://..." /></label>
                    </div>
                    <button type="button" disabled={gateActionState === "saving"} onClick={confirmCommercialTerms}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <Check size={14} />} Confirm commercial terms</button>
                  </>
                ) : currentCase.result.stage === "QUALITY_REVIEW" ? (
                  <>
                    <header><small>Gate 3 of 4</small><h4>Define acceptance before buying</h4><p>A vague quality promise is useless. Choose the verification method and write the pass criteria.</p></header>
                    <div className={styles.procurementFormGrid}>
                      <label>Verification method<select value={qualityForm.method} onChange={(event) => setQualityForm((current) => ({ ...current, method: event.target.value as typeof current.method }))}><option value="SAMPLE">Sample approval</option><option value="PRE_SHIPMENT_INSPECTION">Pre-shipment inspection</option><option value="DOCUMENT_REVIEW">Document review</option></select></label>
                      <label>Owner<input value={qualityForm.owner} onChange={(event) => setQualityForm((current) => ({ ...current, owner: event.target.value }))} placeholder="Operations or engineering owner" /></label>
                      <label>Target date<input type="date" value={qualityForm.targetDate} onChange={(event) => setQualityForm((current) => ({ ...current, targetDate: event.target.value }))} /></label>
                      <label className={styles.procurementWideField}>Acceptance criteria<textarea value={qualityForm.acceptanceCriteria} onChange={(event) => setQualityForm((current) => ({ ...current, acceptanceCriteria: event.target.value }))} placeholder="Specify measurable checks, documents, tolerances, or sample result." /></label>
                    </div>
                    <button type="button" disabled={gateActionState === "saving"} onClick={saveQualityPlan}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <Check size={14} />} Save quality plan</button>
                  </>
                ) : currentCase.result.stage === "APPROVAL" ? (
                  <>
                    <header><small>Gate 4 of 4</small><h4>Request approval of this exact scope</h4><p>The selected supplier, confirmed quote terms, evidence review, and quality plan are sealed into one immutable approval object.</p></header>
                    <label>Approval reason<textarea value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} placeholder="Explain why this option should move to purchase preparation." /></label>
                    <button type="button" disabled={gateActionState === "saving"} onClick={requestApproval}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <ShieldCheck size={14} />} Request manager approval</button>
                  </>
                ) : currentCase.result.stage === "APPROVAL_PENDING" ? (
                  <>
                    <header><small>Approval pending</small><h4>Exact supplier and terms are locked</h4><p>A manager or admin must decide this scope. Editing the supplier or any gate cancels the pending approval.</p></header>
                    {canApproveProcurement ? <><label>Decision note<textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="Record the decision rationale." /></label><div className={styles.procurementDecisionActions}><button type="button" disabled={gateActionState === "saving"} onClick={() => decideApproval("APPROVE")}><Check size={14} /> Approve scope</button><button type="button" disabled={gateActionState === "saving"} onClick={() => decideApproval("REJECT")}><TriangleAlert size={14} /> Reject</button></div></> : <p className={styles.procurementPermissionNote}>Your role can view this request but cannot decide it.</p>}
                  </>
                ) : (
                  <>
                    <header><small>Purchase preparation</small><h4>{currentCase.purchaseDraft?.result ? "Order draft" : "Prepare the order"}</h4><p>Supplier and quote evidence come from the approved scope. Add the order fields that were not part of sourcing approval.</p></header>
                    {currentCase.purchaseDraft?.result ? (
                      <dl className={styles.purchaseDraftSummary}>
                        <div><dt>Supplier</dt><dd>{currentCase.purchaseDraft.result.supplier.name}</dd></div>
                        <div><dt>Material subtotal</dt><dd>{formatMoney(currentCase.purchaseDraft.result.totals.materialSubtotal, currentCase.purchaseDraft.result.totals.currency)}</dd></div>
                        <div><dt>Quote</dt><dd>{currentCase.purchaseDraft.result.commercial.quoteReference}</dd></div>
                        <div><dt>Draft revision</dt><dd>{currentCase.purchaseDraft.result.revision}</dd></div>
                      </dl>
                    ) : null}
                    <div className={styles.procurementFormGrid}>
                      <label>Quantity<input type="number" min="0.01" step="0.01" value={purchaseForm.quantity} onChange={(event) => setPurchaseForm((current) => ({ ...current, quantity: event.target.value }))} /></label>
                      <label>Approved unit<input readOnly value={currentCase.purchaseDraft?.result?.order.unitOfMeasure ?? currentCase.result.confirmedTerms?.unitOfMeasure ?? "Unknown"} /></label>
                      <label>Need by<input type="date" value={purchaseForm.needBy} onChange={(event) => setPurchaseForm((current) => ({ ...current, needBy: event.target.value }))} /></label>
                      <label>Incoterm<select value={purchaseForm.incoterm} onChange={(event) => setPurchaseForm((current) => ({ ...current, incoterm: event.target.value as typeof current.incoterm }))}><option value="EXW">EXW</option><option value="FCA">FCA</option><option value="FOB">FOB</option><option value="CPT">CPT</option><option value="CIP">CIP</option><option value="DAP">DAP</option><option value="DDP">DDP</option></select></label>
                      <label className={styles.procurementWideField}>Ship to<input value={purchaseForm.shipTo} onChange={(event) => setPurchaseForm((current) => ({ ...current, shipTo: event.target.value }))} placeholder="Facility and receiving location" /></label>
                      <label>Payment terms<input value={purchaseForm.paymentTerms} onChange={(event) => setPurchaseForm((current) => ({ ...current, paymentTerms: event.target.value }))} placeholder="For example, Net 30" /></label>
                      <label>Buyer reference<input value={purchaseForm.buyerReference} onChange={(event) => setPurchaseForm((current) => ({ ...current, buyerReference: event.target.value }))} placeholder="Optional internal reference" /></label>
                      <label className={styles.procurementWideField}>Buyer notes<textarea value={purchaseForm.notes} onChange={(event) => setPurchaseForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional receiving or packaging instructions" /></label>
                    </div>
                    <button type="button" disabled={gateActionState === "saving" || !purchaseFormComplete} onClick={savePurchaseDraft}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <PackageCheck size={14} />} {currentCase.purchaseDraft?.result ? "Update order draft" : "Save order draft"}</button>
                    <p className={styles.procurementPermissionNote}>This is internal preparation only. No PO number, supplier contact, payment, booking, or spend is created.</p>
                  </>
                )}
                {gateActionState === "error" ? <p className={styles.procurementActionError}><TriangleAlert size={14} /> {gateActionError}</p> : null}
              </section>
            ) : null}
            <p><ShieldCheck size={15} /> {currentCase?.result?.stage === "PURCHASE_READY" ? "This scope is approved for purchase preparation. No purchase order, supplier contact, booking, or spend was created." : "Qualification, commercial terms, quality plan, and approval remain required. No purchase order, supplier contact, booking, or spend was created."}</p>
            <div className={styles.procurementCaseActions}>
              <button type="button" onClick={() => setPhase("compare")}><ArrowLeft size={15} /> Review alternatives</button>
              <button type="button" onClick={onBack}>Back to sourcing</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
