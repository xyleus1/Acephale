import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { hash } from "../src/lib/goalspec/canonical";
import { researchDatabase } from "../src/lib/goalspec/postgres-store";
import { PostgresPublicationStore, type DatasetRecord, type EpisodeRecord, type VerificationRecord, type SnapshotPublication } from "../src/lib/goalspec/postgres-publication";
import { validateGoals } from "../src/lib/goalspec/compiler";

function load<T>(path: string): T { return JSON.parse(readFileSync(path, "utf8")); }
function sha(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
async function main() {
  const [operation, argument, output] = process.argv.slice(2);
  if (!process.env.GOALSPEC_DATABASE_URL || !argument) throw new Error("Set GOALSPEC_DATABASE_URL; usage: goalspec-repository.ts import-corpus|import-native|publish|inspect INPUT [OUTPUT]");
  const db = researchDatabase(process.env.GOALSPEC_DATABASE_URL, process.env.DATABASE_URL);
  const store = new PostgresPublicationStore(db);
  try {
    let result: unknown;
    if (operation === "import-corpus") {
      const directory = resolve(argument), manifestPath = join(directory, "manifest.json"), episodesPath = join(directory, "episodes.jsonl");
      const source = load<{ source: string; revision: string; source_hash: string; license: string; license_text: string; parser_version: string; counts: { raw: number; admitted: number }; native_executable_count: number }>(manifestPath);
      if (source.native_executable_count !== 0) throw new Error("Corpus importer preserves source-reported verification only");
      const dataset: DatasetRecord = { id: `${source.source}@${source.revision}`, source: source.source, revision: source.revision,
        contentHash: source.source_hash, license: source.license, parserVersion: source.parser_version,
        rawCount: source.counts.raw, admittedCount: source.counts.admitted,
        metadata: { manifestPath, manifestFileHash: sha(manifestPath), licenseText: source.license_text, nativeExecutableCount: 0, familyTaxonomy: "provisional-visible-request-v1" } };
      const episodes: EpisodeRecord[] = []; let line = 0;
      for await (const text of createInterface({ input: createReadStream(episodesPath), crlfDelay: Infinity })) {
        line++; if (!text.trim()) continue;
        const row = JSON.parse(text);
        if (row.native_executable || row.verification_tier !== "source_reported") throw new Error("Unverified corpus record cannot be native executable");
        episodes.push({ id: row.id, datasetId: dataset.id, sourceId: row.source_id, domain: row.family_id.split(":")[0], familyId: row.family_id,
          split: row.split, environmentVersion: `source:${source.source}@${source.revision}`, toolSchemaHash: hash(row.tools), verificationTier: "source_reported",
          transcriptUri: `${episodesPath}#L${line}`, contentHash: row.content_hash,
          metadata: { nativeExecutable: false, source: row.source, revision: row.revision, license: row.license, licenseText: row.license_text,
            sourceLine: line, sourceRecordHash: hash(row), familyTaxonomy: "provisional-visible-request-v1" } });
      }
      result = await store.importDataset(dataset, episodes);
    } else if (operation === "import-native") {
      const bundle = load<{ dataset: DatasetRecord; episodes: EpisodeRecord[]; verifications: (VerificationRecord & { verifierCodeUri?: string })[] }>(resolve(argument));
      for (const episode of bundle.episodes) {
        if (sha(episode.transcriptUri) !== episode.contentHash) throw new Error("Native transcript artifact hash mismatch");
      }
      for (const verification of bundle.verifications) {
        const codePath = verification.verifierCodeUri ?? process.argv[5];
        if (!codePath) throw new Error("Pass the independent verifier code path after the output path, or include verifierCodeUri in each verification");
        if (sha(verification.evidenceUri) !== verification.evidenceHash || sha(resolve(codePath)) !== verification.verifierCodeHash) throw new Error("Independent verifier artifact hash mismatch");
      }
      result = await store.importDataset(bundle.dataset, bundle.episodes);
      for (const verification of bundle.verifications) {
        const previous = await db.$queryRaw<{ evidence_hash: string; verifier_code_hash: string }[]>`SELECT evidence_hash,verifier_code_hash FROM goalspec.episode_verification WHERE episode_id = ${verification.episodeId}`;
        if (!previous.length) await store.recordVerification(verification);
        else if (previous[0].evidence_hash !== verification.evidenceHash || previous[0].verifier_code_hash !== verification.verifierCodeHash) throw new Error("Immutable verification conflict");
      }
    } else if (operation === "import-annotations") {
      const records = readFileSync(resolve(argument), "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
      const queuePath = output;
      if (!queuePath) throw new Error("Annotation import requires records.jsonl and original annotation-pilot.jsonl");
      const queue = new Map(readFileSync(resolve(queuePath), "utf8").trim().split(/\r?\n/).map(line => { const row = JSON.parse(line); return [row.episode_id, row]; }));
      let imported = 0, failed = 0;
      for (const row of records) {
        if (row.annotation_status !== "validated") { failed++; continue; }
        const visible = queue.get(row.episode_id);
        if (!visible || visible.split !== "train" || row.split !== "train" || row.teacher_model !== "gpt-5.4-2026-03-05" || row.independent_replay_verified !== false || row.verification_tier !== "source_reported") throw new Error("Invalid annotation lineage");
        const sources = { checkpoint: JSON.parse(visible.visible_input_json) };
        if (hash(sources) !== row.visible_input_hash) throw new Error("Annotation visible checkpoint hash mismatch");
        validateGoals(row.requested_goals, sources);
        await store.annotate(row.episode_id, 0, row.visible_input_hash, row.teacher_model,
          { ...row, sourceArtifact: resolve(argument), sourceArtifactHash: sha(resolve(argument)), queueArtifact: resolve(queuePath), queueArtifactHash: sha(resolve(queuePath)) });
        imported++;
      }
      result = { importedValidatedAnnotations: imported, excludedFailedAnnotations: failed, nativeExecutableUpgrades: 0 };
    } else if (operation === "publish") result = await store.publish(load<SnapshotPublication>(resolve(argument)));
    else if (operation === "inspect") {
      result = { database: (await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0].name,
        counts: await db.$queryRaw`SELECT 'dataset_manifest' AS name,count(*)::integer AS count FROM goalspec.dataset_manifest UNION ALL SELECT 'episode',count(*)::integer FROM goalspec.episode UNION ALL SELECT 'verification',count(*)::integer FROM goalspec.episode_verification UNION ALL SELECT 'annotation',count(*)::integer FROM goalspec.goal_annotation UNION ALL SELECT 'pattern',count(*)::integer FROM goalspec.workflow_pattern UNION ALL SELECT 'embedding',count(*)::integer FROM goalspec.pattern_embedding UNION ALL SELECT 'snapshot',count(*)::integer FROM goalspec.repository_snapshot`,
        verificationTiers: await db.$queryRaw`SELECT verification_tier,count(*)::integer AS count FROM goalspec.episode GROUP BY verification_tier`,
        snapshots: await db.$queryRaw`SELECT id,content_hash,publication_state,manifests FROM goalspec.repository_snapshot ORDER BY id` };
    } else throw new Error("Unknown repository operation");
    const serialized = JSON.stringify(result, null, 2) + "\n";
    if (output && operation !== "import-annotations") writeFileSync(resolve(output), serialized, { flag: "wx" });
    process.stdout.write(serialized);
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Repository operation failed"); process.exitCode = 1; });
