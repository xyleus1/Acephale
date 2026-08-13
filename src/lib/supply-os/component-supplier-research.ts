import OpenAI from "openai";
import { isIP } from "node:net";
import {
  normalizeSupplierResearch,
  type EvidenceSource,
} from "./research";
import {
  ExaResearchError,
  searchExaComponentSuppliers,
} from "./exa-supplier-research";
import {
  OpenAiSupplierResearchError,
  searchOpenAiComponentSuppliers,
} from "./openai-supplier-research";
import { isSupplierDiscoveryUrl } from "./supplier-discovery-url";

const MAX_SOURCES = 40;

export type SupplierResearchFailureCode =
  | "MISSING_CONFIGURATION"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_AUTHENTICATION_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_FAILURE"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "INVALID_STRUCTURED_RESPONSE";

const FAILURE_DETAILS: Record<SupplierResearchFailureCode, { status: number; message: string }> = {
  MISSING_CONFIGURATION: { status: 503, message: "Public supplier research is not configured." },
  PROVIDER_TIMEOUT: { status: 504, message: "Public supplier research timed out." },
  PROVIDER_AUTHENTICATION_FAILED: { status: 503, message: "Public supplier research credentials were rejected." },
  PROVIDER_RATE_LIMITED: { status: 429, message: "Public supplier research is temporarily rate limited." },
  PROVIDER_FAILURE: { status: 502, message: "Public supplier research provider failed." },
  PROVIDER_RESPONSE_TOO_LARGE: { status: 502, message: "Public supplier research returned too much data." },
  INVALID_STRUCTURED_RESPONSE: { status: 502, message: "Public supplier research returned an invalid response." },
};

export class SupplierResearchError extends Error {
  readonly code: SupplierResearchFailureCode;
  readonly status: number;

  constructor(code: SupplierResearchFailureCode) {
    const detail = FAILURE_DETAILS[code];
    super(detail.message);
    this.name = "SupplierResearchError";
    this.code = code;
    this.status = detail.status;
  }
}

export function supplierResearchError(error: unknown) {
  if (error instanceof SupplierResearchError) return error;
  if (error instanceof ExaResearchError) return new SupplierResearchError(error.code);
  if (error instanceof OpenAiSupplierResearchError) return new SupplierResearchError(error.code);
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return new SupplierResearchError("PROVIDER_AUTHENTICATION_FAILED");
  }
  if (error instanceof OpenAI.RateLimitError) return new SupplierResearchError("PROVIDER_RATE_LIMITED");
  if (
    error instanceof OpenAI.APIConnectionTimeoutError
    || error instanceof OpenAI.APIUserAbortError
    || (error instanceof DOMException && error.name === "AbortError")
  ) {
    return new SupplierResearchError("PROVIDER_TIMEOUT");
  }
  return new SupplierResearchError("PROVIDER_FAILURE");
}

export type ComponentSupplierResearchInput = {
  officeId: string;
  workspaceId: string;
  componentItemKey: string;
  componentName: string;
  manufacturer?: string;
  mpn?: string;
  specification?: string;
  targetCountry?: string;
  requestedQuantity?: number;
  requestedUnit?: string;
  sourceRegion?: string;
  deliveryLocation?: string;
  needByDate?: string;
  queryVariant?: string;
  queryCycle?: number;
  excludeDomains?: string[];
  requiredProvider?: "EXA" | "OPENAI";
};

