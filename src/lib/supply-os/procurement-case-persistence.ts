import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import { sourcingSystemWorkspace } from "./sourcing-research-persistence";
import {
  currentSupplierQualification,
  supplierQualificationValidOn,
} from "./supplier-qualification";
import {
  listSupplierCommunicationTasks,
  SUPPLIER_EMAIL_ACTION_TASK_TYPE,
  SUPPLIER_EMAIL_DRAFT_TASK_TYPE,
} from "./supplier-communication-persistence";
import {
  listPurchaseOrderCommunicationTasks,
  PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE,
  PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE,
} from "./purchase-order-communication-persistence";
import { finalizeReplacementSupersession } from "./purchase-order-revision";

const RESEARCH_CAPABILITY = "research.supplier_candidates";
const TASK_TYPE = "PROCUREMENT_CASE";
const APPROVAL_TASK_TYPE = "PROCUREMENT_APPROVAL";
const APPROVAL_CAPABILITY = "review.procurement_selection";
const APPROVAL_REQUIRED_ROLE = "MANAGER";
const QUOTE_CYCLE_TASK_TYPE = "SUPPLIER_QUOTE_CYCLE";
const QUOTE_CYCLE_CAPABILITY = "record.supplier_quote_cycle";
const QUOTE_CHANNELS = ["EMAIL", "SUPPLIER_PORTAL", "EDI", "PHONE_CONFIRMED", "OTHER"] as const;
const PURCHASE_DRAFT_TASK_TYPE = "PURCHASE_ORDER_DRAFT";
const PURCHASE_DRAFT_CAPABILITY = "draft.purchase_order";
const PURCHASE_ACTION_TASK_TYPE = "PURCHASE_ORDER_ACTION";
const PURCHASE_ACTION_CAPABILITY = "authorize.purchase_order";
const PURCHASE_ACTION_REQUIRED_ROLE = "ADMIN";
const PURCHASE_INCOTERMS = ["EXW", "FCA", "FOB", "CPT", "CIP", "DAP", "DDP"] as const;
const PURCHASE_RELEASE_CHANNELS = ["EMAIL", "SUPPLIER_PORTAL", "EDI", "PHONE_CONFIRMED", "OTHER"] as const;
const SUPPLIER_ORDER_EXCEPTION_CATEGORIES = ["QUANTITY_CHANGE", "PRICE_CHANGE", "DELIVERY_CHANGE", "TERMS_CHANGE", "REJECTION", "OTHER"] as const;
const SUPPLIER_ORDER_EXCEPTION_DISPOSITIONS = ["KEEP_ORIGINAL", "REQUIRE_REAUTHORIZATION", "RETURN_TO_SOURCING"] as const;
const SUPPLIER_ORDER_REVISION_PENDING_STATUSES = ["REVISION_REQUIRED", "REVISION_DRAFTED", "REVISION_AUTHORIZED"] as const;
const SUPPLIER_RELATIONSHIPS = ["MANUFACTURER", "AUTHORIZED_DISTRIBUTOR", "INDEPENDENT_DISTRIBUTOR"] as const;
const SUPPLIER_REJECTION_REASONS = ["IDENTITY_UNRESOLVED", "CAPABILITY_UNRESOLVED", "AUTHORIZATION_UNRESOLVED", "SOURCE_UNVERIFIABLE", "OTHER"] as const;

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function supplierOrderRevisionPending(value: unknown) {
  const status = String(record(value).status);
  return SUPPLIER_ORDER_REVISION_PENDING_STATUSES.includes(status as (typeof SUPPLIER_ORDER_REVISION_PENDING_STATUSES)[number]);
}

function supplierOrderAcceptanceBlocked(value: unknown) {
  const status = String(record(value).status);
  return status === "OPEN_REVIEW" || status === "RETURNED_TO_SOURCING" || supplierOrderRevisionPending(value);
}

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== "string") throw new SupplyPersistenceError(`${label} is required.`, "invalid_input");
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > max) {
    throw new SupplyPersistenceError(`${label} must contain 1 to ${max} characters.`, "invalid_input");
  }
  return normalized;
}

function optionalText(value: unknown, label: string, max: number) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, label, max);
}

function publicUrl(value: unknown, label: string) {
  const text = requiredText(value, label, 2_000);
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    url.hash = "";
    return url.toString();
  } catch {
    throw new SupplyPersistenceError(`${label} must be an HTTP or HTTPS URL without credentials.`, "invalid_input");
  }
}

function sameWebDomain(left: string, right: string) {
  const leftHost = new URL(left).hostname.toLowerCase().replace(/^www\./, "");
  const rightHost = new URL(right).hostname.toLowerCase().replace(/^www\./, "");
  return leftHost === rightHost || leftHost.endsWith(`.${rightHost}`) || rightHost.endsWith(`.${leftHost}`);
}

function connectedProviderUrl(value: unknown, label: string) {
  const text = requiredText(value, label, 2_000);
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.hostname !== "mail.google.com" || !url.pathname.startsWith("/mail/u/") || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    throw new SupplyPersistenceError(`${label} must be a connected Gmail URL.`, "invalid_input");
  }
}

function isoDate(value: unknown, label: string) {
  const text = requiredText(value, label, 10);
  const parsed = new Date(`${text}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new SupplyPersistenceError(`${label} must use YYYY-MM-DD.`, "invalid_input");
  }
  return text;
}

function positiveNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new SupplyPersistenceError(`${label} must be a positive number.`, "invalid_input");
  }
  return value;
}

function optionalPositiveNumber(value: unknown, label: string, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new SupplyPersistenceError(`${label} must be a positive number no greater than ${maximum}.`, "invalid_input");
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SupplyPersistenceError(`${label} must be a non-negative integer.`, "invalid_input");
  }
  return value;
}

function normalizedUnitOfMeasure(value: unknown, label = "Unit of measure") {
  const unit = requiredText(value, label, 20).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 ._/-]{0,19}$/.test(unit)) {
    throw new SupplyPersistenceError(`${label} contains unsupported characters.`, "invalid_input");
  }
  return unit;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function requireCurrentOrFutureDate(value: string, label: string) {
  if (value < todayUtc()) {
    throw new SupplyPersistenceError(`${label} cannot be in the past.`, "invalid_input");
  }
  return value;
}

function requireCurrentOrPastDate(value: string, label: string) {
  if (value > todayUtc()) {
    throw new SupplyPersistenceError(`${label} cannot be in the future.`, "invalid_input");
  }
  return value;
}

async function currentAccessContext(context: SupplyAccessContext): Promise<SupplyAccessContext> {
  const user = await prisma.user.findFirst({
    where: { id: context.userId, officeId: context.officeId, isActive: true },
    select: { role: true, canViewWholeOffice: true },
  });
  if (!user) throw new SupplyPersistenceError("Your current user no longer has access to this office.", "forbidden");
  return { ...context, role: user.role, canViewWholeOffice: user.canViewWholeOffice };
}

function caseResult(value: Prisma.JsonValue | null) {
  const result = record(value);
  const selectedOption = record(result.selectedOption);
  const gates = record(result.gates);
  if (typeof result.selectionHash !== "string" || typeof selectedOption.id !== "string") {
    throw new SupplyPersistenceError("Procurement case result is incomplete.", "conflict");
  }
  return { result, selectedOption, gates, reviews: record(result.reviews), approval: record(result.approval) };
}

function nextStage(gates: Record<string, unknown>) {
  if (gates.sourceEvidence !== "EVIDENCE_COMPLETE") return "SOURCE_EVIDENCE";
  if (gates.commercialTerms !== "EVIDENCE_COMPLETE") return "COMMERCIAL_CONFIRMATION";
  if (gates.qualityPlan !== "EVIDENCE_COMPLETE") return "QUALITY_REVIEW";
  if (gates.purchaseApproval === "PENDING") return "APPROVAL_PENDING";
  if (gates.purchaseApproval === "APPROVED") return "PURCHASE_READY";
  return "APPROVAL";
}

function requireCurrentSupplierQualification(value: unknown, message: string) {
  if (!currentSupplierQualification(value)) {
    throw new SupplyPersistenceError(message, "conflict");
  }
  return record(value);
}

function retryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (
      error.code === "P2002"
      || error.code === "P2034"
      || (error.code === "P2010" && ["40001", "40P01"].includes(String(record(error.meta).code)))
    );
}

async function withSerializableRetry<T>(operation: () => Promise<T>, conflictMessage: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) throw new SupplyPersistenceError(conflictMessage, "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError(conflictMessage, "conflict");
}

function inputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

async function appendCaseEvent(args: {
  tx: Prisma.TransactionClient;
  caseId: string;
  officeId: string;
  workspaceId: string;
  actorUserId: string;
  eventType: string;
  status?: string;
  message: string;
  payload: Prisma.InputJsonObject;
}) {
  const aggregate = await args.tx.supplyExecutionEvent.aggregate({
    where: { executionTaskId: args.caseId },
    _max: { sequence: true },
  });
  const sequence = (aggregate._max.sequence ?? 0) + 1;
  await args.tx.supplyExecutionEvent.create({
    data: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      executionTaskId: args.caseId,
      actorUserId: args.actorUserId,
      sequence,
      eventType: args.eventType,
      status: args.status ?? "PLANNED",
      message: args.message,
      payload: args.payload,
      payloadHash: digest(args.payload),
      idempotencyKey: `${args.eventType.toLowerCase()}:${sequence}:${digest(args.payload)}`,
    },
  });
}

async function appendExternalEvidence(args: {
  tx: Prisma.TransactionClient;
  officeId: string;
  workspaceId: string;
  executionTaskId: string;
  actorUserId: string;
  kind: string;
  title: string;
  sourceType?: "OFFICIAL" | "OPERATOR_RECORDED_EXTERNAL" | "CONNECTED_PROVIDER";
  sourceUri: string | null;
  sourceRecordId?: string | null;
  observedOn: string;
  contentHash: string;
  payload: Prisma.InputJsonObject;
}) {
  const evidenceKey = `${args.kind.toLowerCase()}:${args.executionTaskId}:${args.contentHash}`;
  const existing = await args.tx.supplyEvidence.findUnique({
    where: { workspaceId_evidenceKey: { workspaceId: args.workspaceId, evidenceKey } },
    select: { id: true, executionTaskId: true, sourceUri: true, contentHash: true },
  });
  if (existing) {
    if (
      existing.executionTaskId !== args.executionTaskId
      || existing.sourceUri !== args.sourceUri
      || existing.contentHash !== args.contentHash
    ) {
      throw new SupplyPersistenceError("Stored supplier evidence does not match the current procurement scope.", "conflict");
    }
    return existing;
  }
  return args.tx.supplyEvidence.create({
    data: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      executionTaskId: args.executionTaskId,
      createdByUserId: args.actorUserId,
      evidenceKey,
      kind: args.kind,
      sourceType: args.sourceType ?? "OPERATOR_RECORDED_EXTERNAL",
      sourceUri: args.sourceUri,
      sourceRecordId: args.sourceRecordId ?? null,
      sourceVersion: args.contentHash,
      title: args.title,
      payload: args.payload,
      contentHash: args.contentHash,
      confidence: null,
      observedAt: new Date(`${args.observedOn}T12:00:00Z`),
    },
    select: { id: true, executionTaskId: true, sourceUri: true, contentHash: true },
  });
}

function sourcedNumber(value: unknown) {
  const envelope = record(value);
  const amount = envelope.value;
  const sources = Array.isArray(envelope.sources) ? envelope.sources : [];
  return envelope.state === "SUPPORTED"
    && envelope.freshness === "FRESH"
    && sources.length > 0
    && typeof amount === "number"
    && Number.isFinite(amount)
    && amount >= 0
    ? amount
    : null;
}

function sourcedCurrency(value: unknown) {
  const envelope = record(value);
  const currency = envelope.value;
  const sources = Array.isArray(envelope.sources) ? envelope.sources : [];
  return envelope.state === "SUPPORTED"
    && envelope.freshness === "FRESH"
    && sources.length > 0
    && typeof currency === "string"
    && /^[A-Z]{3}$/.test(currency.toUpperCase())
    ? currency.toUpperCase()
    : null;
}

function dateFromLeadTime(observedAt: Date, leadTimeDays: number) {
  const date = new Date(observedAt);
  date.setUTCDate(date.getUTCDate() + leadTimeDays);
  return date.toISOString().slice(0, 10);
}

function canonicalSelection(
  selection: ProcurementSelectionInput,
  researchOutput: Prisma.JsonValue | null,
  researchObservedAt: Date,
) {
  const output = record(researchOutput);
  const candidates = Array.isArray(output.candidates) ? output.candidates : [];
  const publicId = selection.id.startsWith("public:") ? selection.id.slice("public:".length) : null;
  const matches = publicId ? candidates.filter((candidate) => record(candidate).id === publicId) : [];
  if (matches.length > 1) {
    throw new SupplyPersistenceError("Supplier research contains an ambiguous candidate identifier.", "conflict");
  }
  const raw = matches[0] ?? null;
  if (raw) {
    const candidate = record(raw);
    const website = typeof candidate.website === "string" ? candidate.website : null;
    const sourceUrls = Array.isArray(candidate.sourceUrls) ? candidate.sourceUrls.filter((value): value is string => typeof value === "string") : [];
    const price = sourcedNumber(candidate.price);
    const currency = sourcedCurrency(candidate.currency);
    const minimumOrderQuantity = sourcedNumber(candidate.minimumOrderQuantity);
    const leadTimeDays = sourcedNumber(candidate.leadTimeDays);
    const status = candidate.status;
    return {
      ...selection,
      id: `public:${publicId}`,
      name: typeof candidate.companyName === "string" ? candidate.companyName : selection.name,
      sourceClass: website ? "Official" as const : "New" as const,
      sourceUrl: website ?? sourceUrls[0] ?? null,
      price,
      currency,
      minimumOrderQuantity,
      priceType: price !== null && currency !== null ? "Sourced" as const : "Unknown" as const,
      deliveryDate: leadTimeDays !== null
        ? dateFromLeadTime(researchObservedAt, leadTimeDays)
        : null,
      deliveryType: leadTimeDays !== null ? "Sourced" as const : "Unknown" as const,
      quality: status === "REVIEW_REQUIRED" ? "Conditional" as const : "Unverified" as const,
    };
  }
  if (publicId) throw new SupplyPersistenceError("Selected supplier was not present in the research run.", "invalid_input");
  if (selection.priceType !== "Modeled" || selection.deliveryType !== "Modeled" || selection.sourceUrl !== null) {
    throw new SupplyPersistenceError("Selected supplier terms are not supported by the research run.", "invalid_input");
  }
  return {
    ...selection,
    sourceClass: "New" as const,
    quality: "Unverified" as const,
  };
}

export type ProcurementSelectionInput = {
  id: string;
  name: string;
  sourceClass: "Official" | "Trusted" | "New";
  sourceUrl: string | null;
  price: number | null;
  currency: string | null;
  minimumOrderQuantity: number | null;
  priceType: "Modeled" | "Sourced" | "Unknown";
  deliveryDate: string | null;
  deliveryType: "Modeled" | "Sourced" | "Unknown";
  quality: "Strong" | "Conditional" | "Unverified";
};

export type PurchaseOrderDraftInput = {
  expectedApprovalId: string;
  expectedApprovalScopeHash: string;
  expectedRevision: number;
  quantity: number;
  needBy: string;
  shipTo: string;
  incoterm: (typeof PURCHASE_INCOTERMS)[number];
  paymentTerms: string;
  buyerReference?: string | null;
  notes?: string | null;
};

type RevisedPurchaseOrderDraftInput = {
  expectedReleaseHash: string;
  exceptionHash: string;
  expectedRevision: number;
  quantity: number;
  needBy: string;
  shipTo: string;
  incoterm: (typeof PURCHASE_INCOTERMS)[number];
  paymentTerms: string;
  buyerReference: string | null;
  notes: string | null;
  unitPrice: number;
  currency: string;
  minimumOrderQuantity: number;
  deliveryDate: string;
  quoteReference: string;
  quoteValidUntil: string;
};

function progressionFor(selection: ProcurementSelectionInput) {
  const sourceEvidence = selection.sourceUrl ? "REVIEW_REQUIRED" : "BLOCKED";
  const commercialEvidence = selection.priceType === "Sourced"
    && selection.deliveryType === "Sourced"
    && selection.currency !== null
    && selection.minimumOrderQuantity !== null
    ? "EVIDENCE_COMPLETE"
    : "REVIEW_REQUIRED";
  const commercialTerms = "REVIEW_REQUIRED";
  const qualityPlan = "REVIEW_REQUIRED";
  const purchaseApproval = "BLOCKED";
  const caseState = {
    stage: "SOURCE_EVIDENCE",
    selectedOption: selection,
    gates: {
      sourceEvidence,
      commercialTerms,
      qualityPlan,
      purchaseApproval,
    },
    evidenceState: { commercialTerms: commercialEvidence },
    reviews: {},
    approval: null,
  };
  return {
    ...caseState,
    selectionHash: digest(selection),
    updatedAt: new Date().toISOString(),
  };
}

const caseSelect = {
  id: true,
  workspaceId: true,
  status: true,
  taskKey: true,
  input: true,
  result: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplyExecutionTaskSelect;

type ProcurementCaseRecord = Prisma.SupplyExecutionTaskGetPayload<{ select: typeof caseSelect }>;

function projectQualificationState(procurementCase: ProcurementCaseRecord) {
  const result = record(procurementCase.result);
  const gates = record(result.gates);
  const reviews = record(result.reviews);
  if (["RELEASED", "PARTIALLY_ACKNOWLEDGED", "ACKNOWLEDGED"].includes(String(record(result.purchaseRelease).state))
    || result.stage === "SUPPLIER_REJECTED"
    || gates.sourceEvidence !== "EVIDENCE_COMPLETE"
    || currentSupplierQualification(reviews.sourceEvidence)) {
    return { procurementCase, requiresRequalification: false };
  }
  const projectedResult: Record<string, unknown> = {
    ...result,
    gates: {
      ...gates,
      sourceEvidence: "REVIEW_REQUIRED",
      commercialTerms: "REVIEW_REQUIRED",
      qualityPlan: "REVIEW_REQUIRED",
      purchaseApproval: "BLOCKED",
    },
    stage: "SOURCE_EVIDENCE",
  };
  delete projectedResult.confirmedTerms;
  delete projectedResult.qualityPlan;
  delete projectedResult.quoteCycle;
  delete projectedResult.purchasePreparation;
  delete projectedResult.purchaseAuthorization;
  return {
    procurementCase: { ...procurementCase, result: inputJson(projectedResult) },
    requiresRequalification: true,
  };
}

const purchaseDraftSelect = {
  id: true,
  parentTaskId: true,
  status: true,
  taskKey: true,
  taskType: true,
  capabilityKey: true,
  input: true,
  inputHash: true,
  result: true,
  resultHash: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplyExecutionTaskSelect;

const purchaseActionSelect = {
  id: true,
  status: true,
  taskKey: true,
  taskType: true,
  capabilityKey: true,
  input: true,
  inputHash: true,
  result: true,
  resultHash: true,
  externalSystem: true,
  externalRef: true,
  createdAt: true,
  updatedAt: true,
  approvals: {
    orderBy: { requestedAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      requiredRole: true,
      scopeHash: true,
      requestReason: true,
      requestedByUserId: true,
      decidedByUserId: true,
      decisionNote: true,
      requestedAt: true,
      decidedAt: true,
      expiresAt: true,
    },
  },
} satisfies Prisma.SupplyExecutionTaskSelect;

type PurchaseActionRecord = Prisma.SupplyExecutionTaskGetPayload<{ select: typeof purchaseActionSelect }>;

function purchaseActionView(task: PurchaseActionRecord, fallbackApproval?: PurchaseActionRecord["approvals"][number] | null) {
  const { approvals, ...action } = task;
  return { ...action, approval: approvals[0] ?? fallbackApproval ?? null };
}

async function listProcurementCasesMatching(
  context: SupplyAccessContext,
  options: { caseIds?: string[]; researchRunIds?: string[]; take?: number } = {},
) {
  const accessContext = await currentAccessContext(context);
  const workspace = await sourcingSystemWorkspace(accessContext, "view");
  const researchRunIds = options.researchRunIds
    ? [...new Set(options.researchRunIds.map((id) => id.trim()).filter(Boolean))]
    : null;
  const filteredCaseIds = options.caseIds
    ? [...new Set(options.caseIds.map((id) => id.trim()).filter(Boolean))]
    : null;
  if (researchRunIds && !researchRunIds.length) return [];
  if (filteredCaseIds && !filteredCaseIds.length) return [];
  if (researchRunIds && researchRunIds.length > 50) {
    throw new SupplyPersistenceError("A sourcing queue page cannot include more than 50 research runs.", "invalid_input");
  }
  const cases = await prisma.supplyExecutionTask.findMany({
    where: {
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
      taskType: TASK_TYPE,
      ...(filteredCaseIds ? { id: { in: filteredCaseIds } } : {}),
      ...(researchRunIds ? {
        OR: researchRunIds.map((researchRunId) => ({
          input: { path: ["researchRunId"], equals: researchRunId },
        })),
      } : {}),
    },
    orderBy: { updatedAt: "desc" },
    ...(options.take ? { take: options.take } : {}),
    select: caseSelect,
  });
  if (!cases.length) return [];
  const caseIds = cases.map((procurementCase) => procurementCase.id);
  const [quoteCycles, purchaseDrafts] = await Promise.all([
    prisma.supplyExecutionTask.findMany({
      where: {
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        parentTaskId: { in: caseIds },
        taskType: QUOTE_CYCLE_TASK_TYPE,
        status: { in: ["PLANNED", "RUNNING"] },
      },
      orderBy: { updatedAt: "desc" },
      select: purchaseDraftSelect,
    }),
    prisma.supplyExecutionTask.findMany({
      where: {
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        parentTaskId: { in: caseIds },
        taskType: PURCHASE_DRAFT_TASK_TYPE,
        status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING", "SUCCEEDED"] },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        ...purchaseDraftSelect,
        childTasks: {
          where: {
            officeId: context.officeId,
            workspaceId: workspace.id,
            taskType: PURCHASE_ACTION_TASK_TYPE,
            status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING", "SUCCEEDED"] },
          },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: purchaseActionSelect,
        },
      },
    }),
  ]);
  const quoteCycleByCase = new Map<string, (typeof quoteCycles)[number]>();
  for (const quoteCycle of quoteCycles) {
    if (quoteCycle.parentTaskId && !quoteCycleByCase.has(quoteCycle.parentTaskId)) quoteCycleByCase.set(quoteCycle.parentTaskId, quoteCycle);
  }
  const purchaseDraftByCase = new Map<string, (typeof purchaseDrafts)[number]>();
  for (const purchaseDraft of purchaseDrafts) {
    if (purchaseDraft.parentTaskId && !purchaseDraftByCase.has(purchaseDraft.parentTaskId)) purchaseDraftByCase.set(purchaseDraft.parentTaskId, purchaseDraft);
  }
  const [communicationTasks, purchaseOrderCommunicationTasks] = await Promise.all([
    listSupplierCommunicationTasks({
      context: accessContext,
      workspaceId: workspace.id,
      quoteCycleIds: quoteCycles.map((quoteCycle) => quoteCycle.id),
    }),
    listPurchaseOrderCommunicationTasks({
      context: accessContext,
      workspaceId: workspace.id,
      purchaseDraftIds: purchaseDrafts.map((purchaseDraft) => purchaseDraft.id),
    }),
  ]);
  const emailDraftByQuoteCycle = new Map<string, (typeof communicationTasks)[number]>();
  const emailActionByQuoteCycle = new Map<string, (typeof communicationTasks)[number]>();
  for (const task of communicationTasks) {
    if (!task.parentTaskId) continue;
    const target = task.taskType === SUPPLIER_EMAIL_DRAFT_TASK_TYPE
      ? emailDraftByQuoteCycle
      : task.taskType === SUPPLIER_EMAIL_ACTION_TASK_TYPE
        ? emailActionByQuoteCycle
        : null;
    if (target && !target.has(task.parentTaskId)) target.set(task.parentTaskId, task);
  }
  const purchaseOrderEmailDraftByPurchaseDraft = new Map<string, (typeof purchaseOrderCommunicationTasks)[number]>();
  const purchaseOrderEmailActionByPurchaseDraft = new Map<string, (typeof purchaseOrderCommunicationTasks)[number]>();
  for (const task of purchaseOrderCommunicationTasks) {
    if (!task.parentTaskId) continue;
    const target = task.taskType === PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE
      ? purchaseOrderEmailDraftByPurchaseDraft
      : task.taskType === PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE
        ? purchaseOrderEmailActionByPurchaseDraft
        : null;
    if (target && !target.has(task.parentTaskId)) target.set(task.parentTaskId, task);
  }
  return cases.map((rawProcurementCase) => {
    const { procurementCase, requiresRequalification } = projectQualificationState(rawProcurementCase);
    if (requiresRequalification) {
      return {
        ...procurementCase,
        quoteCycle: null,
        supplierEmailDraft: null,
        supplierEmailAction: null,
        purchaseDraft: null,
        purchaseAction: null,
        purchaseOrderEmailDraft: null,
        purchaseOrderEmailAction: null,
      };
    }
    const quoteCycle = quoteCycleByCase.get(procurementCase.id) ?? null;
    const supplierEmailDraft = quoteCycle ? emailDraftByQuoteCycle.get(quoteCycle.id) ?? null : null;
    const candidateSupplierEmailAction = quoteCycle ? emailActionByQuoteCycle.get(quoteCycle.id) ?? null : null;
    const rawSupplierEmailAction = candidateSupplierEmailAction
      && record(candidateSupplierEmailAction.input).draftMessageHash === record(supplierEmailDraft?.result).messageHash
      && (
        typeof record(candidateSupplierEmailAction.input).supplierQualificationHash === "string"
        || candidateSupplierEmailAction.status === "SUCCEEDED"
        || ["SENDING", "DELIVERY_UNKNOWN", "NOT_FOUND_REVIEW_REQUIRED"].includes(String(record(candidateSupplierEmailAction.result).state))
      )
      ? candidateSupplierEmailAction
      : null;
    const supplierEmailAction = rawSupplierEmailAction
      ? (() => {
          const { approvals, ...task } = rawSupplierEmailAction;
          return { ...task, approval: approvals[0] ?? null };
        })()
      : null;
    const activeDraft = purchaseDraftByCase.get(procurementCase.id) ?? null;
    if (!activeDraft) return { ...procurementCase, quoteCycle, supplierEmailDraft, supplierEmailAction, purchaseDraft: null, purchaseAction: null, purchaseOrderEmailDraft: null, purchaseOrderEmailAction: null };
    const { childTasks: purchaseActions, ...purchaseDraft } = activeDraft;
    const activeAction = purchaseActions[0] ?? null;
    const purchaseOrderEmailDraft = purchaseOrderEmailDraftByPurchaseDraft.get(purchaseDraft.id) ?? null;
    const rawPurchaseOrderEmailAction = purchaseOrderEmailActionByPurchaseDraft.get(purchaseDraft.id) ?? null;
    const purchaseOrderEmailAction = rawPurchaseOrderEmailAction
      ? (() => {
          const { approvals, ...task } = rawPurchaseOrderEmailAction;
          return { ...task, approval: approvals[0] ?? null };
        })()
      : null;
    return {
      ...procurementCase,
      quoteCycle,
      supplierEmailDraft,
      supplierEmailAction,
      purchaseDraft,
      purchaseAction: activeAction
        ? purchaseActionView(activeAction)
        : null,
      purchaseOrderEmailDraft,
      purchaseOrderEmailAction,
    };
  });
}

export async function listProcurementCases(context: SupplyAccessContext) {
  return listProcurementCasesMatching(context, { take: 120 });
}

export async function listProcurementCasesForResearchRuns(
  context: SupplyAccessContext,
  researchRunIds: string[],
) {
  return listProcurementCasesMatching(context, { researchRunIds });
}

export async function findProcurementCaseById(context: SupplyAccessContext, caseId: string) {
  const cases = await listProcurementCasesMatching(context, { caseIds: [requiredText(caseId, "Procurement case ID", 220)] });
  return cases[0] ?? null;
}

export async function findProcurementCaseByRelatedTaskId(
  context: SupplyAccessContext,
  relatedTaskId: string,
) {
  const accessContext = await currentAccessContext(context);
  const workspace = await sourcingSystemWorkspace(accessContext, "view");
  const task = await prisma.supplyExecutionTask.findFirst({
    where: {
      id: requiredText(relatedTaskId, "Related procurement task ID", 220),
      officeId: accessContext.officeId,
      workspaceId: workspace.id,
    },
    select: {
      id: true,
      taskType: true,
      parentTaskId: true,
      parentTask: { select: { id: true, taskType: true, parentTaskId: true } },
    },
  });
  if (!task) return null;
  const caseId = task.taskType === TASK_TYPE
    ? task.id
    : task.parentTask?.taskType === TASK_TYPE
      ? task.parentTask.id
      : task.parentTask?.parentTaskId ?? null;
  return caseId ? findProcurementCaseById(accessContext, caseId) : null;
}

export async function procurementEvidenceSource(context: SupplyAccessContext, evidenceId: string) {
  const id = requiredText(evidenceId, "Evidence ID", 220);
  const accessContext = await currentAccessContext(context);
  const workspace = await sourcingSystemWorkspace(accessContext, "view");
  const evidence = await prisma.supplyEvidence.findFirst({
    where: {
      id,
      officeId: context.officeId,
      workspaceId: workspace.id,
      kind: {
        in: [
          "SUPPLIER_SOURCE_REVIEW",
          "SUPPLIER_QUOTE_RELEASE",
          "SUPPLIER_QUOTE_REPLY_EMAIL",
          "SUPPLIER_QUOTE_RESPONSE",
          "PURCHASE_ORDER_RELEASE",
          "SUPPLIER_ORDER_ACKNOWLEDGMENT_REPLY_EMAIL",
          "SUPPLIER_ORDER_ACKNOWLEDGMENT",
        ],
      },
    },
    select: { title: true, sourceUri: true, sourceType: true },
  });
  if (!evidence?.sourceUri) throw new SupplyPersistenceError("Supplier evidence was not found.", "not_found");
  return {
    title: evidence.title,
    url: evidence.sourceType === "CONNECTED_PROVIDER"
      ? connectedProviderUrl(evidence.sourceUri, "Stored connected supplier evidence URL")
      : publicUrl(evidence.sourceUri, "Stored supplier evidence URL"),
  };
}

async function cancelPendingApproval(tx: Prisma.TransactionClient, value: Prisma.JsonValue | null) {
  const approval = record(record(value).approval);
  const approvalId = typeof approval.id === "string" ? approval.id : null;
  const taskId = typeof approval.taskId === "string" ? approval.taskId : null;
  if (approvalId) {
    await tx.supplyApproval.updateMany({
      where: { id: approvalId, status: "PENDING" },
      data: { status: "CANCELLED", decidedAt: new Date(), decisionNote: "Procurement scope changed." },
    });
  }
  if (taskId) {
    await tx.supplyExecutionTask.updateMany({
      where: { id: taskId, status: { in: ["PLANNED", "BLOCKED"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
  }
}

async function cancelActiveQuoteCycles(
  tx: Prisma.TransactionClient,
  procurementCaseId: string,
  officeId: string,
  workspaceId: string,
) {
  const quoteCycles = await tx.supplyExecutionTask.findMany({
    where: {
      officeId,
      workspaceId,
      parentTaskId: procurementCaseId,
      taskType: QUOTE_CYCLE_TASK_TYPE,
      status: { in: ["PLANNED", "RUNNING"] },
    },
    select: { id: true },
  });
  if (quoteCycles.length) {
    const communicationActions = await tx.supplyExecutionTask.findMany({
      where: {
        officeId,
        workspaceId,
        parentTaskId: { in: quoteCycles.map((cycle) => cycle.id) },
        taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE,
        status: { in: ["READY", "RUNNING", "BLOCKED"] },
      },
      select: { result: true },
    });
    const unresolved = communicationActions.some((action) => [
      "SENDING",
      "DELIVERY_UNKNOWN",
      "NOT_FOUND_REVIEW_REQUIRED",
    ].includes(String(record(action.result).state)));
    if (unresolved) {
      throw new SupplyPersistenceError("Supplier email delivery is unresolved. Reconcile it before changing qualification.", "conflict");
    }
  }
  await tx.supplyExecutionTask.updateMany({
    where: {
      officeId,
      workspaceId,
      parentTaskId: procurementCaseId,
      taskType: QUOTE_CYCLE_TASK_TYPE,
      status: { in: ["PLANNED", "RUNNING"] },
    },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
}

async function cancelActivePurchaseDrafts(
  tx: Prisma.TransactionClient,
  procurementCaseId: string,
  officeId: string,
  workspaceId: string,
  excludeTaskId?: string,
) {
  const caseDrafts = await tx.supplyExecutionTask.findMany({
    where: {
      officeId,
      workspaceId,
      parentTaskId: procurementCaseId,
      taskType: PURCHASE_DRAFT_TASK_TYPE,
    },
    select: { id: true },
  });
  const caseDraftIds = caseDrafts.map((draft) => draft.id);
  if (caseDraftIds.length) {
    const releasedAction = await tx.supplyExecutionTask.findFirst({
      where: {
        officeId,
        workspaceId,
        parentTaskId: { in: caseDraftIds },
        taskType: PURCHASE_ACTION_TASK_TYPE,
        status: { in: ["RUNNING", "SUCCEEDED"] },
      },
      select: { id: true },
    });
    if (releasedAction) {
      throw new SupplyPersistenceError("The purchase order has been released. Create a new procurement case instead of changing this external scope.", "conflict");
    }
    const communicationActions = await tx.supplyExecutionTask.findMany({
      where: {
        officeId,
        workspaceId,
        parentTaskId: { in: caseDraftIds },
        taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE,
        status: { in: ["READY", "RUNNING", "BLOCKED"] },
      },
      select: { result: true },
    });
    const unresolvedCommunication = communicationActions.some((action) => [
      "SENDING",
      "DELIVERY_UNKNOWN",
      "NOT_FOUND_REVIEW_REQUIRED",
    ].includes(String(record(action.result).state)));
    if (unresolvedCommunication) {
      throw new SupplyPersistenceError("Purchase order email delivery is unresolved. Reconcile it before changing the sourcing scope.", "conflict");
    }
  }
  const drafts = await tx.supplyExecutionTask.findMany({
    where: {
      officeId,
      workspaceId,
      parentTaskId: procurementCaseId,
      taskType: PURCHASE_DRAFT_TASK_TYPE,
      status: { in: ["PLANNED", "BLOCKED", "READY"] },
      ...(excludeTaskId ? { id: { not: excludeTaskId } } : {}),
    },
    select: { id: true },
  });
  if (drafts.length) {
    const draftIds = drafts.map((draft) => draft.id);
    const actions = await tx.supplyExecutionTask.findMany({
      where: {
        officeId,
        workspaceId,
        parentTaskId: { in: draftIds },
        taskType: PURCHASE_ACTION_TASK_TYPE,
        status: { in: ["PLANNED", "BLOCKED", "READY"] },
      },
      select: { id: true },
    });
    const actionIds = actions.map((action) => action.id);
    if (actionIds.length) {
      await tx.supplyApproval.updateMany({
        where: { officeId, workspaceId, executionTaskId: { in: actionIds }, status: "PENDING" },
        data: { status: "CANCELLED", decidedAt: new Date(), decisionNote: "Purchase draft scope changed." },
      });
      await tx.supplyExecutionTask.updateMany({
        where: { id: { in: actionIds }, officeId, workspaceId },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }
    const communicationTasks = await tx.supplyExecutionTask.findMany({
      where: {
        officeId,
        workspaceId,
        parentTaskId: { in: draftIds },
        taskType: { in: [PURCHASE_ORDER_EMAIL_DRAFT_TASK_TYPE, PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE] },
        status: { in: ["PLANNED", "BLOCKED", "READY"] },
      },
      select: { id: true },
    });
    const communicationTaskIds = communicationTasks.map((task) => task.id);
    if (communicationTaskIds.length) {
      await tx.supplyApproval.updateMany({
        where: { officeId, workspaceId, executionTaskId: { in: communicationTaskIds }, status: "PENDING" },
        data: { status: "CANCELLED", decidedAt: new Date(), decisionNote: "Purchase order scope changed." },
      });
      await tx.supplyExecutionTask.updateMany({
        where: { id: { in: communicationTaskIds }, officeId, workspaceId },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }
  }
  await tx.supplyExecutionTask.updateMany({
    where: {
      officeId,
      workspaceId,
      parentTaskId: procurementCaseId,
      taskType: PURCHASE_DRAFT_TASK_TYPE,
      status: { in: ["PLANNED", "BLOCKED", "READY"] },
      ...(excludeTaskId ? { id: { not: excludeTaskId } } : {}),
    },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
}

async function cancelActivePurchaseActions(
  tx: Prisma.TransactionClient,
  purchaseDraftId: string,
  officeId: string,
  workspaceId: string,
) {
  const actions = await tx.supplyExecutionTask.findMany({
    where: {
      officeId,
      workspaceId,
      parentTaskId: purchaseDraftId,
      taskType: PURCHASE_ACTION_TASK_TYPE,
      status: { in: ["PLANNED", "BLOCKED", "READY"] },
    },
    select: { id: true },
  });
  const actionIds = actions.map((action) => action.id);
  if (!actionIds.length) return;
  await tx.supplyApproval.updateMany({
    where: { officeId, workspaceId, executionTaskId: { in: actionIds }, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decisionNote: "Purchase draft scope changed." },
  });
  await tx.supplyExecutionTask.updateMany({
    where: { id: { in: actionIds }, officeId, workspaceId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
}

export async function saveProcurementShortlist(args: {
  context: SupplyAccessContext;
  researchRunId: string;
  selections: ProcurementSelectionInput[];
}) {
  if (!args.selections.length || args.selections.length > 8) {
    throw new SupplyPersistenceError("A shortlist must contain 1 to 8 supplier options.", "invalid_input");
  }
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  const researchRun = await prisma.supplyCapabilityRun.findFirst({
    where: {
      id: args.researchRunId,
      officeId: args.context.officeId,
      workspaceId: workspace.id,
      capabilityKey: RESEARCH_CAPABILITY,
      status: "SUCCEEDED",
    },
    select: { id: true, input: true, output: true, completedAt: true, createdAt: true },
  });
  if (!researchRun) throw new SupplyPersistenceError("Completed supplier research was not found in this office.", "not_found");

  const canonicalSelections = args.selections.map((selection) => canonicalSelection(
    selection,
    researchRun.output,
    researchRun.completedAt ?? researchRun.createdAt,
  ));
  const uniqueSupplierIds = new Set(canonicalSelections.map((selection) => selection.id));
  if (uniqueSupplierIds.size !== canonicalSelections.length) {
    throw new SupplyPersistenceError("A shortlist cannot contain the same supplier more than once.", "invalid_input");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} AND "taskType" = ${TASK_TYPE} AND "input"->>'researchRunId' = ${researchRun.id} ORDER BY "id" FOR UPDATE`);
        const existingCases = await tx.supplyExecutionTask.findMany({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            taskType: TASK_TYPE,
            input: { path: ["researchRunId"], equals: researchRun.id },
          },
          select: caseSelect,
        });
        const savedCases = [];
        for (const selection of canonicalSelections) {
          const taskKey = `procurement:${researchRun.id}:${digest(selection.id).slice(0, 20)}`;
          const input = {
            researchRunId: researchRun.id,
            researchInput: researchRun.input,
            supplierId: selection.id,
          } satisfies Prisma.InputJsonObject;
          const result = progressionFor(selection) satisfies Prisma.InputJsonObject;
          const existing = existingCases.find((candidate) => record(record(candidate.result).selectedOption).id === selection.id)
            ?? existingCases.find((candidate) => candidate.taskKey === taskKey);
          if (existing && existing.status !== "PLANNED") {
            throw new SupplyPersistenceError(`The procurement workstream for ${selection.name} is no longer editable.`, "conflict");
          }
          if (record(existing?.result).selectionHash === result.selectionHash) {
            savedCases.push(existing!);
            continue;
          }
          if (existing) {
            await cancelPendingApproval(tx, existing.result);
            await cancelActivePurchaseDrafts(tx, existing.id, args.context.officeId, workspace.id);
            await cancelActiveQuoteCycles(tx, existing.id, args.context.officeId, workspace.id);
          }
          const task = existing
            ? await tx.supplyExecutionTask.update({
                where: { id: existing.id },
                data: { input, inputHash: digest(input), result, resultHash: digest(result) },
                select: caseSelect,
              })
            : await tx.supplyExecutionTask.create({
                data: {
                  officeId: args.context.officeId,
                  workspaceId: workspace.id,
                  createdByUserId: args.context.userId,
                  taskKey,
                  taskType: TASK_TYPE,
                  capabilityKey: "draft.procurement_case",
                  requiresApproval: false,
                  input,
                  inputHash: digest(input),
                  result,
                  resultHash: digest(result),
                },
                select: caseSelect,
              });
          const aggregate = await tx.supplyExecutionEvent.aggregate({
            where: { executionTaskId: task.id },
            _max: { sequence: true },
          });
          const sequence = (aggregate._max.sequence ?? 0) + 1;
          await tx.supplyExecutionEvent.create({
            data: {
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              executionTaskId: task.id,
              actorUserId: args.context.userId,
              sequence,
              eventType: existing ? "SUPPLIER_SELECTION_UPDATED" : "PROCUREMENT_CASE_CREATED",
              status: "PLANNED",
              message: existing ? "Supplier workstream evidence changed." : "Supplier workstream created from research shortlist.",
              payload: result,
              payloadHash: digest(result),
              idempotencyKey: `selection:${sequence}:${result.selectionHash}`,
            },
          });
          savedCases.push(task);
        }
        return savedCases;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = retryableTransactionError(error);
      if (!retryable || attempt === 2) {
        if (retryable) throw new SupplyPersistenceError("Procurement shortlist changed concurrently. Retry the selection.", "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Procurement shortlist could not be saved.", "conflict");
}

