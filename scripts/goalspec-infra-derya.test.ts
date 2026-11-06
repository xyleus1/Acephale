import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash, copy } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, Json } from "../src/lib/goalspec/contracts/generated";
import type { InfraSessionPolicy } from "../src/lib/goalspec/infra-session";
import { configureDeryaInfra, type DeryaInfraConfiguration } from "../src/lib/goalspec-adapters/derya-infra";
import { createDeryaChatRuntime, type DeryaRuntimeFactory } from "../src/lib/goalspec-adapters/derya-chat";

const identity = { userId: "operator", officeId: "office", accessKind: "operator", canViewWholeOffice: true };
const tools = { search_jobs: { type: "object", properties: {}, additionalProperties: false } };
const candidate = (frame: ExecutionFrame): Candidate => ({ schemaVersion: 1, id: "jobs", invocation: { tool: "search_jobs", arguments: {}, scope: frame.scope }, probability: 1, bindings: [], hop: 1, patternId: null });
const policy = (memoryHash: string): InfraSessionPolicy => ({ arm: "neutral_memory_prefetch", memoryHash, goalReliability: 0,
  opportunity: () => ({ toolMs: 1000, actorLeadMs: 1000, predictionMs: 0, schedulingMs: 0, validationMs: 1, contentionMs: 0 }),
  candidates: frame => [candidate(frame)], validateBinding: () => true,
  rank: async (_frame, candidates) => ({ action: candidates.length ? "READ" : "NO_READ", scores: candidates.map(item => ({ candidateId: item.id, probability: 1 })) }) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup(options: { policy?: (base: InfraSessionPolicy) => InfraSessionPolicy; project?: () => Promise<Json>; snapshot?: DeryaInfraConfiguration["snapshot"] } = {}) {
  let user: { id: string; officeId: string; role: "MEMBER"; canViewWholeOffice: boolean } | null = { id: "operator", officeId: "office", role: "MEMBER", canViewWholeOffice: true };
  let factory!: DeryaRuntimeFactory;
  const events: Record<string, unknown>[] = [];
  const stats = { connections: 0, disconnects: 0, transactions: 0, projections: 0, uninstalled: false };
  let observation: Json = { ok: true, result: [] };
  const tx = { $executeRawUnsafe: async (sql: string) => { assert.equal(sql, "SET TRANSACTION READ ONLY"); },
    user: { findFirst: async (query: { where: { id: string; officeId: string; isActive: boolean } }) => { assert.deepEqual(query.where, { id: "operator", officeId: "office", isActive: true }); return user ? copy(user) : null; } } };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>, config: unknown) => {
    stats.transactions++; assert.deepEqual(config, { isolationLevel: "RepeatableRead", timeout: 4500, maxWait: 500 }); return callback(tx);
  }, $disconnect: async () => { stats.disconnects++; } } as unknown as PrismaClient;
  const config: DeryaInfraConfiguration = { databaseUrl: "postgresql://unused@127.0.0.1/goalspec_mock", environmentVersion: "fixture-v1", tools,
    snapshot: options.snapshot ?? (async scope => ({ schemaVersion: 1, purpose: "derya_business", source: "derya_native_verified", snapshotId: "business-v1", tenantId: scope.tenantId, records: [], recordsHash: hash([]) })),
    policy: context => options.policy?.(policy(context.repository.digest)) ?? policy(context.repository.digest), record: event => events.push(event) };
  const configured = configureDeryaInfra(config, { connection: () => { stats.connections++; return db; },
    projection: async () => { stats.projections++; return options.project ? options.project() : copy(observation); },
    install: value => { factory = value; return () => { stats.uninstalled = true; }; } });
  return { configured, create: async () => { const created = await factory(identity); if (created) { created.frame.requestedObjective = "Show jobs"; created.frame.policy = "Authorized office only"; } return created; }, factory: (value: typeof identity) => factory(value), stats, events,
    revoke: () => { if (user) user.canViewWholeOffice = false; }, deactivate: () => { user = null; }, setObservation: (value: Json) => { observation = value; } };
}
async function ready(events: Record<string, unknown>[]) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (events.some(event => event.type === "ready")) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Speculative read did not finish");
}

