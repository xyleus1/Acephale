import assert from "node:assert/strict";
import {
  executeSupplierResearchRoute,
  parseSupplierResearchRouteBody,
  type SupplierResearchRouteDependencies,
  type SupplierResearchRouteInput,
} from "../src/lib/supply-os/supplier-research-route-contract";

const context = {
  officeId: "office-a",
  userId: "user-a",
  role: "ADMIN",
  canViewWholeOffice: true,
};

const completeBody = {
  componentItemKey: "item-001",
  componentName: "6061-T6 aluminum sheet",
  specification: "6061-T6 aluminum sheet, 2.0 mm mill finish",
  requestedQuantity: 4,
  requestedUnit: "blanks",
  deliveryLocation: "Long Beach, CA",
  needByDate: "2026-09-15",
  sourceRegion: "North America",
  requestText: "Source four 6061-T6 aluminum sheet blanks",
  workspaceId: "workspace-a",
};

assert.deepEqual(
  parseSupplierResearchRouteBody(null),
  { ok: false, response: { status: 400, body: { error: "A valid component request is required." } } },
  "a malformed JSON body must fail before persistence or provider work",
);

const incomplete = parseSupplierResearchRouteBody({
  componentItemKey: "item-001",
  componentName: "6061-T6 aluminum sheet",
});
assert.equal(incomplete.ok, false);
if (!incomplete.ok) {
  assert.equal(incomplete.response.status, 400);
  assert.deepEqual(incomplete.response.body.missingFields, [
    "quantity",
    "unit",
    "technicalIdentity",
    "deliveryLocation",
    "needByDate",
  ]);
}

assert.equal(
  parseSupplierResearchRouteBody({ ...completeBody, componentName: "x".repeat(241) }).ok,
  false,
  "oversized request fields must fail at the route boundary",
);
assert.equal(
  parseSupplierResearchRouteBody({ ...completeBody, requestedQuantity: 0 }).ok,
  false,
  "zero quantity must not enter research",
);
assert.equal(
  parseSupplierResearchRouteBody({ ...completeBody, needByDate: "2026-02-30" }).ok,
  false,
  "an impossible delivery date must remain incomplete",
);

type Calls = {
  starts: Array<{ input: SupplierResearchRouteInput; workspaceId: string | undefined }>;
  searches: SupplierResearchRouteInput[];
  failed: Array<{ runId: string; workspaceId: string; message: string }>;
  completed: Array<{ runId: string; workspaceId: string; output: unknown }>;
};

function dependencies(overrides: Partial<SupplierResearchRouteDependencies> = {}) {
  const calls: Calls = { starts: [], searches: [], failed: [], completed: [] };
  let runNumber = 0;
  const value: SupplierResearchRouteDependencies = {
    consumeRateLimit: (key) => {
      assert.equal(key, "office-a:user-a");
      return true;
    },
    startRun: async (_context, input, workspaceId) => {
      runNumber += 1;
      calls.starts.push({ input, workspaceId });
      return { id: `run-${runNumber}`, workspaceId: workspaceId ?? "resolved-workspace" };
    },
    search: async (input) => {
      calls.searches.push(input);
      return {
        candidates: [{ id: "candidate-1", companyName: "supplier.example" }],
        sources: [{ url: "https://supplier.example/item-001", sourceType: "PUBLIC" }],
        degraded: false,
        warnings: [],
      };
    },
    supplierFailure: () => ({ code: "PROVIDER_TIMEOUT", message: "Public supplier research timed out.", status: 504 }),
    failRun: async (args) => {
      calls.failed.push({ runId: args.runId, workspaceId: args.workspaceId, message: args.message });
    },
    completeRun: async (args) => {
      calls.completed.push({ runId: args.runId, workspaceId: args.workspaceId, output: args.output });
      return { id: args.runId, workspaceId: args.workspaceId, status: "SUCCEEDED", output: args.output };
    },
    intelligenceProfile: async (_context, workspaceId) => ({ customer: { workspaceId }, supplierCount: 1, suppliers: [] }),
    persistenceFailure: (error) => ({
      status: 409,
      body: { error: error instanceof Error ? error.message : "Persistence failed" },
    }),
    ...overrides,
  };
  return { calls, value };
}