export async function saveProcurementSelection(args: {
  context: SupplyAccessContext;
  researchRunId: string;
  selection: ProcurementSelectionInput;
}) {
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  const researchRun = await prisma.supplyCapabilityRun.findFirst({
    where: {
      id: args.researchRunId,
      officeId: args.context.officeId,
      workspaceId: workspace.id,
      capabilityKey: RESEARCH_CAPABILITY,
      status: "SUCCEEDED",
    },
    select: { id: true, input: true, output: true, completedAt: true, createdAt: true },
  });
  if (!researchRun) throw new SupplyPersistenceError("Completed supplier research was not found in this office.", "not_found");
  const taskKey = `procurement:${researchRun.id}`;
  const input = { researchRunId: researchRun.id, researchInput: researchRun.input } satisfies Prisma.InputJsonObject;
  const result = progressionFor(canonicalSelection(
    args.selection,
    researchRun.output,
    researchRun.completedAt ?? researchRun.createdAt,
  )) satisfies Prisma.InputJsonObject;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} AND "taskKey" = ${taskKey} AND "taskType" = ${TASK_TYPE} FOR UPDATE`);
        const existing = await tx.supplyExecutionTask.findFirst({
          where: { officeId: args.context.officeId, workspaceId: workspace.id, taskKey, taskType: TASK_TYPE },
          select: caseSelect,
        });
        if (existing && existing.status !== "PLANNED") {
          throw new SupplyPersistenceError("Only a planned procurement case can change supplier selection.", "conflict");
        }
        if (record(existing?.result).selectionHash === result.selectionHash) return existing!;
        if (existing) {
          await cancelPendingApproval(tx, existing.result);
          await cancelActivePurchaseDrafts(tx, existing.id, args.context.officeId, workspace.id);
          await cancelActiveQuoteCycles(tx, existing.id, args.context.officeId, workspace.id);
        }
        const task = existing
          ? await tx.supplyExecutionTask.update({
              where: { id: existing.id },
              data: { result, resultHash: digest(result) },
              select: caseSelect,
            })
          : await tx.supplyExecutionTask.create({
              data: {
                officeId: args.context.officeId,
                workspaceId: workspace.id,
                createdByUserId: args.context.userId,
                taskKey,
                taskType: TASK_TYPE,
                capabilityKey: "draft.procurement_case",
                requiresApproval: false,
                input,
                inputHash: digest(input),
                result,
                resultHash: digest(result),
              },
              select: caseSelect,
            });
        const aggregate = await tx.supplyExecutionEvent.aggregate({
          where: { executionTaskId: task.id },
          _max: { sequence: true },
        });
        const sequence = (aggregate._max.sequence ?? 0) + 1;
        await tx.supplyExecutionEvent.create({
          data: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            executionTaskId: task.id,
            actorUserId: args.context.userId,
            sequence,
            eventType: existing ? "SUPPLIER_SELECTION_UPDATED" : "PROCUREMENT_CASE_CREATED",
            status: "PLANNED",
            message: existing ? "Selected supplier option changed." : "Procurement case created from supplier research.",
            payload: result,
            payloadHash: digest(result),
            idempotencyKey: `selection:${sequence}:${result.selectionHash}`,
          },
        });
        return task;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = retryableTransactionError(error);
      if (!retryable || attempt === 2) {
        if (retryable) throw new SupplyPersistenceError("Procurement case changed concurrently. Retry the selection.", "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Procurement case could not be saved.", "conflict");
}

type ProcurementGate = "SOURCE_EVIDENCE" | "COMMERCIAL_TERMS" | "QUALITY_PLAN";

function resetApproval(result: Record<string, unknown>, gates: Record<string, unknown>) {
  return {
    ...result,
    gates: { ...gates, purchaseApproval: "BLOCKED" },
    approval: null,
  };
}

function normalizeQuoteRequest(input: unknown) {
  const body = record(input);
  const quantity = positiveNumber(body.quantity, "Requested quantity");
  if (quantity > 1_000_000_000) {
    throw new SupplyPersistenceError("Requested quantity must not exceed 1,000,000,000.", "invalid_input");
  }
  const responseDue = requireCurrentOrFutureDate(isoDate(body.responseDue, "Response due date"), "Response due date");
  const needBy = requireCurrentOrFutureDate(isoDate(body.needBy, "Need-by date"), "Need-by date");
  if (responseDue > needBy) {
    throw new SupplyPersistenceError("Response due date cannot be after the need-by date.", "invalid_input");
  }
  return {
    expectedSelectionHash: requiredText(body.expectedSelectionHash, "Selection hash", 128),
    expectedRevision: nonNegativeInteger(body.expectedRevision, "Expected quote-request revision"),
    quantity,
    unitOfMeasure: normalizedUnitOfMeasure(body.unitOfMeasure),
    needBy,
    shipTo: requiredText(body.shipTo, "Ship-to location", 500),
    responseDue,
    requirements: requiredText(body.requirements, "Quote requirements", 2_000),
    note: optionalText(body.note, "Quote-request note", 2_000),
  };
}

function quoteCycleCaseView(
  procurementCase: Prisma.SupplyExecutionTaskGetPayload<{ select: typeof caseSelect }>,
  quoteCycle: Prisma.SupplyExecutionTaskGetPayload<{ select: typeof purchaseDraftSelect }>,
) {
  return { ...procurementCase, quoteCycle, purchaseDraft: null, purchaseAction: null };
}

export async function saveSupplierQuoteRequest(args: {
  context: SupplyAccessContext;
  caseId: string;
  input: unknown;
}) {
  const requestInput = normalizeQuoteRequest(args.input);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.caseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${args.caseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} AND "taskType" = ${QUOTE_CYCLE_TASK_TYPE} ORDER BY "id" FOR UPDATE`);
        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: { id: args.caseId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: TASK_TYPE, status: "PLANNED" },
          select: caseSelect,
        });
        if (!procurementCase) throw new SupplyPersistenceError("Planned procurement case was not found.", "not_found");
        const current = caseResult(procurementCase.result);
        if (current.result.selectionHash !== requestInput.expectedSelectionHash) {
          throw new SupplyPersistenceError("Supplier selection changed. Reload before preparing the quote request.", "conflict");
        }
        if (current.gates.sourceEvidence !== "EVIDENCE_COMPLETE" || current.gates.commercialTerms === "EVIDENCE_COMPLETE") {
          throw new SupplyPersistenceError("The quote request is available only after supplier review and before commercial confirmation.", "conflict");
        }
        requireCurrentSupplierQualification(
          current.reviews.sourceEvidence,
          "Supplier qualification is missing or expired. Requalify the supplier before preparing an RFQ.",
        );
        const existing = await tx.supplyExecutionTask.findFirst({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            parentTaskId: procurementCase.id,
            taskType: QUOTE_CYCLE_TASK_TYPE,
            status: { in: ["PLANNED", "RUNNING"] },
          },
          orderBy: { updatedAt: "desc" },
          select: purchaseDraftSelect,
        });
        if (existing?.status === "RUNNING") {
          throw new SupplyPersistenceError("The supplier quote request is already released and cannot be edited.", "conflict");
        }
        const existingResult = record(existing?.result);
        const request = {
          quantity: new Prisma.Decimal(requestInput.quantity).toString(),
          unitOfMeasure: requestInput.unitOfMeasure,
          needBy: requestInput.needBy,
          shipTo: requestInput.shipTo,
          responseDue: requestInput.responseDue,
          requirements: requestInput.requirements,
          note: requestInput.note,
        };
        const requestHash = digest(request);
        if (existing && existingResult.requestHash === requestHash) {
          return { procurementCase: quoteCycleCaseView(procurementCase, existing), quoteCycle: existing };
        }
        const currentRevision = typeof existingResult.revision === "number" ? existingResult.revision : 0;
        if (requestInput.expectedRevision !== currentRevision) {
          throw new SupplyPersistenceError("The quote request changed in another session. Reload before saving.", "conflict");
        }
        const now = new Date();
        if (existing) {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${existing.id} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
          const emailActions = await tx.supplyExecutionTask.findMany({
            where: {
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              parentTaskId: existing.id,
              taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE,
              status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] },
            },
            select: { id: true, status: true, result: true },
          });
          if (emailActions.some((action) => action.status === "RUNNING" || ["SENDING", "NOT_FOUND_REVIEW_REQUIRED"].includes(String(record(action.result).state)))) {
            throw new SupplyPersistenceError("Supplier email delivery is unresolved. Reconcile it before changing the quote request.", "conflict");
          }
          const cancellableActionIds = emailActions.filter((action) => ["PLANNED", "READY"].includes(action.status)).map((action) => action.id);
          if (cancellableActionIds.length) {
            await tx.supplyApproval.updateMany({ where: { executionTaskId: { in: cancellableActionIds }, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: now, decisionNote: "Supplier quote request changed." } });
            await tx.supplyExecutionTask.updateMany({ where: { id: { in: cancellableActionIds } }, data: { status: "CANCELLED", cancelledAt: now } });
          }
          await tx.supplyExecutionTask.updateMany({
            where: {
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              parentTaskId: existing.id,
              taskType: SUPPLIER_EMAIL_DRAFT_TASK_TYPE,
              status: { in: ["PLANNED", "BLOCKED", "READY"] },
            },
            data: { status: "CANCELLED", cancelledAt: now },
          });
        }
        const revision = currentRevision + 1;
        const taskInput = {
          procurementCaseId: procurementCase.id,
          selectionHash: requestInput.expectedSelectionHash,
          supplier: {
            id: requiredText(current.selectedOption.id, "Supplier ID", 300),
            name: requiredText(current.selectedOption.name, "Supplier name", 300),
            sourceUrl: typeof current.selectedOption.sourceUrl === "string" ? current.selectedOption.sourceUrl : null,
          },
        };
        const result = {
          state: "DRAFT",
          revision,
          request,
          requestHash,
          release: null,
          responses: [],
          selectedResponseHash: null,
          externalSideEffect: false,
          updatedAt: now.toISOString(),
        };
        const priorCycles = existing ? 0 : await tx.supplyExecutionTask.count({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            parentTaskId: procurementCase.id,
            taskType: QUOTE_CYCLE_TASK_TYPE,
          },
        });
        const quoteCycle = existing
          ? await tx.supplyExecutionTask.update({
              where: { id: existing.id },
              data: { result: inputJson(result), resultHash: digest(result) },
              select: purchaseDraftSelect,
            })
          : await tx.supplyExecutionTask.create({
              data: {
                officeId: args.context.officeId,
                workspaceId: workspace.id,
                createdByUserId: args.context.userId,
                parentTaskId: procurementCase.id,
                taskKey: `supplier-quote:${procurementCase.id}:${requestInput.expectedSelectionHash}:${priorCycles + 1}`,
                taskType: QUOTE_CYCLE_TASK_TYPE,
                capabilityKey: QUOTE_CYCLE_CAPABILITY,
                requiresApproval: false,
                input: inputJson(taskInput),
                inputHash: digest(taskInput),
                result: inputJson(result),
                resultHash: digest(result),
              },
              select: purchaseDraftSelect,
            });
        const projected = {
          ...current.result,
          quoteCycle: {
            taskId: quoteCycle.id,
            state: "DRAFT",
            revision,
            requestHash,
            responseCount: 0,
            updatedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        };
        const updatedCase = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(projected), resultHash: digest(projected) },
          select: caseSelect,
        });
        const eventPayload = inputJson({ quoteCycleId: quoteCycle.id, revision, request, requestHash });
        await appendCaseEvent({
          tx,
          caseId: quoteCycle.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType: existing ? "SUPPLIER_QUOTE_REQUEST_UPDATED" : "SUPPLIER_QUOTE_REQUEST_DRAFTED",
          message: existing ? "Supplier quote request draft was updated." : "Supplier quote request draft was created.",
          payload: eventPayload,
        });
        await appendCaseEvent({
          tx,
          caseId: procurementCase.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType: existing ? "SUPPLIER_QUOTE_REQUEST_UPDATED" : "SUPPLIER_QUOTE_REQUEST_DRAFTED",
          message: "Supplier quote request is saved as an internal draft.",
          payload: eventPayload,
        });
        return { procurementCase: quoteCycleCaseView(updatedCase, quoteCycle), quoteCycle };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) throw new SupplyPersistenceError("Quote request changed concurrently. Reload and retry.", "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Supplier quote request could not be saved.", "conflict");
}

function normalizeQuoteRelease(input: unknown) {
  const body = record(input);
  const channel = requiredText(body.channel, "Release channel", 40).toUpperCase();
  if (!QUOTE_CHANNELS.includes(channel as (typeof QUOTE_CHANNELS)[number])) {
    throw new SupplyPersistenceError(`Release channel must be one of: ${QUOTE_CHANNELS.join(", ")}.`, "invalid_input");
  }
  return {
    expectedRequestHash: requiredText(body.expectedRequestHash, "Quote request hash", 128),
    channel: channel as (typeof QUOTE_CHANNELS)[number],
    releasedOn: requireCurrentOrPastDate(isoDate(body.releasedOn, "Release date"), "Release date"),
    evidenceUrl: publicUrl(body.evidenceUrl, "Release evidence URL"),
    note: optionalText(body.note, "Release note", 2_000),
  };
}

export async function recordSupplierQuoteRelease(args: {
  context: SupplyAccessContext;
  quoteCycleId: string;
  input: unknown;
}) {
  const releaseInput = normalizeQuoteRelease(args.input);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  const found = await prisma.supplyExecutionTask.findFirst({
    where: { id: args.quoteCycleId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: QUOTE_CYCLE_TASK_TYPE },
    select: { parentTaskId: true },
  });
  if (!found?.parentTaskId) throw new SupplyPersistenceError("Supplier quote request was not found.", "not_found");
  const procurementCaseId = found.parentTaskId;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.quoteCycleId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${args.quoteCycleId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: { id: procurementCaseId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: TASK_TYPE, status: "PLANNED" },
          select: caseSelect,
        });
        const quoteCycle = await tx.supplyExecutionTask.findFirst({
          where: { id: args.quoteCycleId, officeId: args.context.officeId, workspaceId: workspace.id, parentTaskId: procurementCaseId, taskType: QUOTE_CYCLE_TASK_TYPE, status: { in: ["PLANNED", "RUNNING"] } },
          select: purchaseDraftSelect,
        });
        if (!procurementCase || !quoteCycle) throw new SupplyPersistenceError("Active supplier quote request was not found.", "not_found");
        const current = caseResult(procurementCase.result);
        const cycleInput = record(quoteCycle.input);
        const cycleResult = record(quoteCycle.result);
        if (cycleInput.selectionHash !== current.result.selectionHash || cycleResult.requestHash !== releaseInput.expectedRequestHash) {
          throw new SupplyPersistenceError("Supplier or quote request changed. Reload before recording release.", "conflict");
        }
        const normalizedRelease = {
          channel: releaseInput.channel,
          releasedOn: releaseInput.releasedOn,
          evidenceUrl: releaseInput.evidenceUrl,
          note: releaseInput.note,
        };
        const releaseHash = digest(normalizedRelease);
        const existingRelease = record(cycleResult.release);
        if (existingRelease.releaseHash === releaseHash) {
          return { procurementCase: quoteCycleCaseView(procurementCase, quoteCycle), quoteCycle, release: existingRelease };
        }
        if (typeof existingRelease.releaseHash === "string" || quoteCycle.status !== "PLANNED") {
          throw new SupplyPersistenceError("A different external release is already recorded for this quote request.", "conflict");
        }
        if (!supplierQualificationValidOn(current.reviews.sourceEvidence, releaseInput.releasedOn)) {
          throw new SupplyPersistenceError("Supplier qualification was not valid on the release date. Requalify the supplier before recording contact.", "conflict");
        }
        const activeSupplierEmail = await tx.supplyExecutionTask.findFirst({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            parentTaskId: quoteCycle.id,
            taskType: SUPPLIER_EMAIL_ACTION_TASK_TYPE,
            OR: [
              { status: { in: ["PLANNED", "READY", "RUNNING"] } },
              { status: "BLOCKED", result: { path: ["state"], equals: "NOT_FOUND_REVIEW_REQUIRED" } },
            ],
          },
          select: { id: true },
        });
        if (activeSupplierEmail) {
          throw new SupplyPersistenceError("A connected supplier email is pending, approved, or unresolved. Finish or revise that workflow before recording another channel.", "conflict");
        }
        const now = new Date();
        const release = {
          ...normalizedRelease,
          evidenceClass: "OPERATOR_RECORDED_EXTERNAL",
          releaseHash,
          recordedByUserId: args.context.userId,
          recordedAt: now.toISOString(),
        };
        const supplier = record(cycleInput.supplier);
        const evidence = await appendExternalEvidence({
          tx,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          executionTaskId: quoteCycle.id,
          actorUserId: args.context.userId,
          kind: "SUPPLIER_QUOTE_RELEASE",
          title: `Quote request release for ${requiredText(supplier.name, "Supplier name", 300)}`,
          sourceUri: releaseInput.evidenceUrl,
          sourceRecordId: releaseInput.expectedRequestHash,
          observedOn: releaseInput.releasedOn,
          contentHash: releaseHash,
          payload: inputJson(normalizedRelease),
        });
        const evidencedRelease = { ...release, evidenceId: evidence.id };
        const result = {
          ...cycleResult,
          state: "AWAITING_RESPONSE",
          release: evidencedRelease,
          externalSideEffect: "RECORDED_ONLY",
          updatedAt: now.toISOString(),
        };
        await tx.supplyExecutionTask.update({
          where: { id: quoteCycle.id },
          data: { status: "READY" },
        });
        const updatedCycle = await tx.supplyExecutionTask.update({
          where: { id: quoteCycle.id },
          data: { status: "RUNNING", startedAt: now, result: inputJson(result), resultHash: digest(result) },
          select: purchaseDraftSelect,
        });
        const projected = {
          ...current.result,
          quoteCycle: {
            taskId: quoteCycle.id,
            state: "AWAITING_RESPONSE",
            revision: cycleResult.revision,
            requestHash: cycleResult.requestHash,
            responseCount: 0,
            releasedOn: evidencedRelease.releasedOn,
            updatedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        };
        const updatedCase = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(projected), resultHash: digest(projected) },
          select: caseSelect,
        });
        const eventPayload = inputJson({ quoteCycleId: quoteCycle.id, release: evidencedRelease });
        await appendCaseEvent({ tx, caseId: quoteCycle.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: "SUPPLIER_QUOTE_REQUEST_RELEASE_RECORDED", status: "RUNNING", message: "External supplier quote-request release was recorded.", payload: eventPayload });
        await appendCaseEvent({ tx, caseId: procurementCase.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: "SUPPLIER_QUOTE_REQUEST_RELEASE_RECORDED", message: "The quote request is awaiting a supplier response.", payload: eventPayload });
        return { procurementCase: quoteCycleCaseView(updatedCase, updatedCycle), quoteCycle: updatedCycle, release: evidencedRelease };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) throw new SupplyPersistenceError("Quote-request release changed concurrently. Reload and retry.", "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Supplier quote-request release could not be recorded.", "conflict");
}

