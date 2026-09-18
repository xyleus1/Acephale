import test from "node:test";
import assert from "node:assert/strict";
import { copy, hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame, Invocation, Json, Scope } from "../src/lib/goalspec/contracts/generated";
import { bindNativeOutputEdges, nativeDeterministicCandidates } from "../services/goalspec-runtime/native-bindings";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";

const scope: Scope = { tenantId: "custom-tau-retail", principalId: "native-actor", authorizationVersion: "native-v1",
  environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash([]) };
const tools = { get_user_details: { type: "object", required: ["user_id"], properties: { user_id: { type: "string" } }, additionalProperties: false } };
type Event = Record<string, Json>;
const lookup = (result: Json = "user_current", id = "identity", email = "person@example.com", success = true): Event[] => [
  { kind: "tool_request", call_id: id, tool: "find_user_id_by_email", arguments: { email } },
  { kind: "tool_result", call_id: id, tool: "find_user_id_by_email", status: success ? "success" : "error", result },
];
function frame(history: Event[] = lookup()): ExecutionFrame {
  return { schemaVersion: 1, runId: "current", scope: copy(scope), snapshotId: "frozen", boundary: 2, policy: "Pinned native retail policy",
    requestedObjective: "Help with my order", goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) },
    sources: { "requirement:0": "My email is person@example.com.", _binding_events: history, _signatures: [] } };
}
function bind(value: ExecutionFrame, guard = new NativeReadPolicy("retail", scope)) {
  guard.updateFrame(value);
  return bindNativeOutputEdges("retail", value, tools, invocation => guard.eligible(invocation));
}

test("first matched identity output binds a profile read to its exact current scalar source", () => {
  const value = frame(), [candidate] = bind(value);
  assert.equal(candidate.invocation.tool, "get_user_details");
  assert.deepEqual(candidate.invocation.arguments, { user_id: "user_current" });
  assert.deepEqual(candidate.bindings, [{ sourceId: "_binding_events", path: [1, "result"] }]);
  assert.equal((value.sources._binding_events as Event[])[1].result, candidate.invocation.arguments.user_id);
  assert.equal(candidate.hop, 1);
  assert.equal(candidate.patternId, null);
  assert.deepEqual(bind(value), [candidate], "Stable proposal, with no mutation of the source frame");
});

test("name and ZIP identity output uses the same typed edge after native authentication", () => {
  const history: Event[] = [{ kind: "tool_request", call_id: "name", tool: "find_user_id_by_name_zip",
    arguments: { first_name: "Alex", last_name: "River", zip: "12345" } },
  { kind: "tool_result", call_id: "name", tool: "find_user_id_by_name_zip", status: "success", result: "user_current" }];
  const value = frame(history); value.sources["requirement:0"] = "I cannot remember my email. Alex River, zip 12345.";
  assert.equal(bind(value).length, 1);
});

test("failed, unmatched, conflicting, malformed, unauthorized and historical-only identities abstain", () => {
  const malformed: Event[] = [...lookup(), ...lookup("user_current")];
  const cases = [frame([]), frame(lookup("user_current", "identity", "person@example.com", false)),
    frame(lookup("user_current", "identity", "somebody@example.com")), frame(lookup("Error: user not found")),
    frame(lookup({ user_id: "user_current" })), frame([lookup()[1]]), frame(malformed),
    frame([...lookup(), ...lookup("user_other", "second")])];
  for (const value of cases) {
    value.sources["historical:identity"] = "user_current";
    assert.deepEqual(bind(value), []);
  }
  const value = frame(); value.scope.principalId = "different-principal";
  assert.deepEqual(bind(value), []);
  assert.deepEqual(bindNativeOutputEdges("retail", frame(), tools, () => false), []);
});

