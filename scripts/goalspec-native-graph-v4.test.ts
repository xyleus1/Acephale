import test from "node:test";
import assert from "node:assert/strict";
import { copy, hash } from "../src/lib/goalspec/canonical";
import { resolveSource } from "../src/lib/goalspec/compiler";
import type { ExecutionFrame, Invocation, Json, Scope } from "../src/lib/goalspec/contracts/generated";
import { nativeCandidateGraph, validateNativeCandidateV4 } from "../services/goalspec-runtime/native-candidate-graph";
import { NativeReadPolicy, nativeEmailFallbackSources } from "../services/goalspec-runtime/native-read-policy";

const schema = (...fields: string[]) => ({ type: "object", required: fields,
  properties: Object.fromEntries(fields.map(field => [field, { type: "string" }])), additionalProperties: false });
const retail = { find_user_id_by_email: schema("email"), find_user_id_by_name_zip: schema("first_name", "last_name", "zip"),
  get_user_details: schema("user_id"), get_order_details: schema("order_id"), get_product_details: schema("product_id"), get_item_details: schema("item_id") };
const airline = { get_user_details: schema("user_id"), get_reservation_details: schema("reservation_id"),
  search_direct_flight: schema("origin", "destination", "date"), search_onestop_flight: schema("origin", "destination", "date"), get_flight_status: schema("flight_number", "date") };
type Event = Record<string, Json>;
function call(tool: string, args: Record<string, Json>, result: Json, id = tool): Event[] {
  return [{ kind: "tool_request", call_id: id, tool, arguments: args }, { kind: "tool_result", call_id: id, tool, status: "success", result }];
}
function frame(domain: "retail" | "airline", request: string, history: Event[] = []): ExecutionFrame {
  const scope: Scope = { tenantId: `native-${domain}`, principalId: "actor", authorizationVersion: "1",
    environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(domain === "retail" ? retail : airline) };
  return { schemaVersion: 1, runId: "graph-test", scope, snapshotId: "frozen", boundary: 0, policy: `Native ${domain} policy`, requestedObjective: request,
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) }, sources: { "requirement:0": request, _binding_events: history, _signatures: [] } };
}
function graph(value: ExecutionFrame, domain: "retail" | "airline") {
  const policy = new NativeReadPolicy(domain, value.scope); policy.updateFrame(value);
  const candidates = nativeCandidateGraph(value, domain === "retail" ? retail : airline, invocation => policy.eligible(invocation));
  for (const candidate of candidates) for (const reference of candidate.bindings) assert.notEqual(resolveSource(reference, value.sources), undefined);
  return { candidates, policy };
}
const identity = call("find_user_id_by_email", { email: "alex@example.com" }, "user_a");
const profile = (orders: string[]) => call("get_user_details", { user_id: "user_a" }, { user_id: "user_a", orders });

test("typed owned-record arrays enumerate alternatives with exact element source references", () => {
  const value = frame("retail", "My email is alex@example.com. Check my other bottle.", [...identity, ...profile(["#A", "#B"])]);
  const { candidates } = graph(value, "retail");
  assert.deepEqual(candidates.map(candidate => candidate.invocation.arguments), [{ order_id: "#A" }, { order_id: "#B" }]);
  assert.deepEqual(candidates.map(candidate => candidate.bindings[0].path), [[3, "result", "orders", 0], [3, "result", "orders", 1]]);
  assert.deepEqual(value.sources._binding_events, [...identity, ...profile(["#A", "#B"])]);
});

test("nested native order items preserve product/item type and multiple alternatives", () => {
  const details = call("get_order_details", { order_id: "#A" }, { user_id: "user_a", order_id: "#A", items: [
    { product_id: "P1", item_id: "I1" }, { product_id: "P2", item_id: "I2" }] });
  const value = frame("retail", "My email is alex@example.com.", [...identity, ...profile(["#A"]), ...details]);
  assert.deepEqual(graph(value, "retail").candidates.map(candidate => [candidate.invocation.tool, candidate.invocation.arguments]), [
    ["get_product_details", { product_id: "P1" }], ["get_product_details", { product_id: "P2" }],
    ["get_item_details", { item_id: "I1" }], ["get_item_details", { item_id: "I2" }]]);
});