function normalizeQuoteResponse(input: unknown) {
  const body = record(input);
  const price = positiveNumber(body.price, "Price");
  const minimumOrderQuantity = positiveNumber(body.minimumOrderQuantity, "Minimum order quantity");
  if (price > 1_000_000_000_000 || minimumOrderQuantity > 1_000_000_000) {
    throw new SupplyPersistenceError("Quote price or minimum order quantity exceeds the supported limit.", "invalid_input");
  }
  const currency = requiredText(body.currency, "Currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new SupplyPersistenceError("Currency must be a three-letter ISO code.", "invalid_input");
  const receivedOn = requireCurrentOrPastDate(isoDate(body.receivedOn, "Response date"), "Response date");
  const deliveryDate = requireCurrentOrFutureDate(isoDate(body.deliveryDate, "Delivery date"), "Delivery date");
  const validUntil = requireCurrentOrFutureDate(isoDate(body.validUntil, "Quote validity date"), "Quote validity date");
  if (deliveryDate < receivedOn || validUntil < receivedOn) {
    throw new SupplyPersistenceError("Delivery and quote validity cannot precede the supplier response.", "invalid_input");
  }
  const connectedReplyEvidenceId = optionalText(body.connectedReplyEvidenceId, "Connected reply evidence ID", 220);
  const evidenceUrlInput = optionalText(body.evidenceUrl, "Supplier quote evidence URL", 2_000);
  if (Boolean(connectedReplyEvidenceId) === Boolean(evidenceUrlInput)) {
    throw new SupplyPersistenceError("Choose exactly one connected supplier reply or external evidence URL.", "invalid_input");
  }
  return {
    expectedRequestHash: requiredText(body.expectedRequestHash, "Quote request hash", 128),
    receivedOn,
    price,
    currency,
    minimumOrderQuantity,
    unitOfMeasure: normalizedUnitOfMeasure(body.unitOfMeasure),
    deliveryDate,
    quoteReference: requiredText(body.quoteReference, "Quote reference", 300),
    validUntil,
    evidenceUrl: evidenceUrlInput ? publicUrl(evidenceUrlInput, "Supplier quote evidence URL") : null,
    connectedReplyEvidenceId: connectedReplyEvidenceId ?? null,
    note: optionalText(body.note, "Supplier quote note", 2_000),
  };
}

export async function recordSupplierQuoteResponse(args: {
  context: SupplyAccessContext;
  quoteCycleId: string;
  input: unknown;
}) {
  const responseInput = normalizeQuoteResponse(args.input);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  const found = await prisma.supplyExecutionTask.findFirst({
    where: { id: args.quoteCycleId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: QUOTE_CYCLE_TASK_TYPE },
    select: { parentTaskId: true },
  });
  if (!found?.parentTaskId) throw new SupplyPersistenceError("Supplier quote request was not found.", "not_found");
  const procurementCaseId = found.parentTaskId;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.quoteCycleId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: { id: procurementCaseId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: TASK_TYPE, status: "PLANNED" },
          select: caseSelect,
        });
        const quoteCycle = await tx.supplyExecutionTask.findFirst({
          where: { id: args.quoteCycleId, officeId: args.context.officeId, workspaceId: workspace.id, parentTaskId: procurementCaseId, taskType: QUOTE_CYCLE_TASK_TYPE, status: "RUNNING" },
          select: purchaseDraftSelect,
        });
        if (!procurementCase || !quoteCycle) throw new SupplyPersistenceError("Released supplier quote request was not found.", "not_found");
        const current = caseResult(procurementCase.result);
        const cycleInput = record(quoteCycle.input);
        const cycleResult = record(quoteCycle.result);
        const release = record(cycleResult.release);
        const request = record(cycleResult.request);
        if (cycleInput.selectionHash !== current.result.selectionHash || cycleResult.requestHash !== responseInput.expectedRequestHash) {
          throw new SupplyPersistenceError("Supplier or quote request changed. Reload before recording the response.", "conflict");
        }
        if (typeof release.releaseHash !== "string" || typeof release.releasedOn !== "string") {
          throw new SupplyPersistenceError("Record the external quote-request release before its supplier response.", "conflict");
        }
        if (responseInput.receivedOn < release.releasedOn) {
          throw new SupplyPersistenceError("Supplier response cannot precede the recorded quote-request release.", "invalid_input");
        }
        const requestedUnit = normalizedUnitOfMeasure(request.unitOfMeasure, "Requested unit");
        if (responseInput.unitOfMeasure !== requestedUnit) {
          throw new SupplyPersistenceError(`Supplier quote unit must match the requested unit ${requestedUnit}.`, "invalid_input");
        }
        const connectedReplyEvidence = responseInput.connectedReplyEvidenceId
          ? await tx.supplyEvidence.findFirst({
              where: {
                id: responseInput.connectedReplyEvidenceId,
                officeId: args.context.officeId,
                workspaceId: workspace.id,
                executionTaskId: quoteCycle.id,
                kind: "SUPPLIER_QUOTE_REPLY_EMAIL",
                sourceType: "CONNECTED_PROVIDER",
              },
              select: { id: true, sourceUri: true, sourceRecordId: true, observedAt: true },
            })
          : null;
        if (responseInput.connectedReplyEvidenceId && (!connectedReplyEvidence?.sourceUri || !connectedReplyEvidence.observedAt)) {
          throw new SupplyPersistenceError("Connected supplier reply evidence is outside the current quote cycle.", "conflict");
        }
        if (connectedReplyEvidence && connectedReplyEvidence.observedAt?.toISOString().slice(0, 10) !== responseInput.receivedOn) {
          throw new SupplyPersistenceError("Response date must match the connected supplier reply date.", "invalid_input");
        }
        const evidenceUrl = connectedReplyEvidence?.sourceUri
          ? connectedProviderUrl(connectedReplyEvidence.sourceUri, "Connected supplier reply URL")
          : responseInput.evidenceUrl!;
        const evidenceClass = connectedReplyEvidence ? "CONNECTED_PROVIDER" : "OPERATOR_RECORDED_EXTERNAL";
        const normalizedResponse = {
          receivedOn: responseInput.receivedOn,
          price: new Prisma.Decimal(responseInput.price).toString(),
          currency: responseInput.currency,
          minimumOrderQuantity: new Prisma.Decimal(responseInput.minimumOrderQuantity).toString(),
          unitOfMeasure: responseInput.unitOfMeasure,
          deliveryDate: responseInput.deliveryDate,
          quoteReference: responseInput.quoteReference,
          validUntil: responseInput.validUntil,
          evidenceUrl,
          connectedReplyEvidenceId: connectedReplyEvidence?.id ?? null,
          note: responseInput.note,
        };
        const responseHash = digest(normalizedResponse);
        const responses = Array.isArray(cycleResult.responses) ? cycleResult.responses.map((value) => record(value)) : [];
        const repeated = responses.find((response) => response.responseHash === responseHash);
        if (repeated) return { procurementCase: quoteCycleCaseView(procurementCase, quoteCycle), quoteCycle, response: repeated };
        const now = new Date();
        const response = {
          ...normalizedResponse,
          evidenceClass,
          responseHash,
          recordedByUserId: args.context.userId,
          recordedAt: now.toISOString(),
        };
        const evidence = await appendExternalEvidence({
          tx,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          executionTaskId: quoteCycle.id,
          actorUserId: args.context.userId,
          kind: "SUPPLIER_QUOTE_RESPONSE",
          title: `Supplier quote ${responseInput.quoteReference}`,
          sourceType: evidenceClass,
          sourceUri: evidenceUrl,
          sourceRecordId: connectedReplyEvidence?.sourceRecordId ?? responseInput.quoteReference,
          observedOn: responseInput.receivedOn,
          contentHash: responseHash,
          payload: inputJson({ ...normalizedResponse, sourceEvidenceId: connectedReplyEvidence?.id ?? null }),
        });
        const evidencedResponse = { ...response, evidenceId: evidence.id };
        const result = {
          ...cycleResult,
          state: typeof cycleResult.selectedResponseHash === "string" ? "RESPONSE_SELECTED" : "RESPONSES_RECEIVED",
          responses: [...responses, evidencedResponse],
          updatedAt: now.toISOString(),
        };
        const updatedCycle = await tx.supplyExecutionTask.update({
          where: { id: quoteCycle.id },
          data: { result: inputJson(result), resultHash: digest(result) },
          select: purchaseDraftSelect,
        });
        const projected = {
          ...current.result,
          quoteCycle: {
            taskId: quoteCycle.id,
            state: result.state,
            revision: cycleResult.revision,
            requestHash: cycleResult.requestHash,
            responseCount: responses.length + 1,
            releasedOn: release.releasedOn,
            lastQuoteReference: evidencedResponse.quoteReference,
            updatedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        };
        const updatedCase = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(projected), resultHash: digest(projected) },
          select: caseSelect,
        });
        const eventPayload = inputJson({ quoteCycleId: quoteCycle.id, response: evidencedResponse });
        await appendCaseEvent({ tx, caseId: quoteCycle.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: "SUPPLIER_QUOTE_RESPONSE_RECORDED", status: "RUNNING", message: "Supplier quote response was recorded.", payload: eventPayload });
        await appendCaseEvent({ tx, caseId: procurementCase.id, officeId: args.context.officeId, workspaceId: workspace.id, actorUserId: args.context.userId, eventType: "SUPPLIER_QUOTE_RESPONSE_RECORDED", message: "A supplier quote response is ready for commercial review.", payload: eventPayload });
        return { procurementCase: quoteCycleCaseView(updatedCase, updatedCycle), quoteCycle: updatedCycle, response: evidencedResponse };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) throw new SupplyPersistenceError("Supplier quote response changed concurrently. Reload and retry.", "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Supplier quote response could not be recorded.", "conflict");
}

export async function reviewProcurementGate(args: {
  context: SupplyAccessContext;
  caseId: string;
  input: unknown;
}) {
  const body = record(args.input);
  const gate = body.gate as ProcurementGate;
  if (!["SOURCE_EVIDENCE", "COMMERCIAL_TERMS", "QUALITY_PLAN"].includes(gate)) {
    throw new SupplyPersistenceError("A valid procurement review gate is required.", "invalid_input");
  }
  const expectedSelectionHash = requiredText(body.expectedSelectionHash, "Selection hash", 128);
  let sourceQualificationInput: Record<string, unknown> | null = null;
  if (gate === "SOURCE_EVIDENCE") {
    const outcome = requiredText(body.outcome, "Supplier qualification outcome", 20).toUpperCase();
    const note = requiredText(body.note, "Qualification review note", 2_000);
    if (outcome === "QUALIFIED") {
      const relationship = requiredText(body.relationship, "Supplier relationship", 40).toUpperCase();
      if (!SUPPLIER_RELATIONSHIPS.includes(relationship as (typeof SUPPLIER_RELATIONSHIPS)[number])) {
        throw new SupplyPersistenceError("Supplier relationship must be manufacturer, authorized distributor, or independent distributor.", "invalid_input");
      }
      const authorizationEvidenceUrl = optionalText(body.authorizationEvidenceUrl, "Authorization evidence URL", 2_000);
      if (relationship === "AUTHORIZED_DISTRIBUTOR" && !authorizationEvidenceUrl) {
        throw new SupplyPersistenceError("Authorized distributor qualification requires manufacturer authorization evidence.", "invalid_input");
      }
      sourceQualificationInput = {
        outcome,
        relationship,
        identityEvidenceUrl: publicUrl(body.identityEvidenceUrl, "Identity evidence URL"),
        capabilityEvidenceUrl: publicUrl(body.capabilityEvidenceUrl, "Component capability evidence URL"),
        authorizationEvidenceUrl: authorizationEvidenceUrl ? publicUrl(authorizationEvidenceUrl, "Authorization evidence URL") : null,
        validUntil: requireCurrentOrFutureDate(isoDate(body.validUntil, "Qualification validity date"), "Qualification validity date"),
        note,
      };
    } else if (outcome === "REJECTED") {
      const rejectionReason = requiredText(body.rejectionReason, "Supplier rejection reason", 40).toUpperCase();
      if (!SUPPLIER_REJECTION_REASONS.includes(rejectionReason as (typeof SUPPLIER_REJECTION_REASONS)[number])) {
        throw new SupplyPersistenceError("Supplier rejection reason is invalid.", "invalid_input");
      }
      sourceQualificationInput = { outcome, rejectionReason, note };
    } else {
      throw new SupplyPersistenceError("Supplier qualification outcome must be QUALIFIED or REJECTED.", "invalid_input");
    }
  }
  const quoteCycleTaskId = gate === "COMMERCIAL_TERMS"
    ? requiredText(body.quoteCycleTaskId, "Quote cycle task ID", 220)
    : null;
  const quoteResponseHash = gate === "COMMERCIAL_TERMS"
    ? requiredText(body.responseHash, "Quote response hash", 128)
    : null;
  let qualityPlanInput: Record<string, unknown> | null = null;
  if (gate === "QUALITY_PLAN") {
    const method = requiredText(body.method, "Quality method", 80);
    if (!["SAMPLE", "PRE_SHIPMENT_INSPECTION", "DOCUMENT_REVIEW"].includes(method)) {
      throw new SupplyPersistenceError("Quality method must be sample, pre-shipment inspection, or document review.", "invalid_input");
    }
    qualityPlanInput = {
      method,
      acceptanceCriteria: requiredText(body.acceptanceCriteria, "Acceptance criteria", 2_000),
      owner: requiredText(body.owner, "Quality owner", 200),
      targetDate: requireCurrentOrFutureDate(isoDate(body.targetDate, "Quality target date"), "Quality target date"),
    };
  }
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.caseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: {
            id: args.caseId,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            taskType: TASK_TYPE,
            status: "PLANNED",
          },
          select: caseSelect,
        });
        if (!procurementCase) throw new SupplyPersistenceError("Planned procurement case was not found.", "not_found");
        const current = caseResult(procurementCase.result);
        if (current.result.selectionHash !== expectedSelectionHash) {
          throw new SupplyPersistenceError("Supplier selection changed. Reload this procurement case before reviewing it.", "conflict");
        }

        const now = new Date().toISOString();
        let result = { ...current.result };
        let gates = { ...current.gates };
        let reviews = { ...current.reviews };
        let eventType = "";
        let message = "";
        let review: Record<string, unknown>;

        if (gate === "SOURCE_EVIDENCE") {
          const sourceUrl = current.selectedOption.sourceUrl;
          if (sourceQualificationInput?.outcome === "QUALIFIED" && typeof sourceUrl !== "string") {
            throw new SupplyPersistenceError("An attributable supplier source is required before evidence review.", "conflict");
          }
          const qualification = sourceQualificationInput!;
          review = {
            sourceUrl: typeof sourceUrl === "string" ? publicUrl(sourceUrl, "Supplier source") : null,
            ...qualification,
            reviewedByUserId: args.context.userId,
            reviewedAt: now,
          };
          if (qualification.outcome === "QUALIFIED"
            && !sameWebDomain(review.sourceUrl as string, qualification.identityEvidenceUrl as string)) {
            throw new SupplyPersistenceError("Identity evidence must match the attributed supplier domain.", "invalid_input");
          }
          review.reviewHash = digest({ sourceUrl: review.sourceUrl, ...qualification });
          if (record(reviews.sourceEvidence).reviewHash === review.reviewHash) return procurementCase;
          const sourceEvidence = await appendExternalEvidence({
            tx,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            executionTaskId: procurementCase.id,
            actorUserId: args.context.userId,
            kind: "SUPPLIER_QUALIFICATION",
            title: `Supplier qualification for ${requiredText(current.selectedOption.name, "Supplier name", 300)}`,
            sourceType: "OPERATOR_RECORDED_EXTERNAL",
            sourceUri: review.sourceUrl as string | null,
            sourceRecordId: requiredText(current.selectedOption.id, "Supplier ID", 300),
            observedOn: now.slice(0, 10),
            contentHash: review.reviewHash as string,
            payload: inputJson({ sourceUrl: review.sourceUrl, ...qualification }),
          });
          review.evidenceId = sourceEvidence.id;
          await cancelPendingApproval(tx, procurementCase.result);
          await cancelActivePurchaseDrafts(tx, procurementCase.id, args.context.officeId, workspace.id);
          await cancelActiveQuoteCycles(tx, procurementCase.id, args.context.officeId, workspace.id);
          reviews = { sourceEvidence: review };
          const qualified = qualification.outcome === "QUALIFIED";
          gates = {
            ...gates,
            sourceEvidence: qualified ? "EVIDENCE_COMPLETE" : "BLOCKED",
            commercialTerms: "REVIEW_REQUIRED",
            qualityPlan: "REVIEW_REQUIRED",
            purchaseApproval: "BLOCKED",
          };
          delete result.confirmedTerms;
          delete result.qualityPlan;
          delete result.quoteCycle;
          result = resetApproval(result, gates);
          eventType = qualified ? "SUPPLIER_QUALIFIED" : "SUPPLIER_REJECTED";
          message = qualified ? "Supplier qualification evidence was accepted." : "Supplier was rejected during qualification.";
        } else if (gate === "COMMERCIAL_TERMS") {
          if (gates.sourceEvidence !== "EVIDENCE_COMPLETE") {
            throw new SupplyPersistenceError("Review supplier evidence before confirming commercial terms.", "conflict");
          }
          requireCurrentSupplierQualification(
            reviews.sourceEvidence,
            "Supplier qualification is missing or expired. Requalify the supplier before confirming commercial terms.",
          );
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${quoteCycleTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
          const quoteCycle = await tx.supplyExecutionTask.findFirst({
            where: {
              id: quoteCycleTaskId!,
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              parentTaskId: procurementCase.id,
              taskType: QUOTE_CYCLE_TASK_TYPE,
              status: "RUNNING",
            },
            select: purchaseDraftSelect,
          });
          if (!quoteCycle) throw new SupplyPersistenceError("Released supplier quote cycle was not found.", "not_found");
          const cycleInput = record(quoteCycle.input);
          const cycleResult = record(quoteCycle.result);
          if (cycleInput.selectionHash !== expectedSelectionHash) {
            throw new SupplyPersistenceError("The supplier quote belongs to a different selection.", "conflict");
          }
          const responses = Array.isArray(cycleResult.responses) ? cycleResult.responses.map((value) => record(value)) : [];
          const response = responses.find((value) => value.responseHash === quoteResponseHash);
          if (!response) throw new SupplyPersistenceError("The selected supplier quote response was not found.", "not_found");
          const currency = requiredText(response.currency, "Stored quote currency", 3).toUpperCase();
          if (!/^[A-Z]{3}$/.test(currency)) throw new SupplyPersistenceError("Stored quote currency is invalid.", "conflict");
          let price: number;
          let minimumOrderQuantity: number;
          try {
            price = new Prisma.Decimal(requiredText(response.price, "Stored quote price", 80)).toNumber();
            minimumOrderQuantity = new Prisma.Decimal(requiredText(response.minimumOrderQuantity, "Stored quote MOQ", 80)).toNumber();
          } catch {
            throw new SupplyPersistenceError("Stored supplier quote quantities are invalid.", "conflict");
          }
          if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(minimumOrderQuantity) || minimumOrderQuantity <= 0) {
            throw new SupplyPersistenceError("Stored supplier quote quantities are invalid.", "conflict");
          }
          const quoteEvidenceHash = requiredText(response.responseHash, "Stored quote response hash", 128);
          const quoteEvidenceClass = requiredText(response.evidenceClass, "Stored quote evidence class", 80);
          if (!["OPERATOR_RECORDED_EXTERNAL", "CONNECTED_PROVIDER"].includes(quoteEvidenceClass)) {
            throw new SupplyPersistenceError("Stored quote evidence class is invalid.", "conflict");
          }
          const quoteEvidenceUrl = quoteEvidenceClass === "CONNECTED_PROVIDER"
            ? connectedProviderUrl(response.evidenceUrl, "Stored connected quote evidence URL")
            : publicUrl(response.evidenceUrl, "Stored quote evidence URL");
          const quoteEvidence = typeof response.evidenceId === "string"
            ? await tx.supplyEvidence.findFirst({
                where: {
                  id: response.evidenceId,
                  officeId: args.context.officeId,
                  workspaceId: workspace.id,
                  executionTaskId: quoteCycle.id,
                  kind: "SUPPLIER_QUOTE_RESPONSE",
                  contentHash: quoteEvidenceHash,
                  sourceType: quoteEvidenceClass,
                },
                select: { id: true },
              })
            : await appendExternalEvidence({
                tx,
                officeId: args.context.officeId,
                workspaceId: workspace.id,
                executionTaskId: quoteCycle.id,
                actorUserId: args.context.userId,
                kind: "SUPPLIER_QUOTE_RESPONSE",
                title: `Supplier quote ${requiredText(response.quoteReference, "Stored quote reference", 300)}`,
                sourceUri: quoteEvidenceUrl,
                sourceRecordId: requiredText(response.quoteReference, "Stored quote reference", 300),
                observedOn: isoDate(response.receivedOn, "Stored quote response date"),
                contentHash: quoteEvidenceHash,
                payload: inputJson(response),
              });
          if (!quoteEvidence) {
            throw new SupplyPersistenceError("Stored supplier quote evidence is outside the current procurement scope.", "conflict");
          }
          const confirmedTerms = {
            price,
            currency,
            minimumOrderQuantity,
            unitOfMeasure: normalizedUnitOfMeasure(response.unitOfMeasure, "Stored quote unit"),
            deliveryDate: requireCurrentOrFutureDate(isoDate(response.deliveryDate, "Stored delivery date"), "Stored delivery date"),
            evidenceUrl: quoteEvidenceUrl,
            evidenceId: quoteEvidence.id,
            quoteReference: requiredText(response.quoteReference, "Stored quote reference", 300),
            validUntil: requireCurrentOrFutureDate(isoDate(response.validUntil, "Stored quote validity date"), "Stored quote validity date"),
            quoteCycleTaskId: quoteCycle.id,
            responseHash: quoteResponseHash!,
            evidenceClass: quoteEvidenceClass,
          };
          review = {
            ...confirmedTerms,
            reviewedByUserId: args.context.userId,
            reviewedAt: now,
          };
          review.reviewHash = digest(confirmedTerms);
          if (record(reviews.commercialTerms).reviewHash === review.reviewHash) return procurementCase;
          await cancelPendingApproval(tx, procurementCase.result);
          await cancelActivePurchaseDrafts(tx, procurementCase.id, args.context.officeId, workspace.id);
          reviews = { ...reviews, commercialTerms: review };
          delete reviews.qualityPlan;
          gates = {
            ...gates,
            commercialTerms: "EVIDENCE_COMPLETE",
            qualityPlan: "REVIEW_REQUIRED",
            purchaseApproval: "BLOCKED",
          };
          delete result.qualityPlan;
          const quoteProjection = record(result.quoteCycle);
          result = resetApproval({
            ...result,
            confirmedTerms,
            quoteCycle: {
              ...quoteProjection,
              state: "RESPONSE_SELECTED",
              selectedResponseHash: quoteResponseHash,
              updatedAt: now,
            },
          }, gates);
          const selectedCycleResult = {
            ...cycleResult,
            state: "RESPONSE_SELECTED",
            selectedResponseHash: quoteResponseHash,
            updatedAt: now,
          };
          await tx.supplyExecutionTask.update({
            where: { id: quoteCycle.id },
            data: { result: inputJson(selectedCycleResult), resultHash: digest(selectedCycleResult) },
          });
          await appendCaseEvent({
            tx,
            caseId: quoteCycle.id,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            actorUserId: args.context.userId,
            eventType: "SUPPLIER_QUOTE_RESPONSE_SELECTED",
            status: "RUNNING",
            message: "Supplier quote response was selected for commercial review.",
            payload: inputJson({ responseHash: quoteResponseHash, selectionHash: expectedSelectionHash }),
          });
          eventType = "COMMERCIAL_TERMS_CONFIRMED";
          message = "Supplier commercial terms were confirmed.";
        } else {
          if (gates.sourceEvidence !== "EVIDENCE_COMPLETE" || gates.commercialTerms !== "EVIDENCE_COMPLETE") {
            throw new SupplyPersistenceError("Complete supplier and commercial review before recording a quality plan.", "conflict");
          }
          requireCurrentSupplierQualification(
            reviews.sourceEvidence,
            "Supplier qualification is missing or expired. Requalify the supplier before recording a quality plan.",
          );
          const qualityPlan = qualityPlanInput!;
          review = {
            ...qualityPlan,
            reviewedByUserId: args.context.userId,
            reviewedAt: now,
          };
          review.reviewHash = digest(qualityPlan);
          if (record(reviews.qualityPlan).reviewHash === review.reviewHash) return procurementCase;
          await cancelPendingApproval(tx, procurementCase.result);
          await cancelActivePurchaseDrafts(tx, procurementCase.id, args.context.officeId, workspace.id);
          reviews = { ...reviews, qualityPlan: review };
          gates = { ...gates, qualityPlan: "EVIDENCE_COMPLETE", purchaseApproval: "BLOCKED" };
          result = resetApproval({ ...result, qualityPlan }, gates);
          eventType = "QUALITY_PLAN_RECORDED";
          message = "Supplier quality plan was recorded.";
        }

        result = {
          ...result,
          gates,
          reviews,
          stage: gate === "SOURCE_EVIDENCE" && sourceQualificationInput?.outcome === "REJECTED"
            ? "SUPPLIER_REJECTED"
            : nextStage(gates),
          updatedAt: now,
        };
        delete result.purchasePreparation;
        const updated = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(result), resultHash: digest(result) },
          select: caseSelect,
        });
        await appendCaseEvent({
          tx,
          caseId: procurementCase.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType,
          message,
          payload: inputJson({ gate, review, selectionHash: expectedSelectionHash }),
        });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) {
          throw new SupplyPersistenceError("Procurement review changed concurrently. Retry the review.", "conflict");
        }
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Procurement review could not be saved.", "conflict");
}

