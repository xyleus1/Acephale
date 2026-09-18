import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { buildSpeculationContext, extractV5Features } from "../src/lib/goalspec/controller-v5-features";
import { buildMemoryArtifact } from "../src/lib/goalspec/experience-memory";
import { buildFreshV5Dataset, freshV5FamilySplits, type V5FreshDatasetPlan } from "./goalspec-controller-v5-fresh-dataset";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-v5-fresh-dataset-test-"));
  const write = (name: string, value: unknown) => {
    const path = join(directory, name); writeFileSync(path, typeof value === "string" ? value : canonical(value));
    return { path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
  };
  const tools = [{ type: "function", function: { name: "get_user_details", parameters: {
    type: "object", properties: { user_id: { type: "string" } }, required: ["user_id"], additionalProperties: false,
  } } }];
  const declared: Record<string, string> = {};
  const tasks: any[] = [], runs: any[] = [], trials: any[] = [], outcomes: any[] = [], contexts: Record<string, unknown> = {};
  for (const domain of ["retail", "airline"]) {
    for (let familyIndex = 0; familyIndex < 10; familyIndex++) {
      const family = `${domain}:fresh_${familyIndex}`;
      declared[family] = familyIndex < 8 ? "train" : "calibration";
      for (let variant = 0; variant < 2; variant++) {
        const runId = `${domain}-${familyIndex}-${variant}`, taskId = `task-${runId}`;
        tasks.push({ taskId, domain, familyId: family, privateTask: "PRIVATE_SENTINEL", variant });
        runs.push({ runId, familyId: family, arm: "base", domain, tools });
        trials.push({ taskId, family, domain, arm: "base" });
        const outcome = { runId, familyId: family, taskId, arm: "base", studyStage: "training", success: true };
        outcomes.push(outcome); contexts[runId] = { capturedBeforeExecution: true, policy: "Read current user details", tools };
        write(`${runId}.json`, { record: outcome, finalDatabase: { hidden: "PRIVATE_SENTINEL" },
          simulation: { messages: [{ role: "user", content: "My user_id is user_123. Read my profile." },
            { role: "assistant", content: null, tool_calls: [{ id: "read", name: "get_user_details", arguments: { user_id: "user_123" } }] }] } });
      }
    }
    // The fixture generator also declares development families. They are not
    // eligible for the training export and must never acquire a learning split.
    declared[`${domain}:development_only`] = "development";
  }
  const prior = join(directory, "prior"); mkdirSync(prior);
  const frame: ExecutionFrame = { schemaVersion: 1, runId: "historical-base", boundary: 0,
    scope: { tenantId: "custom-tau-retail", principalId: "native-actor", authorizationVersion: "native-v1", environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(tools) },
    policy: "Read only", requestedObjective: "Read old profile", sources: { "requirement:0": "Read old profile" },
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) }, snapshotId: "old-frozen-snapshot" };
  const context = buildSpeculationContext(frame);
  const old = { groupId: hash([frame.runId, 0]), familyId: "retail:prior_fit", split: "train", runId: frame.runId,
    cohort: "permitted-prior-training", boundary: 0, frameHash: hash(frame), prefixHash: hash(["old prefix"]), originalSnapshotId: frame.snapshotId,
    context, candidates: [], features: [extractV5Features(context, "NO_READ"), extractV5Features(context, "READ_UNCOVERED")],
    eligible: [], targets: [0], actual: [], actualRead: false };
  const priorData = write("prior/dataset.jsonl", canonical(old) + "\n");
  const priorManifest = write("prior/manifest.json", { version: "goalspec-controller-dataset-v5", sourcePolicy: "prior-v4-train-families-only-no-confirmation-cohorts",
    datasetHash: priorData.sha256, splits: { "retail:prior_fit": "train" } });
  const memory = write("memory.json", buildMemoryArtifact({ repositorySnapshotId: "new-frozen-snapshot", sourceFiles: [], runs: [], episodes: [], misses: [] }, { profile: "v5" }));
  const files = {
    "service-manifest.json": write("service-manifest.json", { snapshotId: "new-frozen-snapshot", runs }).sha256,
    "design.json": write("design.json", { version: "goalspec-experiment-v5", studyStage: "training", trials }).sha256,
    "summary.json": write("summary.json", { serviceExitCode: 0 }).sha256,
    "public-contexts.json": write("public-contexts.json", contexts).sha256,
    "outcomes.jsonl": write("outcomes.jsonl", outcomes.map(row => canonical(row)).join("\n") + "\n").sha256,
  };
  const fixtureManifest = write("fixtures.json", { generator: "fresh-native-v5", nativeCommit: "2174a603f6d014ef94473ffa95957f6ce27100db", studyStage: "training", learningFamilySplit: declared, tasks });
  const plan: V5FreshDatasetPlan = { version: "goalspec-controller-fresh-dataset-plan-v5", prior: { directory: prior, datasetHash: priorData.sha256, manifestSha256: priorManifest.sha256 },
    memory, cohort: { directory, files, fixtureManifest } };
  const close = () => {
    const root = resolve(tmpdir()) + sep, target = resolve(directory);
    if (!target.startsWith(root) || !target.includes("goalspec-v5-fresh-dataset-test-")) throw new Error("Unsafe test cleanup");
    rmSync(target, { recursive: true, force: true });
  };
  return { directory, write, plan, declared, old, outcomes, trials, close };
}
const readRows = (directory: string) => readFileSync(join(directory, "dataset.jsonl"), "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));

test("fresh dataset assigns 12/4/4 families before labels and preserves historical annotation identities", () => {
  const f = fixture();
  try {
    const splits = freshV5FamilySplits(f.declared);
    assert.equal(Object.values(splits).filter(split => split === "train").length, 12);
    assert.equal(Object.values(splits).filter(split => split === "selection").length, 4);
    assert.equal(Object.values(splits).filter(split => split === "calibration").length, 4);
    assert.deepEqual(freshV5FamilySplits(Object.fromEntries(Object.entries(f.declared).reverse())), splits);
    const output = join(f.directory, "out"), result = buildFreshV5Dataset(f.plan, output), rows = readRows(output);
    assert.equal(result.priorRows, 1); assert.equal(result.freshRows, 40);
    for (const key of ["groupId", "frameHash", "prefixHash", "split", "familyId"]) assert.equal(rows[0][key], f.old[key as keyof typeof f.old]);
    assert.deepEqual(rows[0].context.frame, f.old.context.frame);
    assert.equal(rows[0].originalFrameSnapshotId, "old-frozen-snapshot");
    assert.equal(rows[0].retrievalSnapshotId, "new-frozen-snapshot");
    assert.equal(rows.filter(row => row.cohort === "fresh-v5-training" && row.split === "calibration").length, 8);
    assert.ok(rows.every(row => !row.context.goals.grounded && row.features.every((feature: any) => feature.goal[0] === 0 && feature.goal.slice(4).every((value: number) => value === 0))));
    assert.ok(!readFileSync(join(output, "dataset.jsonl"), "utf8").includes("PRIVATE_SENTINEL"));
    assert.ok(rows.slice(1).every(row => row.candidates.some((candidate: any) => candidate.invocation.tool === "get_user_details")));
    assert.throws(() => buildFreshV5Dataset(f.plan, output), /new fresh dataset/);
  } finally { f.close(); }
});

test("fresh labels and private outcome changes cannot enter same-prefix candidate features", () => {
  const f = fixture();
  try {
    const before = join(f.directory, "before"); buildFreshV5Dataset(f.plan, before);
    const target = f.outcomes[0], path = `${target.runId}.json`;
    const native = JSON.parse(readFileSync(join(f.directory, path), "utf8"));
    target.success = false; native.record = target; native.finalDatabase.hidden = "DIFFERENT_PRIVATE_SENTINEL";
    native.simulation.messages[1].tool_calls = []; native.simulation.messages[1].content = "No read will occur";
    f.write(path, native);
    f.plan.cohort.files["outcomes.jsonl"] = f.write("outcomes.jsonl", f.outcomes.map(row => canonical(row)).join("\n") + "\n").sha256;
    const after = join(f.directory, "after"); buildFreshV5Dataset(f.plan, after);
    const a = readRows(before).find(row => row.runId === target.runId), b = readRows(after).find(row => row.runId === target.runId);
    assert.deepEqual(a.context, b.context); assert.deepEqual(a.candidates, b.candidates); assert.deepEqual(a.features, b.features);
    assert.notDeepEqual(a.targets, b.targets); assert.equal(a.actualRead, true); assert.equal(b.actualRead, false);
  } finally { f.close(); }
});

test("fresh dataset rejects development, duplicate slots and changed declared files", () => {
  for (const defect of ["development", "duplicate", "hash"]) {
    const f = fixture();
    try {
      if (defect === "hash") f.write("summary.json", { serviceExitCode: 1 });
      else {
        if (defect === "duplicate") f.trials[1] = f.trials[0];
        f.plan.cohort.files["design.json"] = f.write("design.json", { version: "goalspec-experiment-v5", studyStage: defect === "development" ? "development" : "training", trials: f.trials }).sha256;
      }
      assert.throws(() => buildFreshV5Dataset(f.plan, join(f.directory, "out")), /closed Base training|source hash mismatch/);
    } finally { f.close(); }
  }
});
