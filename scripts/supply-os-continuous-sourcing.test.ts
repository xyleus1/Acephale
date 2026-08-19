import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GUILD_SOURCING_ITEMS, GUILD_SOURCING_LINES } from "../src/lib/supply-os/guild-sourcing-items";
import {
  GUILD_SUPPLIER_CAMPAIGN_DAILY_ATTEMPT_CAP,
  GUILD_SUPPLIER_CAMPAIGN_EXPLORATION_EPOCH_ATTEMPTS,
  GUILD_SUPPLIER_CAMPAIGN_EVIDENCE_POLICY_VERSION,
  GUILD_SUPPLIER_CAMPAIGN_AGGREGATE_SOURCE_LIMIT,
  GUILD_SUPPLIER_CAMPAIGN_AGGREGATE_WARNING_LIMIT,
  SUPPLIER_RESEARCH_CAMPAIGN_ANCESTRY_WINDOW,
  GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE,
  GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS,
  GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM,
  GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM,
  SUPPLIER_RESEARCH_OFFICE_DAILY_ATTEMPT_CAP,
  aggregateGuildSupplierResearchLine,
  campaignRetryDelayMs,
  isSafeLegacyCampaignSuccessorError,
  configuredSupplierResearchProvider,
  guildSupplierResearchAttemptInput,
  guildSupplierResearchCampaignIdempotencyKey,
  guildSupplierResearchCampaignGenerationKey,
  campaignGenerationFromIdempotencyKey,
  guildSupplierResearchCampaignRevision,
  guildSupplierResearchCampaignScopeExpired,
  mergeGuildSupplierResearchAggregate,
  planGuildSupplierResearchQueue,
  projectGuildSupplierResearchCampaign,
  shouldPersistGuildSupplierResearchAggregate,
  supplierCandidateDomain,
  validateSupplierResearchCampaignAncestryWindow,
  type SupplierResearchCampaignAttempt,
} from "../src/lib/supply-os/supplier-research-campaign";
import {
  parseStoredSupplierResearchRetrievalCapture,
  validatePublicSupplierLeadReceipts,
  type SupplierResearchRetrievalCapture,
} from "../src/lib/supply-os/exa-supplier-research";

const root = process.cwd();
const campaignSource = readFileSync(resolve(root, "src/lib/supply-os/supplier-research-campaign.ts"), "utf8");
const routeSource = readFileSync(resolve(root, "src/app/api/supply-os/supplier-research/campaigns/route.ts"), "utf8");
const cronSource = readFileSync(resolve(root, "src/app/api/cron/supplier-research/route.ts"), "utf8");
const guildSource = readFileSync(resolve(root, "src/lib/supply-os/guild-sourcing-items.ts"), "utf8");
const persistenceSource = readFileSync(resolve(root, "src/lib/supply-os/sourcing-research-persistence.ts"), "utf8");

assert.equal(GUILD_SOURCING_LINES.length, 40);
assert.equal(GUILD_SOURCING_ITEMS.length, 40);
assert.equal(GUILD_SOURCING_LINES.filter((line) => line.classification === "SUPPLIER_SEARCH").length, 38);
assert.equal(GUILD_SOURCING_LINES.filter((line) => line.classification === "CLARIFICATION_REQUIRED").length, 1);
assert.equal(GUILD_SOURCING_LINES.filter((line) => line.classification === "REQUIREMENT_ONLY").length, 1);
assert.equal(GUILD_SOURCING_LINES.find((line) => line.item === "027")?.quantity, null);
assert.equal(GUILD_SOURCING_LINES.find((line) => line.item === "027")?.unit, null);
assert.equal(GUILD_SOURCING_LINES.find((line) => line.item === "039")?.classification, "REQUIREMENT_ONLY");
assert.equal(GUILD_SOURCING_ITEMS.find((item) => item.sku === "GUILD-027")?.requestedQuantity, undefined);
assert.equal(GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM, 3);
assert.equal(GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM, 5);
assert.equal(GUILD_SUPPLIER_CAMPAIGN_EXPLORATION_EPOCH_ATTEMPTS, 9);
assert.equal(GUILD_SUPPLIER_CAMPAIGN_EVIDENCE_POLICY_VERSION, 2);
assert.equal(SUPPLIER_RESEARCH_CAMPAIGN_ANCESTRY_WINDOW, 50);
assert.ok(GUILD_SUPPLIER_CAMPAIGN_DAILY_ATTEMPT_CAP < SUPPLIER_RESEARCH_OFFICE_DAILY_ATTEMPT_CAP);
assert.deepEqual(GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS, ["exact-identity", "official-catalog", "capability-qa"]);
assert.equal(configuredSupplierResearchProvider({ EXA_API_KEY: "exa", OPENAI_API_KEY: "openai" }), "EXA");
assert.equal(configuredSupplierResearchProvider({ OPENAI_API_KEY: "openai" }), "OPENAI");
assert.equal(configuredSupplierResearchProvider({}), null);
assert.match(guildSupplierResearchCampaignRevision("EXA"), /^[a-f0-9]{24}$/);
assert.notEqual(guildSupplierResearchCampaignRevision("EXA"), guildSupplierResearchCampaignRevision("OPENAI"), "provider choice is part of the immutable campaign scope");
assert.equal(guildSupplierResearchCampaignIdempotencyKey("EXA"), `supplier-campaign:guild-procurement:${guildSupplierResearchCampaignRevision("EXA")}`);
assert.equal(guildSupplierResearchCampaignGenerationKey(1, "OPENAI"), guildSupplierResearchCampaignIdempotencyKey("OPENAI"));
assert.equal(guildSupplierResearchCampaignGenerationKey(2, "EXA"), `${guildSupplierResearchCampaignIdempotencyKey("EXA")}:generation:2`);
assert.equal(campaignGenerationFromIdempotencyKey(guildSupplierResearchCampaignGenerationKey(2, "OPENAI"), "OPENAI"), 2);
assert.equal(campaignGenerationFromIdempotencyKey(guildSupplierResearchCampaignGenerationKey(13, "EXA"), "EXA"), 13, "manual campaign generations are not capped below the work objective");
assert.equal(campaignGenerationFromIdempotencyKey(guildSupplierResearchCampaignGenerationKey(2, "OPENAI"), "EXA"), null, "one provider scope cannot be resumed as another provider");
assert.equal(campaignGenerationFromIdempotencyKey("supplier-campaign:guild-procurement:obsolete", "EXA"), null);
assert.equal(guildSupplierResearchCampaignScopeExpired(new Date("2026-08-12T12:00:00.000Z")), false);
assert.equal(guildSupplierResearchCampaignScopeExpired(new Date("2036-10-01T00:00:00.000Z")), false, "the fixed demo need-by date does not hard-expire a continuous campaign");

