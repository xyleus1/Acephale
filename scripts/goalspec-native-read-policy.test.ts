import test from "node:test";
import assert from "node:assert/strict";
import { copy, hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame, Invocation, Json, Scope } from "../src/lib/goalspec/contracts/generated";
import { isNativeNonMutatingTool, NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";

const environmentVersion = "2174a603f6d014ef94473ffa95957f6ce27100db";
function scope(domain = "retail"): Scope { return { tenantId: `custom-tau-${domain}`, principalId: "native-actor",
  authorizationVersion: "native-v1", environmentVersion, toolSchemaHash: hash([]) }; }
type Event = Record<string, Json>;
function events(tool: string, args: Record<string, Json>, result: Json, id = "call", success = true): Event[] {
  return [{ seq: 0, kind: "tool_request", tool, arguments: args, call_id: id },
    { seq: 1, kind: "tool_result", tool, result, call_id: id, status: success ? "success" : "error" }];
}
function frame(domain: "retail" | "airline" = "retail", history: Event[] = [], request?: string): ExecutionFrame {
  return { schemaVersion: 1, runId: "current", scope: scope(domain), snapshotId: "frozen", boundary: 0,
    policy: `${domain} native policy`, requestedObjective: "Help with my record",
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) },
    sources: { "requirement:1": request ?? (domain === "retail" ? "My email is alex@example.com. My user ID is user_a and order is #A." : "My user ID is user_a. Please check reservation R-A."),
      _binding_events: history, _signatures: [] } };
}
function invoke(tool: string, args: Record<string, Json>, domain = "retail"): Invocation { return { tool, arguments: args, scope: scope(domain) }; }
const identity = events("find_user_id_by_email", { email: "alex@example.com" }, "user_a", "identity");
const profile = events("get_user_details", { user_id: "user_a" }, { user_id: "user_a", orders: ["#A"] }, "profile");
const orderValue = { user_id: "user_a", order_id: "#A", items: [{ product_id: "P-A", item_id: "I-A" }] };
const order = events("get_order_details", { order_id: "#A" }, orderValue, "order");

test("retail starts denied except a current user-supplied identity lookup", () => {
  const policy = new NativeReadPolicy("retail", scope());
  assert.equal(policy.eligible(invoke("find_user_id_by_email", { email: "alex@example.com" })), false);
  policy.updateFrame(frame());
  assert.equal(policy.eligible(invoke("find_user_id_by_email", { email: "alex@example.com" })), true);
  assert.equal(policy.eligible(invoke("find_user_id_by_email", { email: "other@example.com" })), false);
  assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_a" })), false, "A supplied user ID alone does not authenticate retail");
  assert.equal(policy.eligible(invoke("get_order_details", { order_id: "#A" })), false);
  assert.equal(policy.eligible(invoke("list_all_product_types", {})), false);
});

test("retail name/ZIP fallback follows the pinned tool's email-failure or unavailable-email prerequisite", () => {
  const policy = new NativeReadPolicy("retail", scope()), query = invoke("find_user_id_by_name_zip", { first_name: "Alex", last_name: "River", zip: "12345" });
  policy.updateFrame(frame("retail", [], "I am Alex River, zip 12345."));
  assert.equal(policy.eligible(query), false);
  policy.updateFrame(frame("retail", [], "I can't remember my email. I am Alex River, zip 12345."));
  assert.equal(policy.eligible(query), true);
  policy.updateFrame(frame("retail", events("find_user_id_by_email", { email: "alex@example.com" }, "User not found", "failed", false), "I am Alex River, zip 12345."));
  assert.equal(policy.eligible(query), true);
});

