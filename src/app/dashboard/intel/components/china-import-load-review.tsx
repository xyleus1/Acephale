"use client";

import Link from "next/link";
import {
  useRef,
  useState,
  useTransition,
  type FocusEvent,
  type ReactNode,
} from "react";
import {
  CHINA_IMPORT_AGENCY_FEATURES,
  EMPTY_CHINA_HARDWARE_LOAD_INPUT,
  resolveIntelSourceUse,
  type ChinaHardwareLoadAssessmentV1,
  type ChinaHardwareLoadInputV1,
  type ChinaImportFieldBasis,
  type ChinaImportTriState,
} from "@/lib/intel";
import { Icon } from "@/components/icon";
import {
  analyzeChinaImportShipmentAction,
} from "../actions";
import { SourcesChip } from "./sources-chip";
import styles from "./china-import-load-review.module.css";

const EXAMPLE = `Shipment: CN-ROUTER-0726
Product: industrial edge router with Wi-Fi and LTE
Model: XR-500
Manufacturer: Shenzhen Example Networks Co.
Principal function: routes industrial network traffic
Intended use: factory automation gateway
Country of export: China
Claimed customs origin: China
Port of loading: Yantian
Port of unlading: Long Beach
Final delivery: Fremont, California
Container: 1 x 40HC
Gross weight: 8,400 kg
Invoice value: USD 285,000
Incoterm: FOB Yantian
Expected entry: 2026-07-31T10:00:00-04:00
Entry event: entry for consumption
Proposed HTS: 8517620090
Importer: Example Robotics, Inc.
Broker: Example Customs Brokerage
Contains lithium backup batteries and uses solid wood pallets.`;

const FIELD_LABELS: Record<string, string> = {
  shipmentReference: "Shipment reference",
  "route.countryOfExport": "Country of export",
  "route.customsCountryOfOrigin": "Customs country of origin",
  "route.portOfLoading": "Foreign port of loading",
  "route.portOfUnlading": "U.S. port of unlading",
  "route.finalDestination": "Final delivery",
  "route.containerType": "Container",
  "route.grossWeightKg": "Gross weight in kg",
  "route.incoterm": "Incoterm",
  "timing.entryAt": "Entry or warehouse-withdrawal time",
  "timing.entryEvent": "Controlling customs event",
  "timing.expectedEntryAt": "Expected entry time",
  "timing.actualEntryAt": "Actual entry time",
  "timing.loadedOnVesselAtPortOfLoadingAt":
    "Loaded on vessel at port of loading",
  "timing.finalModeTransitStartedAt": "Final-mode transit start",
  "product.description": "Product description",
  "product.model": "Model",
  "product.manufacturer": "Manufacturer",
  "product.principalFunction": "Principal function",
  "product.intendedUse": "Intended use",
  "product.marketingClaims": "Marketing and performance claims",
  "product.proposedHts10": "Proposed 10-digit HTS",
  "product.classificationStatus": "Classification review status",
  "product.tariffStackReviewStatus": "Tariff-stack review",
  "origin.manufacturingLocations": "Manufacturing locations",
  "origin.transformationSummary": "Manufacturing and transformation summary",
  "origin.markingDescription": "Country-of-origin marking",
  "origin.reviewStatus": "Origin and marking review",
  "valuation.invoiceValue": "Commercial invoice value",
  "valuation.currency": "Invoice currency",
  "valuation.relatedParty": "Related-party sale",
  "valuation.internationalFreightIncluded":
    "International freight included",
  "valuation.insuranceIncluded": "Insurance included",
  "valuation.additionsReviewStatus": "Valuation additions review",
  "parties.importerOfRecord": "Importer of record",
  "parties.importerNumberAvailable": "Importer number available",
  "parties.customsBroker": "Customs broker",
  "parties.powerOfAttorneyReady": "Broker power of attorney",
  "parties.bondReady": "Import bond",
  "parties.seller": "Seller",
  "parties.buyer": "Buyer",
  "parties.consignee": "Consignee",
  "parties.ultimateConsignee": "Ultimate consignee",
  "forcedLabor.supplierIdentitiesComplete":
    "Direct supplier identities",
  "forcedLabor.subSupplierIdentitiesComplete":
    "Sub-supplier identities",
  "forcedLabor.facilityAddressesComplete":
    "Production facility addresses",
  "forcedLabor.billOfMaterialsTraceable":
    "Bill of materials traceability",
  "forcedLabor.productionAndTransactionRecordsAvailable":
    "Production and transaction records",
  "forcedLabor.uflpaEntityScreenCompleted": "UFLPA entity screen",
  "oceanFiling.isfFiler": "ISF filer",
  "oceanFiling.isfFiledAt": "ISF filed time",
  "oceanFiling.containerStuffingLocation":
    "Container stuffing location",
  "oceanFiling.consolidator": "Consolidator",
  "oceanFiling.invoiceAvailable": "Commercial invoice available",
  "oceanFiling.packingListAvailable": "Packing list available",
  "oceanFiling.billOfLadingAvailable": "Bill of lading available",
};

function pathLabel(path: string): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  if (path.startsWith("agencyScreens.")) {
    const feature = CHINA_IMPORT_AGENCY_FEATURES.find(
      (candidate) =>
        `agencyScreens.${candidate.id}` === path
    );
    if (feature) return feature.label;
  }
  return path
    .split(".")
    .at(-1)!
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function basisLabel(basis: ChinaImportFieldBasis): string {
  switch (basis) {
    case "operator_confirmed":
      return "Confirmed";
    case "document":
      return "Document";
    case "ai_extracted":
      return "AI draft";
    case "supplier_statement":
      return "Source text";
    default:
      return "Unverified";
  }
}

