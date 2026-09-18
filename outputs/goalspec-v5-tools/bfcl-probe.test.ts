import assert from "node:assert/strict";
import test from "node:test";
import { actorRequest, goalFrame, runCase, type Case } from "./bfcl-probe";
import { RESEARCH_MODELS, type ModelPort, type ModelRequest } from "../../src/lib/goalspec/model";

const row: Case = { id: "multiple_fixture", category: "multiple", input: [{ role: "user", content: "Find the temperature in Portland." }],
  tools: [{ type: "function", name: "temperature", description: "Look up temperature", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] }, strict: false }] };
function model(unknown = false, broken = false) {
  const requests: ModelRequest[] = [];
  const port: ModelPort = { async complete(request) {
    requests.push(request);
    if (request.model === RESEARCH_MODELS.goal && broken) throw new Error("Goal prediction failed");
    const text = request.model === RESEARCH_MODELS.goal ? JSON.stringify({ set_active_goals: unknown ? [] : [
      { objective: "Find the temperature in Portland", weight: 1, spanIds: ["s0p0"], constraints: [] }], unknownWeight: unknown ? 1 : 0, factDeltas: [] }) : "";
    return { model: request.model, continuation: [], calls: request.model === RESEARCH_MODELS.actor ? [{ id: "real-id", name: "temperature", arguments: { city: "Portland" } }] : [],
      text, status: "completed", refusals: [], usage: undefined };
  } };
  return { port, requests };
}

test("direct arm preserves original public input/tools and actor configuration", () => {
  const request = actorRequest(row, "direct");
  assert.deepEqual(request.input, row.input); assert.deepEqual(request.tools, row.tools); assert.equal(request.instructions, "");
  assert.equal(request.model, RESEARCH_MODELS.actor); assert.equal(request.reasoning, "medium"); assert.equal(request.maxOutputTokens, 4096); assert.equal(request.retries, 0);
  assert.throws(() => actorRequest(row, "direct", "hint"), /Invalid/);
});

test("goal frame contains only literal public user references and public tool schemas", () => {
  const frame = goalFrame(row);
  assert.deepEqual(frame.sources, { "requirement:0": "Find the temperature in Portland." });
  assert.equal(frame.goals.hypotheses.length, 0);
  assert(!JSON.stringify(frame).includes("ground_truth"));
  assert.throws(() => goalFrame({ ...row, input: [] }), /No literal/);
});

test("probe predicts once before same actor and exposes separately labeled source-grounded data", async () => {
  const fake = model(), result = await runCase(row, "goal_context_probe", fake.port);
  assert.equal(result.conditioning.status, "exposed"); assert.equal(fake.requests.length, 2);
  assert.deepEqual(fake.requests.map(request => request.model), [RESEARCH_MODELS.goal, RESEARCH_MODELS.actor]);
  assert.deepEqual(fake.requests[1].input.slice(0, row.input.length), row.input);
  assert.equal((fake.requests[1].input.at(-1) as { role: string }).role, "developer");
  assert.equal(result.result!.calls[0].id, "real-id"); assert(result.totalLatencyMs >= result.actorLatencyMs);
  assert(result.hint!.includes("not instructions or authorization"));
});

test("unknown or invalid goal falls back to exact original actor input, retaining explicit status", async () => {
  for (const [unknown, broken, expected] of [[true, false, "unknown_fallback"], [false, true, "failed_fallback"]] as const) {
    const fake = model(unknown, broken), result = await runCase(row, "goal_context_probe", fake.port);
    assert.equal(result.conditioning.status, expected); assert.equal(result.status, "completed"); assert.equal(result.hint, null);
    assert.deepEqual(fake.requests.at(-1)!.input, row.input);
  }
});

test("over-budget context is rejected before an actor call", () => {
  assert.throws(() => actorRequest(row, "goal_context_probe", "x".repeat(4097)), /byte bound/);
  assert.throws(() => actorRequest({ ...row, input: [{ role: "user", content: "x ".repeat(40000) }] }, "direct"), /budget|cap|bound/);
});