const deepAncestryWindow = Array.from({ length: SUPPLIER_RESEARCH_CAMPAIGN_ANCESTRY_WINDOW }, (_, index) => ({
  id: `campaign-${75 - index}`,
  parentRunId: `campaign-${74 - index}`,
  depth: index + 1,
}));
const deepAncestry = validateSupplierResearchCampaignAncestryWindow(deepAncestryWindow);
assert.equal(deepAncestry.ids.length, SUPPLIER_RESEARCH_CAMPAIGN_ANCESTRY_WINDOW, "lineage validation stays response bounded after generation fifty");
assert.equal(deepAncestry.truncated, true, "a valid older prefix is reported as truncated instead of terminalizing the campaign");
assert.throws(() => validateSupplierResearchCampaignAncestryWindow([
  { id: "campaign-2", parentRunId: "campaign-1", depth: 1 },
  { id: "campaign-2", parentRunId: null, depth: 2 },
]), /ancestry is invalid/i, "a cycle or duplicate inside the validated window is rejected");
assert.throws(() => validateSupplierResearchCampaignAncestryWindow([
  { id: "campaign-2", parentRunId: "missing-campaign", depth: 1 },
]), /ancestry is invalid/i, "a missing ancestor inside a non-full window is rejected");

const unknownEnvelope = {
  value: null,
  state: "UNKNOWN",
  confidence: null,
  sources: [],
  observedAt: null,
  freshness: "UNKNOWN",
} as const;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function attempt(args: {
  id: string;
  itemKey?: string;
  status?: string;
  createdAt?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}): SupplierResearchCampaignAttempt {
  const createdAt = args.createdAt ?? "2026-08-12T00:00:00.000Z";
  return {
    id: args.id,
    status: args.status ?? "SUCCEEDED",
    input: args.input ?? {
      componentItemKey: `request:${(args.itemKey ?? "GUILD-001").toLowerCase()}`,
      campaignItemKey: args.itemKey ?? "GUILD-001",
    },
    output: args.output ?? { candidates: [], sources: [], degraded: true, warnings: [] },
    error: args.error ?? null,
    createdAt,
    updatedAt: createdAt,
    completedAt: args.status === "QUEUED" || args.status === "RUNNING" ? null : createdAt,
    failedAt: args.status === "FAILED" ? createdAt : null,
  };
}

