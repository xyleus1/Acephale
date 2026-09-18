import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { LocalController, type ControllerArtifact } from "../src/lib/goalspec/controller";
import type { ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { publicPrefixSources, publicReplayMessages } from "./goalspec-prediction-v3";
import { predictPublicCheckpoint, runFrozenNativeReplay, scorePublicPrediction } from "./goalspec-controller-native-v4-replay";

const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const write = (path: string, value: unknown) => writeFileSync(path, canonical(value) + "\n", { flag: "wx" });
const schema = (field: string) => ({ type: "object", properties: { [field]: { type: "string" } }, required: [field], additionalProperties: false });
const tools = Object.entries({ find_user_id_by_email: schema("email"), get_user_details: schema("user_id"), get_order_details: schema("order_id") })
  .map(([name, parameters]) => ({ type: "function" as const, function: { name, parameters } }));
const readTools = Object.fromEntries(tools.map(tool => [tool.function.name, tool.function.parameters]));
function artifact(): ControllerArtifact {
  const body = { version: "goalspec-controller-artifact-v1", featureVersion: "goalspec-controller-features-v1", inputDimension: 216,
    goalFeaturePolicy: "public-request-only", architecture: "logistic", layers: [{ weights: Array.from({ length: 5 }, () => Array(216).fill(0)), bias: [-2, 2, 2, 2, 0], activation: "linear" }],
    heads: ["actionRead", "nextAction", "usefulWithin2", "readiness", "exposure"], trainedHeads: { actionRead: true, nextAction: true, usefulWithin2: true, readiness: true, exposure: false },
    calibration: { temperature: [1, 1, 1, 1, 1], bias: [0, 0, 0, 0, 0], method: "family-heldout-temperature-grid" },
    thresholds: { actionRead: 0.5, usefulWithin2: 0.5, readiness: 0.5, exposure: 1 },
    lineage: { datasetHash: "a".repeat(64), trainFamilies: ["retail:training"], selectionFamilies: ["retail:selection"], calibrationFamilies: ["retail:calibration"],
      baseOnly: true, seed: 1, selectedCheckpoint: "synthetic-only", soupMembers: [], randomizedExposureDataHash: null,
      labelSemantics: "next-action-imitation;within-two-observed-use;readiness-is-not-authorization;exposure-masked" } };
  return { ...body, contentHash: hash(body) } as ControllerArtifact;
}
function frame(runId = "synthetic-base", boundary = 0, prefix = publicReplayMessages([{ role: "user", content: "My user ID is user_abc. Please find my orders." }])): ExecutionFrame {
  return { schemaVersion: 1, runId, boundary, snapshotId: "synthetic-snapshot", policy: "Visible sources only.",
    scope: { tenantId: "custom-tau-retail", principalId: "native-actor", authorizationVersion: "native-v1",
      environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(tools) },
    sources: publicPrefixSources(prefix), requestedObjective: prefix.filter(message => message.role === "user").map(message => message.content).join("\n"),
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: "empty" } };
}
function cleanup(path: string) { assert(resolve(path).startsWith(resolve(tmpdir()) + sep)); rmSync(path, { recursive: true, force: true }); }
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "gs-controller-native-")), model = artifact();
  const controllerPath = join(directory, "controller.json"); write(controllerPath, model);
  const controllerSha256 = sha(readFileSync(controllerPath));
  const trials = ["base", "paste", "salesforce", "goalspec"].map(arm => ({ family: "retail:heldout_synthetic", domain: "retail", taskId: "synthetic-only", variant: 0, trial: 0, seed: 17, arm }));
  const runs = trials.map(trial => ({ runId: `synthetic-${trial.arm}`, arm: trial.arm, domain: "retail", tools }));
  const manifest = { schemaVersion: 1, runtimeVersion: "v4", snapshotId: "synthetic-snapshot", studyId: "synthetic-study", studyStage: "confirmation", runs };
  const design = { version: "goalspec-live-v4", studyId: manifest.studyId, studyStage: manifest.studyStage, designHash: "frozen-synthetic-design", trials };
  const runtimeSources = Object.fromEntries(["src/lib/goalspec/controller.ts", "src/lib/goalspec/controller-features.ts",
    "services/goalspec-runtime/native-candidate-graph.ts", "services/goalspec-runtime/native-read-policy.ts"].map(path => [path, { sha256: sha(readFileSync(path)) }]));
  write(join(directory, "dispatch-plan.json"), { version: "goalspec-dispatch-v4", design, runtimeSources, inputs: { controller: { sha256: controllerSha256 } } });
  write(join(directory, "service-manifest.json"), manifest); write(join(directory, "design.json"), design);
  write(join(directory, "summary.json"), { version: "goalspec-live-v4", designHash: design.designHash, counts: Object.fromEntries(trials.map(trial => [trial.arm, 1])), successes: 0 });
  const outcomes = trials.map((trial, i) => ({ ...trial, runId: runs[i].runId, studyId: design.studyId, studyStage: design.studyStage, success: false, officialReward: null }));
  writeFileSync(join(directory, "outcomes.jsonl"), outcomes.map(canonical).join("\n") + "\n");
  const messages = [{ role: "user", content: "My user ID is user_abc. Please find my orders." },
    { role: "assistant", content: null, tool_calls: [{ id: "c0", name: "get_user_details", arguments: { user_id: "user_abc" } }] },
    { role: "tool", id: "c0", content: '{"orders":["FUTURE_ORDER"]}' },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", name: "get_order_details", arguments: { order_id: "FUTURE_ORDER" } }] }];
  const publicMessages = publicReplayMessages(messages);
  write(join(directory, "synthetic-base.json"), { record: outcomes[0], privateFixture: "PRIVATE_NEVER_VISIBLE", verdict: "PRIVATE_REWARD",
    simulation: { messages: messages.map(message => ({ ...message, raw_data: "PRIVATE_PROVIDER" })) } });
  write(join(directory, "public-contexts.json"), Object.fromEntries(runs.map(run => [run.runId, { capturedBeforeExecution: true, policy: "Visible sources only.", tools }])));
  const events = [{ type: "research_manifest", manifestHash: hash(manifest), runtimeVersion: "goalspec-v4", runs: runs.map(run => ({ id: run.runId, arm: run.arm })) },
    { runId: "synthetic-base", event: { type: "execution_frame", frame: frame("synthetic-base", 0, publicMessages.slice(0, 1)) } },
    { runId: "synthetic-base", event: { type: "execution_frame", frame: frame("synthetic-base", 1, publicMessages.slice(0, 3)) } }, { type: "service_closed" }];
  let previousHash = "0".repeat(64);
  const chained = events.map((event, sequence) => { const body = { sequence, previousHash, event }; previousHash = hash(body); return { body, hash: previousHash }; });
  const closedEventsPath = join(directory, "events.jsonl"); writeFileSync(closedEventsPath, chained.map(canonical).join("\n") + "\n");
  const input = { runDirectory: directory, closedEventsPath, controllerPath, controllerSha256, expectedStage: "confirmation" as const, closedConfirmed: true };
  return { directory, input, outcomes };
}

