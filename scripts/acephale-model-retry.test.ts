import assert from "node:assert/strict";
import { test } from "node:test";
import OpenAI from "openai";
import { BudgetLedger } from "../src/lib/acephale/budget";
import { ResponsesModelPort, type ModelRequest } from "../src/lib/acephale/model";

const request: ModelRequest = { id: "retry-fixture", model: "gpt-5.4-2026-03-05", input: [], instructions: "policy",
  maxOutputTokens: 4096, reasoning: "medium", allocation: "development", maximumAttemptMicrodollars: 100,
  retries: 1, retryableCauseCodes: ["UND_ERR_SOCKET"] };
const response = { model: request.model, status: "completed", output_text: "Done", usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 }, output: [] };
const socketFailure = () => new OpenAI.APIConnectionError({ cause: new TypeError("Synthetic fetch failure", {
  cause: Object.assign(new Error("Synthetic socket closure"), { code: "UND_ERR_SOCKET" }),
}) });

test("socket retry reserves both attempts first, preserves ambiguity and repeats identical model input", async () => {
  const ledger = new BudgetLedger(), events: Record<string, unknown>[] = [], sent: unknown[] = [];
  let preflights = 0;
  const model = new ResponsesModelPort(async params => {
    assert.equal(ledger.snapshot()[0]!.maximum, 200);
    sent.push(params);
    if (sent.length === 1) throw socketFailure();
    return response as never;
  }, ledger, () => 25, event => events.push(event), () => { preflights++; });
  assert.equal((await model.complete(request)).text, "Done");
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
  assert.equal(preflights, 2);
  assert.equal(ledger.snapshot()[0]!.actual, undefined);
  const decision = events.find(event => event.type === "model_retry_decision")!;
  assert.equal(decision.retry, true); assert.equal(decision.delayMs, 100);
  assert.equal(decision.causeCode, "UND_ERR_SOCKET");
  assert.deepEqual(events.filter(event => event.type === "model_attempt" || event.type === "model_attempt_failed").map(event => event.attempt), [0, 1]);
});

test("host degradation after an ambiguous failure prevents retry dispatch without releasing its reservation", async () => {
  const ledger = new BudgetLedger(), events: Record<string, unknown>[] = [];
  let calls = 0, preflights = 0;
  const model = new ResponsesModelPort(async () => { calls++; throw socketFailure(); }, ledger, () => 0, event => events.push(event), () => {
    if (++preflights > 1) throw new Error("Synthetic stale heartbeat");
  });
  await assert.rejects(model.complete(request), /stale heartbeat/);
  assert.equal(calls, 1); assert.equal(preflights, 2);
  assert.equal(ledger.snapshot()[0]!.maximum, 200); assert.equal(ledger.snapshot()[0]!.actual, undefined);
  assert.equal(events.filter(event => event.type === "model_attempt_failed").length, 1);
  assert.equal(events.filter(event => event.type === "model_retry_blocked").length, 1);
});

test("filtered policy never retries HTTP errors, unrelated connection causes or an empty allowlist", async () => {
  for (const [failure, codes] of [
    [Object.assign(socketFailure(), { status: 400 }), ["UND_ERR_SOCKET"]],
    [Object.assign(socketFailure(), { status: 429 }), ["UND_ERR_SOCKET"]],
    [Object.assign(socketFailure(), { status: 503 }), ["UND_ERR_SOCKET"]],
    [new OpenAI.APIConnectionError({ cause: Object.assign(new Error("Synthetic DNS failure"), { code: "EAI_AGAIN" }) }), ["UND_ERR_SOCKET"]],
    [socketFailure(), []],
  ] as const) {
    const ledger = new BudgetLedger(); let calls = 0;
    const model = new ResponsesModelPort(async () => { calls++; throw failure; }, ledger, () => 0, () => {});
    await assert.rejects(model.complete({ ...request, retryableCauseCodes: codes }), error => error === failure);
    assert.equal(calls, 1); assert.equal(ledger.snapshot()[0]!.actual, undefined);
  }
});

test("returned malformed, incomplete, mismatched and refused responses are never retried", async () => {
  const cases = [
    { ...response, output: [{ type: "function_call", call_id: "call", name: "lookup", arguments: "{" }] },
    { ...response, status: "incomplete" }, { ...response, model: "other-model" },
    { ...response, output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "Cannot help" }] }] },
  ];
  for (const [index, value] of cases.entries()) {
    const ledger = new BudgetLedger(); let calls = 0;
    const model = new ResponsesModelPort(async () => { calls++; return value as never; }, ledger, () => 25, () => {});
    if (index === 3) assert.deepEqual((await model.complete(request)).refusals, ["Cannot help"]);
    else await assert.rejects(model.complete(request));
    assert.equal(calls, 1); assert.equal(ledger.snapshot()[0]!.actual, 25);
  }
});

test("filtered socket retries stop at their declared attempt budget", async () => {
  const ledger = new BudgetLedger(), events: Record<string, unknown>[] = [];
  let calls = 0;
  const model = new ResponsesModelPort(async () => { calls++; throw socketFailure(); }, ledger, () => 0, event => events.push(event));
  await assert.rejects(model.complete(request), OpenAI.APIConnectionError);
  assert.equal(calls, 2); assert.equal(ledger.snapshot()[0]!.maximum, 200);
  assert.equal(ledger.snapshot()[0]!.actual, undefined);
  assert.equal(events.at(-1)!.reason, "attempt_budget_exhausted");
  assert.equal(events.at(-1)!.retry, false);
});

test("invalid policy and insufficient total attempt allowance prevent first transport call", async () => {
  for (const altered of [
    { ...request, retryableCauseCodes: ["unsafe cause text"] },
    { ...request, maximumAttemptMicrodollars: 40_000_000 },
  ]) {
    let calls = 0;
    const model = new ResponsesModelPort(async () => { calls++; return response as never; }, new BudgetLedger(), () => 0, () => {});
    await assert.rejects(model.complete(altered));
    assert.equal(calls, 0);
  }
});

test("omitting the cause allowlist preserves the legacy transport retry behavior", async () => {
  const ledger = new BudgetLedger(); let calls = 0;
  const model = new ResponsesModelPort(async () => {
    if (++calls === 1) throw new Error("Legacy transport exception");
    return response as never;
  }, ledger, () => 25, () => {});
  await model.complete({ ...request, retryableCauseCodes: undefined });
  assert.equal(calls, 2); assert.equal(ledger.snapshot()[0]!.actual, undefined);
});
