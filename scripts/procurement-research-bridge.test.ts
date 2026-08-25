import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  enqueueProcurementResearch,
  isProcurementResearchOrder,
  ProcurementResearchAccessError,
  procurementOfficeCustomerMappings,
  procurementOrderResearchTask,
} from "../src/lib/procurement-research-bridge";
import { parseProcurementResearchMode } from "../src/lib/procurement-research-mode";
import { projectProcurementResearchShortlist } from "../src/lib/procurement-research-shortlist";
import { procurementResearchShortlistResponse } from "../src/lib/procurement-research-shortlist-route";
import { GET as procurementResearchCron } from "../src/app/api/cron/procurement-research/route";
import { sharedSecretMatches } from "../src/lib/procurement-research-security";
import { SupplyResearchIdempotencyConflictError } from "../src/lib/supply-os/persistence";

async function main() {
assert.equal(parseProcurementResearchMode(undefined), "bourne");
assert.equal(parseProcurementResearchMode("unknown"), "bourne");
assert.equal(parseProcurementResearchMode("derya"), "derya");

const row = {
  id: "order-1",
  requestContext: {
    source: { workspace_id: "workspace-1" },
    logistics: { destination: "Long Beach, California", target_country: "US" },
    procurement_context: {
      request: { material: "Aluminum bracket", specification: "6061-T6" },
    },
  },
  notes: "Need a production-ready bracket.",
  quantity: "12",
  unit: "EA",
  neededBy: "2026-09-01",
};
assert.deepEqual(procurementOrderResearchTask(row), {
  componentItemKey: "procurement-order:order-1",
  componentName: "Aluminum bracket",
  specification: "6061-T6",
  requestedQuantity: 12,
  requestedUnit: "EA",
  needByDate: "2026-09-01",
  deliveryLocation: "Long Beach, California",
  targetCountry: "US",
});
const garbage = procurementOrderResearchTask({
  id: "order-2",
  requestContext: "not-json",
  notes: null,
  quantity: null,
  unit: null,
  neededBy: null,
});
assert.equal(garbage.componentItemKey, "procurement-order:order-2");
assert.equal(garbage.componentName, null);
assert.equal(garbage.deliveryLocation, null);

let enqueueCalls = 0;
const mockedDependencies = {
  resolveAccess: async () => ({
    officeId: "office-1",
    userId: "user-1",
    role: "ADMIN",
    canViewWholeOffice: true,
  }),
  listRuns: async () => enqueueCalls ? [{
    id: "run-1",
    workspaceId: "workspace-1",
    status: "QUEUED",
    input: { componentItemKey: "procurement-order:order-1" },
    output: null,
    error: null,
    startedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    failedAt: null,
  }] : [],
  enqueueRun: async () => {
    enqueueCalls += 1;
    return {
      reused: false,
      run: {
        id: "run-1",
        workspaceId: "workspace-1",
        status: "QUEUED",
        input: {},
        output: null,
        error: null,
        startedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        failedAt: null,
      },
    };
  },
};
const first = await enqueueProcurementResearch({ officeId: "office-1", order: row }, mockedDependencies);
const second = await enqueueProcurementResearch({ officeId: "office-1", order: row }, mockedDependencies);
assert.equal(first.state, "enqueued");
assert.equal(second.state, "reused");
assert.equal(enqueueCalls, 1);
let cappedInput: Record<string, unknown> | undefined;
const capped = await enqueueProcurementResearch({
  officeId: "office-1",
  order: {
    ...row,
    requestContext: {
      source: { workspace_id: "workspace-1" },
      logistics: { destination: "Long Beach, California", target_country: "US" },
      procurement_context: {
        request: {
          material: "A".repeat(300),
          specification: "6061-T6",
        },
      },
    },
    notes: "N".repeat(600),
    unit: "U".repeat(60),
  },
}, {
  ...mockedDependencies,
  listRuns: async () => [],
  enqueueRun: async (args) => {
    cappedInput = args.input as Record<string, unknown>;
    return {
      reused: false,
      run: {
        id: "run-capped",
        workspaceId: "workspace-1",
        status: "QUEUED",
        input: args.input,
        output: null,
        error: null,
        startedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        failedAt: null,
      },
    };
  },
});
assert.equal(capped.state, "enqueued");
assert.equal((cappedInput?.componentName as string).length, 240);
assert.equal((cappedInput?.requestText as string).length, 500);
assert.equal((cappedInput?.requestedUnit as string).length, 40);
const incomplete = await enqueueProcurementResearch({
  officeId: "office-1",
  order: {
    ...row,
    requestContext: {
      source: { workspace_id: "workspace-1" },
      procurement_context: { request: { material: "Aluminum bracket", specification: "6061-T6" } },
    },
    neededBy: null,
  },
}, {
  ...mockedDependencies,
  listRuns: async () => [],
  enqueueRun: async () => {
    throw new Error("incomplete requests must not enqueue");
  },
});
assert.equal(incomplete.state, "skipped");
if (incomplete.state === "skipped") {
  assert.equal(incomplete.reason, "incomplete_request");
  assert.deepEqual(incomplete.missingFields, ["deliveryLocation", "needByDate"]);
}
const conflictReuse = await enqueueProcurementResearch({ officeId: "office-1", order: row }, {
  ...mockedDependencies,
  enqueueRun: async () => {
    throw new SupplyResearchIdempotencyConflictError("procurement-order:order-1");
  },
});
assert.equal(conflictReuse.state, "reused");
assert.equal(new ProcurementResearchAccessError("office-1").code, "missing_admin");
assert.equal(isProcurementResearchOrder({ supplierCount: 0, status: "researching" }), true);
assert.equal(isProcurementResearchOrder({ supplierCount: 1, status: "new" }), false);
assert.equal(isProcurementResearchOrder({ supplierCount: 0, status: "ordered" }), false);

const publicSource = { url: "https://catalog.example/items", sourceType: "PUBLIC" as const };
const unknownEnvelope = {
  value: 42,
  state: "UNKNOWN" as const,
  confidence: 0.8,
  sources: [publicSource],
  observedAt: "2026-08-24T00:00:00.000Z",
  freshness: "FRESH" as const,
};
const result = projectProcurementResearchShortlist(
  procurementOrderResearchTask(row),
  {
    candidates: [{
      id: "internal-id",
      officeId: "office-1",
      workspaceId: "workspace-1",
      componentItemKey: "procurement-order:order-1",
      companyName: "Example Supplier",
      website: null,
      roles: ["DISTRIBUTOR"],
      country: unknownEnvelope,
      facility: unknownEnvelope,
      productCapability: unknownEnvelope,
      price: unknownEnvelope,
      currency: unknownEnvelope,
      unitOfMeasure: unknownEnvelope,
      minimumOrderQuantity: unknownEnvelope,
      leadTimeDays: unknownEnvelope,
      sourceUrls: [publicSource.url],
      status: "UNSUPPORTED",
      approvedByUserId: null,
      approvedAt: null,
      cautions: [],
    }],
    sources: [publicSource],
    degraded: false,
    warnings: [],
  },
);
assert.equal(result.candidates[0]?.commercialTerms.price.value, null);
assert.equal(result.candidates[0]?.commercialTerms.price.state, "UNKNOWN");
assert.equal(result.candidates[0]?.evidence[0]?.sourceType, "PUBLIC");
assert.equal("id" in result.candidates[0]!, false);
assert.equal("componentItemKey" in result.request, false);
assert.equal(result.candidates[0]?.rfqDraft.status, "DRAFT_ONLY");
assert.equal(result.candidates[0]?.rfqDraft.no_send, true);
assert.doesNotMatch(result.candidates[0]?.rfqDraft.body ?? "", /\u2014/);
assert.match(result.candidates[0]?.rfqDraft.body ?? "", /not a purchase commitment/i);

assert.equal(sharedSecretMatches("secret", "secret"), true);
assert.equal(sharedSecretMatches("wrong", "secret"), false);
assert.equal(sharedSecretMatches("secret-long", "secret"), false);
process.env.PROCUREMENT_RESEARCH_SHARED_SECRET = "test-secret";
process.env.CRON_SECRET = "cron-secret";
process.env.PROCUREMENT_RESEARCH_MODE = "bourne";
const cronResponse = await procurementResearchCron(new Request("http://localhost/api/cron/procurement-research", {
  headers: { Authorization: "Bearer cron-secret" },
}));
assert.equal(cronResponse.status, 200);
const disabledResponse = await procurementResearchShortlistResponse(
  new Request("http://localhost/api/procurement/research-shortlist/order"),
  "00000000-0000-4000-8000-000000000001",
  {
    mode: () => "bourne",
    mappings: () => [],
    getOrder: async () => null,
    resolveAccess: async () => {
      throw new Error("disabled route must not resolve access");
    },
    findRun: async () => null,
  } as never,
);
assert.equal(disabledResponse.status, 503);
const unmappedResponse = await procurementResearchShortlistResponse(
  new Request("http://localhost/api/procurement/research-shortlist/order", {
    headers: { Authorization: "Bearer test-secret" },
  }),
  "00000000-0000-4000-8000-000000000001",
  {
    mode: () => "derya",
    mappings: () => [{ officeId: "office-1", customerId: "00000000-0000-0000-0000-000000000001" }],
    getOrder: async () => null,
    resolveAccess: async () => {
      throw new Error("unmapped order must not resolve access");
    },
    findRun: async () => null,
  } as never,
);
assert.equal(unmappedResponse.status, 404);
const completedRunMissingResponse = await procurementResearchShortlistResponse(
  new Request("http://localhost/api/procurement/research-shortlist/order", {
    headers: { Authorization: "Bearer test-secret" },
  }),
  "00000000-0000-4000-8000-000000000001",
  {
    mode: () => "derya",
    mappings: () => [{ officeId: "office-1", customerId: "00000000-0000-0000-0000-000000000001" }],
    getOrder: async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      status: "new",
      progress: null,
      neededBy: null,
      quantity: null,
      unit: null,
      material: "Aluminum bracket",
      specification: null,
      requestContext: { source: { workspace_id: "workspace-1" } },
      approvalRequestedAt: null,
      decisionSnapshot: null,
      vendors: [],
      updatedAt: new Date(0).toISOString(),
    }),
    resolveAccess: async () => ({
      officeId: "office-1",
      userId: "user-1",
      role: "ADMIN",
      canViewWholeOffice: true,
    }),
    findRun: async () => null,
  } as never,
);
assert.equal(completedRunMissingResponse.status, 404);
const malformedOutputResponse = await procurementResearchShortlistResponse(
  new Request("http://localhost/api/procurement/research-shortlist/order", {
    headers: { Authorization: "Bearer test-secret" },
  }),
  "00000000-0000-4000-8000-000000000001",
  {
    mode: () => "derya",
    mappings: () => [{ officeId: "office-1", customerId: "00000000-0000-0000-0000-000000000001" }],
    getOrder: async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      status: "new",
      progress: null,
      neededBy: "2026-09-01",
      quantity: 1,
      unit: "EA",
      material: "Aluminum bracket",
      specification: "6061-T6",
      requestContext: { source: { workspace_id: "workspace-1" } },
      approvalRequestedAt: null,
      decisionSnapshot: null,
      vendors: [],
      updatedAt: new Date(0).toISOString(),
    }),
    resolveAccess: async () => ({
      officeId: "office-1",
      userId: "user-1",
      role: "ADMIN",
      canViewWholeOffice: true,
    }),
    findRun: async () => ({
      id: "run-1",
      workspaceId: "workspace-1",
      status: "SUCCEEDED",
      input: { componentItemKey: "procurement-order:00000000-0000-4000-8000-000000000001" },
      output: { candidates: [{}] },
      error: null,
      startedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
      failedAt: null,
    }),
  } as never,
);
assert.equal(malformedOutputResponse.status, 404);
const oldCompletedRunResponse = await procurementResearchShortlistResponse(
  new Request("http://localhost/api/procurement/research-shortlist/order", {
    headers: { Authorization: "Bearer test-secret" },
  }),
  "00000000-0000-4000-8000-000000000001",
  {
    mode: () => "derya",
    mappings: () => [{ officeId: "office-1", customerId: "00000000-0000-0000-0000-000000000001" }],
    getOrder: async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      status: "new",
      progress: null,
      neededBy: "2026-09-01",
      quantity: 1,
      unit: "EA",
      material: "Aluminum bracket",
      specification: "6061-T6",
      requestContext: { source: { workspace_id: "workspace-1" } },
      approvalRequestedAt: null,
      decisionSnapshot: null,
      vendors: [],
      updatedAt: new Date(0).toISOString(),
    }),
    resolveAccess: async () => ({
      officeId: "office-1",
      userId: "user-1",
      role: "ADMIN",
      canViewWholeOffice: true,
    }),
    findRun: async () => ({
      id: "old-run",
      workspaceId: "workspace-1",
      status: "SUCCEEDED",
      input: { componentItemKey: "procurement-order:00000000-0000-4000-8000-000000000001" },
      output: {
        candidates: [{
          companyName: "Older Supplier",
          website: null,
          roles: [],
          sourceUrls: [],
          price: unknownEnvelope,
          currency: unknownEnvelope,
          minimumOrderQuantity: unknownEnvelope,
          leadTimeDays: unknownEnvelope,
        }],
        sources: [],
        warnings: [],
      },
      error: null,
      startedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      completedAt: new Date(0),
      failedAt: null,
    }),
  } as never,
);
assert.equal(oldCompletedRunResponse.status, 200);
assert.equal((await oldCompletedRunResponse.json()).candidates[0]?.companyName, "Older Supplier");
const unauthorizedResponse = await procurementResearchShortlistResponse(
  new Request("http://localhost/api/procurement/research-shortlist/order", {
    headers: { Authorization: "Bearer wrong-secret" },
  }),
  "00000000-0000-4000-8000-000000000001",
  {
    mode: () => "derya",
    mappings: () => [],
    getOrder: async () => null,
    resolveAccess: async () => {
      throw new Error("unauthorized route must not resolve access");
    },
    findRun: async () => null,
  } as never,
);
assert.equal(unauthorizedResponse.status, 401);
assert.deepEqual(
  procurementOfficeCustomerMappings(JSON.stringify({ "office-1": "00000000-0000-0000-0000-000000000001" })),
  [{ officeId: "office-1", customerId: "00000000-0000-0000-0000-000000000001" }],
);