test("Derya infra requires current whole-office operator identity before allocation", async () => {
  const fixture = setup();
  try {
    assert.equal(await fixture.factory({ ...identity, accessKind: "customer" }), undefined);
    assert.equal(await fixture.factory({ ...identity, canViewWholeOffice: false }), undefined);
    assert.equal(fixture.stats.connections, 0);
    fixture.revoke(); assert.equal(await fixture.create(), undefined);
    assert.equal(fixture.stats.projections, 0);
  } finally { await fixture.configured.close(); }
});
test("Derya infra exposes no actor context and completely rereads before promotion", async () => {
  const fixture = setup();
  try {
    const configured = await fixture.create(); assert(configured);
    const { runtime, frame } = configured; frame.requestedObjective = "Show jobs";
    const response = await runtime.boundary(frame, []);
    assert.equal(response.actorContext, ""); assert.deepEqual(response.evidence, []); assert.equal(runtime.actorContextMode, "current-only");
    await runtime.settlePredictions(); await ready(fixture.events);
    fixture.setObservation({ ok: true, result: [{ reference: "NEW" }] });
    let fallback = false;
    const value = await runtime.scheduler.authoritative(candidate(frame).invocation, async () => { fallback = true; return null; });
    assert.deepEqual(value, { ok: true, result: [{ reference: "NEW" }] }); assert.equal(fallback, false);
    assert.equal(fixture.stats.projections, 2);
    assert.ok(fixture.events.some(event => event.type === "validation_transaction"));
    assert.ok(fixture.events.some(event => event.type === "derya_infra_runtime_created" && event.actorModel === "existing_gpt-5.6"));
    await runtime.close();
  } finally { await fixture.configured.close(); }
  assert.equal(fixture.stats.disconnects, 1);
});
test("Derya infra rejects foreign or changed checkpoint identity", async () => {
  const fixture = setup();
  try {
    const configured = await fixture.create(); assert(configured);
    await assert.rejects(() => configured.runtime.boundary({ ...configured.frame, scope: { ...configured.frame.scope, tenantId: "foreign" } }, []), /identity/);
    await assert.rejects(() => configured.runtime.boundary({ ...configured.frame, snapshotId: "other" }, []), /identity/);
    await configured.runtime.boundary(configured.frame, []);
    await assert.rejects(() => configured.runtime.boundary(configured.frame, []), /identity/);
  } finally { await fixture.configured.close(); }
});
test("Derya infra rejects research memory lineage", async () => {
  const fixture = setup({ snapshot: async scope => ({ schemaVersion: 1, purpose: "derya_business", source: "APIGen" as "derya_native_verified", snapshotId: "bad", tenantId: scope.tenantId, records: [], recordsHash: hash([]) }) });
  try { await assert.rejects(() => fixture.create(), /Unverified/); assert.equal(fixture.stats.projections, 0); }
  finally { await fixture.configured.close(); }
});
test("Derya infra denies revoked authorization at consumption without fallback", async () => {
  const fixture = setup();
  try {
    const configured = await fixture.create(); assert(configured);
    await configured.runtime.boundary(configured.frame, []); await configured.runtime.settlePredictions(); await ready(fixture.events);
    fixture.revoke(); let fallback = false;
    await assert.rejects(() => configured.runtime.scheduler.authoritative(candidate(configured.frame).invocation, async () => { fallback = true; return null; }), /Authorization/);
    assert.equal(fallback, false); assert.equal(fixture.stats.projections, 1);
    await assert.rejects(() => configured.runtime.boundary({ ...configured.frame, boundary: 1 }, []), /Authorization/);
  } finally { await fixture.configured.close(); }
});
test("Derya infra rejects candidate arguments outside the configured schema", async () => {
  const fixture = setup({ policy: base => ({ ...base, candidates: frame => [{ ...candidate(frame), invocation: { ...candidate(frame).invocation, arguments: { unconfigured: true } } }] }) });
  try {
    const configured = await fixture.create(); assert(configured);
    await configured.runtime.boundary(configured.frame, []); await configured.runtime.settlePredictions();
    assert.equal(fixture.stats.projections, 0);
  } finally { await fixture.configured.close(); }
});
test("Derya generic mutation entry fences pending infrastructure predictions", async () => {
  const wait = deferred<void>(), entered = deferred<void>();
  const fixture = setup({ policy: base => ({ ...base, rank: async () => { entered.resolve(); await wait.promise; return { action: "READ", scores: [{ candidateId: "jobs", probability: 1 }] }; } }) });
  try {
    const configured = await fixture.create(); assert(configured);
    await configured.runtime.boundary(configured.frame, []); await entered.promise;
    assert.deepEqual(await configured.runtime.scheduler.mutationBatch(async () => ["native-result"]), ["native-result"]);
    wait.resolve(); await configured.runtime.settlePredictions(); assert.equal(fixture.stats.projections, 0);
  } finally { wait.resolve(); await fixture.configured.close(); }
});
test("Derya shutdown waits for physical read completion before disconnect", async () => {
  const wait = deferred<Json>(), entered = deferred<void>();
  const fixture = setup({ project: async () => { entered.resolve(); return wait.promise; } });
  const configured = await fixture.create(); assert(configured);
  await configured.runtime.boundary(configured.frame, []); await entered.promise;
  const closing = fixture.configured.close(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.stats.disconnects, 0); assert.equal(fixture.stats.uninstalled, true);
  wait.resolve({ ok: true, result: [] }); await closing; assert.equal(fixture.stats.disconnects, 1);
});