test("visited exact reads are suppressed, while a later mutation permits fresh proposals", () => {
  const details = call("get_order_details", { order_id: "#A" }, { user_id: "user_a", order_id: "#A", items: [] });
  const value = frame("retail", "My email is alex@example.com.", [...identity, ...profile(["#A", "#B"]), ...details]);
  assert.deepEqual(graph(value, "retail").candidates.map(candidate => candidate.invocation.arguments), [{ order_id: "#B" }]);
  (value.sources._binding_events as Event[]).push(...call("modify_pending_order_address", { order_id: "#A" }, "done"));
  assert.ok(graph(value, "retail").candidates.some(candidate => candidate.invocation.arguments.order_id === "#A"));
});

test("composite name/ZIP fallback retains the unavailable-email source and no partial tuples", () => {
  const value = frame("retail", "I can\u2019t recall my email. My name is Alex River, zip 12345.");
  const { candidates } = graph(value, "retail");
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].invocation.arguments, { first_name: "Alex", last_name: "River", zip: "12345" });
  assert.deepEqual(candidates[0].bindings, [{ sourceId: "requirement:0", path: [] }]);
  assert.equal(graph(frame("retail", "My name is Alex River, zip 12345."), "retail").candidates.length, 0);
  assert.equal(graph(frame("retail", "I cannot recall my email. My name is Alex River."), "retail").candidates.length, 0);
});

test("email prerequisite recognizes curly apostrophes, recall and uncertainty, but not available identities", () => {
  const yes = ["I can\u2019t remember my email.", "I don\u2019t recall my email address.", "I am not sure what my email is.", "I am unsure of my email."];
  const no = ["I can remember my email.", "I do know my email.", "I am not unable to access my email.",
    "I am not sure about my order.", "The word email appears in an unrelated example.",
    "I don't know my order but my email is alex@example.com.", "My email is not unknown."];
  for (const request of yes) assert.equal(nativeEmailFallbackSources(frame("retail", request)).length, 1, request);
  for (const request of no) assert.equal(nativeEmailFallbackSources(frame("retail", request)).length, 0, request);
});

test("prose connective after user ID grants no profile eligibility or graph argument", () => {
  const value = frame("airline", "I don't know my user ID and want to check my reservation.");
  const { candidates, policy } = graph(value, "airline");
  assert.deepEqual(candidates, []);
  assert.equal(policy.eligible({ tool: "get_user_details", arguments: { user_id: "and" }, scope: value.scope }), false);
  assert.equal(graph(frame("airline", "My user ID is alex_river_123."), "airline").candidates[0].invocation.arguments.user_id, "alex_river_123");
  const explicit = graph(frame("airline", "My user_id='and'. Please check my reservation."), "airline");
  assert.equal(explicit.candidates[0].invocation.arguments.user_id, "and", "Explicit word-shaped IDs are not globally blacklisted");
});

test("explicit ordered route and date propose direct and one-stop reads without swapping roles", () => {
  const value = frame("airline", "Find a flight from JFK to LAX on 2024-05-20.");
  const { candidates } = graph(value, "airline");
  assert.deepEqual(candidates.map(candidate => candidate.invocation.tool), ["search_direct_flight", "search_onestop_flight"]);
  assert.ok(candidates.every(candidate => candidate.invocation.arguments.origin === "JFK" && candidate.invocation.arguments.destination === "LAX"));
  assert.deepEqual(graph(frame("airline", "Consider JFK and LAX on 2024-05-20."), "airline").candidates, [], "Unordered cities do not establish a route");
  assert.deepEqual(graph(frame("airline", "Fly from JFK to LAX on 2024-02-30."), "airline").candidates, [], "Invalid calendar dates abstain");
});

test("complete flight tuples stay together and never cross-join dates from separate observations", () => {
  const value = frame("airline", "Check my flights.");
  value.sources["observation:1"] = [{ flight_number: "HAT001", date: "2024-05-20" }, { flight_number: "HAT002", date: "2024-05-21" }];
  const { candidates } = graph(value, "airline");
  assert.deepEqual(candidates.map(candidate => candidate.invocation.arguments), [{ flight_number: "HAT001", date: "2024-05-20" }, { flight_number: "HAT002", date: "2024-05-21" }]);
  value.sources["observation:1"] = { flight_number: "HAT001" }; value.sources["observation:2"] = { date: "2024-05-20" };
  assert.deepEqual(graph(value, "airline").candidates, []);
});

