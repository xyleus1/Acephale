import assert from "node:assert/strict";
import { test } from "node:test";
import Gpt56Client from "../src/lib/gpt56-client";

test("Derya current-only context preserves actual output and real call IDs while dropping old derived notes", async () => {
  const sent: { input: unknown[] }[] = [];
  const raw = [{ type: "reasoning", id: "reasoning-1", summary: [], encrypted_content: "opaque-fixture" },
    { type: "function_call", id: "fc-1", call_id: "real-call-1", name: "get_job", arguments: '{"job_id":"job-1"}' }];
  const client = new Gpt56Client({ apiKey: "synthetic-offline-fixture", fetch: async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "response-fixture", object: "response", model: "gpt-5.6", status: "completed", output: raw }),
      { headers: { "content-type": "application/json" } });
  } });
  const first = await client.messages.create({ max_tokens: 1024, messages: [{ role: "user", content: "Get job-1" }],
    runtimeObservation: { context: "OLD derived state", evidence: [] } });
  await client.messages.create({ max_tokens: 1024, runtimeContextMode: "current-only",
    messages: [{ role: "user", content: "Get job-1" }, { role: "assistant", content: first.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "real-call-1", content: '{"ok":true}' }] }],
    runtimeObservation: { context: "CURRENT source-linked state", evidence: [] } });
  assert.deepEqual(sent[1]!.input, [{ role: "user", content: "Get job-1" }, ...raw,
    { type: "function_call_output", call_id: "real-call-1", output: '{"ok":true}' },
    { role: "developer", content: "CURRENT source-linked state" }]);
});
