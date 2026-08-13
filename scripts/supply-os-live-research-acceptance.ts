import assert from "node:assert/strict";
import type { SupplierResearchResult } from "../src/lib/supply-os/research";
import {
  GUILD_PROCUREMENT_BOM,
  REPRESENTATIVE_LIVE_RESEARCH_IDS,
  type ProcurementAcceptanceItem,
} from "./fixtures/guild-procurement-bom";

type ResearchRun = {
  id: string;
  workspaceId: string;
  status: string;
  output?: SupplierResearchResult | null;
  error?: { message?: string } | null;
};

type StartResponse = {
  run?: ResearchRun;
  reused?: boolean;
  pollUrl?: string;
  error?: string;
};

type PollResponse = {
  run?: ResearchRun | null;
  error?: string;
};

type AcceptanceConfig = {
  baseUrl: string;
  cookie: string;
  workspaceId: string;
  runTimeoutMs: number;
  pollIntervalMs: number;
};

const ACTIVE_RUN_STATUSES = new Set(["QUEUED", "RUNNING"]);
const TERMINAL_RUN_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required for deployed supplier research acceptance`);
  return value;
}

function boundedMilliseconds(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  assert.ok(Number.isInteger(value) && value >= minimum && value <= maximum, `${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

function acceptanceConfig(): AcceptanceConfig {
  const baseUrl = requiredEnvironment("SUPPLY_OS_ACCEPTANCE_BASE_URL").replace(/\/$/, "");
  const parsedBaseUrl = new URL(baseUrl);
  assert.ok(["http:", "https:"].includes(parsedBaseUrl.protocol), "SUPPLY_OS_ACCEPTANCE_BASE_URL must be HTTP or HTTPS");
  return {
    baseUrl,
    cookie: requiredEnvironment("SUPPLY_OS_ACCEPTANCE_COOKIE"),
    workspaceId: requiredEnvironment("SUPPLY_OS_ACCEPTANCE_WORKSPACE_ID"),
    runTimeoutMs: boundedMilliseconds("SUPPLY_OS_ACCEPTANCE_RUN_TIMEOUT_MS", 15 * 60_000, 30_000, 60 * 60_000),
    pollIntervalMs: boundedMilliseconds("SUPPLY_OS_ACCEPTANCE_POLL_INTERVAL_MS", 2_500, 500, 30_000),
  };
}

function publicUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

function hasAttributableListingClaim(result: SupplierResearchResult) {
  return result.candidates.some((candidate) => {
    if (
      candidate.price.state !== "SUPPORTED"
      || candidate.currency.state !== "SUPPORTED"
      || candidate.unitOfMeasure.state !== "SUPPORTED"
      || candidate.price.freshness !== "UNKNOWN"
      || candidate.currency.freshness !== "UNKNOWN"
      || candidate.unitOfMeasure.freshness !== "UNKNOWN"
      || typeof candidate.price.value !== "number"
      || !Number.isFinite(candidate.price.value)
      || candidate.price.value <= 0
      || typeof candidate.currency.value !== "string"
      || !/^[A-Z]{3}$/.test(candidate.currency.value.toUpperCase())
      || typeof candidate.unitOfMeasure.value !== "string"
      || !candidate.unitOfMeasure.value.trim()
    ) return false;
    return candidate.price.sources.some((source) =>
      candidate.currency.sources.some((currencySource) => currencySource.url === source.url)
      && candidate.unitOfMeasure.sources.some((unitSource) => unitSource.url === source.url));
  });
}

function selectedItems() {
  assert.ok(!process.argv.includes("--all"), "Use the continuous sourcing acceptance for all 38 searchable GUILD lines");
  const idsArgument = process.argv.find((argument) => argument.startsWith("--ids="));
  const ids = idsArgument
    ? idsArgument.slice("--ids=".length).split(",").map((id) => id.trim()).filter(Boolean)
    : [...REPRESENTATIVE_LIVE_RESEARCH_IDS];
  assert.ok(ids.length > 0 && ids.length <= 10, "Single-run live acceptance accepts from 1 to 10 item IDs");
  assert.equal(new Set(ids).size, ids.length, "Single-run live acceptance item IDs must be unique");
  return ids.map((id) => {
    const item = GUILD_PROCUREMENT_BOM.find((candidate) => candidate.id === id);
    assert.ok(item, `unknown BOM item ${id}`);
    assert.equal(item.expectedOutcome, "RESEARCHABLE", `${id} does not enter supplier research`);
    return item;
  });
}

function requestBody(item: ProcurementAcceptanceItem, workspaceId: string) {
  return {
    componentItemKey: `request:guild-${item.id}`,
    componentName: item.description,
    specification: `${item.specification}. Supplier deliverable: ${item.supplierDeliverable}.`,
    targetCountry: "United States",
    requestText: `${item.quantity} ${item.unit} of ${item.description}`,
    requestedQuantity: item.quantity,
    requestedUnit: item.unit,
    sourceRegion: "Any region",
    deliveryLocation: "Austin, TX, United States",
    needByDate: "2026-10-15",
    workspaceId,
  };
}

async function responseJson<T>(response: Response) {
  const body = await response.text();
  assert.ok(body, `HTTP ${response.status} returned an empty response`);
  try {
    return JSON.parse(body) as T;
  } catch {
    assert.fail(`HTTP ${response.status} returned invalid JSON`);
  }
}

async function fetchWithTimeout(url: URL | string, init: RequestInit, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function assertAttributableResult(item: ProcurementAcceptanceItem, result: SupplierResearchResult) {
  assert.equal(result.degraded, false, `${item.id} degraded: ${result.warnings.join(" ")}`);
  assert.ok(result.candidates.length > 0, `${item.id} returned no attributable supplier candidate`);
  for (const candidate of result.candidates) {
    assert.equal(candidate.status, "REVIEW_REQUIRED", `${item.id} candidate ${candidate.companyName} bypassed human review`);
    assert.ok(candidate.companyName.trim(), `${item.id} returned a candidate without a company name`);
    const website = candidate.website ? publicUrl(candidate.website) : null;
    const sourceUrls = candidate.sourceUrls.flatMap((source) => publicUrl(source) ? [source] : []);
    assert.ok(website || sourceUrls.length, `${item.id} candidate ${candidate.companyName} has no attributable public source`);
    assert.equal(sourceUrls.length, candidate.sourceUrls.length, `${item.id} candidate ${candidate.companyName} contains an invalid source URL`);
    assert.equal(candidate.productCapability.state, "SUPPORTED", `${item.id} candidate ${candidate.companyName} has no supported product capability`);
    assert.ok(candidate.productCapability.sources.some((source) => publicUrl(source.url)), `${item.id} candidate ${candidate.companyName} has no capability source`);
  }
}

async function pollResearchRun(args: {
  config: AcceptanceConfig;
  item: ProcurementAcceptanceItem;
  run: ResearchRun;
  pollUrl: string;
}) {
  const pollUrl = new URL(args.pollUrl, args.config.baseUrl);
  assert.equal(pollUrl.origin, new URL(args.config.baseUrl).origin, "Supplier research polling must stay on the acceptance deployment");
  assert.equal(pollUrl.searchParams.get("runId"), args.run.id, "pollUrl must identify the queued run");
  assert.equal(pollUrl.searchParams.get("workspaceId"), args.config.workspaceId, "pollUrl must retain the real workspace");
  const deadline = Date.now() + args.config.runTimeoutMs;
  let lastStatus = args.run.status;
  while (Date.now() < deadline) {
    await wait(args.config.pollIntervalMs);
    const response = await fetchWithTimeout(pollUrl, {
      headers: { cookie: args.config.cookie },
      cache: "no-store",
    });
    const payload = await responseJson<PollResponse>(response);
    assert.equal(response.status, 200, `${args.item.id} poll failed: ${payload.error ?? response.statusText}`);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i, "supplier research polling must not be cached");
    const run = payload.run;
    assert.ok(run, `${args.item.id} poll returned no run`);
    assert.equal(run.id, args.run.id, `${args.item.id} poll returned the wrong run`);
    assert.equal(run.workspaceId, args.config.workspaceId, `${args.item.id} poll returned the wrong workspace`);
    assert.ok(ACTIVE_RUN_STATUSES.has(run.status) || TERMINAL_RUN_STATUSES.has(run.status), `${args.item.id} returned unexpected run status ${run.status}`);
    lastStatus = run.status;
    if (run.status === "SUCCEEDED") {
      assert.ok(run.output, `${args.item.id} succeeded without a research result`);
      return run.output;
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      assert.fail(`${args.item.id} ended ${run.status}: ${run.error?.message ?? "No failure reason was returned."}`);
    }
  }
  assert.fail(`${args.item.id} run ${args.run.id} remained ${lastStatus} after ${args.config.runTimeoutMs} ms`);
}

async function research(config: AcceptanceConfig, item: ProcurementAcceptanceItem) {
  const response = await fetchWithTimeout(`${config.baseUrl}/api/supply-os/supplier-research`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: config.cookie },
    body: JSON.stringify(requestBody(item, config.workspaceId)),
  });
  const payload = await responseJson<StartResponse>(response);
  assert.equal(response.status, 202, `${item.id} enqueue failed: ${payload.error ?? response.statusText}`);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i, "supplier research enqueue responses must not be cached");
  assert.ok(payload.run?.id, `${item.id} enqueue returned no durable run`);
  assert.equal(payload.run.workspaceId, config.workspaceId, `${item.id} enqueue used the wrong workspace`);
  assert.ok(ACTIVE_RUN_STATUSES.has(payload.run.status), `${item.id} enqueue returned unexpected status ${payload.run.status}`);
  assert.equal(typeof payload.reused, "boolean", `${item.id} enqueue omitted duplicate-run state`);
  assert.ok(payload.pollUrl, `${item.id} enqueue returned no poll URL`);
  return pollResearchRun({ config, item, run: payload.run, pollUrl: payload.pollUrl });
}