export async function requestProcurementApproval(args: {
  context: SupplyAccessContext;
  caseId: string;
  input: unknown;
}) {
  const body = record(args.input);
  const reason = requiredText(body.reason, "Approval reason", 2_000);
  const expectedSelectionHash = requiredText(body.expectedSelectionHash, "Selection hash", 128);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "SupplyExecutionTask"
          WHERE "officeId" = ${args.context.officeId}
            AND "workspaceId" = ${workspace.id}
            AND "taskType" = ${TASK_TYPE}
            AND "input"->>'researchRunId' = (
              SELECT "input"->>'researchRunId'
              FROM "SupplyExecutionTask"
              WHERE "id" = ${args.caseId}
                AND "officeId" = ${args.context.officeId}
                AND "workspaceId" = ${workspace.id}
                AND "taskType" = ${TASK_TYPE}
            )
          ORDER BY "id"
          FOR UPDATE
        `);
        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: {
            id: args.caseId,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            taskType: TASK_TYPE,
            status: "PLANNED",
          },
          select: caseSelect,
        });
        if (!procurementCase) throw new SupplyPersistenceError("Planned procurement case was not found.", "not_found");
        const current = caseResult(procurementCase.result);
        const researchRunId = record(procurementCase.input).researchRunId;
        if (typeof researchRunId !== "string") {
          throw new SupplyPersistenceError("Procurement case is not linked to supplier research.", "conflict");
        }
        const siblingCases = await tx.supplyExecutionTask.findMany({
          where: {
            id: { not: procurementCase.id },
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            taskType: TASK_TYPE,
            status: "PLANNED",
            input: { path: ["researchRunId"], equals: researchRunId },
          },
          select: { result: true },
        });
        const siblingAward = siblingCases.find((candidate) => {
          const purchaseApproval = record(record(candidate.result).gates).purchaseApproval;
          return purchaseApproval === "PENDING" || purchaseApproval === "APPROVED";
        });
        if (siblingAward) {
          throw new SupplyPersistenceError("Another supplier is already pending or approved for this sourcing request. Resolve that award before selecting a different supplier.", "conflict");
        }
        if (current.result.selectionHash !== expectedSelectionHash) {
          throw new SupplyPersistenceError("Supplier selection changed. Reload before requesting approval.", "conflict");
        }
        if (["sourceEvidence", "commercialTerms", "qualityPlan"].some((key) => current.gates[key] !== "EVIDENCE_COMPLETE")) {
          throw new SupplyPersistenceError("All supplier, commercial, and quality gates must be complete before approval.", "conflict");
        }
        requireCurrentSupplierQualification(
          current.reviews.sourceEvidence,
          "Supplier qualification expired before award approval. Requalify the supplier.",
        );
        const confirmedTerms = record(current.result.confirmedTerms);
        if (typeof confirmedTerms.validUntil !== "string" || confirmedTerms.validUntil < todayUtc()) {
          throw new SupplyPersistenceError("The supplier quote has expired. Confirm current commercial terms before approval.", "conflict");
        }
        if (typeof confirmedTerms.deliveryDate !== "string" || confirmedTerms.deliveryDate < todayUtc()) {
          throw new SupplyPersistenceError("The planned delivery date has passed. Confirm current commercial terms before approval.", "conflict");
        }
        const qualityPlan = record(current.result.qualityPlan);
        if (typeof qualityPlan.targetDate !== "string" || qualityPlan.targetDate < todayUtc()) {
          throw new SupplyPersistenceError("The quality review date has passed. Record a current quality plan before approval.", "conflict");
        }
        const immutableInput = {
          procurementCaseId: procurementCase.id,
          researchRunId: record(procurementCase.input).researchRunId,
          selectionHash: expectedSelectionHash,
          selectedOption: current.selectedOption,
          sourceEvidenceReview: record(current.reviews.sourceEvidence),
          confirmedTerms,
          qualityPlan,
        };
        const scopeHash = digest(immutableInput);
        const existingApproval = await tx.supplyApproval.findFirst({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            scopeHash,
            executionTask: {
              parentTaskId: procurementCase.id,
              taskType: APPROVAL_TASK_TYPE,
              capabilityKey: APPROVAL_CAPABILITY,
            },
          },
          orderBy: { requestedAt: "desc" },
        });
        if (existingApproval?.status === "PENDING") {
          return { procurementCase, approval: existingApproval };
        }
        if (existingApproval && ["APPROVED", "REJECTED"].includes(existingApproval.status)) {
          throw new SupplyPersistenceError("This exact procurement scope was already decided. Revise a gate before requesting another approval.", "conflict");
        }
        const priorAttempts = await tx.supplyApproval.count({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            scopeHash,
            executionTask: {
              parentTaskId: procurementCase.id,
              taskType: APPROVAL_TASK_TYPE,
              capabilityKey: APPROVAL_CAPABILITY,
            },
          },
        });
        const attempt = priorAttempts + 1;
        const idempotencyKey = `procurement:${procurementCase.id}:${scopeHash}:${attempt}`;
        const taskKey = `procurement-approval:${procurementCase.id}:${scopeHash}:${attempt}`;
        const approvalTask = await tx.supplyExecutionTask.upsert({
          where: { workspaceId_taskKey: { workspaceId: workspace.id, taskKey } },
          update: {},
          create: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            createdByUserId: args.context.userId,
            parentTaskId: procurementCase.id,
            taskKey,
            taskType: APPROVAL_TASK_TYPE,
            capabilityKey: APPROVAL_CAPABILITY,
            requiresApproval: true,
            input: inputJson(immutableInput),
            inputHash: scopeHash,
          },
        });
        const approval = await tx.supplyApproval.create({
          data: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            executionTaskId: approvalTask.id,
            requestedByUserId: args.context.userId,
            requiredRole: APPROVAL_REQUIRED_ROLE,
            scopeHash,
            requestReason: reason,
            requestContext: inputJson({ procurementCaseId: procurementCase.id, selectionHash: expectedSelectionHash }),
            idempotencyKey,
          },
        });
        const result = {
          ...current.result,
          gates: { ...current.gates, purchaseApproval: "PENDING" },
          stage: "APPROVAL_PENDING",
          approval: {
            id: approval.id,
            taskId: approvalTask.id,
            scopeHash,
            status: "PENDING",
            requestedAt: approval.requestedAt.toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };
        const updated = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(result), resultHash: digest(result) },
          select: caseSelect,
        });
        await appendCaseEvent({
          tx,
          caseId: approvalTask.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType: "PROCUREMENT_APPROVAL_REQUESTED",
          message: "Exact supplier selection and terms were submitted for approval.",
          payload: inputJson({ procurementCaseId: procurementCase.id, scopeHash }),
        });
        await appendCaseEvent({
          tx,
          caseId: procurementCase.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType: "PROCUREMENT_APPROVAL_REQUESTED",
          message: "Procurement approval was requested.",
          payload: inputJson({ approvalId: approval.id, scopeHash }),
        });
        return { procurementCase: updated, approval };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) {
          throw new SupplyPersistenceError("Procurement approval changed concurrently. Retry the request.", "conflict");
        }
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Procurement approval could not be requested.", "conflict");
}

export async function decideProcurementApproval(args: {
  context: SupplyAccessContext;
  approvalId: string;
  input: unknown;
}) {
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) {
    throw new SupplyPersistenceError("Only an admin or manager can decide procurement approvals.", "forbidden");
  }
  const body = record(args.input);
  const decision = body.decision;
  if (decision !== "APPROVE" && decision !== "REJECT") {
    throw new SupplyPersistenceError("Decision must be APPROVE or REJECT.", "invalid_input");
  }
  const note = optionalText(body.note, "Approval note", 2_000);
  const found = await prisma.supplyApproval.findFirst({
    where: { id: args.approvalId, officeId: args.context.officeId },
    select: {
      workspaceId: true,
      executionTask: {
        select: { id: true, parentTaskId: true, taskType: true, capabilityKey: true },
      },
    },
  });
  if (!found) throw new SupplyPersistenceError("Procurement approval was not found.", "not_found");
  if (!found.executionTask || found.executionTask.taskType !== APPROVAL_TASK_TYPE
    || found.executionTask.capabilityKey !== APPROVAL_CAPABILITY || !found.executionTask.parentTaskId) {
    throw new SupplyPersistenceError("Procurement approval scope is invalid.", "conflict");
  }
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  if (workspace.id !== found.workspaceId) throw new SupplyPersistenceError("Procurement approval was not found.", "not_found");
  const targetStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Parent-first lock order matches gate review and approval request.
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${found.executionTask!.parentTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${found.workspaceId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyApproval" WHERE "id" = ${args.approvalId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${found.workspaceId} FOR UPDATE`);
        const approval = await tx.supplyApproval.findFirst({
          where: { id: args.approvalId, officeId: args.context.officeId, workspaceId: found.workspaceId },
          include: { executionTask: true },
        });
        if (!approval || !approval.executionTask || approval.executionTask.taskType !== APPROVAL_TASK_TYPE
          || approval.executionTask.capabilityKey !== APPROVAL_CAPABILITY
          || approval.executionTask.parentTaskId !== found.executionTask!.parentTaskId) {
          throw new SupplyPersistenceError("Procurement approval scope is invalid.", "conflict");
        }
        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: {
            id: found.executionTask!.parentTaskId!,
            officeId: args.context.officeId,
            workspaceId: found.workspaceId,
            taskType: TASK_TYPE,
            status: "PLANNED",
          },
          select: caseSelect,
        });
        if (!procurementCase) throw new SupplyPersistenceError("Active procurement case was not found.", "conflict");
        const current = caseResult(procurementCase.result);
        if (approval.status !== "PENDING") {
          if (approval.status === targetStatus
            && approval.decidedByUserId === args.context.userId
            && current.approval.id === approval.id
            && current.approval.scopeHash === approval.scopeHash
            && current.approval.status === targetStatus) {
            return { procurementCase, approval };
          }
          throw new SupplyPersistenceError("This procurement approval has already been decided.", "conflict");
        }
        if (current.approval.id !== approval.id || current.approval.scopeHash !== approval.scopeHash) {
          throw new SupplyPersistenceError("Procurement case changed after this approval was requested.", "conflict");
        }
        if (approval.scopeHash !== approval.executionTask.inputHash) {
          throw new SupplyPersistenceError("Procurement approval no longer matches its immutable task input.", "conflict");
        }

        const immutableInput = record(approval.executionTask.input);
        const approvedSourceReview = record(immutableInput.sourceEvidenceReview);
        const approvedTerms = record(immutableInput.confirmedTerms);
        const approvedQualityPlan = record(immutableInput.qualityPlan);
        let staleGate: "SOURCE_EVIDENCE" | "COMMERCIAL_TERMS" | "QUALITY_PLAN" | "APPROVAL" | null = null;
        let staleMessage = "";
        if (!currentSupplierQualification(approvedSourceReview)) {
          staleGate = "SOURCE_EVIDENCE";
          staleMessage = "The supplier qualification expired before approval.";
        } else if (typeof approvedTerms.validUntil !== "string" || approvedTerms.validUntil < todayUtc()) {
          staleGate = "COMMERCIAL_TERMS";
          staleMessage = "The supplier quote expired before approval.";
        } else if (typeof approvedTerms.deliveryDate !== "string" || approvedTerms.deliveryDate < todayUtc()) {
          staleGate = "COMMERCIAL_TERMS";
          staleMessage = "The planned delivery date passed before approval.";
        } else if (typeof approvedQualityPlan.targetDate !== "string" || approvedQualityPlan.targetDate < todayUtc()) {
          staleGate = "QUALITY_PLAN";
          staleMessage = "The quality review date passed before approval.";
        } else if (approval.expiresAt && approval.expiresAt.getTime() <= Date.now()) {
          staleGate = "APPROVAL";
          staleMessage = "The approval request expired before a decision.";
        }
        if (staleGate) {
          const expiredAt = new Date();
          if (staleGate === "SOURCE_EVIDENCE") {
            await cancelActiveQuoteCycles(tx, procurementCase.id, args.context.officeId, found.workspaceId);
          }
          const expiredApproval = await tx.supplyApproval.update({
            where: { id: approval.id },
            data: { status: "EXPIRED", decidedAt: expiredAt, decisionNote: staleMessage },
          });
          await tx.supplyExecutionTask.update({
            where: { id: approval.executionTask.id },
            data: { status: "CANCELLED", cancelledAt: expiredAt },
          });
          const gates = staleGate === "SOURCE_EVIDENCE"
            ? { ...current.gates, sourceEvidence: "REVIEW_REQUIRED", commercialTerms: "REVIEW_REQUIRED", qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" }
            : staleGate === "COMMERCIAL_TERMS"
              ? { ...current.gates, commercialTerms: "REVIEW_REQUIRED", qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" }
              : staleGate === "QUALITY_PLAN"
                ? { ...current.gates, qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" }
                : { ...current.gates, purchaseApproval: "BLOCKED" };
          const result: Record<string, unknown> = {
            ...current.result,
            gates,
            stage: staleGate === "SOURCE_EVIDENCE"
              ? "SOURCE_EVIDENCE"
              : staleGate === "COMMERCIAL_TERMS"
                ? "COMMERCIAL_CONFIRMATION"
                : staleGate === "QUALITY_PLAN" ? "QUALITY_REVIEW" : "APPROVAL",
            approval: {
              ...current.approval,
              status: "EXPIRED",
              decidedAt: expiredAt.toISOString(),
              decisionNote: staleMessage,
            },
            updatedAt: expiredAt.toISOString(),
          };
          if (staleGate === "SOURCE_EVIDENCE") {
            delete result.confirmedTerms;
            delete result.qualityPlan;
            delete result.quoteCycle;
            result.reviews = { sourceEvidence: current.reviews.sourceEvidence };
          } else if (staleGate === "COMMERCIAL_TERMS") {
            delete result.confirmedTerms;
            delete result.qualityPlan;
            result.reviews = { sourceEvidence: current.reviews.sourceEvidence };
          } else if (staleGate === "QUALITY_PLAN") {
            delete result.qualityPlan;
            result.reviews = {
              sourceEvidence: current.reviews.sourceEvidence,
              commercialTerms: current.reviews.commercialTerms,
            };
          }
          const updated = await tx.supplyExecutionTask.update({
            where: { id: procurementCase.id },
            data: { result: inputJson(result), resultHash: digest(result) },
            select: caseSelect,
          });
          await appendCaseEvent({
            tx,
            caseId: approval.executionTask.id,
            officeId: args.context.officeId,
            workspaceId: found.workspaceId,
            actorUserId: args.context.userId,
            eventType: "PROCUREMENT_APPROVAL_EXPIRED",
            status: "CANCELLED",
            message: staleMessage,
            payload: inputJson({ procurementCaseId: procurementCase.id, scopeHash: approval.scopeHash, staleGate }),
          });
          await appendCaseEvent({
            tx,
            caseId: procurementCase.id,
            officeId: args.context.officeId,
            workspaceId: found.workspaceId,
            actorUserId: args.context.userId,
            eventType: "PROCUREMENT_APPROVAL_EXPIRED",
            message: `${staleMessage} The case was returned to review.`,
            payload: inputJson({ approvalId: approval.id, scopeHash: approval.scopeHash, staleGate }),
          });
          return { procurementCase: updated, approval: expiredApproval };
        }

        if (approval.requestedByUserId === args.context.userId) {
          // ADMIN and MANAGER roles are office-wide by policy, independent of SavedView flags.
          const alternatives = await tx.user.count({
            where: {
              officeId: args.context.officeId,
              id: { not: args.context.userId },
              isActive: true,
              role: { in: ["ADMIN", "MANAGER"] },
            },
          });
          if (alternatives > 0) {
            throw new SupplyPersistenceError("A different eligible approver is available, so self-approval is blocked.", "forbidden");
          }
        }
        const decidedAt = new Date();
        await tx.supplyApproval.update({
          where: { id: approval.id },
          data: { status: targetStatus, decidedByUserId: args.context.userId, decidedAt, decisionNote: note },
        });
        const taskResult = {
          approvalId: approval.id,
          decision: targetStatus,
          decidedByUserId: args.context.userId,
          decidedAt: decidedAt.toISOString(),
          note,
        };
        await tx.supplyExecutionTask.update({
          where: { id: approval.executionTask.id },
          data: {
            status: decision === "APPROVE" ? "READY" : "BLOCKED",
            result: inputJson(taskResult),
            resultHash: digest(taskResult),
          },
        });
        const result: Record<string, unknown> = {
          ...current.result,
          gates: decision === "APPROVE"
            ? { ...current.gates, purchaseApproval: targetStatus }
            : { ...current.gates, commercialTerms: "REVIEW_REQUIRED", qualityPlan: "REVIEW_REQUIRED", purchaseApproval: targetStatus },
          stage: decision === "APPROVE" ? "PURCHASE_READY" : "COMMERCIAL_CONFIRMATION",
          approval: {
            ...current.approval,
            status: targetStatus,
            decidedByUserId: args.context.userId,
            decidedAt: decidedAt.toISOString(),
            decisionNote: note,
          },
          updatedAt: decidedAt.toISOString(),
        };
        if (decision === "REJECT") {
          delete result.confirmedTerms;
          delete result.qualityPlan;
          result.reviews = { sourceEvidence: current.reviews.sourceEvidence };
        }
        const updated = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(result), resultHash: digest(result) },
          select: caseSelect,
        });
        await appendCaseEvent({
          tx,
          caseId: approval.executionTask.id,
          officeId: args.context.officeId,
          workspaceId: found.workspaceId,
          actorUserId: args.context.userId,
          eventType: decision === "APPROVE" ? "PROCUREMENT_APPROVED" : "PROCUREMENT_REJECTED",
          status: decision === "APPROVE" ? "READY" : "BLOCKED",
          message: decision === "APPROVE" ? "Procurement selection was approved." : "Procurement selection was rejected.",
          payload: inputJson(taskResult),
        });
        await appendCaseEvent({
          tx,
          caseId: procurementCase.id,
          officeId: args.context.officeId,
          workspaceId: found.workspaceId,
          actorUserId: args.context.userId,
          eventType: decision === "APPROVE" ? "PROCUREMENT_APPROVED" : "PROCUREMENT_REJECTED",
          status: decision === "APPROVE" ? "READY" : "BLOCKED",
          message: decision === "APPROVE" ? "Procurement selection is ready for purchase preparation." : "Procurement approval was rejected.",
          payload: inputJson({ approvalId: approval.id, scopeHash: approval.scopeHash, note }),
        });
        return { procurementCase: updated, approval: { ...approval, status: targetStatus, decidedAt, decisionNote: note } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) {
          throw new SupplyPersistenceError("Procurement approval changed concurrently. Retry the decision.", "conflict");
        }
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Procurement approval could not be decided.", "conflict");
}

function normalizePurchaseOrderDraft(input: unknown): PurchaseOrderDraftInput {
  const body = record(input);
  const quantity = positiveNumber(body.quantity, "Order quantity");
  if (quantity > 1_000_000_000) {
    throw new SupplyPersistenceError("Order quantity must not exceed 1,000,000,000.", "invalid_input");
  }
  const incoterm = requiredText(body.incoterm, "Incoterm", 3).toUpperCase();
  if (!PURCHASE_INCOTERMS.includes(incoterm as PurchaseOrderDraftInput["incoterm"])) {
    throw new SupplyPersistenceError(`Incoterm must be one of: ${PURCHASE_INCOTERMS.join(", ")}.`, "invalid_input");
  }
  return {
    expectedApprovalId: requiredText(body.expectedApprovalId, "Approval ID", 220),
    expectedApprovalScopeHash: requiredText(body.expectedApprovalScopeHash, "Approval scope hash", 128),
    expectedRevision: nonNegativeInteger(body.expectedRevision, "Expected draft revision"),
    quantity,
    needBy: requireCurrentOrFutureDate(isoDate(body.needBy, "Need-by date"), "Need-by date"),
    shipTo: requiredText(body.shipTo, "Ship-to location", 500),
    incoterm: incoterm as PurchaseOrderDraftInput["incoterm"],
    paymentTerms: requiredText(body.paymentTerms, "Payment terms", 300),
    buyerReference: optionalText(body.buyerReference, "Buyer reference", 160),
    notes: optionalText(body.notes, "Buyer notes", 2_000),
  };
}

function normalizeRevisedPurchaseOrderDraft(input: unknown): RevisedPurchaseOrderDraftInput {
  const body = record(input);
  const quantity = positiveNumber(body.quantity, "Revised order quantity");
  const unitPrice = positiveNumber(body.unitPrice, "Revised unit price");
  const minimumOrderQuantity = positiveNumber(body.minimumOrderQuantity, "Revised minimum order quantity");
  if (quantity > 1_000_000_000 || minimumOrderQuantity > 1_000_000_000) {
    throw new SupplyPersistenceError("Revised quantity and MOQ must not exceed 1,000,000,000.", "invalid_input");
  }
  if (quantity < minimumOrderQuantity) {
    throw new SupplyPersistenceError("Revised order quantity must meet the revised MOQ.", "invalid_input");
  }
  const incoterm = requiredText(body.incoterm, "Revised incoterm", 3).toUpperCase();
  if (!PURCHASE_INCOTERMS.includes(incoterm as RevisedPurchaseOrderDraftInput["incoterm"])) {
    throw new SupplyPersistenceError(`Revised incoterm must be one of: ${PURCHASE_INCOTERMS.join(", ")}.`, "invalid_input");
  }
  const currency = requiredText(body.currency, "Revised currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new SupplyPersistenceError("Revised currency must be a three-letter code.", "invalid_input");
  }
  const needBy = requireCurrentOrFutureDate(isoDate(body.needBy, "Revised need-by date"), "Revised need-by date");
  const deliveryDate = requireCurrentOrFutureDate(isoDate(body.deliveryDate, "Revised delivery date"), "Revised delivery date");
  if (deliveryDate > needBy) {
    throw new SupplyPersistenceError("Revised delivery date cannot be after the need-by date.", "invalid_input");
  }
  return {
    expectedReleaseHash: requiredText(body.expectedReleaseHash, "Superseded release hash", 128),
    exceptionHash: requiredText(body.exceptionHash, "Supplier exception hash", 128),
    expectedRevision: nonNegativeInteger(body.expectedRevision, "Expected revised draft revision"),
    quantity,
    needBy,
    shipTo: requiredText(body.shipTo, "Revised ship-to location", 500),
    incoterm: incoterm as RevisedPurchaseOrderDraftInput["incoterm"],
    paymentTerms: requiredText(body.paymentTerms, "Revised payment terms", 300),
    buyerReference: optionalText(body.buyerReference, "Revised buyer reference", 160),
    notes: optionalText(body.notes, "Revised buyer notes", 2_000),
    unitPrice,
    currency,
    minimumOrderQuantity,
    deliveryDate,
    quoteReference: requiredText(body.quoteReference, "Revised offer reference", 300),
    quoteValidUntil: requireCurrentOrFutureDate(isoDate(body.quoteValidUntil, "Revised offer validity date"), "Revised offer validity date"),
  };
}

export async function savePurchaseOrderDraft(args: {
  context: SupplyAccessContext;
  caseId: string;
  input: unknown;
}) {
  const orderInput = normalizePurchaseOrderDraft(args.input);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.caseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${args.caseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: {
            id: args.caseId,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            taskType: TASK_TYPE,
            status: "PLANNED",
          },
          select: caseSelect,
        });
        if (!procurementCase) throw new SupplyPersistenceError("Active procurement case was not found.", "not_found");
        const current = caseResult(procurementCase.result);
        if (current.result.stage !== "PURCHASE_READY"
          || current.gates.purchaseApproval !== "APPROVED"
          || current.approval.id !== orderInput.expectedApprovalId
          || current.approval.scopeHash !== orderInput.expectedApprovalScopeHash
          || current.approval.status !== "APPROVED") {
          throw new SupplyPersistenceError("The approved procurement scope changed. Reload before preparing the order.", "conflict");
        }
        const approval = await tx.supplyApproval.findFirst({
          where: {
            id: orderInput.expectedApprovalId,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            status: "APPROVED",
            scopeHash: orderInput.expectedApprovalScopeHash,
          },
          include: { executionTask: true },
        });
        if (!approval?.executionTask
          || approval.requiredRole !== APPROVAL_REQUIRED_ROLE
          || approval.executionTask.taskType !== APPROVAL_TASK_TYPE
          || approval.executionTask.capabilityKey !== APPROVAL_CAPABILITY
          || approval.executionTask.parentTaskId !== procurementCase.id
          || approval.executionTask.inputHash !== approval.scopeHash) {
          throw new SupplyPersistenceError("The approved procurement scope is invalid.", "conflict");
        }
        const approvedInput = record(approval.executionTask.input);
        const approvedSourceReview = record(approvedInput.sourceEvidenceReview);
        const approvedTerms = record(approvedInput.confirmedTerms);
        const approvedQualityPlan = record(approvedInput.qualityPlan);
        const approvedSelection = record(approvedInput.selectedOption);
        if (approvedInput.procurementCaseId !== procurementCase.id) {
          throw new SupplyPersistenceError("The approved procurement scope points to a different case.", "conflict");
        }
        let staleGate: "SOURCE_EVIDENCE" | "COMMERCIAL_TERMS" | "QUALITY_PLAN" | null = null;
        let staleMessage = "";
        if (!currentSupplierQualification(approvedSourceReview)) {
          staleGate = "SOURCE_EVIDENCE";
          staleMessage = "The supplier qualification expired before order preparation.";
        } else if (typeof approvedTerms.validUntil !== "string" || approvedTerms.validUntil < todayUtc()) {
          staleGate = "COMMERCIAL_TERMS";
          staleMessage = "The approved quote expired before order preparation.";
        } else if (typeof approvedTerms.unitOfMeasure !== "string"
          || !/^[A-Z0-9][A-Z0-9 ._/-]{0,19}$/.test(approvedTerms.unitOfMeasure)) {
          staleGate = "COMMERCIAL_TERMS";
          staleMessage = "The approved quote does not contain a valid unit of measure.";
        } else if (typeof approvedTerms.deliveryDate !== "string" || approvedTerms.deliveryDate < todayUtc()) {
          staleGate = "COMMERCIAL_TERMS";
          staleMessage = "The approved delivery date passed before order preparation.";
        } else if (typeof approvedQualityPlan.targetDate !== "string" || approvedQualityPlan.targetDate < todayUtc()) {
          staleGate = "QUALITY_PLAN";
          staleMessage = "The approved quality-plan date passed before order preparation.";
        }
        if (staleGate) {
          await cancelActivePurchaseDrafts(tx, procurementCase.id, args.context.officeId, workspace.id);
          if (staleGate === "SOURCE_EVIDENCE") {
            await cancelActiveQuoteCycles(tx, procurementCase.id, args.context.officeId, workspace.id);
          }
          const gates = staleGate === "SOURCE_EVIDENCE"
            ? { ...current.gates, sourceEvidence: "REVIEW_REQUIRED", commercialTerms: "REVIEW_REQUIRED", qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" }
            : staleGate === "COMMERCIAL_TERMS"
              ? { ...current.gates, commercialTerms: "REVIEW_REQUIRED", qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" }
              : { ...current.gates, qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" };
          const result: Record<string, unknown> = {
            ...current.result,
            gates,
            stage: staleGate === "SOURCE_EVIDENCE" ? "SOURCE_EVIDENCE" : staleGate === "COMMERCIAL_TERMS" ? "COMMERCIAL_CONFIRMATION" : "QUALITY_REVIEW",
            approval: null,
            updatedAt: new Date().toISOString(),
          };
          delete result.purchasePreparation;
          if (staleGate === "SOURCE_EVIDENCE") {
            delete result.confirmedTerms;
            delete result.qualityPlan;
            delete result.quoteCycle;
            result.reviews = { sourceEvidence: current.reviews.sourceEvidence };
          } else if (staleGate === "COMMERCIAL_TERMS") {
            delete result.confirmedTerms;
            delete result.qualityPlan;
            result.reviews = { sourceEvidence: current.reviews.sourceEvidence };
          } else {
            delete result.qualityPlan;
            result.reviews = {
              sourceEvidence: current.reviews.sourceEvidence,
              commercialTerms: current.reviews.commercialTerms,
            };
          }
          const updated = await tx.supplyExecutionTask.update({
            where: { id: procurementCase.id },
            data: { result: inputJson(result), resultHash: digest(result) },
            select: caseSelect,
          });
          await appendCaseEvent({
            tx,
            caseId: procurementCase.id,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            actorUserId: args.context.userId,
            eventType: "PURCHASE_PREPARATION_SCOPE_EXPIRED",
            message: `${staleMessage} The case was returned to review.`,
            payload: inputJson({ approvalId: approval.id, scopeHash: approval.scopeHash, staleGate }),
          });
          return { procurementCase: { ...updated, purchaseDraft: null }, purchaseDraft: null, stale: true };
        }

        const unitPrice = new Prisma.Decimal(positiveNumber(approvedTerms.price, "Approved unit price"));
        const minimumOrderQuantity = new Prisma.Decimal(positiveNumber(approvedTerms.minimumOrderQuantity, "Approved minimum order quantity"));
        const unitOfMeasure = normalizedUnitOfMeasure(approvedTerms.unitOfMeasure, "Approved unit of measure");
        const quantity = new Prisma.Decimal(orderInput.quantity);
        if (quantity.lessThan(minimumOrderQuantity)) {
          throw new SupplyPersistenceError(`Order quantity must meet the approved MOQ of ${minimumOrderQuantity.toString()} ${unitOfMeasure}.`, "invalid_input");
        }
        const currency = requiredText(approvedTerms.currency, "Approved currency", 3).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) {
          throw new SupplyPersistenceError("Approved currency is invalid.", "conflict");
        }
        const quoteCycleTaskId = requiredText(approvedTerms.quoteCycleTaskId, "Approved quote cycle task ID", 220);
        const quoteResponseHash = requiredText(approvedTerms.responseHash, "Approved quote response hash", 128);
        const quoteEvidenceId = typeof approvedTerms.evidenceId === "string"
          ? requiredText(approvedTerms.evidenceId, "Approved quote evidence ID", 220)
          : null;
        if (!["OPERATOR_RECORDED_EXTERNAL", "CONNECTED_PROVIDER"].includes(String(approvedTerms.evidenceClass))) {
          throw new SupplyPersistenceError("Approved quote evidence class is invalid.", "conflict");
        }
        const quoteEvidenceUrl = approvedTerms.evidenceClass === "CONNECTED_PROVIDER"
          ? connectedProviderUrl(approvedTerms.evidenceUrl, "Approved connected quote evidence URL")
          : publicUrl(approvedTerms.evidenceUrl, "Approved quote evidence URL");
        if (quoteEvidenceId) {
          const quoteEvidence = await tx.supplyEvidence.findFirst({
            where: {
              id: quoteEvidenceId,
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              executionTaskId: quoteCycleTaskId,
              kind: "SUPPLIER_QUOTE_RESPONSE",
              sourceUri: quoteEvidenceUrl,
              contentHash: quoteResponseHash,
              sourceType: String(approvedTerms.evidenceClass),
            },
            select: { id: true },
          });
          if (!quoteEvidence) {
            throw new SupplyPersistenceError("Approved quote evidence no longer matches the procurement scope.", "conflict");
          }
        }
        const order = {
          quantity: quantity.toString(),
          unitOfMeasure,
          needBy: orderInput.needBy,
          shipTo: orderInput.shipTo,
          incoterm: orderInput.incoterm,
          paymentTerms: orderInput.paymentTerms,
          buyerReference: orderInput.buyerReference,
          notes: orderInput.notes,
        };
        const orderHash = digest(order);
        const taskKey = `purchase-draft:${procurementCase.id}:${approval.id}`;
        const taskInput = {
          procurementCaseId: procurementCase.id,
          procurementApprovalId: approval.id,
          procurementApprovalScopeHash: approval.scopeHash,
        };
        const existing = await tx.supplyExecutionTask.findFirst({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            parentTaskId: procurementCase.id,
            taskKey,
            taskType: PURCHASE_DRAFT_TASK_TYPE,
          },
          select: purchaseDraftSelect,
        });
        const existingResult = record(existing?.result);
        if (existing && existing.status !== "PLANNED") {
          throw new SupplyPersistenceError("Only an active purchase draft can be edited.", "conflict");
        }
        if (existing && existingResult.orderHash === orderHash) {
          return { procurementCase: { ...procurementCase, purchaseDraft: existing }, purchaseDraft: existing, stale: false };
        }
        const currentRevision = typeof existingResult.revision === "number" ? existingResult.revision : 0;
        if (existing && orderInput.expectedRevision !== currentRevision) {
          throw new SupplyPersistenceError("The purchase draft changed in another session. Reload before saving.", "conflict");
        }
        if (!existing && orderInput.expectedRevision !== 0) {
          throw new SupplyPersistenceError("The purchase draft no longer matches this screen. Reload before saving.", "conflict");
        }
        if (existing) {
          await cancelActivePurchaseActions(tx, existing.id, args.context.officeId, workspace.id);
        }
        const revision = currentRevision + 1;
        const result = {
          revision,
          state: "DRAFT",
          order,
          orderHash,
          supplier: {
            id: requiredText(approvedSelection.id, "Approved supplier ID", 220),
            name: requiredText(approvedSelection.name, "Approved supplier name", 220),
            sourceUrl: publicUrl(approvedSelection.sourceUrl, "Approved supplier source"),
          },
          commercial: {
            unitPrice: unitPrice.toString(),
            currency,
            minimumOrderQuantity: minimumOrderQuantity.toString(),
            quoteReference: requiredText(approvedTerms.quoteReference, "Approved quote reference", 300),
            quoteValidUntil: approvedTerms.validUntil,
            deliveryDate: approvedTerms.deliveryDate,
            quoteCycleTaskId,
            quoteResponseHash,
            quoteEvidenceUrl,
            quoteEvidenceId,
            evidenceClass: approvedTerms.evidenceClass,
          },
          totals: {
            materialSubtotal: quantity.mul(unitPrice).toDecimalPlaces(2).toString(),
            currency,
          },
          approvedProcurementScope: {
            approvalId: approval.id,
            scopeHash: approval.scopeHash,
          },
          updatedAt: new Date().toISOString(),
        };
        const purchaseDraft = existing
          ? await tx.supplyExecutionTask.update({
              where: { id: existing.id },
              data: { result: inputJson(result), resultHash: digest(result) },
              select: purchaseDraftSelect,
            })
          : await tx.supplyExecutionTask.create({
              data: {
                officeId: args.context.officeId,
                workspaceId: workspace.id,
                createdByUserId: args.context.userId,
                parentTaskId: procurementCase.id,
                taskKey,
                taskType: PURCHASE_DRAFT_TASK_TYPE,
                capabilityKey: PURCHASE_DRAFT_CAPABILITY,
                requiresApproval: false,
                input: inputJson(taskInput),
                inputHash: digest(taskInput),
                result: inputJson(result),
                resultHash: digest(result),
                idempotencyKey: taskKey,
              },
              select: purchaseDraftSelect,
            });
        await cancelActivePurchaseDrafts(tx, procurementCase.id, args.context.officeId, workspace.id, purchaseDraft.id);
        const eventType = existing ? "PURCHASE_DRAFT_UPDATED" : "PURCHASE_DRAFT_CREATED";
        const projectedCaseResult: Record<string, unknown> = {
          ...current.result,
          purchasePreparation: {
            draftTaskId: purchaseDraft.id,
            state: "DRAFT",
            revision,
            orderHash,
          },
          updatedAt: result.updatedAt,
        };
        delete projectedCaseResult.purchaseAuthorization;
        const updatedCase = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(projectedCaseResult), resultHash: digest(projectedCaseResult) },
          select: caseSelect,
        });
        await appendCaseEvent({
          tx,
          caseId: purchaseDraft.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType,
          message: existing ? "Purchase draft was updated." : "Purchase draft was prepared from the approved sourcing scope.",
          payload: inputJson({ procurementCaseId: procurementCase.id, approvalId: approval.id, orderHash, revision }),
        });
        await appendCaseEvent({
          tx,
          caseId: procurementCase.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType,
          message: existing ? "Order preparation draft was updated." : "Order preparation draft is ready for review.",
          payload: inputJson({ purchaseDraftId: purchaseDraft.id, approvalId: approval.id, orderHash, revision }),
        });
        return { procurementCase: { ...updatedCase, purchaseDraft, purchaseAction: null }, purchaseDraft, purchaseAction: null, stale: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) {
          throw new SupplyPersistenceError("Purchase draft changed concurrently. Reload and retry.", "conflict");
        }
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Purchase draft could not be saved.", "conflict");
}

