import type {
  EvidenceEnvelope,
  SupplierCandidate,
  SupplierResearchResult,
} from "@/lib/supply-os/research";
import type { ProcurementResearchTask } from "./procurement-research-bridge";

type ShortlistEvidence = { url: string; sourceType: "OFFICIAL" | "PUBLIC" | "QUOTE" | "AUTHORITY" };

type ShortlistEnvelope<T> = {
  value: T | null;
  state: "SUPPORTED" | "UNKNOWN";
  confidence: number | null;
  sources: ShortlistEvidence[];
  observedAt: string | null;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
};

export type ProcurementResearchShortlistCandidate = {
  companyName: string;
  officialWebsite: string | null;
  roles: SupplierCandidate["roles"];
  evidence: ShortlistEvidence[];
  sourceUrls: string[];
  commercialTerms: {
    price: ShortlistEnvelope<number>;
    currency: ShortlistEnvelope<string>;
    minimumOrderQuantity: ShortlistEnvelope<number>;
    leadTimeDays: ShortlistEnvelope<number>;
  };
  rfqDraft: {
    status: "DRAFT_ONLY";
    no_send: true;
    subject: string;
    body: string;
    unknowns: string[];
  };
};

export type ProcurementResearchShortlist = {
  request: {
    componentName: string | null;
    specification: string | null;
    requestedQuantity: number | null;
    requestedUnit: string | null;
    needByDate: string | null;
    deliveryLocation: string | null;
    targetCountry: string | null;
  };
  candidates: ProcurementResearchShortlistCandidate[];
  warnings: string[];
};

function evidenceSource(source: SupplierResearchResult["sources"][number]): ShortlistEvidence {
  return { url: source.url, sourceType: source.sourceType };
}

function sourceRecords(candidate: SupplierCandidate, result: SupplierResearchResult) {
  const allowed = new Map(result.sources.map((source) => [source.url, evidenceSource(source)]));
  return candidate.sourceUrls.flatMap((url) => {
    const source = allowed.get(url);
    return source ? [source] : [];
  });
}

function projectedEnvelope<T>(
  envelope: EvidenceEnvelope<T>,
  result: SupplierResearchResult,
): ShortlistEnvelope<T> {
  const sources = envelope.sources
    .map((source) => result.sources.find((candidate) => candidate.url === source.url))
    .filter((source): source is SupplierResearchResult["sources"][number] => Boolean(source))
    .map(evidenceSource);
  const supported = envelope.state === "SUPPORTED" && envelope.value !== null;
  return {
    value: supported ? envelope.value : null,
    state: supported ? "SUPPORTED" : "UNKNOWN",
    confidence: supported ? envelope.confidence : null,
    sources,
    observedAt: supported ? envelope.observedAt : null,
    freshness: supported ? envelope.freshness : "UNKNOWN",
  };
}

function officialWebsite(candidate: SupplierCandidate, result: SupplierResearchResult) {
  if (!candidate.website) return null;
  let websiteHost: string;
  try {
    websiteHost = new URL(candidate.website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  return result.sources.some((source) => {
    if (source.sourceType !== "OFFICIAL") return false;
    try {
      return new URL(source.url).hostname.toLowerCase().replace(/^www\./, "") === websiteHost;
    } catch {
      return false;
    }
  }) ? candidate.website : null;
}

function draftForCandidate(task: ProcurementResearchTask, candidate: SupplierCandidate, terms: ProcurementResearchShortlistCandidate["commercialTerms"]) {
  const unknowns = [
    terms.price.state === "UNKNOWN" ? "unit price" : null,
    terms.currency.state === "UNKNOWN" ? "currency" : null,
    terms.minimumOrderQuantity.state === "UNKNOWN" ? "minimum order quantity" : null,
    terms.leadTimeDays.state === "UNKNOWN" ? "lead time" : null,
    task.requestedQuantity === null ? "requested quantity" : null,
    task.requestedUnit ? null : "requested unit",
    task.specification ? null : "specification",
    task.deliveryLocation ? null : "delivery location",
    task.targetCountry ? null : "target country",
    task.needByDate ? null : "need-by date",
  ].filter((value): value is string => Boolean(value));
  const item = task.componentName ?? "the requested item";
  const requestLine = [
    `Item: ${item}`,
    task.specification ? `Specification: ${task.specification}` : null,
    task.requestedQuantity !== null && task.requestedUnit
      ? `Quantity: ${task.requestedQuantity} ${task.requestedUnit}`
      : null,
    task.deliveryLocation ? `Delivery location: ${task.deliveryLocation}` : null,
    task.needByDate ? `Need by: ${task.needByDate}` : null,
  ].filter(Boolean).join("\n");
  const confirmation = unknowns.length
    ? `Please confirm: ${unknowns.join(", ")}.`
    : "Please confirm that the listed terms are current.";
  return {
    status: "DRAFT_ONLY" as const,
    no_send: true as const,
    subject: `Information request: ${item}`,
    body: [
      `To: ${candidate.companyName}`,
      "",
      "Please review this sourcing information request.",
      requestLine,
      confirmation,
      "Any pricing is requested for review only and is not a pricing commitment by Derya.",
      "This is not a purchase commitment.",
    ].join("\n"),
    unknowns,
  };
}

export function projectProcurementResearchShortlist(
  task: ProcurementResearchTask,
  result: SupplierResearchResult,
): ProcurementResearchShortlist {
  const candidates = result.candidates.map((candidate) => {
    const evidence = sourceRecords(candidate, result);
    const commercialTerms = {
      price: projectedEnvelope(candidate.price, result),
      currency: projectedEnvelope(candidate.currency, result),
      minimumOrderQuantity: projectedEnvelope(candidate.minimumOrderQuantity, result),
      leadTimeDays: projectedEnvelope(candidate.leadTimeDays, result),
    };
    return {
      companyName: candidate.companyName,
      officialWebsite: officialWebsite(candidate, result),
      roles: candidate.roles,
      evidence,
      sourceUrls: evidence.map((source) => source.url),
      commercialTerms,
      rfqDraft: draftForCandidate(task, candidate, commercialTerms),
    };
  });
  return {
    request: {
      componentName: task.componentName,
      specification: task.specification,
      requestedQuantity: task.requestedQuantity,
      requestedUnit: task.requestedUnit,
      needByDate: task.needByDate,
      deliveryLocation: task.deliveryLocation,
      targetCountry: task.targetCountry,
    },
    candidates,
    warnings: result.warnings,
  };
}
