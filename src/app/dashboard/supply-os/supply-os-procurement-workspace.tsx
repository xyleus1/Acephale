"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Globe2,
  LoaderCircle,
  Mail,
  PackageCheck,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ATLAS_SOURCING_NEED_BY,
  shortageQuantity,
  type AtlasInventoryItem,
  type AtlasSourcingCandidate,
} from "@/lib/supply-os/atlas-robotics-inventory";
import { displayedSupplierQuote, supplierQuoteSignals } from "@/lib/supply-os/quote-comparison";
import type {
  SourcingConversationMessage,
  SourcingIntakeResult,
  SourcingRequestDraft,
  SourcingRequiredField,
} from "@/lib/supply-os/sourcing-request-contract";
import {
  hasDirtyWorkstream,
  markWorkstreamDraft,
  resolveWorkstreamDraft,
  type WorkstreamDraftState,
} from "@/lib/supply-os/workstream-drafts";
import styles from "./supply-os-logistics.module.css";
import type {
  PublicResearchResult,
  ConnectedSupplierReply,
  SavedProcurementCase,
  SavedSourcingResearchRun,
  SupplierSenderAccount,
} from "./supply-os-sourcing-research-types";

type ProcurementPhase = "request" | "researching" | "compare" | "procure";
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
  { label: "Producer and manufacturer sources", detail: "Official product and technical documentation", sourceClass: "Official" },
  { label: "Distributor and trader sources", detail: "Public price, lead time, MOQ, and availability evidence", sourceClass: "Trusted" },
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

function evidenceHref(evidenceId: string | undefined, sourceUrl: string) {
  return evidenceId ? `/api/supply-os/evidence/${encodeURIComponent(evidenceId)}` : sourceUrl;
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

function qualificationValidUntilDefault() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString().slice(0, 10);
}

