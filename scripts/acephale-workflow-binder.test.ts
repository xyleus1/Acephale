import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../src/lib/acephale/canonical";
import type { ExecutionFrame } from "../src/lib/acephale/contracts/generated";
import type { Experience } from "../src/lib/acephale/repository";
import { bindWorkflowPatterns } from "../src/lib/acephale/workflow-binder";
import { extractMemoryEpisodes } from "../src/lib/acephale/trace-extractor";
import type { MemoryRun, MemoryMessage } from "../src/lib/acephale/experience-memory";

function fixture() {
  const scope = { tenantId: "study", principalId: "actor", authorizationVersion: "1", environmentVersion: "fixture", toolSchemaHash: hash("tools") };
  const frame: ExecutionFrame = { schemaVersion: 1, runId: "current", scope, boundary: 1, snapshotId: "frozen", policy: "read only", requestedObjective: "Find my order",
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) }, sources: { _signatures: ["find_user:success"], _binding_events: [
      { seq: 0, kind: "tool_request", call_id: "current-identity", tool: "find_user", arguments: { email: "current@example.test" } },
      { seq: 1, kind: "tool_result", call_id: "current-identity", tool: "find_user", status: "success", result: { user_id: "current-user" } },
    ] } };
  const record: Experience = { id: "pattern", familyId: "training-family", text: "find then read", embedding: [], split: "train", pattern: {
    schemaVersion: 1, id: "pattern", scope, snapshotId: "frozen", verificationTier: "native_verified", prefix: ["find_user:success"], tool: "get_orders",
    binding: { language_version: 1, examples: 2, total_examples: 2, expression: { kind: "object", fields: { user_id: { kind: "reference", reference: { source: "result", tool: "find_user", occurrence: 1, path: ["user_id"] } } } } },
    dataDependencies: ["find_user"], policyPrerequisites: [], observedOrdering: ["find_user:success"], branches: [], successes: 2, failures: 0,
  } };
  return { frame, record };
}

test("workflow binding uses current observations and fails closed across scope, snapshot and prerequisites", () => {
  const { frame, record } = fixture();
  const candidates = bindWorkflowPatterns(frame, [record]);
  assert.deepEqual(candidates.map(row => row.invocation.arguments), [{ user_id: "current-user" }]);
  assert.equal(candidates[0].invocation.scope, frame.scope);
  for (const changed of [ { ...record, split: "test" as const }, { ...record, pattern: { ...record.pattern, snapshotId: "other" } },
    { ...record, pattern: { ...record.pattern, scope: { ...frame.scope, principalId: "other" } } },
    { ...record, pattern: { ...record.pattern, policyPrerequisites: ["confirm"] } } ]) assert.deepEqual(bindWorkflowPatterns(frame, [changed]), []);
  assert.deepEqual(bindWorkflowPatterns({ ...frame, sources: { ...frame.sources, _binding_events: [] } }, [record]), []);
});

test("trace extraction keeps future labels separate from public prefixes and records current argument provenance", () => {
  const { frame } = fixture();
  const run: MemoryRun = { id: "training", familyId: "training-family", stage: "v5-training", split: "train", scope: frame.scope,
    policyHash: hash(frame.policy), sourceFiles: [], success: true, outcomeVerified: true, constraintViolations: 0,
    termination: "completed", publicMessageCount: 4, episodeCount: 0, verificationTier: "native_verified" };
  const messages: MemoryMessage[] = [
    { index: 0, role: "user", content: "Find order CURRENT", calls: [], callId: null, observation: null },
    { index: 1, role: "assistant", content: null, calls: [{ id: "call", tool: "get_order", arguments: { id: "CURRENT" } }], callId: null, observation: null },
    { index: 2, role: "tool", content: "FUTURE_RESULT", calls: [], callId: "call", observation: { status: "FUTURE_RESULT" } },
    { index: 3, role: "assistant", content: "Finished", calls: [], callId: null, observation: null },
  ];
  const episodes = extractMemoryEpisodes(run, messages);
  assert.equal(episodes.length, 2); assert.equal(episodes[0].prefix.length, 1);
  assert.ok(!JSON.stringify(episodes[0].prefix).includes("FUTURE_RESULT"));
  assert.deepEqual(episodes[0].argumentSources[0].sources, [{ messageIndex: 0, path: ["content"], method: "substring" }]);
  assert.equal(episodes[0].resultingObservations[0].content, "FUTURE_RESULT");
});
