import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GUILD_SOURCING_ITEMS, GUILD_SOURCING_LINES } from "../src/lib/supply-os/guild-sourcing-items";
import {
  GUILD_SUPPLIER_CAMPAIGN_DAILY_ATTEMPT_CAP,
  GUILD_SUPPLIER_CAMPAIGN_MAX_ATTEMPTS_PER_LINE,
  GUILD_SUPPLIER_CAMPAIGN_MAX_GENERATIONS,
  GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE,
  GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS,
  GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM,
  GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM,
  SUPPLIER_RESEARCH_OFFICE_DAILY_ATTEMPT_CAP,
  aggregateGuildSupplierResearchLine,
  campaignRetryDelayMs,
  guildSupplierResearchAttemptInput,
  guildSupplierResearchCampaignIdempotencyKey,
  guildSupplierResearchCampaignGenerationKey,
  campaignGenerationFromIdempotencyKey,
  guildSupplierResearchCampaignRevision,
  guildSupplierResearchCampaignScopeExpired,
  planGuildSupplierResearchQueue,
  projectGuildSupplierResearchCampaign,
  shouldPersistGuildSupplierResearchAggregate,
  supplierCandidateDomain,
  type SupplierResearchCampaignAttempt,
} from "../src/lib/supply-os/supplier-research-campaign";
import {
  validateExaPublicSupplierLeadReceipts,
  type ExaRetrievalCapture,
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
assert.equal(GUILD_SUPPLIER_CAMPAIGN_MAX_ATTEMPTS_PER_LINE, 9);
assert.equal(GUILD_SUPPLIER_CAMPAIGN_MAX_GENERATIONS, 12);
assert.ok(GUILD_SUPPLIER_CAMPAIGN_DAILY_ATTEMPT_CAP < SUPPLIER_RESEARCH_OFFICE_DAILY_ATTEMPT_CAP);
assert.deepEqual(GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS, ["exact-identity", "official-catalog", "capability-qa"]);
assert.match(guildSupplierResearchCampaignRevision(), /^[a-f0-9]{24}$/);
assert.equal(guildSupplierResearchCampaignIdempotencyKey(), `supplier-campaign:guild-procurement:${guildSupplierResearchCampaignRevision()}`);
assert.equal(guildSupplierResearchCampaignGenerationKey(1), guildSupplierResearchCampaignIdempotencyKey());
assert.equal(guildSupplierResearchCampaignGenerationKey(2), `${guildSupplierResearchCampaignIdempotencyKey()}:generation:2`);
assert.equal(campaignGenerationFromIdempotencyKey(guildSupplierResearchCampaignGenerationKey(2)), 2);
assert.equal(campaignGenerationFromIdempotencyKey(guildSupplierResearchCampaignGenerationKey(GUILD_SUPPLIER_CAMPAIGN_MAX_GENERATIONS)), GUILD_SUPPLIER_CAMPAIGN_MAX_GENERATIONS);
assert.equal(campaignGenerationFromIdempotencyKey("supplier-campaign:guild-procurement:obsolete"), null);
assert.equal(guildSupplierResearchCampaignScopeExpired(new Date("2026-08-12T12:00:00.000Z")), false);
assert.equal(guildSupplierResearchCampaignScopeExpired(new Date("2026-10-01T00:00:00.000Z")), true);

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
  createdAt?: string;
}) {
  const input = guildSupplierResearchAttemptInput({ line: args.line, campaignId: "campaign-a", attemptNumber: 1 });
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
    provider: "EXA",
    freshnessPolicy: "FORCED_LIVE",
    searchRequestId: `search-${args.id}`,
    contentsRequestId: `contents-${args.id}`,
    searchHttpStatus: 200,
    contentsHttpStatus: 200,
    searchResponseHash: hash(`search-${args.id}`),
    contentsResponseHash: hash(`contents-${args.id}`),
    retrievedAt,
    records,
  } satisfies ExaRetrievalCapture;
  const receipts = validateExaPublicSupplierLeadReceipts(input, retrieval);
  assert.equal(receipts.length, args.domains.length, `test fixture for ${args.line.sku} must pass production receipt validation`);
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
const forgedReceipt = structuredClone(aggregationAttempts[0]) as SupplierResearchCampaignAttempt;
const forgedOutput = forgedReceipt.output as { publicSupplierLeadReceipts: Array<{ receiptHash: string }> };
forgedOutput.publicSupplierLeadReceipts[0].receiptHash = "0".repeat(64);
assert.equal(aggregateGuildSupplierResearchLine(firstLine, [forgedReceipt]).candidates.length, 1, "a forged receipt cannot admit its candidate");

const now = new Date("2026-08-12T12:00:00.000Z");
const initialPlan = planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
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

const everyInitialLine = planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
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
  attempts: [],
  now,
  campaignAttemptsRemaining: 0,
  officeAttemptsRemaining: 72,
}).length, 0, "the daily campaign quota is a hard scheduling cap");

const activePlan = planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
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
  attempts: [accessRevoked],
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
  batchSize: 38,
}).some((work) => work.itemKey === "GUILD-001"), false, "access revocation blocks unattended retry");
assert.equal(planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
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
assert.equal(planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
  attempts: nineAttempts,
  now,
  campaignAttemptsRemaining: 48,
  officeAttemptsRemaining: 72,
  batchSize: 38,
}).some((work) => work.itemKey === "GUILD-001"), false, "a line stops after the bounded nine-attempt search matrix");
const fourthAttempt = guildSupplierResearchAttemptInput({ line: firstLine, campaignId: "campaign-a", attemptNumber: 4, excludeDomains: ["acme.example"] });
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
    campaignAttemptCount: 1,
    campaignTerminalAttemptCount: 1,
    campaignAttemptWatermark: `fixture-${line.sku}`,
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
assert.equal(planGuildSupplierResearchQueue({
  campaignId: "campaign-a",
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
      campaignAttemptCount: 1,
      campaignTerminalAttemptCount: 1,
      campaignAttemptWatermark: "fixture-GUILD-001",
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

assert.match(routeSource, /startOrResumeGuildSupplierResearchCampaign/);
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
assert.match(persistenceSource, /clock_timestamp\(\)/, "the hard daily spend bound derives its UTC day after acquiring the office-stable lock");
assert.match(persistenceSource, /reconciliationToken/);
assert.match(campaignSource, /FOR UPDATE/);
assert.match(campaignSource, /campaignAttemptWatermark/);
assert.match(campaignSource, /status !== "RUNNING" \|\| !hasReconciliationLease/);
assert.match(persistenceSource, /startedAt: \{ gte: dayStart \}/);
assert.match(persistenceSource, /if \(callsStartedToday >= OFFICE_DAILY_PROVIDER_CALL_CAP\) continue/);
assert.match(campaignSource, /idempotencyKey: `guild:\$\{args\.campaign\.id\}:\$\{work\.itemKey\}:attempt:\$\{work\.attemptNumber\}`/);
assert.match(cronSource, /advanceSupplierResearchCampaigns/);
assert.doesNotMatch([campaignSource, routeSource, cronSource, guildSource].join("\n"), /\u2014/);

console.log("Supply OS continuous supplier sourcing checks passed.");