async function main() {
  const config = acceptanceConfig();
  const items = selectedItems();
  const results: Array<{ id: string; description: string; result: SupplierResearchResult }> = [];
  for (let index = 0; index < items.length; index += 2) {
    const batch = items.slice(index, index + 2);
    const batchResults = await Promise.all(batch.map(async (item) => ({ item, result: await research(config, item) })));
    for (const { item, result } of batchResults) {
      assertAttributableResult(item, result);
      results.push({ id: item.id, description: item.description, result });
      console.log(`${item.id} ${item.description}: ${result.candidates.length} attributable candidate(s)`);
    }
  }

  const priceSuitableIds = new Set(["001", "011", "017", "028"]);
  const priceSuitableResults = results.filter((entry) => priceSuitableIds.has(entry.id));
  if (priceSuitableResults.length) {
    assert.ok(
      priceSuitableResults.some((entry) => hasAttributableListingClaim(entry.result)),
      "representative retail or commodity searches returned no attributable unverified listing claim with price, currency, unit, and one common source",
    );
  }

  console.log(JSON.stringify({
    testedAt: new Date().toISOString(),
    mode: "deployed-async",
    workspaceId: config.workspaceId,
    results: results.map(({ id, description, result }) => ({
      id,
      description,
      warnings: result.warnings,
      candidates: result.candidates.map((candidate) => ({
        companyName: candidate.companyName,
        website: candidate.website,
        roles: candidate.roles,
        sourceUrls: candidate.sourceUrls,
        price: candidate.price.state === "SUPPORTED" ? candidate.price.value : null,
        currency: candidate.currency.state === "SUPPORTED" ? candidate.currency.value : null,
        unitOfMeasure: candidate.unitOfMeasure.state === "SUPPORTED" ? candidate.unitOfMeasure.value : null,
      })),
    })),
  }, null, 2));
}

void main();
