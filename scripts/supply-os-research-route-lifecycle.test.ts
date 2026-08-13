import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  executeSupplierResearchRoute,
  parseSupplierResearchRouteBody,
  type SupplierResearchRouteDependencies,
  type SupplierResearchRouteInput,
} from "../src/lib/supply-os/supplier-research-route-contract";

const root = process.cwd();
const routeSource = readFileSync(resolve(root, "src/app/api/supply-os/supplier-research/route.ts"), "utf8");
const cronSource = readFileSync(resolve(root, "src/app/api/cron/supplier-research/route.ts"), "utf8");
const persistenceSource = readFileSync(resolve(root, "src/lib/supply-os/sourcing-research-persistence.ts"), "utf8");
const exactReadSource = persistenceSource.slice(
  persistenceSource.indexOf("export async function getSourcingResearchRun"),
  persistenceSource.indexOf("export type QueuedSourcingResearchRunReference"),
);
const pageReadSource = persistenceSource.slice(
  persistenceSource.indexOf("export async function listSourcingResearchPage"),
  persistenceSource.indexOf("export async function listSourcingResearchRuns"),
);

assert.match(routeSource, /rawRunId[\s\S]*getSourcingResearchRun/, "GET must poll one tenant-scoped run by runId");
assert.match(routeSource, /rawIncludeRunIds[\s\S]*rawIncludeRunIds\.length > 40[\s\S]*listProcurementCasesForResearchRuns/, "GET must support a bounded workspace-scoped aggregate case lookup");
assert.match(routeSource, /after\([\s\S]*runSourcingResearchWorker/, "POST must start the worker after sending its response");
assert.match(cronSource, /process\.env\.CRON_SECRET/);
assert.match(cronSource, /runQueuedSourcingResearchWorkers\(\{ limit: 2 \}\)/, "cron concurrency must stay capped at two");
assert.doesNotMatch(exactReadSource, /update|markAbandonedResearchFailed/, "exact polling must remain a read-only workspace view");
assert.doesNotMatch(pageReadSource, /\.update|markAbandonedResearchFailed/, "queue reads must not mutate stale runs under view access");
assert.match(persistenceSource, /failStaleRunningSourcingResearchRuns[\s\S]*status: "RUNNING"/);
assert.match(persistenceSource, /status: "QUEUED"[\s\S]*status: "RUNNING"/, "worker claim must compare and transition queue state atomically");

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
  "a malformed JSON body must fail before persistence work",
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

assert.equal(parseSupplierResearchRouteBody({ ...completeBody, componentName: "x".repeat(241) }).ok, false);
assert.equal(parseSupplierResearchRouteBody({ ...completeBody, requestedQuantity: 0 }).ok, false);
assert.equal(parseSupplierResearchRouteBody({ ...completeBody, needByDate: "2026-02-30" }).ok, false);

type EnqueueCall = {
  input: SupplierResearchRouteInput;
  workspaceId: string | undefined;
};

function dependencies(overrides: Partial<SupplierResearchRouteDependencies> = {}) {
  const calls: EnqueueCall[] = [];
  let runNumber = 0;
  const value: SupplierResearchRouteDependencies = {
    consumeRateLimit: (key) => {
      assert.equal(key, "office-a:user-a");
      return true;
    },
    enqueueRun: async ({ input, workspaceId }) => {
      runNumber += 1;
      calls.push({ input, workspaceId });
      return {
        run: { id: `run-${runNumber}`, workspaceId: workspaceId ?? "resolved-workspace", status: "QUEUED" },
        reused: false,
      };
    },
    persistenceFailure: (error) => ({
      status: 409,
      body: { error: error instanceof Error ? error.message : "Persistence failed" },
    }),
    ...overrides,
  };
  return { calls, value };
}

async function main() {
  const queuedFixture = dependencies();
  const queued = await executeSupplierResearchRoute({
    body: completeBody,
    context,
    dependencies: queuedFixture.value,
  });
  assert.equal(queued.status, 202, "POST must return after durable enqueue, not after provider completion");
  assert.equal(queued.headers?.["cache-control"], "no-store");
  assert.equal(queued.headers?.["x-content-type-options"], "nosniff");
  assert.equal(queuedFixture.calls.length, 1);
  assert.equal(queuedFixture.calls[0]?.workspaceId, "workspace-a");
  assert.equal(queuedFixture.calls[0]?.input.componentName, completeBody.componentName);
  assert.deepEqual(queued.body.run, { id: "run-1", workspaceId: "workspace-a", status: "QUEUED" });
  assert.equal(queued.body.reused, false);
  assert.equal(queued.body.pollUrl, "/api/supply-os/supplier-research?runId=run-1&workspaceId=workspace-a");

  const reusedFixture = dependencies({
    enqueueRun: async ({ workspaceId }) => ({
      run: { id: "active-run", workspaceId: workspaceId ?? "resolved-workspace", status: "RUNNING" },
      reused: true,
    }),
  });
  const reused = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: reusedFixture.value });
  assert.equal(reused.status, 202);
  assert.equal(reused.body.reused, true);
  assert.deepEqual(reused.body.run, { id: "active-run", workspaceId: "workspace-a", status: "RUNNING" });

  const rateLimited = dependencies({ consumeRateLimit: () => false });
  const limited = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: rateLimited.value });
  assert.equal(limited.status, 429);
  assert.equal(rateLimited.calls.length, 0, "rate limiting must happen before enqueue");

  const enqueueFailure = dependencies({
    enqueueRun: async () => {
      throw new Error("workspace mismatch");
    },
  });
  const rejected = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: enqueueFailure.value });
  assert.deepEqual(rejected, { status: 409, body: { error: "workspace mismatch" } });

  const retryFixture = dependencies();
  const first = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: retryFixture.value });
  const retry = await executeSupplierResearchRoute({ body: completeBody, context, dependencies: retryFixture.value });
  assert.equal(first.status, 202);
  assert.equal(retry.status, 202);
  assert.deepEqual(retryFixture.calls.map((call) => call.input), [
    retryFixture.calls[0]?.input,
    retryFixture.calls[0]?.input,
  ], "retry must preserve the normalized request");
  assert.deepEqual(
    [first.body.run, retry.body.run].map((run) => (run as { id: string }).id),
    ["run-1", "run-2"],
    "a terminal retry can enqueue a fresh persisted run",
  );

  console.log("Supply OS supplier research route lifecycle checks passed.");
}

void main();
