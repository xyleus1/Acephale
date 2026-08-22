import { PROCUREMENT_ACTIVE_STATUSES } from "@/lib/procurement-status";

export const CUSTOMER_PROCUREMENT_POLL_INTERVAL_MS = 7_000;

export type CustomerProcurementPhase = "researching" | "compare" | "procure" | "attention";

export type CustomerProcurementVendor = {
  id: string;
  name: string;
  website: string | null;
  contact: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  contacted: boolean;
  status: string;
  research: Record<string, unknown>;
  quote: Record<string, unknown> | null;
};

export type CustomerProcurementOrderState = {
  orderId: string | null;
  status: string;
  progress: string | null;
  error: string | null;
  workflowWakeRequested: boolean | null;
  vendors: CustomerProcurementVendor[];
};

export type CustomerProcurementRequestSummary = {
  id: string;
  status: string;
  progress: string | null;
  requestContext: Record<string, unknown>;
};

export type CustomerProcurementRequestDetail = CustomerProcurementRequestSummary & {
  neededBy: string | null;
  quantity: number;
  unit: string;
  material: string;
  specification: string | null;
  approvalRequestedAt: string | null;
  decisionSnapshot: Record<string, unknown> | null;
  vendors: CustomerProcurementVendor[];
  updatedAt: string;
};

export function customerProcurementPhase(status: string, supplierCount: number): CustomerProcurementPhase {
  if (["needs_attention", "cancelled"].includes(status)) return "attention";
  if (["ordered", "awaiting_order_approval"].includes(status)) return "procure";
  if (["awaiting_shortlist_approval", "sourcing"].includes(status) || supplierCount > 0) return "compare";
  return "researching";
}

