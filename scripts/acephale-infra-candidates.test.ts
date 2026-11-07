import assert from "node:assert/strict";
import { test } from "node:test";
import { copy, hash } from "../src/lib/acephale/canonical";
import type { Candidate } from "../src/lib/acephale/contracts/generated";
import { buildMemoryArtifact } from "../src/lib/acephale/experience-memory";
import { createInfraNativeCandidates, mergeInfraNativeCandidates } from "../services/acephale-runtime/infra-candidates";
import { infraCandidateCompilerHash } from "../services/acephale-runtime/infra-compiler-identity";
import { NativeReadPolicy } from "../services/acephale-runtime/native-read-policy";
import { infraNativeFrame } from "../services/acephale-runtime/infra-native-worker";
import { publicInfraFrame } from "./acephale-infra-predict";

const tools = [{ type: "function" as const, function: { name: "find_user_id_by_email", parameters: {
  type: "object", required: ["email"], properties: { email: { type: "string" } }, additionalProperties: false,
} } }];
const scope = { tenantId: "custom-tau-retail", principalId: "native-actor", authorizationVersion: "native-v1",
  environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(tools) };
function candidate(id: string, email = "current@example.com"): Candidate {
  return { schemaVersion: 1, id, invocation: { tool: "find_user_id_by_email", arguments: { email }, scope },
    probability: 0.5, hop: 1, patternId: null, bindings: [{ sourceId: "requirement:0", path: [] }] };
}

test("native shared pool preserves graph IDs and bindings, rejects ineligible reads and bounds size", () => {
  const graph = candidate("graph");
  const workflow: Candidate = { ...candidate("workflow"), bindings: [{ sourceId: "_binding_events", path: [] }] };
  assert.deepEqual(mergeInfraNativeCandidates([graph], [workflow], () => true), [graph]);
  assert.deepEqual(mergeInfraNativeCandidates([graph], [workflow], () => false), []);
  const pool = mergeInfraNativeCandidates(Array.from({ length: 140 }, (_, index) => candidate(String(index), `${index}@example.com`)), [], () => true);
  assert.equal(pool.length, 128); assert.equal(pool.at(-1)!.id, "127");
});

test("public replay and live native inputs compile the same eligible personalized candidate", () => {
  const requirement = "My email is current@example.com. Find my order.";
  const input = { policy: "Read only", sources: [{ id: "event:0", kind: "user", value: requirement }],
    events: [{ seq: 0, kind: "message", role: "user", content: requirement }],
    tools: tools.map(tool => ({ name: tool.function.name, parameters: tool.function.parameters })) };
  const replay = publicInfraFrame({ checkpoint_id: "checkpoint", input_hash: hash(input), episode_id: "episode", family_id: "dev", split: "development",
    domain: "retail", through_seq: 0, environment_version: scope.environmentVersion, tool_schema_hash: scope.toolSchemaHash,
    scope: { tenant_id: scope.tenantId, principal_id: scope.principalId, authorization_revision: scope.authorizationVersion }, input }, "frozen");
  const native = infraNativeFrame({ policy: input.policy, tools, messages: [{ role: "user", content: requirement }] },
    { runId: "native", scope, snapshotId: "frozen", maxBoundaries: 5, seed: 0 }, 1);
  const memory = buildMemoryArtifact({ repositorySnapshotId: "frozen", sourceFiles: [], runs: [], episodes: [], misses: [] }, { profile: "v5" });
  const compile = (frame: typeof native) => {
    const reads = new NativeReadPolicy("retail", scope); reads.updateFrame(frame);
    return createInfraNativeCandidates(memory, Object.fromEntries(input.tools.map(tool => [tool.name, tool.parameters])), invocation => reads.eligible(invocation),
      { allowedFamilies: ["train"], excludeFamilies: ["dev"] }).candidates(frame);
  };
  const replayPool = compile(replay), nativePool = compile(native);
  assert.equal(replayPool.length, 1); assert.deepEqual(replayPool, nativePool);
  assert.equal(replay.sources["event:0"], requirement); assert.equal(replay.sources["requirement:0"], requirement);
  const changed = copy(replay); changed.sources["requirement:0"] = "Different email different@example.com";
  assert.ok(compile(changed).every(value => value.invocation.arguments.email !== "current@example.com"));
});

test("candidate compiler identity is repeatable and separates native and document profiles", () => {
  const native = infraCandidateCompilerHash("native"), documents = infraCandidateCompilerHash("documents");
  assert.match(native, /^[a-f0-9]{64}$/); assert.equal(infraCandidateCompilerHash("native"), native); assert.notEqual(native, documents);
});

test("large graph lanes cannot starve workflow candidates or other tool names", () => {
  const bulk = Array.from({ length: 140 }, (_, index) => candidate(`graph-${index}`, `${index}@example.com`));
  const other = candidate("other-tool"); other.invocation.tool = "get_order_details";
  const workflow = candidate("workflow-only", "new@example.com");
  const pool = mergeInfraNativeCandidates([...bulk, other], [workflow], () => true);
  assert.equal(pool.length, 128);
  assert.deepEqual(pool.slice(0, 3).map(item => item.id), ["graph-0", "workflow-only", "other-tool"]);
  assert.deepEqual(pool, mergeInfraNativeCandidates([...bulk, other], [workflow], () => true));
});
