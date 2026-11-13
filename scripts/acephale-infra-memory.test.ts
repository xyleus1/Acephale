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

function freshSelectionFixture() {
  const directory = resolve("research/acephale/runs", `infra-memory-fit-test-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const files: Record<string, { sha256: string }> = {};
  const write = (name: string, value: unknown) => {
    const path = join(directory, name);
    writeFileSync(path, name.endsWith(".jsonl") ? (value as unknown[]).map(row => canonical(row) + "\n").join("") : canonical(value) + "\n");
    files[name] = { sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
  };
  const scope = { tenantId: "fixture", principalId: "fixture", authorizationVersion: "v1", environmentVersion: "fixture", toolSchemaHash: hash("tools") };
  const runtime = ["fitting", "calibration"].map(familyId => ({ id: `run-${familyId}`, familyId, split: "train", scope,
    policyHash: hash("policy"), rawSha256: hash(familyId), success: true, outcomeVerified: true, constraintViolations: 0,
    memoryEligible: true, contrastiveEligible: false, termination: "user_stop",
    messages: [
      { index: 0, role: "user", content: `Read ${familyId}`, calls: [], callId: null, observation: null },
      { index: 1, role: "assistant", content: null, calls: [{ id: "call", tool: familyId === "fitting" ? "FIT_READ" : "CALIBRATION_TOOL_SENTINEL", arguments: { id: familyId } }], callId: null, observation: null },
      { index: 2, role: "tool", content: "found", calls: [], callId: "call", observation: { id: familyId } },
      { index: 3, role: "assistant", content: "Done", calls: [], callId: null, observation: null },
    ] }));
  const split = { families: { fitting: "train", calibration: "train" }, fresh_heldout: false };
  const memory = { frozen: true, split_hash: hash(split), training_families: ["fitting", "calibration"] };
  const receipt = { fixtureOnly: true, closed: true };
  write("cohort-receipt.json", receipt);
  write("split.json", split); write("memory.json", { ...memory, snapshot_hash: hash(memory) });
  write("runtime-runs.jsonl", runtime);
  write("metadata.jsonl", runtime.map(row => ({ episode_id: row.id, family_id: row.familyId,
    scope: { tenant_id: scope.tenantId, principal_id: scope.principalId, authorization_revision: scope.authorizationVersion },
    environment_version: scope.environmentVersion, tool_schema_hash: scope.toolSchemaHash, verification_tier: "native_verified" })));
  for (const name of ["public.jsonl", "labels.jsonl", "trajectories.jsonl", "verdicts.jsonl"]) write(name, []);
  write("lineage.json", { version: "acephale-infra-fresh-native-v1", fresh_qwen_traces: true, fresh_heldout: false,
    actor: INFRA_MODEL_PINS.actor, cohort_receipt_sha256: files["cohort-receipt.json"].sha256, cohort_receipt_hash: hash(receipt),
    all_declared_slots_retained: true, episodes: runtime.length, fresh_sources: Object.fromEntries(runtime.map(row => [row.id,
      { raw_sha256: row.rawSha256, original_tool_schema_hash: scope.toolSchemaHash }])) });
  writeFileSync(join(directory, "manifest.json"), canonical({ schema_version: "acephale-infra-data-v1", files, bundle_hash: hash(files) }));
  const partitions = { weightFitFamilies: ["fitting"], calibrationFamilies: ["calibration"], developmentFamilies: ["development"], testFamilies: ["test"] };
  const proposal = { schemaVersion: 1, kind: "acephale-candidate-only-family-partition-proposal", ...partitions };
  writeFileSync(join(directory, "partition.json"), canonical({ ...proposal, contentHash: hash(proposal) }));
  const review = { schemaVersion: 1, kind: "acephale-source-family-review", reviewer: { kind: "assistant_source_design" },
    humanAnnotationLabelReview: false, historicalAPIGenExcluded: true, partitionProposalHash: hash(proposal) };
  writeFileSync(join(directory, "source-design-review.json"), canonical({ ...review, contentHash: hash(review) }));
  const approved = { schemaVersion: 1, kind: "acephale-candidate-only-family-partition", ...partitions,
    executionAuthorized: true, evaluationEligible: true, efficacyClaimAllowed: false,
    review: { status: "completed", reviewerKind: "assistant_source_design", humanAnnotationLabelReview: false, sourceDesignReviewHash: hash(review) } };
  const partitionPath = join(directory, "partition-approved.json");
  writeFileSync(partitionPath, canonical({ ...approved, contentHash: hash(approved) }));
  return { directory, partitionPath, approved };
}

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

function multiCohortFixture(newline = "\n") {
  const { directory } = freshSelectionFixture();
  const read = (name: string) => JSON.parse(readFileSync(join(directory, name), "utf8"));
  const manifest = read("manifest.json"), lineage = read("lineage.json");
  const put = (name: string, value: unknown, text = canonical(value) + "\n") => {
    writeFileSync(join(directory, name), text);
    manifest.files[name] = { sha256: createHash("sha256").update(text).digest("hex") };
  };
  const policy = { fitting: "train", calibration: "development" };
  const split = { families: policy, declared_family_policy: policy, fresh_heldout: false };
  const memory = { frozen: true, split_hash: hash(split), training_families: ["fitting"] };
  put("split.json", split); put("memory.json", { ...memory, snapshot_hash: hash(memory) });
  const metadata = readFileSync(join(directory, "metadata.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const publicRows = metadata.flatMap(meta => [0, 1].map(index => ({ episode_id: meta.episode_id,
    checkpoint_id: `${meta.episode_id}:${index}`, family_id: meta.family_id,
    split: policy[meta.family_id as keyof typeof policy], runtime_tool_schema_hash: meta.tool_schema_hash,
    tool_schema_hash: meta.tool_schema_hash, environment_version: meta.environment_version, scope: meta.scope,
    input: { observation: { fraction: 1e-7, name: "caf\u00e9" } }, input_hash: hash({ observation: { fraction: 1e-7, name: "caf\u00e9" } }) })));
  // Match Python's exponent and escaped Unicode forms, both semantically valid
  // JSON that differ from RFC8785 and JavaScript's serialization.
  const lines = publicRows.map(row => JSON.stringify(row).replaceAll("1e-7", "1e-07").replaceAll("\u00e9", "\\u00e9") + newline);
  put("public.jsonl", null, lines.join(""));
  const cohorts = metadata.map((meta, index) => {
    const runs = [{ runId: meta.episode_id, familyId: meta.family_id, domain: "retail", taskId: `task-${index}`, seed: 17, arm: "base" }];
    const configuration = { stage: "collection", runs, taskBundleHash: hash("tasks"),
      ...(index ? { collectionPurpose: "auxiliary-development-validation", hosted: { allocation: "development" } } : {}) };
    const modelManifest = { actor: INFRA_MODEL_PINS.actor, protocol: { scheduleHash: hash(runs) },
      data: { trainingFamilies: ["fitting"], developmentFamilies: ["calibration"], heldoutFamilies: [] } };
    const receipt = { version: 1, stage: "collection", closed: true, completed: true,
      allDeclaredSlotsRetained: true, serviceExitCode: 0, configurationHash: hash(configuration), manifestHash: hash(modelManifest),
      files: [{ path: `${meta.episode_id}.json`, sha256: lineage.fresh_sources[meta.episode_id].raw_sha256 }] };
    const receiptText = canonical(receipt) + "\n", cohortId = hash(receipt);
    lineage.fresh_sources[meta.episode_id].cohort_id = cohortId;
    return { receipt, receiptText, receiptSha256: createHash("sha256").update(receiptText).digest("hex"),
      cohortId, configuration, manifest: modelManifest, runIds: [meta.episode_id],
      purpose: index ? "auxiliary-development-validation" : "original-base-collection" };
  });
  const parentFiles = { "public.jsonl": { sha256: createHash("sha256").update(lines.slice(0, 2).join("")).digest("hex") },
    "split.json": manifest.files["split.json"] };
  const aggregateBody = { version: 2, kind: "acephale-fresh-native-multicohort", closed: true,
    allDeclaredSlotsRetained: true, pairedComparisonSlotsReused: false, cohorts,
    episodeCohorts: Object.fromEntries(cohorts.map(cohort => [cohort.runIds[0], cohort.cohortId])),
    parentDatasets: [{ bundleHash: hash(parentFiles), cohortId: cohorts[0].cohortId,
      manifest: { bundle_hash: hash(parentFiles), files: parentFiles }, split,
      publicCheckpointIds: publicRows.slice(0, 2).map(row => row.checkpoint_id) }] };
  const aggregate = { ...aggregateBody, contentHash: hash(aggregateBody) };
  put("cohort-receipt.json", aggregate);
  Object.assign(lineage, { version: "acephale-infra-fresh-native-v2", cohort_count: 2, cohort_files: null,
    cohort_receipt_sha256: manifest.files["cohort-receipt.json"].sha256, cohort_receipt_hash: hash(aggregate) });
  put("lineage.json", lineage);
  const seal = () => writeFileSync(join(directory, "manifest.json"), canonical({ ...manifest, bundle_hash: hash(manifest.files) }));
  seal();
  return { directory, lines, put, seal };
}

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
