import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../src/lib/acephale/canonical";
import { freezeInfraReplayRetrieval, publicInfraFrame, selectInfraCandidatePanel, selectInfraReplayRows } from "./acephale-infra-predict";
import { mixInfraDecisions } from "../src/lib/acephale/infra-session";

test("public replay reconstructs only current sources and rejects changed or future inputs", () => {
  const input = { policy: "Read only", sources: [{ id: "event:0", kind: "user", value: "Find my order" }], tools: [], events: [{ seq: 0, kind: "message", role: "user", content: "Find my order" }] };
  const row = { checkpoint_id: "checkpoint", input_hash: hash(input), episode_id: "episode", family_id: "family", split: "train", domain: "retail", through_seq: 0,
    environment_version: "version", tool_schema_hash: hash([]), scope: { tenant_id: "tenant", principal_id: "principal", authorization_revision: "revision" }, input };
  const frame = publicInfraFrame(row, "snapshot");
  assert.equal(frame.requestedObjective, "Find my order"); assert.equal(frame.scope.tenantId, "tenant"); assert.equal(frame.goals.unknown, 1);
  assert.equal(frame.sources["requirement:0"], "Find my order"); assert.equal(frame.sources["event:0"], "Find my order");
  const capturedSchemaHash = hash({ capturedOpenAITools: [] });
  assert.equal(publicInfraFrame({ ...row, runtime_tool_schema_hash: capturedSchemaHash }, "snapshot").scope.toolSchemaHash, capturedSchemaHash);
  assert.throws(() => publicInfraFrame({ ...row, runtime_tool_schema_hash: "not-a-hash" }, "snapshot"), /provenance/);
  assert.throws(() => publicInfraFrame({ ...row, input_hash: "0".repeat(64) }, "snapshot"), /provenance/);
  const future = { ...input, events: [{ ...input.events[0], seq: 1 }] };
  assert.throws(() => publicInfraFrame({ ...row, input: future, input_hash: hash(future) }, "snapshot"), /provenance/);
  const initial = { ...input, events: [] };
  assert.equal(publicInfraFrame({ ...row, through_seq: -1, input: initial, input_hash: hash(initial) }, "snapshot").boundary, 0);
  assert.equal(publicInfraFrame({ ...row, through_seq: -1, input: initial, input_hash: hash(initial) }, "snapshot").requestedObjective, "No requested objective is visible at this checkpoint.");
  const collision = { ...input, sources: [...input.sources, { id: "requirement:0", kind: "user", value: "Changed" }] };
  assert.throws(() => publicInfraFrame({ ...row, input: collision, input_hash: hash(collision) }, "snapshot"), /Conflicting/);
});
test("bounded replay selects across family partitions without admitting held-out rows", () => {
  const rows = [
    ...Array.from({ length: 100 }, (_, i) => ({ split: "train", family_id: "train-a", checkpoint_id: `t${i}` })),
    { split: "train", family_id: "train-b", checkpoint_id: "b" },
    { split: "development", family_id: "dev-a", checkpoint_id: "d" },
    { split: "test", family_id: "held-out", checkpoint_id: "h" },
  ];
  const selected = selectInfraReplayRows(rows, 3);
  assert.deepEqual(new Set(selected.map(row => row.checkpoint_id)), new Set(["t0", "b", "d"]));
  assert.equal(selectInfraReplayRows(rows, 1000).length, 102);
  assert.deepEqual(selectInfraReplayRows(rows, 1000, "test").map(row => row.checkpoint_id), ["h"]);
  assert.throws(() => selectInfraReplayRows(rows, 0));
  assert.throws(() => selectInfraReplayRows([{ ...rows[0], split: "unknown" }], 1));
});
test("matched ranking panels are bounded and selected independently of either condition", () => {
  const candidates = Array.from({ length: 128 }, (_, index) => ({ id: `candidate-${index}`, probability: index / 128 }));
  const panel = selectInfraCandidatePanel(candidates);
  assert.deepEqual(panel.map(candidate => candidate.id), ["candidate-0", "candidate-1", "candidate-2"]);
  panel[0].probability = 1;
  assert.equal(candidates[0].probability, 0);
  assert.equal(candidates.length, 128);
  assert.deepEqual(selectInfraCandidatePanel([]), []);
  assert.throws(() => selectInfraCandidatePanel([{ id: "duplicate" }, { id: "duplicate" }]), /Duplicate/);
});
test("paired replay freezes the first retrieval including timeout fallback and copies results", async () => {
  let calls = 0, denseReady = false;
  const frozen = freezeInfraReplayRetrieval(async () => {
    calls++;
    return { version: "acephale-contextual-memory-v5", queryHash: hash("query"), artifactHash: hash(denseReady ? "late-dense" : "fallback"),
      historicalValuesAreNotCurrentBindings: true, episodes: [], transitions: [], confusions: [], omittedEpisodes: 0, serializedCharacters: 0 };
  });
  const frame = { runId: "same-run", boundary: 0 } as never, signal = AbortSignal.timeout(1000);
  const neutral = await frozen(frame, signal);
  neutral.artifactHash = hash("caller mutation"); denseReady = true;
  const conditional = await frozen(frame, signal);
  assert.equal(conditional.artifactHash, hash("fallback")); assert.equal(calls, 1);
  await assert.rejects(frozen({ runId: "same-run", boundary: 1 } as never, signal), /checkpoint identities/);
});
test("goal reliability attenuates conditional ranking instead of acting as a boolean", () => {
  const neutral = { action: "READ" as const, scores: [{ candidateId: "A", probability: 0.9 }] };
  const conditional = { action: "READ" as const, scores: [{ candidateId: "B", probability: 0.9 }] };
  const low = mixInfraDecisions(neutral, conditional, 0.01), high = mixInfraDecisions(neutral, conditional, 0.99);
  assert.equal(low.scores[0].candidateId, "A"); assert.equal(high.scores[0].candidateId, "B");
  assert.ok(Math.abs(low.scores.find(score => score.candidateId === "B")!.probability - 0.009) < 1e-12);
  assert.throws(() => mixInfraDecisions(neutral, conditional, 2));
});