test("matched successful identity then same-user profile establishes owned records only", () => {
  const policy = new NativeReadPolicy("retail", scope());
  policy.updateFrame(frame("retail", identity));
  assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_a" })), true);
  assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_b" })), false);
  assert.equal(policy.eligible(invoke("get_order_details", { order_id: "#A" })), false);
  policy.updateFrame(frame("retail", [...identity, ...profile]));
  assert.equal(policy.eligible(invoke("get_order_details", { order_id: "#A" })), true);
  assert.equal(policy.eligible(invoke("get_order_details", { order_id: "#OTHER" })), false);
});

test("failed, unmatched or malformed identity results cannot grant access", () => {
  const policy = new NativeReadPolicy("retail", scope());
  for (const history of [events("find_user_id_by_email", { email: "alex@example.com" }, "user_a", "lookup", false),
    events("find_user_id_by_email", { email: "other@example.com" }, "user_a"),
    events("find_user_id_by_email", { email: "alex@example.com" }, "Error: user not found"),
    [{ kind: "tool_result", call_id: "missing", tool: "find_user_id_by_email", status: "success", result: "user_a" }]]) {
    policy.updateFrame(frame("retail", history));
    assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_a" })), false);
  }
});

test("retail products and items require an owned order, and foreign order observations grant nothing", () => {
  const policy = new NativeReadPolicy("retail", scope());
  policy.updateFrame(frame("retail", [...identity, ...profile]));
  assert.equal(policy.eligible(invoke("get_product_details", { product_id: "P-A" })), false);
  policy.updateFrame(frame("retail", [...identity, ...profile, ...order]));
  assert.equal(policy.eligible(invoke("get_product_details", { product_id: "P-A" })), true);
  assert.equal(policy.eligible(invoke("get_item_details", { item_id: "I-A" })), true);
  assert.equal(policy.eligible(invoke("get_product_details", { product_id: "P-OTHER" })), false);
  policy.updateFrame(frame("retail", [...identity, ...profile, ...events("get_order_details", { order_id: "#A" }, { ...orderValue, user_id: "user_b" }, "foreign")]));
  assert.equal(policy.eligible(invoke("get_product_details", { product_id: "P-A" })), false);
});

test("fresh observation validation rejects owner transfers and record substitutions before exposure", () => {
  const policy = new NativeReadPolicy("retail", scope()); policy.updateFrame(frame("retail", [...identity, ...profile]));
  const query = invoke("get_order_details", { order_id: "#A" });
  assert.equal(policy.validateObservation(query, orderValue), true);
  assert.equal(policy.validateObservation(query, { ...orderValue, user_id: "new-owner" }), false);
  assert.equal(policy.observeVerified(query, { ...orderValue, user_id: "new-owner" }), false);
  assert.equal(policy.validateObservation(query, { ...orderValue, order_id: "#OTHER" }), false);
  assert.equal(policy.validateObservation(invoke("get_user_details", { user_id: "user_a" }), { user_id: "user_b", orders: ["#A"] }), false);
});

test("all writes, messages, handoffs and unknown reads stay ineligible", () => {
  const policy = new NativeReadPolicy("retail", scope()); policy.updateFrame(frame("retail", [...identity, ...profile, ...order]));
  for (const tool of ["cancel_pending_order", "modify_user_address", "return_delivered_order_items", "transfer_to_human_agents", "send_message", "unknown_lookup"]) {
    assert.equal(policy.eligible(invoke(tool, { order_id: "#A" })), false);
  }
});

test("scope changes, wrong environment and absent policy remove access", () => {
  const policy = new NativeReadPolicy("retail", scope()), valid = frame("retail", [...identity, ...profile]);
  policy.updateFrame(valid);
  const changed = invoke("get_order_details", { order_id: "#A" }); changed.scope.authorizationVersion = "revoked";
  assert.equal(policy.eligible(changed), false);
  for (const altered of [ { ...valid, policy: "" }, { ...valid, scope: { ...scope(), environmentVersion: "other" } },
    { ...valid, scope: { ...scope(), principalId: "other" } } ]) {
    policy.updateFrame(altered); assert.equal(policy.eligible(invoke("get_order_details", { order_id: "#A" })), false);
  }
});

