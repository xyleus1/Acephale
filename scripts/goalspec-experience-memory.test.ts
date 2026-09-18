import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { buildMemoryArtifact, memoryQuery, retrieveMemory, retrieveContextualMemory, validateMemoryArtifact,
  type FrozenExperienceMemory, type MemoryEpisode, type MemoryFile, type MemoryMiss, type MemoryRun,
} from "../src/lib/goalspec/experience-memory";
import { buildLocalMemory, extractMemoryEpisodes, verifiedEventRows } from "./goalspec-build-memory-v3";

const scope = { tenantId: "custom-tau-retail", principalId: "native-actor", authorizationVersion: "native-v1",
  environmentVersion: "native-pinned", toolSchemaHash: hash("tools") };
const file: MemoryFile = { path: "research/goalspec/runs/training/source.json", sha256: hash("source") };
function example(index: number, success = true) {
  const run: MemoryRun = { id: `train-${index}`, familyId: `family-${index}`, stage: "v1-training", split: "train",
    scope, policyHash: hash("policy"), sourceFiles: [file], success, outcomeVerified: true,
    constraintViolations: 0, termination: success ? "user_stop" : "execution_error", publicMessageCount: 6, episodeCount: 1 };
  const prefix: MemoryEpisode["prefix"] = [
    { index: 0, role: "assistant", content: "Hello", calls: [], callId: null, observation: null },
    { index: 1, role: "user", content: "Look up the delivery status of my order", calls: [], callId: null, observation: null },
    { index: 2, role: "assistant", content: null, calls: [{ id: "lookup", tool: "get_user_details", arguments: { user_id: "historical-user" } }], callId: null, observation: null },
    { index: 3, role: "tool", content: '{"order_id":"HISTORICAL-123"}', calls: [], callId: "lookup", observation: { order_id: "HISTORICAL-123" } },
  ];
  const episode: MemoryEpisode = { id: `episode-${index}`, runId: run.id, boundary: 1, scope, prefixHash: hash(prefix), prefix,
    requirements: [prefix[1].content!], previousTool: "get_user_details",
    nextActions: [{ id: "order", tool: "get_order_details", arguments: { order_id: "HISTORICAL-123" } }],
    nextMessage: null, resultingObservations: [], argumentSources: [{ actionId: "order", argumentPath: ["order_id"],
      sources: [{ messageIndex: 3, path: ["observation", "order_id"], method: "exact" }] }],
    lesson: success ? "Verified successful task; rebind to current evidence." : "Failed task; contrastive example only." };
  const miss: MemoryMiss = { id: `miss-${index}`, episodeId: episode.id,
    predicted: { tool: "get_product_details", arguments: { product_id: "wrong" } },
    actual: [{ tool: "get_order_details", arguments: { order_id: "HISTORICAL-123" } }], fullMatch: false, toolMatch: false,
    admitted: true, beforeActorResponse: true, eventSequence: index, eventHash: hash(index), source: file };
  return { run, episode, miss };
}
function fixture(count = 3) {
  const examples = Array.from({ length: count }, (_, index) => example(index, index !== 1));
  return buildMemoryArtifact({ repositorySnapshotId: "frozen-library", sourceFiles: [file],
    runs: examples.map(row => row.run), episodes: examples.map(row => row.episode), misses: examples.map(row => row.miss) });
}
function frame(): ExecutionFrame {
  return { schemaVersion: 1, runId: "current-unseen-run", boundary: 1, scope: copy(scope), snapshotId: "frozen-library",
    policy: "Use current evidence", requestedObjective: "Help with my order", goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash("revision") },
    sources: { "requirement:1": "Find CURRENT-456 delivery status", "observation:3": { order_id: "CURRENT-456", status: "shipped" },
      _binding_events: [{ seq: 0, kind: "tool_request", tool: "get_user_details", arguments: { user_id: "current-user" } },
        { seq: 1, kind: "tool_result", tool: "get_user_details", result: { order_id: "CURRENT-456", status: "shipped" } }] } };
}
function rehash(artifact: FrozenExperienceMemory) { const { contentHash: _previous, ...body } = artifact; return { ...body, contentHash: hash(body) }; }

