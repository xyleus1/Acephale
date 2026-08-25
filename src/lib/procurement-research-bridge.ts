import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  listProcurementRequests,
  procurementCustomerIdsFromServerMetadata,
} from "@/lib/procurement-workflow";
import {
  enqueueSourcingResearchRun,
  listSourcingResearchRuns,
} from "@/lib/supply-os/sourcing-research-persistence";
import {
  SupplyResearchIdempotencyConflictError,
  type SupplyAccessContext,
} from "@/lib/supply-os/persistence";
import { parseSupplierResearchRouteBody } from "@/lib/supply-os/supplier-research-route-contract";
import type { ProcurementRequestInput } from "@/lib/procurement-contract";

export type ProcurementResearchTask = {
  componentItemKey: string;
  componentName: string | null;
  specification: string | null;
  requestedQuantity: number | null;
  requestedUnit: string | null;
  needByDate: string | null;
  deliveryLocation: string | null;
  targetCountry: string | null;
};

export type ProcurementResearchOrderRow = {
  id: string;
  requestContext: unknown;
  notes?: string | null;
  quantity: number | string | null;
  unit: string | null;
  neededBy: Date | string | null;
  material?: string | null;
  specification?: string | null;
};

export class ProcurementResearchAccessError extends Error {
  readonly code = "missing_admin" as const;

