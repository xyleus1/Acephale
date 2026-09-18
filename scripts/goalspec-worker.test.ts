import assert from "node:assert/strict";
import { test } from "node:test";
import { NativeBoundaryWorker } from "../services/goalspec-runtime/worker";
import { hash } from "../src/lib/goalspec/canonical";
import type { ModelPort } from "../src/lib/goalspec/model";

const scope = { tenantId: "t", principalId: "p", authorizationVersion: "v", environmentVersion: "e", toolSchemaHash: hash([]) };
test("worker pins actor settings, scopes visible frames, and rejects schema drift before dispatch", async () => {
  let calls = 0;
  const model: ModelPort = { async complete(request) {
    calls++;
    assert.equal(request.model, "gpt-5.4-2026-03-05");
    assert.equal(request.reasoning, "medium");
    assert.equal(request.maxOutputTokens, 4096);
    assert.equal(request.retries, 0);
    return { model: request.model, text: "done", continuation: [], calls: [], status: "completed", refusals: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  } };
  const worker = new NativeBoundaryWorker({ runId: "r", scope, snapshotId: "s", allocation: "development", maximumAttemptMicrodollars: 1, maxBoundaries: 1 }, model, () => {});
  await assert.rejects(worker.decision({ policy: "p", messages: [], tools: [{ type: "function", function: { name: "changed", parameters: {} } }] }, "bad"), /schema changed/);
  assert.equal(calls, 0);
  const response = await worker.decision({ policy: "p", messages: [{ role: "user", content: "task" }], tools: [] }, "one");
  assert.equal(response.content, "done");
  assert.deepEqual(response._goalspecPromotions, {});
  await assert.rejects(worker.decision({ policy: "p", messages: [], tools: [] }, "two"), /budget exhausted/);
  await worker.close();
});