function trustedAttempt(args: {
  id: string;
  line: (typeof GUILD_SOURCING_LINES)[number];
  domains: string[];
  provider?: "EXA" | "OPENAI";
  createdAt?: string;
}) {
  const provider = args.provider ?? "EXA";
  const input = guildSupplierResearchAttemptInput({ line: args.line, campaignId: "campaign-a", attemptNumber: 1, requiredProvider: provider });
  const retrievedAt = new Date(Date.now() - 60_000).toISOString();
  const records = args.domains.map((rawDomain, index) => {
    const domain = rawDomain.replace(/^www\./, "");
    const domainLabel = domain.split(".").at(-2) ?? domain.split(".")[0];
    const companyName = domainLabel.replace(/[^a-z0-9]/gi, "");
    const sourceUrl = `https://${rawDomain}/products`;
    const itemIdentity = `${args.line.name}. ${args.line.specification}. ${args.line.deliverable}`;
    const companyEvidence = `${companyName} is the official company for ${domain}.`;
    const roleEvidence = `${companyName} manufactures industrial components.`;
    const capabilityEvidence = `${companyName} manufactures and supplies ${itemIdentity}.`;
    const text = `${companyEvidence} ${roleEvidence} ${capabilityEvidence}`;
    return {
      searchRank: index + 1,
      sourceId: `source-${args.id}-${index}`,
      sourceUrl,
      sourceTitle: `${companyName} products`,
      status: {
        id: sourceUrl,
        status: "success",
        errorTag: null,
        httpStatusCode: 200,
        cacheState: null,
        cacheAgeHours: 0,
      },
      publishedDate: null,
      text,
      highlights: [],
      proposal: {
        supplierName: companyName,
        supplierRole: "MANUFACTURER",
        companyIdentityEvidence: companyEvidence,
        supplierRoleEvidence: roleEvidence,
        productCapabilityEvidence: capabilityEvidence,
        itemIdentity,
        manufacturer: null,
        mpn: null,
        priceAmount: null,
        currency: null,
        unitOfMeasure: null,
        packageQuantity: null,
        evidenceText: null,
      },
      sourceTextHash: hash(text),
    };
  });
  const retrieval = {
    provider,
    freshnessPolicy: provider === "EXA" ? "FORCED_LIVE" : "SERVER_RETRIEVED",
    searchRequestId: `search-${args.id}`,
    contentsRequestId: `contents-${args.id}`,
    searchHttpStatus: 200,
    contentsHttpStatus: 200,
    searchResponseHash: hash(`search-${args.id}`),
    contentsResponseHash: provider === "OPENAI" ? hash(JSON.stringify(records)) : hash(`contents-${args.id}`),
    retrievedAt,
    records,
  } as SupplierResearchRetrievalCapture;
  const receipts = validatePublicSupplierLeadReceipts(input, retrieval);
  assert.equal(receipts.length, args.domains.length, `test fixture for ${args.line.sku} must pass production receipt validation`);
  assert.ok(parseStoredSupplierResearchRetrievalCapture(retrieval), `test fixture for ${args.line.sku} must survive stored capture parsing`);
  const candidates = receipts.map((receipt, index) => ({
    id: `raw-${args.id}-${index}`,
    officeId: "office-a",
    workspaceId: "workspace-a",
    componentItemKey: input.componentItemKey,
    companyName: receipt.companyName,
    website: receipt.website,
    roles: [receipt.role],
    country: unknownEnvelope,
    facility: unknownEnvelope,
    productCapability: {
      value: receipt.productCapability,
      state: "SUPPORTED",
      confidence: 1,
      sources: [{ url: receipt.sourceUrl, sourceType: "OFFICIAL" }],
      observedAt: receipt.retrievedAt,
      freshness: "UNKNOWN",
    },
    price: unknownEnvelope,
    currency: unknownEnvelope,
    unitOfMeasure: unknownEnvelope,
    minimumOrderQuantity: unknownEnvelope,
    leadTimeDays: unknownEnvelope,
    sourceUrls: [receipt.sourceUrl],
    status: "REVIEW_REQUIRED",
    approvedByUserId: null,
    approvedAt: null,
    cautions: [],
  }));
  return attempt({
    id: args.id,
    itemKey: args.line.sku,
    createdAt: args.createdAt,
    input,
    output: {
      retrieval,
      publicSupplierLeadReceipts: receipts.map((receipt, index) => ({ ...receipt, candidateId: candidates[index].id })),
      candidates,
      sources: receipts.map((receipt) => ({ url: receipt.sourceUrl, sourceType: "OFFICIAL" })),
      degraded: candidates.length < 3,
      warnings: [],
    },
  });
}

const firstLine = GUILD_SOURCING_LINES[0];
const aggregationAttempts = [
  trustedAttempt({
    id: "attempt-a",
    line: firstLine,
    domains: ["www.acme.example", "beta.example"],
  }),
  trustedAttempt({
    id: "attempt-b",
    line: firstLine,
    createdAt: "2026-08-12T01:00:00.000Z",
    domains: ["catalog.acme.example", "charlie.example", "delta.example", "echo.example", "foxtrot.example", "golf.example"],
  }),
];
const aggregate = aggregateGuildSupplierResearchLine(firstLine, aggregationAttempts);
assert.equal(aggregate.candidates.length, 5, "a line aggregate retains at most five legitimate candidates");
assert.equal(new Set(aggregate.candidates.map(supplierCandidateDomain)).size, 5, "retained candidates are distinct by supplier domain");
assert.equal(aggregate.candidates.filter((value) => value.website?.includes("acme.example")).length, 1, "parent and subdomain variants are one supplier");
assert.ok(aggregate.candidates.every((value) => value.status === "REVIEW_REQUIRED"));
assert.ok(aggregate.candidates.every((value) => value.componentItemKey === "GUILD-001"));
assert.ok(aggregate.candidates.every((value) => value.officeId === "office-a" && value.workspaceId === "workspace-a"));
assert.ok(aggregate.sources.every((source) => source.sourceType === "PUBLIC"), "Exa retrieval evidence cannot be promoted to OFFICIAL by child output");
assert.equal(new Set(aggregate.candidates.map((value) => value.id)).size, aggregate.candidates.length, "aggregate candidate identifiers are canonical and unique");
const openAiAggregate = aggregateGuildSupplierResearchLine(firstLine, [trustedAttempt({
  id: "attempt-openai",
  line: firstLine,
  provider: "OPENAI",
  domains: ["openai-validated.example"],
})]);
assert.equal(openAiAggregate.candidates.length, 1, "campaign aggregation accepts a provider-neutral durable OpenAI receipt");
assert.equal(openAiAggregate.sources[0]?.sourceType, "PUBLIC");
const mismatchedProviderAttempt = structuredClone(trustedAttempt({
  id: "attempt-provider-mismatch",
  line: firstLine,
  provider: "OPENAI",
  domains: ["provider-mismatch.example"],
})) as SupplierResearchCampaignAttempt;
(mismatchedProviderAttempt.input as Record<string, unknown>).requiredProvider = "EXA";
const mismatchedProviderAggregate = aggregateGuildSupplierResearchLine(firstLine, [mismatchedProviderAttempt]);
assert.equal(mismatchedProviderAggregate.candidates.length, 0, "a receipt from a different provider cannot cross an immutable campaign pin");
assert.equal(mismatchedProviderAggregate.sources.length, 1, "provider mismatch rejects the lead without erasing attributable public evidence");

