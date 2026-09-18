import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { canonical } from "../src/lib/goalspec/canonical";

export const IMPORTER_VERSION = "goalspec-native-archive-import-v3.1";
const TABLES = ["cohort_manifest", "artifact_file", "artifact_record"] as const;
type Table = typeof TABLES[number];
type ObjectRow = Record<string, unknown>;
type ExportFile = { table: Table; filename: string; format: "canonical-jsonl" | "parquet"; rows: number; bytes: number; sha256: string };
type ExportManifest = { schemaVersion: number; archiveId: string; exporterVersion: string; status: string; contract: string;
  parquetRoundTripVerified: boolean; originalSourceRoundTripVerified: boolean; files: ExportFile[] };
const digest = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const safeHash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function object(value: unknown): ObjectRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Archive row must be an object");
  return value as ObjectRow;
}

export function guardedArchiveDatabaseUrl(value: string, applicationUrl?: string) {
  const url = new URL(value);
  if (!/^postgres(ql)?:$/.test(url.protocol) || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/goalspec_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash)
    throw new Error("Explicit loopback dedicated goalspec_ database without URL query overrides required");
  if (applicationUrl) {
    const application = new URL(applicationUrl);
    const local = ["127.0.0.1", "localhost", "[::1]"];
    if ((application.hostname === url.hostname || local.includes(application.hostname))
      && (application.port || "5432") === (url.port || "5432") && application.pathname === url.pathname)
      throw new Error("Archive must not use the application database");
  }
  return url.toString();
}

async function fileDigest(path: string) {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest("hex"), bytes };
}

/** Hash the exact consumed stream, including final newline, on both validation and import passes. */
async function* canonicalRows(directory: string, file: ExportFile) {
  const stream = createReadStream(join(directory, file.filename));
  const hash = createHash("sha256"); let bytes = 0, rows = 0;
  stream.on("data", (chunk: string | Buffer) => { hash.update(chunk); bytes += Buffer.byteLength(chunk); });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const payload = object(JSON.parse(line));
      if (canonical(payload) !== line) throw new Error("Archive JSONL is not canonical RFC8785");
      rows++;
      yield { payload, canonical_utf8: line, row_sha256: digest(line), row_index: rows - 1 };
    }
    if (rows !== file.rows || bytes !== file.bytes || hash.digest("hex") !== file.sha256)
      throw new Error("Archive file hash, size or row count changed");
  } finally { lines.close(); stream.destroy(); }
}

