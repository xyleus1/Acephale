import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { hash } from "../src/lib/goalspec/canonical";
import { DeryaReadExecutor, readDeryaAuthoritative, DERYA_READ_TOOLS } from "../src/lib/goalspec-adapters/derya-read-executor";
import { deryaProjection } from "../src/lib/goalspec-adapters/derya-projections";
import { captureEpochSnapshot, DERYA_EPOCH_TABLES, DERYA_EPOCH_CONTRACT_HASH, type EpochReuseReceipt, type EpochSnapshot } from "../src/lib/goalspec-adapters/derya-epochs";
import { ReadAuthorizationDeniedError } from "../src/lib/goalspec/scheduler";
import type { Invocation } from "../src/lib/goalspec/contracts/generated";

const ownerUrl = process.env.GOALSPEC_TEST_DATABASE_URL;
const readerUrl = process.env.GOALSPEC_EPOCH_TEST_DATABASE_URL;
for (const url of [ownerUrl, readerUrl]) {
  if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/goalspec_derya_v5_test") throw new Error("Dedicated loopback goalspec_derya_v5_test database required");
}
const writer = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
const reader = new PrismaClient({ datasources: { db: { url: readerUrl } } });
const signal = new AbortController().signal;
async function snapshot(db = reader) {
  return db.$transaction(async tx => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return captureEpochSnapshot(tx); }, { isolationLevel: "RepeatableRead" });
}
function fixtureReceipt(epoch: EpochSnapshot): EpochReuseReceipt {
  // Synthetic test authorization exercises the gate. These are not performance
  // measurements and this receipt is never written to deployment configuration.
  return { version: 1, contractHash: DERYA_EPOCH_CONTRACT_HASH, coverageHash: epoch.coverageHash, incarnation: epoch.incarnation, allowedTools: [...DERYA_READ_TOOLS],
    equivalencePassed: true, equivalenceEvidenceHash: "a".repeat(64), performanceEvidenceHash: "b".repeat(64),
    validationSamples: 100, writerSamples: 100, validationP95Ms: 1, fullReadP95Ms: 2, writerOverheadRatio: 0 };
}
function deferred() { let resolve!: () => void; return { promise: new Promise<void>(r => { resolve = r; }), resolve: () => resolve() }; }