const forgedNoReceipt = attempt({
  id: "forged-no-receipt",
  output: {
    candidates: [aggregationAttempts[0].output && (aggregationAttempts[0].output as { candidates: unknown[] }).candidates[0]],
    sources: [{ url: "https://www.acme.example/products", sourceType: "OFFICIAL" }],
    degraded: false,
    warnings: [],
  },
});
assert.equal(aggregateGuildSupplierResearchLine(firstLine, [forgedNoReceipt]).candidates.length, 0, "candidate-shaped output without a validated receipt is rejected");
const evidenceWithoutValidLead = aggregateGuildSupplierResearchLine(firstLine, [attempt({
  id: "evidence-without-valid-lead",
  input: { componentItemKey: "request:guild-001", campaignItemKey: "GUILD-001", requiredProvider: "OPENAI" },
  output: {
    candidates: [],
    sources: [{ url: "https://discovery.example/catalog", sourceType: "OFFICIAL" }],
    degraded: true,
    warnings: ["Public pages were found, but no supplier lead passed evidence validation."],
    retrieval: { provider: "OPENAI", freshnessPolicy: "SERVER_RETRIEVED", stage: "SEARCH_ONLY" },
    publicSupplierLeadReceipts: [],
  },
})]);
assert.equal(evidenceWithoutValidLead.candidates.length, 0);
assert.deepEqual(evidenceWithoutValidLead.sources, [{ url: "https://discovery.example/catalog", sourceType: "PUBLIC" }], "zero valid leads must not erase attributable discovery sources");
assert.deepEqual(evidenceWithoutValidLead.warnings, ["Public pages were found, but no supplier lead passed evidence validation."], "zero valid leads must retain sanitized provider warnings");
const forgedReceipt = structuredClone(aggregationAttempts[0]) as SupplierResearchCampaignAttempt;
const forgedOutput = forgedReceipt.output as { publicSupplierLeadReceipts: Array<{ receiptHash: string }> };
forgedOutput.publicSupplierLeadReceipts[0].receiptHash = "0".repeat(64);
assert.equal(aggregateGuildSupplierResearchLine(firstLine, [forgedReceipt]).candidates.length, 1, "a forged receipt cannot admit its candidate");

const now = new Date("2026-08-12T12:00:00.000Z");
const initialPlan = planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: [],
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
});
assert.deepEqual(initialPlan.map((work) => work.itemKey), ["GUILD-001", "GUILD-002", "GUILD-003", "GUILD-004", "GUILD-005", "GUILD-006"]);
assert.ok(initialPlan.every((work) => work.attemptNumber === 1), "every searchable line gets a first attempt before retries");
assert.equal(initialPlan[0].input.queryVariant, "exact-identity");
assert.equal(initialPlan[0].input.campaignItemKey, "GUILD-001");
assert.equal(initialPlan[0].input.requiredProvider, "EXA", "campaign attempts must never fall back to an unvalidated provider");
const openAiPlan = planGuildSupplierResearchQueue({
  campaignId: "campaign-openai",
  requiredProvider: "OPENAI",
  attempts: [],
  now,
  campaignAttemptsRemaining: 1,
  officeAttemptsRemaining: 1,
});
assert.equal(openAiPlan[0].input.requiredProvider, "OPENAI", "the selected fallback provider is pinned into the immutable child input");

const everyInitialLine = planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: [],
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
  batchSize: 100,
});
assert.equal(everyInitialLine.length, 38);
assert.ok(!everyInitialLine.some((work) => ["GUILD-027", "GUILD-039"].includes(work.itemKey)));
assert.equal(planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: [],
  now,
  campaignAttemptsRemaining: 0,
  officeAttemptsRemaining: 72,
}).length, 0, "the daily campaign quota is a hard scheduling cap");

const activePlan = planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: [attempt({ id: "queued-1", itemKey: "GUILD-001", status: "QUEUED" })],
  now,
  campaignAttemptsRemaining: 2,
  officeAttemptsRemaining: 1,
});
assert.equal(activePlan.length, 1, "the smallest daily quota remainder bounds a scheduling pass");
assert.equal(activePlan[0].itemKey, "GUILD-002", "an active line never receives a duplicate queued job");

const oldFailure = attempt({
  id: "failed-1",
  itemKey: "GUILD-001",
  status: "FAILED",
  createdAt: "2026-08-12T11:59:00.000Z",
  error: { message: "PROVIDER_TIMEOUT: Public supplier research timed out." },
});
const backoffPlan = planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: [oldFailure],
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
  batchSize: 38,
});
assert.ok(!backoffPlan.some((work) => work.itemKey === "GUILD-001"), "a failed line waits for deterministic retry backoff");
assert.equal(campaignRetryDelayMs("GUILD-001", 1), campaignRetryDelayMs("GUILD-001", 1));
assert.ok(campaignRetryDelayMs("GUILD-001", 2) > campaignRetryDelayMs("GUILD-001", 1));
assert.ok(campaignRetryDelayMs("GUILD-001", 99) <= 24 * 60 * 60_000);

