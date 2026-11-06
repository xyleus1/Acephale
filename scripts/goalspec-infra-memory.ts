/** Bridge audited historical or fresh native inputs to frozen runtime memory. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { buildMemoryArtifact, validateMemoryArtifact, type MemoryMessage, type MemoryRun } from "../src/lib/goalspec/experience-memory";
import { INFRA_MODEL_PINS } from "../src/lib/goalspec/infra-manifest";
import { extractMemoryEpisodes } from "./goalspec-build-memory-v3";
import { buildV5Memory, type V5MemoryBuildPlan } from "./goalspec-build-memory-v5";

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

export function verifyInfraPilotBundle(directory: string) {
  const manifest = json(join(directory, "manifest.json"));
  if (manifest.schema_version !== "goalspec-infra-data-v1" || manifest.bundle_hash !== hash(manifest.files)) throw new Error("Invalid pilot manifest");
  if (["split.json", "memory.json", "lineage.json", "metadata.jsonl"].some(name => !manifest.files[name])) throw new Error("Incomplete pilot manifest");
  for (const [name, metadata] of Object.entries(manifest.files) as [string, { sha256: string }][]) {
    if (basename(name) !== name || sha(join(directory, name)) !== metadata.sha256) throw new Error("Pilot artifact changed");
  }
  const split = json(join(directory, "split.json"));
  const memory = json(join(directory, "memory.json"));
  const lineage = json(join(directory, "lineage.json"));
  const { snapshot_hash, ...memoryBody } = memory;
  if (memory.snapshot_hash !== hash(memoryBody) || memory.split_hash !== hash(split) || memory.frozen !== true
    || split.fresh_heldout !== false || lineage.fresh_heldout !== false) throw new Error("Pilot identity mismatch");
  const expected = Object.entries(split.families).filter(([, partition]) => partition === "train").map(([family]) => family).sort();
  if (lineage.fresh_qwen_traces === true) {
    if (lineage.version !== "goalspec-infra-fresh-native-v1" || canonical(lineage.actor) !== canonical(INFRA_MODEL_PINS.actor)
      || lineage.all_declared_slots_retained !== true || !/^[a-f0-9]{64}$/.test(lineage.cohort_receipt_sha256)
      || ["runtime-runs.jsonl", "cohort-receipt.json", "trajectories.jsonl", "public.jsonl", "labels.jsonl", "verdicts.jsonl"].some(name => !manifest.files[name])
      || memory.training_families.some((family: string) => !expected.includes(family))) throw new Error("Fresh pilot lineage mismatch");
    if (hash(json(join(directory, "cohort-receipt.json"))) !== lineage.cohort_receipt_hash) throw new Error("Fresh cohort receipt changed");
  } else if (lineage.fresh_qwen_traces !== false || canonical(expected) !== canonical([...memory.training_families].sort())) throw new Error("Pilot fitting families mismatch");
  const metadata = readFileSync(join(directory, "metadata.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  if (lineage.fresh_qwen_traces === true) {
    const byId = new Map(metadata.map((row: any) => [row.episode_id, row]));
    const rows = readFileSync(join(directory, "public.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    for (const row of rows) {
      const meta: any = byId.get(row.episode_id), source = lineage.fresh_sources?.[row.episode_id];
      if (!meta || !source || row.family_id !== meta.family_id || row.split !== split.families[row.family_id]
        || row.runtime_tool_schema_hash !== source.original_tool_schema_hash || row.tool_schema_hash !== meta.tool_schema_hash
        || row.environment_version !== meta.environment_version || canonical(row.scope) !== canonical(meta.scope)
        || hash(row.input) !== row.input_hash) throw new Error("Fresh public checkpoint scope or source mismatch");
    }
  }
  return { manifest, split, memory, lineage, expected, metadata };
}

export function bridgeInfraMemory(pilotDirectory: string, historicalPlanPath: string, output: string) {
  if (existsSync(output)) throw new Error("Runtime memory output must be a new directory");
  const pilot = verifyInfraPilotBundle(pilotDirectory);
  if (pilot.lineage.fresh_qwen_traces !== false) throw new Error("Use the fresh bridge for fresh native inputs");
  const original = json(historicalPlanPath) as V5MemoryBuildPlan;
  if (original.version !== "goalspec-memory-build-v5" || original.cohorts.length !== 1) throw new Error("Expected a single closed historical cohort plan");
  const excluded = Object.keys(pilot.split.families).filter(family => !pilot.expected.includes(family));
  const plan: V5MemoryBuildPlan = { version: "goalspec-memory-build-v5", snapshotId: `infra-historical:${pilot.manifest.bundle_hash}`,
    heldoutFamilies: [...new Set([...original.heldoutFamilies, ...excluded])].sort(), cohorts: original.cohorts };
  if (pilot.expected.some(family => plan.heldoutFamilies.includes(family))) throw new Error("Historical plan excludes a fitting family");
  mkdirSync(output, { recursive: true });
  const report = buildV5Memory(plan, join(output, "runtime"));
  const artifact = validateMemoryArtifact(json(join(output, "runtime/artifact.json")));
  if (canonical(report.families) !== canonical(pilot.expected)) throw new Error("Runtime memory fitting families changed");
  const metadata = new Map(pilot.metadata.map((row: any) => [row.episode_id, row]));
  for (const run of artifact.runs) {
    const row: any = metadata.get(run.id);
    const origin = pilot.lineage.historical_sources[run.id];
    if (!row || !origin || run.scope.tenantId !== row.scope.tenant_id || run.scope.principalId !== row.scope.principal_id
      || run.scope.authorizationVersion !== row.scope.authorization_revision || run.scope.environmentVersion !== row.environment_version
      || run.scope.toolSchemaHash !== origin.original_tool_schema_hash
      || !run.sourceFiles.some(file => file.sha256 === origin.raw_sha256)) throw new Error("Runtime source or authorization scope differs from audited pilot");
  }
  const receipt = { version: "goalspec-infra-runtime-memory-bridge-v1", pilotBundleHash: pilot.manifest.bundle_hash,
    historicalPlanSha256: sha(historicalPlanPath), contentHash: artifact.contentHash, snapshotId: artifact.repositorySnapshotId,
    runs: artifact.runs.length, episodes: artifact.episodes.length, families: report.families,
    runtimeArtifactPath: resolve(output, "runtime/artifact.json"), freshHeldout: false, freshQwenTraces: false,
    label: "Historical Base training memory, not a new live benchmark result" };
  verifyInfraPilotBundle(pilotDirectory);
  writeFileSync(join(output, "bridge-receipt.json"), canonical(receipt) + "\n", { flag: "wx" });
  return receipt;
}

export function bridgeFreshInfraMemory(bundleDirectory: string, output: string) {
  if (existsSync(output)) throw new Error("Runtime memory output must be a new directory");
  const bundle = verifyInfraPilotBundle(bundleDirectory);
  if (bundle.lineage.fresh_qwen_traces !== true) throw new Error("Fresh native bundle required");
  const rows = readFileSync(join(bundleDirectory, "runtime-runs.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const metadata = new Map(bundle.metadata.map((row: any) => [row.episode_id, row]));
  const ids = rows.map(row => row.id);
  if (new Set(ids).size !== ids.length || canonical([...ids].sort()) !== canonical([...metadata.keys()].sort())
    || canonical([...ids].sort()) !== canonical(Object.keys(bundle.lineage.fresh_sources).sort())
    || rows.length !== bundle.lineage.episodes) throw new Error("Fresh declared runs were omitted or repeated");
  const sourceFiles = ["manifest.json", "runtime-runs.jsonl", "metadata.jsonl", "lineage.json", "cohort-receipt.json"].map(name => ({
    path: resolve(bundleDirectory, name), sha256: sha(join(bundleDirectory, name)) }));
  const runs: MemoryRun[] = [], episodes = [], exclusions: { runId: string; reason: string }[] = [];
  for (const row of rows) {
    const meta: any = metadata.get(row.id), source = bundle.lineage.fresh_sources[row.id];
    if (meta.family_id !== row.familyId || bundle.split.families[row.familyId] !== row.split
      || row.scope.tenantId !== meta.scope.tenant_id || row.scope.principalId !== meta.scope.principal_id
      || row.scope.authorizationVersion !== meta.scope.authorization_revision || row.scope.environmentVersion !== meta.environment_version
      || row.scope.toolSchemaHash !== source.original_tool_schema_hash || row.rawSha256 !== source.raw_sha256) throw new Error("Fresh runtime scope or source mismatch");
    const eligible = row.split === "train" && row.success === true && row.outcomeVerified === true && row.constraintViolations === 0;
    if (row.memoryEligible !== eligible) throw new Error("Fresh endpoint eligibility mismatch");
    if (!eligible) { exclusions.push({ runId: row.id, reason: row.split !== "train" ? "not_training" : "endpoint_not_verified_success_with_zero_violations" }); continue; }
    if (meta.verification_tier !== "native_verified" || !Array.isArray(row.messages)) throw new Error("Fresh endpoint lacks verified public messages");
    const run: MemoryRun = { id: row.id, familyId: row.familyId, stage: "v5-training", split: "train", scope: row.scope,
      policyHash: row.policyHash, sourceFiles, success: true, outcomeVerified: true, constraintViolations: 0,
      termination: row.termination, publicMessageCount: row.messages.length, episodeCount: 0 };
    const extracted = extractMemoryEpisodes(run, row.messages as MemoryMessage[]);
    run.episodeCount = extracted.length; runs.push(run); episodes.push(...extracted);
  }
  const artifact = buildMemoryArtifact({ repositorySnapshotId: `infra-fresh:${bundle.manifest.bundle_hash}`, sourceFiles, runs, episodes, misses: [] }, { profile: "v5" });
  const receipt = { version: "goalspec-infra-runtime-memory-bridge-v1", pilotBundleHash: bundle.manifest.bundle_hash,
    contentHash: artifact.contentHash, snapshotId: artifact.repositorySnapshotId, runs: runs.length, episodes: episodes.length,
    families: [...new Set(runs.map(run => run.familyId))].sort(), declaredRuns: rows.length, exclusions,
    runtimeArtifactPath: resolve(output, "runtime/artifact.json"), freshHeldout: false, freshQwenTraces: true,
    readyForPrediction: episodes.length > 0, label: "Fresh fixed-Qwen verified successful training endpoints only; failures retained in source dataset" };
  verifyInfraPilotBundle(bundleDirectory);
  if (sourceFiles.some(file => sha(file.path) !== file.sha256)) throw new Error("Fresh source changed during memory build");
  mkdirSync(join(output, "runtime"), { recursive: true });
  writeFileSync(join(output, "runtime/artifact.json"), canonical(artifact) + "\n", { flag: "wx" });
  writeFileSync(join(output, "bridge-receipt.json"), canonical(receipt) + "\n", { flag: "wx" });
  return receipt;
}

if (process.argv[1]?.endsWith("goalspec-infra-memory.ts")) {
  if (!process.argv[2] || !process.argv[3] || !process.argv[4]) throw new Error("Usage: goalspec-infra-memory.ts PILOT_DIRECTORY HISTORICAL_MEMORY_PLAN NEW_OUTPUT_DIRECTORY");
  console.log(JSON.stringify(process.argv[2] === "--fresh"
    ? bridgeFreshInfraMemory(resolve(process.argv[3]), resolve(process.argv[4]))
    : bridgeInfraMemory(resolve(process.argv[2]), resolve(process.argv[3]), resolve(process.argv[4])), null, 2));
}