test("v5 contextual retrieval retains full observations/provenance and excludes family statistics", () => {
  const artifact = fixture(), result = retrieveContextualMemory(frame(), memoryQuery(frame()), artifact, { excludeFamilies: ["family-1"] });
  assert.equal(result.episodes.length, 2);
  assert.deepEqual(result.episodes[0].episode.prefix, artifact.episodes.find(row => row.id === result.episodes[0].episode.id)!.prefix);
  assert.equal(result.transitions[0].successes, 2); assert.equal(result.transitions[0].failures, 0);
  assert.equal(result.confusions[0].count, 2);
  assert.ok(result.episodes.every(row => row.episode.argumentSources.length > 0));
  result.transitions[0].successes = 99;
  assert.equal(retrieveContextualMemory(frame(), memoryQuery(frame()), artifact, { excludeFamilies: ["family-1"] }).transitions[0].successes, 2);
  assert.equal(retrieveContextualMemory({ ...frame(), scope: { ...scope, principalId: "other" } }, "order", artifact).episodes.length, 0);
});
test("v5 memory profile accepts only declared training stages and leaves legacy hashes intact", () => {
  const legacy = fixture(), legacyHash = legacy.contentHash;
  assert.equal(buildMemoryArtifact(legacy).contentHash, legacyHash);
  const fresh = copy(legacy); fresh.runs.forEach(run => { run.stage = "v5-training"; });
  const v5 = buildMemoryArtifact(fresh, { profile: "v5" });
  assert.equal(v5.compilerVersion, "goalspec-memory-v5"); assert.equal(v5.sourcePolicy, "v5-and-permitted-training-only");
  const contamination = copy(v5); contamination.runs[0].stage = "v2-development-1"; contamination.runs[0].split = "development";
  assert.throws(() => validateMemoryArtifact(rehash(contamination)), /contaminated/);
  assert.equal(legacy.contentHash, legacyHash);
});
test("v5 drops a whole historical episode when its complete context exceeds the budget", () => {
  const result = retrieveContextualMemory(frame(), "order", fixture(), { maxChars: 200 });
  assert.equal(result.episodes.length, 0); assert.equal(result.omittedEpisodes, 3);
  assert.ok(result.serializedCharacters <= 200);
});

test("memory freezes source lineage and verifies artifact and derived statistics", () => {
  const artifact = fixture();
  assert.equal(validateMemoryArtifact(artifact), artifact);
  assert.ok(Object.isFrozen(artifact.episodes[0].prefix));
  assert.throws(() => artifact.runs.push(copy(artifact.runs[0])), TypeError);
  const changed = copy(artifact); changed.runs[0].familyId = "tampered";
  assert.throws(() => validateMemoryArtifact(changed), /hash mismatch/);
  const stats = copy(artifact); stats.transitions[0].successes = 99;
  assert.throws(() => validateMemoryArtifact(rehash(stats)), /statistics/);
});

test("held-out and mislabeled source runs cannot enter the memory artifact", () => {
  const changed = copy(fixture());
  changed.runs[0].split = "test" as MemoryRun["split"];
  assert.throws(() => validateMemoryArtifact(rehash(changed)), /contaminated/);
  changed.runs[0].split = "train"; changed.runs[0].stage = "v2-confirmation" as MemoryRun["stage"];
  assert.throws(() => validateMemoryArtifact(rehash(changed)), /contaminated/);
});

test("failures remain separate contrastive counts and zero-decision failures remain in provenance", () => {
  const artifact = fixture();
  assert.equal(artifact.transitions[0].successes, 2); assert.equal(artifact.transitions[0].failures, 1);
  assert.equal(artifact.transitions[0].successRate, 2 / 3);
  const failed = copy(artifact.runs[1]); failed.id = "host-failed"; failed.episodeCount = 0; failed.publicMessageCount = 1;
  const combined = buildMemoryArtifact({ ...artifact, runs: [...artifact.runs, failed] });
  assert.equal(combined.runs.length, 4); assert.equal(combined.runs.filter(run => !run.success).length, 2);
});

test("three causal confusion occurrences produce bounded soft advice; two do not", () => {
  const current = frame();
  assert.equal(retrieveMemory(current, memoryQuery(current), fixture(2)).confusions.length, 0);
  const result = retrieveMemory(current, memoryQuery(current), fixture(3));
  assert.equal(result.confusions.length, 1); assert.equal(result.confusions[0].count, 3);
  assert.ok(result.hints.some(hint => hint.includes("do not prohibit a valid current action")));
  const artifact = fixture(3), late = copy(artifact.misses); late[0].beforeActorResponse = false;
  assert.equal(buildMemoryArtifact({ ...artifact, misses: late }).confusions[0].count, 2);
});

test("repeated candidate proposals at one boundary do not inflate confusion evidence", () => {
  const artifact = fixture(2), duplicate = { ...copy(artifact.misses[0]), id: "duplicate", eventSequence: 50 };
  const rebuilt = buildMemoryArtifact({ ...artifact, misses: [...artifact.misses, duplicate] });
  assert.equal(rebuilt.confusions[0].count, 2);
});

test("a predicted read followed by an actual message is retained as abstention evidence", () => {
  const artifact = fixture(3), episodes = copy(artifact.episodes), misses = copy(artifact.misses);
  episodes.forEach(episode => { episode.nextActions = []; episode.argumentSources = []; episode.nextMessage = "Please confirm before I make this change."; });
  misses.forEach(miss => { miss.actual = []; });
  const rebuilt = buildMemoryArtifact({ ...artifact, episodes, misses });
  assert.equal(rebuilt.transitions[0].to, "__message__");
  assert.equal(rebuilt.confusions[0].actualTool, "__message__");
});