const cronRoute = readFileSync(resolve(process.cwd(), "src/app/api/cron/procurement-research/route.ts"), "utf8");
const shortlistRoute = readFileSync(resolve(process.cwd(), "src/app/api/procurement/research-shortlist/[orderId]/route.ts"), "utf8");
const shortlistRouteSource = readFileSync(resolve(process.cwd(), "src/lib/procurement-research-shortlist-route.ts"), "utf8");
const securitySource = readFileSync(resolve(process.cwd(), "src/lib/procurement-research-security.ts"), "utf8");
const workflowSource = readFileSync(resolve(process.cwd(), "src/lib/procurement-workflow.ts"), "utf8");
assert.match(cronRoute, /CRON_SECRET/);
assert.match(cronRoute, /mode: "bourne"/);
assert.match(shortlistRouteSource, /authorization/);
assert.match(securitySource, /timingSafeEqual/);
const persistenceSource = readFileSync(resolve(process.cwd(), "src/lib/supply-os/sourcing-research-persistence.ts"), "utf8");
assert.match(persistenceSource, /findSucceededSourcingResearchRunByComponentItemKey/);
assert.match(persistenceSource, /status: "SUCCEEDED"/);
assert.match(persistenceSource, /path: \["componentItemKey"\]/);
assert.doesNotMatch(shortlistRoute, /customerId.*searchParams/);
assert.match(workflowSource, /enqueueProcurementResearchForSubmission/);
assert.match(workflowSource, /deryaResearchEnqueueRequested/);

console.log("Procurement research bridge checks passed.");
}

void main();