function purchaseActionRequest(input: unknown) {
  const body = record(input);
  return {
    expectedDraftTaskId: requiredText(body.expectedDraftTaskId, "Purchase draft ID", 220),
    expectedDraftResultHash: requiredText(body.expectedDraftResultHash, "Purchase draft result hash", 128),
    expectedDraftRevision: nonNegativeInteger(body.expectedDraftRevision, "Expected draft revision"),
    reason: requiredText(body.reason, "Purchase approval reason", 2_000),
  };
}

export async function requestPurchaseActionApproval(args: {
  context: SupplyAccessContext;
  caseId: string;
  input: unknown;
}) {
  const request = purchaseActionRequest(args.input);
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");

  for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.caseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${request.expectedDraftTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${request.expectedDraftTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);

        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: {
            id: args.caseId,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            taskType: TASK_TYPE,
            status: "PLANNED",
          },
          select: caseSelect,
        });
        if (!procurementCase) throw new SupplyPersistenceError("Active procurement case was not found.", "not_found");
        const current = caseResult(procurementCase.result);
        if (current.result.stage !== "PURCHASE_READY"
          || current.gates.purchaseApproval !== "APPROVED"
          || current.approval.status !== "APPROVED") {
          throw new SupplyPersistenceError("The sourcing scope is not approved for purchase preparation.", "conflict");
        }

        const purchaseDraft = await tx.supplyExecutionTask.findFirst({
          where: {
            id: request.expectedDraftTaskId,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            parentTaskId: procurementCase.id,
            taskType: PURCHASE_DRAFT_TASK_TYPE,
            capabilityKey: PURCHASE_DRAFT_CAPABILITY,
            status: "PLANNED",
          },
          select: purchaseDraftSelect,
        });
        if (!purchaseDraft?.result || !purchaseDraft.resultHash) {
          throw new SupplyPersistenceError("An active purchase draft was not found.", "not_found");
        }
        const draftResult = record(purchaseDraft.result);
        if (purchaseDraft.resultHash !== request.expectedDraftResultHash
          || draftResult.revision !== request.expectedDraftRevision) {
          throw new SupplyPersistenceError("The purchase draft changed. Reload before requesting approval.", "conflict");
        }
        const projectedDraft = record(current.result.purchasePreparation);
        if (projectedDraft.draftTaskId !== purchaseDraft.id
          || projectedDraft.revision !== request.expectedDraftRevision
          || projectedDraft.orderHash !== draftResult.orderHash) {
          throw new SupplyPersistenceError("The procurement case no longer points to this purchase draft.", "conflict");
        }

        const procurementApproval = await tx.supplyApproval.findFirst({
          where: {
            id: requiredText(current.approval.id, "Procurement approval ID", 220),
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            status: "APPROVED",
            scopeHash: requiredText(current.approval.scopeHash, "Procurement approval scope", 128),
          },
          include: { executionTask: true },
        });
        if (!procurementApproval?.executionTask
          || procurementApproval.executionTask.taskType !== APPROVAL_TASK_TYPE
          || procurementApproval.executionTask.capabilityKey !== APPROVAL_CAPABILITY
          || procurementApproval.executionTask.parentTaskId !== procurementCase.id
          || procurementApproval.executionTask.inputHash !== procurementApproval.scopeHash) {
          throw new SupplyPersistenceError("The approved procurement scope is invalid.", "conflict");
        }
        const procurementInput = record(procurementApproval.executionTask.input);
        requireCurrentSupplierQualification(
          procurementInput.sourceEvidenceReview,
          "The approved supplier qualification expired. Requalify the supplier before final purchase approval.",
        );
        const qualityPlan = record(procurementInput.qualityPlan);
        const commercial = record(draftResult.commercial);
        if (typeof commercial.quoteValidUntil !== "string" || commercial.quoteValidUntil < todayUtc()) {
          throw new SupplyPersistenceError("The approved quote expired. Confirm current commercial terms before final purchase approval.", "conflict");
        }
        if (typeof commercial.deliveryDate !== "string" || commercial.deliveryDate < todayUtc()) {
          throw new SupplyPersistenceError("The approved delivery date passed. Confirm current commercial terms before final purchase approval.", "conflict");
        }
        if (typeof qualityPlan.targetDate !== "string" || qualityPlan.targetDate < todayUtc()) {
          throw new SupplyPersistenceError("The approved quality-plan date passed. Record a current quality plan before final purchase approval.", "conflict");
        }

        const revisionContext = record(draftResult.revisionContext);
        const isRevisedOrder = Object.keys(revisionContext).length > 0;
        if (isRevisedOrder) {
          const projectedRevision = record(current.result.purchaseRevision);
          const replacesPurchaseActionId = requiredText(revisionContext.replacesPurchaseActionId, "Superseded purchase action ID", 220);
          const supersededReleaseHash = requiredText(revisionContext.supersededReleaseHash, "Superseded release hash", 128);
          const supplierExceptionHash = requiredText(revisionContext.supplierExceptionHash, "Supplier exception hash", 128);
          const supplierExceptionEvidenceId = requiredText(revisionContext.supplierExceptionEvidenceId, "Supplier exception evidence ID", 220);
          const replacementScopeHash = requiredText(revisionContext.replacementScopeHash, "Replacement scope hash", 128);
          if (!["DRAFT", "APPROVAL_PENDING"].includes(String(projectedRevision.state))
            || projectedRevision.replacementDraftTaskId !== purchaseDraft.id
            || projectedRevision.replacementDraftRevision !== request.expectedDraftRevision
            || projectedRevision.replacementScopeHash !== replacementScopeHash
            || projectedRevision.replacesPurchaseActionId !== replacesPurchaseActionId
            || projectedRevision.supersededReleaseHash !== supersededReleaseHash
            || projectedRevision.supplierExceptionHash !== supplierExceptionHash) {
            throw new SupplyPersistenceError("The revised order projection changed. Reload before requesting approval.", "conflict");
          }
          const supersededAction = await tx.supplyExecutionTask.findFirst({
            where: {
              id: replacesPurchaseActionId,
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              taskType: PURCHASE_ACTION_TASK_TYPE,
              capabilityKey: PURCHASE_ACTION_CAPABILITY,
              status: "RUNNING",
            },
            select: { result: true },
          });
          const supersededResult = record(supersededAction?.result);
          const supersededRelease = record(supersededResult.release);
          const supplierExceptions = Array.isArray(supersededResult.supplierOrderExceptions)
            ? supersededResult.supplierOrderExceptions.map((value) => record(value))
            : [];
          const targetException = supplierExceptions.find((value) => value.exceptionHash === supplierExceptionHash);
          const replacementDraft = record(targetException?.replacementDraft);
          if (!supersededAction
            || !["RELEASED", "PARTIALLY_ACKNOWLEDGED"].includes(String(supersededResult.state))
            || supersededRelease.releaseHash !== supersededReleaseHash
            || targetException?.status !== "REVISION_DRAFTED"
            || replacementDraft.taskId !== purchaseDraft.id
            || replacementDraft.replacementScopeHash !== replacementScopeHash
            || supplierExceptions.some((value) => value.status === "OPEN_REVIEW")
            || supplierExceptions.filter(supplierOrderRevisionPending).length !== 1) {
            throw new SupplyPersistenceError("The supplier exception no longer supports this revised order.", "conflict");
          }
          const exceptionEvidence = await tx.supplyEvidence.findFirst({
            where: {
              id: supplierExceptionEvidenceId,
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              executionTaskId: replacesPurchaseActionId,
              kind: "SUPPLIER_ORDER_EXCEPTION",
              contentHash: supplierExceptionHash,
              sourceUri: requiredText(commercial.quoteEvidenceUrl, "Revised offer evidence URL", 2_000),
            },
            select: { id: true },
          });
          if (!exceptionEvidence
            || commercial.sourceKind !== "SUPPLIER_ORDER_EXCEPTION"
            || commercial.quoteEvidenceId !== supplierExceptionEvidenceId
            || commercial.quoteEvidenceHash !== supplierExceptionHash) {
            throw new SupplyPersistenceError("The revised commercial terms lost their supplier exception evidence.", "conflict");
          }
        }

        const immutableInput = {
          action: "PLACE_ORDER",
          procurementCaseId: procurementCase.id,
          purchaseDraftId: purchaseDraft.id,
          purchaseDraftRevision: request.expectedDraftRevision,
          purchaseDraftResultHash: purchaseDraft.resultHash,
          order: record(draftResult.order),
          supplier: record(draftResult.supplier),
          commercial,
          totals: record(draftResult.totals),
          procurementApproval: {
            id: procurementApproval.id,
            scopeHash: procurementApproval.scopeHash,
          },
          sourceEvidenceReview: record(procurementInput.sourceEvidenceReview),
          qualityPlan,
          ...(isRevisedOrder ? { revisionContext } : {}),
        };
        const scopeHash = digest(immutableInput);
        const existing = await tx.supplyExecutionTask.findFirst({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            parentTaskId: purchaseDraft.id,
            taskType: PURCHASE_ACTION_TASK_TYPE,
            capabilityKey: PURCHASE_ACTION_CAPABILITY,
            inputHash: scopeHash,
          },
          orderBy: { createdAt: "desc" },
          select: purchaseActionSelect,
        });
        const existingApproval = existing?.approvals[0] ?? null;
        if (existing && existingApproval?.status === "PENDING" && existing.status === "PLANNED") {
          const purchaseAction = purchaseActionView(existing);
          return {
            procurementCase: { ...procurementCase, purchaseDraft, purchaseAction },
            purchaseAction,
            approval: existingApproval,
          };
        }
        if (existing && existingApproval?.status === "APPROVED" && existing.status === "READY") {
          const purchaseAction = purchaseActionView(existing);
          return {
            procurementCase: { ...procurementCase, purchaseDraft, purchaseAction },
            purchaseAction,
            approval: existingApproval,
          };
        }
        if (existing && existingApproval?.status === "REJECTED") {
          throw new SupplyPersistenceError("This exact order scope was rejected. Revise the draft before requesting approval again.", "conflict");
        }

        const priorAttempts = await tx.supplyExecutionTask.count({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            parentTaskId: purchaseDraft.id,
            taskType: PURCHASE_ACTION_TASK_TYPE,
            inputHash: scopeHash,
          },
        });
        const attempt = priorAttempts + 1;
        const taskKey = `purchase-action:${purchaseDraft.id}:${scopeHash}:${attempt}`;
        const actionTask = await tx.supplyExecutionTask.create({
          data: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            createdByUserId: args.context.userId,
            parentTaskId: purchaseDraft.id,
            taskKey,
            taskType: PURCHASE_ACTION_TASK_TYPE,
            capabilityKey: PURCHASE_ACTION_CAPABILITY,
            status: "PLANNED",
            requiresApproval: true,
            input: inputJson(immutableInput),
            inputHash: scopeHash,
            idempotencyKey: taskKey,
          },
          select: purchaseActionSelect,
        });
        const approval = await tx.supplyApproval.create({
          data: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            executionTaskId: actionTask.id,
            requestedByUserId: args.context.userId,
            requiredRole: PURCHASE_ACTION_REQUIRED_ROLE,
            scopeHash,
            requestReason: request.reason,
            requestContext: inputJson({
              procurementCaseId: procurementCase.id,
              purchaseDraftId: purchaseDraft.id,
              purchaseDraftRevision: request.expectedDraftRevision,
            }),
            idempotencyKey: `purchase-action:${actionTask.id}:${scopeHash}`,
            expiresAt: new Date(`${commercial.quoteValidUntil}T23:59:59.999Z`),
          },
        });
        const projectedCaseResult = {
          ...current.result,
          purchaseAuthorization: {
            actionTaskId: actionTask.id,
            approvalId: approval.id,
            scopeHash,
            status: "PENDING",
            draftTaskId: purchaseDraft.id,
            draftRevision: request.expectedDraftRevision,
          },
          ...(isRevisedOrder ? {
            purchaseRevision: {
              ...record(current.result.purchaseRevision),
              state: "APPROVAL_PENDING",
              replacementPurchaseActionId: actionTask.id,
              replacementApprovalId: approval.id,
              replacementActionScopeHash: scopeHash,
              updatedAt: new Date().toISOString(),
            },
          } : {}),
          updatedAt: new Date().toISOString(),
        };
        const updatedCase = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(projectedCaseResult), resultHash: digest(projectedCaseResult) },
          select: caseSelect,
        });
        await appendCaseEvent({
          tx,
          caseId: actionTask.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType: "PURCHASE_ACTION_APPROVAL_REQUESTED",
          message: "The exact purchase draft was submitted for final approval.",
          payload: inputJson({ procurementCaseId: procurementCase.id, purchaseDraftId: purchaseDraft.id, scopeHash }),
        });
        await appendCaseEvent({
          tx,
          caseId: procurementCase.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType: "PURCHASE_ACTION_APPROVAL_REQUESTED",
          message: "Final purchase approval was requested for the current order draft.",
          payload: inputJson({ purchaseActionId: actionTask.id, approvalId: approval.id, scopeHash }),
        });
        const purchaseAction = purchaseActionView(actionTask, approval);
        return {
          procurementCase: { ...updatedCase, purchaseDraft, purchaseAction },
          purchaseAction,
          approval,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || transactionAttempt === 2) {
        if (retryableTransactionError(error)) {
          throw new SupplyPersistenceError("Purchase approval changed concurrently. Reload and retry.", "conflict");
        }
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Purchase approval could not be requested.", "conflict");
}

