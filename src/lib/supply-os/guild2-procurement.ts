import type { ProcurementRequestInput } from "@/lib/procurement-contract";
import { PROCUREMENT_ACTIVE_STATUSES } from "@/lib/procurement-status";
import { GUILD_SOURCING_LINES, type GuildSourcingLine } from "./guild-sourcing-items";

export const GUILD2_PROCUREMENT_REVISION = "v1";
export const GUILD2_BULK_CONCURRENCY = 3;
export const GUILD2_PROCUREMENT_POLL_INTERVAL_MS = 7_000;

export type Guild2ProcurementPhase = "researching" | "compare" | "procure" | "attention";

export function guild2ProcurementPhase(status: string, supplierCount: number): Guild2ProcurementPhase {
  if (["needs_attention", "cancelled"].includes(status)) return "attention";
  if (["ordered", "awaiting_order_approval"].includes(status)) return "procure";
  if (["awaiting_shortlist_approval", "sourcing"].includes(status) || supplierCount > 0) return "compare";
  return "researching";
}

export async function sourceGuild2ProcurementAndOpen(
  source: () => Promise<Guild2ProcurementOrderState | null>,
  open: (order: Guild2ProcurementOrderState) => void,
) {
  const order = await source();
  if (order?.orderId) open(order);
  return order;
}

export function startGuild2ProcurementPolling<T extends { status: string }>({
  initialStatus,
  load,
  onDetail,
  onError,
  schedule,
  cancel,
  intervalMs = GUILD2_PROCUREMENT_POLL_INTERVAL_MS,
}: {
  initialStatus: string;
  load: () => Promise<T>;
  onDetail: (detail: T) => void;
  onError: (error: unknown) => void;
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (handle: unknown) => void;
  intervalMs?: number;
}) {
  let stopped = false;
  let inFlight = false;
  let lastStatus = initialStatus;
  let timer: unknown = null;

  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    void load()
      .then((detail) => {
        if (stopped) return;
        lastStatus = detail.status;
        onDetail(detail);
      })
      .catch((error: unknown) => {
        if (!stopped) onError(error);
      })
      .finally(() => {
        inFlight = false;
        if (!stopped && PROCUREMENT_ACTIVE_STATUSES.has(lastStatus)) {
          timer = schedule(() => {
            timer = null;
            tick();
          }, intervalMs);
        }
      });
  };

  tick();
  return () => {
    stopped = true;
    if (timer !== null) cancel(timer);
  };
}

export function guild2ProcurementResearchComplete(status: string, supplierCount: number) {
  return supplierCount > 0 || [
    "awaiting_shortlist_approval",
    "sourcing",
    "awaiting_order_approval",
    "ordered",
  ].includes(status);
}

const CUSTOMER_PROCUREMENT_STATUS_LABELS: Record<string, string> = {
  new: "Queued",
  researching: "Researching suppliers",
  awaiting_shortlist_approval: "Shortlist review",
  sourcing: "Collecting quotes",
  awaiting_order_approval: "Order review",
  ordered: "Ordered",
  needs_attention: "Needs attention",
  cancelled: "Canceled",
};

export function guild2CustomerProcurementStatusLabel(status: string) {
  return CUSTOMER_PROCUREMENT_STATUS_LABELS[status] ?? "In progress";
}

export function guild2CustomerProcurementProgress(status: string, supplierCount: number) {
  switch (status) {
    case "new":
      return "Request received. Supplier research has not started yet.";
    case "researching":
      return supplierCount > 0
        ? `${supplierCount} supplier candidate${supplierCount === 1 ? " is" : "s are"} being verified.`
        : "Searching and verifying supplier candidates.";
    case "awaiting_shortlist_approval":
      return `${supplierCount} supplier candidate${supplierCount === 1 ? " is" : "s are"} ready for review.`;
    case "sourcing":
      return "Shortlisted suppliers are being evaluated and commercial terms are being collected.";
    case "awaiting_order_approval":
      return "Commercial terms are ready for final review.";
    case "ordered":
      return "The order has been approved and placed.";
    case "needs_attention":
      return "The sourcing team needs additional information before work can continue.";
    case "cancelled":
      return "This request was canceled.";
    default:
      return "The sourcing request is being updated.";
  }
}

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
  contact: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
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
  neededBy: string | null;
  quantity: number;
  unit: string;
  material: string;
  specification: string | null;
  approvalRequestedAt: string | null;
  decisionSnapshot: Record<string, unknown> | null;
  vendors: Guild2ProcurementVendor[];
  updatedAt: string;
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
      if (
        bounded
        && !/\b(?:bourne|neon|gmail)\b/i.test(bounded)
        && !snippets.includes(bounded)
      ) snippets.push(bounded);
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

export function guild2ProcurementQuoteSummary(quote: Record<string, unknown> | null) {
  if (!quote) return "Not received";
  const amount = typeof quote.amount === "number"
    ? quote.amount
    : typeof quote.price === "number"
      ? quote.price
      : typeof quote.unit_price === "number"
        ? quote.unit_price
        : null;
  const currency = typeof quote.currency === "string" ? quote.currency.toUpperCase() : null;
  const unit = typeof quote.unit === "string"
    ? quote.unit
    : typeof quote.unit_of_measure === "string"
      ? quote.unit_of_measure
      : null;
  if (amount !== null) return `${currency ? `${currency} ` : ""}${amount.toLocaleString("en-US")}${unit ? ` / ${unit}` : ""}`;
  const reference = typeof quote.reference === "string"
    ? quote.reference
    : typeof quote.quote_reference === "string"
      ? quote.quote_reference
      : null;
  return reference ? `Received: ${reference}` : "Received";
}

export function guild2ProcurementContactSummary(contact: Guild2ProcurementVendor["contact"]) {
  return {
    primary: contact?.name ?? "Not identified",
    secondary: contact?.email ?? contact?.phone ?? "No contact saved",
  };
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
