import assert from "node:assert/strict";
import { test } from "node:test";
import OpenAI from "openai";
import { researchClient } from "../services/goalspec-runtime/provider";

test("research responses and embeddings request connection closure with unchanged endpoint and retry policy", async () => {
  const seen: { path: string; connection: string | null; body: Record<string, unknown> }[] = [];
  const client = researchClient("synthetic-offline-fixture", async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.openai.com");
    seen.push({ path: url.pathname, connection: new Headers(init?.headers).get("connection"),
      body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(url.pathname.endsWith("embeddings")
      ? { object: "list", model: "text-embedding-3-small", data: [], usage: { total_tokens: 0, prompt_tokens: 0 } }
      : { id: "resp_fixture", object: "response", status: "completed", model: "gpt-5.4-2026-03-05", output: [] }),
    { headers: { "content-type": "application/json" } });
  });
  assert.equal(client.maxRetries, 0);
  assert.equal(client.timeout, 120_000);
  await client.responses.create({ model: "gpt-5.4-2026-03-05", input: "fixture", reasoning: { effort: "medium" }, max_output_tokens: 4096, store: false });
  await client.embeddings.create({ model: "text-embedding-3-small", input: "fixture", dimensions: 1536, encoding_format: "float" });
  assert.deepEqual(seen.map(item => [item.path, item.connection]), [["/v1/responses", "close"], ["/v1/embeddings", "close"]]);
  assert.equal(seen[0]!.body.model, "gpt-5.4-2026-03-05");
  assert.deepEqual(seen[0]!.body.reasoning, { effort: "medium" });
  assert.equal(seen[0]!.body.max_output_tokens, 4096);
  assert.equal(seen[0]!.body.store, false);
  assert.equal(seen[1]!.body.dimensions, 1536);
});

test("research transport never retries an ambiguous socket failure", async () => {
  let attempts = 0;
  const client = researchClient("synthetic-offline-fixture", async () => {
    attempts++;
    throw new TypeError("Synthetic fetch failure", { cause: Object.assign(new Error("Synthetic socket closure"), { code: "UND_ERR_SOCKET" }) });
  });
  await assert.rejects(client.responses.create({ model: "gpt-5.4-2026-03-05", input: "fixture" }), OpenAI.APIConnectionError);
  assert.equal(attempts, 1);
});
