import { freshSelectionFixture, multiCohortFixture } from "./test-fixtures/native-parent";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { attachCausalInfraMemory, bridgeFreshFitInfraMemory, bridgeFreshInfraMemory, validateFreshInfraMemoryBinding, verifyInfraPilotBundle } from "./acephale-infra-memory";
import { buildMemoryArtifact, validateMemoryArtifact } from "../src/lib/acephale/experience-memory";
import { INFRA_MODEL_PINS } from "../src/lib/acephale/infra-manifest";

function fixture() {
  const directory = resolve("research/acephale/runs", `infra-memory-test-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const split = { families: { fitting: "train", selection: "development" }, fresh_heldout: false };
  const memoryBody = { frozen: true, split_hash: hash(split), training_families: ["fitting"] };
  const files: Record<string, { sha256: string }> = {};
  const write = (name: string, value: unknown) => {
    const path = join(directory, name);
    writeFileSync(path, name.endsWith(".jsonl") ? `${canonical(value)}\n` : canonical(value));
    files[name] = { sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
  };
  write("split.json", split);
  write("memory.json", { ...memoryBody, snapshot_hash: hash(memoryBody) });
  write("lineage.json", { fresh_heldout: false, fresh_qwen_traces: false });
  write("metadata.jsonl", { episode_id: "one" });
  writeFileSync(join(directory, "manifest.json"), canonical({ schema_version: "acephale-infra-data-v1", files, bundle_hash: hash(files) }));
  return directory;
}

test("runtime bridge verifies pilot bytes and historical-only identity", () => {
  const directory = fixture();
  const pilot = verifyInfraPilotBundle(directory);
  assert.deepEqual(pilot.expected, ["fitting"]);
  writeFileSync(join(directory, "memory.json"), "{}");
  assert.throws(() => verifyInfraPilotBundle(directory), /artifact changed/);
});

test("runtime bridge rejects a tampered manifest", () => {
  const directory = fixture();
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  manifest.bundle_hash = "0".repeat(64);
  writeFileSync(join(directory, "manifest.json"), canonical(manifest));
  assert.throws(() => verifyInfraPilotBundle(directory), /manifest/);
});

test("fresh profile binding accepts exactly the sealed causal derivation and rejects forged suffixes", () => {
  const bundleHash = hash("dataset"), eventsHash = hash("sealed events"), publicHash = hash("sealed public responses");
  const names = ["manifest.json", "runtime-runs.jsonl", "metadata.jsonl", "lineage.json", "cohort-receipt.json"];
  const sourceFiles = names.map(name => ({ path: `C:\\old-host\\bundle\\${name}`, sha256: hash(name) }));
  const bundle = { manifest: { bundle_hash: bundleHash, files: Object.fromEntries(names.map(name => [name, { sha256: hash(name) }])) },
    manifestSha256: hash("manifest.json"), expected: [], lineage: { fresh_qwen_traces: true,
      cohort_files: { "service/events.jsonl": eventsHash, "service/public-boundaries.jsonl": publicHash } } } satisfies Parameters<typeof validateFreshInfraMemoryBinding>[1];
  const base = buildMemoryArtifact({ repositorySnapshotId: `infra-fresh:${bundleHash}`, sourceFiles, runs: [], episodes: [], misses: [] }, { profile: "v5" });
  assert.equal(validateFreshInfraMemoryBinding(base, bundle).kind, "base");
  const causal = buildMemoryArtifact({ ...base,
    repositorySnapshotId: `${base.repositorySnapshotId}:causal:${hash([eventsHash, publicHash])}`,
    sourceFiles: [...sourceFiles, { path: "/moved-artifacts/events.jsonl", sha256: eventsHash }, { path: "/moved-artifacts/public-boundaries.jsonl", sha256: publicHash }],
  }, { profile: "v5" });
  assert.equal(validateFreshInfraMemoryBinding(causal, bundle).kind, "causal");
  const directory = fixture(), causalPath = join(directory, "causal-memory.json");
  writeFileSync(causalPath, canonical(causal));
  assert.throws(() => attachCausalInfraMemory(causalPath, "/nonexistent-cohort", "events.jsonl", "public-boundaries.jsonl", join(directory, "unusable.json")), /cannot be attached again/);
  const forged = buildMemoryArtifact({ ...causal, repositorySnapshotId: `${base.repositorySnapshotId}:causal:${hash("forged")}` }, { profile: "v5" });
  assert.throws(() => validateFreshInfraMemoryBinding(forged, bundle), /derivation identity/);
  const unsealedHash = hash("unsealed events");
  const unsealed = buildMemoryArtifact({ ...causal, repositorySnapshotId: `${base.repositorySnapshotId}:causal:${hash([unsealedHash, publicHash])}`,
    sourceFiles: causal.sourceFiles.map(file => file.sha256 === eventsHash ? { ...file, sha256: unsealedHash } : file) }, { profile: "v5" });
  assert.throws(() => validateFreshInfraMemoryBinding(unsealed, bundle), /derivation identity/);
  const changedDataset = buildMemoryArtifact({ ...base, sourceFiles: sourceFiles.map((file, index) => index === 0 ? { ...file, sha256: hash("changed manifest") } : file) }, { profile: "v5" });
  assert.throws(() => validateFreshInfraMemoryBinding(changedDataset, bundle), /source files/);
});

test("fit-only fresh bridge filters calibration before mining and retains the exact reviewed partition lineage", () => {
  const { directory, partitionPath } = freshSelectionFixture();
  const baseOutput = join(directory, "legacy"), fitOutput = join(directory, "fit-only");
  bridgeFreshInfraMemory(directory, baseOutput);
  const old = JSON.parse(readFileSync(join(baseOutput, "runtime/artifact.json"), "utf8"));
  assert.deepEqual(old.runs.map((row: { familyId: string }) => row.familyId), ["fitting", "calibration"]);
  const receipt = bridgeFreshFitInfraMemory(directory, partitionPath, fitOutput);
  const artifact = validateMemoryArtifact(JSON.parse(readFileSync(join(fitOutput, "runtime/artifact.json"), "utf8")));
  assert.deepEqual(artifact.runs.map(row => row.familyId), ["fitting"]);
  assert.deepEqual(artifact.familySelection!.selectedRunIds, ["run-fitting"]);
  assert.ok(artifact.episodes.length > 0 && artifact.transitions.length > 0);
  assert.ok(!JSON.stringify({ episodes: artifact.episodes, transitions: artifact.transitions, confusions: artifact.confusions }).includes("CALIBRATION_TOOL_SENTINEL"));
  assert.equal(receipt.declaredRuns, 2);
  assert.deepEqual(receipt.exclusions, [{ runId: "run-calibration", reason: "outside_weight_fitting_partition" }]);
  assert.equal(artifact.sourceFiles.length, 8);
  assert.deepEqual(readFileSync(join(fitOutput, "weight-fit-partitions.json")), readFileSync(partitionPath));
  assert.equal(validateFreshInfraMemoryBinding(artifact, verifyInfraPilotBundle(directory)).kind, "weight_fit");
  assert.throws(() => buildMemoryArtifact({ ...old, familySelection: artifact.familySelection,
    sourceFiles: artifact.sourceFiles, repositorySnapshotId: artifact.repositorySnapshotId }, { profile: "v5" }), /outside.*weight fitting/);
});

test("fit-only memory rejects changed reviewed family lists and changed review bytes", () => {
  const first = freshSelectionFixture();
  const reassigned = { ...first.approved, weightFitFamilies: ["calibration"], calibrationFamilies: ["fitting"] };
  writeFileSync(first.partitionPath, canonical({ ...reassigned, contentHash: hash(reassigned) }));
  assert.throws(() => bridgeFreshFitInfraMemory(first.directory, first.partitionPath, join(first.directory, "bad")), /source-reviewed partition/);
  const second = freshSelectionFixture();
  const path = join(second.directory, "source-design-review.json"), review = JSON.parse(readFileSync(path, "utf8"));
  review.historicalAPIGenExcluded = false; writeFileSync(path, canonical(review));
  assert.throws(() => bridgeFreshFitInfraMemory(second.directory, second.partitionPath, join(second.directory, "bad")), /review artifact hash/);
});

test("multi-cohort parent identity uses exact Python JSONL bytes and original line endings", () => {
  for (const newline of ["\n", "\r\n"]) {
    const fixture = multiCohortFixture(newline);
    assert.equal(verifyInfraPilotBundle(fixture.directory).lineage.cohort_count, 2);
  }
});

test("multi-cohort parent rejects reserialization, changed values and reordered source rows even after resealing", () => {
  for (const change of ["reserialize", "value", "order"]) {
    const fixture = multiCohortFixture();
    const lines = [...fixture.lines];
    if (change === "reserialize") lines[0] = canonical(JSON.parse(lines[0])) + "\n";
    else if (change === "value") lines[0] = lines[0].replace("1e-07", "2e-07");
    else [lines[0], lines[1]] = [lines[1], lines[0]];
    fixture.put("public.jsonl", null, lines.join("")); fixture.seal();
    assert.throws(() => verifyInfraPilotBundle(fixture.directory), /Original parent public prefixes or split changed/);
  }
});