test("only one retail identity is accepted per conversation", () => {
  const policy = new NativeReadPolicy("retail", scope());
  policy.updateFrame(frame("retail", [...identity, ...profile, ...events("find_user_id_by_email", { email: "second@example.com" }, "user_b", "second")],
    "My emails are alex@example.com and second@example.com."));
  assert.equal(policy.eligible(invoke("get_order_details", { order_id: "#A" })), false);
  assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_b" })), false);
});

test("airline requires a user-supplied user ID and profile-owned reservation", () => {
  const policy = new NativeReadPolicy("airline", scope("airline")); policy.updateFrame(frame("airline"));
  assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_a" }, "airline")), true);
  assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user" }, "airline")), false, "Identifier substring is not the supplied identifier");
  assert.equal(policy.eligible(invoke("get_reservation_details", { reservation_id: "R-A" }, "airline")), false);
  policy.updateFrame(frame("airline", events("get_user_details", { user_id: "user_a" }, { user_id: "user_a", reservations: ["R-A"] }, "profile")));
  const query = invoke("get_reservation_details", { reservation_id: "R-A" }, "airline");
  assert.equal(policy.eligible(query), true);
  assert.equal(policy.eligible(invoke("get_reservation_details", { reservation_id: "R-OTHER" }, "airline")), false);
  assert.equal(policy.validateObservation(query, { reservation_id: "R-A", user_id: "user_b" }), false);
  assert.equal(policy.validateObservation(query, { reservation_id: "R-A", user_id: "user_a" }), true);
  assert.equal(policy.eligible(invoke("search_direct_flight", { origin: "JFK", destination: "LAX", date: "2024-05-20" }, "airline")), true);
  assert.equal(policy.eligible(invoke("book_reservation", {}, "airline")), false);
});

test("a speculative read alone cannot authenticate; successful validated receipts can advance the chain", () => {
  const policy = new NativeReadPolicy("retail", scope()); policy.updateFrame(frame());
  const identify = invoke("find_user_id_by_email", { email: "alex@example.com" }), user = invoke("get_user_details", { user_id: "user_a" });
  assert.equal(policy.observeVerified(identify, "user_a"), false);
  assert.equal(policy.validateObservation(identify, "user_a"), true);
  assert.equal(policy.eligible(user), false, "Local observation validation alone is not a fresh lease receipt");
  assert.equal(policy.observeVerified(identify, "user_a"), true);
  assert.equal(policy.eligible(user), true);
  assert.equal(policy.eligible(identify), true, "An already exposed exact identity read remains eligible for authoritative promotion");
  assert.equal(policy.validateObservation(identify, "user_a"), true);
  assert.equal(policy.observeVerified(identify, "user_a"), true);
  assert.equal(policy.validateObservation(identify, "user_b"), false, "Identity ownership cannot change on revalidation");
  assert.equal(policy.validateObservation(user, { user_id: "user_a", orders: ["#A"] }), true);
  assert.equal(policy.observeVerified(user, { user_id: "user_a", orders: ["#A"] }), true);
  assert.equal(policy.eligible(invoke("get_order_details", { order_id: "#A" })), true);
  assert.equal(policy.validateObservation(identify, "user_a"), true);
  assert.equal(policy.observeVerified(identify, "user_a"), true, "An identity refresh preserves prerequisite receipt order");
  policy.updateFrame({ ...frame(), boundary: 1 });
  assert.equal(policy.eligible(invoke("get_order_details", { order_id: "#A" })), true, "Verified receipts survive an unchanged public history");
});