function supplierQualificationForm(procurementCase: SavedProcurementCase | null | undefined) {
  const review = procurementCase?.result?.reviews?.sourceEvidence;
  const sourceUrl = procurementCase?.result?.selectedOption.sourceUrl ?? "";
  return {
    relationship: review?.relationship ?? "MANUFACTURER" as "MANUFACTURER" | "AUTHORIZED_DISTRIBUTOR" | "INDEPENDENT_DISTRIBUTOR",
    identityEvidenceUrl: review?.identityEvidenceUrl ?? sourceUrl,
    capabilityEvidenceUrl: review?.capabilityEvidenceUrl ?? sourceUrl,
    authorizationEvidenceUrl: review?.authorizationEvidenceUrl ?? "",
    validUntil: review?.validUntil ?? qualificationValidUntilDefault(),
    rejectionReason: review?.rejectionReason ?? "SOURCE_UNVERIFIABLE" as "IDENTITY_UNRESOLVED" | "CAPABILITY_UNRESOLVED" | "AUTHORIZATION_UNRESOLVED" | "SOURCE_UNVERIFIABLE" | "OTHER",
    note: review?.note ?? "",
  };
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

function selectionPayload(option: ProcurementOption) {
  return {
    id: option.id,
    name: option.name,
    sourceClass: option.sourceClass,
    sourceUrl: option.sourceUrl,
    price: option.priceType === "Unknown" ? null : option.modeledUnitCostUsd,
    currency: option.currency,
    minimumOrderQuantity: option.minimumOrderQuantity || null,
    priceType: option.priceType,
    deliveryDate: option.deliveryDate === "Unknown" ? null : option.deliveryDate,
    deliveryType: option.deliveryType,
    quality: option.quality,
  };
}

function workstreamState(procurementCase: SavedProcurementCase) {
  const purchaseRelease = procurementCase.result?.purchaseRelease;
  const acknowledgmentOverdue = purchaseRelease
    && purchaseRelease.release
    && purchaseRelease.state !== "ACKNOWLEDGED"
    && purchaseRelease.release.acknowledgmentDueOn < new Date().toISOString().slice(0, 10);
  if (procurementCase.result?.purchaseRelease?.state === "ACKNOWLEDGED") return "Supplier acknowledged";
  if (acknowledgmentOverdue) return "Supplier response overdue";
  if (procurementCase.result?.purchaseRelease?.state === "PARTIALLY_ACKNOWLEDGED") return "Partially acknowledged";
  if (procurementCase.result?.purchaseRelease?.state === "RELEASED") return "Order released";
  if (["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"].includes(procurementCase.purchaseOrderEmailAction?.result?.state ?? "")) return "Order delivery unresolved";
  if (procurementCase.purchaseOrderEmailAction?.approval?.status === "PENDING") return "Order email approval pending";
  if (procurementCase.purchaseOrderEmailAction?.approval?.status === "APPROVED") return "Order email approved";
  if (procurementCase.purchaseOrderEmailDraft) return "Order email draft";
  if (procurementCase.purchaseAction?.result?.state === "AUTHORIZED" || procurementCase.purchaseAction?.approval?.status === "APPROVED") return "Purchase authorized";
  if (procurementCase.purchaseAction?.approval?.status === "PENDING") return "Purchase approval pending";
  if (procurementCase.purchaseDraft) return "Order draft ready";
  const cycle = procurementCase.quoteCycle?.result;
  if (cycle?.state === "RESPONSES_RECEIVED") return `${cycle.responses.length} quote ${cycle.responses.length === 1 ? "response" : "responses"}`;
  if (cycle?.state === "AWAITING_RESPONSE") return "Awaiting quote";
  if (cycle?.state === "DRAFT") return "RFQ draft";
  if (procurementCase.result?.stage === "SOURCE_EVIDENCE") return "Qualify supplier";
  if (procurementCase.result?.stage === "SUPPLIER_REJECTED") return "Supplier rejected";
  if (procurementCase.result?.stage === "COMMERCIAL_CONFIRMATION") return "Prepare RFQ";
  if (procurementCase.result?.stage === "QUALITY_REVIEW") return "Quality review";
  if (procurementCase.result?.stage === "APPROVAL_PENDING") return "Approval pending";
  if (procurementCase.result?.stage === "PURCHASE_READY") return "Purchase ready";
  return "In review";
}

export function AtlasProcurementWorkspace({
  item,
  requestText,
  initialDraft,
  initialMissingFields,
  initialQuestion,
  initialRun,
  initialCase,
  initialCases,
  canApproveProcurement,
  canAuthorizePurchase,
  senderAccounts,
  onResearchSaved,
  onProcurementCaseSaved,
  onRequestUpdate,
  onBack,
}: {
  item: AtlasInventoryItem | null;
  requestText: string;
  initialDraft: SourcingRequestDraft | null;
  initialMissingFields: SourcingRequiredField[];
  initialQuestion: string | null;
  initialRun?: SavedSourcingResearchRun | null;
  initialCase?: SavedProcurementCase | null;
  initialCases?: SavedProcurementCase[];
  canApproveProcurement: boolean;
  canAuthorizePurchase: boolean;
  senderAccounts: SupplierSenderAccount[];
  onResearchSaved: (run: SavedSourcingResearchRun) => void;
  onProcurementCaseSaved: (procurementCase: SavedProcurementCase) => void;
  onRequestUpdate?: (update: {
    title: string;
    draft: SourcingRequestDraft;
    missingFields: SourcingRequiredField[];
    lastQuestion: string | null;
    status: "Clarification needed" | "Researching" | "Research unavailable";
  }) => void;
  onBack: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const savedRunDraft = initialRun && !item ? {
    productName: initialRun.input.componentName,
    quantity: initialRun.input.requestedQuantity ?? null,
    unit: initialRun.input.requestedUnit ?? null,
    manufacturer: initialRun.input.manufacturer,
    partNumber: initialRun.input.mpn,
    specification: initialRun.input.specification,
    sourceRegion: initialRun.input.sourceRegion ?? null,
    deliveryLocation: initialRun.input.deliveryLocation ?? initialRun.input.targetCountry,
    needByDate: initialRun.input.needByDate ?? null,
  } satisfies SourcingRequestDraft : null;
  const startingDraft = initialDraft ?? savedRunDraft;
  const [currentRun, setCurrentRun] = useState<SavedSourcingResearchRun | null>(initialRun ?? null);
  const [requestDraft, setRequestDraft] = useState<SourcingRequestDraft | null>(startingDraft);
  const [missingFields, setMissingFields] = useState<SourcingRequiredField[]>(initialMissingFields);
  const [messages, setMessages] = useState<SourcingConversationMessage[]>(() => item ? [] : [
    { role: "operator", body: requestText },
    ...(initialQuestion ? [{ role: "derya", body: initialQuestion } as const] : []),
  ]);
  const [answer, setAnswer] = useState("");
  const [intakeState, setIntakeState] = useState<"idle" | "running" | "error">("idle");
  const [intakeError, setIntakeError] = useState("");
  const intakeControllerRef = useRef<AbortController | null>(null);
  const initialIntakeStartedRef = useRef(false);
  const onRequestUpdateRef = useRef(onRequestUpdate);
  const [currentCase, setCurrentCase] = useState<SavedProcurementCase | null>(initialCase ?? null);
  const [workstreamCases, setWorkstreamCases] = useState<SavedProcurementCase[]>(
    initialCases?.length ? initialCases : initialCase ? [initialCase] : [],
  );
  const [dirtyDrafts, setDirtyDrafts] = useState<WorkstreamDraftState>(null);
  const [workstreamSwitchError, setWorkstreamSwitchError] = useState("");
  const [caseSaveState, setCaseSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [gateActionState, setGateActionState] = useState<"idle" | "saving" | "error">("idle");
  const [gateActionError, setGateActionError] = useState("");
  const [qualificationForm, setQualificationForm] = useState(() => supplierQualificationForm(initialCase));
  const [commercialForm, setCommercialForm] = useState(() => ({
    receivedOn: "",
    price: "",
    currency: "",
    minimumOrderQuantity: "",
    unitOfMeasure: initialCase?.quoteCycle?.result?.request.unitOfMeasure ?? (item ? "EA" : ""),
    deliveryDate: "",
    evidenceUrl: "",
    quoteReference: "",
    validUntil: "",
    note: "",
  }));
  const [quoteRequestForm, setQuoteRequestForm] = useState(() => ({
    quantity: initialCase?.quoteCycle?.result?.request.quantity
      ?? String(item ? Math.max(shortageQuantity(item), initialCase?.result?.selectedOption.minimumOrderQuantity ?? 0) : ""),
    unitOfMeasure: initialCase?.quoteCycle?.result?.request.unitOfMeasure ?? (item ? "EA" : ""),
    needBy: initialCase?.quoteCycle?.result?.request.needBy ?? (item ? ATLAS_SOURCING_NEED_BY[item.sku] ?? "" : ""),
    shipTo: initialCase?.quoteCycle?.result?.request.shipTo ?? (item ? "Austin assembly plant" : ""),
    responseDue: initialCase?.quoteCycle?.result?.request.responseDue ?? "",
    requirements: initialCase?.quoteCycle?.result?.request.requirements ?? item?.specification ?? requestText,
    note: initialCase?.quoteCycle?.result?.request.note ?? "",
  }));
  const [quoteReleaseForm, setQuoteReleaseForm] = useState(() => ({
    channel: initialCase?.quoteCycle?.result?.release?.channel ?? "EMAIL" as "EMAIL" | "SUPPLIER_PORTAL" | "EDI" | "PHONE_CONFIRMED" | "OTHER",
    releasedOn: initialCase?.quoteCycle?.result?.release?.releasedOn ?? "",
    evidenceUrl: initialCase?.quoteCycle?.result?.release?.evidenceUrl ?? "",
    note: initialCase?.quoteCycle?.result?.release?.note ?? "",
  }));
  const [supplierEmailForm, setSupplierEmailForm] = useState(() => ({
    senderAccountId: initialCase?.supplierEmailDraft?.result?.message.senderAccountId ?? senderAccounts[0]?.id ?? "",
    recipient: initialCase?.supplierEmailDraft?.result?.message.recipient ?? "",
    subject: initialCase?.supplierEmailDraft?.result?.message.subject ?? `Quote request: ${item?.name ?? requestText}`,
    body: initialCase?.supplierEmailDraft?.result?.message.body ?? "",
  }));
  const [supplierEmailApprovalReason, setSupplierEmailApprovalReason] = useState("Supplier quote request is ready for review and release.");
  const [supplierEmailDecisionNote, setSupplierEmailDecisionNote] = useState("");
  const [supplierEmailRecoveryNote, setSupplierEmailRecoveryNote] = useState("");
  const [selectedReplyEvidenceId, setSelectedReplyEvidenceId] = useState<string | null>(null);
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
  const [purchaseApprovalReason, setPurchaseApprovalReason] = useState("");
  const [purchaseDecisionNote, setPurchaseDecisionNote] = useState("");
  const [purchaseOrderEmailForm, setPurchaseOrderEmailForm] = useState(() => ({
    senderAccountId: initialCase?.purchaseOrderEmailDraft?.result?.message.senderAccountId ?? senderAccounts[0]?.id ?? "",
    recipient: initialCase?.purchaseOrderEmailDraft?.result?.message.recipient ?? "",
    subject: initialCase?.purchaseOrderEmailDraft?.result?.message.subject ?? `Purchase order: ${initialCase?.purchaseDraft?.result?.order.buyerReference || item?.name || requestText}`,
    body: initialCase?.purchaseOrderEmailDraft?.result?.message.body ?? "",
    purchaseOrderReference: initialCase?.purchaseOrderEmailDraft?.result?.issuance.purchaseOrderReference ?? initialCase?.purchaseDraft?.result?.order.buyerReference ?? "",
    acknowledgmentDueOn: initialCase?.purchaseOrderEmailDraft?.result?.issuance.acknowledgmentDueOn ?? "",
    note: initialCase?.purchaseOrderEmailDraft?.result?.issuance.note ?? "",
  }));
  const [purchaseOrderEmailApprovalReason, setPurchaseOrderEmailApprovalReason] = useState("The exact authorized purchase order and supplier message are ready for release review.");
  const [purchaseOrderEmailDecisionNote, setPurchaseOrderEmailDecisionNote] = useState("");
  const [purchaseOrderEmailRecoveryNote, setPurchaseOrderEmailRecoveryNote] = useState("");
  const [purchaseReleaseForm, setPurchaseReleaseForm] = useState(() => ({
    channel: "EMAIL" as "EMAIL" | "SUPPLIER_PORTAL" | "EDI" | "PHONE_CONFIRMED" | "OTHER",
    releasedOn: "",
    acknowledgmentDueOn: "",
    purchaseOrderReference: initialCase?.purchaseDraft?.result?.order.buyerReference ?? "",
    evidenceUrl: "",
    note: "",
  }));
  const [acknowledgmentForm, setAcknowledgmentForm] = useState(() => ({
    acknowledgedOn: "",
    supplierOrderReference: "",
    acceptedQuantity: initialCase?.result?.purchaseRelease?.remainingQuantity
      ?? initialCase?.purchaseDraft?.result?.order.quantity
      ?? "",
    confirmedDeliveryDate: initialCase?.purchaseDraft?.result?.commercial.deliveryDate ?? "",
    evidenceUrl: "",
    note: "",
  }));
  const [publicResearch, setPublicResearch] = useState<PublicResearchResult | null>(initialRun?.output ?? null);
  const [researchState, setResearchState] = useState<"idle" | "running" | "complete" | "degraded">(
    initialRun ? initialRun.output?.degraded ? "degraded" : "complete" : item ? "running" : "idle",
  );
  const options = useMemo(() => [...buildProcurementOptions(item), ...publicResearchOptions(publicResearch)], [item, publicResearch]);
  const recommended = options.find((option) => option.sourceClass === "Trusted") ?? options[0] ?? null;
  const [phase, setPhase] = useState<ProcurementPhase>(() => {
    if (initialCase) return "procure";
    if (initialRun) return "compare";
    if (item) return "researching";
    return startingDraft && initialMissingFields.length === 0 && !initialQuestion ? "researching" : "request";
  });
  const [completedSources, setCompletedSources] = useState(initialRun ? RESEARCH_STEPS.length : 0);
  const [selectedOptionId, setSelectedOptionId] = useState(initialCase?.result?.selectedOption.id ?? recommended?.id ?? "");
  const [shortlistedOptionIds, setShortlistedOptionIds] = useState<string[]>(() => {
    const savedIds = (initialCases?.length ? initialCases : initialCase ? [initialCase] : [])
      .map((candidate) => candidate.result?.selectedOption.id)
      .filter((candidate): candidate is string => Boolean(candidate));
    return savedIds.length ? savedIds : recommended ? [recommended.id] : [];
  });
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

  const quoteComparisons = useMemo(() => workstreamCases.map((procurementCase) => {
    const selected = procurementCase.result?.selectedOption;
    const cycle = procurementCase.quoteCycle?.result;
    const response = cycle ? displayedSupplierQuote(cycle.responses, cycle.selectedResponseHash) : null;
    return {
      procurementCase,
      supplier: selected?.name ?? "Unknown supplier",
      response,
      requestHash: cycle?.requestHash ?? null,
      state: workstreamState(procurementCase),
    };
  }), [workstreamCases]);
  const quoteSignals = useMemo(() => supplierQuoteSignals(quoteComparisons.map((candidate) => ({
    id: candidate.procurementCase.id,
    requestHash: candidate.requestHash,
    response: candidate.response,
  }))), [quoteComparisons]);

  useEffect(() => {
    onRequestUpdateRef.current = onRequestUpdate;
  }, [onRequestUpdate]);

  useEffect(() => () => intakeControllerRef.current?.abort(), []);

  async function submitIntake(message: string, initial = false) {
    const normalized = message.trim();
    if (!normalized || intakeState === "running") return;
    intakeControllerRef.current?.abort();
    const controller = new AbortController();
    intakeControllerRef.current = controller;
    const nextMessages: SourcingConversationMessage[] = initial
      ? [{ role: "operator", body: normalized }]
      : [...messages, { role: "operator", body: normalized }];
    setMessages(nextMessages);
    setAnswer("");
    setIntakeError("");
    setIntakeState("running");
    try {
      const response = await fetch("/api/supply-os/sourcing-request", {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: normalized,
          currentDraft: requestDraft,
          messages: nextMessages.slice(0, -1),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { result?: SourcingIntakeResult; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error ?? "The request could not be analyzed.");
      const result = payload.result;
      setRequestDraft(result.draft);
      setMissingFields(result.missingFields);
      setMessages([...nextMessages, { role: "derya", body: result.reply }]);
      onRequestUpdateRef.current?.({
        title: result.draft.productName ?? requestText,
        draft: result.draft,
        missingFields: result.missingFields,
        lastQuestion: result.readyForResearch ? null : result.reply,
        status: result.readyForResearch ? "Researching" : "Clarification needed",
      });
      if (result.readyForResearch) {
        setCurrentRun(null);
        setPublicResearch(null);
        setCompletedSources(0);
        setResearchState("idle");
        setPhase("researching");
      } else {
        setPhase("request");
      }
      setIntakeState("idle");
    } catch (error) {
      if (controller.signal.aborted) return;
      setIntakeState("error");
      setIntakeError(error instanceof Error ? error.message : "The request could not be analyzed.");
    }
  }

  function answerClarification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitIntake(answer);
  }

  function refineRequest() {
    const prompt = "Tell me what to change before I run supplier research again.";
    setMessages((current) => [...current, { role: "derya", body: prompt }]);
    setMissingFields([]);
    setIntakeError("");
    setIntakeState("idle");
    setPhase("request");
    if (requestDraft) {
      onRequestUpdateRef.current?.({
        title: requestDraft.productName ?? requestText,
        draft: requestDraft,
        missingFields: [],
        lastQuestion: prompt,
        status: "Clarification needed",
      });
    }
  }

  useEffect(() => {
    if (item || initialIntakeStartedRef.current || initialDraft || initialRun) return;
    initialIntakeStartedRef.current = true;
    void submitIntake(requestText, true);
    return () => {
      initialIntakeStartedRef.current = false;
      intakeControllerRef.current?.abort();
    };
  }, [initialDraft, initialRun, item, requestText]);

  useEffect(() => {
    const result = currentCase?.result;
    if (!result) return;
    setQualificationForm(supplierQualificationForm(currentCase));
    setSelectedReplyEvidenceId(null);
    setCommercialForm({
      receivedOn: "",
      price: "",
      currency: "",
      minimumOrderQuantity: "",
      unitOfMeasure: item ? "EA" : "",
      deliveryDate: "",
      evidenceUrl: "",
      quoteReference: "",
      validUntil: "",
      note: "",
    });
    setQualityForm({
      method: result.qualityPlan?.method ?? "SAMPLE",
      acceptanceCriteria: result.qualityPlan?.acceptanceCriteria ?? "",
      owner: result.qualityPlan?.owner ?? "",
      targetDate: result.qualityPlan?.targetDate ?? "",
    });
    setApprovalReason("");
    setApprovalNote("");
    setPurchaseApprovalReason("");
    setPurchaseDecisionNote("");
    setGateActionError("");
    setGateActionState("idle");
  }, [currentCase?.result?.selectionHash]);

  useEffect(() => {
    const cycle = currentCase?.quoteCycle?.result;
    if (!cycle) return;
    setQuoteRequestForm({
      quantity: cycle.request.quantity,
      unitOfMeasure: cycle.request.unitOfMeasure,
      needBy: cycle.request.needBy,
      shipTo: cycle.request.shipTo,
      responseDue: cycle.request.responseDue,
      requirements: cycle.request.requirements,
      note: cycle.request.note ?? "",
    });
    setQuoteReleaseForm({
      channel: cycle.release?.channel ?? "EMAIL",
      releasedOn: cycle.release?.releasedOn ?? "",
      evidenceUrl: cycle.release?.evidenceUrl ?? "",
      note: cycle.release?.note ?? "",
    });
  }, [
    currentCase?.quoteCycle?.id,
    currentCase?.quoteCycle?.result?.requestHash,
    currentCase?.quoteCycle?.result?.release?.evidenceId,
  ]);

  useEffect(() => {
    const cycle = currentCase?.quoteCycle?.result;
    if (!cycle) return;
    const latest = cycle.responses.at(-1);
    setSelectedReplyEvidenceId(latest?.connectedReplyEvidenceId ?? null);
    if (latest) {
      setCommercialForm({
        receivedOn: latest.receivedOn,
        price: latest.price,
        currency: latest.currency,
        minimumOrderQuantity: latest.minimumOrderQuantity,
        unitOfMeasure: latest.unitOfMeasure,
        deliveryDate: latest.deliveryDate,
        evidenceUrl: latest.evidenceUrl,
        quoteReference: latest.quoteReference,
        validUntil: latest.validUntil,
        note: "",
      });
    } else {
      setCommercialForm({
        receivedOn: "",
        price: "",
        currency: "",
        minimumOrderQuantity: "",
        unitOfMeasure: cycle.request.unitOfMeasure,
        deliveryDate: "",
        evidenceUrl: "",
        quoteReference: "",
        validUntil: "",
        note: "",
      });
    }
  }, [currentCase?.quoteCycle?.id, currentCase?.quoteCycle?.result?.responses.at(-1)?.responseHash]);

  useEffect(() => {
    const draftMessage = currentCase?.supplierEmailDraft?.result?.message;
    if (draftMessage) {
      setSupplierEmailForm(draftMessage);
      return;
    }
    const cycle = currentCase?.quoteCycle?.result;
    setSupplierEmailForm((current) => ({
      ...current,
      senderAccountId: current.senderAccountId || senderAccounts[0]?.id || "",
      subject: `Quote request: ${item?.name ?? requestText}`,
      body: cycle
        ? [
            `Hello,`,
            "",
            `Please quote ${cycle.request.quantity} ${cycle.request.unitOfMeasure} of ${item?.name ?? requestText}.`,
            `Need by: ${cycle.request.needBy}`,
            `Ship to: ${cycle.request.shipTo}`,
            `Requirements: ${cycle.request.requirements}`,
            `Please respond by ${cycle.request.responseDue} with unit price, currency, MOQ, availability, and delivery date.`,
            "",
            "Thank you,",
            "Derya Supply Operations",
          ].join("\n")
        : current.body,
    }));
  }, [currentCase?.quoteCycle?.id, currentCase?.quoteCycle?.result?.requestHash, currentCase?.supplierEmailDraft?.id, item?.name, requestText, senderAccounts]);

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
    const release = currentCase?.result?.purchaseRelease;
    const action = currentCase?.purchaseAction;
    setPurchaseReleaseForm({
      channel: release?.release?.channel ?? "EMAIL",
      releasedOn: release?.release?.releasedOn ?? "",
      acknowledgmentDueOn: release?.release?.acknowledgmentDueOn ?? "",
      purchaseOrderReference: release?.release?.purchaseOrderReference ?? currentCase?.purchaseDraft?.result?.order.buyerReference ?? "",
      evidenceUrl: release?.release?.evidenceUrl ?? "",
      note: release?.release?.note ?? "",
    });
    setAcknowledgmentForm((current) => ({
      ...current,
      supplierOrderReference: "",
      acceptedQuantity: release?.remainingQuantity ?? action?.input.order.quantity ?? "",
      confirmedDeliveryDate: release?.lastConfirmedDeliveryDate ?? action?.input.commercial.deliveryDate ?? "",
      evidenceUrl: "",
      note: "",
    }));
  }, [currentCase?.purchaseAction?.id, currentCase?.purchaseAction?.result?.state, currentCase?.result?.purchaseRelease?.remainingQuantity]);

  useEffect(() => {
    const stored = currentCase?.purchaseOrderEmailDraft?.result;
    if (stored) {
      setPurchaseOrderEmailForm({ ...stored.message, ...stored.issuance, note: stored.issuance.note ?? "" });
      return;
    }
    const action = currentCase?.purchaseAction;
    if (!action || action.result?.state !== "AUTHORIZED") return;
    const order = action.input.order;
    const supplier = action.input.supplier;
    const commercial = action.input.commercial;
    setPurchaseOrderEmailForm((current) => ({
      ...current,
      senderAccountId: current.senderAccountId || senderAccounts[0]?.id || "",
      subject: `Purchase order: ${order.buyerReference || supplier.name}`,
      purchaseOrderReference: order.buyerReference || current.purchaseOrderReference,
      body: [
        "Hello,",
        "",
        `Please accept purchase order ${order.buyerReference || "[PO reference]"} for ${order.quantity} ${order.unitOfMeasure}.`,
        `Unit price: ${commercial.unitPrice} ${commercial.currency}`,
        `Ship to: ${order.shipTo}`,
        `Incoterm: ${order.incoterm}`,
        `Payment terms: ${order.paymentTerms}`,
        `Need by: ${order.needBy}`,
        order.notes ? `Order notes: ${order.notes}` : null,
        "",
        "Please confirm acceptance, supplier order reference, and delivery date.",
        "",
        "Thank you,",
        "Derya Supply Operations",
      ].filter(Boolean).join("\n"),
    }));
  }, [currentCase?.purchaseAction?.id, currentCase?.purchaseAction?.inputHash, currentCase?.purchaseOrderEmailDraft?.id, senderAccounts]);

  useEffect(() => {
    if (phase !== "researching" || (!item && !requestDraft)) return;
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
        componentName: item?.name ?? requestDraft?.productName ?? requestText,
        manufacturer: requestDraft?.manufacturer ?? undefined,
        mpn: requestDraft?.partNumber ?? undefined,
        specification: item?.specification ?? requestDraft?.specification ?? requestText,
        targetCountry: item ? "United States" : requestDraft?.deliveryLocation?.slice(0, 120) ?? undefined,
        requestText,
        requestedQuantity: item ? shortageQuantity(item) : requestDraft?.quantity ?? undefined,
        requestedUnit: item ? "units" : requestDraft?.unit ?? undefined,
        sourceRegion: requestDraft?.sourceRegion ?? undefined,
        deliveryLocation: item ? "Austin, TX, United States" : requestDraft?.deliveryLocation ?? undefined,
        needByDate: item ? ATLAS_SOURCING_NEED_BY[item.sku] ?? undefined : requestDraft?.needByDate ?? undefined,
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
      if (requestDraft) {
        onRequestUpdateRef.current?.({
          title: requestDraft.productName ?? requestText,
          draft: requestDraft,
          missingFields: [],
          lastQuestion: null,
          status: "Research unavailable",
        });
      }
    });
    return () => controller.abort();
  }, [item, onResearchSaved, phase, requestDraft, requestText]);

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

  function toggleShortlist(optionId: string) {
    setSelectedOptionId(optionId);
    setShortlistedOptionIds((current) => current.includes(optionId)
      ? current.length === 1 ? current : current.filter((candidate) => candidate !== optionId)
      : current.length >= 8 ? current : [...current, optionId]);
  }

  function openWorkstream(procurementCase: SavedProcurementCase) {
    if (gateActionState === "saving") return;
    if (hasDirtyWorkstream(dirtyDrafts, currentCase?.id) && procurementCase.id !== currentCase?.id) {
      setWorkstreamSwitchError("Save or submit the current supplier edits before switching workstreams.");
      return;
    }
    setWorkstreamSwitchError("");
    setCurrentCase(procurementCase);
    setSelectedOptionId(procurementCase.result?.selectedOption.id ?? "");
    setPhase("procure");
  }

  async function continueProcurement() {
    const selectedOptions = options.filter((option) => shortlistedOptionIds.includes(option.id));
    if (!currentRun || !selectedOptions.length || caseSaveState === "saving") return;
    setCaseSaveState("saving");
    try {
      const response = await fetch("/api/supply-os/procurement-cases", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          researchRunId: currentRun.id,
          selections: selectedOptions.map(selectionPayload),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { procurementCases?: SavedProcurementCase[] };
      if (!response.ok || !payload.procurementCases?.length) throw new Error("Supplier workstreams could not be saved.");
      const saved = payload.procurementCases;
      setWorkstreamCases((current) => [
        ...saved,
        ...current.filter((candidate) => !saved.some((next) => next.id === candidate.id)),
      ]);
      const active = saved.find((candidate) => candidate.result?.selectedOption.id === selectedOptionId) ?? saved[0];
      setCurrentCase(active);
      for (const procurementCase of saved) onProcurementCaseSaved(procurementCase);
      setCaseSaveState("idle");
      setPhase("procure");
    } catch {
      setCaseSaveState("error");
    }
  }

  async function runCaseAction(path: string, body: Record<string, unknown>, resolvedDraftSection?: string) {
    if (!currentCase?.result || gateActionState === "saving") return;
    const actionCaseId = currentCase.id;
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
      const quoteCycleProjection = payload.procurementCase.result?.quoteCycle;
      const projectedQuoteCycle = quoteCycleProjection && currentCase.quoteCycle?.result
        ? {
            ...currentCase.quoteCycle,
            result: {
              ...currentCase.quoteCycle.result,
              state: quoteCycleProjection.state,
              selectedResponseHash: quoteCycleProjection.selectedResponseHash ?? currentCase.quoteCycle.result.selectedResponseHash,
              updatedAt: quoteCycleProjection.updatedAt,
            },
          }
        : currentCase.quoteCycle ?? null;
      const nextCase: SavedProcurementCase = {
        ...payload.procurementCase,
        quoteCycle: payload.procurementCase.quoteCycle
          ?? (quoteCycleProjection ? projectedQuoteCycle : null),
        purchaseDraft: payload.procurementCase.purchaseDraft
          ?? (payload.procurementCase.result?.purchasePreparation ? currentCase.purchaseDraft : null),
        purchaseAction: payload.procurementCase.purchaseAction
          ?? (payload.procurementCase.result?.purchaseAuthorization ? currentCase.purchaseAction : null),
        supplierEmailDraft: payload.procurementCase.supplierEmailDraft !== undefined
          ? payload.procurementCase.supplierEmailDraft
          : currentCase.supplierEmailDraft ?? null,
        supplierEmailAction: payload.procurementCase.supplierEmailAction !== undefined
          ? payload.procurementCase.supplierEmailAction
          : currentCase.supplierEmailAction ?? null,
        purchaseOrderEmailDraft: payload.procurementCase.purchaseOrderEmailDraft !== undefined
          ? payload.procurementCase.purchaseOrderEmailDraft
          : currentCase.purchaseOrderEmailDraft ?? null,
        purchaseOrderEmailAction: payload.procurementCase.purchaseOrderEmailAction !== undefined
          ? payload.procurementCase.purchaseOrderEmailAction
          : currentCase.purchaseOrderEmailAction ?? null,
      };
      setCurrentCase(nextCase);
      setDirtyDrafts((current) => resolveWorkstreamDraft(current, actionCaseId, resolvedDraftSection));
      setWorkstreamCases((current) => [
        nextCase,
        ...current.filter((candidate) => candidate.id !== nextCase.id),
      ]);
      onProcurementCaseSaved(nextCase);
      setGateActionState("idle");
    } catch (error) {
      setGateActionState("error");
      setGateActionError(error instanceof Error ? error.message : "Procurement review could not be saved.");
    }
  }

  function reviewSourceEvidence(outcome: "QUALIFIED" | "REJECTED") {
    if (!currentCase?.result) return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/review`, {
      gate: "SOURCE_EVIDENCE",
      expectedSelectionHash: currentCase.result.selectionHash,
      outcome,
      ...qualificationForm,
    }, currentCase.result.stage === "SUPPLIER_REJECTED" ? "SUPPLIER_REJECTED" : "SOURCE_EVIDENCE");
  }

  function saveQuoteRequest() {
    if (!currentCase?.result) return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/quote-cycle`, {
      expectedSelectionHash: currentCase.result.selectionHash,
      expectedRevision: currentCase.quoteCycle?.result?.revision ?? 0,
      quantity: Number(quoteRequestForm.quantity),
      unitOfMeasure: quoteRequestForm.unitOfMeasure,
      needBy: quoteRequestForm.needBy,
      shipTo: quoteRequestForm.shipTo,
      responseDue: quoteRequestForm.responseDue,
      requirements: quoteRequestForm.requirements,
      note: quoteRequestForm.note || null,
    }, "quote-request");
  }

  function recordQuoteRelease() {
    const cycle = currentCase?.quoteCycle;
    if (!cycle?.result) return;
    void runCaseAction(`/api/supply-os/quote-cycles/${cycle.id}/release`, {
      expectedRequestHash: cycle.result.requestHash,
      ...quoteReleaseForm,
      note: quoteReleaseForm.note || null,
    }, "quote-release");
  }

  function saveSupplierEmail() {
    const cycle = currentCase?.quoteCycle;
    if (!cycle?.result) return;
    void runCaseAction(`/api/supply-os/quote-cycles/${cycle.id}/email-draft`, {
      expectedRequestHash: cycle.result.requestHash,
      expectedRevision: currentCase?.supplierEmailDraft?.result?.revision ?? 0,
      ...supplierEmailForm,
    }, "supplier-email-draft");
  }

  function requestSupplierEmailReview() {
    const draft = currentCase?.supplierEmailDraft;
    if (!draft?.resultHash) return;
    void runCaseAction(`/api/supply-os/supplier-email-drafts/${draft.id}/approval`, {
      expectedResultHash: draft.resultHash,
      reason: supplierEmailApprovalReason,
    }, "supplier-email-approval");
  }

  function decideSupplierEmail(decision: "APPROVE" | "REJECT") {
    const approvalId = currentCase?.supplierEmailAction?.approval?.id;
    if (!approvalId) return;
    void runCaseAction(`/api/supply-os/supplier-email-approvals/${approvalId}/decision`, {
      decision,
      note: supplierEmailDecisionNote || null,
    }, "supplier-email-decision");
  }

  function runSupplierEmailDelivery(operation: "SEND" | "RECONCILE" | "RESET") {
    const actionId = currentCase?.supplierEmailAction?.id;
    if (!actionId) return;
    void runCaseAction(`/api/supply-os/supplier-email-actions/${actionId}/delivery`, {
      operation,
      ...(operation === "RESET" ? { confirmedNotSent: true, note: supplierEmailRecoveryNote } : {}),
    }, operation === "RESET" ? "supplier-email-recovery" : undefined);
  }

  function checkConnectedSupplierReplies() {
    const cycle = currentCase?.quoteCycle;
    if (!cycle?.result) return;
    void runCaseAction(`/api/supply-os/quote-cycles/${cycle.id}/connected-replies`, {});
  }

  function useConnectedSupplierReply(reply: ConnectedSupplierReply) {
    if (currentCase) setDirtyDrafts((current) => markWorkstreamDraft(current, currentCase.id, "commercial-response"));
    setSelectedReplyEvidenceId(reply.evidenceId);
    setCommercialForm((current) => ({
      ...current,
      receivedOn: reply.receivedAt.slice(0, 10),
      evidenceUrl: "",
    }));
  }

  function recordQuoteResponse() {
    const cycle = currentCase?.quoteCycle;
    if (!cycle?.result) return;
    void runCaseAction(`/api/supply-os/quote-cycles/${cycle.id}/responses`, {
      expectedRequestHash: cycle.result.requestHash,
      receivedOn: commercialForm.receivedOn,
      price: Number(commercialForm.price),
      currency: commercialForm.currency,
      minimumOrderQuantity: Number(commercialForm.minimumOrderQuantity),
      unitOfMeasure: commercialForm.unitOfMeasure,
      deliveryDate: commercialForm.deliveryDate,
      evidenceUrl: selectedReplyEvidenceId ? null : commercialForm.evidenceUrl,
      connectedReplyEvidenceId: selectedReplyEvidenceId,
      quoteReference: commercialForm.quoteReference,
      validUntil: commercialForm.validUntil,
      note: commercialForm.note || null,
    }, "commercial-response");
  }

  function confirmCommercialTerms(responseHash: string) {
    if (!currentCase?.result || !currentCase.quoteCycle) return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/review`, {
      gate: "COMMERCIAL_TERMS",
      expectedSelectionHash: currentCase.result.selectionHash,
      quoteCycleTaskId: currentCase.quoteCycle.id,
      responseHash,
    }, "commercial-response");
  }

  function saveQualityPlan() {
    if (!currentCase?.result) return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/review`, {
      gate: "QUALITY_PLAN",
      expectedSelectionHash: currentCase.result.selectionHash,
      ...qualityForm,
    }, "QUALITY_REVIEW");
  }

  function requestApproval() {
    if (!currentCase?.result) return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/approval`, {
      expectedSelectionHash: currentCase.result.selectionHash,
      reason: approvalReason,
    }, "APPROVAL");
  }

  function decideApproval(decision: "APPROVE" | "REJECT") {
    const approvalId = currentCase?.result?.approval?.id;
    if (!approvalId) return;
    void runCaseAction(`/api/supply-os/procurement-approvals/${approvalId}/decision`, {
      decision,
      note: approvalNote || null,
    }, "APPROVAL_PENDING");
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
    }, "purchase-order");
  }

  function requestPurchaseApproval() {
    const draft = currentCase?.purchaseDraft;
    if (!currentCase?.result || !draft?.result || !draft.resultHash) return;
    void runCaseAction(`/api/supply-os/procurement-cases/${currentCase.id}/purchase-action`, {
      expectedDraftTaskId: draft.id,
      expectedDraftResultHash: draft.resultHash,
      expectedDraftRevision: draft.result.revision,
      reason: purchaseApprovalReason,
    }, "purchase-approval");
  }

  function decidePurchaseAction(decision: "APPROVE" | "REJECT") {
    const approvalId = currentCase?.purchaseAction?.approval?.id;
    if (!approvalId) return;
    void runCaseAction(`/api/supply-os/purchase-action-approvals/${approvalId}/decision`, {
      decision,
      note: purchaseDecisionNote || null,
    }, "purchase-decision");
  }

  function savePurchaseOrderEmail() {
    const action = currentCase?.purchaseAction;
    if (!action || action.result?.state !== "AUTHORIZED") return;
    void runCaseAction(`/api/supply-os/purchase-actions/${action.id}/email-draft`, {
      expectedActionScopeHash: action.inputHash,
      expectedRevision: currentCase?.purchaseOrderEmailDraft?.result?.revision ?? 0,
      ...purchaseOrderEmailForm,
      note: purchaseOrderEmailForm.note || null,
    }, "purchase-order-email-draft");
  }

  function requestPurchaseOrderEmailReview() {
    const draft = currentCase?.purchaseOrderEmailDraft;
    if (!draft?.resultHash) return;
    void runCaseAction(`/api/supply-os/purchase-order-email-drafts/${draft.id}/approval`, {
      expectedResultHash: draft.resultHash,
      reason: purchaseOrderEmailApprovalReason,
    }, "purchase-order-email-approval");
  }

  function decidePurchaseOrderEmail(decision: "APPROVE" | "REJECT") {
    const approvalId = currentCase?.purchaseOrderEmailAction?.approval?.id;
    if (!approvalId) return;
    void runCaseAction(`/api/supply-os/purchase-order-email-approvals/${approvalId}/decision`, {
      decision,
      note: purchaseOrderEmailDecisionNote || null,
    }, "purchase-order-email-decision");
  }

  function runPurchaseOrderEmailDelivery(operation: "SEND" | "RECONCILE" | "RESET") {
    const actionId = currentCase?.purchaseOrderEmailAction?.id;
    if (!actionId) return;
    void runCaseAction(`/api/supply-os/purchase-order-email-actions/${actionId}/delivery`, {
      operation,
      ...(operation === "RESET" ? { confirmedNotSent: true, note: purchaseOrderEmailRecoveryNote } : {}),
    }, operation === "RESET" ? "purchase-order-email-recovery" : undefined);
  }

  function recordSupplierAcknowledgment() {
    const actionId = currentCase?.purchaseAction?.id;
    const releaseHash = currentCase?.result?.purchaseRelease?.release?.releaseHash;
    if (!actionId || !releaseHash) return;
    void runCaseAction(`/api/supply-os/purchase-actions/${actionId}/acknowledgments`, {
      ...acknowledgmentForm,
      expectedReleaseHash: releaseHash,
      acceptedQuantity: Number(acknowledgmentForm.acceptedQuantity),
      note: acknowledgmentForm.note || null,
    }, "supplier-acknowledgment");
  }

  function recordPurchaseRelease() {
    const action = currentCase?.purchaseAction;
    if (!action) return;
    void runCaseAction(`/api/supply-os/purchase-actions/${action.id}/release`, {
      ...purchaseReleaseForm,
      expectedScopeHash: action.inputHash,
      note: purchaseReleaseForm.note || null,
    }, "purchase-release");
  }

  const purchaseFormComplete = Number(purchaseForm.quantity) > 0
    && Boolean(purchaseForm.needBy)
    && Boolean(purchaseForm.shipTo.trim())
    && Boolean(purchaseForm.paymentTerms.trim());
  const purchaseActionStatus = currentCase?.purchaseAction?.approval?.status ?? null;
  const purchaseReleaseResult = currentCase?.purchaseAction?.result?.state === "RELEASED"
    || currentCase?.purchaseAction?.result?.state === "PARTIALLY_ACKNOWLEDGED"
    || currentCase?.purchaseAction?.result?.state === "ACKNOWLEDGED"
    ? currentCase.purchaseAction.result
    : null;
  const purchaseReleaseState = purchaseReleaseResult?.state ?? null;
  const purchaseReleaseFormComplete = Boolean(purchaseReleaseForm.releasedOn)
    && Boolean(purchaseReleaseForm.acknowledgmentDueOn)
    && Boolean(purchaseReleaseForm.purchaseOrderReference.trim())
    && Boolean(purchaseReleaseForm.evidenceUrl.trim());
  const purchaseOrderEmailFormComplete = Boolean(purchaseOrderEmailForm.senderAccountId)
    && Boolean(purchaseOrderEmailForm.recipient.trim())
    && Boolean(purchaseOrderEmailForm.subject.trim())
    && Boolean(purchaseOrderEmailForm.body.trim())
    && Boolean(purchaseOrderEmailForm.purchaseOrderReference.trim())
    && Boolean(purchaseOrderEmailForm.acknowledgmentDueOn);
  const acknowledgmentFormComplete = Boolean(acknowledgmentForm.acknowledgedOn)
    && Boolean(acknowledgmentForm.supplierOrderReference.trim())
    && Number(acknowledgmentForm.acceptedQuantity) > 0
    && Boolean(acknowledgmentForm.confirmedDeliveryDate)
    && Boolean(acknowledgmentForm.evidenceUrl.trim());
  const quoteRequestComplete = Number(quoteRequestForm.quantity) > 0
    && Boolean(quoteRequestForm.unitOfMeasure.trim())
    && Boolean(quoteRequestForm.needBy)
    && Boolean(quoteRequestForm.shipTo.trim())
    && Boolean(quoteRequestForm.responseDue)
    && Boolean(quoteRequestForm.requirements.trim());
  const quoteReleaseComplete = Boolean(quoteReleaseForm.releasedOn)
    && Boolean(quoteReleaseForm.evidenceUrl.trim());
  const quoteResponseComplete = Boolean(commercialForm.receivedOn)
    && Number(commercialForm.price) > 0
    && Boolean(commercialForm.currency.trim())
    && Number(commercialForm.minimumOrderQuantity) > 0
    && Boolean(commercialForm.unitOfMeasure.trim())
    && Boolean(commercialForm.deliveryDate)
    && Boolean(commercialForm.quoteReference.trim())
    && Boolean(commercialForm.validUntil)
    && Boolean(selectedReplyEvidenceId || commercialForm.evidenceUrl.trim());
  const qualificationComplete = Boolean(qualificationForm.identityEvidenceUrl.trim())
    && Boolean(qualificationForm.capabilityEvidenceUrl.trim())
    && Boolean(qualificationForm.validUntil)
    && qualificationForm.note.trim().length >= 10
    && (qualificationForm.relationship !== "AUTHORIZED_DISTRIBUTOR" || Boolean(qualificationForm.authorizationEvidenceUrl.trim()));
  const rejectionComplete = qualificationForm.note.trim().length >= 10;

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
          <h2>{item?.name ?? requestDraft?.productName ?? requestText}</h2>
        </span>
        <i>{phase === "request" ? "Request intake" : currentRun ? "Saved research" : "Public research"}</i>
      </header>

      <nav className={styles.procurementProgress} aria-label="Procurement progress">
        <span data-active={phase === "request"} data-complete={phase !== "request"}><b>01</b> Request</span>
        <span data-active={phase === "researching"} data-complete={phase === "compare" || phase === "procure"}><b>02</b> Research</span>
        <span data-active={phase === "compare"} data-complete={phase === "procure"}><b>03</b> Compare</span>
        <span data-active={phase === "procure"}><b>04</b> Procure</span>
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        {phase === "request" ? (
          <motion.div
            key="request"
            className={styles.procurementClarification}
            initial={reduceMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
            transition={{ duration: 0.16 }}
          >
            <section className={styles.procurementRequestSummary}>
              <small>Request details</small>
              <h3>{requestDraft?.productName ?? requestText}</h3>
              <dl>
                <div><dt>Quantity</dt><dd>{requestDraft?.quantity && requestDraft.unit ? `${requestDraft.quantity.toLocaleString("en-US")} ${requestDraft.unit}` : "Required"}</dd></div>
                <div><dt>Specification</dt><dd>{requestDraft?.partNumber ?? requestDraft?.specification ?? "Required"}</dd></div>
                <div><dt>Source region</dt><dd>{requestDraft?.sourceRegion ?? "Any region"}</dd></div>
                <div><dt>Deliver to</dt><dd>{requestDraft?.deliveryLocation ?? "Required"}</dd></div>
                <div><dt>Need by</dt><dd>{requestDraft?.needByDate ?? "Required"}</dd></div>
              </dl>
              <p><TriangleAlert size={14} /> Web research starts only after the required facts are present.</p>
            </section>
            <section className={styles.procurementRequestChat} aria-label="Sourcing request clarification">
              <div className={styles.procurementRequestMessages} aria-live="polite">
                {messages.map((message, index) => (
                  <p key={`${message.role}:${index}`} data-role={message.role}>{message.body}</p>
                ))}
                {intakeState === "running" ? <p data-role="derya"><LoaderCircle size={14} className={styles.spin} /> Reading the request</p> : null}
                {intakeError ? <p data-role="error">{intakeError}</p> : null}
              </div>
              <form onSubmit={answerClarification}>
                <label htmlFor="sourcing-request-answer">Answer</label>
                <textarea
                  id="sourcing-request-answer"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  maxLength={2_000}
                  rows={3}
                  placeholder={missingFields.length ? "Provide the missing details" : "Describe what should change"}
                />
                <button type="submit" disabled={!answer.trim() || intakeState === "running"}>
                  {intakeState === "running" ? <LoaderCircle size={15} className={styles.spin} /> : <Send size={15} />}
                  Send answer
                </button>
              </form>
            </section>
          </motion.div>
        ) : phase === "researching" ? (
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
                        <tr key={option.id} data-selected={shortlistedOptionIds.includes(option.id)} data-recommended={option.id === recommended.id}>
                          <td><strong>{option.name}</strong><small>{option.role} · {option.location}</small>{option.id === recommended.id ? <i>Suggested</i> : null}</td>
                          <td><strong>{option.sourceClass}</strong><small>{option.sourceLabel}</small>{option.sourceUrl ? <a href={option.sourceUrl} target="_blank" rel="noreferrer">View source</a> : null}</td>
                          <td><strong>{option.priceType === "Unknown" ? "Unknown" : formatCurrency(option.modeledUnitCostUsd, option.currency)}</strong><small>{option.priceType} · MOQ {option.minimumOrderQuantity || "unknown"}</small></td>
                          <td><strong>{option.deliveryDate}</strong><small>{option.leadTimeDays ? `${option.leadTimeDays} days ${option.deliveryType.toLowerCase()}` : "Lead time unknown"}</small></td>
                          <td><strong>{option.quality}</strong><small>{option.qualityEvidence}</small></td>
                          <td><button type="button" aria-pressed={shortlistedOptionIds.includes(option.id)} onClick={() => toggleShortlist(option.id)}>{shortlistedOptionIds.includes(option.id) ? <Check size={14} /> : null}{shortlistedOptionIds.includes(option.id) ? "Shortlisted" : "Add"}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <footer className={styles.procurementDecisionFooter}>
                  <span role={caseSaveState === "error" ? "alert" : undefined}><TriangleAlert size={14} /> {caseSaveState === "error" ? "Supplier workstreams could not be saved. Try again." : "Shortlist suppliers for separate RFQs. No supplier is contacted until its message is approved."}</span>
                  <button type="button" disabled={!shortlistedOptionIds.length || !currentRun || caseSaveState === "saving"} onClick={() => void continueProcurement()}>{caseSaveState === "saving" ? "Saving" : `Create ${shortlistedOptionIds.length} workstream${shortlistedOptionIds.length === 1 ? "" : "s"}`} <ArrowRight size={15} /></button>
                </footer>
              </>
            ) : (
              <section className={styles.procurementUnknownState}>
                <Globe2 size={24} />
                <h3>Request added, terms still unknown</h3>
                <p>The research run could not resolve a manufacturer or part number, so price, delivery, and quality remain unknown.</p>
                <button type="button" onClick={refineRequest}>Refine request</button>
              </section>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="procure"
            className={styles.procurementHandoff}
            onChangeCapture={(event) => {
              if (!currentCase) return;
              const section = (event.target as HTMLElement).closest<HTMLElement>("[data-draft-section]")?.dataset.draftSection;
              if (section) setDirtyDrafts((current) => markWorkstreamDraft(current, currentCase.id, section));
            }}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            {quoteComparisons.length > 1 ? (
              <section className={styles.procurementQuoteInbox} aria-label="Supplier quote inbox">
                <header><span><small>Competitive quote inbox</small><h3>{item?.name ?? requestText}</h3></span><p>Each supplier stays in a separate evidence workstream. Only one can enter award approval.</p></header>
                <div>
                  {quoteComparisons.map(({ procurementCase, supplier, response, state }) => (
                    <button
                      key={procurementCase.id}
                      type="button"
                      data-active={procurementCase.id === currentCase?.id}
                      disabled={gateActionState === "saving"}
                      onClick={() => openWorkstream(procurementCase)}
                    >
                      <span><strong>{supplier}</strong><small>{state}</small>{quoteSignals.bestPriceId === procurementCase.id ? <em>Lowest quoted price</em> : quoteSignals.earliestId === procurementCase.id ? <em>Earliest delivery</em> : null}</span>
                      <span><strong>{response ? formatMoney(response.price, response.currency) : "No quote yet"}</strong><small>{response ? `${response.minimumOrderQuantity} ${response.unitOfMeasure} MOQ · ${displayStoredDate(response.deliveryDate)}` : "Open workstream"}</small></span>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
                <footer role={workstreamSwitchError ? "alert" : undefined}>{workstreamSwitchError || "Price and delivery badges require the same currency, unit, and RFQ scope. Missing freight, duty, and quality inputs remain unknown. Award approval is exclusive."}</footer>
              </section>
            ) : null}
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
                <div><span data-status={currentCase.result.gates.sourceEvidence} /><p><strong>Supplier qualification</strong><small>{currentCase.result.stage === "SUPPLIER_REJECTED" ? "Supplier rejected" : currentCase.result.gates.sourceEvidence === "EVIDENCE_COMPLETE" ? `Qualified through ${displayStoredDate(currentCase.result.reviews?.sourceEvidence?.validUntil)}` : currentCase.result.gates.sourceEvidence === "BLOCKED" ? "Attributable evidence required" : "Identity and capability review required"}</small></p></div>
                <div><span data-status={currentCase.result.gates.commercialTerms} /><p><strong>Commercial terms</strong><small>{currentCase.result.gates.commercialTerms === "EVIDENCE_COMPLETE" ? "Quote terms confirmed" : "Confirm price, currency, MOQ, and delivery"}</small></p></div>
                <div><span data-status={currentCase.result.gates.qualityPlan} /><p><strong>Quality plan</strong><small>{currentCase.result.gates.qualityPlan === "EVIDENCE_COMPLETE" ? "Acceptance plan recorded" : "Sample or inspection plan required"}</small></p></div>
                <div><span data-status={currentCase.result.gates.purchaseApproval} /><p><strong>Purchase approval</strong><small>{currentCase.result.gates.purchaseApproval === "APPROVED" ? "Approved for purchase preparation" : currentCase.result.gates.purchaseApproval === "PENDING" ? "Manager decision pending" : currentCase.result.gates.purchaseApproval === "REJECTED" ? "Revision required" : "Blocked until review gates are complete"}</small></p></div>
              </section>
            ) : null}
            {currentCase?.result ? (
              <section className={styles.procurementGateAction} aria-live="polite" data-draft-section={currentCase.result.stage}>
                {currentCase.result.stage === "SOURCE_EVIDENCE" || currentCase.result.stage === "SUPPLIER_REJECTED" ? (
                  <>
                    <header><small>Gate 1 of 4</small><h4>{currentCase.result.stage === "SUPPLIER_REJECTED" ? "Supplier rejected" : "Qualify the supplier"}</h4><p>Verify the business identity, component capability, and commercial relationship before an RFQ can leave Derya.</p></header>
                    {currentCase.result.selectedOption.sourceUrl ? <a href={currentCase.result.selectedOption.sourceUrl} target="_blank" rel="noreferrer">Open attributed supplier source <ArrowRight size={14} /></a> : null}
                    <div className={styles.procurementFormGrid}>
                      <label className={styles.procurementWideField}>Identity evidence URL<input type="url" value={qualificationForm.identityEvidenceUrl} onChange={(event) => setQualificationForm((current) => ({ ...current, identityEvidenceUrl: event.target.value }))} placeholder="Official company or registry page" /></label>
                      <label className={styles.procurementWideField}>Component capability URL<input type="url" value={qualificationForm.capabilityEvidenceUrl} onChange={(event) => setQualificationForm((current) => ({ ...current, capabilityEvidenceUrl: event.target.value }))} placeholder="Product, catalog, or line-card page" /></label>
                      <label>Supplier relationship<select value={qualificationForm.relationship} onChange={(event) => setQualificationForm((current) => ({ ...current, relationship: event.target.value as typeof current.relationship }))}><option value="MANUFACTURER">Manufacturer</option><option value="AUTHORIZED_DISTRIBUTOR">Authorized distributor</option><option value="INDEPENDENT_DISTRIBUTOR">Independent distributor</option></select></label>
                      <label>Valid through<input type="date" value={qualificationForm.validUntil} onChange={(event) => setQualificationForm((current) => ({ ...current, validUntil: event.target.value }))} /></label>
                      {qualificationForm.relationship === "AUTHORIZED_DISTRIBUTOR" ? <label className={styles.procurementWideField}>Manufacturer authorization URL<input type="url" value={qualificationForm.authorizationEvidenceUrl} onChange={(event) => setQualificationForm((current) => ({ ...current, authorizationEvidenceUrl: event.target.value }))} placeholder="Manufacturer partner or distributor listing" /></label> : null}
                      <label>Rejection reason<select value={qualificationForm.rejectionReason} onChange={(event) => setQualificationForm((current) => ({ ...current, rejectionReason: event.target.value as typeof current.rejectionReason }))}><option value="IDENTITY_UNRESOLVED">Identity unresolved</option><option value="CAPABILITY_UNRESOLVED">Capability unresolved</option><option value="AUTHORIZATION_UNRESOLVED">Authorization unresolved</option><option value="SOURCE_UNVERIFIABLE">Source unverifiable</option><option value="OTHER">Other</option></select></label>
                      <label className={styles.procurementWideField}>Review note<textarea value={qualificationForm.note} onChange={(event) => setQualificationForm((current) => ({ ...current, note: event.target.value }))} placeholder="Record what matched, what did not, and any remaining risk." /></label>
                    </div>
                    <div className={styles.procurementDecisionActions}>
                      <button type="button" disabled={gateActionState === "saving" || !currentCase.result.selectedOption.sourceUrl || !qualificationComplete} onClick={() => reviewSourceEvidence("QUALIFIED")}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <Check size={14} />} {currentCase.result.stage === "SUPPLIER_REJECTED" ? "Requalify supplier" : "Qualify for RFQ"}</button>
                      <button type="button" disabled={gateActionState === "saving" || !rejectionComplete} onClick={() => reviewSourceEvidence("REJECTED")}><TriangleAlert size={14} /> Reject supplier</button>
                    </div>
                    <p className={styles.procurementPermissionNote}>Qualification permits quote outreach only. It is not a supplier award, compliance clearance, or purchase authorization.</p>
                  </>
                ) : currentCase.result.stage === "COMMERCIAL_CONFIRMATION" ? (
                  <>
                    <header><small>Gate 2 of 4</small><h4>Run the supplier quote cycle</h4><p>Prepare the request, record how it was sent outside Derya, then select a sourced supplier response.</p></header>
                    {!currentCase.quoteCycle || currentCase.quoteCycle.status === "PLANNED" ? (
                      <section className={styles.purchaseApprovalRequest} data-draft-section="quote-request">
                        <p><strong>{currentCase.quoteCycle ? `Quote request revision ${currentCase.quoteCycle.result?.revision}` : "Quote request"}</strong></p>
                        <div className={styles.procurementFormGrid}>
                          <label>Quantity<input type="number" min="0.01" step="0.01" value={quoteRequestForm.quantity} onChange={(event) => setQuoteRequestForm((current) => ({ ...current, quantity: event.target.value }))} /></label>
                          <label>Unit<input maxLength={20} value={quoteRequestForm.unitOfMeasure} onChange={(event) => setQuoteRequestForm((current) => ({ ...current, unitOfMeasure: event.target.value.toUpperCase() }))} placeholder="EA" /></label>
                          <label>Need by<input type="date" value={quoteRequestForm.needBy} onChange={(event) => setQuoteRequestForm((current) => ({ ...current, needBy: event.target.value }))} /></label>
                          <label>Response due<input type="date" value={quoteRequestForm.responseDue} onChange={(event) => setQuoteRequestForm((current) => ({ ...current, responseDue: event.target.value }))} /></label>
                          <label className={styles.procurementWideField}>Ship to<input value={quoteRequestForm.shipTo} onChange={(event) => setQuoteRequestForm((current) => ({ ...current, shipTo: event.target.value }))} /></label>
                          <label className={styles.procurementWideField}>Requirements<textarea value={quoteRequestForm.requirements} onChange={(event) => setQuoteRequestForm((current) => ({ ...current, requirements: event.target.value }))} placeholder="Specification, certification, packaging, and delivery requirements" /></label>
                          <label className={styles.procurementWideField}>Internal note<textarea value={quoteRequestForm.note} onChange={(event) => setQuoteRequestForm((current) => ({ ...current, note: event.target.value }))} placeholder="Optional buyer context" /></label>
                        </div>
                        <button type="button" disabled={gateActionState === "saving" || !quoteRequestComplete} onClick={saveQuoteRequest}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <PackageCheck size={14} />} {currentCase.quoteCycle ? "Update quote request" : "Save quote request"}</button>
                        <p>This is an internal draft. It does not contact the supplier.</p>
                      </section>
                    ) : null}
                    {currentCase.quoteCycle?.status === "PLANNED" && currentCase.quoteCycle.result ? (
                      <section className={styles.purchaseApprovalRequest}>
                        <p><strong>Send through connected Gmail</strong></p>
                        <p>The exact sender, recipient, subject, and body are locked into the approval. Delivery is recorded only after Gmail returns a receipt.</p>
                        {senderAccounts.length ? (
                          <div className={styles.procurementFormGrid} data-draft-section="supplier-email-draft">
                            <label>From<select value={supplierEmailForm.senderAccountId} onChange={(event) => setSupplierEmailForm((current) => ({ ...current, senderAccountId: event.target.value }))}>{senderAccounts.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}</select></label>
                            <label>Supplier email<input type="email" value={supplierEmailForm.recipient} onChange={(event) => setSupplierEmailForm((current) => ({ ...current, recipient: event.target.value }))} placeholder="sales@supplier.com" /></label>
                            <label className={styles.procurementWideField}>Subject<input value={supplierEmailForm.subject} onChange={(event) => setSupplierEmailForm((current) => ({ ...current, subject: event.target.value }))} /></label>
                            <label className={styles.procurementWideField}>Message<textarea value={supplierEmailForm.body} onChange={(event) => setSupplierEmailForm((current) => ({ ...current, body: event.target.value }))} /></label>
                          </div>
                        ) : <p>No connected Gmail sender is available for this office. Connect one or use another channel below.</p>}
                        {senderAccounts.length ? <button type="button" disabled={gateActionState === "saving" || !supplierEmailForm.recipient || !supplierEmailForm.subject || !supplierEmailForm.body} onClick={saveSupplierEmail}><Mail size={14} /> {currentCase.supplierEmailDraft ? "Save message revision" : "Save email draft"}</button> : null}
                        {currentCase.supplierEmailDraft?.result && !currentCase.supplierEmailAction ? (
                          <>
                            <label data-draft-section="supplier-email-approval">Approval reason<textarea value={supplierEmailApprovalReason} onChange={(event) => setSupplierEmailApprovalReason(event.target.value)} /></label>
                            <button type="button" disabled={gateActionState === "saving" || !supplierEmailApprovalReason.trim()} onClick={requestSupplierEmailReview}><ShieldCheck size={14} /> Request send approval</button>
                          </>
                        ) : null}
                        {currentCase.supplierEmailAction?.approval?.status === "PENDING" ? (
                          canApproveProcurement ? (
                            <>
                              <label data-draft-section="supplier-email-decision">Decision note<textarea value={supplierEmailDecisionNote} onChange={(event) => setSupplierEmailDecisionNote(event.target.value)} placeholder="Optional approval or rejection context" /></label>
                              <div className={styles.purchaseDecisionActions}>
                                <button type="button" disabled={gateActionState === "saving"} onClick={() => decideSupplierEmail("APPROVE")}><Check size={14} /> Approve exact email</button>
                                <button type="button" disabled={gateActionState === "saving"} onClick={() => decideSupplierEmail("REJECT")}><TriangleAlert size={14} /> Reject</button>
                              </div>
                            </>
                          ) : <p>Manager approval is pending for this exact email.</p>
                        ) : null}
                        {currentCase.supplierEmailAction?.approval?.status === "APPROVED" && (currentCase.supplierEmailAction.status === "READY" || ["RETRY_READY", "SEND_FAILED"].includes(currentCase.supplierEmailAction.result?.state ?? "")) ? (
                          <button type="button" disabled={gateActionState === "saving"} onClick={() => runSupplierEmailDelivery("SEND")}><ArrowRight size={14} /> {currentCase.supplierEmailAction.result?.state === "SEND_FAILED" ? "Retry rejected send" : "Send approved email"}</button>
                        ) : null}
                        {currentCase.supplierEmailAction?.result?.state === "SENDING" || currentCase.supplierEmailAction?.result?.state === "DELIVERY_UNKNOWN" ? (
                          <>
                            <p>Gmail delivery is unresolved. Sending again is blocked until Derya checks the stable message ID.</p>
                            <button type="button" disabled={gateActionState === "saving"} onClick={() => runSupplierEmailDelivery("RECONCILE")}><RefreshCw size={14} /> Check Gmail delivery</button>
                          </>
                        ) : null}
                        {currentCase.supplierEmailAction?.result?.state === "NOT_FOUND_REVIEW_REQUIRED" ? (
                          <>
                            <p>Gmail did not find the message. A manager must verify non-delivery before one new attempt is allowed.</p>
                            {canApproveProcurement ? <><label data-draft-section="supplier-email-recovery">Recovery note<textarea value={supplierEmailRecoveryNote} onChange={(event) => setSupplierEmailRecoveryNote(event.target.value)} placeholder="Explain how non-delivery was verified." /></label><button type="button" disabled={gateActionState === "saving" || supplierEmailRecoveryNote.trim().length < 10} onClick={() => runSupplierEmailDelivery("RESET")}><RefreshCw size={14} /> Confirm non-delivery and enable retry</button></> : null}
                          </>
                        ) : null}
                      </section>
                    ) : null}
                    {currentCase.quoteCycle?.status === "PLANNED" && currentCase.quoteCycle.result ? (
                      <section className={styles.purchaseApprovalRequest} data-draft-section="quote-release">
                        <p><strong>Record another channel</strong></p>
                        <div className={styles.procurementFormGrid}>
                          <label>Channel<select value={quoteReleaseForm.channel} onChange={(event) => setQuoteReleaseForm((current) => ({ ...current, channel: event.target.value as typeof current.channel }))}><option value="EMAIL">Email</option><option value="SUPPLIER_PORTAL">Supplier portal</option><option value="EDI">EDI</option><option value="PHONE_CONFIRMED">Phone confirmed</option><option value="OTHER">Other</option></select></label>
                          <label>Released on<input type="date" value={quoteReleaseForm.releasedOn} onChange={(event) => setQuoteReleaseForm((current) => ({ ...current, releasedOn: event.target.value }))} /></label>
                          <label className={styles.procurementWideField}>Release evidence URL<input type="url" value={quoteReleaseForm.evidenceUrl} onChange={(event) => setQuoteReleaseForm((current) => ({ ...current, evidenceUrl: event.target.value }))} placeholder="https://..." /></label>
                          <label className={styles.procurementWideField}>Release note<textarea value={quoteReleaseForm.note} onChange={(event) => setQuoteReleaseForm((current) => ({ ...current, note: event.target.value }))} placeholder="Optional external-send context" /></label>
                        </div>
                        <button type="button" disabled={gateActionState === "saving" || !quoteReleaseComplete} onClick={recordQuoteRelease}><ArrowRight size={14} /> Record external release</button>
                        <p>Use this only when the request was sent through a supplier portal, EDI, phone, or email outside the connected workflow.</p>
                      </section>
                    ) : null}
                    {currentCase.quoteCycle?.status === "RUNNING" && currentCase.quoteCycle.result ? (
                      <>
                        <section className={styles.purchaseAuthorizationState}>
                          <CheckCircle2 size={20} />
                          <div><strong>{currentCase.quoteCycle.result.responses.length ? "Supplier responses received" : "Awaiting supplier response"}</strong><p>External request release recorded for {currentCase.quoteCycle.result.release?.releasedOn}. {currentCase.quoteCycle.result.release ? <a href={evidenceHref(currentCase.quoteCycle.result.release.evidenceId, currentCase.quoteCycle.result.release.evidenceUrl)} target="_blank" rel="noreferrer">Open release evidence</a> : null}</p></div>
                        </section>
                        {currentCase.supplierEmailAction?.status === "SUCCEEDED" && currentCase.supplierEmailAction.result?.state === "SENT" ? (
                          <section className={styles.purchaseApprovalRequest}>
                            <p><strong>Connected supplier inbox</strong></p>
                            <p>Sync the approved sender account and capture replies from the exact supplier address. Captured messages remain review evidence, not confirmed commercial terms.</p>
                            <button type="button" disabled={gateActionState === "saving"} onClick={checkConnectedSupplierReplies}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <RefreshCw size={14} />} Check connected inbox</button>
                            {currentCase.quoteCycle.result.lastReplySyncAt ? <small>Last checked <time dateTime={currentCase.quoteCycle.result.lastReplySyncAt}>{displayStoredDate(currentCase.quoteCycle.result.lastReplySyncAt.slice(0, 10))}</time>.</small> : null}
                          </section>
                        ) : null}
                        {(currentCase.quoteCycle.result.connectedReplies ?? []).map((reply) => (
                          <section className={styles.purchaseApprovalRequest} key={reply.evidenceId}>
                            <p><strong>Reply from {reply.fromName || reply.fromEmail}</strong></p>
                            <p>{reply.subject || "No subject"} · <time dateTime={reply.receivedAt}>{displayStoredDate(reply.receivedAt.slice(0, 10))}</time></p>
                            <p>{reply.excerpt || "This reply contains no plain-text body."}</p>
                            {reply.attachments.length ? <p>Attachments: {reply.attachments.map((attachment) => attachment.name).join(", ")}</p> : null}
                            <div className={styles.purchaseDecisionActions}>
                              <a href={evidenceHref(reply.evidenceId, reply.sourceUrl)} target="_blank" rel="noreferrer">Open connected evidence <ArrowRight size={14} /></a>
                              <button type="button" disabled={gateActionState === "saving"} onClick={() => useConnectedSupplierReply(reply)}><PackageCheck size={14} /> {selectedReplyEvidenceId === reply.evidenceId ? "Using this reply" : "Use as quote evidence"}</button>
                            </div>
                          </section>
                        ))}
                        {currentCase.quoteCycle.result.responses.map((response) => (
                          <section className={styles.purchaseApprovalRequest} key={response.responseHash}>
                            <dl className={styles.purchaseDraftSummary}>
                              <div><dt>Quote</dt><dd>{response.quoteReference}</dd></div>
                              <div><dt>Unit price</dt><dd>{formatMoney(response.price, response.currency)}</dd></div>
                              <div><dt>MOQ</dt><dd>{response.minimumOrderQuantity} {response.unitOfMeasure}</dd></div>
                              <div><dt>Delivery</dt><dd>{response.deliveryDate}</dd></div>
                            </dl>
                            <p>Received {response.receivedOn}, valid through {response.validUntil}. <a href={evidenceHref(response.evidenceId, response.evidenceUrl)} target="_blank" rel="noreferrer">Open captured evidence</a></p>
                            <button type="button" disabled={gateActionState === "saving"} onClick={() => confirmCommercialTerms(response.responseHash)}><Check size={14} /> Use quote</button>
                          </section>
                        ))}
                        <section className={styles.purchaseApprovalRequest} data-draft-section="commercial-response">
                          <p><strong>Record supplier response</strong></p>
                          <div className={styles.procurementFormGrid}>
                            <label>Received on<input type="date" value={commercialForm.receivedOn} onChange={(event) => setCommercialForm((current) => ({ ...current, receivedOn: event.target.value }))} /></label>
                            <label>Unit price<input type="number" min="0.01" step="0.01" value={commercialForm.price} onChange={(event) => setCommercialForm((current) => ({ ...current, price: event.target.value }))} /></label>
                            <label>Currency<input maxLength={3} value={commercialForm.currency} onChange={(event) => setCommercialForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></label>
                            <label>MOQ<input type="number" min="0.01" step="0.01" value={commercialForm.minimumOrderQuantity} onChange={(event) => setCommercialForm((current) => ({ ...current, minimumOrderQuantity: event.target.value }))} /></label>
                            <label>Unit<input maxLength={20} value={commercialForm.unitOfMeasure} onChange={(event) => setCommercialForm((current) => ({ ...current, unitOfMeasure: event.target.value.toUpperCase() }))} placeholder="EA" /></label>
                            <label>Delivery date<input type="date" value={commercialForm.deliveryDate} onChange={(event) => setCommercialForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
                            <label>Quote reference<input value={commercialForm.quoteReference} onChange={(event) => setCommercialForm((current) => ({ ...current, quoteReference: event.target.value }))} placeholder="Supplier quote number" /></label>
                            <label>Valid until<input type="date" value={commercialForm.validUntil} onChange={(event) => setCommercialForm((current) => ({ ...current, validUntil: event.target.value }))} /></label>
                            {selectedReplyEvidenceId ? (
                              <div className={styles.procurementWideField}>
                                <p><strong>Connected Gmail reply selected</strong></p>
                                <p>The response date is pinned to the message timestamp. Review and enter the commercial values exactly as written by the supplier.</p>
                            <button type="button" onClick={() => {
                              setDirtyDrafts((current) => currentCase ? markWorkstreamDraft(current, currentCase.id, "commercial-response") : current);
                              setSelectedReplyEvidenceId(null);
                            }}>Use external evidence URL instead</button>
                              </div>
                            ) : <label className={styles.procurementWideField}>Quote evidence URL<input type="url" value={commercialForm.evidenceUrl} onChange={(event) => setCommercialForm((current) => ({ ...current, evidenceUrl: event.target.value }))} placeholder="https://..." /></label>}
                            <label className={styles.procurementWideField}>Response note<textarea value={commercialForm.note} onChange={(event) => setCommercialForm((current) => ({ ...current, note: event.target.value }))} placeholder="Optional exclusions or supplier conditions" /></label>
                          </div>
                          <button type="button" disabled={gateActionState === "saving" || !quoteResponseComplete} onClick={recordQuoteResponse}><PackageCheck size={14} /> Record quote response</button>
                        </section>
                      </>
                    ) : null}
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
                    <header><small>Gate 4 of 4</small><h4>Request award approval for this supplier</h4><p>The selected supplier, confirmed quote terms, evidence review, and quality plan are sealed into one immutable approval object. A sibling supplier cannot be awarded at the same time.</p></header>
                    <label>Approval reason<textarea value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} placeholder="Explain why this supplier should win the sourcing request." /></label>
                    <button type="button" disabled={gateActionState === "saving"} onClick={requestApproval}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <ShieldCheck size={14} />} Request award approval</button>
                  </>
                ) : currentCase.result.stage === "APPROVAL_PENDING" ? (
                  <>
                    <header><small>Approval pending</small><h4>Exact supplier and terms are locked</h4><p>A manager or admin must decide this scope. Editing the supplier or any gate cancels the pending approval.</p></header>
                    {canApproveProcurement ? <><label>Decision note<textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="Record the decision rationale." /></label><div className={styles.procurementDecisionActions}><button type="button" disabled={gateActionState === "saving"} onClick={() => decideApproval("APPROVE")}><Check size={14} /> Approve scope</button><button type="button" disabled={gateActionState === "saving"} onClick={() => decideApproval("REJECT")}><TriangleAlert size={14} /> Reject</button></div></> : <p className={styles.procurementPermissionNote}>Your role can view this request but cannot decide it.</p>}
                  </>
                ) : (
                  <>
                    <header>
                      <small>{purchaseReleaseState === "ACKNOWLEDGED" ? "Supplier acceptance complete" : purchaseReleaseState === "PARTIALLY_ACKNOWLEDGED" ? "Supplier acceptance open" : purchaseReleaseState === "RELEASED" ? "Awaiting supplier" : purchaseActionStatus === "APPROVED" ? "Purchase action authorized" : purchaseActionStatus === "PENDING" ? "Final approval pending" : "Purchase preparation"}</small>
                      <h4>{purchaseReleaseState === "ACKNOWLEDGED" ? "Supplier acknowledged" : purchaseReleaseState === "PARTIALLY_ACKNOWLEDGED" ? "Partial supplier acceptance" : purchaseReleaseState === "RELEASED" ? "Order released" : purchaseActionStatus === "APPROVED" ? "Approved to issue" : currentCase.purchaseDraft?.result ? "Order draft" : "Prepare the order"}</h4>
                      <p>{purchaseReleaseState === "RELEASED" ? "The exact authorized order is recorded as released and remains open until supplier acknowledgment is captured." : purchaseReleaseState ? "Supplier acceptance is recorded against the frozen order scope and its evidence." : purchaseActionStatus === "APPROVED" ? "The exact supplier, quantity, price, destination, and terms are frozen under an admin approval hash." : "Supplier and quote evidence come from the approved scope. Add the order fields that were not part of sourcing approval."}</p>
                    </header>
                    {currentCase.purchaseDraft?.result ? (
                      <dl className={styles.purchaseDraftSummary}>
                        <div><dt>Supplier</dt><dd>{currentCase.purchaseDraft.result.supplier.name}</dd></div>
                        <div><dt>Material subtotal</dt><dd>{formatMoney(currentCase.purchaseDraft.result.totals.materialSubtotal, currentCase.purchaseDraft.result.totals.currency)}</dd></div>
                        <div><dt>Quote</dt><dd>{currentCase.purchaseDraft.result.commercial.quoteReference}</dd></div>
                        <div><dt>Draft revision</dt><dd>{currentCase.purchaseDraft.result.revision}</dd></div>
                      </dl>
                    ) : null}
                    {purchaseActionStatus === "APPROVED" ? (
                      <>
                        <section className={styles.purchaseAuthorizationState}>
                          <ShieldCheck size={20} />
                          <div><strong>{purchaseReleaseState === "ACKNOWLEDGED" ? "Full quantity accepted" : purchaseReleaseState === "PARTIALLY_ACKNOWLEDGED" ? "Part of the order is accepted" : purchaseReleaseState === "RELEASED" ? "Waiting for supplier acknowledgment" : "Exact order scope authorized"}</strong><p>{purchaseReleaseState ? "Derya recorded an external supplier event and its evidence. It did not send the order, pay, book freight, or open Logistics." : "No supplier connector has executed it. No PO release, payment, booking, or Logistics record exists yet."}</p></div>
                        </section>
                        {purchaseReleaseResult ? (
                          <dl className={styles.purchaseDraftSummary}>
                            <div><dt>Ordered</dt><dd>{purchaseReleaseResult.orderedQuantity} {purchaseReleaseResult.unitOfMeasure}</dd></div>
                            <div><dt>Accepted</dt><dd>{purchaseReleaseResult.acknowledgedQuantity} {purchaseReleaseResult.unitOfMeasure}</dd></div>
                            <div><dt>Remaining</dt><dd>{purchaseReleaseResult.remainingQuantity} {purchaseReleaseResult.unitOfMeasure}</dd></div>
                            {purchaseReleaseResult.release ? <div><dt>PO reference</dt><dd>{purchaseReleaseResult.release.purchaseOrderReference}</dd></div> : <div><dt>Release record</dt><dd>Legacy combined record</dd></div>}
                            {purchaseReleaseResult.release ? <div><dt>Acknowledgment due</dt><dd>{displayStoredDate(purchaseReleaseResult.release.acknowledgmentDueOn)}</dd></div> : null}
                            {purchaseReleaseResult.release ? <div><dt>Release evidence</dt><dd><a href={evidenceHref(purchaseReleaseResult.release.evidenceId, purchaseReleaseResult.release.evidenceUrl)} target="_blank" rel="noreferrer">Open release</a></dd></div> : null}
                            {purchaseReleaseResult.lastAcknowledgment ? <div><dt>Last supplier reference</dt><dd>{purchaseReleaseResult.lastAcknowledgment.supplierOrderReference}</dd></div> : null}
                            {purchaseReleaseResult.lastAcknowledgment ? <div><dt>Acknowledgment evidence</dt><dd><a href={evidenceHref(purchaseReleaseResult.lastAcknowledgment.evidenceId, purchaseReleaseResult.lastAcknowledgment.evidenceUrl)} target="_blank" rel="noreferrer">Open acknowledgment</a></dd></div> : null}
                          </dl>
                        ) : null}
                        {!purchaseReleaseResult ? (
                          <section className={styles.purchaseApprovalRequest}>
                            <p><strong>Send through connected Gmail</strong></p>
                            <p>The exact authorized order, sender, recipient, subject, body, PO reference, and acknowledgment date are locked into a separate send approval.</p>
                            {senderAccounts.length ? (
                              <div className={styles.procurementFormGrid} data-draft-section="purchase-order-email-draft">
                                <label>From<select value={purchaseOrderEmailForm.senderAccountId} onChange={(event) => setPurchaseOrderEmailForm((current) => ({ ...current, senderAccountId: event.target.value }))}>{senderAccounts.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}</select></label>
                                <label>Supplier email<input type="email" value={purchaseOrderEmailForm.recipient} onChange={(event) => setPurchaseOrderEmailForm((current) => ({ ...current, recipient: event.target.value }))} placeholder="orders@supplier.com" /></label>
                                <label>PO reference<input value={purchaseOrderEmailForm.purchaseOrderReference} onChange={(event) => setPurchaseOrderEmailForm((current) => ({ ...current, purchaseOrderReference: event.target.value }))} placeholder="Buyer purchase order number" /></label>
                                <label>Acknowledgment due<input type="date" value={purchaseOrderEmailForm.acknowledgmentDueOn} onChange={(event) => setPurchaseOrderEmailForm((current) => ({ ...current, acknowledgmentDueOn: event.target.value }))} /></label>
                                <label className={styles.procurementWideField}>Subject<input value={purchaseOrderEmailForm.subject} onChange={(event) => setPurchaseOrderEmailForm((current) => ({ ...current, subject: event.target.value }))} /></label>
                                <label className={styles.procurementWideField}>Message<textarea value={purchaseOrderEmailForm.body} onChange={(event) => setPurchaseOrderEmailForm((current) => ({ ...current, body: event.target.value }))} /></label>
                                <label className={styles.procurementWideField}>Internal release note<textarea value={purchaseOrderEmailForm.note} onChange={(event) => setPurchaseOrderEmailForm((current) => ({ ...current, note: event.target.value }))} placeholder="Optional issuance context" /></label>
                              </div>
                            ) : <p>No connected Gmail sender is available for this office. Connect one or record another release channel below.</p>}
                            {senderAccounts.length ? <button type="button" disabled={gateActionState === "saving" || !purchaseOrderEmailFormComplete} onClick={savePurchaseOrderEmail}><Mail size={14} /> {currentCase.purchaseOrderEmailDraft ? "Save message revision" : "Save order email draft"}</button> : null}
                            {currentCase.purchaseOrderEmailDraft?.result && !currentCase.purchaseOrderEmailAction ? (
                              <>
                                <label data-draft-section="purchase-order-email-approval">Approval reason<textarea value={purchaseOrderEmailApprovalReason} onChange={(event) => setPurchaseOrderEmailApprovalReason(event.target.value)} /></label>
                                <button type="button" disabled={gateActionState === "saving" || !purchaseOrderEmailApprovalReason.trim()} onClick={requestPurchaseOrderEmailReview}><ShieldCheck size={14} /> Request send approval</button>
                              </>
                            ) : null}
                            {currentCase.purchaseOrderEmailAction?.approval?.status === "PENDING" ? (
                              canApproveProcurement ? (
                                <>
                                  <label data-draft-section="purchase-order-email-decision">Decision note<textarea value={purchaseOrderEmailDecisionNote} onChange={(event) => setPurchaseOrderEmailDecisionNote(event.target.value)} placeholder="Optional approval or rejection context" /></label>
                                  <div className={styles.purchaseDecisionActions}>
                                    <button type="button" disabled={gateActionState === "saving"} onClick={() => decidePurchaseOrderEmail("APPROVE")}><Check size={14} /> Approve exact email</button>
                                    <button type="button" disabled={gateActionState === "saving"} onClick={() => decidePurchaseOrderEmail("REJECT")}><TriangleAlert size={14} /> Reject</button>
                                  </div>
                                </>
                              ) : <p>Manager approval is pending for this exact purchase order email.</p>
                            ) : null}
                            {currentCase.purchaseOrderEmailAction?.approval?.status === "APPROVED" && (currentCase.purchaseOrderEmailAction.status === "READY" || ["RETRY_READY", "SEND_FAILED"].includes(currentCase.purchaseOrderEmailAction.result?.state ?? "")) ? (
                              <button type="button" disabled={gateActionState === "saving"} onClick={() => runPurchaseOrderEmailDelivery("SEND")}><ArrowRight size={14} /> {currentCase.purchaseOrderEmailAction.result?.state === "SEND_FAILED" ? "Retry rejected send" : "Send approved order"}</button>
                            ) : null}
                            {["SENDING", "DELIVERY_UNKNOWN"].includes(currentCase.purchaseOrderEmailAction?.result?.state ?? "") ? (
                              <>
                                <p>Gmail delivery is unresolved. Sending again is blocked until Derya checks the stable message ID.</p>
                                <button type="button" disabled={gateActionState === "saving"} onClick={() => runPurchaseOrderEmailDelivery("RECONCILE")}><RefreshCw size={14} /> Check Gmail delivery</button>
                              </>
                            ) : null}
                            {currentCase.purchaseOrderEmailAction?.result?.state === "NOT_FOUND_REVIEW_REQUIRED" ? (
                              <>
                                <p>Gmail did not find the order message. A manager must verify non-delivery before one new attempt is allowed.</p>
                                {canApproveProcurement ? <><label data-draft-section="purchase-order-email-recovery">Recovery note<textarea value={purchaseOrderEmailRecoveryNote} onChange={(event) => setPurchaseOrderEmailRecoveryNote(event.target.value)} placeholder="Explain how non-delivery was verified." /></label><button type="button" disabled={gateActionState === "saving" || purchaseOrderEmailRecoveryNote.trim().length < 10} onClick={() => runPurchaseOrderEmailDelivery("RESET")}><RefreshCw size={14} /> Confirm non-delivery and enable retry</button></> : null}
                              </>
                            ) : null}
                          </section>
                        ) : null}
                        {purchaseReleaseState === "ACKNOWLEDGED" ? (
                          <section className={styles.purchaseApprovalRequest}>
                            <p><strong>Ready for Logistics handoff</strong></p>
                            <p>The supplier evidence covers the full authorized quantity. The Logistics handoff is the next controlled step, but it has not been created.</p>
                          </section>
                        ) : !purchaseReleaseResult && canApproveProcurement ? (
                          <section className={styles.purchaseApprovalRequest} data-draft-section="purchase-release">
                            <p><strong>Record another release channel</strong></p>
                            <p>This creates the durable awaiting-supplier checkpoint. Use the exact PO reference and evidence from the channel where the authorized order was issued.</p>
                            <div className={styles.procurementFormGrid}>
                              <label>Release channel<select value={purchaseReleaseForm.channel} onChange={(event) => setPurchaseReleaseForm((current) => ({ ...current, channel: event.target.value as typeof current.channel }))}><option value="EMAIL">Email</option><option value="SUPPLIER_PORTAL">Supplier portal</option><option value="EDI">EDI</option><option value="PHONE_CONFIRMED">Phone confirmed</option><option value="OTHER">Other</option></select></label>
                              <label>Released on<input type="date" value={purchaseReleaseForm.releasedOn} onChange={(event) => setPurchaseReleaseForm((current) => ({ ...current, releasedOn: event.target.value }))} /></label>
                              <label>Acknowledgment due<input type="date" value={purchaseReleaseForm.acknowledgmentDueOn} onChange={(event) => setPurchaseReleaseForm((current) => ({ ...current, acknowledgmentDueOn: event.target.value }))} /></label>
                              <label>PO reference<input value={purchaseReleaseForm.purchaseOrderReference} onChange={(event) => setPurchaseReleaseForm((current) => ({ ...current, purchaseOrderReference: event.target.value }))} placeholder="Buyer purchase order number" /></label>
                              <label className={styles.procurementWideField}>Release evidence URL<input type="url" value={purchaseReleaseForm.evidenceUrl} onChange={(event) => setPurchaseReleaseForm((current) => ({ ...current, evidenceUrl: event.target.value }))} placeholder="https://..." /></label>
                              <label className={styles.procurementWideField}>Release note<textarea value={purchaseReleaseForm.note} onChange={(event) => setPurchaseReleaseForm((current) => ({ ...current, note: event.target.value }))} placeholder="Optional channel or issuance detail" /></label>
                            </div>
                            <button type="button" disabled={gateActionState === "saving" || !purchaseReleaseFormComplete} onClick={recordPurchaseRelease}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <PackageCheck size={14} />} Record order release</button>
                          </section>
                        ) : purchaseReleaseResult?.release && canApproveProcurement ? (
                          <section className={styles.purchaseApprovalRequest} data-draft-section="supplier-acknowledgment">
                            <p>Record supplier acceptance received outside Derya. Partial acceptances remain open until the full authorized quantity is covered.</p>
                            <div className={styles.procurementFormGrid}>
                              <label>Acknowledged on<input type="date" value={acknowledgmentForm.acknowledgedOn} onChange={(event) => setAcknowledgmentForm((current) => ({ ...current, acknowledgedOn: event.target.value }))} /></label>
                              <label>Accepted quantity<input type="number" min="0.01" step="0.01" value={acknowledgmentForm.acceptedQuantity} onChange={(event) => setAcknowledgmentForm((current) => ({ ...current, acceptedQuantity: event.target.value }))} /></label>
                              <label>Unit<input readOnly value={purchaseReleaseResult?.unitOfMeasure ?? currentCase.purchaseAction?.input.order.unitOfMeasure ?? "Unknown"} /></label>
                              <label>Confirmed delivery<input type="date" value={acknowledgmentForm.confirmedDeliveryDate} onChange={(event) => setAcknowledgmentForm((current) => ({ ...current, confirmedDeliveryDate: event.target.value }))} /></label>
                              <label className={styles.procurementWideField}>Supplier order reference<input value={acknowledgmentForm.supplierOrderReference} onChange={(event) => setAcknowledgmentForm((current) => ({ ...current, supplierOrderReference: event.target.value }))} placeholder="Supplier confirmation or order reference" /></label>
                              <label className={styles.procurementWideField}>Evidence URL<input type="url" value={acknowledgmentForm.evidenceUrl} onChange={(event) => setAcknowledgmentForm((current) => ({ ...current, evidenceUrl: event.target.value }))} placeholder="https://..." /></label>
                              <label className={styles.procurementWideField}>Note<textarea value={acknowledgmentForm.note} onChange={(event) => setAcknowledgmentForm((current) => ({ ...current, note: event.target.value }))} placeholder="Optional acceptance details or exceptions" /></label>
                            </div>
                            <button type="button" disabled={gateActionState === "saving" || !acknowledgmentFormComplete} onClick={recordSupplierAcknowledgment}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <PackageCheck size={14} />} Record supplier acknowledgment</button>
                          </section>
                        ) : purchaseReleaseResult && !purchaseReleaseResult.release ? (
                          <p className={styles.procurementActionError}><TriangleAlert size={14} /> This legacy order combined release and acknowledgment. Review the historical evidence and create a new procurement case before recording more supplier acceptance.</p>
                        ) : <p className={styles.procurementPermissionNote}>Your role can view supplier acceptance but cannot record it.</p>}
                      </>
                    ) : (
                      <>
                        <div className={styles.procurementFormGrid} data-draft-section="purchase-order">
                          <label>Quantity<input type="number" min="0.01" step="0.01" value={purchaseForm.quantity} onChange={(event) => setPurchaseForm((current) => ({ ...current, quantity: event.target.value }))} /></label>
                          <label>Approved unit<input readOnly value={currentCase.purchaseDraft?.result?.order.unitOfMeasure ?? currentCase.result.confirmedTerms?.unitOfMeasure ?? "Unknown"} /></label>
                          <label>Need by<input type="date" value={purchaseForm.needBy} onChange={(event) => setPurchaseForm((current) => ({ ...current, needBy: event.target.value }))} /></label>
                          <label>Incoterm<select value={purchaseForm.incoterm} onChange={(event) => setPurchaseForm((current) => ({ ...current, incoterm: event.target.value as typeof current.incoterm }))}><option value="EXW">EXW</option><option value="FCA">FCA</option><option value="FOB">FOB</option><option value="CPT">CPT</option><option value="CIP">CIP</option><option value="DAP">DAP</option><option value="DDP">DDP</option></select></label>
                          <label className={styles.procurementWideField}>Ship to<input value={purchaseForm.shipTo} onChange={(event) => setPurchaseForm((current) => ({ ...current, shipTo: event.target.value }))} placeholder="Facility and receiving location" /></label>
                          <label>Payment terms<input value={purchaseForm.paymentTerms} onChange={(event) => setPurchaseForm((current) => ({ ...current, paymentTerms: event.target.value }))} placeholder="For example, Net 30" /></label>
                          <label>Buyer reference<input value={purchaseForm.buyerReference} onChange={(event) => setPurchaseForm((current) => ({ ...current, buyerReference: event.target.value }))} placeholder="Optional internal reference" /></label>
                          <label className={styles.procurementWideField}>Buyer notes<textarea value={purchaseForm.notes} onChange={(event) => setPurchaseForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional receiving or packaging instructions" /></label>
                        </div>
                        <button type="button" disabled={gateActionState === "saving" || !purchaseFormComplete} onClick={savePurchaseDraft}>{gateActionState === "saving" ? <LoaderCircle size={14} className={styles.spin} /> : <PackageCheck size={14} />} {purchaseActionStatus === "PENDING" ? "Update draft and cancel pending approval" : currentCase.purchaseDraft?.result ? "Update order draft" : "Save order draft"}</button>
                        {purchaseActionStatus === "REJECTED" ? <p className={styles.procurementActionError}><TriangleAlert size={14} /> This exact order scope was rejected. Revise and save the draft before requesting approval again.</p> : null}
                        {currentCase.purchaseDraft?.result && !purchaseActionStatus ? (
                          <section className={styles.purchaseApprovalRequest} data-draft-section="purchase-approval">
                            <label>Final approval reason<textarea value={purchaseApprovalReason} onChange={(event) => setPurchaseApprovalReason(event.target.value)} placeholder="Explain why this exact order should be authorized for supplier execution." /></label>
                            <button type="button" disabled={gateActionState === "saving" || purchaseApprovalReason.trim().length === 0} onClick={requestPurchaseApproval}><ShieldCheck size={14} /> Request final admin approval</button>
                          </section>
                        ) : null}
                        {purchaseActionStatus === "PENDING" ? (
                          <section className={styles.purchaseApprovalRequest} data-draft-section="purchase-decision">
                            <p>The immutable purchase action is waiting for an admin. Editing and saving the draft cancels this request.</p>
                            {canAuthorizePurchase ? <><label>Authorization note<textarea value={purchaseDecisionNote} onChange={(event) => setPurchaseDecisionNote(event.target.value)} placeholder="Record why this exact order may or may not be issued." /></label><div className={styles.procurementDecisionActions}><button type="button" disabled={gateActionState === "saving"} onClick={() => decidePurchaseAction("APPROVE")}><Check size={14} /> Authorize exact order</button><button type="button" disabled={gateActionState === "saving"} onClick={() => decidePurchaseAction("REJECT")}><TriangleAlert size={14} /> Reject order</button></div></> : <p className={styles.procurementPermissionNote}>Only an admin can decide this final purchase action.</p>}
                          </section>
                        ) : null}
                        <p className={styles.procurementPermissionNote}>The draft and approval request remain internal. No PO number, supplier contact, payment, booking, or spend is created.</p>
                      </>
                    )}
                  </>
                )}
                {gateActionState === "error" ? <p className={styles.procurementActionError}><TriangleAlert size={14} /> {gateActionError}</p> : null}
              </section>
            ) : null}
            <p><ShieldCheck size={15} /> {purchaseReleaseState === "ACKNOWLEDGED" ? "Supplier evidence covers the full authorized quantity. Logistics handoff is next but has not been created." : purchaseReleaseState === "PARTIALLY_ACKNOWLEDGED" ? `${purchaseReleaseResult?.remainingQuantity} ${purchaseReleaseResult?.unitOfMeasure} remains open with the supplier.` : purchaseActionStatus === "APPROVED" ? "The exact order is authorized but has not been externally executed." : currentCase?.result?.stage === "PURCHASE_READY" ? "This scope is approved for purchase preparation. No purchase order, supplier contact, booking, or spend was created." : "Qualification, commercial terms, quality plan, and approval remain required. No purchase order, supplier contact, booking, or spend was created."}</p>
            <div className={styles.procurementCaseActions}>
              {!purchaseReleaseState ? <button type="button" onClick={() => setPhase("compare")}><ArrowLeft size={15} /> Review alternatives</button> : null}
              <button type="button" onClick={onBack}>Back to sourcing</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
