import type { ProcurementRequestInput } from "@/lib/procurement-contract";
import { PROCUREMENT_ACTIVE_STATUSES } from "@/lib/procurement-status";
import { GUILD_SOURCING_LINES, type GuildSourcingLine } from "./guild-sourcing-items";

export const GUILD2_PROCUREMENT_REVISION = "v1";
export const GUILD2_BULK_CONCURRENCY = 3;

export type Guild2ProcurementLine = GuildSourcingLine & {
  sourceSku: string;
};

export type Guild2ProcurementPlan = {
  all: Guild2ProcurementLine[];
  searchable: Guild2ProcurementLine[];
  blocked: Guild2ProcurementLine[];
  documentation: Guild2ProcurementLine[];
  ready: boolean;
};

export type Guild2ProcurementVendor = {
  id: string;
  name: string;
  website: string | null;
  status: string;
  research: Record<string, unknown>;
  quote: Record<string, unknown> | null;
};

export type Guild2ProcurementOrderState = {
  orderId: string | null;
  status: string;
  progress: string | null;
  error: string | null;
  workflowWakeRequested: boolean | null;
  vendors: Guild2ProcurementVendor[];
};

export type Guild2ProcurementRequestSummary = {
  id: string;
  status: string;
  progress: string | null;
  requestContext: Record<string, unknown>;
};

export type Guild2ProcurementRequestDetail = Guild2ProcurementRequestSummary & {
  vendors: Guild2ProcurementVendor[];
};

function guild2Sku(line: GuildSourcingLine) {
  return line.sku.replace(/^GUILD-/, "GUILD2-");
}

export const GUILD2_PROCUREMENT_PLAN: Guild2ProcurementPlan = (() => {
  const all = GUILD_SOURCING_LINES.map((line) => ({ ...line, sourceSku: guild2Sku(line) }));
  const searchable = all.filter((line) => line.classification === "SUPPLIER_SEARCH");
  const blocked = all.filter((line) => line.classification === "CLARIFICATION_REQUIRED");
  const documentation = all.filter((line) => line.classification === "REQUIREMENT_ONLY");
  const ready = all.length === 40
    && searchable.length === 38
    && blocked.length === 1
    && blocked[0]?.sku === "GUILD-027"
    && documentation.length === 1
    && documentation[0]?.sku === "GUILD-039";
  return { all, searchable, blocked, documentation, ready };
})();

const linesBySourceSku = new Map(GUILD2_PROCUREMENT_PLAN.all.map((line) => [line.sourceSku, line]));

export function guild2ProcurementLine(sourceSku: string) {
  return linesBySourceSku.get(sourceSku) ?? null;
}

export function guild2ProcurementSourceSku(requestContext: Record<string, unknown>) {
  const source = requestContext.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const sourceSku = (source as Record<string, unknown>).source_sku;
  return typeof sourceSku === "string" && guild2ProcurementLine(sourceSku) ? sourceSku : null;
}

export function restoreGuild2ProcurementOrders(
  current: Record<string, Guild2ProcurementOrderState>,
  requests: Guild2ProcurementRequestSummary[],
) {
  const restored = { ...current };
  const restoredFromList = new Set<string>();
  for (const request of requests) {
    const sourceSku = guild2ProcurementSourceSku(request.requestContext);
    if (!sourceSku || current[sourceSku]?.status === "submitting") continue;
    if (restoredFromList.has(sourceSku) && restored[sourceSku]?.status !== "cancelled") continue;
    if (restoredFromList.has(sourceSku) && request.status === "cancelled") continue;
    restored[sourceSku] = {
      orderId: request.id,
      status: request.status,
      progress: request.progress,
      error: null,
      workflowWakeRequested: restored[sourceSku]?.workflowWakeRequested ?? null,
      vendors: restored[sourceSku]?.vendors ?? [],
    };
    restoredFromList.add(sourceSku);
  }
  return restored;
}

export function mergeGuild2ProcurementOrderDetail(
  current: Guild2ProcurementOrderState | undefined,
  detail: Guild2ProcurementRequestDetail,
): Guild2ProcurementOrderState {
  return {
    orderId: detail.id,
    status: detail.status,
    progress: detail.progress,
    error: null,
    workflowWakeRequested: current?.workflowWakeRequested ?? null,
    vendors: detail.vendors,
  };
}

export function guild2ActiveProcurementOrders(orders: Record<string, Guild2ProcurementOrderState>) {
  return Object.entries(orders).filter(([, order]) => (
    Boolean(order.orderId) && PROCUREMENT_ACTIVE_STATUSES.has(order.status)
  ));
}

export function guild2ProcurementEvidenceSummary(research: Record<string, unknown>) {
  const preferredKeys = ["summary", "evidence", "sources", "source", "qualification", "notes"];
  const snippets: string[] = [];
  function collect(value: unknown, depth = 0) {
    if (snippets.length >= 2 || depth > 2 || value === null || value === undefined) return;
    if (typeof value === "string") {
      const normalized = value.replace(/\s+/g, " ").trim();
      const bounded = normalized.slice(0, 180);
      if (bounded && !snippets.includes(bounded)) snippets.push(bounded);
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      const normalized = String(value);
      if (!snippets.includes(normalized)) snippets.push(normalized);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 2).forEach((item) => collect(item, depth + 1));
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const rank = (key: string) => {
        const index = preferredKeys.indexOf(key);
        return index === -1 ? preferredKeys.length : index;
      };
      Object.entries(record)
        .sort(([left], [right]) => rank(left) - rank(right))
        .slice(0, 5)
        .forEach(([, child]) => collect(child, depth + 1));
    }
  }
  collect(research);
  return snippets.slice(0, 2);
}

export function guild2ProcurementIdempotencyKey(line: Guild2ProcurementLine) {
  return `guild2-procurement:${GUILD2_PROCUREMENT_REVISION}:${line.sourceSku}`;
}

export function guild2ProcurementRequest(line: Guild2ProcurementLine): ProcurementRequestInput {
  if (line.classification !== "SUPPLIER_SEARCH" || line.quantity === null || !line.unit) {
    throw new Error(`${line.sku} is not a supplier-searchable line.`);
  }
  return {
    bomId: null,
    material: line.name,
    specification: line.specification,
    lineItemPreferences: {
      schema_version: 1,
      quality: {
        supplier_deliverable: line.deliverable,
      },
    },
    quantity: line.quantity,
    unit: line.unit,
    neededBy: "2026-09-30",
    notes: `[BOURNE TEST] ${line.sourceSku}: ${line.requirement}`,
    requestContext: {
      schema_version: 1,
      source: {
        system: "Derya Supply OS",
        campaign: "GUILD2",
        line_id: line.sku,
        source_sku: line.sourceSku,
      },
      logistics: {
        destination: "Austin, TX, United States",
      },
      supplier_deliverable: line.deliverable,
    },
    idempotencyKey: guild2ProcurementIdempotencyKey(line),
  };
}

export async function runWithBoundedConcurrency<T>(
  values: T[],
  worker: (value: T) => Promise<void>,
  concurrency = GUILD2_BULK_CONCURRENCY,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer.");
  }
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < values.length) {
      const value = values[nextIndex];
      nextIndex += 1;
      await worker(value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, runWorker));
}
