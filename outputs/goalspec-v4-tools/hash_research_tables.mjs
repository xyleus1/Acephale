// Read-only row/column audit of existing research tables, excluding the new v4 archive.
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import importer from "../../scripts/goalspec-import-archive-v4.ts";
const { guardedArchiveDatabaseUrl } = importer;

const sha = value => createHash("sha256").update(value).digest("hex");
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function main() {
  const target = resolve(process.argv[2] || "");
  if (!process.argv[2] || existsSync(target)) throw new Error("New audit receipt path required");
  const url = guardedArchiveDatabaseUrl(process.env.GOALSPEC_ARCHIVE_DATABASE_URL || "", process.env.DATABASE_URL);
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const tables = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL timezone='UTC'");
      const names = await tx.$queryRaw`SELECT schemaname,tablename FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog','information_schema','goalspec_archive_v4')
        AND schemaname NOT LIKE 'pg_%' ORDER BY schemaname,tablename`;
      const result = [];
      for (const name of names) {
        const identifier = `${quote(name.schemaname)}.${quote(name.tablename)}`;
        const columns = await tx.$queryRaw(Prisma.sql`SELECT a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull
          FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=${name.schemaname} AND c.relname=${name.tablename} AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`);
        // Only identifiers returned by PostgreSQL's catalog enter this static
        // cursor statement, and each component is quoted as an identifier.
        await tx.$executeRawUnsafe(`DECLARE goalspec_audit_cursor NO SCROLL CURSOR FOR SELECT * FROM (SELECT encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') AS row_hash,octet_length(row_to_json(t)::text) AS bytes FROM ${identifier} t) q ORDER BY row_hash COLLATE "C"`);
        const digest = createHash("sha256"); let rows = 0, bytes = 0;
        while (true) {
          const batch = await tx.$queryRawUnsafe("FETCH FORWARD 1024 FROM goalspec_audit_cursor");
          if (!batch.length) break;
          for (const value of batch) { digest.update(value.row_hash + "\n"); rows++; bytes += value.bytes; }
        }
        await tx.$executeRawUnsafe("CLOSE goalspec_audit_cursor");
        result.push({ schema: name.schemaname, table: name.tablename, rows, bytes, rowTextSha256: digest.digest("hex"), columnsSha256: sha(JSON.stringify(columns)) });
      }
      return result;
    }, { maxWait: 10000, timeout: 600000 });
    const receipt = { schemaVersion: 1, auditVersion: "goalspec-legacy-row-audit-v4", readOnly: true,
      database: "goalspec_research", excludedSchema: "goalspec_archive_v4", rowRepresentation: "SHA256 of each PostgreSQL UTF8 row_to_json text; sorted row hashes plus LF aggregated with SHA256; UTC session",
      scope: "Existing user-table rows and column definitions; not database physical files, sequence state, roles, or all catalog objects",
      tables, aggregateSha256: sha(JSON.stringify(tables)) };
    writeFileSync(target, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    process.stdout.write(JSON.stringify({ tables: tables.length, rows: tables.reduce((sum, row) => sum + row.rows, 0), aggregateSha256: receipt.aggregateSha256 }) + "\n");
  } finally { await db.$disconnect(); }
}
main().catch(() => { process.stderr.write("Research read-only table audit failed; database diagnostics were suppressed.\n"); process.exitCode = 1; });
