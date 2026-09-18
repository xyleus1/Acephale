import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { hash } from "../src/lib/goalspec/canonical";
import { createDeryaChatRuntime } from "../src/lib/goalspec-adapters/derya-chat";
import { configureDeryaGoalSpec, type DeryaBusinessSnapshot, validateBusinessSnapshot } from "../src/lib/goalspec-adapters/derya-bootstrap";
import type { ControllerArtifact } from "../src/lib/goalspec/controller";
import { CONTROLLER_FEATURE_DIMENSION, CONTROLLER_FEATURE_VERSION } from "../src/lib/goalspec/controller-features";

// Deliberately synthetic controller for exercising DB validation and exact-call
// promotion. These weights and exposure labels are never a deployment artifact.
function databaseTestController(): ControllerArtifact {
  const body = { version: "goalspec-controller-artifact-v1", featureVersion: CONTROLLER_FEATURE_VERSION,
    goalFeaturePolicy: "public-request-only", inputDimension: CONTROLLER_FEATURE_DIMENSION, architecture: "logistic",
    layers: [{ weights: Array.from({ length: 5 }, () => Array(CONTROLLER_FEATURE_DIMENSION).fill(0)), bias: [3, 3, 3, 3, 3], activation: "linear" }],
    heads: ["actionRead", "nextAction", "usefulWithin2", "readiness", "exposure"],
    trainedHeads: { actionRead: true, nextAction: true, usefulWithin2: true, readiness: true, exposure: true },
    calibration: { temperature: [1, 1, 1, 1, 1], bias: [0, 0, 0, 0, 0], method: "family-heldout-temperature-grid" },
    thresholds: { actionRead: .5, usefulWithin2: .5, readiness: .5, exposure: .5 },
    lineage: { datasetHash: "a".repeat(64), trainFamilies: ["mock:train"], selectionFamilies: ["mock:selection"], calibrationFamilies: ["mock:calibration"],
      baseOnly: true, seed: 1, selectedCheckpoint: "database-test-only", soupMembers: [], randomizedExposureDataHash: "b".repeat(64),
      labelSemantics: "next-action-imitation;within-two-observed-use;readiness-is-not-authorization;exposure-masked" } };
  return { ...body, contentHash: hash(body) } as ControllerArtifact;
}
import type { Scope } from "../src/lib/goalspec/contracts/generated";

test("business bootstrap rejects research lineage and foreign tenant before retrieval", () => {
  const scope: Scope = { tenantId: "office", principalId: "operator", authorizationVersion: "current", environmentVersion: "derya", toolSchemaHash: "schema" };
  const valid: DeryaBusinessSnapshot = { schemaVersion: 1, purpose: "derya_business", source: "derya_native_verified", snapshotId: "local-business", tenantId: "office", records: [], recordsHash: hash([]) };
  assert.equal(validateBusinessSnapshot(valid, scope).snapshotId, "local-business");
  assert.throws(() => validateBusinessSnapshot({ ...valid, source: "APIGen" } as unknown as DeryaBusinessSnapshot, scope), /Unverified/);
  assert.throws(() => validateBusinessSnapshot({ ...valid, tenantId: "foreign" }, scope), /foreign/);
  assert.throws(() => validateBusinessSnapshot({ ...valid, recordsHash: "tampered" }, scope), /Unverified/);
});