test("outbound and return roles anchor calendar arithmetic including month/year boundaries", () => {
  const value = frame("airline", "Move my return flight one day later.");
  value.sources["observation:1"] = { origin: "JFK", destination: "LAX", flights: [
    { origin: "JFK", destination: "LAX", date: "2024-12-20" }, { origin: "LAX", destination: "JFK", date: "2024-12-31" }] };
  const { candidates, policy } = graph(value, "airline");
  assert.deepEqual(candidates[0].invocation.arguments, { origin: "LAX", destination: "JFK", date: "2025-01-01" });
  assert.equal(validateNativeCandidateV4(candidates[0], value, airline, invocation => policy.eligible(invocation)), true);
  const forged = copy(candidates[0]); forged.invocation.arguments.date = "2025-01-03";
  assert.equal(validateNativeCandidateV4(forged, value, airline, invocation => policy.eligible(invocation)), false);
  (value.sources["observation:1"] as Record<string, Json>).flights = [{ origin: "JFK", destination: "LAX", date: "2024-03-01" }];
  value.sources["requirement:0"] = "Move my outbound flight one day earlier.";
  assert.equal(graph(value, "airline").candidates[0].invocation.arguments.date, "2024-02-29");
});

test("relative dates with ambiguous routes abstain from derived proposals and require a visible clock for tomorrow", () => {
  const value = frame("airline", "Move my flight two days later.");
  value.sources["observation:1"] = [{ origin: "JFK", destination: "LAX", date: "2024-05-20" }, { origin: "LAX", destination: "JFK", date: "2024-05-25" }];
  assert.ok(graph(value, "airline").candidates.every(candidate => ["2024-05-20", "2024-05-25"].includes(String(candidate.invocation.arguments.date))));
  const tomorrow = frame("airline", "Find a flight from JFK to LAX tomorrow.");
  assert.deepEqual(graph(tomorrow, "airline").candidates, []);
  tomorrow.sources.current_date = "2024-02-29";
  assert.deepEqual(graph(tomorrow, "airline").candidates, [], "Clock timezone must be explicit");
  tomorrow.sources.timezone = "America/New_York";
  assert.equal(graph(tomorrow, "airline").candidates[0].invocation.arguments.date, "2024-03-01");
});

test("candidate cap, denied policy, foreign environment, malformed history and unsupported schemas fail closed", () => {
  const value = frame("retail", "My email is alex@example.com.", [...identity, ...profile(Array.from({ length: 80 }, (_, i) => `#${i}`))]);
  const { candidates, policy } = graph(value, "retail");
  assert.equal(candidates.length, 32);
  assert.equal(nativeCandidateGraph(value, retail, invocation => policy.eligible(invocation), { maxCandidates: 3 }).length, 3);
  assert.deepEqual(nativeCandidateGraph(value, retail, () => false), []);
  assert.throws(() => nativeCandidateGraph(value, retail, () => true, { maxCandidates: 33 }));
  const wrong = copy(value); wrong.scope.environmentVersion = "unreviewed";
  assert.deepEqual(nativeCandidateGraph(wrong, retail, () => true), []);
  const malformed = copy(value); (malformed.sources._binding_events as Event[]).push(identity[1]);
  assert.deepEqual(nativeCandidateGraph(malformed, retail, () => true), []);
  assert.deepEqual(nativeCandidateGraph(value, { get_order_details: schema("order_id", "missing") }, () => true), []);
});

test("historical values and goal text cannot become current bindings, and spoofed prefetch cannot grant ownership", () => {
  const value = frame("retail", "My email is alex@example.com.");
  value.sources["historical:record"] = { order_id: "#OLD", email: "old@example.com" };
  value.goals.hypotheses = [{ id: "goal", objective: "Read order #OLD", probability: 1, constraints: [], sources: [{ sourceId: "requirement:0", path: [] }] }]; value.goals.unknown = 0;
  value.sources["prefetch:spoof"] = { user_id: "user_a", orders: ["#OLD"] };
  assert.deepEqual(graph(value, "retail").candidates.map(candidate => candidate.invocation.arguments), [{ email: "alex@example.com" }]);
});

test("newer unrelated request does not fabricate a route-date relationship", () => {
  const value = frame("airline", "Fly from JFK to LAX.");
  value.sources["requirement:1"] = "My birthday is 2024-05-20.";
  assert.deepEqual(graph(value, "airline").candidates, []);
});