  constructor(public readonly officeId: string) {
    super(`An active internal ADMIN is required for procurement research in office ${officeId}.`);
    this.name = "ProcurementResearchAccessError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maxLength = 1_000): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\u2014/g, "-").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function nestedText(records: Record<string, unknown>[], keys: string[], maxLength = 1_000) {
  for (const current of records) {
    for (const key of keys) {
      const value = text(current[key], maxLength);
      if (value) return value;
    }
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function requestRecords(value: unknown) {
  const context = record(value);
  const source = record(context.source);
  const logistics = record(context.logistics);
  const procurementContext = record(context.procurement_context);
  const request = record(procurementContext.request);
  return { context, source, logistics, request };
}

export function procurementOrderResearchTask(
  row: ProcurementResearchOrderRow,
): ProcurementResearchTask {
  const { source, logistics, request } = requestRecords(row.requestContext);
  const records = [request, source, logistics];
  return {
    componentItemKey: `procurement-order:${row.id}`,
    componentName: nestedText([request, source], ["material", "component_name", "componentName", "product_name", "productName"], 240)
      ?? text(row.material, 240),
    specification: nestedText([request, source], ["specification", "technical_identity", "technicalIdentity"], 1_000)
      ?? text(row.specification, 1_000),
    requestedQuantity: finiteNumber(row.quantity),
    requestedUnit: text(row.unit, 80)
      ?? nestedText(records, ["unit", "requested_unit", "requestedUnit"], 80),
    needByDate: dateOnly(row.neededBy)
      ?? dateOnly(text(request.needed_by ?? request.needByDate, 40)),
    deliveryLocation: nestedText([request, logistics, source], ["delivery_location", "deliveryLocation", "destination"], 240),
    targetCountry: nestedText([request, logistics, source], ["target_country", "targetCountry", "country"], 120),
  };
}

export function procurementOrderWorkspaceId(requestContext: unknown): string | null {
  const { source } = requestRecords(requestContext);
  return text(source.workspace_id ?? source.workspaceId, 220);
}

function researchInput(
  task: ProcurementResearchTask,
  notes: string | null | undefined,
  workspaceId: string,
): Prisma.InputJsonObject | null {
  if (!task.componentName) return null;
  return {
    componentItemKey: text(task.componentItemKey, 180) ?? task.componentItemKey,
    componentName: task.componentName,
    manufacturer: null,
    mpn: null,
    specification: task.specification,
    targetCountry: task.targetCountry,
    requestText: text(notes, 500) ?? task.componentName,
    requestedQuantity: task.requestedQuantity,
    requestedUnit: text(task.requestedUnit, 40),
    sourceRegion: null,
    deliveryLocation: task.deliveryLocation,
    needByDate: task.needByDate,
    workspaceId,
  };
}

export type ProcurementResearchAccessResolver = (officeId: string) => Promise<SupplyAccessContext>;

export async function procurementResearchAccessContext(officeId: string): Promise<SupplyAccessContext> {
  const user = await prisma.user.findFirst({
    where: {
      officeId,
      isActive: true,
      role: "ADMIN",
      customerPortalIdentity: null,
    },
    orderBy: { id: "asc" },
    select: { id: true, role: true, canViewWholeOffice: true },
  });
  if (!user) throw new ProcurementResearchAccessError(officeId);
  return {
    officeId,
    userId: user.id,
    role: user.role,
    canViewWholeOffice: user.canViewWholeOffice,
  };
}

export type EnqueueProcurementResearchDependencies = {
  resolveAccess: ProcurementResearchAccessResolver;
  listRuns: typeof listSourcingResearchRuns;
  enqueueRun: typeof enqueueSourcingResearchRun;
};

const defaultDependencies: EnqueueProcurementResearchDependencies = {
  resolveAccess: procurementResearchAccessContext,
  listRuns: listSourcingResearchRuns,
  enqueueRun: enqueueSourcingResearchRun,
};

export async function enqueueProcurementResearch(
  args: {
    officeId: string;
    order: ProcurementResearchOrderRow;
    workspaceId?: string | null;
  },
  dependencies: EnqueueProcurementResearchDependencies = defaultDependencies,
) {
  const task = procurementOrderResearchTask(args.order);
  const workspaceId = args.workspaceId ?? procurementOrderWorkspaceId(args.order.requestContext);
  const input = workspaceId ? researchInput(task, args.order.notes, workspaceId) : null;
  if (!workspaceId || !input) return { state: "skipped" as const, reason: "missing_research_context" as const };
  const parsed = parseSupplierResearchRouteBody(input);
  if (!parsed.ok) {
    const missingFields = Array.isArray(parsed.response.body.missingFields)
      ? parsed.response.body.missingFields
      : [];
    return {
      state: "skipped" as const,
      reason: "incomplete_request" as const,
      missingFields,
    };
  }
  const context = await dependencies.resolveAccess(args.officeId);
  const runs = await dependencies.listRuns(context, [], workspaceId);
  const existing = runs.find((run) => {
    const value = record(run.input);
    return value.componentItemKey === task.componentItemKey;
  });
  if (existing) return { state: "reused" as const, run: existing };
  let queued;
  try {
    queued = await dependencies.enqueueRun({
      context,
      workspaceId,
      input: parsed.input,
      idempotencyKey: task.componentItemKey,
    });
  } catch (error) {
    if (
      error instanceof SupplyResearchIdempotencyConflictError
      && error.code === "conflict"
      && error.idempotencyKey === task.componentItemKey
    ) {
      return { state: "reused" as const };
    }
    throw error;
  }
  return { state: queued.reused ? "reused" as const : "enqueued" as const, run: queued.run };
}

export async function enqueueProcurementResearchForSubmission(
  customerId: string,
  orderId: string,
  input: ProcurementRequestInput,
) {
  const mapping = procurementOfficeCustomerMappings().find((candidate) => candidate.customerId === customerId);
  if (!mapping) {
    return { state: "skipped" as const, reason: "unmapped_customer" as const };
  }
  return enqueueProcurementResearch({
    officeId: mapping.officeId,
    order: {
      id: orderId,
      requestContext: input.requestContext,
      notes: input.notes,
      quantity: input.quantity,
      unit: input.unit,
      neededBy: input.neededBy,
      material: input.material,
      specification: input.specification,
    },
  });
}

export type ProcurementOfficeCustomerMapping = { officeId: string; customerId: string };

export function procurementOfficeCustomerMappings(
  rawMapping = process.env.PROCUREMENT_CUSTOMER_MAP_JSON,
): ProcurementOfficeCustomerMapping[] {
  const customerIds = new Set(procurementCustomerIdsFromServerMetadata(rawMapping));
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMapping ?? "");
  } catch {
    return [];
  }
  const mapping = record(parsed);
  return Object.entries(mapping).flatMap(([officeId, customerId]) =>
    typeof customerId === "string" && customerIds.has(customerId)
      ? [{ officeId, customerId }]
      : []);
}

export async function listProcurementResearchOrders(customerId: string) {
  const orders = await listProcurementRequests(customerId, 50, undefined, { activeOnly: true });
  return orders.filter(isProcurementResearchOrder);
}

export function isProcurementResearchOrder(order: {
  supplierCount: number;
  status: string;
}) {
  return order.supplierCount === 0 && !["ordered", "cancelled"].includes(order.status);
}

export async function runProcurementResearchCron(args: {
  rawCustomerMapping?: string;
  limit?: number;
} = {}) {
  const mappings = procurementOfficeCustomerMappings(args.rawCustomerMapping);
  const limit = Math.min(2, Math.max(1, Math.trunc(args.limit ?? 2)));
  let scanned = 0;
  let enqueued = 0;
  let reused = 0;
  let skipped = 0;
  const skippedReasons: Record<string, number> = {};
  const recordSkipped = (reason: string) => {
    skipped += 1;
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
  };
  for (const mapping of mappings) {
    if (enqueued >= limit) break;
    const orders = await listProcurementResearchOrders(mapping.customerId);
    for (const order of orders) {
      if (enqueued >= limit) break;
      scanned += 1;
      let result;
      try {
        result = await enqueueProcurementResearch({
          officeId: mapping.officeId,
          order,
        });
      } catch (error) {
        recordSkipped(
          error instanceof ProcurementResearchAccessError && error.code === "missing_admin"
            ? "missing_access_context"
            : "enqueue_failed",
        );
        continue;
      }
      if (result.state === "enqueued") enqueued += 1;
      else if (result.state === "reused") reused += 1;
      else recordSkipped(result.reason ?? "unknown");
    }
  }
  return { scanned, enqueued, reused, skipped, skippedReasons };
}
