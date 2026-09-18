import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { buildV5Memory, type V5MemoryBuildPlan } from "./goalspec-build-memory-v5";
import { hash } from "../src/lib/goalspec/canonical";
import { buildMemoryArtifact, validateMemoryArtifact } from "../src/lib/goalspec/experience-memory";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-v5-memory-test-"));
  const write = (name: string, value: unknown) => { const path = join(directory, name); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
    return { path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }; };
  const tools = [{ function: { name: "lookup", parameters: { type: "object" } } }];
  const row = { runId: "new-train", arm: "base", familyId: "retail:train", studyStage: "training", success: true, termination: "user_stop" };
  const calibration = { ...row, runId: "new-calibration", familyId: "retail:calibration" };
  const files = {
    "service-manifest.json": write("service-manifest.json", { runs: [{ runId: row.runId, arm: "base", domain: "retail", tools }, { runId: calibration.runId, arm: "base", domain: "retail", tools }] }).sha256,
    "design.json": write("design.json", { version: "goalspec-experiment-v5", studyStage: "training", trials: [{ arm: "base", family: row.familyId }, { arm: "base", family: calibration.familyId }] }).sha256,
    "summary.json": write("summary.json", { serviceExitCode: 0 }).sha256,
    "public-contexts.json": write("public-contexts.json", { [row.runId]: { capturedBeforeExecution: true, policy: "read only", tools } }).sha256,
    "outcomes.jsonl": write("outcomes.jsonl", JSON.stringify(row) + "\n" + JSON.stringify(calibration) + "\n").sha256,
  };
  const fixtureManifest = write("fixtures.json", { generator: "fresh-native-v5", nativeCommit: "pinned", studyStage: "training",
    learningFamilySplit: { [row.familyId]: "train", [calibration.familyId]: "calibration" }, privateTask: "PRIVATE_SENTINEL" });
  write(`${row.runId}.json`, { record: row, finalDatabase: { secret: "PRIVATE_SENTINEL" }, verdict: { success: true, constraintViolations: 0 },
    simulation: { messages: [{ role: "assistant", content: "Hello" }, { role: "user", content: "Read record A" },
      { role: "assistant", content: null, tool_calls: [{ id: "call", name: "lookup", arguments: { id: "A" } }] },
      { role: "tool", id: "call", content: '{"id":"A","status":"ready"}' }, { role: "assistant", content: "Record A is ready." }] } });
  const plan: V5MemoryBuildPlan = { version: "goalspec-memory-build-v5", snapshotId: "new-frozen", heldoutFamilies: [], cohorts: [{ directory, files, fixtureManifest }] };
  const close = () => { const root = resolve(tmpdir()) + sep, target = resolve(directory); if (!target.startsWith(root) || !target.includes("goalspec-v5-memory-test-")) throw new Error("Unsafe test cleanup"); rmSync(target, { recursive: true, force: true }); };
  return { directory, plan, write, close };
}
test("v5 builder freezes complete public observations and excludes calibration before trace reads", () => {
  const f = fixture();
  try {
    const result = buildV5Memory(f.plan, join(f.directory, "out"));
    assert.equal(result.runs, 1); assert.equal(result.episodes, 2);
    assert.equal(result.exclusions[0].reason, "calibration_or_heldout_family");
    const raw = readFileSync(join(f.directory, "out/artifact.json"), "utf8"), artifact = validateMemoryArtifact(JSON.parse(raw));
    assert.ok(!raw.includes("PRIVATE_SENTINEL")); assert.equal(artifact.episodes[0].resultingObservations[0].observation && hash(artifact.episodes[0].resultingObservations[0].observation), hash({ id: "A", status: "ready" }));
    assert.ok(artifact.episodes[0].argumentSources[0].sources.some(source => source.method === "substring"));
    assert.throws(() => buildV5Memory(f.plan, join(f.directory, "out")), /new memory build plan/);
  } finally { f.close(); }
});
test("v5 builder rejects changed source bytes and unclosed or development cohorts", () => {
  for (const defect of ["hash", "unclosed", "development"]) {
    const f = fixture();
    try {
      if (defect === "hash") f.write("summary.json", { serviceExitCode: 1 });
      if (defect === "unclosed") f.plan.cohorts[0].files["summary.json"] = f.write("summary.json", { serviceExitCode: 1 }).sha256;
      if (defect === "development") f.plan.cohorts[0].files["design.json"] = f.write("design.json", { studyStage: "development", trials: [] }).sha256;
      assert.throws(() => buildV5Memory(f.plan, join(f.directory, "out")), /hash mismatch|closed Base training/);
    } finally { f.close(); }
  }
});
test("v5 builder excludes a declared selection family before reading its trace", () => {
  const f = fixture();
  try {
    const manifest = JSON.parse(readFileSync(f.plan.cohorts[0].fixtureManifest.path, "utf8"));
    manifest.learningFamilySplit["retail:calibration"] = "train";
    f.plan.cohorts[0].fixtureManifest = f.write("fixtures.json", manifest);
    f.plan.heldoutFamilies = ["retail:calibration"];
    // There is deliberately no trace file for the excluded family. Attempting
    // to inspect it before applying the partition would fail this test.
    const result = buildV5Memory(f.plan, join(f.directory, "out"));
    assert.deepEqual(result.families, ["retail:train"]);
    assert.equal(result.exclusions[0].reason, "calibration_or_heldout_family");
  } finally { f.close(); }
});
test("v5 builder resolves copied historical provenance against its verified source registry", () => {
  const f = fixture();
  try {
    buildV5Memory(f.plan, join(f.directory, "seed"));
    const original = validateMemoryArtifact(JSON.parse(readFileSync(join(f.directory, "seed/artifact.json"), "utf8")));
    const alias = (file: { path: string; sha256: string }) => ({ ...file, path: relative(process.cwd(), file.path) });
    const prior = buildMemoryArtifact({ repositorySnapshotId: "old", sourceFiles: original.sourceFiles.map(alias),
      runs: original.runs.map(run => ({ ...run, stage: "v1-training", sourceFiles: run.sourceFiles.map(alias) })), episodes: original.episodes, misses: [] });
    const plan: V5MemoryBuildPlan = { version: "goalspec-memory-build-v5", snapshotId: "new", heldoutFamilies: [], cohorts: [],
      prior: { artifact: f.write("prior.json", prior), permittedManifest: f.write("permitted.json", { version: "goalspec-controller-dataset-v1", splits: { "retail:train": "train" } }) } };
    const result = buildV5Memory(plan, join(f.directory, "out"));
    assert.equal(result.runs, 1); assert.equal(result.episodes, 2);
    const artifact = validateMemoryArtifact(JSON.parse(readFileSync(join(f.directory, "out/artifact.json"), "utf8")));
    assert.ok(artifact.runs[0].sourceFiles.every(file => file.path === resolve(file.path)));
    assert.equal(prior.runs[0].sourceFiles[0].path, alias(original.runs[0].sourceFiles[0]).path);
  } finally { f.close(); }
});
