import assert from "node:assert/strict";
import { test } from "node:test";
import { ContractPredictors } from "../src/lib/goalspec/predictors";
import { predictCompactCandidates } from "../src/lib/goalspec/compact-candidates";
import Ajv2020 from "ajv/dist/2020";
import type { ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import type { ModelRequest } from "../src/lib/goalspec/model";
const frame: ExecutionFrame = { schemaVersion: 1, runId: "compact-candidate", boundary: 0,
  scope: { tenantId: "tenant", principalId: "actor", authorizationVersion: "1", toolSchemaHash: "schema", environmentVersion: "env" },
  snapshotId: "training", requestedObjective: "Find my order", policy: "Read-only",
  sources: { "requirement:0": "Find order ORD-19", "observation:1": { order_id: "ORD-19" }, server_policy: "Read-only" },
  goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: "none" } };
const tools = { get_order: { type: "object", properties: { order_id: { type: "string" }, verbose: { type: "boolean" } }, required: ["order_id"], additionalProperties: false } };
function predictor(reply: unknown, observe: (request: ModelRequest) => void = () => {}) {
  return new ContractPredictors({ complete: async request => { observe(request); return { model: request.model,
    continuation: [], calls: [], text: JSON.stringify(reply), status: "completed", refusals: [], usage: undefined }; } },
    async () => [], tools, "development", 100, () => {});
}
test("candidate model emits only current arguments; server supplies scope, IDs and references", async () => {
  const p = predictor({ candidates: [{ tool: "get_order", arguments: { order_id: "ORD-19", verbose: null }, sourceIds: ["s1"], confidence: 91 }] }, request => {
    assert.equal(request.responseFormat?.strict, true); assert.equal(request.maxOutputTokens, 1024);
    assert.ok(!JSON.stringify(request.input).includes("tenant"));
  });
  const values = await p.candidates(frame, []);
  assert.equal(values.length, 1); assert.deepEqual(values[0].invocation.arguments, { order_id: "ORD-19" });
  assert.deepEqual(values[0].invocation.scope, frame.scope); assert.equal(values[0].probability, 0.91);
  assert.deepEqual(values[0].bindings, [{ sourceId: "observation:1", path: [] }]);
  assert.equal(p.validateArguments(values[0], frame), true);
  assert.equal(p.validateArguments({ ...values[0], invocation: { ...values[0].invocation, arguments: { order_id: "HISTORICAL-99" } } }, frame), false);
});
test("invented source IDs and writes fail the compact contract", async () => {
  for (const entry of [
    { tool: "get_order", arguments: { order_id: "ORD-19", verbose: null }, sourceIds: ["s99"], confidence: 99 },
    { tool: "purchase", arguments: { order_id: "ORD-19", verbose: null }, sourceIds: ["s1"], confidence: 99 },
  ]) assert.deepEqual(await predictor({ candidates: [entry] }).candidates(frame, []), []);
});

async function compact(toolSchemas: Record<string, Record<string, unknown>>, reply: unknown, events: unknown[], observe: (request: ModelRequest) => void) {
  return predictCompactCandidates({ complete: async request => {
    observe(request);
    assert.equal(new Ajv2020({ strict: false }).compile(request.responseFormat!.schema)(reply), true);
    return { model: request.model, continuation: [], calls: [], text: JSON.stringify(reply), status: "completed", refusals: [], usage: undefined };
  } }, frame, [], { tools: toolSchemas, allocation: "development", maximumAttemptMicrodollars: 100,
    countTokens: text => Math.ceil(text.length / 4), record: event => events.push(event) });
}

test("nested optional properties restore inside objects and homogeneous arrays", async () => {
  const nested = { type: "object", properties: { order_id: { type: "string" }, verbose: { type: "boolean" },
    nullable: { type: ["string", "null"] } }, required: ["order_id"], additionalProperties: false };
  const parameters = { type: "object", properties: { filter: nested, rows: { type: "array", items: nested } },
    required: ["filter", "rows"], additionalProperties: false };
  const values = await compact({ get_nested: parameters }, { candidates: [{ tool: "get_nested",
    arguments: { filter: { order_id: "ORD-19", verbose: null, nullable: null }, rows: [{ order_id: "ORD-19", verbose: null, nullable: null }] },
    sourceIds: ["s1"], confidence: 91 }] }, [], () => {});
  assert.equal(values.length, 1);
  assert.deepEqual(values[0].invocation.arguments, { filter: { order_id: "ORD-19", nullable: null }, rows: [{ order_id: "ORD-19", nullable: null }] });
  assert.equal(new Ajv2020({ strict: false }).compile(parameters)(values[0].invocation.arguments), true);
});

test("branch and reference tools are excluded without poisoning eligible tools", async () => {
  const branch = { type: "object", properties: { filter: { anyOf: [
    { type: "object", properties: { verbose: { type: "boolean" } } }, { type: "null" }] } }, required: ["filter"] };
  const reference = { type: "object", properties: { filter: { $ref: "#/$defs/Filter" } },
    $defs: { Filter: { type: "object", properties: { verbose: { type: "boolean" } } } } };
  for (const unsupported of [branch, reference, { type: "object", properties: { filter: { $ref: "#/definitions/Filter" } } }]) {
    const events: unknown[] = [];
    let calls = 0;
    const values = await compact({ unsupported_read: unsupported, ...tools }, { candidates: [{ tool: "get_order",
      arguments: { order_id: "ORD-19", verbose: null }, sourceIds: ["s1"], confidence: 91 }] }, events, request => {
      calls++;
      assert.ok(!JSON.stringify(request.responseFormat).includes("unsupported_read"));
    });
    assert.equal(calls, 1);
    assert.equal(values.length, 1);
    assert.ok(events.some(event => (event as Record<string, unknown>).reason === "unsupported_schema"
      && (event as Record<string, unknown>).tool === "unsupported_read"));
    assert.deepEqual(await compact({ unsupported_read: unsupported }, { candidates: [] }, [], () => { throw new Error("No eligible tool may call the provider"); }), []);
  }
});
