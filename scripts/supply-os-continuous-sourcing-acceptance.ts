import assert from "node:assert/strict";
import { isIP } from "node:net";
import type {
  SupplierResearchCampaignItem,
  SupplierResearchCampaignResponse,
  SupplierResearchCampaignStatus,
  SupplierResearchCampaignStatusResponse,
} from "../src/lib/supply-os/supplier-research-campaign";
import type { SupplierCandidate, SupplierResearchResult } from "../src/lib/supply-os/research";

type CampaignStartPayload = Partial<SupplierResearchCampaignResponse> & { error?: string };
type CampaignPollPayload = Partial<SupplierResearchCampaignStatusResponse> & { error?: string };

type AcceptanceConfig = {
  baseUrl: string;
  cookie: string;
  expectedWorkspaceId: string | null;
  timeoutMs: number;
  requestTimeoutMs: number;
};

const CAMPAIGN_KEY = "guild-procurement";
const DEFAULT_CAMPAIGN_TIMEOUT_MS = 30 * 60 * 60_000;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required for deployed continuous sourcing acceptance`);
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
  const parsed = new URL(baseUrl);
  assert.ok(["http:", "https:"].includes(parsed.protocol), "SUPPLY_OS_ACCEPTANCE_BASE_URL must be HTTP or HTTPS");
  return {
    baseUrl,
    cookie: requiredEnvironment("SUPPLY_OS_ACCEPTANCE_COOKIE"),
    expectedWorkspaceId: process.env.SUPPLY_OS_ACCEPTANCE_CAMPAIGN_WORKSPACE_ID?.trim() || null,
    timeoutMs: boundedMilliseconds("SUPPLY_OS_ACCEPTANCE_CAMPAIGN_TIMEOUT_MS", DEFAULT_CAMPAIGN_TIMEOUT_MS, 5 * 60_000, 48 * 60 * 60_000),
    requestTimeoutMs: boundedMilliseconds("SUPPLY_OS_ACCEPTANCE_REQUEST_TIMEOUT_MS", 45_000, 5_000, 120_000),
  };
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithTimeout(url: URL | string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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

function normalizedPublicUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      !["http:", "https:"].includes(url.protocol)
      || url.username
      || url.password
      || !hostname
      || hostname === "localhost"
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || isIP(hostname)
    ) return null;
    url.hash = "";
    return { url: url.toString(), hostname };
  } catch {
    return null;
  }
}

function domainsOverlap(left: string, right: string) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function normalizedCompanyName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function assertCandidateAttribution(
  campaign: SupplierResearchCampaignStatus,
  item: SupplierResearchCampaignItem,
  result: SupplierResearchResult,
  candidate: SupplierCandidate,
) {
  assert.equal(candidate.status, "REVIEW_REQUIRED", `${item.componentItemKey} candidate ${candidate.companyName} bypassed human review`);
  assert.equal(candidate.workspaceId, campaign.workspaceId, `${item.componentItemKey} candidate ${candidate.companyName} crossed workspace scope`);
  assert.equal(candidate.componentItemKey, item.componentItemKey, `${item.componentItemKey} candidate ${candidate.companyName} belongs to another line`);
  assert.ok(candidate.companyName.trim(), `${item.componentItemKey} returned an unnamed candidate`);
  assert.equal(candidate.approvedByUserId, null, `${item.componentItemKey} candidate ${candidate.companyName} was incorrectly approved`);
  assert.equal(candidate.approvedAt, null, `${item.componentItemKey} candidate ${candidate.companyName} has an approval timestamp`);

  const website = normalizedPublicUrl(candidate.website);
  assert.ok(website, `${item.componentItemKey} candidate ${candidate.companyName} has no public website`);
  const candidateSources = candidate.sourceUrls.map((source) => {
    const parsed = normalizedPublicUrl(source);
    assert.ok(parsed, `${item.componentItemKey} candidate ${candidate.companyName} has an invalid source URL`);
    return parsed;
  });
  assert.ok(candidateSources.length > 0, `${item.componentItemKey} candidate ${candidate.companyName} has no attributable source`);
  assert.equal(new Set(candidateSources.map((source) => source.url)).size, candidateSources.length, `${item.componentItemKey} candidate ${candidate.companyName} repeats a source URL`);
  assert.ok(candidateSources.some((source) => domainsOverlap(source.hostname, website.hostname)), `${item.componentItemKey} candidate ${candidate.companyName} source does not match its website`);

  assert.equal(candidate.productCapability.state, "SUPPORTED", `${item.componentItemKey} candidate ${candidate.companyName} has no supported capability`);
  assert.ok(typeof candidate.productCapability.value === "string" && candidate.productCapability.value.trim(), `${item.componentItemKey} candidate ${candidate.companyName} has an empty capability claim`);
  const capabilitySources = new Set(candidate.productCapability.sources.map((source) => normalizedPublicUrl(source.url)?.url).filter((source): source is string => Boolean(source)));
  const resultSources = new Set(result.sources.map((source) => normalizedPublicUrl(source.url)?.url).filter((source): source is string => Boolean(source)));
  assert.ok(candidateSources.some((source) => capabilitySources.has(source.url) && resultSources.has(source.url)), `${item.componentItemKey} candidate ${candidate.companyName} lacks one common aggregate, candidate, and capability source`);
}

function assertSearchableItem(campaign: SupplierResearchCampaignStatus, item: SupplierResearchCampaignItem) {
  assert.equal(item.classification, "SUPPLIER_SEARCH", `${item.componentItemKey} has the wrong campaign classification`);
  assert.equal(item.state, "COMPLETE", `${item.componentItemKey} did not reach its lead target`);
  assert.ok(item.leadCount >= 3 && item.leadCount <= 5, `${item.componentItemKey} must retain from 3 to 5 leads`);
  assert.ok(item.aggregateRunId, `${item.componentItemKey} has no durable aggregate run`);
  assert.equal(item.aggregateRun?.id, item.aggregateRunId, `${item.componentItemKey} aggregate run identity is inconsistent`);
  assert.equal(item.aggregateRun?.status, "SUCCEEDED", `${item.componentItemKey} aggregate run is not successful`);
  const result = item.aggregateRun?.output;
  assert.ok(result, `${item.componentItemKey} aggregate run has no result`);
  assert.equal(result.candidates.length, item.leadCount, `${item.componentItemKey} lead count does not match its aggregate candidate list`);
  assert.ok(result.sources.length > 0, `${item.componentItemKey} aggregate result has no attributable sources`);

  const domains = new Set<string>();
  const companyNames = new Set<string>();
  for (const candidate of result.candidates) {
    assertCandidateAttribution(campaign, item, result, candidate);
    const website = normalizedPublicUrl(candidate.website);
    assert.ok(website);
    assert.ok(!domains.has(website.hostname), `${item.componentItemKey} repeats supplier domain ${website.hostname}`);
    domains.add(website.hostname);
    const companyName = normalizedCompanyName(candidate.companyName);
    assert.ok(companyName && !companyNames.has(companyName), `${item.componentItemKey} repeats supplier identity ${candidate.companyName}`);
    companyNames.add(companyName);
  }
}

function assertExplicitNonSearchItem(args: {
  item: SupplierResearchCampaignItem;
  expectedKey: string;
  classification: "CLARIFICATION_REQUIRED" | "REQUIREMENT_ONLY";
  blockerPattern: RegExp;
}) {
  assert.equal(args.item.componentItemKey, args.expectedKey);
  assert.equal(args.item.classification, args.classification);
  assert.equal(args.item.state, args.classification);
  assert.equal(args.item.leadCount, 0);
  assert.equal(args.item.activeRunId, null);
  assert.equal(args.item.aggregateRunId, null);
  assert.equal(args.item.aggregateRun, null);
  assert.match(args.item.blocker ?? "", args.blockerPattern);
}

function assertCompletedCampaign(campaign: SupplierResearchCampaignStatus, config: AcceptanceConfig) {
  assert.equal(campaign.campaignKey, CAMPAIGN_KEY);
  assert.equal(campaign.state, "COMPLETE");
  assert.equal(campaign.status, "SUCCEEDED");
  assert.ok(campaign.workspaceId, "campaign has no persisted workspace");
  if (config.expectedWorkspaceId) assert.equal(campaign.workspaceId, config.expectedWorkspaceId, "campaign used an unexpected system workspace");
  assert.equal(campaign.totalLines, 40);
  assert.equal(campaign.searchableLines, 38);
  assert.equal(campaign.completedLines, 38);
  assert.equal(campaign.progressPercent, 100);
  assert.equal(campaign.targetMinimum, 3);
  assert.equal(campaign.retainedMaximum, 5);
  assert.equal(campaign.items.length, 40);
  assert.equal(new Set(campaign.items.map((item) => item.componentItemKey)).size, 40);
  assert.deepEqual(campaign.totals, {
    items: 40,
    supplierSearchable: 38,
    targetMet: 38,
    needsClarification: 1,
    requirementOnly: 1,
    queued: 0,
    running: 0,
    backingOff: 0,
  });

  const searchable = campaign.items.filter((item) => item.classification === "SUPPLIER_SEARCH");
  assert.equal(searchable.length, 38);
  for (const item of searchable) assertSearchableItem(campaign, item);

  const clarification = campaign.items.find((item) => item.componentItemKey === "GUILD-027");
  assert.ok(clarification, "campaign omitted GUILD-027");
  assertExplicitNonSearchItem({
    item: clarification,
    expectedKey: "GUILD-027",
    classification: "CLARIFICATION_REQUIRED",
    blockerPattern: /quantity and unit/i,
  });
  const requirementOnly = campaign.items.find((item) => item.componentItemKey === "GUILD-039");
  assert.ok(requirementOnly, "campaign omitted GUILD-039");
  assertExplicitNonSearchItem({
    item: requirementOnly,
    expectedKey: "GUILD-039",
    classification: "REQUIREMENT_ONLY",
    blockerPattern: /documentation requirement/i,
  });
}

function pollDelay(campaign: SupplierResearchCampaignStatus) {
  const serverDelay = Number.isFinite(campaign.retryAfterMs) ? campaign.retryAfterMs : 10_000;
  return Math.max(2_500, Math.min(60_000, Math.trunc(serverDelay)));
}

async function startCampaign(config: AcceptanceConfig) {
  const response = await fetchWithTimeout(`${config.baseUrl}/api/supply-os/supplier-research/campaigns`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: config.cookie },
    body: JSON.stringify({ campaignKey: CAMPAIGN_KEY }),
  }, config.requestTimeoutMs);
  const payload = await responseJson<CampaignStartPayload>(response);
  assert.ok(response.status === 202 || response.status === 200, `campaign start failed: ${payload.error ?? response.statusText}`);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i, "campaign start must not be cached");
  assert.ok(payload.campaign, "campaign start returned no persisted campaign");
  assert.equal(payload.campaign.campaignKey, CAMPAIGN_KEY);
  assert.equal(typeof payload.reused, "boolean", "campaign start omitted reuse state");
  assert.ok(Number.isInteger(payload.queued) && Number(payload.queued) >= 0, "campaign start returned an invalid queue count");
  return payload.campaign;
}

async function pollCampaign(config: AcceptanceConfig, initial: SupplierResearchCampaignStatus) {
  const url = new URL("/api/supply-os/supplier-research/campaigns", config.baseUrl);
  url.searchParams.set("campaignKey", CAMPAIGN_KEY);
  const deadline = Date.now() + config.timeoutMs;
  let campaign = initial;
  let progressKey = "";
  while (true) {
    const nextProgressKey = `${campaign.state}:${campaign.completedLines}:${campaign.leadCount}:${campaign.queuedAttempts}:${campaign.runningAttempts}`;
    if (nextProgressKey !== progressKey) {
      console.log(`Campaign ${campaign.id}: ${campaign.completedLines}/38 lines, ${campaign.leadCount} leads, state ${campaign.state}`);
      progressKey = nextProgressKey;
    }
    if (campaign.state === "COMPLETE") return campaign;
    if (campaign.state === "FAILED") assert.fail(`Campaign ${campaign.id} failed before completing all supplier searches`);
    if (String(campaign.state) === "NEEDS_REVIEW") assert.fail(`Campaign ${campaign.id} stopped for operator review: ${campaign.blocker ?? "no blocker was returned"}`);
    if (Date.now() >= deadline) {
      const incomplete = campaign.items.filter((item) => item.classification === "SUPPLIER_SEARCH" && item.state !== "COMPLETE");
      assert.fail(`Campaign ${campaign.id} timed out after ${config.timeoutMs} ms with ${campaign.completedLines}/38 complete. Incomplete: ${incomplete.slice(0, 10).map((item) => `${item.componentItemKey}:${item.state}:${item.leadCount}`).join(", ")}`);
    }
    await wait(Math.min(pollDelay(campaign), Math.max(1, deadline - Date.now())));
    const response = await fetchWithTimeout(url, {
      headers: { cookie: config.cookie },
      cache: "no-store",
    }, config.requestTimeoutMs);
    const payload = await responseJson<CampaignPollPayload>(response);
    assert.equal(response.status, 200, `campaign poll failed: ${payload.error ?? response.statusText}`);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i, "campaign polling must not be cached");
    assert.ok(payload.campaign, "campaign poll returned no campaign");
    assert.equal(payload.campaign.id, initial.id, "campaign polling switched to another run");
    assert.equal(payload.campaign.workspaceId, initial.workspaceId, "campaign polling switched workspaces");
    campaign = payload.campaign;
  }
}

async function main() {
  const config = acceptanceConfig();
  const initial = await startCampaign(config);
  const completed = await pollCampaign(config, initial);
  assertCompletedCampaign(completed, config);
  console.log(JSON.stringify({
    testedAt: new Date().toISOString(),
    campaignId: completed.id,
    workspaceId: completed.workspaceId,
    searchableLines: completed.searchableLines,
    completedLines: completed.completedLines,
    leadCount: completed.leadCount,
    result: "PASS",
  }, null, 2));
}

void main();