test("real PostgreSQL: epoch coverage, guarded parity, mutations, snapshots and bypass rejection", { timeout: 90_000 }, async t => {
  // The deployment migration deliberately leaves triggers off. This explicit
  // research-only activation uses the disposable owner, never app credentials.
  execFileSync(resolve("research/goalspec/runs/pg17-local-v1/bin/psql.exe"), ["-h", "127.0.0.1", "-p", "55440", "-U", "goalspec_owner", "-d", "goalspec_derya_v5_test", "-v", "ON_ERROR_STOP=1", "-q", "-f", resolve("scripts/sql/goalspec-enable-epoch-shadow.sql")], { stdio: "pipe" });
  const suffix = randomUUID();
  const office = await writer.office.create({ data: { name: `Epoch ${suffix}` } });
  const foreign = await writer.office.create({ data: { name: `Foreign ${suffix}` } });
  const user = await writer.user.create({ data: { officeId: office.id, email: `${suffix}@example.test`, passwordHash: "test-only", fullName: "Epoch operator", canViewWholeOffice: true } });
  const principal = { userId: user.id, officeId: office.id, accessKind: "operator" };
  const scope = { tenantId: office.id, principalId: user.id, authorizationVersion: hash({ id: user.id, officeId: office.id, role: user.role, canViewWholeOffice: true }), environmentVersion: "test-v5", toolSchemaHash: "schema" };
  const invoke = (tool: string, args: Invocation["arguments"] = {}): Invocation => ({ tool, arguments: args, scope });
  const events: string[] = [];
  let projectionCalls = 0;
  const projection: typeof deryaProjection = async (...args) => { projectionCalls++; return deryaProjection(...args); };
  const epoch = await snapshot(); assert(epoch, "migration and least-privilege role must be recognized");
  const receipt = fixtureReceipt(epoch);
  const executor = new DeryaReadExecutor(reader, projection, "schema", "test-v5", { id: user.id, officeId: office.id, accessKind: "operator" }, kind => events.push(kind), { mode: "verified-reuse", receipt, trustedReceiptHash: hash(receipt) });
  const shadow = new DeryaReadExecutor(reader, projection, "schema", "test-v5", { id: user.id, officeId: office.id, accessKind: "operator" }, kind => events.push(kind), { mode: "shadow" });
  try {
    await t.test("empty-result insert, stable ties, fresh query reuse and scoped authoritative parity", async () => {
      const invocation = invoke("search_jobs");
      const empty = await executor.read(invocation, signal); assert.deepEqual(empty, { ok: true, result: [] });
      const c = await writer.company.create({ data: { officeId: office.id, name: "Before" } });
      const inquiry = await writer.inquiry.create({ data: { officeId: office.id, subject: "Fixture RFQ", type: "SOURCING", receivedAt: new Date("2026-01-01") } });
      await writer.job.createMany({ data: [
        { id: `${suffix}-b`, officeId: office.id, companyId: c.id, reference: "B", updatedAt: new Date("2026-01-01") },
        { id: `${suffix}-a`, officeId: office.id, companyId: c.id, inquiryId: inquiry.id, type: "SOURCING", reference: "A", updatedAt: new Date("2026-01-01") },
      ] });
      const inserted = await executor.validate(invocation, empty, signal) as any;
      assert.deepEqual(inserted.result.map((r: any) => r.reference), ["A", "B"]);
      const before = projectionCalls;
      assert.deepEqual(await executor.validate(invocation, inserted, signal), inserted);
      assert.equal(projectionCalls, before, "valid receipt and unchanged epochs avoid the projection");
      assert(events.includes("epoch_verified_reuse"));
      for (const tool of DERYA_READ_TOOLS) {
        const i = invoke(tool, tool === "get_job" ? { job_id: `${suffix}-a` } : {});
        const cached = await shadow.read(i, signal);
        assert.deepEqual(await shadow.validate(i, cached, signal), await readDeryaAuthoritative(reader, deryaProjection, tool, i.arguments, principal));
      }
      assert(events.includes("epoch_shadow_equal"));
      const own = await writer.user.create({ data: { officeId: office.id, email: `own-${suffix}@example.test`, passwordHash: "test-only", fullName: "Scoped", canViewWholeOffice: false } });
      const scoped = { ...principal, userId: own.id };
      assert.deepEqual(await readDeryaAuthoritative(reader, deryaProjection, "search_companies", {}, scoped), { ok: true, result: [] });
      await writer.companyOwner.create({ data: { companyId: c.id, userId: own.id } });
      assert.equal(((await readDeryaAuthoritative(reader, deryaProjection, "search_companies", {}, scoped)) as any).result.length, 1);
      assert.equal(((await readDeryaAuthoritative(reader, deryaProjection, "search_jobs", {}, scoped)) as any).result.length, 2);
      await assert.rejects(readDeryaAuthoritative(reader, deryaProjection, "search_jobs", {}, { ...principal, accessKind: "customer" }), ReadAuthorizationDeniedError);
    });
    await t.test("independent raw SQL, deletes, order and joined changes invalidate relevant epochs", async () => {
      const invocation = invoke("search_jobs");
      const before = await executor.read(invocation, signal);
      await writer.$executeRaw`UPDATE "Job" SET "updatedAt" = '2026-03-01'::timestamp WHERE id = ${`${suffix}-b`}`;
      const reordered = await executor.validate(invocation, before, signal) as any;
      assert.deepEqual(reordered.result.map((r: any) => r.reference), ["B", "A"]);
      const job = await writer.job.findUniqueOrThrow({ where: { id: `${suffix}-a` } });
      await writer.company.update({ where: { id: job.companyId! }, data: { name: "After" } });
      const joined = await executor.validate(invocation, reordered, signal) as any;
      assert.equal(joined.result[0].company.name, "After");
      await writer.job.delete({ where: { id: `${suffix}-b` } });
      assert.equal(((await executor.validate(invocation, joined, signal)) as any).result.length, 1);
      const detail = invoke("get_job", { job_id: job.id });
      const detailBefore = await executor.read(detail, signal);
      const thread = await writer.emailThread.create({ data: { officeId: office.id, inquiryId: job.inquiryId!, subject: "Quote", participants: "[]", supplierOffer: '{"pricePerUnit":10}' } });
      const message = await writer.emailMessage.create({ data: { officeId: office.id, threadId: thread.id, direction: "INBOUND", fromEmail: "supplier@example.test", toEmails: "[]" } });
      await writer.carrierQuote.create({ data: { inquiryId: job.inquiryId!, carrier: "Fixture carrier", total40: 40 } });
      await writer.jobDocument.create({ data: { officeId: office.id, jobId: job.id, name: "Invoice", docType: "INVOICE" } });
      await writer.jobMilestone.create({ data: { jobId: job.id, type: "ETA", plannedAt: new Date("2026-03-01") } });
      const detailAfter = await executor.validate(detail, detailBefore, signal) as any;
      assert.equal(detailAfter.result.supplier_offers[0].price, 10); assert.equal(detailAfter.result.documents.length, 1); assert.equal(detailAfter.result.milestones.length, 1);
      await writer.emailMessage.update({ where: { id: message.id }, data: { officeId: foreign.id } });
      assert.equal((await executor.validateFreshness(detail, detailAfter, signal)).status, "denied", "message ownership is part of the complete projection proof");
      await writer.emailMessage.update({ where: { id: message.id }, data: { officeId: office.id } });
      await writer.company.update({ where: { id: job.companyId! }, data: { officeId: foreign.id } });
      await assert.rejects(readDeryaAuthoritative(reader, deryaProjection, "get_job", detail.arguments, principal), /ownership/);
      await writer.company.update({ where: { id: job.companyId! }, data: { officeId: office.id } });
      await writer.inquiry.update({ where: { id: job.inquiryId! }, data: { officeId: foreign.id } });
      await assert.rejects(executor.read(detail, signal), /ownership/);
      await writer.inquiry.update({ where: { id: job.inquiryId! }, data: { officeId: office.id } });
    });
    await t.test("all nine triggers cover raw zero-row statements, rollback, replica mode and truncate", async () => {
      for (const table of DERYA_EPOCH_TABLES) {
        const before = (await snapshot())!;
        await reader.$executeRawUnsafe(`UPDATE public."${table}" SET id = id WHERE false`);
        assert.equal(BigInt((await snapshot())!.counters[table]), BigInt(before.counters[table]) + 1n);
      }
      const before = (await snapshot())!;
      await assert.rejects(writer.$transaction(async tx => { await tx.$executeRawUnsafe('UPDATE "Company" SET id = id WHERE false'); throw new Error("rollback fixture"); }), /rollback fixture/);
      assert.deepEqual((await snapshot())!.counters, before.counters);
      await writer.$transaction(async tx => { await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica"); await tx.$executeRawUnsafe('UPDATE "Company" SET id = id WHERE false'); });
      assert.equal(BigInt((await snapshot())!.counters.Company), BigInt(before.counters.Company) + 1n);
      const truncateBefore = (await snapshot())!;
      await assert.rejects(writer.$transaction(async tx => {
        await tx.$executeRawUnsafe('TRUNCATE TABLE "JobMilestone"');
        const inside = await tx.$queryRaw<{ epoch: bigint }[]>`SELECT epoch FROM goalspec_read_guard.epochs WHERE table_name = 'JobMilestone'`;
        assert.equal(inside[0].epoch, BigInt(truncateBefore.counters.JobMilestone) + 1n);
        throw new Error("rollback truncate fixture");
      }), /rollback truncate fixture/);
      assert.equal((await snapshot())!.counters.JobMilestone, truncateBefore.counters.JobMilestone);
    });
    await t.test("repeatable-read captures projection and epoch under one snapshot across a committed writer", async () => {
      const captured = deferred(), changed = deferred();
      const pending = reader.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const epoch = await captureEpochSnapshot(tx);
        const first = await deryaProjection(tx, "search_jobs", {}, office.id);
        captured.resolve(); await changed.promise;
        const second = await deryaProjection(tx, "search_jobs", {}, office.id);
        assert.deepEqual(first, second); assert.deepEqual(epoch, await captureEpochSnapshot(tx)); return first;
      }, { isolationLevel: "RepeatableRead", timeout: 10_000 });
      await captured.promise;
      await writer.job.update({ where: { id: `${suffix}-a` }, data: { reference: "COMMITTED" } });
      changed.resolve();
      const old = await pending;
      assert.notDeepEqual(old, await executor.validate(invoke("search_jobs"), old, signal));
    });
    await t.test("role, coverage, incarnation and privilege failures close the reuse path", async () => {
      assert.equal(await snapshot(writer), undefined, "owner/superuser cannot establish epoch proof");
      for (const sql of ['UPDATE goalspec_read_guard.epochs SET epoch = 0', 'ALTER TABLE "Job" DISABLE TRIGGER goalspec_read_epoch_v1', "SET session_replication_role = replica", "SET ROLE goalspec_owner"]) {
        await assert.rejects(reader.$executeRawUnsafe(sql));
      }
      const i = invoke("search_jobs"), prior = await executor.read(i, signal);
      await writer.$executeRawUnsafe('ALTER TABLE "Job" DISABLE TRIGGER goalspec_read_epoch_v1');
      try {
        assert.equal(await snapshot(), undefined);
        await writer.job.update({ where: { id: `${suffix}-a` }, data: { reference: "NO_COVERAGE" } });
        const count = projectionCalls;
        assert.notDeepEqual(await executor.validate(i, prior, signal), prior); assert(projectionCalls > count);
      } finally { await writer.$executeRawUnsafe('ALTER TABLE "Job" ENABLE ALWAYS TRIGGER goalspec_read_epoch_v1'); }
      const original = await writer.$queryRaw<{ incarnation: string }[]>`SELECT incarnation::text FROM goalspec_read_guard.metadata WHERE id = 1`;
      const fresh = await executor.read(i, signal);
      await writer.$executeRawUnsafe("UPDATE goalspec_read_guard.metadata SET incarnation = gen_random_uuid() WHERE id = 1");
      try {
        const count = projectionCalls; assert.deepEqual(await executor.validate(i, fresh, signal), fresh); assert(projectionCalls > count);
      } finally { await writer.$executeRaw`UPDATE goalspec_read_guard.metadata SET incarnation = ${original[0].incarnation}::uuid WHERE id = 1`; }
    });
    await t.test("current user revocation blocks typed validation and ordinary fallback reads", async () => {
      const i = invoke("search_jobs"), previous = await executor.read(i, signal);
      await writer.user.update({ where: { id: user.id }, data: { isActive: false } });
      assert.equal((await executor.validateFreshness(i, previous, signal)).status, "denied");
      await assert.rejects(readDeryaAuthoritative(reader, deryaProjection, "search_jobs", {}, principal), /Authorization/);
      await writer.user.update({ where: { id: user.id }, data: { isActive: true, canViewWholeOffice: false } });
      assert.equal((await executor.validateFreshness(i, previous, signal)).status, "denied");
      await writer.user.update({ where: { id: user.id }, data: { canViewWholeOffice: true } });
    });
    await t.test("inheritance, function changes, incomplete counters and privileged memberships cannot establish proof", async () => {
      await writer.$executeRawUnsafe('CREATE TABLE public."GoalSpecEpochChildFixture_v5" () INHERITS (public."Job")');
      try { assert.equal(await snapshot(), undefined); }
      finally { await writer.$executeRawUnsafe('DROP TABLE public."GoalSpecEpochChildFixture_v5"'); }
      await writer.$executeRawUnsafe("ALTER FUNCTION goalspec_read_guard.bump() SET search_path = public");
      try { assert.equal(await snapshot(), undefined); }
      finally { await writer.$executeRawUnsafe("ALTER FUNCTION goalspec_read_guard.bump() SET search_path = pg_catalog"); }
      assert(await snapshot());
      const old = await writer.$queryRaw<{ epoch: bigint }[]>`DELETE FROM goalspec_read_guard.epochs WHERE table_name = 'EmailMessage' RETURNING epoch`;
      try { assert.equal(await snapshot(), undefined); }
      finally { await writer.$executeRaw`INSERT INTO goalspec_read_guard.epochs(table_name, epoch) VALUES ('EmailMessage', ${old[0].epoch})`; }
      await writer.$executeRawUnsafe("GRANT pg_read_all_data TO goalspec_v5_reader");
      try { assert.equal(await snapshot(), undefined); }
      finally { await writer.$executeRawUnsafe("REVOKE pg_read_all_data FROM goalspec_v5_reader"); }
      await writer.$executeRawUnsafe("GRANT UPDATE (epoch) ON goalspec_read_guard.epochs TO goalspec_v5_reader");
      try { assert.equal(await snapshot(), undefined); }
      finally { await writer.$executeRawUnsafe("REVOKE UPDATE (epoch) ON goalspec_read_guard.epochs FROM goalspec_v5_reader"); }
      assert(await snapshot());
    });
  } finally {
    await writer.office.deleteMany({ where: { id: { in: [office.id, foreign.id] } } });
    await Promise.all([reader.$disconnect(), writer.$disconnect()]);
  }
});
