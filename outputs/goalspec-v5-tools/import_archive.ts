import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { canonicalRows, guardedArchiveDatabaseUrl } from "../../scripts/goalspec-import-archive-v4";
import { canonical } from "../../src/lib/goalspec/canonical";

const TABLES = ["cohort_manifest", "artifact_file", "artifact_record"] as const;
const VERSION = "goalspec-results-archive-v5";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
type File = { table: typeof TABLES[number]; filename: string; format: "canonical-jsonl" | "parquet"; rows: number; bytes: number; sha256: string };
type Manifest = { version: string; contract: string; archiveId: string; complete: boolean; files: File[];
  sources: { source_id: string; sha256: string; bytes: number }[] };
export function archiveUrl(value: string, applicationUrl?: string) {
  const safe = guardedArchiveDatabaseUrl(value, applicationUrl), url = new URL(safe);
  if (!["/goalspec_research", "/goalspec_repository_test"].includes(url.pathname) || url.port !== "55440") throw new Error("Dedicated local research archive database required");
  return safe;
}

async function oldTables(tx: Prisma.TransactionClient) {
  const tables = await tx.$queryRaw<{ schema: string; name: string }[]>(Prisma.sql`
    SELECT table_schema AS schema, table_name AS name FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND (table_schema='goalspec' OR table_schema ~ '^goalspec_archive_v[1-4]$') ORDER BY table_schema,table_name`);
  const result: Record<string, { rows: number; sha256: string }> = {};
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/.test(table.schema) || !/^[a-z0-9_]+$/.test(table.name)) throw new Error("Unexpected research table identifier");
    const name = `${table.schema}.${table.name}`, digest = createHash("sha256"); let rows = 0;
    // Deterministic SQL ordering, bounded read batches. This offline operation is
    // deliberately deferred until all measured trials and ledger owners close.
    await tx.$executeRawUnsafe(`DECLARE goalspec_v5_preservation NO SCROLL CURSOR FOR SELECT to_jsonb(r)::text AS value FROM ${name} r ORDER BY to_jsonb(r)::text`);
    for (;;) {
      const batch = await tx.$queryRawUnsafe<{ value: string }[]>("FETCH 8 FROM goalspec_v5_preservation");
      for (const row of batch) { digest.update(row.value); digest.update("\n"); rows++; }
      if (batch.length < 8) break;
    }
    await tx.$executeRawUnsafe("CLOSE goalspec_v5_preservation");
    result[name] = { rows, sha256: digest.digest("hex") };
  }
  return result;
}

