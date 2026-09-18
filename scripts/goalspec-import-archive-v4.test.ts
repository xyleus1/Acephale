import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { canonical } from "../src/lib/goalspec/canonical";
import { guardedArchiveDatabaseUrl, importArchive, TABLES, SCHEMA_SQL, MAX_BATCH_BYTES } from "./goalspec-import-archive-v4";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-archive-v4-import-"));
  const python = resolve("research/goalspec/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  execFileSync(python, ["-c", `import sys; from pathlib import Path
sys.path[:0]=['research/goalspec/src','research/goalspec/tests']
from test_archive_import_v4 import archive
archive(Path(sys.argv[1]))`, directory], { cwd: process.cwd(), windowsHide: true, stdio: "pipe" });
  const archive = join(directory, "archive"), bytes = readFileSync(join(archive, "manifest.json"));
  return { directory, archive, manifest: JSON.parse(bytes.toString()), sha: hash(bytes), receipt: join(directory, "receipt.json"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

type Row = { row_index: number; payload: Record<string, unknown>; row_sha256: string; canonical_utf8: string };
/** No PostgreSQL server or network client is constructed by these tests. */
function fakeDatabase(failure?: "count" | "raw" | "payload" | "manifest") {
  let imported: { manifest_sha256: string; manifest_utf8: string; payload: unknown } | undefined;
  let stored = Object.fromEntries(TABLES.map(table => [table, [] as Row[]])) as Record<typeof TABLES[number], Row[]>;
  let rolledBack = false, committed = 0, disconnected = 0, inserted = 0;
  const queries: { sql: string; values: unknown[] }[] = [];
  const sqlOf = (query: Prisma.Sql | TemplateStringsArray) => Array.isArray(query) ? query.join("?") : (query as Prisma.Sql).sql;
  const valuesOf = (query: Prisma.Sql | TemplateStringsArray) => Array.isArray(query) ? [] : (query as Prisma.Sql).values;
  const tx = {
    async $executeRawUnsafe(sql: string) {
      assert.ok(SCHEMA_SQL.split(/^-- statement-break\r?$/m).includes(sql), "Only exact static schema statements can be unsafe");
      assert.ok(sql.includes("goalspec_archive_v4"));
      return 0;
    },
    async $executeRaw(query: Prisma.Sql | TemplateStringsArray) {
      const sql = sqlOf(query), values = valuesOf(query); queries.push({ sql, values });
      if (sql.includes("pg_advisory_xact_lock")) return 1;
      assert.match(sql, /INSERT INTO goalspec_archive_v4\./);
      assert.ok(!sql.includes("synthetic-v4"), "Archive values must be bound parameters");
      if (sql.includes("INSERT INTO goalspec_archive_v4.archive_import")) {
        imported = { manifest_sha256: values[1] as string, manifest_utf8: values[2] as string, payload: JSON.parse(values[3] as string) };
      } else {
        const table = TABLES.find(name => sql.includes(`INSERT INTO goalspec_archive_v4.${name}(`))!;
        assert.ok(table);
        const rows = JSON.parse(values[1] as string) as Row[];
        assert.ok(rows.length <= 128);
        assert.ok(Buffer.byteLength(values[1] as string) <= MAX_BATCH_BYTES + 2 || rows.length === 1);
        stored[table].push(...rows); inserted += rows.length;
      }
      return 1;
    },
    async $queryRaw(query: Prisma.Sql) {
      const sql = query.sql, values = query.values; queries.push({ sql, values });
      if (sql.includes("FROM goalspec_archive_v4.archive_import")) {
        if (!imported) return [];
        return [{ ...imported, ...(failure === "manifest" && sql.includes("manifest_utf8,payload") ? { payload: {} } : {}) }];
      }
      if (sql.includes("count(*)")) return TABLES.map(table => ({ table_name: table, records: BigInt(stored[table].length + (failure === "count" ? 1 : 0)) }));
      const table = TABLES.find(name => sql.includes(`FROM goalspec_archive_v4.${name} `))!;
      assert.ok(table);
      const position = Number(values[1]); let bytes = 0;
      return stored[table].slice(position, position + 128).filter(row => {
        bytes += Buffer.byteLength(row.canonical_utf8);
        return bytes <= MAX_BATCH_BYTES || row.row_index === position;
      }).map(row => ({ ...row, row_index: BigInt(row.row_index),
        payload: failure === "payload" ? {} : row.payload,
        raw_utf8: table === "artifact_record" ? failure === "raw" ? "changed" : row.payload.raw_utf8 : null }));
    },
  };
  const db = {
    async $transaction(run: (tx: unknown) => Promise<unknown>) {
      const beforeImported = imported, beforeStored = structuredClone(stored);
      try { const result = await run(tx); committed++; return result; }
      catch (error) { imported = beforeImported; stored = beforeStored; rolledBack = true; throw error; }
    },
    async $disconnect() { disconnected++; },
  };
  return { db: db as unknown as Pick<PrismaClient, "$transaction" | "$disconnect">,
    state: () => ({ rolledBack, committed, disconnected, inserted, imported, queries, stored }) };
}

test("v4 archive URL guard rejects remote, application and redirecting URLs", () => {
  assert.match(guardedArchiveDatabaseUrl("postgresql://u:p@127.0.0.1/goalspec_research"), /goalspec_research/);
  for (const url of ["postgresql://u:p@remote/goalspec_research", "postgresql://u:p@localhost/goalspec_research",
    "postgresql://u:p@127.0.0.1/application", "postgresql://u:p@127.0.0.1/goalspec_research?host=remote"])
    assert.throws(() => guardedArchiveDatabaseUrl(url));
  assert.throws(() => guardedArchiveDatabaseUrl("postgresql://u:p@127.0.0.1/goalspec_research", "postgresql://u:p@localhost/goalspec_research"));
});

test("v4 import validates before constructing a client, stores exact hashes and is idempotent", async () => {
  const value = fixture(), fake = fakeDatabase(); let constructions = 0;
  const create = () => { constructions++; return fake.db; };
  try {
    await assert.rejects(importArchive(value.archive, "0".repeat(64), value.receipt, "postgresql://u:p@127.0.0.1/goalspec_research", undefined, create));
    assert.equal(constructions, 0);
    const receipt = await importArchive(value.archive, value.sha, value.receipt, "postgresql://u:p@127.0.0.1/goalspec_research", undefined, create);
    assert.equal(receipt.status, "imported"); assert.equal(receipt.databaseSchema, "goalspec_archive_v4");
    assert.equal(receipt.databaseJsonlRoundTripVerified, true); assert.equal(receipt.legacyTablesModified, false);
    assert.equal(fake.state().committed, 1); assert.equal(fake.state().disconnected, 1);
    const firstInserts = fake.state().inserted;
    const again = await importArchive(value.archive, value.sha, join(value.directory, "again.json"), "postgresql://u:p@127.0.0.1/goalspec_research", undefined, create);
    assert.equal(again.status, "already_present"); assert.equal(fake.state().inserted, firstInserts);
    assert.deepEqual(receipt.tables, Object.fromEntries(TABLES.map(table => [table, value.manifest.files.find((file: { table: string }) => file.table === table).rows])));
    assert.equal(readFileSync(value.receipt, "utf8"), canonical(receipt) + "\n");
  } finally { value.cleanup(); }
});

for (const failure of ["count", "raw", "payload", "manifest"] as const) test(`v4 import rolls back on ${failure} readback mismatch`, async () => {
  const value = fixture(), fake = fakeDatabase(failure);
  try {
    await assert.rejects(importArchive(value.archive, value.sha, value.receipt, "postgresql://u:p@127.0.0.1/goalspec_research", undefined, () => fake.db), /mismatch/);
    assert.equal(fake.state().rolledBack, true); assert.equal(fake.state().committed, 0);
    assert.equal(fake.state().imported, undefined); assert.equal(fake.state().disconnected, 1);
    assert.equal(existsSync(value.receipt), false);
  } finally { value.cleanup(); }
});
