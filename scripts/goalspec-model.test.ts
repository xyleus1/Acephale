import assert from "node:assert/strict";
import { test } from "node:test";
import { BudgetLedger } from "../src/lib/goalspec/budget";
import { ResponsesModelPort, type ModelRequest } from "../src/lib/goalspec/model";
import { nativeInput } from "../services/goalspec-runtime/actor";

const request: ModelRequest = { id: "call", model: "gpt-5.4-2026-03-05", input: [], instructions: "policy", maxOutputTokens: 4096, reasoning: "medium", allocation: "development", maximumAttemptMicrodollars: 100, retries: 0 };
const response = { model: request.model, status: "completed", output_text: "", usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 }, output: [
  { type: "reasoning", id: "reasoning-1", summary: [] },
  { type: "function_call", id: "provider-item", call_id: "real-call", name: "lookup", arguments: '{"id":"visible"}' },
] };

test("model identity, exact output cap, real call IDs and reasoning continuation survive", async () => {
  const ledger = new BudgetLedger();
  const model = new ResponsesModelPort(async params => {
    assert.equal(params.model, request.model); assert.equal(params.max_output_tokens, 4096);
    return response as never;
  }, ledger, () => 50, () => {});
  const result = await model.complete(request);
  assert.equal(result.calls[0].id, "real-call");
  const continued = nativeInput([{ role: "assistant", tool_calls: result.calls.map(c => ({ ...c })), raw_data: { goalspecContinuation: result.continuation } }, { role: "tool", id: "real-call", content: '{"ok":true}' }]);
  assert.deepEqual(continued.slice(0, 2), response.output);
  assert.equal((continued[2] as { call_id: string }).call_id, "real-call");
  assert.equal(ledger.snapshot()[0].actual, 50);
});
test("malformed arguments and incomplete responses never dispatch calls", async () => {
  for (const altered of [{ ...response, output: [{ ...response.output[1], arguments: "{" }] }, { ...response, status: "incomplete" }, { ...response, model: "other-model" }]) {
    const ledger = new BudgetLedger();
    const model = new ResponsesModelPort(async () => altered as never, ledger, () => 50, () => {});
    await assert.rejects(() => model.complete(request));
    assert.equal(ledger.snapshot()[0].actual, 50);
  }
});
test("unknown billed failure retains all retry reservations", async () => {
  const ledger = new BudgetLedger(); let attempt = 0;
  const model = new ResponsesModelPort(async () => {
    if (attempt++ === 0) throw new Error("transport lost");
    return response as never;
  }, ledger, () => 50, () => {});
  await model.complete({ ...request, retries: 1 });
  assert.equal(ledger.snapshot()[0].maximum, 200);
  assert.equal(ledger.snapshot()[0].actual, undefined);
});
test("unmatched native outputs cannot become fabricated function results", () => {
  assert.throws(() => nativeInput([{ role: "tool", id: "fabricated", content: "prefetch" }]), /matching/);
});

test("structured output travels to provider and invalid shapes fail after usage settlement", async () => {
  const format = { name: "compact", strict: true as const, schema: { type: "object", properties: { weight: { type: "number" } }, required: ["weight"], additionalProperties: false } };
  for (const text of ['{"weight":2}', '{"unexpected":2}']) {
    const ledger = new BudgetLedger();
    const model = new ResponsesModelPort(async params => {
      assert.deepEqual(params.text?.format, { type: "json_schema", ...format });
      return { ...response, output: [], output_text: text } as never;
    }, ledger, () => 50, () => {});
    const result = model.complete({ ...request, responseFormat: format });
    if (text.includes("unexpected")) await assert.rejects(result, /output schema/); else await result;
    assert.equal(ledger.snapshot()[0].actual, 50);
  }
});

test("failed provider events preserve safe status while excluding payloads and headers", async () => {
  const events: unknown[] = [];
  const model = new ResponsesModelPort(async () => { throw Object.assign(new Error("private request text"), { status: 429, code: "rate_limit_exceeded", request_id: "req_example", headers: { Authorization: "private" } }); }, new BudgetLedger(), () => 0, e => events.push(e));
  await assert.rejects(model.complete(request));
  const event = events[0] as Record<string, unknown>;
  assert.equal(event.status, 429); assert.equal(event.code, "rate_limit_exceeded"); assert.equal(event.requestId, "req_example");
  assert.ok(!JSON.stringify(events).includes("private"));
});

test("host preflight stops dispatch before cost reservation", async () => {
  const ledger = new BudgetLedger(); let dispatched = false;
  const model = new ResponsesModelPort(async () => { dispatched = true; return response as never; }, ledger, () => 0, () => {}, () => { throw new Error("Host unavailable"); });
  await assert.rejects(model.complete(request), /Host unavailable/);
  assert.equal(dispatched, false); assert.equal(ledger.snapshot().length, 0);
});