test("prefetch metadata requires a fresh server-owned identity receipt before binding", () => {
  const value = frame(lookup().map(event => ({ ...event, speculative: true }))), guard = new NativeReadPolicy("retail", scope);
  assert.deepEqual(bind(value, guard), []);
  const identify: Invocation = { tool: "find_user_id_by_email", arguments: { email: "person@example.com" }, scope };
  assert.equal(guard.validateObservation(identify, "user_current"), true);
  assert.deepEqual(bindNativeOutputEdges("retail", value, tools, invocation => guard.eligible(invocation)), []);
  assert.equal(guard.observeVerified(identify, "user_current"), true);
  const [candidate] = bindNativeOutputEdges("retail", value, tools, invocation => guard.eligible(invocation));
  assert.equal(candidate.invocation.arguments.user_id, "user_current");
  assert.deepEqual(candidate.bindings[0], { sourceId: "_binding_events", path: [1, "result"] });
});

test("unknown schema, environment and domain cannot enable this pinned edge", () => {
  const value = frame();
  assert.deepEqual(bindNativeOutputEdges("airline", value, tools, () => true), []);
  assert.deepEqual(bindNativeOutputEdges("retail", value, {}, () => true), []);
  assert.deepEqual(bindNativeOutputEdges("retail", value, { get_user_details: { ...tools.get_user_details, required: ["user_id", "extra"] } }, () => true), []);
  value.scope.environmentVersion = "unreviewed";
  assert.deepEqual(bindNativeOutputEdges("retail", value, tools, () => true), []);
});

test("combined proposals emit the first typed profile, then suppress observed profiles across calculate and writes", () => {
  const allTools = { ...tools, find_user_id_by_email: { type: "object", required: ["email"], properties: { email: { type: "string" } } } };
  const guard = new NativeReadPolicy("retail", scope), initial = frame();
  guard.updateFrame(initial);
  assert.deepEqual(nativeDeterministicCandidates(initial, allTools, query => guard.eligible(query)).map(candidate => candidate.invocation.tool), ["get_user_details"]);
  for (const speculative of [false, true]) {
    const profile: Event[] = [{ kind: "tool_request", call_id: "profile", tool: "get_user_details", arguments: { user_id: "user_current" }, speculative },
      { kind: "tool_result", call_id: "profile", tool: "get_user_details", status: "success", result: { user_id: "user_current", orders: [] }, speculative }];
    for (const tool of ["calculate", "exchange_delivered_order_items"]) {
      const value = frame([...lookup(), ...profile, { kind: "tool_request", call_id: "later", tool, arguments: {} },
        { kind: "tool_result", call_id: "later", tool, status: "success", result: "done" }]);
      value.sources["observation:profile"] = { user_id: "user_current", orders: [] };
      guard.updateFrame(value);
      assert.equal(nativeDeterministicCandidates(value, allTools, query => guard.eligible(query)).some(candidate => candidate.invocation.tool === "get_user_details"), false);
      assert.equal(guard.eligible({ tool: "get_user_details", arguments: { user_id: "user_current" }, scope }), true,
        "Proposal suppression never denies an authoritative profile refresh");
    }
  }
});

test("failed profiles do not suppress the first useful read; another argument remains distinct", () => {
  const value = frame([...lookup(), { kind: "tool_request", call_id: "profile", tool: "get_user_details", arguments: { user_id: "user_current" } },
    { kind: "tool_result", call_id: "profile", tool: "get_user_details", status: "error", result: "temporary error" }]);
  value.sources["requirement:1"] = "user_id: user_current";
  assert.equal(nativeDeterministicCandidates(value, tools, () => true).length, 1);
  (value.sources._binding_events as Event[])[3] = { kind: "tool_result", call_id: "profile", tool: "get_user_details", status: "success",
    result: { user_id: "user_current", orders: [] } };
  value.sources["requirement:1"] = "user_id: user_other";
  assert.deepEqual(nativeDeterministicCandidates(value, tools, () => true).map(candidate => candidate.invocation.arguments), [{ user_id: "user_other" }]);
});