const failureStatus = projectGuildSupplierResearchCampaign({
  campaign: { id: "campaign-a", workspaceId: "workspace-a", status: "RUNNING", updatedAt: now },
  attempts: [oldFailure],
  campaignAttemptsUsed: 1,
  officeAttemptsUsed: 1,
  now,
});
assert.equal(failureStatus.items[0].state, "RETRY_WAIT");
assert.equal(failureStatus.items[0].lastErrorCode, "PROVIDER_TIMEOUT");
for (const retryableCode of ["INVALID_STRUCTURED_RESPONSE", "PERSISTENCE_FAILURE", "WORKER_INTERRUPTED"]) {
  const retryableAttempt = attempt({
    id: `failed-${retryableCode.toLowerCase()}`,
    status: "FAILED",
    createdAt: "2026-08-12T11:59:00.000Z",
    error: { message: `${retryableCode}: Supplier research did not produce a durable result.` },
  });
  const retryableStatus = projectGuildSupplierResearchCampaign({
    campaign: { id: "campaign-a", workspaceId: "workspace-a", status: "RUNNING", updatedAt: now },
    attempts: [retryableAttempt],
    campaignAttemptsUsed: 1,
    officeAttemptsUsed: 1,
    now,
  });
  assert.equal(retryableStatus.items[0].state, "RETRY_WAIT", `${retryableCode} must move through bounded retry backoff`);
  assert.notEqual(retryableStatus.state, "FAILED", `${retryableCode} must not kill the campaign after one attempt`);
}
assert.equal(projectGuildSupplierResearchCampaign({
  campaign: { id: "campaign-a", workspaceId: "workspace-a", status: "RUNNING", updatedAt: now },
  attempts: [attempt({
    id: "failed-large-response",
    status: "FAILED",
    createdAt: "2026-08-12T11:59:00.000Z",
    error: { message: "PROVIDER_RESPONSE_TOO_LARGE: Public supplier research response exceeded the safe limit." },
  })],
  campaignAttemptsUsed: 1,
  officeAttemptsUsed: 1,
  now,
}).items[0].state, "RETRY_WAIT", "an oversized provider result gets bounded query-variant retry");
const missingConfiguration = projectGuildSupplierResearchCampaign({
  campaign: { id: "campaign-a", workspaceId: "workspace-a", status: "RUNNING", updatedAt: now },
  attempts: [attempt({
    id: "failed-config",
    status: "FAILED",
    createdAt: "2026-08-12T11:59:00.000Z",
    error: { message: "MISSING_CONFIGURATION: Public supplier research is not configured." },
  })],
  campaignAttemptsUsed: 1,
  officeAttemptsUsed: 1,
  now,
});
assert.equal(missingConfiguration.items[0].state, "BLOCKED");
assert.match(missingConfiguration.items[0].blocker ?? "", /configuration/i);
assert.equal(missingConfiguration.state, "FAILED", "operator configuration failures stop the campaign visibly");
const authFailure = attempt({
  id: "failed-auth",
  status: "FAILED",
  createdAt: "2026-08-12T11:59:00.000Z",
  error: { message: "PROVIDER_AUTHENTICATION_FAILED: Public supplier research authentication failed." },
});
assert.ok(!planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: [authFailure],
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
  batchSize: 38,
}).some((work) => work.itemKey === "GUILD-001"), "authentication failure does not burn retries without operator action");
assert.equal(projectGuildSupplierResearchCampaign({
  campaign: { id: "campaign-a", workspaceId: "workspace-a", status: "RUNNING", updatedAt: now },
  attempts: [authFailure],
  campaignAttemptsUsed: 1,
  officeAttemptsUsed: 1,
  now,
}).state, "FAILED");
const accessRevoked = attempt({
  id: "failed-access",
  status: "FAILED",
  createdAt: "2026-08-12T11:59:00.000Z",
  error: { message: "ACCESS_REVOKED: Supplier research workspace access was revoked." },
});
assert.equal(planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: [accessRevoked],
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
  batchSize: 38,
}).some((work) => work.itemKey === "GUILD-001"), false, "access revocation blocks unattended retry");
assert.equal(planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: [accessRevoked],
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
  batchSize: 38,
  allowTerminalRetry: true,
}).some((work) => work.itemKey === "GUILD-001"), true, "manual retry may resume after access is restored");

const nineAttempts = Array.from({ length: 9 }, (_, index) => attempt({
  id: `empty-${index + 1}`,
  createdAt: `2026-08-0${index + 1}T00:00:00.000Z`,
}));
const secondEpochPlan = planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: nineAttempts,
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
  batchSize: 38,
});
assert.equal(secondEpochPlan.find((work) => work.itemKey === "GUILD-001")?.attemptNumber, 10, "nine attempts finish one exploration epoch instead of terminalizing the line");
assert.equal(secondEpochPlan.find((work) => work.itemKey === "GUILD-001")?.input.explorationEpoch, 2);
assert.equal(secondEpochPlan.find((work) => work.itemKey === "GUILD-001")?.input.attemptInEpoch, 1);
assert.equal(secondEpochPlan.find((work) => work.itemKey === "GUILD-001")?.input.queryCycle, 0, "each exploration epoch deterministically restarts the bounded query matrix");
const epochStatus = projectGuildSupplierResearchCampaign({
  campaign: { id: "campaign-a", workspaceId: "workspace-a", status: "RUNNING", updatedAt: now },
  attempts: nineAttempts,
  campaignAttemptsUsed: 9,
  officeAttemptsUsed: 9,
  now,
});
assert.notEqual(epochStatus.state, "FAILED", "epoch exhaustion alone never fails the parent campaign");
assert.notEqual(epochStatus.items[0].state, "BLOCKED", "epoch exhaustion alone never blocks a sourceable line");
assert.ok(campaignRetryDelayMs("GUILD-001", 9) <= 24 * 60 * 60_000, "the pause between exploration epochs is bounded at 24 hours");
assert.ok(campaignRetryDelayMs("GUILD-001", 10) < campaignRetryDelayMs("GUILD-001", 9), "retry backoff restarts inside the next exploration epoch");

