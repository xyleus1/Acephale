import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { hash } from "../src/lib/goalspec/canonical";
import { LocalController } from "../src/lib/goalspec/controller";
import { apigenFrame, parseAPIGenAction, predictAPIGenPrefix, replayAPIGenEpisode, type Episode } from "./goalspec-controller-apigen-replay";
const schema = (name: string) => ({ type: "object", properties: { [name]: { type: "string" } }, required: [name], additionalProperties: false });
const catalog = { find_user_id_by_email: schema("email"), get_user_details: schema("user_id"), get_order_details: schema("order_id") };
const model = new LocalController(JSON.parse(readFileSync("research/goalspec/runs/local-controller-v4-trained-20260916-b/controller.json", "utf8")));
const call = (name: string, args: unknown) => ({ role: "function_call" as const, content: JSON.stringify({ name, arguments: args }) });
function fixture(): Episode { return { id: "synthetic-apigen", source_id: "synthetic", family_id: "retail:synthetic", content_hash: "synthetic", split: "diagnostic", policy: "Visible requests only",
  source: "Salesforce/APIGen-MT-5k", revision: "synthetic", license: "cc-by-nc-4.0", license_text: "synthetic", verification_tier: "source_reported", native_executable: false,
  tools: Object.entries(catalog).map(([name, parameters]) => ({ name, parameters })), messages: [
    { role: "user", content: "My user ID is user_abc. Please find my orders." }, call("get_user_details", { user_id: "user_abc" }),
    { role: "tool", content: '{"orders":["FUTURE_ORDER"]}' }, call("get_order_details", { order_id: "FUTURE_ORDER" }),
    { role: "tool", content: '{}' }, { role: "assistant", content: "Here is the order." }] }; }
function replay(episode: Episode) { const checkpoints: Record<string, unknown>[] = [], scores: any[] = [];
  const receipt = replayAPIGenEpisode(episode, model, (checkpoint, rows) => { checkpoints.push(checkpoint); scores.push(...rows); }); return { receipt, checkpoints, scores }; }

test("APIGen parses JSON string arguments without coercion or out-of-catalog aliases", () => {
  assert.deepEqual(parseAPIGenAction(JSON.stringify({ name: "get_user_details", arguments: '{"user_id":"abc"}' }), catalog), { action: { tool: "get_user_details", arguments: { user_id: "abc" } }, reason: null });
  assert.equal(parseAPIGenAction(JSON.stringify({ name: "get_user_details", arguments: { user_id: 123 } }), catalog).reason, "arguments_fail_source_schema");
  assert.equal(parseAPIGenAction(JSON.stringify({ name: "get_item_details", arguments: { item_id: "abc" } }), catalog).reason, "tool_outside_source_catalog");
  assert.equal(parseAPIGenAction(JSON.stringify({ name: "get_user_details", arguments: "{'user_id':'abc'}" }), catalog).reason, "malformed_argument_json");
  assert.equal(parseAPIGenAction(JSON.stringify({ name: "get_user_details", arguments: { user_id: "abc", hidden: true } }), catalog).reason, "arguments_fail_source_schema");
});
test("APIGen targets cannot seed prediction pools and both rankers share exactly one pool", () => {
  const left = fixture(), right = structuredClone(left); right.messages[1] = call("get_order_details", { order_id: "SECRET_FUTURE" });
  const a = replay(left), b = replay(right);
  assert.equal(a.checkpoints[0].candidatePoolHash, b.checkpoints[0].candidatePoolHash);
  assert.equal(a.checkpoints[0].stateHash, b.checkpoints[0].stateHash);
  assert(!JSON.stringify(a.checkpoints[0].candidates).includes("FUTURE_ORDER"));
  assert(JSON.stringify(a.checkpoints[1].candidates).includes("FUTURE_ORDER"));
  assert.equal(a.scores[0].poolHash, a.scores[1].poolHash);
  assert(a.scores.every(row => row.universe === "proposal" && row.executionAllowed === false));
  const candidates = a.checkpoints[0].candidates as any[];
  assert(candidates.length > 0 && candidates.every(entry => entry.candidate.invocation.scope.environmentVersion === "unverified-apigen:synthetic"
    && entry.candidate.invocation.scope.authorizationVersion === "not-established"));
});
test("APIGen invalid calls remain denominator records and cannot seed proposals via their results", () => {
  const episode = fixture(); episode.messages[1] = call("invented_profile_lookup", { user_id: "user_abc" });
  const result = replay(episode);
  assert.equal(result.receipt.checkpoints, 3); assert.equal(result.receipt.errors.tool_outside_source_catalog, 1);
  assert(result.scores.slice(0, 2).every(row => row.actualRead === null && row.status === "unavailable"));
  assert(!JSON.stringify(result.checkpoints[1].candidates).includes("FUTURE_ORDER"));
  assert.equal(result.checkpoints[1].prefixHasInvalidAction, true);
  assert(result.scores.slice(-2).every(row => row.actualRead === false));
});
test("APIGen static binder rejects native authorized frames", () => {
  const frame = apigenFrame(fixture(), [{ role: "user", content: "My user ID is user_abc.", calls: [] }], 0), original = hash(frame);
  predictAPIGenPrefix(frame, catalog, model); assert.equal(hash(frame), original);
  frame.scope.authorizationVersion = "native-v1";
  assert.throws(() => predictAPIGenPrefix(frame, catalog, model), /non-executable/);
});