export async function validateArchive(directory: string, expectedManifestSha256: string) {
  const target = resolve(directory), manifestBytes = readFileSync(join(target, "manifest.json"));
  if (!safeHash(expectedManifestSha256) || digest(manifestBytes) !== expectedManifestSha256) throw new Error("Archive manifest hash mismatch");
  const manifest = object(JSON.parse(manifestBytes.toString("utf8"))) as unknown as ExportManifest;
  if (manifest.schemaVersion !== 1 || !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.archiveId)
    || manifest.exporterVersion !== "goalspec-native-artifact-export-v3" || manifest.status !== "complete"
    || manifest.contract !== "official-native-v3-archive" || !manifest.parquetRoundTripVerified || !manifest.originalSourceRoundTripVerified
    || !Array.isArray(manifest.files) || manifest.files.length !== 6) throw new Error("Unsupported or incomplete archive manifest");
  const seen = new Set<string>(), files = {} as Record<Table, ExportFile>;
  for (const file of manifest.files) {
    if (!TABLES.includes(file.table) || !["canonical-jsonl", "parquet"].includes(file.format)
      || file.filename !== `${file.table}.${file.format === "parquet" ? "parquet" : "jsonl"}`
      || seen.has(file.filename) || !integer(file.rows) || !integer(file.bytes) || !safeHash(file.sha256)) throw new Error("Invalid archive file declaration");
    seen.add(file.filename);
    if (file.format === "canonical-jsonl") files[file.table] = file;
    else {
      const actual = await fileDigest(join(target, file.filename));
      if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error("Archive Parquet hash mismatch");
    }
  }
  for (const table of TABLES) {
    if (!files[table] || manifest.files.find(file => file.table === table && file.format === "parquet")?.rows !== files[table].rows)
      throw new Error("Archive JSONL/Parquet table pairing mismatch");
  }
  const cohorts = new Map<string, { runIds: Set<string>; arms: Set<string> }>();
  for await (const { payload } of canonicalRows(target, files.cohort_manifest)) {
    if (!safeHash(payload.cohort_id) || cohorts.has(payload.cohort_id) || payload.contract !== "official-native-v3-archive"
      || !Array.isArray(payload.run_ids) || !payload.run_ids.length || payload.run_ids.some(id => typeof id !== "string")
      || new Set(payload.run_ids).size !== payload.run_ids.length || !Array.isArray(payload.arms)
      || payload.arms.some(arm => !["base", "paste", "salesforce", "goalspec"].includes(arm))) throw new Error("Invalid archived cohort");
    cohorts.set(payload.cohort_id, { runIds: new Set(payload.run_ids), arms: new Set(payload.arms) });
  }
  const sources = new Map<string, { cohortId: unknown; expectedBytes: number; expectedRows: number; expectedHash: string; bytes: number; rows: number; hash: ReturnType<typeof createHash> }>();
  for await (const { payload } of canonicalRows(target, files.artifact_file)) {
    if (!safeHash(payload.source_id) || sources.has(payload.source_id) || payload.cohort_id !== null && !cohorts.has(String(payload.cohort_id))
      || !integer(payload.original_bytes) || !integer(payload.records) || !safeHash(payload.original_sha256)) throw new Error("Invalid archived source metadata");
    sources.set(payload.source_id, { cohortId: payload.cohort_id, expectedBytes: payload.original_bytes, expectedRows: payload.records,
      expectedHash: payload.original_sha256, bytes: 0, rows: 0, hash: createHash("sha256") });
  }
  for await (const { payload } of canonicalRows(target, files.artifact_record)) {
    const source = sources.get(String(payload.source_id));
    if (!source || payload.cohort_id !== source.cohortId || payload.source_row !== source.rows || typeof payload.raw_utf8 !== "string")
      throw new Error("Invalid archived record identity or order");
    // Auxiliary worker IDs can include :user or :evaluator. These are archival
    // indexes, never a claim that the row is a separate declared actor trial.
    if ([payload.run_id, payload.arm, payload.event_type].some(value => value !== null && typeof value !== "string"))
      throw new Error("Invalid archived record index");
    const raw = Buffer.from(payload.raw_utf8, "utf8"); source.hash.update(raw); source.bytes += raw.length; source.rows++;
  }
  for (const source of sources.values()) if (source.bytes !== source.expectedBytes || source.rows !== source.expectedRows || source.hash.digest("hex") !== source.expectedHash)
    throw new Error("Archive cannot reconstruct original source bytes");
  return { directory: target, manifest, manifestUtf8: manifestBytes.toString("utf8"), manifestSha256: expectedManifestSha256, files };
}