test("same-pool prediction is independent of future labels and keeps NO_READ separate", () => {
  const prediction = predictPublicCheckpoint(frame(), "retail", readTools, new LocalController(artifact()));
  const before = hash(prediction), identity = { id: "checkpoint", familyId: "synthetic" };
  const read = scorePublicPrediction(prediction, [{ tool: "get_user_details", arguments: { user_id: "user_abc" } }], Object.keys(readTools), identity, null);
  const message = scorePublicPrediction(prediction, [], Object.keys(readTools), identity, null);
  assert.equal(hash(prediction), before);
  for (const universe of ["proposal", "policy-ready"]) {
    const rows = read.filter(row => row.universe === universe);
    assert.equal(rows[0].poolHash, rows[1].poolHash);
    assert(rows.every(row => row.exactTop1 === (universe === "proposal") && row.exactTop3 === (universe === "proposal")
      && row.poolCovered === (universe === "proposal")));
  }
  assert(message.filter(row => row.ranker === "frozen-logistic").every(row => row.predictedRead === false && row.actualRead === false));
  assert(read.filter(row => row.ranker === "frozen-logistic").every(row => row.gatedExactTop1 === false));
});

test("unscorable predictions and missing labels remain explicit rows", () => {
  const failed = scorePublicPrediction(null, [{ tool: "get_order_details", arguments: { order_id: "x" } }], Object.keys(readTools), { id: "failed" }, "bad_prefix");
  assert.equal(failed.length, 4);
  assert(failed.every(row => row.status === "unavailable" && row.actualRead === true && row.exactTop1 === false && row.poolCovered === false));
  const missing = scorePublicPrediction(null, null, Object.keys(readTools), { id: "missing" }, "missing_checkpoint");
  assert(missing.every(row => row.actualRead === null && row.exactTop1 === null && row.predictedRead === null));
});

test("replay requires complete closed outcomes before any Base native artifact is opened", () => {
  const value = fixture();
  try {
    writeFileSync(join(value.directory, "outcomes.jsonl"), value.outcomes.slice(0, 3).map(canonical).join("\n") + "\n");
    writeFileSync(join(value.directory, "synthetic-base.json"), "not JSON and must not be opened");
    assert.throws(() => runFrozenNativeReplay(value.input, join(value.directory, "output")), /Entire declared cohort/);
  } finally { cleanup(value.directory); }
});

test("closed synthetic Base replay excludes private fields and future observations from first prefix", () => {
  const value = fixture();
  try {
    const output = join(value.directory, "output"), result = runFrozenNativeReplay(value.input, output);
    assert.equal(result.checkpoints, 2); assert.equal(result.baseRunIds.length, 1);
    const checkpoints = readFileSync(join(output, "checkpoints.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert(!JSON.stringify(checkpoints).includes("PRIVATE_"));
    assert(!JSON.stringify(checkpoints[0].prediction).includes("FUTURE_ORDER"));
    assert(JSON.stringify(checkpoints[1].prediction).includes("FUTURE_ORDER"));
    assert.equal(sha(readFileSync(value.input.controllerPath)), value.input.controllerSha256);
    const scores = readFileSync(join(output, "scores.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(scores.length, 8); assert(scores.every(row => row.status === "completed"));
  } finally { cleanup(value.directory); }
});