async function main() {
  const successFixture = dependencies();
  const success = await executeSupplierResearchRoute({
    body: completeBody,
    context,
    dependencies: successFixture.value,
  });
  assert.equal(success.status, 200);
  assert.equal(success.headers?.["cache-control"], "no-store");
  assert.equal(successFixture.calls.starts.length, 1);
  assert.equal(successFixture.calls.starts[0]?.workspaceId, "workspace-a");
  assert.equal(successFixture.calls.searches[0]?.officeId, "office-a");
  assert.equal(successFixture.calls.searches[0]?.workspaceId, "workspace-a");
  assert.equal(successFixture.calls.completed[0]?.runId, "run-1");
  assert.equal((success.body.run as { status?: string }).status, "SUCCEEDED");
  assert.equal((success.body.intelligenceProfile as { supplierCount?: number }).supplierCount, 1);

  const degradedDiscoveryFixture = dependencies({
    search: async () => ({
      candidates: [{ id: "candidate-1", companyName: "supplier.example", status: "UNSUPPORTED" }],
      sources: [{ url: "https://supplier.example/item-001", sourceType: "PUBLIC" }],
      degraded: true,
      warnings: ["Live page verification timed out. Public supplier pages from discovery were retained."],
      retrieval: { stage: "SEARCH_ONLY", failureCode: "PROVIDER_TIMEOUT" },
      publicListingReceipts: [],
    }),
  });
  const degradedDiscovery = await executeSupplierResearchRoute({
    body: completeBody,
    context,
    dependencies: degradedDiscoveryFixture.value,
  });
  assert.equal(degradedDiscovery.status, 200, "attributable search discovery must survive a later enrichment timeout");
  assert.equal((degradedDiscovery.body.result as { degraded?: boolean }).degraded, true);
  assert.equal((degradedDiscovery.body.run as { status?: string }).status, "SUCCEEDED", "degraded discovery is a saved partial result, not a completed evidence result");
  assert.equal(degradedDiscoveryFixture.calls.completed.length, 1);
  assert.equal(degradedDiscoveryFixture.calls.failed.length, 0);

  const intelligenceFailure = dependencies({
    intelligenceProfile: async () => {
      throw new Error("profile read failed");
    },
  });
  const withoutIntelligence = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: intelligenceFailure.value });
  assert.equal(withoutIntelligence.status, 200);
  assert.equal(withoutIntelligence.body.intelligenceProfile, null, "profile projection failure must not rewrite a completed run as failed");

  const rateLimited = dependencies({ consumeRateLimit: () => false });
  const limited = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: rateLimited.value });
  assert.equal(limited.status, 429);
  assert.equal(rateLimited.calls.starts.length, 0, "rate limiting must happen before a run is created");

  const providerFailure = dependencies({
    search: async () => {
      throw new Error("upstream secret details");
    },
  });
  const failed = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: providerFailure.value });
  assert.deepEqual(failed.body, { error: "Public supplier research timed out.", code: "PROVIDER_TIMEOUT" });
  assert.equal(failed.status, 504);
  assert.deepEqual(providerFailure.calls.failed, [{
    runId: "run-1",
    workspaceId: "workspace-a",
    message: "PROVIDER_TIMEOUT: Public supplier research timed out.",
  }]);
  assert.equal(providerFailure.calls.completed.length, 0, "a failed provider call must never become a successful saved run");

  const failurePersistence = dependencies({
    search: async () => {
      throw new Error("provider failed");
    },
    failRun: async () => {
      throw new Error("terminal write failed");
    },
  });
  const failedWrite = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: failurePersistence.value });
  assert.deepEqual(failedWrite, { status: 409, body: { error: "terminal write failed" } });

  const startFailure = dependencies({
    startRun: async () => {
      throw new Error("workspace mismatch");
    },
  });
  const startRejected = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: startFailure.value });
  assert.deepEqual(startRejected, { status: 409, body: { error: "workspace mismatch" } });

  const completionFailure = dependencies({
    completeRun: async () => {
      throw new Error("completion conflict");
    },
  });
  const completionRejected = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: completionFailure.value });
  assert.deepEqual(completionRejected, { status: 409, body: { error: "completion conflict" } });

  const retryFixture = dependencies();
  const first = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: retryFixture.value });
  const retry = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: retryFixture.value });
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.deepEqual(retryFixture.calls.starts.map((call) => call.input), [
    retryFixture.calls.starts[0]?.input,
    retryFixture.calls.starts[0]?.input,
  ], "retry must preserve the normalized request instead of returning to intake");
  assert.deepEqual(retryFixture.calls.completed.map((call) => call.runId), ["run-1", "run-2"], "retry must create a fresh persisted run");

  console.log("Supply OS supplier research route lifecycle checks passed.");
}

void main();