export async function importArchive(directory: string, expected: string, receiptPath: string, databaseUrl: string) {
  if (existsSync(receiptPath) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("New receipt and exact manifest hash required");
  const url = archiveUrl(databaseUrl, process.env.DATABASE_URL);
  const python = process.env.GOALSPEC_ARCHIVE_PYTHON ?? resolve("research/goalspec/.venv/Scripts/python.exe");
  const verified = await promisify(execFile)(python, [resolve("outputs/goalspec-v5-tools/archive_results.py"), "inspect", resolve(directory), expected], { windowsHide: true, maxBuffer: 1 << 20 });
  if (JSON.parse(verified.stdout).verified !== true) throw new Error("Independent Parquet/JSONL/source roundtrip failed");
  const manifestRaw = readFileSync(join(directory, "manifest.json"), "utf8"), manifest: Manifest = JSON.parse(manifestRaw);
  if (sha(manifestRaw) !== expected || manifest.version !== VERSION || manifest.contract !== "closed-research-v5-byte-archive"
    || !manifest.complete || !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.archiveId)) throw new Error("Invalid v5 archive manifest");
  const files = TABLES.map(table => {
    const candidates = manifest.files.filter(file => file.table === table && file.format === "canonical-jsonl");
    if (candidates.length !== 1 || candidates[0].filename !== `${table}.jsonl`) throw new Error("Invalid v5 archive table set");
    return candidates[0];
  });
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const receipt = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(738194,5)`;
      const before = await oldTables(tx);
      await tx.$executeRawUnsafe("CREATE SCHEMA IF NOT EXISTS goalspec_archive_v5");
      await tx.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS goalspec_archive_v5.archive_import(archive_id text PRIMARY KEY,manifest_sha256 text NOT NULL,manifest_utf8 text NOT NULL)");
      for (const table of TABLES) await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS goalspec_archive_v5.${table}(archive_id text NOT NULL REFERENCES goalspec_archive_v5.archive_import, row_index bigint NOT NULL, row_sha256 text NOT NULL, canonical_utf8 text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(archive_id,row_index))`);
      await tx.$executeRawUnsafe("DO $body$ BEGIN IF to_regprocedure('goalspec_archive_v5.reject_change()') IS NULL THEN EXECUTE $definition$CREATE FUNCTION goalspec_archive_v5.reject_change() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RAISE EXCEPTION 'GoalSpec v5 archive rows are immutable'; END; $function$$definition$; END IF; END; $body$");
      for (const table of ["archive_import", ...TABLES]) await tx.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='goalspec_archive_v5.${table}'::regclass AND tgname='reject_archive_change') THEN CREATE TRIGGER reject_archive_change BEFORE UPDATE OR DELETE OR TRUNCATE ON goalspec_archive_v5.${table} FOR EACH STATEMENT EXECUTE FUNCTION goalspec_archive_v5.reject_change(); END IF; END; $$`);
      const existing = await tx.$queryRaw<{ manifest_sha256: string; manifest_utf8: string }[]>(Prisma.sql`SELECT manifest_sha256,manifest_utf8 FROM goalspec_archive_v5.archive_import WHERE archive_id=${manifest.archiveId}`);
      if (existing.length && (existing.length !== 1 || existing[0].manifest_sha256 !== expected || existing[0].manifest_utf8 !== manifestRaw)) throw new Error("Immutable archive identity conflict");
      if (!existing.length) {
        await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec_archive_v5.archive_import VALUES(${manifest.archiveId},${expected},${manifestRaw})`);
        for (const file of files) {
          for await (const row of canonicalRows(directory, file)) await tx.$executeRaw(Prisma.sql`INSERT INTO ${Prisma.raw(`goalspec_archive_v5.${file.table}`)}(archive_id,row_index,row_sha256,canonical_utf8,payload)
            VALUES(${manifest.archiveId},${row.row_index},${row.row_sha256},${row.canonical_utf8},${row.canonical_utf8}::jsonb)`);
        }
      }
      for (const file of files) {
        let position = 0; const checksum = createHash("sha256");
        for (;;) {
          const rows = await tx.$queryRaw<{ row_index: bigint; row_sha256: string; canonical_utf8: string; payload: unknown }[]>(Prisma.sql`SELECT row_index,row_sha256,canonical_utf8,payload FROM ${Prisma.raw(`goalspec_archive_v5.${file.table}`)} WHERE archive_id=${manifest.archiveId} AND row_index>=${position} ORDER BY row_index LIMIT 8`);
          for (const row of rows) {
            if (Number(row.row_index) !== position++ || sha(row.canonical_utf8) !== row.row_sha256 || canonical(row.payload) !== row.canonical_utf8) throw new Error("Archive database row roundtrip differs");
            checksum.update(row.canonical_utf8 + "\n");
          }
          if (rows.length < 8) break;
        }
        if (position !== file.rows || checksum.digest("hex") !== file.sha256) throw new Error("Archive database stream roundtrip differs");
      }
      const after = await oldTables(tx);
      if (canonical(before) !== canonical(after)) throw new Error("Legacy research data changed");
      // Check exported files again before the transaction commits.
      for (const file of files) for await (const _row of canonicalRows(directory, file)) { /* verified streaming hash */ }
      if (sha(readFileSync(join(directory, "manifest.json"))) !== expected) throw new Error("Manifest changed during import");
      return { version: VERSION, archiveId: manifest.archiveId, manifestSha256: expected, inserted: !existing.length,
        tables: files.map(file => ({ table: file.table, rows: file.rows, sha256: file.sha256 })), priorResearchTables: before,
        priorResearchTablesUnchanged: true, databaseRoundtripVerified: true, schema: "goalspec_archive_v5" };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 600_000 });
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" }); return receipt;
  } finally { await db.$disconnect(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("outputs/goalspec-v5-tools/import_archive.ts")) {
  const [directory, expected, receipt] = process.argv.slice(2);
  if (!directory || !expected || !receipt || !process.env.GOALSPEC_ARCHIVE_DATABASE_URL) throw new Error("Archive path, manifest hash, new receipt and GOALSPEC_ARCHIVE_DATABASE_URL required");
  importArchive(directory, expected, receipt, process.env.GOALSPEC_ARCHIVE_DATABASE_URL).then(value => console.log(JSON.stringify(value)))
    .catch(() => { console.error("V5 archive import failed; source values and database diagnostics withheld."); process.exitCode = 1; });
}