const sparseHistoryPlan = planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: [attempt({
    id: "latest-only-99",
    itemKey: "GUILD-001",
    createdAt: "2026-08-01T00:00:00.000Z",
    input: { componentItemKey: "request:guild-001", campaignItemKey: "GUILD-001", attemptNumber: 99 },
  })],
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
  batchSize: 38,
});
assert.equal(sparseHistoryPlan.find((work) => work.itemKey === "GUILD-001")?.attemptNumber, 100, "a bounded history window continues from the durable attempt ordinal");
const maximumSafeExploration = guildSupplierResearchAttemptInput({
  line: firstLine,
  campaignId: "campaign-a",
  attemptNumber: Number.MAX_SAFE_INTEGER,
  requiredProvider: "EXA",
});
assert.equal(maximumSafeExploration.queryVariant, "exact-identity");
assert.equal(maximumSafeExploration.queryCycle, 1, "query exploration uses bounded modular arithmetic at the largest safe attempt ordinal");
assert.equal(maximumSafeExploration.attemptInEpoch, 4);
const payloadBoundFixture = mergeGuildSupplierResearchAggregate(
  {
    candidates: [],
    sources: Array.from({ length: 80 }, (_, index) => ({ url: `https://prior-${index}.example/catalog`, sourceType: "PUBLIC" as const })),
    degraded: true,
    warnings: Array.from({ length: 25 }, (_, index) => `prior warning ${index}`),
  },
  {
    candidates: [],
    sources: Array.from({ length: 20 }, (_, index) => ({ url: `https://new-${index}.example/catalog`, sourceType: "PUBLIC" as const })),
    degraded: true,
    warnings: Array.from({ length: 10 }, (_, index) => `new warning ${index}`),
  },
);
assert.equal(payloadBoundFixture.sources.length, GUILD_SUPPLIER_CAMPAIGN_AGGREGATE_SOURCE_LIMIT, "perpetual aggregate source history stays payload bounded");
assert.deepEqual(payloadBoundFixture.sources.slice(0, 2).map((source) => source.url), ["https://new-0.example/catalog", "https://new-1.example/catalog"], "new discovery sources get exclusion priority");
assert.equal(payloadBoundFixture.warnings.length, GUILD_SUPPLIER_CAMPAIGN_AGGREGATE_WARNING_LIMIT, "perpetual aggregate warnings stay payload bounded");
const carryForwardFixture = mergeGuildSupplierResearchAggregate(aggregate, {
  candidates: [],
  sources: [],
  degraded: true,
  warnings: ["new attempt found no additional validated lead"],
});
assert.equal(carryForwardFixture.candidates.length, 5, "a bounded attempt window does not discard validated leads carried by the current evidence-policy aggregate");
assert.equal(new Set(carryForwardFixture.candidates.map(supplierCandidateDomain)).size, 5);
assert.equal(isSafeLegacyCampaignSuccessorError({ message: "CAMPAIGN_BLOCKED: Supplier research reached the 9-attempt limit without three validated leads." }), true);
assert.equal(isSafeLegacyCampaignSuccessorError({ message: "CAMPAIGN_BLOCKED: Supplier research has no retryable work." }), true);
for (const unsafeLegacyFailure of [
  "CAMPAIGN_BLOCKED: Supplier research provider configuration is unavailable.",
  "PROVIDER_AUTHENTICATION_FAILED: Public supplier research authentication failed.",
  "ACCESS_REVOKED: Supplier research workspace access was revoked.",
  "CAMPAIGN_SCOPE_EXPIRED: Supplier research scope expired.",
  "CAMPAIGN_SCOPE_SUPERSEDED: Supplier research campaign scope was replaced.",
]) {
  assert.equal(isSafeLegacyCampaignSuccessorError({ message: unsafeLegacyFailure }), false, `${unsafeLegacyFailure} remains an explicit manual blocker`);
}
const fourthAttempt = guildSupplierResearchAttemptInput({ line: firstLine, campaignId: "campaign-a", attemptNumber: 4, requiredProvider: "EXA", excludeDomains: ["acme.example"] });
assert.equal(fourthAttempt.queryCycle, 1);
assert.equal(fourthAttempt.queryVariant, "exact-identity");
assert.deepEqual(fourthAttempt.excludeDomains, ["acme.example"]);
const cappedStatus = projectGuildSupplierResearchCampaign({
  campaign: { id: "campaign-a", workspaceId: "workspace-a", status: "RUNNING", updatedAt: now },
  attempts: [],
  campaignAttemptsUsed: GUILD_SUPPLIER_CAMPAIGN_DAILY_ATTEMPT_CAP,
  officeAttemptsUsed: 1,
  now,
});
assert.equal(cappedStatus.state, "DAILY_CAP");

function aggregateFixture(line: (typeof GUILD_SOURCING_LINES)[number], index: number) {
  const suffix = line.item;
  const trusted = trustedAttempt({
    id: `trusted-${suffix}-${index}`,
    line,
    domains: [`alpha${suffix}.example`, `bravo${suffix}.example`, `charlie${suffix}.example`],
  });
  return aggregateGuildSupplierResearchLine(line, [trusted]);
}