export function selectSupplierResearchProvider(
  requiredProvider: unknown,
  configuration?: { EXA_API_KEY?: string; OPENAI_API_KEY?: string },
) {
  const providerConfiguration = configuration ?? {
    EXA_API_KEY: process.env.EXA_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  if (requiredProvider === "EXA") return providerConfiguration.EXA_API_KEY ? "EXA" as const : null;
  if (requiredProvider === "OPENAI") return providerConfiguration.OPENAI_API_KEY ? "OPENAI" as const : null;
  if (requiredProvider !== undefined && requiredProvider !== null) return null;
  if (providerConfiguration.EXA_API_KEY) return "EXA" as const;
  if (providerConfiguration.OPENAI_API_KEY) return "OPENAI" as const;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function publicUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    const unwrappedHostname = hostname.replace(/^\[|\]$/g, "");
    if (
      !hostname
      || hostname === "localhost"
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || isIP(unwrappedHostname) !== 0
    ) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function responseSourceUrls(output: unknown) {
  const urls = new Set<string>();
  const response = asRecord(output);
  for (const itemValue of Array.isArray(response.output) ? response.output : []) {
    const item = asRecord(itemValue);
    const action = asRecord(item.action);
    const actionUrl = publicUrl(action.url);
    if (actionUrl && isSupplierDiscoveryUrl(actionUrl)) urls.add(actionUrl);
    for (const sourceValue of Array.isArray(action.sources) ? action.sources : []) {
      const url = publicUrl(asRecord(sourceValue).url);
      if (url && isSupplierDiscoveryUrl(url)) urls.add(url);
    }
    for (const contentValue of Array.isArray(item.content) ? item.content : []) {
      for (const annotationValue of Array.isArray(asRecord(contentValue).annotations) ? asRecord(contentValue).annotations as unknown[] : []) {
        const url = publicUrl(asRecord(annotationValue).url);
        if (url && isSupplierDiscoveryUrl(url)) urls.add(url);
      }
    }
  }
  return [...urls].slice(0, MAX_SOURCES);
}

function providerSources(urls: string[]): EvidenceSource[] {
  // Responses API citations prove discovery attribution, not that the page is
  // the cited company's official site or that it supports a supplier role.
  return urls.map((url) => ({ url, sourceType: "PUBLIC" as const }));
}

function unknownEnvelope() {
  return { value: null, state: "UNKNOWN", confidence: null, sourceUrls: [], observedAt: null };
}

function degradedOpenAiDiscovery(input: ComponentSupplierResearchInput, urls: string[]) {
  const grouped = new Map<string, string[]>();
  for (const url of urls) {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    grouped.set(hostname, [...(grouped.get(hostname) ?? []), url]);
  }
  const raw = {
    candidates: [...grouped.entries()].map(([hostname, sourceUrls]) => ({
      companyName: hostname,
      website: new URL(sourceUrls[0]!).origin,
      roles: [],
      country: unknownEnvelope(),
      facility: unknownEnvelope(),
      productCapability: unknownEnvelope(),
      price: unknownEnvelope(),
      currency: unknownEnvelope(),
      unitOfMeasure: unknownEnvelope(),
      minimumOrderQuantity: unknownEnvelope(),
      leadTimeDays: unknownEnvelope(),
      sourceUrls,
      cautions: ["Public web discovery only. Company identity, supplier role, and product capability remain unverified."],
    })),
    warnings: [],
  };
  const normalized = normalizeSupplierResearch({
    officeId: input.officeId,
    workspaceId: input.workspaceId,
    componentItemKey: input.componentItemKey,
    raw,
    providerSources: providerSources(urls),
    trustClaimedObservedAt: false,
  });
  return {
    ...normalized,
    degraded: true,
    warnings: [
      ...normalized.warnings,
      "Public source URLs were retained, but final structured enrichment was invalid. No supplier claim was accepted.",
    ],
  };
}

export function normalizeOpenAiSupplierResponse(input: ComponentSupplierResearchInput, output: unknown) {
  const urls = responseSourceUrls(output);
  if (!urls.length) throw new SupplierResearchError("INVALID_STRUCTURED_RESPONSE");
  const outputText = asRecord(output).output_text;
  let raw: unknown;
  try {
    if (typeof outputText !== "string") throw new Error("Missing output text.");
    raw = JSON.parse(outputText);
  } catch {
    return degradedOpenAiDiscovery(input, urls);
  }
  return normalizeSupplierResearch({
    officeId: input.officeId,
    workspaceId: input.workspaceId,
    componentItemKey: input.componentItemKey,
    raw,
    providerSources: providerSources(urls),
    trustClaimedObservedAt: false,
  });
}

export async function searchComponentSuppliers(input: ComponentSupplierResearchInput) {
  const selectedProvider = selectSupplierResearchProvider(input.requiredProvider);
  if (!selectedProvider) throw new SupplierResearchError("MISSING_CONFIGURATION");
  if (selectedProvider === "EXA") {
    if (!process.env.EXA_API_KEY) throw new SupplierResearchError("MISSING_CONFIGURATION");
    try {
      return await searchExaComponentSuppliers(input, { apiKey: process.env.EXA_API_KEY });
    } catch (error) {
      throw supplierResearchError(error);
    }
  }
  if (!process.env.OPENAI_API_KEY) throw new SupplierResearchError("MISSING_CONFIGURATION");
  try {
    return await searchOpenAiComponentSuppliers(input, { apiKey: process.env.OPENAI_API_KEY });
  } catch (error) {
    throw supplierResearchError(error);
  }
}