export async function decidePurchaseActionApproval(args: {
  context: SupplyAccessContext;
  approvalId: string;
  input: unknown;
}) {
  const accessContext = await currentAccessContext(args.context);
  if (accessContext.role !== "ADMIN") {
    throw new SupplyPersistenceError("Only an admin can authorize a purchase action.", "forbidden");
  }
  const body = record(args.input);
  const decision = body.decision;
  if (decision !== "APPROVE" && decision !== "REJECT") {
    throw new SupplyPersistenceError("Decision must be APPROVE or REJECT.", "invalid_input");
  }
  const note = optionalText(body.note, "Approval note", 2_000);
  const found = await prisma.supplyApproval.findFirst({
    where: { id: args.approvalId, officeId: args.context.officeId },
    select: {
      workspaceId: true,
      executionTask: {
        select: {
          id: true,
          parentTaskId: true,
          taskType: true,
          capabilityKey: true,
          input: true,
          parentTask: { select: { id: true, parentTaskId: true } },
        },
      },
    },
  });
  const purchaseDraftId = found?.executionTask?.parentTaskId;
  const procurementCaseId = found?.executionTask?.parentTask?.parentTaskId;
  if (!found || !purchaseDraftId || !procurementCaseId
    || found.executionTask?.taskType !== PURCHASE_ACTION_TASK_TYPE
    || found.executionTask.capabilityKey !== PURCHASE_ACTION_CAPABILITY) {
    throw new SupplyPersistenceError("Purchase action approval was not found.", "not_found");
  }
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  if (workspace.id !== found.workspaceId) throw new SupplyPersistenceError("Purchase action approval was not found.", "not_found");
  const targetStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const foundRevisionContext = record(record(found.executionTask.input).revisionContext);
  const supersededPurchaseActionId = typeof foundRevisionContext.replacesPurchaseActionId === "string" ? foundRevisionContext.replacesPurchaseActionId : null;
  const supersededPurchaseDraftId = typeof foundRevisionContext.replacesPurchaseDraftId === "string" ? foundRevisionContext.replacesPurchaseDraftId : null;

  for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        if (supersededPurchaseDraftId) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${supersededPurchaseDraftId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${purchaseDraftId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        if (supersededPurchaseActionId) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${supersededPurchaseActionId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${found.executionTask!.id} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyApproval" WHERE "id" = ${args.approvalId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);

        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: { id: procurementCaseId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: TASK_TYPE },
          select: caseSelect,
        });
        const purchaseDraft = await tx.supplyExecutionTask.findFirst({
          where: { id: purchaseDraftId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: PURCHASE_DRAFT_TASK_TYPE },
          select: purchaseDraftSelect,
        });
        const approval = await tx.supplyApproval.findFirst({
          where: { id: args.approvalId, officeId: args.context.officeId, workspaceId: workspace.id },
          include: { executionTask: true },
        });
        if (!procurementCase || !purchaseDraft || !approval?.executionTask
          || approval.executionTask.id !== found.executionTask!.id
          || approval.executionTask.parentTaskId !== purchaseDraft.id
          || approval.executionTask.taskType !== PURCHASE_ACTION_TASK_TYPE
          || approval.executionTask.capabilityKey !== PURCHASE_ACTION_CAPABILITY
          || approval.requiredRole !== PURCHASE_ACTION_REQUIRED_ROLE
          || approval.scopeHash !== approval.executionTask.inputHash) {
          throw new SupplyPersistenceError("Purchase action approval scope is invalid.", "conflict");
        }
        const current = caseResult(procurementCase.result);
        const actionInput = record(approval.executionTask.input);
        const revisionContext = record(actionInput.revisionContext);
        const isRevisedOrder = Object.keys(revisionContext).length > 0;
        const authorization = record(current.result.purchaseAuthorization);
        if (approval.status === targetStatus && approval.decidedByUserId === args.context.userId) {
          const selectedAction = await tx.supplyExecutionTask.findUniqueOrThrow({
            where: { id: approval.executionTask.id },
            select: purchaseActionSelect,
          });
          const purchaseAction = purchaseActionView(selectedAction, approval);
          return { procurementCase: { ...procurementCase, purchaseDraft, purchaseAction }, purchaseAction, approval };
        }
        if (approval.status !== "PENDING") {
          throw new SupplyPersistenceError("This purchase action approval has already been decided.", "conflict");
        }
        if (approval.executionTask.status !== "PLANNED"
          || purchaseDraft.status !== "PLANNED"
          || purchaseDraft.resultHash !== actionInput.purchaseDraftResultHash
          || authorization.actionTaskId !== approval.executionTask.id
          || authorization.approvalId !== approval.id
          || authorization.scopeHash !== approval.scopeHash
          || authorization.status !== "PENDING") {
          throw new SupplyPersistenceError("The purchase draft changed after approval was requested.", "conflict");
        }
        let supersededAction: PurchaseActionRecord | null = null;
        let supersededDraft: Prisma.SupplyExecutionTaskGetPayload<{ select: typeof purchaseDraftSelect }> | null = null;
        let supersededExceptions: Record<string, unknown>[] = [];
        let targetSupplierException: Record<string, unknown> | null = null;
        if (isRevisedOrder) {
          const projectedRevision = record(current.result.purchaseRevision);
          const replacesPurchaseActionId = requiredText(revisionContext.replacesPurchaseActionId, "Superseded purchase action ID", 220);
          const replacesPurchaseDraftId = requiredText(revisionContext.replacesPurchaseDraftId, "Superseded purchase draft ID", 220);
          const supersededReleaseHash = requiredText(revisionContext.supersededReleaseHash, "Superseded release hash", 128);
          const supplierExceptionHash = requiredText(revisionContext.supplierExceptionHash, "Supplier exception hash", 128);
          const supplierExceptionEvidenceId = requiredText(revisionContext.supplierExceptionEvidenceId, "Supplier exception evidence ID", 220);
          if (projectedRevision.state !== "APPROVAL_PENDING"
            || projectedRevision.replacementDraftTaskId !== purchaseDraft.id
            || projectedRevision.replacementPurchaseActionId !== approval.executionTask.id
            || projectedRevision.replacementApprovalId !== approval.id
            || projectedRevision.replacementActionScopeHash !== approval.scopeHash
            || projectedRevision.replacesPurchaseActionId !== replacesPurchaseActionId
            || projectedRevision.supersededReleaseHash !== supersededReleaseHash
            || projectedRevision.supplierExceptionHash !== supplierExceptionHash) {
            throw new SupplyPersistenceError("The revised order authorization no longer matches the active supplier exception.", "conflict");
          }
          [supersededAction, supersededDraft] = await Promise.all([
            tx.supplyExecutionTask.findFirst({
              where: { id: replacesPurchaseActionId, officeId: args.context.officeId, workspaceId: workspace.id, parentTaskId: replacesPurchaseDraftId, taskType: PURCHASE_ACTION_TASK_TYPE, capabilityKey: PURCHASE_ACTION_CAPABILITY, status: "RUNNING" },
              select: purchaseActionSelect,
            }),
            tx.supplyExecutionTask.findFirst({
              where: { id: replacesPurchaseDraftId, officeId: args.context.officeId, workspaceId: workspace.id, parentTaskId: procurementCase.id, taskType: PURCHASE_DRAFT_TASK_TYPE, status: "RUNNING" },
              select: purchaseDraftSelect,
            }),
          ]);
          const supersededResult = record(supersededAction?.result);
          const supersededRelease = record(supersededResult.release);
          supersededExceptions = Array.isArray(supersededResult.supplierOrderExceptions)
            ? supersededResult.supplierOrderExceptions.map((value) => record(value))
            : [];
          targetSupplierException = supersededExceptions.find((value) => value.exceptionHash === supplierExceptionHash) ?? null;
          const replacementDraft = record(targetSupplierException?.replacementDraft);
          if (!supersededAction || !supersededDraft
            || !["RELEASED", "PARTIALLY_ACKNOWLEDGED"].includes(String(supersededResult.state))
            || supersededRelease.releaseHash !== supersededReleaseHash
            || targetSupplierException?.status !== "REVISION_DRAFTED"
            || targetSupplierException.evidenceId !== supplierExceptionEvidenceId
            || replacementDraft.taskId !== purchaseDraft.id
            || replacementDraft.replacementScopeHash !== revisionContext.replacementScopeHash
            || supersededExceptions.some((value) => value.status === "OPEN_REVIEW")
            || supersededExceptions.filter(supplierOrderRevisionPending).length !== 1) {
            throw new SupplyPersistenceError("The supplier exception no longer supports this revised authorization.", "conflict");
          }
          const exceptionEvidence = await tx.supplyEvidence.findFirst({
            where: { id: supplierExceptionEvidenceId, officeId: args.context.officeId, workspaceId: workspace.id, executionTaskId: replacesPurchaseActionId, kind: "SUPPLIER_ORDER_EXCEPTION", contentHash: supplierExceptionHash },
            select: { id: true },
          });
          if (!exceptionEvidence) throw new SupplyPersistenceError("Supplier exception evidence is missing from the revised authorization.", "conflict");
        }
        const commercial = record(actionInput.commercial);
        const qualityPlan = record(actionInput.qualityPlan);
        const sourceExpired = !currentSupplierQualification(actionInput.sourceEvidenceReview);
        const quoteExpired = typeof commercial.quoteValidUntil !== "string" || commercial.quoteValidUntil < todayUtc();
        const deliveryExpired = typeof commercial.deliveryDate !== "string" || commercial.deliveryDate < todayUtc();
        const qualityExpired = typeof qualityPlan.targetDate !== "string" || qualityPlan.targetDate < todayUtc();
        const approvalExpired = approval.expiresAt !== null && approval.expiresAt.getTime() <= Date.now();
        if (sourceExpired || quoteExpired || deliveryExpired || qualityExpired || approvalExpired) {
          const staleGate = sourceExpired ? "SOURCE_EVIDENCE" : quoteExpired || deliveryExpired || approvalExpired ? "COMMERCIAL_TERMS" : "QUALITY_PLAN";
          const expiredAt = new Date();
          if (isRevisedOrder) {
            await tx.supplyApproval.update({
              where: { id: approval.id },
              data: { status: "EXPIRED", decidedAt: expiredAt, decisionNote: "Revised purchase inputs expired before authorization." },
            });
            await tx.supplyExecutionTask.update({
              where: { id: approval.executionTask.id },
              data: { status: "CANCELLED", cancelledAt: expiredAt },
            });
            const expiredRevisionResult: Record<string, unknown> = {
              ...current.result,
              purchaseRevision: {
                ...record(current.result.purchaseRevision),
                state: "EXPIRED",
                staleGate,
                expiredAt: expiredAt.toISOString(),
                updatedAt: expiredAt.toISOString(),
              },
              updatedAt: expiredAt.toISOString(),
            };
            delete expiredRevisionResult.purchaseAuthorization;
            const updatedCase = await tx.supplyExecutionTask.update({
              where: { id: procurementCase.id },
              data: { result: inputJson(expiredRevisionResult), resultHash: digest(expiredRevisionResult) },
              select: caseSelect,
            });
            await appendCaseEvent({
              tx,
              caseId: procurementCase.id,
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              actorUserId: args.context.userId,
              eventType: "REVISED_PURCHASE_APPROVAL_EXPIRED",
              status: "CANCELLED",
              message: "The revised order approval expired. Update the replacement draft before requesting another decision.",
              payload: inputJson({ purchaseActionId: approval.executionTask.id, approvalId: approval.id, staleGate }),
            });
            return {
              procurementCase: { ...updatedCase, purchaseDraft, purchaseAction: null },
              purchaseDraft,
              purchaseAction: null,
              approval: { ...approval, status: "EXPIRED", decidedAt: expiredAt },
              stale: true,
            };
          }
          await tx.supplyApproval.update({
            where: { id: approval.id },
            data: { status: "EXPIRED", decidedAt: expiredAt, decisionNote: "Approved purchase inputs expired before authorization." },
          });
          await tx.supplyExecutionTask.update({
            where: { id: approval.executionTask.id },
            data: { status: "CANCELLED", cancelledAt: expiredAt },
          });
          await tx.supplyExecutionTask.update({
            where: { id: purchaseDraft.id },
            data: { status: "CANCELLED", cancelledAt: expiredAt },
          });
          if (staleGate === "SOURCE_EVIDENCE") {
            await cancelActiveQuoteCycles(tx, procurementCase.id, args.context.officeId, workspace.id);
          }
          const expiredResult: Record<string, unknown> = {
            ...current.result,
            gates: staleGate === "SOURCE_EVIDENCE"
              ? { ...current.gates, sourceEvidence: "REVIEW_REQUIRED", commercialTerms: "REVIEW_REQUIRED", qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" }
              : staleGate === "COMMERCIAL_TERMS"
                ? { ...current.gates, commercialTerms: "REVIEW_REQUIRED", qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" }
                : { ...current.gates, qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" },
            stage: staleGate === "SOURCE_EVIDENCE" ? "SOURCE_EVIDENCE" : staleGate === "COMMERCIAL_TERMS" ? "COMMERCIAL_CONFIRMATION" : "QUALITY_REVIEW",
            approval: null,
            updatedAt: expiredAt.toISOString(),
          };
          delete expiredResult.purchasePreparation;
          delete expiredResult.purchaseAuthorization;
          if (staleGate === "SOURCE_EVIDENCE") {
            delete expiredResult.confirmedTerms;
            delete expiredResult.qualityPlan;
            delete expiredResult.quoteCycle;
            expiredResult.reviews = { sourceEvidence: current.reviews.sourceEvidence };
          } else if (staleGate === "COMMERCIAL_TERMS") {
            delete expiredResult.confirmedTerms;
            delete expiredResult.qualityPlan;
            expiredResult.reviews = { sourceEvidence: current.reviews.sourceEvidence };
          } else {
            delete expiredResult.qualityPlan;
            expiredResult.reviews = {
              sourceEvidence: current.reviews.sourceEvidence,
              commercialTerms: current.reviews.commercialTerms,
            };
          }
          const updatedCase = await tx.supplyExecutionTask.update({
            where: { id: procurementCase.id },
            data: { result: inputJson(expiredResult), resultHash: digest(expiredResult) },
            select: caseSelect,
          });
          await appendCaseEvent({
            tx,
            caseId: procurementCase.id,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            actorUserId: args.context.userId,
            eventType: "PURCHASE_ACTION_APPROVAL_EXPIRED",
            status: "CANCELLED",
            message: "Final purchase approval expired and the case returned to review.",
            payload: inputJson({ purchaseActionId: approval.executionTask.id, approvalId: approval.id, staleGate }),
          });
          return {
            procurementCase: { ...updatedCase, purchaseDraft: null, purchaseAction: null },
            purchaseDraft: null,
            purchaseAction: null,
            approval: { ...approval, status: "EXPIRED", decidedAt: expiredAt },
            stale: true,
          };
        }

        if (approval.requestedByUserId === args.context.userId) {
          const alternativeAdmins = await tx.user.count({
            where: {
              officeId: args.context.officeId,
              id: { not: args.context.userId },
              isActive: true,
              role: "ADMIN",
            },
          });
          if (alternativeAdmins > 0) {
            throw new SupplyPersistenceError("A different admin is available, so self-authorization is blocked.", "forbidden");
          }
        }
        const decidedAt = new Date();
        await tx.supplyApproval.update({
          where: { id: approval.id },
          data: { status: targetStatus, decidedByUserId: args.context.userId, decidedAt, decisionNote: note },
        });
        const actionResult = {
          state: decision === "APPROVE" ? "AUTHORIZED" : "REJECTED",
          approvalId: approval.id,
          scopeHash: approval.scopeHash,
          decidedByUserId: args.context.userId,
          decidedAt: decidedAt.toISOString(),
          decisionNote: note,
          externalSideEffect: false,
          ...(isRevisedOrder ? { revisionContext } : {}),
        };
        const purchaseAction = await tx.supplyExecutionTask.update({
          where: { id: approval.executionTask.id },
          data: {
            status: decision === "APPROVE" ? "READY" : "BLOCKED",
            result: inputJson(actionResult),
            resultHash: digest(actionResult),
          },
          select: purchaseActionSelect,
        });
        const updatedDraft = await tx.supplyExecutionTask.update({
          where: { id: purchaseDraft.id },
          data: { status: decision === "APPROVE" ? "READY" : "PLANNED" },
          select: purchaseDraftSelect,
        });
        const projectedCaseResult: Record<string, unknown> = {
          ...current.result,
          purchaseAuthorization: {
            ...authorization,
            status: targetStatus,
            decidedByUserId: args.context.userId,
            decidedAt: decidedAt.toISOString(),
            decisionNote: note,
          },
          ...(isRevisedOrder ? {
            purchaseRevision: {
              ...record(current.result.purchaseRevision),
              state: decision === "APPROVE" ? "AUTHORIZED" : "REJECTED",
              replacementPurchaseActionId: approval.executionTask.id,
              replacementApprovalId: approval.id,
              replacementActionScopeHash: approval.scopeHash,
              decidedByUserId: args.context.userId,
              decidedAt: decidedAt.toISOString(),
              decisionNote: note,
              updatedAt: decidedAt.toISOString(),
            },
          } : {}),
          updatedAt: decidedAt.toISOString(),
        };
        if (isRevisedOrder && decision === "APPROVE") {
          if (!supersededAction || !supersededDraft || !targetSupplierException) {
            throw new SupplyPersistenceError("The superseded order could not be finalized.", "conflict");
          }
          const supplierExceptionHash = requiredText(revisionContext.supplierExceptionHash, "Supplier exception hash", 128);
          const revisedExceptions = supersededExceptions.map((value) => value.exceptionHash === supplierExceptionHash
            ? {
                ...value,
                status: "REVISION_AUTHORIZED",
                replacementAuthorization: {
                  purchaseDraftTaskId: purchaseDraft.id,
                  purchaseActionTaskId: purchaseAction.id,
                  approvalId: approval.id,
                  scopeHash: approval.scopeHash,
                  authorizedByUserId: args.context.userId,
                  authorizedAt: decidedAt.toISOString(),
                },
              }
            : value);
          const pendingReplacementActionResult = {
            ...record(supersededAction.result),
            supplierOrderExceptions: revisedExceptions,
            openSupplierExceptionCount: revisedExceptions.filter((value) => value.status === "OPEN_REVIEW").length,
            revisionRequiredCount: revisedExceptions.filter(supplierOrderRevisionPending).length,
            replacementAuthorization: {
              purchaseDraftTaskId: purchaseDraft.id,
              purchaseActionTaskId: purchaseAction.id,
              approvalId: approval.id,
              scopeHash: approval.scopeHash,
              supplierExceptionHash,
              authorizedAt: decidedAt.toISOString(),
            },
            updatedAt: decidedAt.toISOString(),
          };
          await tx.supplyExecutionTask.update({
            where: { id: supersededAction.id },
            data: { result: inputJson(pendingReplacementActionResult), resultHash: digest(pendingReplacementActionResult) },
          });
          await appendCaseEvent({
            tx,
            caseId: supersededAction.id,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            actorUserId: args.context.userId,
            eventType: "REVISED_PURCHASE_ACTION_AUTHORIZED",
            status: "RUNNING",
            message: "The replacement scope is authorized. The released order remains outstanding until the revision is issued.",
            payload: inputJson({ replacementPurchaseActionId: purchaseAction.id, approvalId: approval.id, scopeHash: approval.scopeHash, supplierExceptionHash }),
          });
        }
        const updatedCase = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(projectedCaseResult), resultHash: digest(projectedCaseResult) },
          select: caseSelect,
        });
        await appendCaseEvent({
          tx,
          caseId: approval.executionTask.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType: decision === "APPROVE" ? "PURCHASE_ACTION_AUTHORIZED" : "PURCHASE_ACTION_REJECTED",
          status: decision === "APPROVE" ? "READY" : "BLOCKED",
          message: decision === "APPROVE"
            ? "The exact purchase action is authorized for controlled execution. No external side effect was performed."
            : "The purchase action was rejected for revision.",
          payload: inputJson(actionResult),
        });
        await appendCaseEvent({
          tx,
          caseId: procurementCase.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType: decision === "APPROVE" ? "PURCHASE_ACTION_AUTHORIZED" : "PURCHASE_ACTION_REJECTED",
          status: decision === "APPROVE" ? "READY" : "BLOCKED",
          message: decision === "APPROVE"
            ? "The order scope is approved for controlled supplier execution."
            : "The order draft requires revision before another approval request.",
          payload: inputJson({ purchaseActionId: approval.executionTask.id, approvalId: approval.id, scopeHash: approval.scopeHash, note }),
        });
        const actionWithApproval = {
          ...purchaseActionView(purchaseAction),
          approval: { ...approval, status: targetStatus, decidedByUserId: args.context.userId, decidedAt, decisionNote: note },
        };
        return {
          procurementCase: { ...updatedCase, purchaseDraft: updatedDraft, purchaseAction: actionWithApproval },
          purchaseDraft: updatedDraft,
          purchaseAction: actionWithApproval,
          approval: actionWithApproval.approval,
          stale: false,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || transactionAttempt === 2) {
        if (retryableTransactionError(error)) {
          throw new SupplyPersistenceError("Purchase authorization changed concurrently. Reload and retry.", "conflict");
        }
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Purchase authorization could not be decided.", "conflict");
}

function normalizePurchaseOrderRelease(input: unknown) {
  const body = record(input);
  const channel = requiredText(body.channel, "Release channel", 40).toUpperCase();
  if (!PURCHASE_RELEASE_CHANNELS.includes(channel as (typeof PURCHASE_RELEASE_CHANNELS)[number])) {
    throw new SupplyPersistenceError(`Release channel must be one of: ${PURCHASE_RELEASE_CHANNELS.join(", ")}.`, "invalid_input");
  }
  const releasedOn = requireCurrentOrPastDate(isoDate(body.releasedOn, "Release date"), "Release date");
  const acknowledgmentDueOn = isoDate(body.acknowledgmentDueOn, "Acknowledgment due date");
  if (acknowledgmentDueOn < releasedOn) {
    throw new SupplyPersistenceError("Acknowledgment due date cannot precede the release date.", "invalid_input");
  }
  return {
    expectedScopeHash: requiredText(body.expectedScopeHash, "Authorized order scope hash", 128),
    channel: channel as (typeof PURCHASE_RELEASE_CHANNELS)[number],
    releasedOn,
    acknowledgmentDueOn,
    purchaseOrderReference: requiredText(body.purchaseOrderReference, "Purchase order reference", 300),
    evidenceUrl: publicUrl(body.evidenceUrl, "Purchase order release evidence URL"),
    note: optionalText(body.note, "Purchase order release note", 2_000),
  };
}

export async function recordPurchaseOrderRelease(args: {
  context: SupplyAccessContext;
  actionId: string;
  input: unknown;
}) {
  const releaseInput = normalizePurchaseOrderRelease(args.input);
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) {
    throw new SupplyPersistenceError("Only an admin or manager can record purchase order release.", "forbidden");
  }
  const found = await prisma.supplyExecutionTask.findFirst({
    where: {
      id: args.actionId,
      officeId: accessContext.officeId,
      taskType: PURCHASE_ACTION_TASK_TYPE,
      capabilityKey: PURCHASE_ACTION_CAPABILITY,
    },
    select: {
      workspaceId: true,
      parentTaskId: true,
      parentTask: { select: { parentTaskId: true } },
    },
  });
  const purchaseDraftId = found?.parentTaskId;
  const procurementCaseId = found?.parentTask?.parentTaskId;
  if (!found || !purchaseDraftId || !procurementCaseId) {
    throw new SupplyPersistenceError("Authorized purchase action was not found.", "not_found");
  }
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  if (workspace.id !== found.workspaceId) throw new SupplyPersistenceError("Authorized purchase action was not found.", "not_found");

  for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${purchaseDraftId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.actionId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${purchaseDraftId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);

        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: { id: procurementCaseId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: TASK_TYPE },
          select: caseSelect,
        });
        const purchaseDraft = await tx.supplyExecutionTask.findFirst({
          where: {
            id: purchaseDraftId,
            officeId: accessContext.officeId,
            workspaceId: workspace.id,
            parentTaskId: procurementCaseId,
            taskType: PURCHASE_DRAFT_TASK_TYPE,
            status: { in: ["READY", "RUNNING", "SUCCEEDED"] },
          },
          select: purchaseDraftSelect,
        });
        const purchaseAction = await tx.supplyExecutionTask.findFirst({
          where: {
            id: args.actionId,
            officeId: accessContext.officeId,
            workspaceId: workspace.id,
            parentTaskId: purchaseDraftId,
            taskType: PURCHASE_ACTION_TASK_TYPE,
            capabilityKey: PURCHASE_ACTION_CAPABILITY,
            status: { in: ["READY", "RUNNING", "SUCCEEDED"] },
          },
          select: purchaseActionSelect,
        });
        if (!procurementCase || !purchaseDraft || !purchaseAction) {
          throw new SupplyPersistenceError("Authorized purchase action was not found.", "not_found");
        }
        const approval = await tx.supplyApproval.findFirst({
          where: {
            officeId: accessContext.officeId,
            workspaceId: workspace.id,
            executionTaskId: purchaseAction.id,
            status: "APPROVED",
            scopeHash: purchaseAction.inputHash,
            requiredRole: PURCHASE_ACTION_REQUIRED_ROLE,
          },
          orderBy: { requestedAt: "desc" },
          include: { decidedBy: { select: { role: true, isActive: true } } },
        });
        if (!approval || approval.scopeHash !== releaseInput.expectedScopeHash) {
          throw new SupplyPersistenceError("Purchase order release does not match the authorized order scope.", "conflict");
        }
        const activePurchaseOrderEmail = await tx.supplyExecutionTask.findFirst({
          where: {
            officeId: accessContext.officeId,
            workspaceId: workspace.id,
            parentTaskId: purchaseDraftId,
            taskType: PURCHASE_ORDER_EMAIL_ACTION_TASK_TYPE,
            OR: [
              { status: { in: ["PLANNED", "READY", "RUNNING"] } },
              { status: "BLOCKED", result: { path: ["state"], equals: "NOT_FOUND_REVIEW_REQUIRED" } },
            ],
          },
          select: { id: true },
        });
        if (activePurchaseOrderEmail) {
          throw new SupplyPersistenceError("A connected purchase order email is pending, approved, or unresolved. Finish or revise that workflow before recording another channel.", "conflict");
        }
        const current = caseResult(procurementCase.result);
        const authorization = record(current.result.purchaseAuthorization);
        if (authorization.actionTaskId !== purchaseAction.id
          || authorization.approvalId !== approval.id
          || authorization.scopeHash !== approval.scopeHash
          || !["APPROVED", "RELEASED", "PARTIALLY_ACKNOWLEDGED", "ACKNOWLEDGED"].includes(String(authorization.status))) {
          throw new SupplyPersistenceError("The procurement case no longer points to this authorized action.", "conflict");
        }
        const existingResult = record(purchaseAction.result);
        const existingRelease = record(existingResult.release);
        const normalizedRelease = {
          actionScopeHash: purchaseAction.inputHash,
          channel: releaseInput.channel,
          releasedOn: releaseInput.releasedOn,
          acknowledgmentDueOn: releaseInput.acknowledgmentDueOn,
          purchaseOrderReference: releaseInput.purchaseOrderReference,
          evidenceUrl: releaseInput.evidenceUrl,
          note: releaseInput.note,
        };
        const releaseHash = digest(normalizedRelease);
        if (typeof existingRelease.releaseHash === "string") {
          if (existingRelease.releaseHash !== releaseHash) {
            throw new SupplyPersistenceError("The purchase order was already released. Create a new procurement case for a changed order.", "conflict");
          }
          const existingEvidenceId = requiredText(existingRelease.evidenceId, "Stored purchase order release evidence ID", 220);
          const existingEvidenceUrl = publicUrl(existingRelease.evidenceUrl, "Stored purchase order release evidence URL");
          const existingEvidence = await tx.supplyEvidence.findFirst({
            where: {
              id: existingEvidenceId,
              officeId: accessContext.officeId,
              workspaceId: workspace.id,
              executionTaskId: purchaseAction.id,
              kind: "PURCHASE_ORDER_RELEASE",
              sourceUri: existingEvidenceUrl,
              contentHash: releaseHash,
            },
            select: { id: true },
          });
          if (existingRelease.actionScopeHash !== purchaseAction.inputHash || !existingEvidence) {
            throw new SupplyPersistenceError("Stored purchase order release evidence no longer matches the authorized action.", "conflict");
          }
          return {
            procurementCase: { ...procurementCase, purchaseDraft, purchaseAction: purchaseActionView(purchaseAction, approval) },
            purchaseDraft,
            purchaseAction: purchaseActionView(purchaseAction, approval),
            release: existingRelease,
          };
        }
        if (Array.isArray(existingResult.acknowledgments) && existingResult.acknowledgments.length) {
          throw new SupplyPersistenceError("Supplier acknowledgment exists without a durable release record. Review the legacy order before continuing.", "conflict");
        }
        if (existingResult.state !== "AUTHORIZED" || purchaseAction.status !== "READY" || purchaseDraft.status !== "READY") {
          throw new SupplyPersistenceError("The purchase action is not in an authorized release-ready state.", "conflict");
        }
        if (!approval.decidedBy?.isActive || approval.decidedBy.role !== PURCHASE_ACTION_REQUIRED_ROLE) {
          throw new SupplyPersistenceError("The purchase authorization no longer has an active admin decision.", "conflict");
        }
        const actionInput = record(purchaseAction.input);
        const order = record(actionInput.order);
        const commercial = record(actionInput.commercial);
        const quoteValidUntil = isoDate(commercial.quoteValidUntil, "Authorized quote validity date");
        const approvalDate = approval.decidedAt?.toISOString().slice(0, 10) ?? null;
        if (!approvalDate || releaseInput.releasedOn < approvalDate) {
          throw new SupplyPersistenceError("Purchase order release cannot precede final purchase authorization.", "invalid_input");
        }
        if (releaseInput.releasedOn > quoteValidUntil) {
          throw new SupplyPersistenceError("Purchase order release occurred after the authorized quote expired.", "conflict");
        }
        if (!supplierQualificationValidOn(actionInput.sourceEvidenceReview, releaseInput.releasedOn)) {
          throw new SupplyPersistenceError("Supplier qualification was not valid on the purchase order release date.", "conflict");
        }
        const needBy = isoDate(order.needBy, "Authorized order need-by date");
        if (releaseInput.acknowledgmentDueOn > needBy) {
          throw new SupplyPersistenceError("Acknowledgment due date cannot be after the authorized need-by date.", "invalid_input");
        }
        let orderedQuantity: Prisma.Decimal;
        let unitPrice: Prisma.Decimal;
        try {
          orderedQuantity = new Prisma.Decimal(requiredText(order.quantity, "Authorized order quantity", 80));
          unitPrice = new Prisma.Decimal(requiredText(commercial.unitPrice, "Authorized unit price", 80));
        } catch {
          throw new SupplyPersistenceError("Authorized order quantity or price is invalid.", "conflict");
        }
        if (!orderedQuantity.isPositive() || !unitPrice.isPositive()) {
          throw new SupplyPersistenceError("Authorized order quantity or price is invalid.", "conflict");
        }
        const unitOfMeasure = normalizedUnitOfMeasure(order.unitOfMeasure, "Authorized unit of measure");
        const currency = requiredText(commercial.currency, "Authorized currency", 3).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw new SupplyPersistenceError("Authorized currency is invalid.", "conflict");

        const now = new Date();
        const evidence = await appendExternalEvidence({
          tx,
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          executionTaskId: purchaseAction.id,
          actorUserId: accessContext.userId,
          kind: "PURCHASE_ORDER_RELEASE",
          title: `Purchase order release ${releaseInput.purchaseOrderReference}`,
          sourceUri: releaseInput.evidenceUrl,
          sourceRecordId: releaseInput.purchaseOrderReference,
          observedOn: releaseInput.releasedOn,
          contentHash: releaseHash,
          payload: inputJson(normalizedRelease),
        });
        const release = {
          ...normalizedRelease,
          evidenceId: evidence.id,
          releaseHash,
          recordedByUserId: accessContext.userId,
          recordedAt: now.toISOString(),
        };
        const supersession = await finalizeReplacementSupersession({
          tx,
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          procurementCaseId: procurementCase.id,
          replacementActionId: purchaseAction.id,
          replacementActionInput: purchaseAction.input,
          replacementScopeHash: purchaseAction.inputHash,
          replacementReleaseHash: releaseHash,
          releasedAt: now,
        });
        const actionResult = {
          state: "RELEASED",
          authorization: {
            approvalId: approval.id,
            scopeHash: approval.scopeHash,
            decidedByUserId: approval.decidedByUserId,
            decidedAt: approval.decidedAt?.toISOString() ?? null,
          },
          release,
          orderedQuantity: orderedQuantity.toString(),
          acknowledgedQuantity: "0",
          remainingQuantity: orderedQuantity.toString(),
          unitOfMeasure,
          acknowledgments: [],
          totals: { acknowledgedMaterialValue: "0", currency },
          externalSideEffect: "RECORDED_ONLY",
          updatedAt: now.toISOString(),
        };
        const storedAction = await tx.supplyExecutionTask.update({
          where: { id: purchaseAction.id },
          data: { status: "RUNNING", startedAt: purchaseAction.status === "READY" ? now : undefined, result: inputJson(actionResult), resultHash: digest(actionResult) },
          select: purchaseActionSelect,
        });
        const storedDraft = await tx.supplyExecutionTask.update({
          where: { id: purchaseDraft.id },
          data: { status: "RUNNING", startedAt: purchaseDraft.status === "READY" ? now : undefined },
          select: purchaseDraftSelect,
        });
        const projectedCaseResult = {
          ...current.result,
          purchaseAuthorization: { ...authorization, status: "RELEASED" },
          ...(Object.keys(record(current.result.purchaseRevision)).length ? {
            purchaseRevision: {
              ...record(current.result.purchaseRevision),
              state: "RELEASED",
              replacementReleaseHash: releaseHash,
              updatedAt: now.toISOString(),
            },
          } : {}),
          purchaseRelease: {
            state: "RELEASED",
            orderedQuantity: orderedQuantity.toString(),
            acknowledgedQuantity: "0",
            remainingQuantity: orderedQuantity.toString(),
            unitOfMeasure,
            release,
            updatedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        };
        const updatedCase = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(projectedCaseResult), resultHash: digest(projectedCaseResult) },
          select: caseSelect,
        });
        await appendCaseEvent({
          tx,
          caseId: purchaseAction.id,
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          actorUserId: accessContext.userId,
          eventType: "PURCHASE_ORDER_RELEASED",
          status: "RUNNING",
          message: "The authorized purchase order was recorded as released to the supplier.",
          payload: inputJson({ release, scopeHash: purchaseAction.inputHash }),
        });
        await appendCaseEvent({
          tx,
          caseId: procurementCase.id,
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          actorUserId: accessContext.userId,
          eventType: "PURCHASE_ORDER_RELEASED",
          status: "RUNNING",
          message: "The purchase order is awaiting supplier acknowledgment.",
          payload: inputJson({ purchaseActionId: purchaseAction.id, releaseHash, acknowledgmentDueOn: releaseInput.acknowledgmentDueOn }),
        });
        if (supersession) {
          await appendCaseEvent({
            tx,
            caseId: supersession.supersededActionId,
            officeId: accessContext.officeId,
            workspaceId: workspace.id,
            actorUserId: accessContext.userId,
            eventType: "PURCHASE_ORDER_SUPERSEDED",
            status: "SUCCEEDED",
            message: "The revised order was released and superseded the earlier supplier-facing scope.",
            payload: inputJson({ replacementPurchaseActionId: purchaseAction.id, releaseHash, supplierExceptionHash: supersession.supplierExceptionHash }),
          });
        }
        return {
          procurementCase: { ...updatedCase, purchaseDraft: storedDraft, purchaseAction: purchaseActionView(storedAction, approval) },
          purchaseDraft: storedDraft,
          purchaseAction: purchaseActionView(storedAction, approval),
          release,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || transactionAttempt === 2) {
        if (retryableTransactionError(error)) {
          throw new SupplyPersistenceError("Purchase order release changed concurrently. Reload and retry.", "conflict");
        }
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Purchase order release could not be recorded.", "conflict");
}

function normalizeSupplierAcknowledgment(input: unknown) {
  const body = record(input);
  const connectedReplyEvidenceId = optionalText(body.connectedReplyEvidenceId, "Connected supplier reply evidence ID", 220);
  const acknowledgedOn = requireCurrentOrPastDate(isoDate(body.acknowledgedOn, "Acknowledgment date"), "Acknowledgment date");
  const confirmedDeliveryDate = isoDate(body.confirmedDeliveryDate, "Confirmed delivery date");
  if (confirmedDeliveryDate < acknowledgedOn) {
    throw new SupplyPersistenceError("Confirmed delivery date cannot precede the acknowledgment date.", "invalid_input");
  }
  const acceptedQuantity = positiveNumber(body.acceptedQuantity, "Accepted quantity");
  if (acceptedQuantity > 1_000_000_000) {
    throw new SupplyPersistenceError("Accepted quantity must not exceed 1,000,000,000.", "invalid_input");
  }
  return {
    expectedReleaseHash: requiredText(body.expectedReleaseHash, "Purchase order release hash", 128),
    acknowledgedOn,
    supplierOrderReference: requiredText(body.supplierOrderReference, "Supplier order reference", 300),
    acceptedQuantity,
    confirmedDeliveryDate,
    evidenceUrl: connectedReplyEvidenceId
      ? optionalText(body.evidenceUrl, "Acknowledgment evidence URL", 2_000)
      : publicUrl(body.evidenceUrl, "Acknowledgment evidence URL"),
    connectedReplyEvidenceId,
    note: optionalText(body.note, "Acknowledgment note", 2_000),
  };
}

function normalizeSupplierOrderException(input: unknown) {
  const body = record(input);
  const category = requiredText(body.category, "Supplier order exception category", 40).toUpperCase();
  if (!SUPPLIER_ORDER_EXCEPTION_CATEGORIES.includes(category as (typeof SUPPLIER_ORDER_EXCEPTION_CATEGORIES)[number])) {
    throw new SupplyPersistenceError(`Supplier order exception category must be one of: ${SUPPLIER_ORDER_EXCEPTION_CATEGORIES.join(", ")}.`, "invalid_input");
  }
  const connectedReplyEvidenceId = optionalText(body.connectedReplyEvidenceId, "Connected supplier reply evidence ID", 220);
  const observedOn = requireCurrentOrPastDate(isoDate(body.observedOn, "Supplier exception date"), "Supplier exception date");
  const proposedQuantity = optionalPositiveNumber(body.proposedQuantity, "Proposed quantity", 1_000_000_000);
  const proposedUnitPrice = optionalPositiveNumber(body.proposedUnitPrice, "Proposed unit price", 1_000_000_000_000);
  const proposedCurrency = proposedUnitPrice === null ? null : requiredText(body.proposedCurrency, "Proposed currency", 3).toUpperCase();
  if (proposedCurrency && !/^[A-Z]{3}$/.test(proposedCurrency)) throw new SupplyPersistenceError("Proposed currency must use a three-letter code.", "invalid_input");
  const proposedDeliveryDate = optionalText(body.proposedDeliveryDate, "Proposed delivery date", 10);
  const normalizedDeliveryDate = proposedDeliveryDate
    ? requireCurrentOrFutureDate(isoDate(proposedDeliveryDate, "Proposed delivery date"), "Proposed delivery date")
    : null;
  const proposedPaymentTerms = optionalText(body.proposedPaymentTerms, "Proposed payment terms", 500);
  if (category === "QUANTITY_CHANGE" && proposedQuantity === null) throw new SupplyPersistenceError("A quantity change requires the supplier's proposed quantity.", "invalid_input");
  if (category === "PRICE_CHANGE" && proposedUnitPrice === null) throw new SupplyPersistenceError("A price change requires the supplier's proposed unit price and currency.", "invalid_input");
  if (category === "DELIVERY_CHANGE" && !normalizedDeliveryDate) throw new SupplyPersistenceError("A delivery change requires the supplier's proposed delivery date.", "invalid_input");
  if (category === "TERMS_CHANGE" && !proposedPaymentTerms) throw new SupplyPersistenceError("A terms change requires the supplier's proposed payment terms.", "invalid_input");
  return {
    expectedReleaseHash: requiredText(body.expectedReleaseHash, "Purchase order release hash", 128),
    category: category as (typeof SUPPLIER_ORDER_EXCEPTION_CATEGORIES)[number],
    observedOn,
    summary: requiredText(body.summary, "Supplier exception summary", 2_000),
    proposedQuantity,
    proposedUnitPrice,
    proposedCurrency,
    proposedDeliveryDate: normalizedDeliveryDate,
    proposedPaymentTerms,
    evidenceUrl: connectedReplyEvidenceId
      ? optionalText(body.evidenceUrl, "Supplier exception evidence URL", 2_000)
      : publicUrl(body.evidenceUrl, "Supplier exception evidence URL"),
    connectedReplyEvidenceId,
    note: optionalText(body.note, "Supplier exception note", 2_000),
  };
}

function normalizeSupplierOrderExceptionResolution(input: unknown) {
  const body = record(input);
  const disposition = requiredText(body.disposition, "Supplier exception disposition", 40).toUpperCase();
  if (!SUPPLIER_ORDER_EXCEPTION_DISPOSITIONS.includes(disposition as (typeof SUPPLIER_ORDER_EXCEPTION_DISPOSITIONS)[number])) {
    throw new SupplyPersistenceError(`Supplier exception disposition must be one of: ${SUPPLIER_ORDER_EXCEPTION_DISPOSITIONS.join(", ")}.`, "invalid_input");
  }
  const note = requiredText(body.note, "Supplier exception resolution note", 2_000);
  if (note.length < 10) throw new SupplyPersistenceError("Supplier exception resolution note must explain the decision.", "invalid_input");
  return {
    expectedReleaseHash: requiredText(body.expectedReleaseHash, "Purchase order release hash", 128),
    exceptionHash: requiredText(body.exceptionHash, "Supplier exception hash", 128),
    disposition: disposition as (typeof SUPPLIER_ORDER_EXCEPTION_DISPOSITIONS)[number],
    note,
  };
}