const completeAggregates = GUILD_SOURCING_LINES.filter((line) => line.classification === "SUPPLIER_SEARCH").map((line, index) => ({
  id: `aggregate-${line.item}`,
  status: "SUCCEEDED" as const,
  input: {
    componentItemKey: line.sku,
    componentName: line.name,
    manufacturer: null,
    mpn: null,
    specification: line.specification,
    targetCountry: "United States",
    requestText: line.requirement,
    requestedQuantity: line.quantity!,
    requestedUnit: line.unit!,
    sourceRegion: "Any region",
    deliveryLocation: "Austin, TX, United States",
    needByDate: GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE,
    campaignId: "campaign-a",
    campaignKey: "guild-procurement" as const,
    campaignItemKey: line.sku,
    campaignArtifactKind: "AGGREGATE" as const,
    campaignEvidencePolicyVersion: GUILD_SUPPLIER_CAMPAIGN_EVIDENCE_POLICY_VERSION,
    campaignAttemptCount: 1,
    campaignTerminalAttemptCount: 1,
    campaignAttemptWatermark: `fixture-${line.sku}`,
    requiredProvider: "EXA" as const,
  },
  output: aggregateFixture(line, index),
  error: null,
  createdAt: now.toISOString(),
  completedAt: now.toISOString(),
  failedAt: null,
  updatedAt: now.toISOString(),
}));
const status = projectGuildSupplierResearchCampaign({
  campaign: { id: "campaign-a", workspaceId: "workspace-a", status: "RUNNING", updatedAt: now },
  attempts: [],
  aggregates: completeAggregates,
  campaignAttemptsUsed: 38,
  officeAttemptsUsed: 38,
  now,
});
assert.equal(status.state, "COMPLETE");
assert.equal(status.status, "SUCCEEDED");
assert.equal(status.completedLines, 38);
assert.equal(status.progressPercent, 100);
assert.equal(status.items.find((item) => item.componentItemKey === "GUILD-027")?.state, "CLARIFICATION_REQUIRED");
assert.equal(status.items.find((item) => item.componentItemKey === "GUILD-039")?.state, "REQUIREMENT_ONLY");
const completingChildStillRunning = projectGuildSupplierResearchCampaign({
  campaign: { id: "campaign-a", workspaceId: "workspace-a", status: "RUNNING", updatedAt: now },
  attempts: [attempt({ id: "still-running", itemKey: "GUILD-001", status: "RUNNING", createdAt: now.toISOString() })],
  aggregates: completeAggregates,
  campaignAttemptsUsed: 38,
  officeAttemptsUsed: 38,
  now,
});
assert.equal(completingChildStillRunning.state, "RUNNING", "the parent cannot terminalize while a child is RUNNING");
assert.equal(completingChildStillRunning.status, "RUNNING");
assert.equal(completingChildStillRunning.runningAttempts, 1);
assert.equal(planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  requiredProvider: "EXA",
  attempts: [],
  aggregates: completeAggregates,
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
  batchSize: 100,
}).length, 0, "a target-complete line is never queued again");

const aggregateRunStatus = projectGuildSupplierResearchCampaign({
  campaign: { id: "campaign-a", workspaceId: "workspace-a", status: "RUNNING", updatedAt: now },
  attempts: [],
  aggregates: [{
    id: "aggregate-001",
    status: "SUCCEEDED",
    input: {
      componentItemKey: "GUILD-001",
      componentName: firstLine.name,
      manufacturer: null,
      mpn: null,
      specification: firstLine.specification,
      targetCountry: "United States",
      requestText: firstLine.requirement,
      requestedQuantity: firstLine.quantity!,
      requestedUnit: firstLine.unit!,
      sourceRegion: "Any region",
      deliveryLocation: "Austin, TX, United States",
      needByDate: "2026-09-30",
      campaignId: "campaign-a",
      campaignKey: "guild-procurement",
      campaignItemKey: "GUILD-001",
      campaignArtifactKind: "AGGREGATE",
      campaignEvidencePolicyVersion: GUILD_SUPPLIER_CAMPAIGN_EVIDENCE_POLICY_VERSION,
      campaignAttemptCount: 1,
      campaignTerminalAttemptCount: 1,
      campaignAttemptWatermark: "fixture-GUILD-001",
      requiredProvider: "EXA",
    },
    output: aggregateFixture(firstLine, 0),
    error: null,
    createdAt: now.toISOString(),
    completedAt: now.toISOString(),
    failedAt: null,
    updatedAt: now.toISOString(),
  }],
  campaignAttemptsUsed: 1,
  officeAttemptsUsed: 1,
  now,
});
assert.equal(aggregateRunStatus.items[0].aggregateRunId, "aggregate-001");
assert.equal(aggregateRunStatus.items[0].aggregateRun?.status, "SUCCEEDED");
assert.equal(aggregateRunStatus.items[0].aggregateRun?.output.candidates.length, 3);