const url = process.env.GOALSPEC_TEST_DATABASE_URL;
test("configured generic chat predicts asynchronously, then promotes current business reads and rejects revoked access", { skip: !url, timeout: 30_000 }, async () => {
  if (new URL(url!).hostname !== "127.0.0.1" || !new URL(url!).pathname.startsWith("/goalspec_")) throw new Error("Disposable loopback goalspec_ database required");
  const writer = new PrismaClient({ datasources: { db: { url } } });
  const suffix = randomUUID();
  const office = await writer.office.create({ data: { name: `Bootstrap ${suffix}` } });
  const user = await writer.user.create({ data: { officeId: office.id, email: `${suffix}@example.test`, passwordHash: "unused-fixture", fullName: "Bootstrap operator", canViewWholeOffice: true } });
  let calls = 0;
  const events: Record<string, unknown>[] = [];
  const eventListeners = new Set<() => void>();
  let releasePrediction!: () => void;
  const predictionGate = new Promise<void>(resolve => { releasePrediction = resolve; });
  const waitForEvent = (type: string) => new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (!events.some(event => event.type === type)) return;
      clearTimeout(timer); eventListeners.delete(finish); resolve();
    };
    const timer = setTimeout(() => { eventListeners.delete(finish); reject(new Error(`Missing recorded ${type}`)); }, 10_000);
    eventListeners.add(finish); finish();
  });
  const bootstrap = configureDeryaGoalSpec({
    controllerArtifact: databaseTestController(),
    utilityEstimate: { toolMs: 100, validationMs: 1, schedulingMs: 1, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 },
    databaseUrl: url!, environmentVersion: "fixture-derya", tools: { search_jobs: { type: "object", properties: {}, additionalProperties: false } },
    allocation: "development", maximumPredictionAttemptMicrodollars: 1000,
    record: event => { events.push(event); for (const listener of eventListeners) listener(); },
    embed: async () => Array.from({ length: 1536 }, (_, i) => i === 0 ? 1 : 0),
    model: { complete: async request => {
      calls++;
      assert.equal(request.model, "gpt-4.1-mini-2025-04-14");
      assert.equal(request.responseFormat?.strict, true);
      await predictionGate;
      return { model: request.model, continuation: [], calls: [], text: JSON.stringify({ set_active_goals: [], unknownWeight: 1, factDeltas: [] }), status: "completed", refusals: [], usage: undefined };
    } },
    snapshot: async scope => {
      const records = [{ id: "business-pattern", familyId: "office-search", text: "Search authorized office jobs", embedding: Array.from({ length: 1536 }, (_, i) => i === 0 ? 1 : 0), split: "train" as const,
        pattern: { schemaVersion: 1 as const, id: "business-pattern", scope, snapshotId: "business-fixture", verificationTier: "native_verified" as const, prefix: [] as [], tool: "search_jobs",
          binding: { language_version: 1, examples: 2, total_examples: 2, expression: { kind: "object", fields: {} } },
          dataDependencies: [], policyPrerequisites: [], observedOrdering: [], branches: [], successes: 2, failures: 0 } }];
      return { schemaVersion: 1, purpose: "derya_business", source: "derya_native_verified", snapshotId: "business-fixture", tenantId: scope.tenantId, records, recordsHash: hash(records) };
    },
  });
  const identity = { userId: user.id, officeId: office.id, canViewWholeOffice: true, accessKind: "operator" };
  let runtime: Awaited<ReturnType<typeof createDeryaChatRuntime>>;
  try {
    assert.equal(await createDeryaChatRuntime({ ...identity, accessKind: "customer" }, "jobs", "policy"), undefined);
    assert.equal(await createDeryaChatRuntime({ ...identity, accessKind: undefined }, "jobs", "policy"), undefined);
    runtime = await createDeryaChatRuntime(identity, "Show jobs", "Only authorized office jobs");
    assert(runtime);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const first = await Promise.race([runtime.boundary(), new Promise<never>((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Actor boundary waited for the gated background prediction")), 10_000);
    })]).finally(() => clearTimeout(deadline));
    assert(first.includes("goalspec-goal-state-v4"));
    assert(!first.includes("[HISTORICAL WORKFLOW EXAMPLES]"));
    assert(events.some(event => event.type === "prediction_cycle_started"));
    assert(!events.some(event => event.type === "prediction_cycle_completed"));
    releasePrediction();
    await Promise.all([waitForEvent("prediction_cycle_completed"), waitForEvent("started"), waitForEvent("ready")]);
    assert(!events.some(event => event.type === "prediction_cycle_failed"));
    const next = await runtime.boundary();
    assert(!next.includes("[HISTORICAL WORKFLOW EXAMPLES]"));
    assert(next.includes("[VERIFIED PREFETCHED EVIDENCE]"));
    let authoritativeFallback = false;
    const observation = await runtime.batch([{ id: "real-call-1", name: "search_jobs", input: {} }], async () => { authoritativeFallback = true; return { ok: true, result: [] }; });
    assert.equal(authoritativeFallback, false);
    assert.deepEqual(observation, [{ ok: true, result: [] }]);
    assert(events.some(event => event.type === "promotion_requested"));
    assert(events.some(event => event.type === "useful"));
    assert(events.some(e => e.type === "speculative_transaction"));
    assert(events.some(e => e.type === "validation_transaction"));
    assert(events.filter(e => e.type === "physical_sql_query").length > 6);
    await writer.user.update({ where: { id: user.id }, data: { canViewWholeOffice: false } });
    await assert.rejects(() => runtime!.boundary(), /authorization changed/);
    assert.equal(await createDeryaChatRuntime(identity, "jobs", "policy"), undefined);
    assert.equal(calls, 1);
  } finally {
    releasePrediction();
    await runtime?.close();
    await bootstrap.close();
    assert.equal(await createDeryaChatRuntime(identity, "jobs", "policy"), undefined);
    await writer.office.delete({ where: { id: office.id } });
    await writer.$disconnect();
  }
});