const databaseUrl = process.env.GOALSPEC_TEST_DATABASE_URL;
test("Derya infra generic-chat integration revalidates actual DB inserts and revoked access", { skip: !databaseUrl, timeout: 30000 }, async () => {
  if (new URL(databaseUrl!).hostname !== "127.0.0.1" || !new URL(databaseUrl!).pathname.startsWith("/goalspec_")) throw new Error("Disposable loopback goalspec_ database required");
  const writer = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const suffix = randomUUID(), events: Record<string, unknown>[] = [];
  const office = await writer.office.create({ data: { name: `Infra fixture ${suffix}` } });
  const user = await writer.user.create({ data: { officeId: office.id, email: `${suffix}@example.test`, passwordHash: "unused-fixture", fullName: "Infra fixture", canViewWholeOffice: true } });
  const bootstrap = configureDeryaInfra({ databaseUrl: databaseUrl!, environmentVersion: "infra-db-fixture", tools,
    snapshot: async scope => ({ schemaVersion: 1, purpose: "derya_business", source: "derya_native_verified", snapshotId: "infra-db", tenantId: scope.tenantId, records: [], recordsHash: hash([]) }),
    policy: context => policy(context.repository.digest), record: event => events.push(event) });
  let chat: Awaited<ReturnType<typeof createDeryaChatRuntime>>;
  try {
    chat = await createDeryaChatRuntime({ userId: user.id, officeId: office.id, accessKind: "operator", canViewWholeOffice: true }, "Show jobs", "Office only"); assert(chat);
    assert.equal(await chat.boundary(), ""); assert.equal(chat.observation(), undefined); await ready(events);
    await writer.job.create({ data: { officeId: office.id, reference: "INSERTED-AFTER-PREFETCH" } });
    let fallback = false;
    const result = await chat.batch([{ id: "real-actor-call", name: "search_jobs", input: {} }], async () => { fallback = true; return { ok: true, result: [] }; });
    assert.equal(fallback, false);
    assert.equal((result as unknown as { result: { reference: string }[] }[])[0].result[0].reference, "INSERTED-AFTER-PREFETCH");
    assert.ok(events.some(event => event.type === "validation_transaction"));
    assert.ok(events.filter(event => event.type === "physical_sql_query").length >= 8);
    await writer.user.update({ where: { id: user.id }, data: { canViewWholeOffice: false } });
    await assert.rejects(() => chat!.boundary(), /Authorization/);
  } finally { await chat?.close(); await bootstrap.close(); await writer.office.delete({ where: { id: office.id } }); await writer.$disconnect(); }
});