function formatTimestamp(value: string | null): string {
  if (!value) return "No timestamp";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}, time and zone missing`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  }).format(date);
}

function formatRuleTimestamp(value: string | null): string {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const eastern = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(date);
  return `${eastern} (${value})`;
}

function formatRuleDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return `${value}, source gives date only`;
  const [, year, month, day] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day))
  );
  const readable = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  return `${readable}, source gives date only`;
}

function formatRuleBoundary(
  exactValue: string | null,
  dateValue: string | null,
  missingLabel: string
): string {
  if (exactValue) return formatRuleTimestamp(exactValue);
  if (dateValue) return formatRuleDate(dateValue);
  return missingLabel;
}

function readinessLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) =>
    letter.toUpperCase()
  );
}

function authorityStatusLabel(
  status: ChinaHardwareLoadAssessmentV1["authorities"][number]["status"]
): string {
  switch (status) {
    case "historical_reference":
      return "Historical";
    case "time_limited":
      return "Time-limited";
    case "upcoming":
      return "Upcoming";
    default:
      return "Current";
  }
}

function formatAuthorityDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatRuleDate(value).replace(", source gives date only", "");
  }
  return formatRuleTimestamp(value);
}

function authorityEffectiveWindow(
  authority: ChinaHardwareLoadAssessmentV1["authorities"][number]
): string {
  if (!authority.effectiveFrom && !authority.effectiveTo) {
    return "No fixed effective window published";
  }
  if (authority.effectiveFrom && authority.effectiveTo) {
    return `${formatAuthorityDate(authority.effectiveFrom)} through ${formatAuthorityDate(authority.effectiveTo)}`;
  }
  if (authority.effectiveFrom) {
    return `Effective ${formatAuthorityDate(authority.effectiveFrom)}; no published end`;
  }
  return `No published start; through ${formatAuthorityDate(authority.effectiveTo!)}`;
}

function cloneInput(
  input: ChinaHardwareLoadInputV1
): ChinaHardwareLoadInputV1 {
  return structuredClone(input);
}

function setPath(
  input: ChinaHardwareLoadInputV1,
  path: string,
  value: unknown
): ChinaHardwareLoadInputV1 {
  const next = cloneInput(input);
  const parts = path.split(".");
  let target = next as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = value;
  const populated =
    value != null &&
    value !== "" &&
    value !== "unknown" &&
    (!Array.isArray(value) || value.length > 0);
  if (populated) {
    next.fieldProvenance[path] = {
      basis: "operator_confirmed",
      evidenceIds: [],
    };
  } else {
    delete next.fieldProvenance[path];
  }
  return next;
}

function getPathValue(
  input: ChinaHardwareLoadInputV1,
  path: string
): unknown {
  let value: unknown = input;
  for (const part of path.split(".")) {
    if (value == null || typeof value !== "object") return null;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function hasReviewableValue(value: unknown): boolean {
  return (
    value != null &&
    value !== "" &&
    value !== "unknown" &&
    (!Array.isArray(value) || value.length > 0)
  );
}

function reviewableSourcePaths(
  input: ChinaHardwareLoadInputV1 | null
): string[] {
  if (!input) return [];
  return Object.entries(input.fieldProvenance)
    .filter(
      ([path, provenance]) =>
        (provenance.basis === "ai_extracted" ||
          provenance.basis === "supplier_statement") &&
        hasReviewableValue(getPathValue(input, path))
    )
    .map(([path]) => path)
    .sort();
}

type QuestionGroup = {
  key: "mert" | "supplier" | "broker" | "other";
  label: string;
  questions: string[];
};

function groupQuestions(questions: readonly string[]): QuestionGroup[] {
  const groups: QuestionGroup[] = [
    { key: "mert", label: "Mert", questions: [] },
    { key: "supplier", label: "Supplier", questions: [] },
    { key: "broker", label: "Broker / importer", questions: [] },
    { key: "other", label: "Other", questions: [] },
  ];
  const prefixes = [
    { prefix: "Mert:", group: groups[0] },
    { prefix: "Supplier:", group: groups[1] },
    { prefix: "Broker/importer:", group: groups[2] },
  ];

  for (const question of questions) {
    const match = prefixes.find(({ prefix }) =>
      question.startsWith(prefix)
    );
    if (!match) {
      groups[3].questions.push(question);
      continue;
    }
    const body = question.slice(match.prefix.length).trim();
    match.group.questions.push(body || question);
  }

  return groups.filter((group) => group.questions.length > 0);
}

function FieldShell({
  inputId,
  label,
  basis,
  helper,
  canConfirm,
  onConfirm,
  children,
}: {
  inputId: string;
  label: string;
  basis: ChinaImportFieldBasis;
  helper?: string;
  canConfirm?: boolean;
  onConfirm?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabelRow}>
        <label htmlFor={inputId}>{label}</label>
        <span className={styles.fieldBasis}>
          <small data-basis={basis}>{basisLabel(basis)}</small>
          {canConfirm && onConfirm ? (
            <button
              type="button"
              aria-label={`Confirm ${label}`}
              onClick={onConfirm}
            >
              Confirm
            </button>
          ) : null}
        </span>
      </span>
      {children}
      {helper ? <span className={styles.fieldHelper}>{helper}</span> : null}
    </div>
  );
}

function TextField({
  path,
  value,
  basis,
  placeholder,
  helper,
  multiline = false,
  onCommit,
}: {
  path: string;
  value: string | null;
  basis: ChinaImportFieldBasis;
  placeholder?: string;
  helper?: string;
  multiline?: boolean;
  onCommit: (path: string, value: string | null) => void;
}) {
  const inputId = `china-load-${path.replaceAll(".", "-")}`;
  const canConfirm =
    value != null &&
    value !== "" &&
    basis !== "operator_confirmed" &&
    basis !== "document";
  const common = {
    defaultValue: value ?? "",
    placeholder,
    onBlur: (
      event:
        | FocusEvent<HTMLInputElement>
        | FocusEvent<HTMLTextAreaElement>
    ) => {
      const nextValue = event.currentTarget.value.trim() || null;
      if (nextValue !== value) onCommit(path, nextValue);
    },
  };
  return (
    <FieldShell
      inputId={inputId}
      label={pathLabel(path)}
      basis={basis}
      helper={helper}
      canConfirm={canConfirm}
      onConfirm={() => onCommit(path, value)}
    >
      {multiline ? (
        <textarea
          key={`${path}:${value ?? ""}`}
          id={inputId}
          className={styles.textarea}
          rows={3}
          {...common}
        />
      ) : (
        <input
          key={`${path}:${value ?? ""}`}
          id={inputId}
          className={styles.input}
          type="text"
          {...common}
        />
      )}
    </FieldShell>
  );
}

function NumberField({
  path,
  value,
  basis,
  placeholder,
  onCommit,
}: {
  path: string;
  value: number | null;
  basis: ChinaImportFieldBasis;
  placeholder?: string;
  onCommit: (path: string, value: number | null) => void;
}) {
  const inputId = `china-load-${path.replaceAll(".", "-")}`;
  const canConfirm =
    value != null &&
    basis !== "operator_confirmed" &&
    basis !== "document";
  return (
    <FieldShell
      inputId={inputId}
      label={pathLabel(path)}
      basis={basis}
      canConfirm={canConfirm}
      onConfirm={() => onCommit(path, value)}
    >
      <input
        id={inputId}
        key={`${path}:${value ?? ""}`}
        className={styles.input}
        type="number"
        min="0"
        step="any"
        defaultValue={value ?? ""}
        placeholder={placeholder}
        onBlur={(event) => {
          const parsed = event.currentTarget.value.trim()
            ? Number(event.currentTarget.value)
            : null;
          const nextValue =
            parsed != null && Number.isFinite(parsed) && parsed >= 0
              ? parsed
              : null;
          if (nextValue !== value) onCommit(path, nextValue);
        }}
      />
    </FieldShell>
  );
}

function SelectField({
  path,
  value,
  basis,
  options,
  onCommit,
}: {
  path: string;
  value: string;
  basis: ChinaImportFieldBasis;
  options: ReadonlyArray<{ value: string; label: string }>;
  onCommit: (path: string, value: string) => void;
}) {
  const inputId = `china-load-${path.replaceAll(".", "-")}`;
  const canConfirm =
    value !== "unknown" &&
    basis !== "operator_confirmed" &&
    basis !== "document";
  return (
    <FieldShell
      inputId={inputId}
      label={pathLabel(path)}
      basis={basis}
      canConfirm={canConfirm}
      onConfirm={() => onCommit(path, value)}
    >
      <select
        id={inputId}
        className={styles.select}
        value={value}
        onChange={(event) => onCommit(path, event.target.value)}
      >
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

const TRI_STATE_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

const REVIEW_STATE_OPTIONS = [
  { value: "unknown", label: "Not reviewed" },
  { value: "in_progress", label: "In progress" },
  { value: "ready", label: "Reviewed, evidence ready" },
] as const;

function ReportSection({
  id,
  order,
  kind = "report",
  eyebrow,
  title,
  description,
  children,
}: {
  id?: string;
  order: number;
  kind?: "report" | "editor";
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`${styles.reportSection}${
        kind === "editor" ? ` ${styles.editorSection}` : ""
      }`}
      style={{ order }}
    >
      <div className={styles.sectionHeading}>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function FieldPathList({
  paths,
  empty,
}: {
  paths: readonly string[];
  empty: string;
}) {
  if (paths.length === 0) {
    return <p className={styles.emptyList}>{empty}</p>;
  }
  return (
    <ul className={styles.pathList}>
      {paths.map((path) => (
        <li key={path}>{pathLabel(path)}</li>
      ))}
    </ul>
  );
}

export function ChinaImportLoadReview() {
  const [sourceText, setSourceText] = useState("");
  const [fields, setFields] =
    useState<ChinaHardwareLoadInputV1 | null>(null);
  const [assessment, setAssessment] =
    useState<ChinaHardwareLoadAssessmentV1 | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportOutdated, setReportOutdated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedReviewPaths, setSelectedReviewPaths] = useState<string[]>(
    []
  );
  const [pending, startTransition] = useTransition();
  const requestSequence = useRef(0);

  function acceptResult(
    result: Awaited<
      ReturnType<typeof analyzeChinaImportShipmentAction>
    >
  ): boolean {
    if ("error" in result) {
      setError(result.error);
      return false;
    }
    setFields(result.fields);
    setAssessment(result.assessment);
    setNote(result.note);
    return true;
  }

  function analyzeText() {
    if (!sourceText.trim() || pending) return;
    if (
      fields &&
      !window.confirm(
        "Build a new report and replace the current in-memory review?"
      )
    ) {
      return;
    }
    const requestId = ++requestSequence.current;
    setSelectedReviewPaths([]);
    setReportOutdated(true);
    setEditorOpen(false);
    startTransition(async () => {
      setError(null);
      try {
        const result = await analyzeChinaImportShipmentAction({
          text: sourceText,
        });
        if (requestId !== requestSequence.current) return;
        setReportOutdated(!acceptResult(result));
      } catch {
        if (requestId === requestSequence.current) {
          setReportOutdated(true);
          setError(
            "The shipment report could not be built. No shipment data was saved."
          );
        }
      }
    });
  }

  function reviewShipment(next: ChinaHardwareLoadInputV1) {
    const requestId = ++requestSequence.current;
    setFields(next);
    setReportOutdated(true);
    startTransition(async () => {
      setError(null);
      try {
        const result = await analyzeChinaImportShipmentAction({
          shipment: next,
        });
        if (requestId !== requestSequence.current) return;
        setReportOutdated(!acceptResult(result));
      } catch {
        if (requestId === requestSequence.current) {
          setReportOutdated(true);
          setError(
            "The shipment report could not be rebuilt. No shipment data was saved."
          );
        }
      }
    });
  }

  function startBlank() {
    if (
      fields &&
      !window.confirm(
        "Reset this review? All in-memory confirmations and edits will be lost."
      )
    ) {
      return;
    }
    const blank = cloneInput(EMPTY_CHINA_HARDWARE_LOAD_INPUT);
    setSelectedReviewPaths([]);
    setEditorOpen(true);
    reviewShipment(blank);
  }

  function commit(path: string, value: unknown) {
    if (!fields) return;
    setSelectedReviewPaths([]);
    reviewShipment(setPath(fields, path, value));
  }

  function confirmSelectedPaths() {
    if (!fields || pending) return;
    const eligiblePaths = reviewableSourcePaths(fields).filter((path) =>
      selectedReviewPaths.includes(path)
    );
    if (eligiblePaths.length === 0) return;

    const next = cloneInput(fields);
    for (const path of eligiblePaths) {
      next.fieldProvenance[path] = {
        basis: "operator_confirmed",
        evidenceIds: [],
      };
    }
    setSelectedReviewPaths([]);
    reviewShipment(next);
  }

  function toggleReviewPath(path: string) {
    setSelectedReviewPaths((current) =>
      current.includes(path)
        ? current.filter((candidate) => candidate !== path)
        : [...current, path]
    );
  }

  function toggleAllReviewPaths() {
    const reviewablePaths = reviewableSourcePaths(fields);
    const allSelected = reviewablePaths.every((path) =>
      selectedReviewPaths.includes(path)
    );
    setSelectedReviewPaths(allSelected ? [] : reviewablePaths);
  }

  async function copyQuestions() {
    if (!assessment) return;
    const body = assessment.nextQuestions
      .map((question, index) => `${index + 1}. ${question}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("The questions could not be copied. Print the report instead.");
    }
  }

  function openEditor() {
    setEditorOpen(true);
    window.requestAnimationFrame(() => {
      document
        .getElementById("review-load-fields")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const basis = (path: string) =>
    fields?.fieldProvenance[path]?.basis ?? "unknown";
  const triggeredScreens =
    assessment?.agencyScreens.filter(
      (screen) => screen.state === "triggered"
    ) ?? [];
  const unresolvedScreens =
    assessment?.agencyScreens.filter(
      (screen) => screen.state === "unresolved"
    ) ?? [];
  const closedScreens =
    assessment?.agencyScreens.filter(
      (screen) =>
        screen.state === "not_indicated_by_confirmed_facts"
    ) ?? [];
  const resolvedAuthorities =
    assessment?.authorities.map((authority) => ({
      ...authority,
      resolvedSource: resolveIntelSourceUse(authority.source),
    })) ?? [];
  const reviewablePaths = reviewableSourcePaths(fields);
  const selectedEligiblePaths = reviewablePaths.filter((path) =>
    selectedReviewPaths.includes(path)
  );
  const allReviewableSelected =
    reviewablePaths.length > 0 &&
    selectedEligiblePaths.length === reviewablePaths.length;
  const questionGroups = groupQuestions(assessment?.nextQuestions ?? []);
  const extractionMode = note?.includes("parsed locally")
    ? "local_fallback"
    : note?.includes("AI drafted")
      ? "ai_draft"
      : "notice";

  return (
    <article className={styles.shell}>
      <header className={styles.hero}>
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroTopline}>
          <Link href="/dashboard/intel" className={styles.backLink}>
            <Icon name="arrow-left" size={14} />
            China corridor watch
          </Link>
          <span className={styles.readOnlyBadge}>
            Read-only, no RFQ or shipment write
          </span>
        </div>
        <div className={styles.heroCopy}>
          <p>Shipment report 01</p>
          <h1>Review one China hardware import</h1>
          <span>
            Paste what you have, confirm the extracted facts, and get
            a fixed customs-readiness report. This does not calculate
            duty or promise clearance.
          </span>
        </div>
        <div className={styles.heroRail}>
          <div>
            <span>Scope</span>
            <strong>China origin to U.S., ocean</strong>
          </div>
          <div>
            <span>Output</span>
            <strong>8 customs gates + 12 product screens</strong>
          </div>
          <div>
            <span>Persistence</span>
            <strong>Nothing saved from this review</strong>
          </div>
        </div>
      </header>

      <div className={styles.paper}>
        <section className={styles.intake} aria-labelledby="load-intake-title">
          <div className={styles.intakeHeading}>
            <div>
              <span>Step 1</span>
              <h2 id="load-intake-title">Paste the shipment brief</h2>
              <p>
                Include the product, model, ports, container,
                Incoterm, value, proposed HTS, entry timing,
                importer, broker, batteries, radio features, and
                packaging if known.
              </p>
            </div>
            <div className={styles.privacyNote}>
              <Icon name="shield" size={14} />
              If AI extraction is configured, pasted text is sent to
              OpenAI GPT-5.6 to draft fields. If it fails, only
              explicitly labeled lines are parsed locally.
              This page does not persist the text or assessment.
            </div>
          </div>
          <label className={styles.sourceLabel} htmlFor="china-load-brief">
            Shipment brief
          </label>
          <textarea
            id="china-load-brief"
            className={styles.sourceText}
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder={EXAMPLE}
            maxLength={12000}
            rows={10}
          />
          <div className={styles.intakeActions}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!sourceText.trim() || pending}
              onClick={analyzeText}
            >
              <Icon name="zap" size={15} />
              {pending ? "Building report..." : "Build shipment report"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={pending}
              onClick={startBlank}
            >
              {fields ? "Reset review" : "Start blank review"}
            </button>
            <span>
              Tip: up to 12,000 characters. Do not paste credentials or
              portal links.
            </span>
          </div>
          {error ? (
            <div className={styles.error} role="alert">
              {error}
            </div>
          ) : null}
          {note ? (
            <div
              className={styles.note}
              data-mode={extractionMode}
              role="status"
            >
              <Icon
                name={extractionMode === "local_fallback" ? "alert" : "check"}
                size={16}
              />
              <div>
                <strong>
                  {extractionMode === "local_fallback"
                    ? "Local fallback extraction used"
                    : extractionMode === "ai_draft"
                      ? "AI extraction draft ready"
                      : "Extraction status"}
                </strong>
                <p>{note}</p>
              </div>
            </div>
          ) : null}
        </section>

        {fields && assessment ? (
          <div
            className={styles.report}
            aria-busy={pending || reportOutdated}
            data-outdated={reportOutdated ? "true" : "false"}
          >
            <section className={styles.decisionHeader}>
              <div className={styles.decisionCopy}>
                <span
                  aria-live="polite"
                  data-state={assessment.executiveDecision.state}
                  className={styles.decisionState}
                >
                  {readinessLabel(
                    assessment.executiveDecision.state
                  )}
                </span>
                <h2>{assessment.executiveDecision.summary}</h2>
                <p>
                  Assessed {formatTimestamp(assessment.assessedAt)}.
                  Source rules reviewed{" "}
                  {formatTimestamp(
                    assessment.rulesSnapshot.rulesReviewedAt
                  )}.
                </p>
              </div>
              {!assessment.scope.supported ? (
                <div className={styles.scopeAlert} role="alert">
                  <strong>This packet is outside the supported scope</strong>
                  <ul>
                    {assessment.scope.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <SourcesChip
                sources={assessment.sources}
                label="Official sources"
                comfortable
              />
              <div className={styles.readinessGrid}>
                <div>
                  <span>Freight quote</span>
                  <strong
                    data-readiness={assessment.readiness.freightQuote}
                  >
                    {readinessLabel(
                      assessment.readiness.freightQuote
                    )}
                  </strong>
                  <small>
                    Freight scope only. Rates and schedules are not
                    connected here.
                  </small>
                </div>
                <div>
                  <span>Landed cost</span>
                  <strong
                    data-readiness={assessment.readiness.landedCost}
                  >
                    {readinessLabel(
                      assessment.readiness.landedCost
                    )}
                  </strong>
                  <small>
                    Requires exact classification, origin, value,
                    entry date, and current authority.
                  </small>
                </div>
                <div>
                  <span>Clearance commitment</span>
                  <strong
                    data-readiness={
                      assessment.readiness.clearanceCommitment
                    }
                  >
                    {readinessLabel(
                      assessment.readiness.clearanceCommitment
                    )}
                  </strong>
                  <small>
                    Product agencies, UFLPA, importer, and filing
                    evidence still control.
                  </small>
                </div>
              </div>
            </section>

            <nav className={styles.reportNav} aria-label="Shipment report">
              <a href="#load-facts">01 Facts</a>
              <a href="#load-timing">02 Timing</a>
              <a href="#load-gates">03 Gates</a>
              <a href="#load-agencies">04 Agencies</a>
              <a href="#load-questions">05 Questions</a>
              <a href="#load-sources">06 Sources</a>
              <button type="button" onClick={openEditor}>
                <Icon name="list" size={13} />
                Review inputs
              </button>
              <button type="button" onClick={() => window.print()}>
                <Icon name="file" size={13} />
                Print
              </button>
              <button type="button" onClick={copyQuestions}>
                <Icon name="copy" size={13} />
                {copied ? "Copied" : "Copy questions"}
              </button>
            </nav>

            {reportOutdated ? (
              <div className={styles.updateAlert} role="status">
                <Icon name="activity" size={17} />
                <div>
                  <strong>
                    {pending
                      ? "Updating the report"
                      : "The report is out of date"}
                  </strong>
                  <p>
                    Do not use the findings below until the latest field
                    change has been rebuilt successfully.
                  </p>
                </div>
              </div>
            ) : null}

            {assessment.rulesSnapshot.freshness !==
            "current_for_assessment" ? (
              <div className={styles.staleAlert} role="alert">
                <Icon name="alert" size={18} />
                <div>
                  <strong>
                    Time-sensitive rule boundary crossed after the
                    source review
                  </strong>
                  <p>
                    The July 24 tariff boundary has passed. This
                    assessment recomputes timing from the shipment
                    timestamp, but landed-cost and clearance outputs
                    stay blocked until the current HTS and official
                    actions are revalidated.
                  </p>
                </div>
              </div>
            ) : null}

            <ReportSection
              id="load-facts"
              order={10}
              eyebrow="Report 01"
              title="Facts requiring action"
              description="The report separates missing facts from source-text or AI drafts and operator-confirmed facts."
            >
              <div className={styles.factReviewGrid}>
                <div data-kind="missing">
                  <span>Missing critical</span>
                  <strong>
                    {
                      assessment.inputReview
                        .missingCriticalFieldPaths.length
                    }
                  </strong>
                  <FieldPathList
                    paths={
                      assessment.inputReview
                        .missingCriticalFieldPaths
                    }
                    empty="No critical fields missing."
                  />
                </div>
                <div data-kind="draft">
                  <span>Source or AI draft</span>
                  <strong>
                    {
                      assessment.inputReview
                        .unconfirmedFieldPaths.length
                    }
                  </strong>
                  <FieldPathList
                    paths={
                      assessment.inputReview
                        .unconfirmedFieldPaths
                    }
                    empty="No populated critical fields await confirmation."
                  />
                </div>
                <div data-kind="confirmed">
                  <span>Confirmed facts</span>
                  <strong>
                    {
                      assessment.inputReview.confirmedFieldPaths
                        .length
                    }
                  </strong>
                  <FieldPathList
                    paths={assessment.inputReview.confirmedFieldPaths}
                    empty="No fields confirmed yet."
                  />
                </div>
              </div>
              {assessment.inputReview.boundaryAmbiguities.map(
                (ambiguity) => (
                  <div className={styles.boundaryAlert} key={ambiguity}>
                    {ambiguity}
                  </div>
                )
              )}
            </ReportSection>

            <ReportSection
              id="load-timing"
              order={11}
              eyebrow="Report 02"
              title="Date-sensitive actions"
              description="States are recomputed from the shipment entry timestamp, not copied from the older report snapshot."
            >
              <div className={styles.temporalList}>
                {assessment.timeSensitiveActions.map((action) => (
                  <article
                    className={styles.temporalCard}
                    data-state={action.temporalStateAtEntry}
                    key={action.ruleId}
                  >
                    <div className={styles.cardTopline}>
                      <span>
                        {readinessLabel(
                          action.temporalStateAtEntry
                        )}
                      </span>
                      <SourcesChip sources={action.sources} comfortable />
                    </div>
                    <h3>{action.title}</h3>
                    <p>{action.action}</p>
                    <dl>
                      <div>
                        <dt>Start</dt>
                        <dd>
                          {formatRuleBoundary(
                            action.exactStartAt,
                            action.effectiveDate,
                            "No published start"
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>End</dt>
                        <dd>
                          {formatRuleBoundary(
                            action.exactEndAt,
                            action.effectiveToDate,
                            "No published end"
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Shipment state</dt>
                        <dd>
                          {readinessLabel(action.applicability)}
                        </dd>
                      </div>
                    </dl>
                    {action.missingFacts.length > 0 ? (
                      <div className={styles.cardMissing}>
                        <strong>Still needed</strong>
                        <ul>
                          {action.missingFacts.map((fact) => (
                            <li key={fact}>{fact}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </ReportSection>

            <ReportSection
              id="load-gates"
              order={12}
              eyebrow="Report 03"
              title="Eight customs gates"
              description="A ready gate means the evidence packet is structured for review. It is not a legal or filing conclusion."
            >
              <div className={styles.gateList}>
                {assessment.customsGates.map((gate) => (
                  <article
                    className={styles.gateCard}
                    data-state={gate.state}
                    key={gate.gateId}
                  >
                    <div className={styles.gateNumber}>
                      {String(gate.sequence).padStart(2, "0")}
                    </div>
                    <div className={styles.gateBody}>
                      <div className={styles.cardTopline}>
                        <span>{readinessLabel(gate.state)}</span>
                        <small>
                          {readinessLabel(gate.stage)}
                        </small>
                        <SourcesChip sources={gate.sources} comfortable />
                      </div>
                      <h3>{gate.title}</h3>
                      <p>{gate.action}</p>
                      {gate.issues.length > 0 ? (
                        <ul className={styles.gateIssues}>
                          {gate.issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      ) : null}
                      {gate.missingFieldPaths.length > 0 ||
                      gate.unconfirmedFieldPaths.length > 0 ? (
                        <div className={styles.gateGaps}>
                          {gate.missingFieldPaths.length > 0 ? (
                            <div>
                              <strong>Missing</strong>
                              <FieldPathList
                                paths={gate.missingFieldPaths}
                                empty=""
                              />
                            </div>
                          ) : null}
                          {gate.unconfirmedFieldPaths.length > 0 ? (
                            <div>
                              <strong>Needs confirmation</strong>
                              <FieldPathList
                                paths={gate.unconfirmedFieldPaths}
                                empty=""
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </ReportSection>

            <ReportSection
              id="load-agencies"
              order={13}
              eyebrow="Report 04"
              title="Product and agency screens"
              description={`${triggeredScreens.length} triggered, ${unresolvedScreens.length} unresolved, ${closedScreens.length} closed by confirmed facts.`}
            >
              <div className={styles.agencyList}>
                {[...triggeredScreens, ...unresolvedScreens].map(
                  (screen) => (
                    <article
                      className={styles.agencyCard}
                      data-state={screen.state}
                      key={screen.featureId}
                    >
                      <div className={styles.cardTopline}>
                        <span>{screen.agency}</span>
                        <strong>
                          {readinessLabel(screen.state)}
                        </strong>
                        <SourcesChip sources={screen.sources} comfortable />
                      </div>
                      <h3>{screen.label}</h3>
                      <p>{screen.action}</p>
                      {screen.requiredEvidence.length > 0 ? (
                        <ul>
                          {screen.requiredEvidence.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  )
                )}
              </div>
              {closedScreens.length > 0 ? (
                <details className={styles.closedScreens}>
                  <summary>
                    Show {closedScreens.length} screens closed by
                    confirmed facts
                  </summary>
                  <ul>
                    {closedScreens.map((screen) => (
                      <li key={screen.featureId}>
                        <strong>{screen.agency}</strong>{" "}
                        {screen.label}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </ReportSection>

            <ReportSection
              id="load-questions"
              order={14}
              eyebrow="Report 05"
              title="Questions to send now"
              description="Use the owner groups below as the request list. Copy questions keeps the complete list in one message."
            >
              <div className={styles.questionGroups}>
                {questionGroups.map((group) => (
                  <section
                    className={styles.questionGroup}
                    data-owner={group.key}
                    key={group.key}
                  >
                    <div className={styles.questionGroupHeading}>
                      <span>{group.label}</span>
                      <strong>{group.questions.length}</strong>
                    </div>
                    <ol className={styles.questionList}>
                      {group.questions.map((question, index) => (
                        <li key={`${group.key}:${index}:${question}`}>
                          {question}
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            </ReportSection>

            <ReportSection
              id="load-sources"
              order={15}
              eyebrow="Report 06"
              title="Official source ledger"
              description="Open the exact authority used by this assessment. Review dates describe Derya's source check, not an evergreen legal conclusion."
            >
              <details className={styles.sourceLedgerDetails}>
                <summary>
                  Show {resolvedAuthorities.length} cited authorities
                  <span>Open ledger</span>
                </summary>
                <div className={styles.sourceLedger}>
                  {resolvedAuthorities.map((authority, index) => (
                    <article
                      data-authority-status={authority.status}
                      key={authority.authorityId}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <div className={styles.authorityLedgerMeta}>
                          <strong data-status={authority.status}>
                            {authorityStatusLabel(authority.status)}
                          </strong>
                          <span>{readinessLabel(authority.kind)}</span>
                        </div>
                        <a
                          href={authority.resolvedSource.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {authority.label}
                          <Icon name="external" size={12} />
                        </a>
                        <p className={styles.authoritySourceIdentity}>
                          {authority.resolvedSource.displayName ??
                            authority.resolvedSource.name}
                          {" · "}
                          {authority.resolvedSource.publisher}
                        </p>
                        <small className={styles.authoritySourceProvenance}>
                          {authorityEffectiveWindow(authority)}. Source as
                          of{" "}
                          {authority.resolvedSource.asOf ??
                            "not published"}
                          . Reviewed{" "}
                          {authority.resolvedSource.reviewedAt?.slice(0, 10) ??
                            "date unavailable"}.
                        </small>
                        <p className={styles.authorityCaveat}>
                          {authority.caveat}
                        </p>
                        <div className={styles.authorityClaims}>
                          <strong>Used by</strong>
                          <div>
                            {authority.claimContexts.map((claim) => (
                              <span
                                data-kind={claim.kind}
                                key={`${claim.kind}:${claim.id}`}
                              >
                                {claim.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            </ReportSection>

            <details
              className={styles.editorDisclosure}
              open={editorOpen}
              onToggle={(event) =>
                setEditorOpen(event.currentTarget.open)
              }
            >
              <summary id="review-load-fields">
                <span>
                  <small>Review workspace</small>
                  <strong>Review or correct shipment inputs</strong>
                  <p>
                    Open the full fact editor and twelve product screens.
                  </p>
                </span>
                <span>{editorOpen ? "Close editor" : "Open editor"}</span>
              </summary>
            <ReportSection
              id="review-load-core"
              order={1}
              kind="editor"
              eyebrow="Step 2"
              title="Confirm the shipment facts"
              description="AI output and source text remain unverified until you confirm them. Manual edits are treated as operator-confirmed facts."
            >
              {reviewablePaths.length > 0 ? (
                <div className={styles.confirmBar}>
                  <div className={styles.confirmBarHeader}>
                    <div>
                      <strong>
                        {reviewablePaths.length} source-backed drafts need
                        review
                      </strong>
                      <p>
                        Check only the rows you read, then confirm the selected
                        facts in one rebuild. Selection alone changes nothing.
                      </p>
                    </div>
                    <div className={styles.confirmBarActions}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={pending}
                        onClick={toggleAllReviewPaths}
                      >
                        {allReviewableSelected
                          ? "Clear selection"
                          : `Select all ${reviewablePaths.length}`}
                      </button>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={
                          pending || selectedEligiblePaths.length === 0
                        }
                        onClick={confirmSelectedPaths}
                      >
                        Confirm {selectedEligiblePaths.length} selected
                      </button>
                    </div>
                  </div>
                  <div
                    className={styles.reviewSelectionList}
                    role="group"
                    aria-label="Source-backed facts available for confirmation"
                  >
                    {reviewablePaths.map((path) => (
                      <label key={path}>
                        <input
                          type="checkbox"
                          checked={selectedEligiblePaths.includes(path)}
                          disabled={pending}
                          onChange={() => toggleReviewPath(path)}
                        />
                        <span>
                          <strong>{pathLabel(path)}</strong>
                          <small data-basis={basis(path)}>
                            {basisLabel(basis(path))}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className={styles.confirmBarFootnote}>
                    Confirming a value records operator review. It does not
                    validate the supplier statement, classification, or source
                    document.
                  </p>
                </div>
              ) : null}

              <div className={styles.formGroup}>
                <div className={styles.formGroupHeading}>
                  <span>Product identity</span>
                  <p>
                    A supplier description and proposed HTS are
                    research inputs, not validated classification.
                  </p>
                </div>
                <div className={styles.fieldGrid}>
                  <TextField
                    path="shipmentReference"
                    value={fields.shipmentReference}
                    basis={basis("shipmentReference")}
                    placeholder="CN-LOAD-001"
                    onCommit={commit}
                  />
                  <TextField
                    path="product.model"
                    value={fields.product.model}
                    basis={basis("product.model")}
                    placeholder="Exact model"
                    onCommit={commit}
                  />
                  <TextField
                    path="product.manufacturer"
                    value={fields.product.manufacturer}
                    basis={basis("product.manufacturer")}
                    placeholder="Legal manufacturer"
                    onCommit={commit}
                  />
                  <TextField
                    path="product.proposedHts10"
                    value={fields.product.proposedHts10}
                    basis={basis("product.proposedHts10")}
                    placeholder="10 digits"
                    helper="Use the current U.S. HTS format."
                    onCommit={commit}
                  />
                  <TextField
                    path="product.description"
                    value={fields.product.description}
                    basis={basis("product.description")}
                    placeholder="What is physically being imported?"
                    multiline
                    onCommit={commit}
                  />
                  <TextField
                    path="product.principalFunction"
                    value={fields.product.principalFunction}
                    basis={basis("product.principalFunction")}
                    placeholder="Primary technical function"
                    multiline
                    onCommit={commit}
                  />
                  <TextField
                    path="product.intendedUse"
                    value={fields.product.intendedUse}
                    basis={basis("product.intendedUse")}
                    placeholder="End use and customer market"
                    multiline
                    onCommit={commit}
                  />
                  <TextField
                    path="product.marketingClaims"
                    value={
                      fields.product.marketingClaims.join(", ") || null
                    }
                    basis={basis("product.marketingClaims")}
                    placeholder="Comma-separated claims from product materials"
                    helper="Include claims such as medical, disinfecting, radio, laser, or damaged battery status."
                    multiline
                    onCommit={(path, value) =>
                      commit(
                        path,
                        value
                          ? value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean)
                          : []
                      )
                    }
                  />
                  <SelectField
                    path="product.classificationStatus"
                    value={fields.product.classificationStatus}
                    basis={basis("product.classificationStatus")}
                    options={[
                      { value: "unknown", label: "Unknown" },
                      {
                        value: "supplier_proposed",
                        label: "Supplier proposed",
                      },
                      {
                        value: "broker_reviewed",
                        label: "Broker reviewed",
                      },
                      {
                        value: "binding_ruling",
                        label: "Binding ruling",
                      },
                    ]}
                    onCommit={commit}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <div className={styles.formGroupHeading}>
                  <span>Route and timing</span>
                  <p>
                    Use timezone-qualified ISO timestamps around exact
                    tariff boundaries, for example
                    2026-07-31T10:00:00-04:00.
                  </p>
                </div>
                <div className={styles.fieldGrid}>
                  <TextField
                    path="route.countryOfExport"
                    value={fields.route.countryOfExport}
                    basis={basis("route.countryOfExport")}
                    placeholder="China"
                    onCommit={commit}
                  />
                  <TextField
                    path="route.customsCountryOfOrigin"
                    value={fields.route.customsCountryOfOrigin}
                    basis={basis(
                      "route.customsCountryOfOrigin"
                    )}
                    placeholder="Do not infer from export country"
                    onCommit={commit}
                  />
                  <TextField
                    path="route.portOfLoading"
                    value={fields.route.portOfLoading}
                    basis={basis("route.portOfLoading")}
                    placeholder="Yantian"
                    onCommit={commit}
                  />
                  <TextField
                    path="route.portOfUnlading"
                    value={fields.route.portOfUnlading}
                    basis={basis("route.portOfUnlading")}
                    placeholder="Long Beach"
                    onCommit={commit}
                  />
                  <TextField
                    path="route.finalDestination"
                    value={fields.route.finalDestination}
                    basis={basis("route.finalDestination")}
                    placeholder="Fremont, CA"
                    onCommit={commit}
                  />
                  <TextField
                    path="route.containerType"
                    value={fields.route.containerType}
                    basis={basis("route.containerType")}
                    placeholder="1 x 40HC"
                    onCommit={commit}
                  />
                  <NumberField
                    path="route.grossWeightKg"
                    value={fields.route.grossWeightKg}
                    basis={basis("route.grossWeightKg")}
                    placeholder="8400"
                    onCommit={commit}
                  />
                  <TextField
                    path="route.incoterm"
                    value={fields.route.incoterm}
                    basis={basis("route.incoterm")}
                    placeholder="FOB Yantian"
                    onCommit={commit}
                  />
                  <SelectField
                    path="timing.entryEvent"
                    value={fields.timing.entryEvent}
                    basis={basis("timing.entryEvent")}
                    options={[
                      {
                        value: "unknown",
                        label: "Unknown",
                      },
                      {
                        value: "entry_for_consumption",
                        label: "Entry for consumption",
                      },
                      {
                        value: "warehouse_withdrawal",
                        label: "Warehouse withdrawal for consumption",
                      },
                    ]}
                    onCommit={commit}
                  />
                  <TextField
                    path="timing.expectedEntryAt"
                    value={fields.timing.expectedEntryAt}
                    basis={basis("timing.expectedEntryAt")}
                    placeholder="2026-07-31T10:00:00-04:00"
                    onCommit={commit}
                  />
                  <TextField
                    path="timing.actualEntryAt"
                    value={fields.timing.actualEntryAt}
                    basis={basis("timing.actualEntryAt")}
                    placeholder="Leave blank until entry"
                    onCommit={commit}
                  />
                  <TextField
                    path="timing.loadedOnVesselAtPortOfLoadingAt"
                    value={
                      fields.timing
                        .loadedOnVesselAtPortOfLoadingAt
                    }
                    basis={basis(
                      "timing.loadedOnVesselAtPortOfLoadingAt"
                    )}
                    placeholder="Required only for in-transit review"
                    onCommit={commit}
                  />
                  <TextField
                    path="timing.finalModeTransitStartedAt"
                    value={
                      fields.timing.finalModeTransitStartedAt
                    }
                    basis={basis(
                      "timing.finalModeTransitStartedAt"
                    )}
                    placeholder="Required only for in-transit review"
                    onCommit={commit}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <div className={styles.formGroupHeading}>
                  <span>Value and entry parties</span>
                  <p>
                    The form records what is known. The broker still
                    owns entry validation and filing.
                  </p>
                </div>
                <div className={styles.fieldGrid}>
                  <NumberField
                    path="valuation.invoiceValue"
                    value={fields.valuation.invoiceValue}
                    basis={basis("valuation.invoiceValue")}
                    placeholder="285000"
                    onCommit={commit}
                  />
                  <TextField
                    path="valuation.currency"
                    value={fields.valuation.currency}
                    basis={basis("valuation.currency")}
                    placeholder="USD"
                    onCommit={commit}
                  />
                  <TextField
                    path="parties.importerOfRecord"
                    value={fields.parties.importerOfRecord}
                    basis={basis("parties.importerOfRecord")}
                    placeholder="Legal entity"
                    onCommit={commit}
                  />
                  <TextField
                    path="parties.customsBroker"
                    value={fields.parties.customsBroker}
                    basis={basis("parties.customsBroker")}
                    placeholder="Licensed broker"
                    onCommit={commit}
                  />
                  <TextField
                    path="parties.seller"
                    value={fields.parties.seller}
                    basis={basis("parties.seller")}
                    placeholder="Seller"
                    onCommit={commit}
                  />
                  <TextField
                    path="parties.buyer"
                    value={fields.parties.buyer}
                    basis={basis("parties.buyer")}
                    placeholder="Buyer"
                    onCommit={commit}
                  />
                  <TextField
                    path="parties.consignee"
                    value={fields.parties.consignee}
                    basis={basis("parties.consignee")}
                    placeholder="Consignee"
                    onCommit={commit}
                  />
                  <TextField
                    path="parties.ultimateConsignee"
                    value={fields.parties.ultimateConsignee}
                    basis={basis("parties.ultimateConsignee")}
                    placeholder="Ultimate consignee"
                    onCommit={commit}
                  />
                </div>
              </div>

              <details className={styles.advancedDetails}>
                <summary>
                  Evidence readiness and filing details
                  <span>Open checklist</span>
                </summary>
                <div className={styles.advancedBody}>
                  <div className={styles.formGroup}>
                    <div className={styles.formGroupHeading}>
                      <span>Origin and valuation</span>
                    </div>
                    <div className={styles.fieldGrid}>
                      <TextField
                        path="origin.manufacturingLocations"
                        value={
                          fields.origin.manufacturingLocations.join(
                            ", "
                          ) || null
                        }
                        basis={basis(
                          "origin.manufacturingLocations"
                        )}
                        placeholder="Comma-separated facilities"
                        onCommit={(path, value) =>
                          commit(
                            path,
                            value
                              ? value
                                  .split(",")
                                  .map((item) => item.trim())
                                  .filter(Boolean)
                              : []
                          )
                        }
                      />
                      <TextField
                        path="origin.transformationSummary"
                        value={fields.origin.transformationSummary}
                        basis={basis(
                          "origin.transformationSummary"
                        )}
                        placeholder="What happens at each facility?"
                        multiline
                        onCommit={commit}
                      />
                      <TextField
                        path="origin.markingDescription"
                        value={fields.origin.markingDescription}
                        basis={basis(
                          "origin.markingDescription"
                        )}
                        placeholder="Marking text and placement"
                        onCommit={commit}
                      />
                      <SelectField
                        path="origin.reviewStatus"
                        value={fields.origin.reviewStatus}
                        basis={basis("origin.reviewStatus")}
                        options={REVIEW_STATE_OPTIONS}
                        onCommit={commit}
                      />
                      <SelectField
                        path="valuation.relatedParty"
                        value={fields.valuation.relatedParty}
                        basis={basis("valuation.relatedParty")}
                        options={TRI_STATE_OPTIONS}
                        onCommit={commit}
                      />
                      <SelectField
                        path="valuation.internationalFreightIncluded"
                        value={
                          fields.valuation
                            .internationalFreightIncluded
                        }
                        basis={basis(
                          "valuation.internationalFreightIncluded"
                        )}
                        options={TRI_STATE_OPTIONS}
                        onCommit={commit}
                      />
                      <SelectField
                        path="valuation.insuranceIncluded"
                        value={fields.valuation.insuranceIncluded}
                        basis={basis(
                          "valuation.insuranceIncluded"
                        )}
                        options={TRI_STATE_OPTIONS}
                        onCommit={commit}
                      />
                      <SelectField
                        path="valuation.additionsReviewStatus"
                        value={
                          fields.valuation.additionsReviewStatus
                        }
                        basis={basis(
                          "valuation.additionsReviewStatus"
                        )}
                        options={REVIEW_STATE_OPTIONS}
                        onCommit={commit}
                      />
                      <SelectField
                        path="product.tariffStackReviewStatus"
                        value={
                          fields.product.tariffStackReviewStatus
                        }
                        basis={basis(
                          "product.tariffStackReviewStatus"
                        )}
                        options={REVIEW_STATE_OPTIONS}
                        onCommit={commit}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <div className={styles.formGroupHeading}>
                      <span>Importer and UFLPA evidence</span>
                    </div>
                    <div className={styles.fieldGrid}>
                      {(
                        [
                          [
                            "parties.importerNumberAvailable",
                            fields.parties.importerNumberAvailable,
                          ],
                          [
                            "parties.powerOfAttorneyReady",
                            fields.parties.powerOfAttorneyReady,
                          ],
                          [
                            "parties.bondReady",
                            fields.parties.bondReady,
                          ],
                          [
                            "forcedLabor.supplierIdentitiesComplete",
                            fields.forcedLabor
                              .supplierIdentitiesComplete,
                          ],
                          [
                            "forcedLabor.subSupplierIdentitiesComplete",
                            fields.forcedLabor
                              .subSupplierIdentitiesComplete,
                          ],
                          [
                            "forcedLabor.facilityAddressesComplete",
                            fields.forcedLabor
                              .facilityAddressesComplete,
                          ],
                          [
                            "forcedLabor.billOfMaterialsTraceable",
                            fields.forcedLabor
                              .billOfMaterialsTraceable,
                          ],
                          [
                            "forcedLabor.productionAndTransactionRecordsAvailable",
                            fields.forcedLabor
                              .productionAndTransactionRecordsAvailable,
                          ],
                          [
                            "forcedLabor.uflpaEntityScreenCompleted",
                            fields.forcedLabor
                              .uflpaEntityScreenCompleted,
                          ],
                        ] as Array<[string, ChinaImportTriState]>
                      ).map(([path, value]) => (
                        <SelectField
                          key={path}
                          path={path}
                          value={value}
                          basis={basis(path)}
                          options={TRI_STATE_OPTIONS}
                          onCommit={commit}
                        />
                      ))}
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <div className={styles.formGroupHeading}>
                      <span>Ocean filing</span>
                    </div>
                    <div className={styles.fieldGrid}>
                      <TextField
                        path="oceanFiling.isfFiler"
                        value={fields.oceanFiling.isfFiler}
                        basis={basis("oceanFiling.isfFiler")}
                        placeholder="Named filer"
                        onCommit={commit}
                      />
                      <TextField
                        path="oceanFiling.isfFiledAt"
                        value={fields.oceanFiling.isfFiledAt}
                        basis={basis("oceanFiling.isfFiledAt")}
                        placeholder="ISO timestamp with timezone"
                        onCommit={commit}
                      />
                      <TextField
                        path="oceanFiling.containerStuffingLocation"
                        value={
                          fields.oceanFiling
                            .containerStuffingLocation
                        }
                        basis={basis(
                          "oceanFiling.containerStuffingLocation"
                        )}
                        placeholder="Facility and address"
                        onCommit={commit}
                      />
                      <TextField
                        path="oceanFiling.consolidator"
                        value={fields.oceanFiling.consolidator}
                        basis={basis("oceanFiling.consolidator")}
                        placeholder="Consolidator"
                        onCommit={commit}
                      />
                      {(
                        [
                          [
                            "oceanFiling.invoiceAvailable",
                            fields.oceanFiling.invoiceAvailable,
                          ],
                          [
                            "oceanFiling.packingListAvailable",
                            fields.oceanFiling.packingListAvailable,
                          ],
                          [
                            "oceanFiling.billOfLadingAvailable",
                            fields.oceanFiling
                              .billOfLadingAvailable,
                          ],
                        ] as Array<[string, ChinaImportTriState]>
                      ).map(([path, value]) => (
                        <SelectField
                          key={path}
                          path={path}
                          value={value}
                          basis={basis(path)}
                          options={TRI_STATE_OPTIONS}
                          onCommit={commit}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            </ReportSection>

            <ReportSection
              id="review-load-screens"
              order={2}
              kind="editor"
              eyebrow="Step 3"
              title="Resolve product and transport screens"
              description="Every screen starts unknown. Select No only when the specification and intended-use facts support it."
            >
              <div className={styles.screenInputGrid}>
                {CHINA_IMPORT_AGENCY_FEATURES.map((feature) => {
                  const path = `agencyScreens.${feature.id}`;
                  const value: ChinaImportTriState =
                    fields.agencyScreens[feature.id];
                  return (
                    <div
                      className={styles.screenInput}
                      data-value={value}
                      key={feature.id}
                    >
                      <span>
                        <small>{feature.agency}</small>
                        <label
                          htmlFor={`china-screen-${feature.id}`}
                        >
                          <strong>{feature.label}</strong>
                        </label>
                        <p>{feature.question}</p>
                      </span>
                      <span className={styles.screenControl}>
                        <select
                          id={`china-screen-${feature.id}`}
                          aria-label={`${feature.label} applicability`}
                          value={value}
                          onChange={(event) =>
                            commit(path, event.target.value)
                          }
                        >
                          {TRI_STATE_OPTIONS.map((option) => (
                            <option
                              value={option.value}
                              key={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {value !== "unknown" &&
                        basis(path) !== "operator_confirmed" &&
                        basis(path) !== "document" ? (
                          <button
                            type="button"
                            aria-label={`Confirm ${feature.label} answer`}
                            onClick={() => commit(path, value)}
                          >
                            Confirm answer
                          </button>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </ReportSection>
            </details>

            <details className={styles.limitations}>
              <summary>Use limitations and authority boundary</summary>
              <ul>
                {assessment.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}
      </div>
    </article>
  );
}
