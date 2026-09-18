import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { hash } from "../src/lib/goalspec/canonical";
import { DeryaReadExecutor, auditedDeryaConnection } from "../src/lib/goalspec-adapters/derya-read-executor";
import { deryaProjection } from "../src/lib/goalspec-adapters/derya-projections";
import type { Invocation } from "../src/lib/goalspec/contracts/generated";

const url = process.env.GOALSPEC_TEST_DATABASE_URL;
if (!url || new URL(url).hostname !== "127.0.0.1" || !new URL(url).pathname.startsWith("/goalspec_")) throw new Error("Disposable loopback goalspec_ database required");
let physicalSqlQueries = 0;
const db = auditedDeryaConnection(url, () => { physicalSqlQueries++; });
const writer = new PrismaClient({ datasources: { db: { url } } });

test("independent-connection freshness: inserts, deletions, ordering, joins, ownership and authorization", async () => {
  const suffix = randomUUID();
  const office = await writer.office.create({ data: { name: `GoalSpec ${suffix}` } });
  const foreign = await writer.office.create({ data: { name: `Foreign ${suffix}` } });
  const user = await writer.user.create({ data: { officeId: office.id, email: `${suffix}@example.test`, passwordHash: "unused-fixture", fullName: "Fixture operator", canViewWholeOffice: true } });
  const scope = { tenantId: office.id, principalId: user.id, authorizationVersion: hash({ id: user.id, officeId: office.id, role: user.role, canViewWholeOffice: true }), environmentVersion: "test", toolSchemaHash: "schema" };
  const transactions: string[] = [];
  const executor = new DeryaReadExecutor(db, deryaProjection, "schema", "test", { id: user.id, officeId: office.id, accessKind: "operator" }, kind => transactions.push(kind));
  const signal = new AbortController().signal;
  const invocation: Invocation = { tool: "search_jobs", arguments: {}, scope };
  try {
    const empty = await executor.read(invocation, signal);
    assert.deepEqual(empty, { ok: true, result: [] });
    const company = await writer.company.create({ data: { officeId: office.id, name: "Before" } });
    const first = await writer.job.create({ data: { officeId: office.id, companyId: company.id, reference: "FIRST", updatedAt: new Date("2026-01-01") } });
    const inserted = await executor.validate(invocation, empty, signal) as { result: { reference: string; company: { name: string } }[] };
    assert.equal(inserted.result[0].reference, "FIRST");
    const second = await writer.job.create({ data: { officeId: office.id, reference: "SECOND", updatedAt: new Date("2026-02-01") } });
    const ordered = await executor.validate(invocation, inserted, signal) as typeof inserted;
    assert.deepEqual(ordered.result.map(r => r.reference), ["SECOND", "FIRST"]);
    await writer.job.update({ where: { id: first.id }, data: { updatedAt: new Date("2026-03-01") } });
    const reordered = await executor.validate(invocation, ordered, signal) as typeof inserted;
    assert.deepEqual(reordered.result.map(r => r.reference), ["FIRST", "SECOND"]);
    await writer.company.update({ where: { id: company.id }, data: { name: "After" } });
    const joined = await executor.validate(invocation, reordered, signal) as typeof inserted;
    assert.equal(joined.result[0].company.name, "After");
    await writer.job.delete({ where: { id: second.id } });
    const deleted = await executor.validate(invocation, joined, signal) as typeof inserted;
    assert.equal(deleted.result.length, 1);
    const detail: Invocation = { ...invocation, tool: "get_job", arguments: { job_id: first.id } };
    assert.equal((await executor.read(detail, signal) as { ok: boolean }).ok, true);
    await writer.company.update({ where: { id: company.id }, data: { officeId: foreign.id } });
    await assert.rejects(() => executor.validate(invocation, deleted, signal), /ownership/);
    await assert.rejects(() => executor.read(detail, signal), /ownership/);
    await writer.company.update({ where: { id: company.id }, data: { officeId: office.id } });
    await writer.user.update({ where: { id: user.id }, data: { canViewWholeOffice: false } });
    await assert.rejects(() => executor.validate(invocation, deleted, signal), /Authorization/);
    await writer.user.update({ where: { id: user.id }, data: { canViewWholeOffice: true } });
    for (const name of ["search_inquiries", "search_companies", "list_open_inquiries"]) {
      assert.equal((await executor.read({ ...invocation, tool: name }, signal) as { ok: boolean }).ok, true);
    }
    const malicious = new DeryaReadExecutor(db, async tx => {
      await tx.office.create({ data: { name: "Must not persist" } }); return null;
    }, "schema", "test", { id: user.id, officeId: office.id, accessKind: "operator" }, () => {});
    await assert.rejects(() => malicious.read(invocation, signal), /read-only/);
    assert(transactions.filter(t => t === "validation_transaction").length >= 7);
    assert(physicalSqlQueries > transactions.length * 2);
  } finally {
    await writer.office.deleteMany({ where: { id: { in: [office.id, foreign.id] } } });
    await Promise.all([db.$disconnect(), writer.$disconnect()]);
  }
});