export async function recordPurchaseOrderAcknowledgment(args: {
  context: SupplyAccessContext;
  actionId: string;
  input: unknown;
}) {
  const acknowledgmentInput = normalizeSupplierAcknowledgment(args.input);
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) {
    throw new SupplyPersistenceError("Only an admin or manager can record supplier acknowledgment.", "forbidden");
  }
  const found = await prisma.supplyExecutionTask.findFirst({
    where: {
      id: args.actionId,
      officeId: args.context.officeId,
      taskType: PURCHASE_ACTION_TASK_TYPE,
      capabilityKey: PURCHASE_ACTION_CAPABILITY,
    },
    select: {
      workspaceId: true,
      parentTaskId: true,
      parentTask: { select: { parentTaskId: true } },
    },
  });
  const purchaseDraftId = found?.parentTaskId;
  const procurementCaseId = found?.parentTask?.parentTaskId;
  if (!found || !purchaseDraftId || !procurementCaseId) {
    throw new SupplyPersistenceError("Authorized purchase action was not found.", "not_found");
  }
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  if (workspace.id !== found.workspaceId) throw new SupplyPersistenceError("Authorized purchase action was not found.", "not_found");

  for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${purchaseDraftId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.actionId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);

        const procurementCase = await tx.supplyExecutionTask.findFirst({
          where: { id: procurementCaseId, officeId: args.context.officeId, workspaceId: workspace.id, taskType: TASK_TYPE },
          select: caseSelect,
        });
        const purchaseDraft = await tx.supplyExecutionTask.findFirst({
          where: {
            id: purchaseDraftId,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            parentTaskId: procurementCaseId,
            taskType: PURCHASE_DRAFT_TASK_TYPE,
            status: { in: ["READY", "RUNNING", "SUCCEEDED"] },
          },
          select: purchaseDraftSelect,
        });
        const purchaseAction = await tx.supplyExecutionTask.findFirst({
          where: {
            id: args.actionId,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            parentTaskId: purchaseDraftId,
            taskType: PURCHASE_ACTION_TASK_TYPE,
            capabilityKey: PURCHASE_ACTION_CAPABILITY,
            status: { in: ["READY", "RUNNING", "SUCCEEDED"] },
          },
          select: purchaseActionSelect,
        });
        if (!procurementCase || !purchaseDraft || !purchaseAction) {
          throw new SupplyPersistenceError("Authorized purchase action was not found.", "not_found");
        }
        const approval = await tx.supplyApproval.findFirst({
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            executionTaskId: purchaseAction.id,
            status: "APPROVED",
            scopeHash: purchaseAction.inputHash,
            requiredRole: PURCHASE_ACTION_REQUIRED_ROLE,
          },
          orderBy: { requestedAt: "desc" },
          include: { decidedBy: { select: { role: true, isActive: true } } },
        });
        if (!approval) throw new SupplyPersistenceError("Purchase action no longer has an exact-scope approval.", "conflict");
        const current = caseResult(procurementCase.result);
        const authorization = record(current.result.purchaseAuthorization);
        if (authorization.actionTaskId !== purchaseAction.id
          || authorization.approvalId !== approval.id
          || authorization.scopeHash !== approval.scopeHash
          || !["APPROVED", "RELEASED", "PARTIALLY_ACKNOWLEDGED", "ACKNOWLEDGED"].includes(String(authorization.status))) {
          throw new SupplyPersistenceError("The procurement case no longer points to this authorized action.", "conflict");
        }

        const actionInput = record(purchaseAction.input);
        const order = record(actionInput.order);
        const commercial = record(actionInput.commercial);
        const rawQuoteCycleTaskId = commercial.quoteCycleTaskId;
        const rawQuoteResponseHash = commercial.quoteResponseHash;
        const hasQuoteCycleTaskId = rawQuoteCycleTaskId !== undefined && rawQuoteCycleTaskId !== null;
        const hasQuoteResponseHash = rawQuoteResponseHash !== undefined && rawQuoteResponseHash !== null;
        if (hasQuoteCycleTaskId !== hasQuoteResponseHash) {
          throw new SupplyPersistenceError("Authorized quote provenance is incomplete.", "conflict");
        }
        let quoteCycle: { id: string; status: string; result: Prisma.JsonValue | null } | null = null;
        let quoteResponseHash: string | null = null;
        if (hasQuoteCycleTaskId && hasQuoteResponseHash) {
          const quoteCycleTaskId = requiredText(rawQuoteCycleTaskId, "Authorized quote cycle task ID", 220);
          quoteResponseHash = requiredText(rawQuoteResponseHash, "Authorized quote response hash", 128);
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${quoteCycleTaskId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
          quoteCycle = await tx.supplyExecutionTask.findFirst({
            where: {
              id: quoteCycleTaskId,
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              parentTaskId: procurementCase.id,
              taskType: QUOTE_CYCLE_TASK_TYPE,
              capabilityKey: QUOTE_CYCLE_CAPABILITY,
              status: { in: ["RUNNING", "SUCCEEDED"] },
            },
            select: { id: true, status: true, result: true },
          });
          if (!quoteCycle || record(quoteCycle.result).selectedResponseHash !== quoteResponseHash) {
            throw new SupplyPersistenceError("Authorized quote provenance no longer matches the selected supplier response.", "conflict");
          }
        }
        let orderedQuantity: Prisma.Decimal;
        let unitPrice: Prisma.Decimal;
        try {
          orderedQuantity = new Prisma.Decimal(requiredText(order.quantity, "Authorized order quantity", 80));
          unitPrice = new Prisma.Decimal(requiredText(commercial.unitPrice, "Authorized unit price", 80));
        } catch {
          throw new SupplyPersistenceError("Authorized order quantity or price is invalid.", "conflict");
        }
        if (!orderedQuantity.isPositive() || !unitPrice.isPositive()) {
          throw new SupplyPersistenceError("Authorized order quantity or price is invalid.", "conflict");
        }
        const unitOfMeasure = normalizedUnitOfMeasure(order.unitOfMeasure, "Authorized unit of measure");
        const currency = requiredText(commercial.currency, "Authorized currency", 3).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw new SupplyPersistenceError("Authorized currency is invalid.", "conflict");
        const existingResult = record(purchaseAction.result);
        const release = record(existingResult.release);
        if (typeof release.releaseHash !== "string"
          || release.releaseHash !== acknowledgmentInput.expectedReleaseHash
          || release.actionScopeHash !== purchaseAction.inputHash) {
          throw new SupplyPersistenceError("Supplier acknowledgment does not match the durable purchase order release.", "conflict");
        }
        const releaseChannel = requiredText(release.channel, "Stored release channel", 40).toUpperCase();
        if (!PURCHASE_RELEASE_CHANNELS.includes(releaseChannel as (typeof PURCHASE_RELEASE_CHANNELS)[number])) {
          throw new SupplyPersistenceError("Stored purchase order release channel is invalid.", "conflict");
        }
        const releasedOn = isoDate(release.releasedOn, "Stored purchase order release date");
        const acknowledgmentDueOn = isoDate(release.acknowledgmentDueOn, "Stored acknowledgment due date");
        if (acknowledgmentInput.acknowledgedOn < releasedOn) {
          throw new SupplyPersistenceError("Acknowledgment date cannot precede the purchase order release date.", "invalid_input");
        }
        const quoteValidUntil = isoDate(commercial.quoteValidUntil, "Authorized quote validity date");
        const approvalDate = approval.decidedAt?.toISOString().slice(0, 10) ?? null;
        if (!approvalDate || releasedOn < approvalDate || releasedOn > quoteValidUntil) {
          throw new SupplyPersistenceError("Stored purchase order release no longer matches the final authorization and quote validity.", "conflict");
        }
        const releaseEvidenceId = requiredText(release.evidenceId, "Purchase order release evidence ID", 220);
        const releaseEvidence = await tx.supplyEvidence.findFirst({
          where: {
            id: releaseEvidenceId,
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            executionTaskId: purchaseAction.id,
            kind: "PURCHASE_ORDER_RELEASE",
            contentHash: release.releaseHash,
          },
          select: { id: true, sourceType: true, sourceUri: true },
        });
        if (!releaseEvidence?.sourceUri) {
          throw new SupplyPersistenceError("Purchase order release evidence no longer matches the authorized action.", "conflict");
        }
        const releaseEvidenceUrl = releaseEvidence.sourceType === "CONNECTED_PROVIDER"
          ? connectedProviderUrl(release.evidenceUrl, "Purchase order release evidence URL")
          : publicUrl(release.evidenceUrl, "Purchase order release evidence URL");
        const storedReleaseEvidenceUrl = releaseEvidence.sourceType === "CONNECTED_PROVIDER"
          ? connectedProviderUrl(releaseEvidence.sourceUri, "Stored purchase order release evidence URL")
          : publicUrl(releaseEvidence.sourceUri, "Stored purchase order release evidence URL");
        if (releaseEvidenceUrl !== storedReleaseEvidenceUrl) {
          throw new SupplyPersistenceError("Purchase order release evidence no longer matches the authorized action.", "conflict");
        }
        const acknowledgments = Array.isArray(existingResult.acknowledgments)
          ? existingResult.acknowledgments.map((value) => record(value))
          : [];
        const supplierOrderExceptions = Array.isArray(existingResult.supplierOrderExceptions)
          ? existingResult.supplierOrderExceptions.map((value) => record(value))
          : [];
        const connectedReplies = Array.isArray(existingResult.connectedAcknowledgmentReplies)
          ? existingResult.connectedAcknowledgmentReplies.map((value) => record(value))
          : [];
        if (supplierOrderExceptions.some(supplierOrderAcceptanceBlocked)) {
          throw new SupplyPersistenceError("Resolve the supplier order exception before recording acceptance against the original authorization.", "conflict");
        }
        let acknowledgmentEvidenceUrl = acknowledgmentInput.evidenceUrl;
        let acknowledgmentEvidenceType: "OPERATOR_RECORDED_EXTERNAL" | "CONNECTED_PROVIDER" = "OPERATOR_RECORDED_EXTERNAL";
        let acknowledgmentSourceRecordId = acknowledgmentInput.supplierOrderReference;
        let sourceEvidenceId: string | null = null;
        if (acknowledgmentInput.connectedReplyEvidenceId) {
          const connectedEvidence = await tx.supplyEvidence.findFirst({
            where: {
              id: acknowledgmentInput.connectedReplyEvidenceId,
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              executionTaskId: purchaseAction.id,
              kind: "SUPPLIER_ORDER_ACKNOWLEDGMENT_REPLY_EMAIL",
              sourceType: "CONNECTED_PROVIDER",
            },
            select: { id: true, sourceUri: true, sourceRecordId: true, observedAt: true, payload: true },
          });
          const connectedPayload = record(connectedEvidence?.payload);
          const connectedReply = connectedReplies.find((value) => value.evidenceId === connectedEvidence?.id);
          if (!connectedEvidence?.sourceUri
            || !connectedEvidence.sourceRecordId
            || !connectedEvidence.observedAt
            || connectedPayload.purchaseActionId !== purchaseAction.id
            || connectedPayload.releaseHash !== release.releaseHash
            || !["REVIEW_REQUIRED", "USED_AS_ACKNOWLEDGMENT"].includes(String(connectedReply?.reviewState))) {
            throw new SupplyPersistenceError("Connected supplier reply evidence no longer matches this released order.", "conflict");
          }
          const connectedUrl = connectedProviderUrl(connectedEvidence.sourceUri, "Connected supplier acknowledgment evidence URL");
          if (acknowledgmentInput.evidenceUrl && connectedProviderUrl(acknowledgmentInput.evidenceUrl, "Acknowledgment evidence URL") !== connectedUrl) {
            throw new SupplyPersistenceError("Acknowledgment evidence URL does not match the selected connected supplier reply.", "conflict");
          }
          if (acknowledgmentInput.acknowledgedOn !== connectedEvidence.observedAt.toISOString().slice(0, 10)) {
            throw new SupplyPersistenceError("Acknowledgment date must match the selected connected supplier reply.", "conflict");
          }
          sourceEvidenceId = connectedEvidence.id;
          acknowledgmentEvidenceUrl = connectedUrl;
          acknowledgmentEvidenceType = "CONNECTED_PROVIDER";
          acknowledgmentSourceRecordId = connectedEvidence.sourceRecordId;
        }
        if (!acknowledgments.length && (!approval.decidedBy?.isActive || approval.decidedBy.role !== PURCHASE_ACTION_REQUIRED_ROLE)) {
          throw new SupplyPersistenceError("The purchase authorization no longer has an active admin decision.", "conflict");
        }
        const acceptedQuantity = new Prisma.Decimal(acknowledgmentInput.acceptedQuantity);
        const normalizedAcknowledgment = {
          releaseHash: release.releaseHash,
          releaseChannel,
          releasedOn,
          acknowledgmentDueOn,
          acknowledgedOn: acknowledgmentInput.acknowledgedOn,
          supplierOrderReference: acknowledgmentInput.supplierOrderReference,
          acceptedQuantity: acceptedQuantity.toString(),
          unitOfMeasure,
          confirmedDeliveryDate: acknowledgmentInput.confirmedDeliveryDate,
          evidenceUrl: requiredText(acknowledgmentEvidenceUrl, "Acknowledgment evidence URL", 2_000),
          ...(sourceEvidenceId ? { sourceEvidenceId } : {}),
          note: acknowledgmentInput.note,
        };
        const acknowledgmentHash = digest(normalizedAcknowledgment);
        const repeated = acknowledgments.find((value) => value.acknowledgmentHash === acknowledgmentHash);
        if (repeated) {
          return {
            procurementCase: { ...procurementCase, purchaseDraft, purchaseAction: purchaseActionView(purchaseAction, approval) },
            purchaseDraft,
            purchaseAction: purchaseActionView(purchaseAction, approval),
            acknowledgment: repeated,
          };
        }
        if (sourceEvidenceId && acknowledgments.some((value) => value.sourceEvidenceId === sourceEvidenceId)) {
          throw new SupplyPersistenceError("This connected supplier reply was already used for an acknowledgment.", "conflict");
        }
        if (purchaseAction.status === "SUCCEEDED") {
          throw new SupplyPersistenceError("The authorized order is already fully acknowledged.", "conflict");
        }
        let previouslyAccepted = new Prisma.Decimal(0);
        try {
          for (const prior of acknowledgments) {
            previouslyAccepted = previouslyAccepted.add(requiredText(prior.acceptedQuantity, "Stored accepted quantity", 80));
          }
        } catch {
          throw new SupplyPersistenceError("Stored supplier acknowledgment quantity is invalid.", "conflict");
        }
        const remainingBefore = orderedQuantity.sub(previouslyAccepted);
        if (!remainingBefore.isPositive() || acceptedQuantity.greaterThan(remainingBefore)) {
          throw new SupplyPersistenceError(`Accepted quantity cannot exceed the remaining ${remainingBefore.toString()} ${unitOfMeasure}.`, "invalid_input");
        }
        const now = new Date();
        const evidence = await appendExternalEvidence({
          tx,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          executionTaskId: purchaseAction.id,
          actorUserId: args.context.userId,
          kind: "SUPPLIER_ORDER_ACKNOWLEDGMENT",
          title: `Supplier acknowledgment ${acknowledgmentInput.supplierOrderReference}`,
          sourceType: acknowledgmentEvidenceType,
          sourceUri: normalizedAcknowledgment.evidenceUrl,
          sourceRecordId: acknowledgmentSourceRecordId,
          observedOn: acknowledgmentInput.acknowledgedOn,
          contentHash: acknowledgmentHash,
          payload: inputJson(normalizedAcknowledgment),
        });
        const acknowledgment = {
          ...normalizedAcknowledgment,
          evidenceId: evidence.id,
          acknowledgmentHash,
          recordedByUserId: args.context.userId,
          recordedAt: now.toISOString(),
        };
        const acknowledgedQuantity = previouslyAccepted.add(acceptedQuantity);
        const remainingQuantity = orderedQuantity.sub(acknowledgedQuantity);
        const complete = remainingQuantity.isZero();
        const connectedAcknowledgmentReplies = connectedReplies.map((reply) => sourceEvidenceId && reply.evidenceId === sourceEvidenceId
          ? { ...reply, reviewState: "USED_AS_ACKNOWLEDGMENT", acknowledgmentHash }
          : reply);
        const lastAcknowledgmentSyncAt = typeof existingResult.lastAcknowledgmentSyncAt === "string"
          ? existingResult.lastAcknowledgmentSyncAt
          : null;
        const result = {
          state: complete ? "ACKNOWLEDGED" : "PARTIALLY_ACKNOWLEDGED",
          authorization: {
            approvalId: approval.id,
            scopeHash: approval.scopeHash,
            decidedByUserId: approval.decidedByUserId,
            decidedAt: approval.decidedAt?.toISOString() ?? null,
          },
          release,
          orderedQuantity: orderedQuantity.toString(),
          acknowledgedQuantity: acknowledgedQuantity.toString(),
          remainingQuantity: remainingQuantity.toString(),
          unitOfMeasure,
          acknowledgments: [...acknowledgments, acknowledgment],
          supplierOrderExceptions,
          connectedAcknowledgmentReplies,
          lastAcknowledgmentSyncAt,
          totals: {
            acknowledgedMaterialValue: acknowledgedQuantity.mul(unitPrice).toDecimalPlaces(2).toString(),
            currency,
          },
          lastAcknowledgment: acknowledgment,
          externalSideEffect: existingResult.externalSideEffect === "CONNECTED_PROVIDER"
            ? "CONNECTED_PROVIDER"
            : "RECORDED_ONLY",
          updatedAt: now.toISOString(),
        };

        if (purchaseAction.status === "READY") {
          await tx.supplyExecutionTask.update({
            where: { id: purchaseAction.id },
            data: { status: "RUNNING", startedAt: now, result: inputJson(result), resultHash: digest(result) },
          });
          await tx.supplyExecutionTask.update({
            where: { id: purchaseDraft.id },
            data: { status: "RUNNING", startedAt: now },
          });
        } else {
          await tx.supplyExecutionTask.update({
            where: { id: purchaseAction.id },
            data: { result: inputJson(result), resultHash: digest(result) },
          });
        }
        if (complete) {
          await tx.supplyExecutionTask.update({
            where: { id: purchaseAction.id },
            data: { status: "SUCCEEDED", completedAt: now, result: inputJson(result), resultHash: digest(result) },
          });
          await tx.supplyExecutionTask.update({
            where: { id: purchaseDraft.id },
            data: { status: "SUCCEEDED", completedAt: now },
          });
          if (quoteCycle?.status === "RUNNING") {
            await tx.supplyExecutionTask.update({
              where: { id: quoteCycle.id },
              data: { status: "SUCCEEDED", completedAt: now },
            });
            await appendCaseEvent({
              tx,
              caseId: quoteCycle.id,
              officeId: args.context.officeId,
              workspaceId: workspace.id,
              actorUserId: args.context.userId,
              eventType: "SUPPLIER_QUOTE_CYCLE_COMPLETED",
              status: "SUCCEEDED",
              message: "The selected supplier quote completed with full order acknowledgment.",
              payload: inputJson({ purchaseActionId: purchaseAction.id, responseHash: quoteResponseHash }),
            });
          }
        }

        const releaseState = complete ? "ACKNOWLEDGED" : "PARTIALLY_ACKNOWLEDGED";
        const projectedCaseResult = {
          ...current.result,
          purchaseAuthorization: {
            ...authorization,
            status: releaseState,
          },
          purchaseRelease: {
            state: releaseState,
            orderedQuantity: orderedQuantity.toString(),
            acknowledgedQuantity: acknowledgedQuantity.toString(),
            remainingQuantity: remainingQuantity.toString(),
            unitOfMeasure,
            release,
            lastSupplierOrderReference: acknowledgment.supplierOrderReference,
            lastConfirmedDeliveryDate: acknowledgment.confirmedDeliveryDate,
            connectedReplyCount: connectedAcknowledgmentReplies.length,
            unreviewedConnectedReplyCount: connectedAcknowledgmentReplies.filter((reply) => reply.reviewState === "REVIEW_REQUIRED").length,
            openSupplierExceptionCount: supplierOrderExceptions.filter((value) => value.status === "OPEN_REVIEW").length,
            revisionRequiredCount: supplierOrderExceptions.filter(supplierOrderRevisionPending).length,
            lastAcknowledgmentSyncAt,
            updatedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        };
        const updatedCase = await tx.supplyExecutionTask.update({
          where: { id: procurementCase.id },
          data: { result: inputJson(projectedCaseResult), resultHash: digest(projectedCaseResult) },
          select: caseSelect,
        });
        const sequence = await tx.supplyExecutionEvent.aggregate({
          where: { executionTaskId: purchaseAction.id },
          _max: { sequence: true },
        });
        await tx.supplyExecutionEvent.create({
          data: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            executionTaskId: purchaseAction.id,
            actorUserId: args.context.userId,
            sequence: (sequence._max.sequence ?? 0) + 1,
            eventType: complete ? "SUPPLIER_ORDER_ACKNOWLEDGED" : "SUPPLIER_ORDER_PARTIALLY_ACKNOWLEDGED",
            status: complete ? "SUCCEEDED" : "RUNNING",
            message: complete
              ? "The supplier acknowledgment covers the full authorized quantity."
              : "The supplier acknowledged part of the authorized quantity.",
            payload: inputJson({ acknowledgment, acknowledgedQuantity: acknowledgedQuantity.toString(), remainingQuantity: remainingQuantity.toString() }),
            payloadHash: digest({ acknowledgment, acknowledgedQuantity: acknowledgedQuantity.toString(), remainingQuantity: remainingQuantity.toString() }),
            idempotencyKey: `supplier-ack:${acknowledgmentHash}`,
          },
        });
        await appendCaseEvent({
          tx,
          caseId: procurementCase.id,
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          actorUserId: args.context.userId,
          eventType: complete ? "SUPPLIER_ORDER_ACKNOWLEDGED" : "SUPPLIER_ORDER_PARTIALLY_ACKNOWLEDGED",
          status: complete ? "SUCCEEDED" : "RUNNING",
          message: complete
            ? "Supplier acknowledgment covers the full authorized order quantity."
            : "Supplier acknowledgment leaves an authorized quantity open.",
          payload: inputJson({
            purchaseActionId: purchaseAction.id,
            acknowledgmentHash,
            acknowledgedQuantity: acknowledgedQuantity.toString(),
            remainingQuantity: remainingQuantity.toString(),
          }),
        });
        const storedAction = await tx.supplyExecutionTask.findUniqueOrThrow({
          where: { id: purchaseAction.id },
          select: purchaseActionSelect,
        });
        const storedDraft = await tx.supplyExecutionTask.findUniqueOrThrow({
          where: { id: purchaseDraft.id },
          select: purchaseDraftSelect,
        });
        return {
          procurementCase: { ...updatedCase, purchaseDraft: storedDraft, purchaseAction: purchaseActionView(storedAction, approval) },
          purchaseDraft: storedDraft,
          purchaseAction: purchaseActionView(storedAction, approval),
          acknowledgment,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || transactionAttempt === 2) {
        if (retryableTransactionError(error)) {
          throw new SupplyPersistenceError("Supplier acknowledgment changed concurrently. Reload and retry.", "conflict");
        }
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Supplier acknowledgment could not be recorded.", "conflict");
}

export async function recordSupplierOrderException(args: {
  context: SupplyAccessContext;
  actionId: string;
  input: unknown;
}) {
  const exceptionInput = normalizeSupplierOrderException(args.input);
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) {
    throw new SupplyPersistenceError("Only an admin or manager can record a supplier order exception.", "forbidden");
  }
  const found = await prisma.supplyExecutionTask.findFirst({
    where: { id: args.actionId, officeId: accessContext.officeId, taskType: PURCHASE_ACTION_TASK_TYPE, capabilityKey: PURCHASE_ACTION_CAPABILITY },
    select: { workspaceId: true, parentTaskId: true, parentTask: { select: { parentTaskId: true } } },
  });
  const purchaseDraftId = found?.parentTaskId;
  const procurementCaseId = found?.parentTask?.parentTaskId;
  if (!found || !purchaseDraftId || !procurementCaseId) throw new SupplyPersistenceError("Released purchase action was not found.", "not_found");
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  if (workspace.id !== found.workspaceId) throw new SupplyPersistenceError("Released purchase action was not found.", "not_found");

  for (let transactionAttempt = 0; transactionAttempt < 3; transactionAttempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${purchaseDraftId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.actionId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
        const [procurementCase, purchaseDraft, purchaseAction] = await Promise.all([
          tx.supplyExecutionTask.findFirst({ where: { id: procurementCaseId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: TASK_TYPE, status: "PLANNED" }, select: caseSelect }),
          tx.supplyExecutionTask.findFirst({ where: { id: purchaseDraftId, officeId: accessContext.officeId, workspaceId: workspace.id, parentTaskId: procurementCaseId, taskType: PURCHASE_DRAFT_TASK_TYPE, status: "RUNNING" }, select: purchaseDraftSelect }),
          tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, parentTaskId: purchaseDraftId, taskType: PURCHASE_ACTION_TASK_TYPE, capabilityKey: PURCHASE_ACTION_CAPABILITY, status: "RUNNING" }, select: purchaseActionSelect }),
        ]);
        if (!procurementCase || !purchaseDraft || !purchaseAction) throw new SupplyPersistenceError("Released purchase action was not found.", "not_found");
        const caseResult = record(procurementCase.result);
        const authorization = record(caseResult.purchaseAuthorization);
        const projectedRelease = record(caseResult.purchaseRelease);
        const actionResult = record(purchaseAction.result);
        const release = record(actionResult.release);
        const existingExceptions = Array.isArray(actionResult.supplierOrderExceptions) ? actionResult.supplierOrderExceptions.map((value) => record(value)) : [];
        if (existingExceptions.some((value) => ["REVISION_DRAFTED", "REVISION_AUTHORIZED"].includes(String(value.status)))) {
          throw new SupplyPersistenceError("Complete or revise the active replacement order before recording another supplier exception.", "conflict");
        }
        if (!["RELEASED", "PARTIALLY_ACKNOWLEDGED"].includes(String(actionResult.state))
          || authorization.actionTaskId !== purchaseAction.id
          || release.releaseHash !== exceptionInput.expectedReleaseHash
          || release.releaseHash !== record(projectedRelease.release).releaseHash
          || release.actionScopeHash !== purchaseAction.inputHash) {
          throw new SupplyPersistenceError("Supplier exception does not match the durable released order.", "conflict");
        }
        const actionInput = record(purchaseAction.input);
        const order = record(actionInput.order);
        const commercial = record(actionInput.commercial);
        const orderedQuantity = new Prisma.Decimal(requiredText(order.quantity, "Authorized order quantity", 80));
        const unitPrice = new Prisma.Decimal(requiredText(commercial.unitPrice, "Authorized unit price", 80));
        const currency = requiredText(commercial.currency, "Authorized currency", 3).toUpperCase();
        const authorizedDeliveryDate = isoDate(commercial.deliveryDate, "Authorized delivery date");
        const authorizedPaymentTerms = requiredText(order.paymentTerms, "Authorized payment terms", 500);
        const proposedQuantity = exceptionInput.proposedQuantity === null ? null : new Prisma.Decimal(exceptionInput.proposedQuantity).toString();
        const proposedUnitPrice = exceptionInput.proposedUnitPrice === null ? null : new Prisma.Decimal(exceptionInput.proposedUnitPrice).toString();
        if (exceptionInput.category === "QUANTITY_CHANGE" && proposedQuantity === orderedQuantity.toString()) {
          throw new SupplyPersistenceError("Proposed quantity is unchanged from the authorized order.", "invalid_input");
        }
        if (exceptionInput.category === "PRICE_CHANGE" && proposedUnitPrice === unitPrice.toString() && exceptionInput.proposedCurrency === currency) {
          throw new SupplyPersistenceError("Proposed price and currency are unchanged from the authorized order.", "invalid_input");
        }
        if (exceptionInput.category === "DELIVERY_CHANGE" && exceptionInput.proposedDeliveryDate === authorizedDeliveryDate) {
          throw new SupplyPersistenceError("Proposed delivery date is unchanged from the authorized order.", "invalid_input");
        }
        if (exceptionInput.category === "TERMS_CHANGE" && exceptionInput.proposedPaymentTerms?.toLowerCase() === authorizedPaymentTerms.toLowerCase()) {
          throw new SupplyPersistenceError("Proposed payment terms are unchanged from the authorized order.", "invalid_input");
        }
        const acknowledgments = Array.isArray(actionResult.acknowledgments) ? actionResult.acknowledgments.map((value) => record(value)) : [];
        const connectedReplies = Array.isArray(actionResult.connectedAcknowledgmentReplies) ? actionResult.connectedAcknowledgmentReplies.map((value) => record(value)) : [];
        let evidenceUrl = exceptionInput.evidenceUrl;
        let evidenceType: "OPERATOR_RECORDED_EXTERNAL" | "CONNECTED_PROVIDER" = "OPERATOR_RECORDED_EXTERNAL";
        let evidenceSourceRecordId = `supplier-exception:${exceptionInput.category}:${exceptionInput.observedOn}`;
        let sourceEvidenceId: string | null = null;
        if (exceptionInput.connectedReplyEvidenceId) {
          const connectedEvidence = await tx.supplyEvidence.findFirst({
            where: { id: exceptionInput.connectedReplyEvidenceId, officeId: accessContext.officeId, workspaceId: workspace.id, executionTaskId: purchaseAction.id, kind: "SUPPLIER_ORDER_ACKNOWLEDGMENT_REPLY_EMAIL", sourceType: "CONNECTED_PROVIDER" },
            select: { id: true, sourceUri: true, sourceRecordId: true, observedAt: true, payload: true },
          });
          const connectedPayload = record(connectedEvidence?.payload);
          const reply = connectedReplies.find((value) => value.evidenceId === connectedEvidence?.id);
          if (!connectedEvidence?.sourceUri || !connectedEvidence.sourceRecordId || !connectedEvidence.observedAt
            || connectedPayload.purchaseActionId !== purchaseAction.id
            || connectedPayload.releaseHash !== release.releaseHash
            || !reply || !["REVIEW_REQUIRED", "USED_AS_ORDER_EXCEPTION"].includes(String(reply.reviewState))) {
            throw new SupplyPersistenceError("Connected supplier reply evidence no longer matches this released order or was already reviewed.", "conflict");
          }
          if (acknowledgments.some((value) => value.sourceEvidenceId === connectedEvidence.id)) {
            throw new SupplyPersistenceError("This connected supplier reply was already used for an order decision.", "conflict");
          }
          const connectedUrl = connectedProviderUrl(connectedEvidence.sourceUri, "Connected supplier exception evidence URL");
          if (exceptionInput.evidenceUrl && connectedProviderUrl(exceptionInput.evidenceUrl, "Supplier exception evidence URL") !== connectedUrl) {
            throw new SupplyPersistenceError("Supplier exception evidence URL does not match the selected connected reply.", "conflict");
          }
          if (exceptionInput.observedOn !== connectedEvidence.observedAt.toISOString().slice(0, 10)) {
            throw new SupplyPersistenceError("Supplier exception date must match the selected connected reply.", "conflict");
          }
          sourceEvidenceId = connectedEvidence.id;
          evidenceUrl = connectedUrl;
          evidenceType = "CONNECTED_PROVIDER";
          evidenceSourceRecordId = connectedEvidence.sourceRecordId;
        }
        const normalizedException = {
          releaseHash: release.releaseHash,
          actionScopeHash: purchaseAction.inputHash,
          category: exceptionInput.category,
          observedOn: exceptionInput.observedOn,
          summary: exceptionInput.summary,
          proposedQuantity,
          proposedUnitPrice,
          proposedCurrency: exceptionInput.proposedCurrency,
          proposedDeliveryDate: exceptionInput.proposedDeliveryDate,
          proposedPaymentTerms: exceptionInput.proposedPaymentTerms,
          evidenceUrl: requiredText(evidenceUrl, "Supplier exception evidence URL", 2_000),
          ...(sourceEvidenceId ? { sourceEvidenceId } : {}),
          note: exceptionInput.note,
        };
        const exceptionHash = digest(normalizedException);
        const repeated = existingExceptions.find((value) => value.exceptionHash === exceptionHash);
        if (repeated) return { procurementCase, purchaseDraft, purchaseAction: purchaseActionView(purchaseAction), exception: repeated };
        if (sourceEvidenceId && existingExceptions.some((value) => value.sourceEvidenceId === sourceEvidenceId)) {
          throw new SupplyPersistenceError("This connected supplier reply was already used for a different order decision.", "conflict");
        }
        const now = new Date();
        const evidence = await appendExternalEvidence({
          tx,
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          executionTaskId: purchaseAction.id,
          actorUserId: accessContext.userId,
          kind: "SUPPLIER_ORDER_EXCEPTION",
          title: `Supplier order exception: ${exceptionInput.category.toLowerCase().replaceAll("_", " ")}`,
          sourceType: evidenceType,
          sourceUri: normalizedException.evidenceUrl,
          sourceRecordId: evidenceSourceRecordId,
          observedOn: exceptionInput.observedOn,
          contentHash: exceptionHash,
          payload: inputJson(normalizedException),
        });
        const supplierException = { ...normalizedException, evidenceId: evidence.id, exceptionHash, status: "OPEN_REVIEW", recordedByUserId: accessContext.userId, recordedAt: now.toISOString() };
        const supplierOrderExceptions = [...existingExceptions, supplierException];
        const updatedReplies = connectedReplies.map((reply) => sourceEvidenceId && reply.evidenceId === sourceEvidenceId
          ? { ...reply, reviewState: "USED_AS_ORDER_EXCEPTION", exceptionHash }
          : reply);
        const nextActionResult = {
          ...actionResult,
          supplierOrderExceptions,
          connectedAcknowledgmentReplies: updatedReplies,
          openSupplierExceptionCount: supplierOrderExceptions.filter((value) => value.status === "OPEN_REVIEW").length,
          revisionRequiredCount: supplierOrderExceptions.filter(supplierOrderRevisionPending).length,
          updatedAt: now.toISOString(),
        };
        const updatedAction = await tx.supplyExecutionTask.update({ where: { id: purchaseAction.id }, data: { result: inputJson(nextActionResult), resultHash: digest(nextActionResult) }, select: purchaseActionSelect });
        const nextCaseResult = {
          ...caseResult,
          purchaseRelease: {
            ...projectedRelease,
            openSupplierExceptionCount: nextActionResult.openSupplierExceptionCount,
            revisionRequiredCount: nextActionResult.revisionRequiredCount,
            unreviewedConnectedReplyCount: updatedReplies.filter((reply) => reply.reviewState === "REVIEW_REQUIRED").length,
            updatedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        };
        const updatedCase = await tx.supplyExecutionTask.update({ where: { id: procurementCase.id }, data: { result: inputJson(nextCaseResult), resultHash: digest(nextCaseResult) }, select: caseSelect });
        const payload = inputJson({ purchaseActionId: purchaseAction.id, exceptionHash, category: exceptionInput.category, evidenceId: evidence.id });
        await appendCaseEvent({ tx, caseId: purchaseAction.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: "SUPPLIER_ORDER_EXCEPTION_RECORDED", status: "RUNNING", message: "A supplier order exception requires disposition before acceptance can continue.", payload });
        await appendCaseEvent({ tx, caseId: procurementCase.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: "SUPPLIER_ORDER_EXCEPTION_RECORDED", status: "RUNNING", message: "Supplier terms differ from the authorized order.", payload });
        return { procurementCase: { ...updatedCase, purchaseDraft, purchaseAction: purchaseActionView(updatedAction) }, purchaseDraft, purchaseAction: purchaseActionView(updatedAction), exception: supplierException };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!retryableTransactionError(error) || transactionAttempt === 2) {
        if (retryableTransactionError(error)) throw new SupplyPersistenceError("Supplier order exception changed concurrently. Reload and retry.", "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Supplier order exception could not be recorded.", "conflict");
}