test("retrieval rejects incompatible authorization, environment, schemas and snapshot", () => {
  const artifact = fixture();
  for (const key of ["tenantId", "principalId", "authorizationVersion", "environmentVersion", "toolSchemaHash"] as const) {
    const current = frame(); current.scope[key] = "incompatible";
    assert.deepEqual(retrieveMemory(current, memoryQuery(current), artifact).hints, []);
  }
  const current = frame(); current.snapshotId = "different-snapshot";
  assert.deepEqual(retrieveMemory(current, memoryQuery(current), artifact).hints, []);
  const sameRun = frame(); sameRun.runId = artifact.runs[0].id;
  assert.deepEqual(retrieveMemory(sameRun, memoryQuery(sameRun), artifact).hints, []);
});

test("current observations change retrieval query without changing the initial objective", () => {
  const current = frame(), before = memoryQuery(current);
  current.sources["observation:3"] = { order_id: "CURRENT-456", status: "cancelled", refund: "processed" };
  assert.notEqual(memoryQuery(current), before);
  assert.ok(memoryQuery(current).includes("cancelled"));
  assert.equal(current.requestedObjective, "Help with my order");
});

test("historical arguments are labeled as examples and cannot create current invocation bindings", () => {
  const current = frame(), before = canonical(current), artifact = fixture();
  const result = retrieveMemory(current, memoryQuery(current), artifact, { maxEpisodes: 1, maxChars: 5000 });
  assert.equal(canonical(current), before);
  assert.equal(result.episodeIds.length, 1);
  assert.ok(result.hints.some(hint => hint.includes("historicalValuesAreNotCurrentEvidence")));
  assert.ok(result.hints.some(hint => hint.includes("HISTORICAL-123")));
  assert.equal("bindings" in result, false); assert.equal("invocation" in result, false);
  const bounded = retrieveMemory(current, memoryQuery(current), artifact, { maxChars: 300 });
  assert.ok(bounded.hints.join("").length <= 300);
});

test("argument-source indexes and prefix hashes enforce checkpoint isolation", () => {
  const changed = copy(fixture());
  changed.episodes[0].argumentSources[0].sources[0].messageIndex = 100;
  assert.throws(() => validateMemoryArtifact(rehash(changed)), /visible prefix/);
  const prefix = copy(fixture()); prefix.episodes[0].prefix.pop();
  assert.throws(() => validateMemoryArtifact(rehash(prefix)), /episode/);
  const hidden = copy(fixture());
  Object.assign(hidden.episodes[0].prefix[0], { raw_data: { private: "forbidden" } });
  hidden.episodes[0].prefixHash = hash(hidden.episodes[0].prefix);
  assert.throws(() => validateMemoryArtifact(rehash(hidden)), /public prefix/);
});

test("episode extraction retains public requirements and excludes the next action from its prefix", () => {
  const { run, episode } = example(1);
  const messages = [...episode.prefix,
    { index: 4, role: "assistant" as const, calls: episode.nextActions, content: null, callId: null, observation: null },
    { index: 5, role: "tool" as const, calls: [], content: '{"status":"delivered"}', callId: "order", observation: { status: "delivered" } },
  ];
  const extracted = extractMemoryEpisodes(run, messages).at(-1)!;
  assert.equal(extracted.prefix.length, 4);
  assert.equal(extracted.resultingObservations[0].index, 5);
  assert.equal(extracted.argumentSources[0].sources.some(source => source.messageIndex === 3), true);
  assert.equal(extracted.prefix.some(message => message.content?.includes("delivered")), false);
});

test("event provenance rejects unclosed services and corrupted chains", () => {
  const start = { sequence: 0, previousHash: "0".repeat(64), event: { type: "service_started" } };
  const close = { sequence: 1, previousHash: hash(start), event: { type: "service_closed" } };
  const source = [start, close].map(body => JSON.stringify({ body, hash: hash(body) })).join("\n");
  assert.equal(verifiedEventRows(source).length, 2);
  assert.throws(() => verifiedEventRows(JSON.stringify({ body: start, hash: hash(start) })), /not closed/);
  assert.throws(() => verifiedEventRows(source.replace("service_started", "altered")), /chain/);
});

test("local builder preserves the entire 96-run allowed cohort without hidden native state", {
  skip: !existsSync("research/goalspec/runs/local-training-v2-verdicts-20260915/outcomes.jsonl"),
}, () => {
  const { artifact, summary } = buildLocalMemory(process.cwd());
  assert.equal(summary.runs, 96);
  assert.deepEqual(summary.stages.map(stage => stage.runs), [48, 24, 24]);
  assert.deepEqual(summary.stages.map(stage => stage.failedRuns), [2, 24, 7]);
  assert.equal(summary.providerCalls, 0);
  assert.equal(artifact.sourceFiles.some(source => /heldout|confirmation/.test(source.path)), false);
  const serialized = canonical(artifact);
  for (const field of ["encrypted_content", "finalDatabase", "expectedStateHash", "raw_data", "independentCheck"]) assert.equal(serialized.includes(`\"${field}\"`), false);
  assert.ok(summary.causalMismatches > 0); assert.ok(summary.latePredictions > 0);
});
