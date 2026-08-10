import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import { sourcingSystemWorkspace } from "./sourcing-research-persistence";

const RESEARCH_CAPABILITY = "research.supplier_candidates";
const TASK_TYPE = "PROCUREMENT_CASE";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

function progressionFor(selection: ProcurementSelectionInput) {
  const sourceEvidence = selection.sourceUrl ? "REVIEW_REQUIRED" : "BLOCKED";
  const commercialTerms = selection.priceType === "Sourced"
    && selection.deliveryType === "Sourced"
    && selection.currency !== null
    && selection.minimumOrderQuantity !== null
    ? "EVIDENCE_COMPLETE"
    : "REVIEW_REQUIRED";
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
  };
  return {
    ...caseState,
    selectionHash: digest(caseState),
    updatedAt: new Date().toISOString(),
  };
}

const caseSelect = {
  id: true,
  status: true,
  taskKey: true,
  input: true,
  result: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplyExecutionTaskSelect;

export async function listProcurementCases(context: SupplyAccessContext) {
  const workspace = await sourcingSystemWorkspace(context, "view");
  return prisma.supplyExecutionTask.findMany({
    where: {
      officeId: context.officeId,
      workspaceId: workspace.id,
      taskType: TASK_TYPE,
    },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: caseSelect,
  });
}

export async function saveProcurementSelection(args: {
  context: SupplyAccessContext;
  researchRunId: string;
  selection: ProcurementSelectionInput;
}) {
  const workspace = await sourcingSystemWorkspace(args.context, "edit");
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
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === "P2002" || error.code === "P2034");
      if (!retryable || attempt === 2) {
        if (retryable) throw new SupplyPersistenceError("Procurement case changed concurrently. Retry the selection.", "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Procurement case could not be saved.", "conflict");
}