export async function resolveSupplierOrderException(args: {
  context: SupplyAccessContext;
  actionId: string;
  input: unknown;
}) {
  const resolutionInput = normalizeSupplierOrderExceptionResolution(args.input);
  const accessContext = await currentAccessContext(args.context);
  if (!["ADMIN", "MANAGER"].includes(accessContext.role)) throw new SupplyPersistenceError("Only an admin or manager can resolve a supplier order exception.", "forbidden");
  if (resolutionInput.disposition === "REQUIRE_REAUTHORIZATION" && accessContext.role !== "ADMIN") {
    throw new SupplyPersistenceError("Only an admin can require a new purchase authorization.", "forbidden");
  }
  const found = await prisma.supplyExecutionTask.findFirst({
    where: { id: args.actionId, officeId: accessContext.officeId, taskType: PURCHASE_ACTION_TASK_TYPE, capabilityKey: PURCHASE_ACTION_CAPABILITY },
    select: { workspaceId: true, parentTaskId: true, parentTask: { select: { parentTaskId: true } } },
  });
  const purchaseDraftId = found?.parentTaskId;
  const procurementCaseId = found?.parentTask?.parentTaskId;
  if (!found || !purchaseDraftId || !procurementCaseId) throw new SupplyPersistenceError("Released purchase action was not found.", "not_found");
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  if (workspace.id !== found.workspaceId) throw new SupplyPersistenceError("Released purchase action was not found.", "not_found");

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${purchaseDraftId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.actionId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    const [procurementCase, purchaseDraft, purchaseAction] = await Promise.all([
      tx.supplyExecutionTask.findFirst({ where: { id: procurementCaseId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: TASK_TYPE, status: "PLANNED" }, select: caseSelect }),
      tx.supplyExecutionTask.findFirst({ where: { id: purchaseDraftId, officeId: accessContext.officeId, workspaceId: workspace.id, parentTaskId: procurementCaseId, taskType: PURCHASE_DRAFT_TASK_TYPE, status: "RUNNING" }, select: purchaseDraftSelect }),
      tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, parentTaskId: purchaseDraftId, taskType: PURCHASE_ACTION_TASK_TYPE, capabilityKey: PURCHASE_ACTION_CAPABILITY, status: "RUNNING" }, select: purchaseActionSelect }),
    ]);
    if (!procurementCase || !purchaseDraft || !purchaseAction) throw new SupplyPersistenceError("Released purchase action was not found.", "not_found");
    const caseResult = record(procurementCase.result);
    const projectedRelease = record(caseResult.purchaseRelease);
    const actionResult = record(purchaseAction.result);
    const release = record(actionResult.release);
    if (release.releaseHash !== resolutionInput.expectedReleaseHash || release.releaseHash !== record(projectedRelease.release).releaseHash) {
      throw new SupplyPersistenceError("Supplier exception resolution does not match the durable released order.", "conflict");
    }
    const existingExceptions = Array.isArray(actionResult.supplierOrderExceptions) ? actionResult.supplierOrderExceptions.map((value) => record(value)) : [];
    const target = existingExceptions.find((value) => value.exceptionHash === resolutionInput.exceptionHash);
    if (!target) throw new SupplyPersistenceError("Supplier order exception was not found.", "not_found");
    if (target.category === "REJECTION" && resolutionInput.disposition !== "RETURN_TO_SOURCING") {
      throw new SupplyPersistenceError("A supplier rejection must return to sourcing and cannot retain or revise the rejected order.", "conflict");
    }
    if (target.category !== "REJECTION" && resolutionInput.disposition === "RETURN_TO_SOURCING") {
      throw new SupplyPersistenceError("Only a supplier rejection can return this order to sourcing.", "conflict");
    }
    const expectedStatus = resolutionInput.disposition === "KEEP_ORIGINAL"
      ? "RESOLVED_KEEP_ORIGINAL"
      : resolutionInput.disposition === "REQUIRE_REAUTHORIZATION"
        ? "REVISION_REQUIRED"
        : "RETURNED_TO_SOURCING";
    if (target.status !== "OPEN_REVIEW") {
      if (target.status === expectedStatus && record(target.resolution).disposition === resolutionInput.disposition) {
        return { procurementCase, purchaseDraft, purchaseAction: purchaseActionView(purchaseAction), exception: target };
      }
      throw new SupplyPersistenceError("Supplier order exception already has a different disposition.", "conflict");
    }
    const now = new Date();
    const resolution = { disposition: resolutionInput.disposition, note: resolutionInput.note, decidedByUserId: accessContext.userId, decidedAt: now.toISOString() };
    const supplierOrderExceptions = existingExceptions.map((value) => value.exceptionHash === resolutionInput.exceptionHash ? { ...value, status: expectedStatus, resolution } : value);
    const openSupplierExceptionCount = supplierOrderExceptions.filter((value) => value.status === "OPEN_REVIEW").length;
    const revisionRequiredCount = supplierOrderExceptions.filter(supplierOrderRevisionPending).length;
    const nextActionResult = { ...actionResult, supplierOrderExceptions, openSupplierExceptionCount, revisionRequiredCount, updatedAt: now.toISOString() };
    const updatedAction = await tx.supplyExecutionTask.update({ where: { id: purchaseAction.id }, data: { result: inputJson(nextActionResult), resultHash: digest(nextActionResult) }, select: purchaseActionSelect });
    const nextCaseResult = {
      ...caseResult,
      ...(resolutionInput.disposition === "RETURN_TO_SOURCING" ? {
        sourcingReturn: {
          state: "REQUIRED",
          purchaseActionId: purchaseAction.id,
          supplierExceptionHash: resolutionInput.exceptionHash,
          reason: resolutionInput.note,
          recordedByUserId: accessContext.userId,
          recordedAt: now.toISOString(),
        },
      } : {}),
      purchaseRelease: { ...projectedRelease, openSupplierExceptionCount, revisionRequiredCount, updatedAt: now.toISOString() },
      updatedAt: now.toISOString(),
    };
    const updatedCase = await tx.supplyExecutionTask.update({ where: { id: procurementCase.id }, data: { result: inputJson(nextCaseResult), resultHash: digest(nextCaseResult) }, select: caseSelect });
    const payload = inputJson({ purchaseActionId: purchaseAction.id, exceptionHash: resolutionInput.exceptionHash, resolution });
    const eventType = resolutionInput.disposition === "KEEP_ORIGINAL"
      ? "SUPPLIER_ORDER_EXCEPTION_RESOLVED"
      : resolutionInput.disposition === "REQUIRE_REAUTHORIZATION"
        ? "SUPPLIER_ORDER_REAUTHORIZATION_REQUIRED"
        : "SUPPLIER_ORDER_RETURNED_TO_SOURCING";
    const message = resolutionInput.disposition === "KEEP_ORIGINAL"
      ? "The original authorization remains unchanged; later supplier acceptance still needs separate evidence."
      : resolutionInput.disposition === "REQUIRE_REAUTHORIZATION"
        ? "Supplier changes require a new purchase authorization before acceptance can continue."
        : "The supplier rejected the order. This workstream returned to sourcing for another supplier.";
    await appendCaseEvent({ tx, caseId: purchaseAction.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType, status: "RUNNING", message, payload });
    await appendCaseEvent({ tx, caseId: procurementCase.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType, status: "RUNNING", message, payload });
    const resolvedException = supplierOrderExceptions.find((value) => value.exceptionHash === resolutionInput.exceptionHash)!;
    return { procurementCase: { ...updatedCase, purchaseDraft, purchaseAction: purchaseActionView(updatedAction) }, purchaseDraft, purchaseAction: purchaseActionView(updatedAction), exception: resolvedException };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Supplier order exception changed concurrently. Reload and retry.");
}

export async function prepareRevisedPurchaseOrder(args: {
  context: SupplyAccessContext;
  actionId: string;
  input: unknown;
}) {
  const revisedInput = normalizeRevisedPurchaseOrderDraft(args.input);
  const accessContext = await currentAccessContext(args.context);
  const found = await prisma.supplyExecutionTask.findFirst({
    where: {
      id: args.actionId,
      officeId: accessContext.officeId,
      taskType: PURCHASE_ACTION_TASK_TYPE,
      capabilityKey: PURCHASE_ACTION_CAPABILITY,
    },
    select: { workspaceId: true, parentTaskId: true, parentTask: { select: { parentTaskId: true } } },
  });
  const supersededDraftId = found?.parentTaskId;
  const procurementCaseId = found?.parentTask?.parentTaskId;
  if (!found || !supersededDraftId || !procurementCaseId) {
    throw new SupplyPersistenceError("Released purchase action was not found.", "not_found");
  }
  const workspace = await sourcingSystemWorkspace(accessContext, "edit");
  if (workspace.id !== found.workspaceId) throw new SupplyPersistenceError("Released purchase action was not found.", "not_found");

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "parentTaskId" = ${procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} ORDER BY "id" FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${args.actionId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    const [procurementCase, supersededDraft, purchaseAction] = await Promise.all([
      tx.supplyExecutionTask.findFirst({ where: { id: procurementCaseId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: TASK_TYPE, status: "PLANNED" }, select: caseSelect }),
      tx.supplyExecutionTask.findFirst({ where: { id: supersededDraftId, officeId: accessContext.officeId, workspaceId: workspace.id, parentTaskId: procurementCaseId, taskType: PURCHASE_DRAFT_TASK_TYPE, status: "RUNNING" }, select: purchaseDraftSelect }),
      tx.supplyExecutionTask.findFirst({ where: { id: args.actionId, officeId: accessContext.officeId, workspaceId: workspace.id, parentTaskId: supersededDraftId, taskType: PURCHASE_ACTION_TASK_TYPE, capabilityKey: PURCHASE_ACTION_CAPABILITY, status: "RUNNING" }, select: purchaseActionSelect }),
    ]);
    if (!procurementCase || !supersededDraft || !purchaseAction) {
      throw new SupplyPersistenceError("Released purchase action was not found.", "not_found");
    }
    const current = caseResult(procurementCase.result);
    const actionResult = record(purchaseAction.result);
    const release = record(actionResult.release);
    const projectedRelease = record(current.result.purchaseRelease);
    if (!["RELEASED", "PARTIALLY_ACKNOWLEDGED"].includes(String(actionResult.state))
      || release.releaseHash !== revisedInput.expectedReleaseHash
      || release.releaseHash !== record(projectedRelease.release).releaseHash
      || release.actionScopeHash !== purchaseAction.inputHash) {
      throw new SupplyPersistenceError("Revised order does not match the active released purchase scope.", "conflict");
    }
    const supplierOrderExceptions = Array.isArray(actionResult.supplierOrderExceptions)
      ? actionResult.supplierOrderExceptions.map((value) => record(value))
      : [];
    if (supplierOrderExceptions.some((value) => value.status === "OPEN_REVIEW")) {
      throw new SupplyPersistenceError("Resolve every open supplier exception before preparing a revised order.", "conflict");
    }
    const pendingRevisions = supplierOrderExceptions.filter(supplierOrderRevisionPending);
    const target = pendingRevisions.find((value) => value.exceptionHash === revisedInput.exceptionHash);
    if (!target) throw new SupplyPersistenceError("Supplier exception is not awaiting revised authorization.", "conflict");
    if (pendingRevisions.length !== 1) {
      throw new SupplyPersistenceError("Only one supplier exception can drive a replacement order at a time.", "conflict");
    }
    if (target.category === "REJECTION") {
      throw new SupplyPersistenceError("A supplier rejection cannot become a revised order. Return to the supplier shortlist instead.", "conflict");
    }
    const exceptionEvidenceId = requiredText(target.evidenceId, "Supplier exception evidence ID", 220);
    const exceptionHash = requiredText(target.exceptionHash, "Supplier exception hash", 128);
    const exceptionEvidence = await tx.supplyEvidence.findFirst({
      where: {
        id: exceptionEvidenceId,
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        executionTaskId: purchaseAction.id,
        kind: "SUPPLIER_ORDER_EXCEPTION",
        contentHash: exceptionHash,
      },
      select: { id: true, sourceUri: true, sourceType: true, observedAt: true },
    });
    if (!exceptionEvidence?.sourceUri || !exceptionEvidence.observedAt
      || !["OPERATOR_RECORDED_EXTERNAL", "CONNECTED_PROVIDER"].includes(exceptionEvidence.sourceType)) {
      throw new SupplyPersistenceError("Supplier exception evidence no longer matches the released order.", "conflict");
    }
    const actionInput = record(purchaseAction.input);
    const originalOrder = record(actionInput.order);
    const originalCommercial = record(actionInput.commercial);
    const procurementApproval = record(actionInput.procurementApproval);
    requireCurrentSupplierQualification(
      actionInput.sourceEvidenceReview,
      "The supplier qualification expired. Requalify the supplier before preparing a revised order.",
    );
    const qualityPlan = record(actionInput.qualityPlan);
    if (typeof qualityPlan.targetDate !== "string" || qualityPlan.targetDate < todayUtc()) {
      throw new SupplyPersistenceError("The approved quality plan expired. Record a current quality plan before preparing a revised order.", "conflict");
    }
    const approval = await tx.supplyApproval.findFirst({
      where: {
        id: requiredText(procurementApproval.id, "Procurement approval ID", 220),
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        status: "APPROVED",
        scopeHash: requiredText(procurementApproval.scopeHash, "Procurement approval scope hash", 128),
      },
      include: { executionTask: true },
    });
    if (!approval?.executionTask
      || approval.executionTask.parentTaskId !== procurementCase.id
      || approval.executionTask.taskType !== APPROVAL_TASK_TYPE
      || approval.executionTask.capabilityKey !== APPROVAL_CAPABILITY
      || approval.executionTask.inputHash !== approval.scopeHash) {
      throw new SupplyPersistenceError("The approved supplier award no longer matches this order.", "conflict");
    }
    const originalOrderQuantity = new Prisma.Decimal(requiredText(originalOrder.quantity, "Authorized order quantity", 80));
    const originalUnitPrice = new Prisma.Decimal(requiredText(originalCommercial.unitPrice, "Authorized unit price", 80));
    const originalMinimumOrderQuantity = new Prisma.Decimal(requiredText(originalCommercial.minimumOrderQuantity, "Authorized minimum order quantity", 80));
    const originalCurrency = requiredText(originalCommercial.currency, "Authorized currency", 3).toUpperCase();
    const proposedQuantity = target.proposedQuantity === null || target.proposedQuantity === undefined ? null : new Prisma.Decimal(requiredText(target.proposedQuantity, "Supplier proposed quantity", 80));
    const proposedUnitPrice = target.proposedUnitPrice === null || target.proposedUnitPrice === undefined ? null : new Prisma.Decimal(requiredText(target.proposedUnitPrice, "Supplier proposed unit price", 80));
    const revisedQuantity = new Prisma.Decimal(revisedInput.quantity);
    const revisedUnitPrice = new Prisma.Decimal(revisedInput.unitPrice);
    const revisedMinimumOrderQuantity = new Prisma.Decimal(revisedInput.minimumOrderQuantity);
    if (proposedQuantity ? !revisedQuantity.equals(proposedQuantity) : !revisedQuantity.equals(originalOrderQuantity)) {
      throw new SupplyPersistenceError("Revised quantity must match the supplier proposal or the original authorized quantity.", "conflict");
    }
    if (proposedUnitPrice
      ? !revisedUnitPrice.equals(proposedUnitPrice) || revisedInput.currency !== target.proposedCurrency
      : !revisedUnitPrice.equals(originalUnitPrice) || revisedInput.currency !== originalCurrency) {
      throw new SupplyPersistenceError("Revised price and currency must match the supplier exception or the original authorization.", "conflict");
    }
    if (!revisedMinimumOrderQuantity.equals(originalMinimumOrderQuantity)) {
      throw new SupplyPersistenceError("The revised MOQ is not supported by the supplier exception evidence.", "conflict");
    }
    const originalDeliveryDate = isoDate(originalCommercial.deliveryDate, "Authorized delivery date");
    if (revisedInput.deliveryDate !== (target.proposedDeliveryDate ?? originalDeliveryDate)) {
      throw new SupplyPersistenceError("Revised delivery date must match the supplier exception or the original authorization.", "conflict");
    }
    const originalPaymentTerms = requiredText(originalOrder.paymentTerms, "Authorized payment terms", 300);
    if (revisedInput.paymentTerms.toLowerCase() !== String(target.proposedPaymentTerms ?? originalPaymentTerms).toLowerCase()) {
      throw new SupplyPersistenceError("Revised payment terms must match the supplier exception or the original authorization.", "conflict");
    }
    const unitOfMeasure = normalizedUnitOfMeasure(originalOrder.unitOfMeasure, "Authorized unit of measure");
    const order = {
      quantity: revisedQuantity.toString(),
      unitOfMeasure,
      needBy: revisedInput.needBy,
      shipTo: revisedInput.shipTo,
      incoterm: revisedInput.incoterm,
      paymentTerms: revisedInput.paymentTerms,
      buyerReference: revisedInput.buyerReference,
      notes: revisedInput.notes,
    };
    const commercial = {
      unitPrice: revisedUnitPrice.toString(),
      currency: revisedInput.currency,
      minimumOrderQuantity: revisedMinimumOrderQuantity.toString(),
      quoteReference: revisedInput.quoteReference,
      quoteValidUntil: revisedInput.quoteValidUntil,
      deliveryDate: revisedInput.deliveryDate,
      quoteEvidenceUrl: exceptionEvidence.sourceUri,
      quoteEvidenceId: exceptionEvidence.id,
      quoteEvidenceHash: exceptionHash,
      evidenceClass: exceptionEvidence.sourceType,
      sourceKind: "SUPPLIER_ORDER_EXCEPTION",
    };
    const orderHash = digest(order);
    const replacementScopeHash = digest({ order, commercial });
    const revisionContext = {
      replacesPurchaseActionId: purchaseAction.id,
      replacesPurchaseDraftId: supersededDraft.id,
      supersededReleaseHash: release.releaseHash,
      supplierExceptionHash: exceptionHash,
      supplierExceptionEvidenceId: exceptionEvidence.id,
      supplierExceptionCategory: target.category,
      supplierExceptionObservedOn: exceptionEvidence.observedAt.toISOString().slice(0, 10),
      replacementScopeHash,
    };
    const taskKey = `purchase-revision:${procurementCase.id}:${purchaseAction.id}:${exceptionHash}`;
    const existing = await tx.supplyExecutionTask.findFirst({
      where: {
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        parentTaskId: procurementCase.id,
        taskKey,
        taskType: PURCHASE_DRAFT_TASK_TYPE,
      },
      select: purchaseDraftSelect,
    });
    const existingResult = record(existing?.result);
    const existingRevisionContext = record(existingResult.revisionContext);
    if (existing && existing.status === "PLANNED" && existingRevisionContext.replacementScopeHash === replacementScopeHash) {
      return { procurementCase: { ...procurementCase, purchaseDraft: existing, purchaseAction: null }, purchaseDraft: existing, purchaseAction: null, stale: false };
    }
    if (existing && existing.status !== "PLANNED") {
      throw new SupplyPersistenceError("Only an active revised order draft can be edited.", "conflict");
    }
    const currentRevision = typeof existingResult.revision === "number" ? existingResult.revision : 0;
    if ((existing && revisedInput.expectedRevision !== currentRevision) || (!existing && revisedInput.expectedRevision !== 0)) {
      throw new SupplyPersistenceError("The revised order draft changed in another session. Reload before saving.", "conflict");
    }
    if (existing) await cancelActivePurchaseActions(tx, existing.id, accessContext.officeId, workspace.id);
    const revision = currentRevision + 1;
    const now = new Date();
    const result = {
      revision,
      state: "DRAFT",
      order,
      orderHash,
      supplier: record(actionInput.supplier),
      commercial,
      totals: {
        materialSubtotal: revisedQuantity.mul(revisedUnitPrice).toDecimalPlaces(2).toString(),
        currency: revisedInput.currency,
      },
      approvedProcurementScope: { approvalId: approval.id, scopeHash: approval.scopeHash },
      revisionContext,
      updatedAt: now.toISOString(),
    };
    const taskInput = {
      procurementCaseId: procurementCase.id,
      procurementApprovalId: approval.id,
      procurementApprovalScopeHash: approval.scopeHash,
      revisionContext,
    };
    const revisedDraft = existing
      ? await tx.supplyExecutionTask.update({
          where: { id: existing.id },
          data: { result: inputJson(result), resultHash: digest(result) },
          select: purchaseDraftSelect,
        })
      : await tx.supplyExecutionTask.create({
          data: {
            officeId: accessContext.officeId,
            workspaceId: workspace.id,
            createdByUserId: accessContext.userId,
            parentTaskId: procurementCase.id,
            taskKey,
            taskType: PURCHASE_DRAFT_TASK_TYPE,
            capabilityKey: PURCHASE_DRAFT_CAPABILITY,
            requiresApproval: false,
            input: inputJson(taskInput),
            inputHash: digest(taskInput),
            result: inputJson(result),
            resultHash: digest(result),
            idempotencyKey: taskKey,
          },
          select: purchaseDraftSelect,
        });
    const revisedExceptions = supplierOrderExceptions.map((value) => value.exceptionHash === exceptionHash
      ? {
          ...value,
          status: "REVISION_DRAFTED",
          replacementDraft: {
            taskId: revisedDraft.id,
            revision,
            orderHash,
            replacementScopeHash,
            draftedByUserId: accessContext.userId,
            draftedAt: now.toISOString(),
          },
        }
      : value);
    const revisedActionResult = {
      ...actionResult,
      supplierOrderExceptions: revisedExceptions,
      revisionRequiredCount: revisedExceptions.filter(supplierOrderRevisionPending).length,
      updatedAt: now.toISOString(),
    };
    await tx.supplyExecutionTask.update({
      where: { id: purchaseAction.id },
      data: { result: inputJson(revisedActionResult), resultHash: digest(revisedActionResult) },
    });
    const projectedCaseResult: Record<string, unknown> = {
      ...current.result,
      purchasePreparation: { draftTaskId: revisedDraft.id, state: "DRAFT", revision, orderHash },
      purchaseRevision: {
        state: "DRAFT",
        replacesPurchaseActionId: purchaseAction.id,
        supersededReleaseHash: release.releaseHash,
        supplierExceptionHash: exceptionHash,
        supplierExceptionEvidenceId: exceptionEvidence.id,
        replacementDraftTaskId: revisedDraft.id,
        replacementDraftRevision: revision,
        replacementScopeHash,
        updatedAt: now.toISOString(),
      },
      updatedAt: now.toISOString(),
    };
    delete projectedCaseResult.purchaseAuthorization;
    const updatedCase = await tx.supplyExecutionTask.update({
      where: { id: procurementCase.id },
      data: { result: inputJson(projectedCaseResult), resultHash: digest(projectedCaseResult) },
      select: caseSelect,
    });
    const payload = inputJson({ purchaseActionId: purchaseAction.id, exceptionHash, replacementDraftTaskId: revisedDraft.id, replacementScopeHash, revision });
    await appendCaseEvent({ tx, caseId: revisedDraft.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: existing ? "REVISED_PURCHASE_DRAFT_UPDATED" : "REVISED_PURCHASE_DRAFT_CREATED", message: existing ? "The revised order draft was updated." : "A revised order draft was prepared from supplier exception evidence.", payload });
    await appendCaseEvent({ tx, caseId: procurementCase.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, eventType: existing ? "REVISED_PURCHASE_DRAFT_UPDATED" : "REVISED_PURCHASE_DRAFT_CREATED", message: "The supplier exception is ready for a new exact-scope purchase authorization.", payload });
    return { procurementCase: { ...updatedCase, purchaseDraft: revisedDraft, purchaseAction: null }, purchaseDraft: revisedDraft, purchaseAction: null, stale: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), "Revised purchase draft changed concurrently. Reload and retry.");
}
