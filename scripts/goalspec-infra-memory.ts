/** Bridge an audited historical pilot to the existing frozen runtime memory. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { validateMemoryArtifact } from "../src/lib/goalspec/experience-memory";
import { buildV5Memory, type V5MemoryBuildPlan } from "./goalspec-build-memory-v5";

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

export function verifyInfraPilotBundle(directory: string) {
  const manifest = json(join(directory, "manifest.json"));
  if (manifest.schema_version !== "goalspec-infra-data-v1" || manifest.bundle_hash !== hash(manifest.files)) throw new Error("Invalid pilot manifest");
  for (const [name, metadata] of Object.entries(manifest.files) as [string, { sha256: string }][]) {
    if (basename(name) !== name || sha(join(directory, name)) !== metadata.sha256) throw new Error("Pilot artifact changed");
  }
  const split = json(join(directory, "split.json"));
  const memory = json(join(directory, "memory.json"));
  const lineage = json(join(directory, "lineage.json"));
  const { snapshot_hash, ...memoryBody } = memory;
  if (memory.snapshot_hash !== hash(memoryBody) || memory.split_hash !== hash(split) || memory.frozen !== true
    || split.fresh_heldout !== false || lineage.fresh_heldout !== false || lineage.fresh_qwen_traces !== false) throw new Error("Historical pilot identity mismatch");
  const expected = Object.entries(split.families).filter(([, partition]) => partition === "train").map(([family]) => family).sort();
  if (canonical(expected) !== canonical([...memory.training_families].sort())) throw new Error("Pilot fitting families mismatch");
  const metadata = readFileSync(join(directory, "metadata.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  return { manifest, split, memory, lineage, expected, metadata };
}

export function bridgeInfraMemory(pilotDirectory: string, historicalPlanPath: string, output: string) {
  if (existsSync(output)) throw new Error("Runtime memory output must be a new directory");
  const pilot = verifyInfraPilotBundle(pilotDirectory);
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

if (process.argv[1]?.endsWith("goalspec-infra-memory.ts")) {
  if (!process.argv[2] || !process.argv[3] || !process.argv[4]) throw new Error("Usage: goalspec-infra-memory.ts PILOT_DIRECTORY HISTORICAL_MEMORY_PLAN NEW_OUTPUT_DIRECTORY");
  console.log(JSON.stringify(bridgeInfraMemory(resolve(process.argv[2]), resolve(process.argv[3]), resolve(process.argv[4])), null, 2));
}