test("reconstructed speculative metadata cannot grant identity without a server-owned receipt", () => {
  const policy = new NativeReadPolicy("retail", scope());
  const injected = identity.map(event => ({ ...event, speculative: true }));
  policy.updateFrame(frame("retail", injected));
  assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_a" })), false);
  const identify = invoke("find_user_id_by_email", { email: "alex@example.com" });
  assert.equal(policy.validateObservation(identify, "user_a"), true); assert.equal(policy.observeVerified(identify, "user_a"), true);
  policy.updateFrame(frame("retail", injected));
  assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_a" })), true);
});

test("receipt support changes or a later mutation invalidate speculative trust", () => {
  for (const changed of [frame("retail", [], "My email is somebody@example.com."), frame("retail", [
    { kind: "tool_request", call_id: "write", tool: "modify_user_address", arguments: { user_id: "user_a" } },
  ])]) {
    const policy = new NativeReadPolicy("retail", scope()); policy.updateFrame(frame());
    const identify = invoke("find_user_id_by_email", { email: "alex@example.com" });
    assert.equal(policy.validateObservation(identify, "user_a"), true); assert.equal(policy.observeVerified(identify, "user_a"), true);
    policy.updateFrame(changed);
    assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_a" })), false);
  }
});

test("older verified profile receipt cannot override a later authoritative profile observation", () => {
  const policy = new NativeReadPolicy("retail", scope()); policy.updateFrame(frame("retail", identity));
  const user = invoke("get_user_details", { user_id: "user_a" });
  assert.equal(policy.validateObservation(user, { user_id: "user_a", orders: ["#A"] }), true);
  assert.equal(policy.observeVerified(user, { user_id: "user_a", orders: ["#A"] }), true);
  policy.updateFrame(frame("retail", [...identity, ...events("get_user_details", { user_id: "user_a" }, { user_id: "user_a", orders: [] }, "new-profile")]));
  assert.equal(policy.eligible(invoke("get_order_details", { order_id: "#A" })), false);
});

test("receipt validation cannot be reused for changed observations or a changed actor boundary", () => {
  const policy = new NativeReadPolicy("retail", scope()); policy.updateFrame(frame());
  const identify = invoke("find_user_id_by_email", { email: "alex@example.com" });
  assert.equal(policy.validateObservation(identify, "user_a"), true);
  assert.equal(policy.observeVerified(identify, "user_b"), false);
  policy.updateFrame(copy(frame()));
  assert.equal(policy.observeVerified(identify, "user_a"), false);
});

test("calculate preserves verified causal receipts but is never eligible for speculation", () => {
  for (const success of [true, false]) {
    const policy = new NativeReadPolicy("retail", scope()); policy.updateFrame(frame());
    const identify = invoke("find_user_id_by_email", { email: "alex@example.com" });
    assert.equal(policy.validateObservation(identify, "user_a"), true);
    assert.equal(policy.observeVerified(identify, "user_a"), true);
    policy.updateFrame(frame("retail", events("calculate", { expression: success ? "2+2" : "1/0" }, success ? "4.0" : "error", "math", success)));
    const calculate = invoke("calculate", { expression: "2+2" });
    assert.equal(policy.nonMutating(calculate), true);
    assert.equal(policy.eligible(calculate), false);
    assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_a" })), true);
    const foreign = copy(calculate); foreign.scope.principalId = "other";
    assert.equal(policy.nonMutating(foreign), false);
    policy.updateFrame(frame("retail", [...events("calculate", { expression: "2+2" }, "4.0", "math"),
      { kind: "tool_request", call_id: "write", tool: "modify_user_address", arguments: { user_id: "user_a" } }]));
    assert.equal(policy.eligible(invoke("get_user_details", { user_id: "user_a" })), false);
  }
  for (const domain of ["retail", "airline"] as const) {
    assert.equal(isNativeNonMutatingTool(domain, "calculate"), true);
    for (const tool of ["modify_user_address", "cancel_reservation", "transfer_to_human_agents", "unknown_lookup"]) {
      assert.equal(isNativeNonMutatingTool(domain, tool), false);
    }
  }
});
