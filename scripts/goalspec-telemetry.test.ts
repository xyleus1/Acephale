import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { partitionEvents, requestedObjectiveFromArtifacts, unobservedFailureProvenance } from "./goalspec-telemetry";
import { validateContract } from "../src/lib/goalspec/contracts/validate";
import { hash } from "../src/lib/goalspec/canonical";

test("a failure before the public request remains importable with an explicit unobserved objective", () => {
  const objective = requestedObjectiveFromArtifacts(undefined, [{ role: "assistant", content: "Hi! How can I help you today?" }]);
  assert.equal(objective.requestedObjectiveObservation?.status, "unobserved_no_public_request");
  assert.deepEqual(objective.requestedObjectiveObservation?.nativeMessageIndexes, []);
  assert.match(objective.requestedObjective, /^\[Unobserved:/);
  validateContract("Outcome", { schemaVersion: 1, runId: "heldout-failed-before-request", requestedObjective: objective.requestedObjective,
    inferredGoals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) }, achievedOutcomes: [],
    independentVerdict: { verifierId: "independent-test", success: false, constraintsSatisfied: true, evidenceRefs: ["fixture://failure"] } });
});

test("frame-backed objective payloads retain their original immutable import identity", () => {
  assert.deepEqual(requestedObjectiveFromArtifacts({ requestedObjective: "The recorded request" }, [{ role: "user", content: "A later request" }]),
    { requestedObjective: "The recorded request" });
});

test("a request recorded before the first frame uses only native public user messages", () => {
  assert.deepEqual(requestedObjectiveFromArtifacts(undefined, [
    { role: "assistant", content: "Hello" }, { role: "user", content: "Please check my booking." },
    { role: "tool", content: "Unrelated observation" }, { role: "user", content: "Use booking ABC." },
  ]), { requestedObjective: "Please check my booking.\nUse booking ABC.",
    requestedObjectiveObservation: { status: "native_user_messages", actorBoundaryObserved: false, nativeMessageIndexes: [1, 3] } });
});

function closedStream(options: { manifestHash?: string; closed?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-event-export-"));
  const stage = join(directory, "partition"); mkdirSync(stage);
  const events = [
    { type: "research_manifest", manifestHash: options.manifestHash ?? "fixture-manifest", runs: [{ id: "observed" }, { id: "unobserved" }] },
    { type: "service_started", runs: ["observed", "unobserved", "observed:user", "unobserved:user"] },
    { runId: "observed", event: { type: "actor_boundary", boundary: 0 } },
    ...(options.closed === false ? [] : [{ type: "service_closed" }]),
  ];
  let previousHash = "0".repeat(64);
  const rows = events.map((event, sequence) => {
    const body = { sequence, previousHash, event }; const digest = hash(body); previousHash = digest;
    return { body, hash: digest };
  });
  writeFileSync(join(directory, "events-fixture.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  return { directory, stage, rows };
}
const unobservedNative = {
  record: { success: false, termination: "execution_error", nativeTermination: "execution_error", nativeStopObserved: false },
  verdict: { success: false }, simulation: { failure: "execution_error", messages: [{ role: "assistant" as const, content: "Hi! How can I help you today?" }] },
};

test("declared unobserved failure retains original shared events and leaves observed serialization intact", async () => {
  const { directory, stage, rows } = closedStream();
  const counts = await partitionEvents(directory, stage, new Set(["observed", "unobserved", "undeclared"]), "fixture-manifest");
  assert.equal(counts.get("observed"), 1); assert.equal(counts.get("unobserved"), 0); assert.equal(counts.has("undeclared"), false);
  const loaded = (id: string) => readFileSync(join(stage, `${id}.jsonl`), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(loaded("observed").map(row => row.payload), [rows[2], rows[0], rows[1], rows[3]]);
  const shared = loaded("unobserved");
  assert.deepEqual(shared.map(row => row.payload), [rows[0], rows[1], rows[3]]);
  const evidence = unobservedFailureProvenance("unobserved", unobservedNative, shared);
  assert.equal(evidence.perRunEvents, 0); assert.equal(evidence.retainedSharedEvents, 3);
  assert.throws(() => unobservedFailureProvenance("undeclared", unobservedNative, shared), /Zero-event/);
  assert.throws(() => unobservedFailureProvenance("unobserved", { ...unobservedNative, record: { ...unobservedNative.record, success: true } }, shared), /Zero-event/);
  assert.throws(() => unobservedFailureProvenance("unobserved", { ...unobservedNative, simulation: { ...unobservedNative.simulation,
    messages: [...unobservedNative.simulation.messages, { role: "user", content: "A real request" }] } }, shared), /Zero-event/);
});

test("undeclared phase ownership and unclosed service cannot authorize zero-event telemetry", async () => {
  for (const options of [{ manifestHash: "different-phase" }, { closed: false }]) {
    const { directory, stage } = closedStream(options);
    await assert.rejects(partitionEvents(directory, stage, new Set(["unobserved"]), "fixture-manifest"), /different phase|active or undrained/);
  }
});
