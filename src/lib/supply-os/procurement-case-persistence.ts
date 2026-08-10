import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import { sourcingSystemWorkspace } from "./sourcing-research-persistence";

const RESEARCH_CAPABILITY = "research.supplier_candidates";
const TASK_TYPE = "PROCUREMENT_CASE";
const APPROVAL_TASK_TYPE = "PROCUREMENT_APPROVAL";
const APPROVAL_CAPABILITY = "review.procurement_selection";
const APPROVAL_REQUIRED_ROLE = "MANAGER";
const PURCHASE_DRAFT_TASK_TYPE = "PURCHASE_ORDER_DRAFT";
const PURCHASE_DRAFT_CAPABILITY = "draft.purchase_order";
const PURCHASE_INCOTERMS = ["EXW", "FCA", "FOB", "CPT", "CIP", "DAP", "DDP"] as const;

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

function retryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2002" || error.code === "P2034");
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

const purchaseDraftSelect = {
  id: true,
  status: true,
  taskKey: true,
  input: true,
  inputHash: true,
  result: true,
  resultHash: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplyExecutionTaskSelect;

export async function listProcurementCases(context: SupplyAccessContext) {
  const accessContext = await currentAccessContext(context);
  const workspace = await sourcingSystemWorkspace(accessContext, "view");
  const cases = await prisma.supplyExecutionTask.findMany({
    where: {
      officeId: context.officeId,
      workspaceId: workspace.id,
      taskType: TASK_TYPE,
    },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: {
      ...caseSelect,
      childTasks: {
        where: {
          officeId: context.officeId,
          workspaceId: workspace.id,
          taskType: PURCHASE_DRAFT_TASK_TYPE,
          status: { in: ["PLANNED", "BLOCKED", "READY"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: purchaseDraftSelect,
      },
    },
  });
  return cases.map(({ childTasks, ...procurementCase }) => ({
    ...procurementCase,
    purchaseDraft: childTasks[0] ?? null,
  }));
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

async function cancelActivePurchaseDrafts(
  tx: Prisma.TransactionClient,
  procurementCaseId: string,
  officeId: string,
  workspaceId: string,
  excludeTaskId?: string,
) {
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
  const input = {
    researchRunId: researchRun.id,
    researchInput: researchRun.input,
  } satisfies Prisma.InputJsonObject;
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
          where: {
            officeId: args.context.officeId,
            workspaceId: workspace.id,
            taskKey,
            taskType: TASK_TYPE,
          },
          select: caseSelect,
        });
        if (existing && existing.status !== "PLANNED") {
          throw new SupplyPersistenceError("Only a planned procurement case can change supplier selection.", "conflict");
        }
        if (record(existing?.result).selectionHash === result.selectionHash) return existing!;
        if (existing) {
          await cancelPendingApproval(tx, existing.result);
          await cancelActivePurchaseDrafts(tx, existing.id, args.context.officeId, workspace.id);
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
                // This mutable planning case is never an approval target. A later
                // immutable action task must bind supplier and terms in its input.
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
  const sourceReviewNote = gate === "SOURCE_EVIDENCE"
    ? requiredText(body.note, "Evidence review note", 2_000)
    : null;
  let confirmedTermsInput: Record<string, unknown> | null = null;
  if (gate === "COMMERCIAL_TERMS") {
    const currency = requiredText(body.currency, "Currency", 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new SupplyPersistenceError("Currency must be a three-letter ISO code.", "invalid_input");
    }
    confirmedTermsInput = {
      price: positiveNumber(body.price, "Price"),
      currency,
      minimumOrderQuantity: positiveNumber(body.minimumOrderQuantity, "Minimum order quantity"),
      unitOfMeasure: normalizedUnitOfMeasure(body.unitOfMeasure),
      deliveryDate: requireCurrentOrFutureDate(isoDate(body.deliveryDate, "Delivery date"), "Delivery date"),
      evidenceUrl: publicUrl(body.evidenceUrl, "Commercial evidence URL"),
      quoteReference: requiredText(body.quoteReference, "Quote reference", 300),
      validUntil: requireCurrentOrFutureDate(isoDate(body.validUntil, "Quote validity date"), "Quote validity date"),
    };
  }
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
          if (typeof sourceUrl !== "string") {
            throw new SupplyPersistenceError("An attributable supplier source is required before evidence review.", "conflict");
          }
          review = {
            sourceUrl: publicUrl(sourceUrl, "Supplier source"),
            note: sourceReviewNote,
            reviewedByUserId: args.context.userId,
            reviewedAt: now,
          };
          review.reviewHash = digest({ sourceUrl: review.sourceUrl, note: review.note });
          if (record(reviews.sourceEvidence).reviewHash === review.reviewHash) return procurementCase;
          await cancelPendingApproval(tx, procurementCase.result);
          await cancelActivePurchaseDrafts(tx, procurementCase.id, args.context.officeId, workspace.id);
          reviews = { sourceEvidence: review };
          gates = {
            ...gates,
            sourceEvidence: "EVIDENCE_COMPLETE",
            commercialTerms: "REVIEW_REQUIRED",
            qualityPlan: "REVIEW_REQUIRED",
            purchaseApproval: "BLOCKED",
          };
          delete result.confirmedTerms;
          delete result.qualityPlan;
          result = resetApproval(result, gates);
          eventType = "SOURCE_EVIDENCE_REVIEWED";
          message = "Supplier source evidence was reviewed.";
        } else if (gate === "COMMERCIAL_TERMS") {
          if (gates.sourceEvidence !== "EVIDENCE_COMPLETE") {
            throw new SupplyPersistenceError("Review supplier evidence before confirming commercial terms.", "conflict");
          }
          const confirmedTerms = confirmedTermsInput!;
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
          result = resetApproval({ ...result, confirmedTerms }, gates);
          eventType = "COMMERCIAL_TERMS_CONFIRMED";
          message = "Supplier commercial terms were confirmed.";
        } else {
          if (gates.sourceEvidence !== "EVIDENCE_COMPLETE" || gates.commercialTerms !== "EVIDENCE_COMPLETE") {
            throw new SupplyPersistenceError("Complete supplier and commercial review before recording a quality plan.", "conflict");
          }
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
          stage: nextStage(gates),
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
          throw new SupplyPersistenceError("Supplier selection changed. Reload before requesting approval.", "conflict");
        }
        if (["sourceEvidence", "commercialTerms", "qualityPlan"].some((key) => current.gates[key] !== "EVIDENCE_COMPLETE")) {
          throw new SupplyPersistenceError("All supplier, commercial, and quality gates must be complete before approval.", "conflict");
        }
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
        const approvedTerms = record(immutableInput.confirmedTerms);
        const approvedQualityPlan = record(immutableInput.qualityPlan);
        let staleGate: "COMMERCIAL_TERMS" | "QUALITY_PLAN" | "APPROVAL" | null = null;
        let staleMessage = "";
        if (typeof approvedTerms.validUntil !== "string" || approvedTerms.validUntil < todayUtc()) {
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
          const expiredApproval = await tx.supplyApproval.update({
            where: { id: approval.id },
            data: { status: "EXPIRED", decidedAt: expiredAt, decisionNote: staleMessage },
          });
          await tx.supplyExecutionTask.update({
            where: { id: approval.executionTask.id },
            data: { status: "CANCELLED", cancelledAt: expiredAt },
          });
          const gates = staleGate === "COMMERCIAL_TERMS"
            ? { ...current.gates, commercialTerms: "REVIEW_REQUIRED", qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" }
            : staleGate === "QUALITY_PLAN"
              ? { ...current.gates, qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" }
              : { ...current.gates, purchaseApproval: "BLOCKED" };
          const result: Record<string, unknown> = {
            ...current.result,
            gates,
            stage: staleGate === "COMMERCIAL_TERMS"
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
          if (staleGate === "COMMERCIAL_TERMS") {
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
        const approvedTerms = record(approvedInput.confirmedTerms);
        const approvedQualityPlan = record(approvedInput.qualityPlan);
        const approvedSelection = record(approvedInput.selectedOption);
        if (approvedInput.procurementCaseId !== procurementCase.id) {
          throw new SupplyPersistenceError("The approved procurement scope points to a different case.", "conflict");
        }
        let staleGate: "COMMERCIAL_TERMS" | "QUALITY_PLAN" | null = null;
        let staleMessage = "";
        if (typeof approvedTerms.validUntil !== "string" || approvedTerms.validUntil < todayUtc()) {
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
          const gates = staleGate === "COMMERCIAL_TERMS"
            ? { ...current.gates, commercialTerms: "REVIEW_REQUIRED", qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" }
            : { ...current.gates, qualityPlan: "REVIEW_REQUIRED", purchaseApproval: "BLOCKED" };
          const result: Record<string, unknown> = {
            ...current.result,
            gates,
            stage: staleGate === "COMMERCIAL_TERMS" ? "COMMERCIAL_CONFIRMATION" : "QUALITY_REVIEW",
            approval: null,
            updatedAt: new Date().toISOString(),
          };
          delete result.purchasePreparation;
          if (staleGate === "COMMERCIAL_TERMS") {
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
        const projectedCaseResult = {
          ...current.result,
          purchasePreparation: {
            draftTaskId: purchaseDraft.id,
            state: "DRAFT",
            revision,
            orderHash,
          },
          updatedAt: result.updatedAt,
        };
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
        return { procurementCase: { ...updatedCase, purchaseDraft }, purchaseDraft, stale: false };
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
