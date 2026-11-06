/** Verify frozen public annotation cohorts without imposing historical lineage. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { canonical, hash } from "../src/lib/goalspec/canonical";

const VERSION = "goalspec-infra-data-v1";
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const jsonl = (path: string) => readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
interface FileEntry { sha256: string; rows?: number | null }
interface Manifest { schema_version: string; bundle_hash: string; files: Record<string, FileEntry> }
interface Source { id: string; kind: string; value: unknown }
export interface AnnotationSourceRow {
  checkpoint_id: string; input_hash: string; request_revision: string;
  input: { policy: string; tools: unknown[]; events: unknown[]; sources: Source[] };
}
interface PublicRow extends AnnotationSourceRow { schema_version: string; episode_id: string; family_id: string; split: string }
interface Metadata { episode_id: string; family_id: string; verification_tier: string; [key: string]: unknown }
interface Split { schema_version: string; families: Record<string, string>; episodes: Record<string, string>; metadata_hash: string }
interface Declaration {
  schema_version: string; pilot_count: number; audit_count: number;
  checkpoints: { checkpoint_id: string; input_hash: string }[];
  audit: { checkpoint_id: string; reason: string }[];
  source_dataset_hash?: string; source_split_hash?: string;
}

function verifiedManifest(directory: string, required: string[]): Manifest {
  const manifest = json(join(directory, "manifest.json")) as Manifest;
  if (manifest.schema_version !== VERSION || !manifest.files || manifest.bundle_hash !== hash(manifest.files)
    || required.some(name => !Object.hasOwn(manifest.files, name))) throw new Error("Invalid annotation bundle manifest");
  for (const [name, entry] of Object.entries(manifest.files)) {
    if (basename(name) !== name || /[\\/]/.test(name) || name === "." || name === ".." || name === "manifest.json"
      || !entry || !/^[0-9a-f]{64}$/.test(entry.sha256)
      || createHash("sha256").update(readFileSync(join(directory, name))).digest("hex") !== entry.sha256) throw new Error("Annotation artifact changed");
    if (name.endsWith(".jsonl") && typeof entry.rows === "number" && jsonl(join(directory, name)).length !== entry.rows) throw new Error("Annotation artifact row count changed");
  }
  return manifest;
}

/** No evaluator results or future action labels are returned to the teacher. */
export function verifyInfraAnnotationSource(pilotDirectory: string, datasetDirectory = pilotDirectory) {
  const manifest = verifiedManifest(pilotDirectory, ["pilot.json", "annotation-inputs.jsonl"]);
  const dataset = verifiedManifest(datasetDirectory, ["public.jsonl", "split.json", "metadata.jsonl"]);
  const declaration = json(join(pilotDirectory, "pilot.json")) as Declaration;
  const split = json(join(datasetDirectory, "split.json")) as Split;
  const splitHash = hash(split);
  const separate = resolve(pilotDirectory) !== resolve(datasetDirectory);
  if ((separate || declaration.source_dataset_hash !== undefined) && declaration.source_dataset_hash !== dataset.bundle_hash
    || (separate || declaration.source_split_hash !== undefined) && declaration.source_split_hash !== splitHash) throw new Error("Pilot source dataset or split binding mismatch");
  const metadata = jsonl(join(datasetDirectory, "metadata.jsonl")) as Metadata[];
  const episodes = new Map(metadata.map(row => [row.episode_id, row]));
  if (split.schema_version !== VERSION || !split.episodes || !split.families || episodes.size !== metadata.length
    || metadata.some(row => !row.episode_id || !row.family_id || !["native_verified", "independent_replay", "source_reported", "unverified"].includes(row.verification_tier))
    || split.metadata_hash !== hash([...metadata].sort((a, b) => a.episode_id < b.episode_id ? -1 : a.episode_id > b.episode_id ? 1 : 0))
    || canonical(split.episodes) !== canonical(Object.fromEntries(metadata.map(row => [row.episode_id, row.family_id])))
    || canonical(Object.keys(split.families).sort()) !== canonical([...new Set(metadata.map(row => row.family_id))].sort())
    || Object.values(split.families).some(value => !["train", "development", "test"].includes(value))) throw new Error("Annotation family split or metadata changed");
  const publicRows = jsonl(join(datasetDirectory, "public.jsonl")) as PublicRow[];
  const publicById = new Map(publicRows.map(row => [row.checkpoint_id, row]));
  if (publicById.size !== publicRows.length || publicRows.some(row => row.schema_version !== VERSION
    || !row.checkpoint_id || row.input_hash !== hash(row.input) || !row.request_revision
    || episodes.get(row.episode_id)?.family_id !== row.family_id || split.families[row.family_id] !== row.split)) throw new Error("Public prefix hash or split mismatch");
  const rows = jsonl(join(pilotDirectory, "annotation-inputs.jsonl")) as AnnotationSourceRow[];
  if (declaration.schema_version !== VERSION || !rows.length || rows.length > 100 || rows.length !== declaration.pilot_count
    || canonical(rows.map(row => ({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash }))) !== canonical(declaration.checkpoints)
    || new Set(rows.map(row => row.checkpoint_id)).size !== rows.length) throw new Error("Annotation cohort declaration mismatch");
  for (const row of rows) {
    const original = publicById.get(row.checkpoint_id);
    if (!original || original.split !== "train") throw new Error("Annotation checkpoint must belong to a declared training family");
    const projected: AnnotationSourceRow = { checkpoint_id: original.checkpoint_id, input_hash: original.input_hash,
      request_revision: original.request_revision, input: original.input };
    if (canonical(row) !== canonical(projected)) throw new Error("Annotation input differs from frozen public prefix");
  }
  if (!Number.isInteger(declaration.audit_count) || declaration.audit_count < 1 || declaration.audit_count > rows.length
    || !Array.isArray(declaration.audit) || declaration.audit.length !== declaration.audit_count
    || new Set(declaration.audit.map(row => row.checkpoint_id)).size !== declaration.audit_count
    || declaration.audit.some(row => !rows.some(input => input.checkpoint_id === row.checkpoint_id) || !row.reason)) throw new Error("Human audit declaration mismatch");
  const verificationTiers = [...new Set(rows.map(row => episodes.get(publicById.get(row.checkpoint_id)!.episode_id)!.verification_tier))].sort();
  return { manifest, declaration, rows, sourceDatasetHash: dataset.bundle_hash, sourceSplitHash: splitHash, verificationTiers };
}