assert.equal(shouldPersistGuildSupplierResearchAggregate({
  latestAttemptCount: 3,
  latestTerminalAttemptCount: 3,
  latestOutputHash: "three-leads",
  incomingAttemptCount: 2,
  incomingTerminalAttemptCount: 2,
  incomingOutputHash: "two-leads",
}), false, "a stale lower attempt watermark cannot regress the aggregate");
assert.equal(shouldPersistGuildSupplierResearchAggregate({
  latestAttemptCount: 3,
  latestTerminalAttemptCount: 3,
  latestOutputHash: "three-leads",
  incomingAttemptCount: 3,
  incomingTerminalAttemptCount: 3,
  incomingOutputHash: "two-revalidated-leads",
}), true, "current receipt revalidation may remove an invalidated lead");
assert.equal(shouldPersistGuildSupplierResearchAggregate({
  latestAttemptCount: 3,
  latestTerminalAttemptCount: 3,
  latestOutputHash: "three-leads",
  incomingAttemptCount: 3,
  incomingTerminalAttemptCount: 3,
  incomingOutputHash: "zero-revalidated-leads",
}), true, "current receipt revalidation may invalidate every prior lead");

assert.match(routeSource, /status: 410/, "legacy campaign creation must remain disabled");
assert.doesNotMatch(routeSource, /startOrResumeGuildSupplierResearchCampaign/, "legacy campaign creation must not be reachable");
assert.match(routeSource, /pollGuildSupplierResearchCampaign/);
assert.doesNotMatch(routeSource, /searchComponentSuppliers|runSourcingResearchWorker|OpenAI|Exa/);
const pollSource = campaignSource.slice(
  campaignSource.indexOf("export async function pollGuildSupplierResearchCampaign"),
  campaignSource.indexOf("export async function advanceSupplierResearchCampaigns"),
);
assert.match(pollSource, /loadCampaignDatabaseState/);
assert.match(pollSource, /findCampaignWorkspace/);
assert.match(pollSource, /projectGuildSupplierResearchCampaign/);
assert.doesNotMatch(pollSource, /reconcileCampaign|enqueueSourcingResearchRun|persistChangedAggregates/, "GET polling must stay read-only");
assert.doesNotMatch(pollSource, /includeAttemptOutputs:\s*true/, "GET polling never loads child result payloads");
assert.doesNotMatch(campaignSource, /lines:\s*items/, "campaign response has one canonical item collection");
assert.doesNotMatch(campaignSource, /childRunIds/, "campaign response does not expose unbounded child run identifiers");
assert.match(campaignSource, /guildSupplierResearchCampaignIdempotencyKey/);
assert.doesNotMatch(campaignSource, /supplier-campaign:\$\{GUILD_SUPPLIER_CAMPAIGN_KEY\}:v1/);
assert.match(campaignSource, /aggregateRunId/);
assert.match(campaignSource, /dslName: AGGREGATE_DSL_NAME/);
assert.match(campaignSource, /const ATTEMPT_DSL_NAME = "queued_supplier_research_child"/);
assert.match(persistenceSource, /dslName: parentRunId \? "queued_supplier_research_child" : "interactive_supplier_research"/);
assert.match(persistenceSource, /if \(mode === "view"\)/);
assert.match(persistenceSource, /findGuildSourcingSystemWorkspace/);
assert.match(persistenceSource, /supplier-research-office-provider-budget:/);
assert.match(campaignSource, /supplier-research-office-provider-budget:/, "campaign cutover shares the office claim lock before cancelling queued children");
assert.match(persistenceSource, /clock_timestamp\(\)/, "the hard daily spend bound derives its UTC day after acquiring the office-stable lock");
assert.match(persistenceSource, /reconciliationToken/);
assert.match(campaignSource, /FOR UPDATE/);
assert.match(campaignSource, /campaignAttemptWatermark/);
assert.match(campaignSource, /status !== "RUNNING" \|\| !hasReconciliationLease/);
assert.match(persistenceSource, /startedAt: \{ gte: dayStart \}/);
assert.match(persistenceSource, /if \(callsStartedToday >= OFFICE_DAILY_PROVIDER_CALL_CAP\) continue/);
assert.match(campaignSource, /idempotencyKey: `guild:\$\{args\.campaign\.id\}:\$\{work\.itemKey\}:attempt:\$\{work\.attemptNumber\}`/);
assert.doesNotMatch(campaignSource, /generation > GUILD_SUPPLIER_CAMPAIGN_MAX_GENERATIONS/, "manual successors are not capped before the objective is met");
assert.match(campaignSource, /isSafeLegacyCampaignSuccessorError/, "cron has an explicit allow-list for safe legacy failed-campaign successors");
assert.match(campaignSource, /const runningCampaigns = await prisma\.supplyCapabilityRun\.findMany/, "RUNNING campaigns are selected before legacy recovery rows");
assert.match(campaignSource, /const recoveryCapacity = Math\.max\(0, limit - runningCampaigns\.length\)/, "legacy recovery cannot consume capacity reserved for RUNNING campaigns");
assert.match(campaignSource, /NOT EXISTS \(/, "only the latest failed campaign in an office workspace can auto-recover");
assert.match(campaignSource, /status: "RUNNING",\s*\n\s*\},\s*\n\s*\}\);\s*\n\s*if \(runningChildren > 0\) return false;/, "a parent cannot terminalize while a child is RUNNING");
assert.match(campaignSource, /::bigint/, "aggregate ordinal ordering does not overflow PostgreSQL int at high attempt counts");
assert.match(cronSource, /disabled: true/, "legacy supplier-research cron must remain disabled");
assert.doesNotMatch(cronSource, /advanceSupplierResearchCampaigns|runQueuedSourcingResearchWorkers/);
assert.doesNotMatch([campaignSource, routeSource, cronSource, guildSource].join("\n"), /\u2014/);

console.log("Supply OS continuous supplier sourcing checks passed.");