export async function importArchive(directory: string, expectedManifestSha256: string, receiptPath: string, databaseUrl: string, applicationUrl?: string) {
  if (existsSync(receiptPath)) throw new Error("Import receipt path must be new");
  const url = guardedArchiveDatabaseUrl(databaseUrl, applicationUrl);
  const validated = await validateArchive(directory, expectedManifestSha256);
  const schemaText = readFileSync(fileURLToPath(new URL("../research/goalspec/sql/v3_archive.sql", import.meta.url)), "utf8");
  const db = new PrismaClient({ datasources: { db: { url } } });
  let imported = false;
  try {
    imported = await db.$transaction(async tx => {
      // Serialize schema initialization and all imports. This archive is offline-only.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(738194, 3)`;
      for (const statement of schemaText.split(/^-- statement-break\r?$/m)) if (statement.trim()) await tx.$executeRawUnsafe(statement);
      const previous = await tx.$queryRaw<{ manifest_sha256: string; manifest_utf8: string }[]>(Prisma.sql`
        SELECT manifest_sha256, manifest_utf8 FROM goalspec_v3_archive.archive_import WHERE archive_id=${validated.manifest.archiveId}`);
      if (previous.length) {
        if (previous.length !== 1 || previous[0].manifest_sha256 !== expectedManifestSha256 || previous[0].manifest_utf8 !== validated.manifestUtf8)
          throw new Error("Archive ID already belongs to a different immutable manifest");
      } else {
        await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec_v3_archive.archive_import(archive_id,manifest_sha256,manifest_utf8,payload)
          VALUES (${validated.manifest.archiveId},${expectedManifestSha256},${validated.manifestUtf8},${validated.manifestUtf8}::jsonb)`);
        for (const table of TABLES) {
          let batch: ObjectRow[] = [];
          const flush = async () => {
            if (!batch.length) return;
            const json = JSON.stringify(batch), archiveId = validated.manifest.archiveId;
            if (table === "cohort_manifest") await tx.$executeRaw(Prisma.sql`
              INSERT INTO goalspec_v3_archive.cohort_manifest(archive_id,cohort_id,row_sha256,canonical_utf8,payload,row_index)
              SELECT ${archiveId}, p.payload->>'cohort_id',p.row_sha256,p.canonical_utf8,p.payload,p.row_index
              FROM jsonb_to_recordset(${json}::jsonb) AS p(payload jsonb,row_sha256 text,canonical_utf8 text,row_index bigint)`);
            else if (table === "artifact_file") await tx.$executeRaw(Prisma.sql`
              INSERT INTO goalspec_v3_archive.artifact_file(archive_id,source_id,cohort_id,row_sha256,canonical_utf8,payload,row_index)
              SELECT ${archiveId},p.payload->>'source_id',p.payload->>'cohort_id',p.row_sha256,p.canonical_utf8,p.payload,p.row_index
              FROM jsonb_to_recordset(${json}::jsonb) AS p(payload jsonb,row_sha256 text,canonical_utf8 text,row_index bigint)`);
            else await tx.$executeRaw(Prisma.sql`
              INSERT INTO goalspec_v3_archive.artifact_record(archive_id,source_id,source_row,cohort_id,run_id,arm,event_type,raw_utf8,row_sha256,canonical_utf8,payload,row_index)
              SELECT ${archiveId},p.payload->>'source_id',(p.payload->>'source_row')::bigint,p.payload->>'cohort_id',p.payload->>'run_id',
                p.payload->>'arm',p.payload->>'event_type',p.payload->>'raw_utf8',p.row_sha256,p.canonical_utf8,p.payload,p.row_index
              FROM jsonb_to_recordset(${json}::jsonb) AS p(payload jsonb,row_sha256 text,canonical_utf8 text,row_index bigint)`);
            batch = [];
          };
          for await (const row of canonicalRows(validated.directory, validated.files[table])) { batch.push(row); if (batch.length >= 128) await flush(); }
          await flush();
        }
      }
      const counts = await tx.$queryRaw<{ table_name: Table; records: bigint }[]>(Prisma.sql`
        SELECT 'cohort_manifest' AS table_name,count(*) AS records FROM goalspec_v3_archive.cohort_manifest WHERE archive_id=${validated.manifest.archiveId}
        UNION ALL SELECT 'artifact_file',count(*) FROM goalspec_v3_archive.artifact_file WHERE archive_id=${validated.manifest.archiveId}
        UNION ALL SELECT 'artifact_record',count(*) FROM goalspec_v3_archive.artifact_record WHERE archive_id=${validated.manifest.archiveId}`);
      if (counts.length !== 3 || counts.some(row => Number(row.records) !== validated.files[row.table_name].rows)) throw new Error("Imported archive table count mismatch");
      // Read back the database representation in bounded batches. A successful
      // insert/count alone is not a roundtrip proof of the stored source text.
      for (const table of TABLES) {
        const hash = createHash("sha256"); let position = 0;
        while (position < validated.files[table].rows) {
          const stored = await tx.$queryRaw<{ row_index: bigint; canonical_utf8: string; row_sha256: string; raw_utf8: string | null }[]>(Prisma.sql`
            SELECT row_index,canonical_utf8,row_sha256,${table === "artifact_record" ? Prisma.raw("raw_utf8") : Prisma.raw("NULL::text AS raw_utf8")}
            FROM ${Prisma.raw(`goalspec_v3_archive.${table}`)} WHERE archive_id=${validated.manifest.archiveId}
            AND row_index >= ${position} ORDER BY row_index LIMIT 128`);
          if (!stored.length) throw new Error("Database archival row missing");
          for (const row of stored) {
            if (Number(row.row_index) !== position++ || digest(row.canonical_utf8) !== row.row_sha256
              || table === "artifact_record" && object(JSON.parse(row.canonical_utf8)).raw_utf8 !== row.raw_utf8)
              throw new Error("Database archival row content mismatch");
            hash.update(row.canonical_utf8 + "\n");
          }
        }
        if (hash.digest("hex") !== validated.files[table].sha256) throw new Error("Database JSONL roundtrip hash mismatch");
      }
      if (digest(readFileSync(join(validated.directory, "manifest.json"))) !== expectedManifestSha256) throw new Error("Archive manifest changed during import");
      return previous.length === 0;
    }, { maxWait: 10000, timeout: 600000 });
  } finally { await db.$disconnect(); }
  const receipt = { schemaVersion: 1, importerVersion: IMPORTER_VERSION, archiveId: validated.manifest.archiveId,
    manifestSha256: expectedManifestSha256, schemaSha256: digest(schemaText), status: imported ? "imported" : "already_present",
    databaseSchema: "goalspec_v3_archive", tables: Object.fromEntries(TABLES.map(table => [table, validated.files[table].rows])),
    exactOriginalSourceRoundTripVerified: true, databaseJsonlRoundTripVerified: true, appendOnly: true, legacyTablesModified: false,
    paidApiCalls: 0, ledgerOpened: false };
  writeFileSync(receiptPath, canonical(receipt) + "\n", { flag: "wx" });
  return receipt;
}

async function main() {
  const [command, directory, manifestSha256, receiptPath] = process.argv.slice(2);
  if (!directory || !manifestSha256 || !["inspect", "import"].includes(command)) throw new Error("Usage: goalspec-import-archive-v3.ts inspect ARCHIVE MANIFEST_SHA256 | import ARCHIVE MANIFEST_SHA256 NEW_RECEIPT.json");
  if (command === "inspect") {
    const result = await validateArchive(directory, manifestSha256);
    process.stdout.write(JSON.stringify({ archiveId: result.manifest.archiveId, status: "verified", databaseAccessed: false, paidApiCalls: 0 }) + "\n");
  } else {
    if (!receiptPath || !process.env.GOALSPEC_ARCHIVE_DATABASE_URL) throw new Error("New receipt and dedicated GOALSPEC_ARCHIVE_DATABASE_URL are required");
    process.stdout.write(JSON.stringify(await importArchive(directory, manifestSha256, receiptPath, process.env.GOALSPEC_ARCHIVE_DATABASE_URL, process.env.DATABASE_URL)) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => {
  // Driver diagnostics can contain connection URLs. Never print unfiltered provider errors.
  process.stderr.write("Archive import/verification failed; no credentials or database error details were logged.\n"); process.exitCode = 1;
});
