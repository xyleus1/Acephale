import { createHash } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { canonical } from "../src/lib/goalspec/canonical";
import { researchDatabase } from "../src/lib/goalspec/postgres-store";

// Static allowlist only. This exporter cannot select application tables.
const TABLES: [string, string[]][] = [
  ["dataset_manifest", ["id"]], ["task_family", ["id"]], ["episode", ["id"]], ["episode_verification", ["episode_id"]],
  ["goal_annotation", ["id"]], ["repository_snapshot", ["id"]], ["snapshot_episode", ["snapshot_id", "episode_id"]],
  ["workflow_pattern", ["snapshot_id", "id"]], ["pattern_embedding", ["snapshot_id", "pattern_id"]],
  ["run_manifest", ["id"]], ["execution_frame", ["run_id", "boundary"]], ["goal_hypothesis", ["run_id", "boundary"]],
  ["evidence_observation", ["run_id", "boundary", "evidence_id"]], ["execution_event", ["run_id", "seq"]],
  ["prediction_record", ["id"]], ["goal_transition_stats", ["snapshot_id", "key"]], ["prediction_confusion", ["id"]],
  ["snapshot_prediction_error", ["snapshot_id", "key"]], ["outcome_verdict", ["run_id"]], ["feedback_application", ["idempotency_key"]],
  ["checkpoint_intervention", ["id"]], ["budget_reservation", ["id"]],
];
const sourceHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function main() {
  const directoryArgument = process.argv[2];
  if (!directoryArgument || !process.env.GOALSPEC_DATABASE_URL) throw new Error("Set GOALSPEC_DATABASE_URL; usage: goalspec-export-repository.ts NEW_OUTPUT_DIRECTORY");
  const directory = resolve(directoryArgument), database = researchDatabase(process.env.GOALSPEC_DATABASE_URL, process.env.DATABASE_URL);
  mkdirSync(directory);
  const files: { table: string; filename: string; rows: number; bytes: number; sha256: string; primaryKey: string[]; format: string }[] = [];
  try {
    const metadata = await database.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      const connection = await tx.$queryRaw<{ database: string; server: string; transaction_snapshot: string; exported_at: string }[]>`
        SELECT current_database() AS database,version() AS server,pg_current_snapshot()::text AS transaction_snapshot,now()::text AS exported_at`;
      const extension = await tx.$queryRaw<{ version: string }[]>`SELECT extversion AS version FROM pg_extension WHERE extname='vector'`;
      if (extension.length !== 1) throw new Error("Actual pgvector extension is required for repository export");
      for (const [table, primaryKey] of TABLES) {
        const filename = `${table}.jsonl`, path = join(directory, filename), descriptor = openSync(path, "wx", 0o600);
        const digest = createHash("sha256"); let rows = 0;
        try {
          // A database cursor bounds memory regardless of corpus/event table size.
          await tx.$executeRawUnsafe(`DECLARE goalspec_export NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS row_json FROM goalspec.${table} t ORDER BY ${primaryKey.join(",")}`);
          for (;;) {
            const batch = await tx.$queryRawUnsafe<{ row_json: string }[]>("FETCH FORWARD 256 FROM goalspec_export");
            if (!batch.length) break;
            for (const item of batch) {
              const row = JSON.parse(item.row_json);
              if (table === "pattern_embedding") {
                row.goal_vector = JSON.parse(row.goal_vector); row.context_vector = JSON.parse(row.context_vector);
              }
              const bytes = Buffer.from(canonical(row) + "\n", "utf8");
              for (let offset = 0; offset < bytes.length;) offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
              digest.update(bytes); rows++;
            }
          }
          await tx.$executeRawUnsafe("CLOSE goalspec_export");
          fsyncSync(descriptor);
        } finally { closeSync(descriptor); }
        files.push({ table, filename, rows, bytes: statSync(path).size, sha256: digest.digest("hex"), primaryKey, format: "canonical-jsonl" });
      }
      return { ...connection[0], pgvectorVersion: extension[0].version };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 300_000, maxWait: 10_000 });
    const manifest = { schemaVersion: 1, exporterVersion: "goalspec-repository-export-v1", status: "jsonl-complete", ...metadata,
      readOnlyTransaction: true, applicationTablesRead: false, repositoryMutations: 0, files,
      sources: { "services/goalspec-runtime/schema.sql": sourceHash(resolve("services/goalspec-runtime/schema.sql")),
        "scripts/goalspec-export-repository.ts": sourceHash(resolve("scripts/goalspec-export-repository.ts")) } };
    writeFileSync(join(directory, "jsonl-manifest.json"), canonical(manifest) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ directory, tables: files.length, rows: files.reduce((sum, file) => sum + file.rows, 0), bytes: files.reduce((sum, file) => sum + file.bytes, 0), status: manifest.status }));
  } finally { await database.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Repository export failed"); process.exitCode = 1; });