export function startCustomerProcurementPolling<T extends { status: string }>({
  initialStatus,
  load,
  onDetail,
  onError,
  schedule,
  cancel,
  intervalMs = CUSTOMER_PROCUREMENT_POLL_INTERVAL_MS,
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

export function customerProcurementResearchComplete(status: string, supplierCount: number) {
  return supplierCount > 0 || [
    "awaiting_shortlist_approval",
    "sourcing",
    "awaiting_order_approval",
    "ordered",
  ].includes(status);
}

const STATUS_LABELS: Record<string, string> = {
  new: "Queued",
  researching: "Researching suppliers",
  awaiting_shortlist_approval: "Shortlist review",
  sourcing: "Collecting quotes",
  awaiting_order_approval: "Order review",
  ordered: "Ordered",
  needs_attention: "Needs attention",
  cancelled: "Canceled",
};

export function customerProcurementStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? "In progress";
}

const ATTENTION_FALLBACK = "The request could not continue. Correct the missing or conflicting details in Context, then confirm a new sourcing request.";

export function customerProcurementAttentionReason(progress: string | null | undefined) {
  const normalized = progress?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return ATTENTION_FALLBACK;
  const candidate = normalized.replace(/^(?:needs[ _-]?attention|blocked)\s*:\s*/i, "");
  if (!candidate || /^(?:more|additional) information (?:is )?(?:needed|required)\.?$/i.test(candidate)) {
    return ATTENTION_FALLBACK;
  }
  if (/^(?:(?:order|request) received|searching|researching|processing)\b/i.test(candidate)) {
    return ATTENTION_FALLBACK;
  }
  const technicalFailure = /\b(?:bourne|neon|gmail|worker|webhook|database|sqlstate|exception|stack trace|timeout|lease|internal error|provider error)\b/i;
  if (technicalFailure.test(candidate) || /https?:\/\/|\{["'][^}]+["']\}|[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(candidate)) {
    return ATTENTION_FALLBACK;
  }
  return candidate.slice(0, 320);
}

export function customerProcurementAttentionHints(specification: string | null | undefined) {
  const normalized = specification?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return [];
  const hints: string[] = [];
  if (/\b(?:task|item)\s*1\s*:[\s\S]*\b(?:task|item)\s*2\s*:/i.test(normalized)) {
    hints.push("Split this combined request into one sourcing request per item or manufacturing process.");
  }
  const uncertainty = /\b(?:ambiguous|clarification|conflicting|missing|not provided|requires? confirmation|undeclared|unknown|unspecified)\b/i;
  for (const sentence of normalized.split(/(?<=[.!?])\s+|;\s+/)) {
    if (!uncertainty.test(sentence)) continue;
    const trimmed = sentence.trim();
    const uncertaintyIndex = trimmed.search(uncertainty);
    const start = trimmed.length > 240 ? Math.max(0, uncertaintyIndex - 120) : 0;
    const bounded = `${start ? "... " : ""}${trimmed.slice(start, start + 240)}`;
    if (!hints.includes(bounded)) hints.push(bounded);
    if (hints.length >= 3) break;
  }
  return hints;
}

export function customerProcurementProgress(status: string, supplierCount: number, storedProgress?: string | null) {
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
      return customerProcurementAttentionReason(storedProgress);
    case "cancelled":
      return "This request was canceled.";
    default:
      return "The sourcing request is being updated.";
  }
}

export function customerProcurementEvidenceSummary(research: Record<string, unknown>) {
  const preferredKeys = ["summary", "product_match", "productMatch", "capability", "evidence", "sources", "source", "qualification", "notes"];
  const snippets: string[] = [];
  const genericLabel = (value: string) => {
    const normalized = value.toLowerCase();
    return normalized === "candidate"
      || normalized === "shortlisted"
      || (normalized.includes("potential match") && normalized.includes("gaps remain"));
  };
  function collect(value: unknown, depth = 0) {
    if (snippets.length >= 2 || depth > 2 || value === null || value === undefined) return;
    if (typeof value === "string") {
      const normalized = value.replace(/\s+/g, " ").trim();
      const bounded = normalized.slice(0, 180);
      if (
        bounded
        && !genericLabel(bounded)
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

function normalizedResearchKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function boundedResearchText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || /\b(?:bourne|neon|gmail)\b/i.test(normalized)) return null;
  return normalized.slice(0, 180);
}

function safeResearchEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

export function customerProcurementResearchEmail(research: Record<string, unknown>) {
  const emailKeys = new Set(["email", "contactemail", "supplieremail", "publicemail"]);
  const excludedContainers = new Set(["body", "draft", "instructions", "message", "quote", "rfq"]);
  function find(value: unknown, depth = 0): string | null {
    if (depth > 4 || !value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 8)) {
        const found = find(child, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
    for (const [key, child] of entries) {
      if (!emailKeys.has(normalizedResearchKey(key))) continue;
      const email = safeResearchEmail(child);
      if (email) return email;
    }
    for (const [key, child] of entries) {
      if (excludedContainers.has(normalizedResearchKey(key))) continue;
      const found = find(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return find(research);
}

function formattedResearchPrice(value: Record<string, unknown>) {
  const amount = typeof value.amount === "number"
    ? value.amount
    : typeof value.price === "number"
      ? value.price
      : typeof value.unit_price === "number"
        ? value.unit_price
        : null;
  if (amount === null || !Number.isFinite(amount)) return null;
  const currency = typeof value.currency === "string" && /^[A-Za-z]{3}$/.test(value.currency.trim())
    ? value.currency.trim().toUpperCase()
    : null;
  const unitValue = typeof value.unit === "string"
    ? value.unit
    : typeof value.unit_of_measure === "string"
      ? value.unit_of_measure
      : null;
  const unit = boundedResearchText(unitValue)?.slice(0, 40) ?? null;
  return `${currency ? `${currency} ` : ""}${amount.toLocaleString("en-US")}${unit ? ` / ${unit}` : ""}`;
}

export function customerProcurementPublicPriceSummary(research: Record<string, unknown>) {
  const priceKey = (key: string) => /(?:price|pricing|listing|commercial)/.test(normalizedResearchKey(key));
  const excludedContainers = new Set(["body", "draft", "instructions", "message", "quote", "rfq"]);
  const explicitPrice = /(?:[$€£¥]\s?\d|\b(?:USD|EUR|GBP|CAD|AUD|JPY|CNY)\s?\d|\b\d+(?:\.\d+)?\s?(?:USD|EUR|GBP|CAD|AUD|JPY|CNY)\b)/i;
  function find(value: unknown, depth = 0, priceContext = false): string | null {
    if (depth > 4 || !value) return null;
    const directText = boundedResearchText(value);
    if (directText && explicitPrice.test(directText)) return directText;
    if (typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 8)) {
        const found = find(child, depth + 1, priceContext);
        if (found) return found;
      }
      return null;
    }
    const record = value as Record<string, unknown>;
    const formatted = priceContext ? formattedResearchPrice(record) : null;
    if (formatted) return formatted;
    const entries = Object.entries(record).slice(0, 40);
    for (const [key, child] of entries) {
      if (!priceKey(key)) continue;
      const text = boundedResearchText(child);
      if (text) return text;
      if (typeof child === "number" && Number.isFinite(child)) return child.toLocaleString("en-US");
      const nested = find(child, depth + 1, true);
      if (nested) return nested;
    }
    for (const [key, child] of entries) {
      if (excludedContainers.has(normalizedResearchKey(key))) continue;
      const text = boundedResearchText(child);
      if (text && explicitPrice.test(text)) return text;
      const found = find(child, depth + 1, false);
      if (found) return found;
    }
    return null;
  }
  return find(research);
}

export function customerProcurementQuoteSummary(quote: Record<string, unknown> | null) {
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

export function customerProcurementContactSummary(
  contact: CustomerProcurementVendor["contact"],
  research: Record<string, unknown> = {},
) {
  const researchEmail = customerProcurementResearchEmail(research);
  return {
    primary: contact?.name ?? (contact?.email ? "Email available" : researchEmail ? "Public research contact" : "Not identified"),
    secondary: contact?.email ?? contact?.phone ?? researchEmail ?? "No contact saved",
  };
}
