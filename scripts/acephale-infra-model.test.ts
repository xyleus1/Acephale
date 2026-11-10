import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { LocalChatModelPort, type InfraChatMessage, type InfraModelEvent, type InfraFunctionTool } from "../src/lib/acephale/infra-model";
import { freezeInfraManifest, INFRA_MODEL_PINS, validateInfraManifest, type InfraExperimentManifestV2 } from "../src/lib/acephale/infra-manifest";
import { localActorDecision, localActorMessages } from "../services/acephale-runtime/local-actor";

const tool: InfraFunctionTool = { type: "function", function: { name: "get_document", parameters: {
  type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false,
} } };
const messages: InfraChatMessage[] = [{ role: "system", content: "Use the tools." }, { role: "user", content: "Read the visible document." }];
const request = { id: "req-1", messages, tools: [tool], maxOutputTokens: 4096 };
const modelName = "Qwen/Qwen3.5-9B";
const call = { id: "actual-call-1", type: "function" as const, function: { name: "get_document", arguments: '{"id":"visible"}' } };
const tokenResponse = (count = 8) => Response.json({ count, max_model_len: 32768, tokens: Array(count).fill(1) });
const completion = (overrides: Record<string, unknown> = {}) => ({ model: modelName,
  choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [call] }, finish_reason: "tool_calls" }],
  usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 }, ...overrides });
function mockPort(value: unknown = completion(), options: { stream?: boolean; record?: (event: InfraModelEvent) => void } = {}) {
  const bodies: { path: string; body: Record<string, unknown> }[] = [];
  const port = new LocalChatModelPort({ baseUrl: "http://localhost:8000/v1", model: modelName, stream: options.stream ?? false,
    record: options.record, fetch: (async (input, init) => {
      const path = new URL(String(input)).pathname;
      bodies.push({ path, body: JSON.parse(String(init?.body)) });
      return path === "/tokenize" ? tokenResponse() : value instanceof Response ? value : Response.json(value);
    }) as typeof fetch });
  return { port, bodies };
}
function event(value: unknown) { return `data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`; }
function streamed(chunks: string[]) {
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}
function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return { model: modelName, choices: [{ index: 0, delta, finish_reason: finish }] };
}

test("local model uses exact model/template/tool tokenizer and preserves real calls", async () => {
  const { port, bodies } = mockPort();
  const result = await port.complete(request);
  assert.deepEqual(result.calls, [{ id: call.id, name: "get_document", arguments: { id: "visible" } }]);
  assert.deepEqual(result.continuation.tool_calls, [call]);
  assert.deepEqual(bodies.map(item => item.path), ["/tokenize", "/v1/chat/completions"]);
  assert.deepEqual(bodies[0].body.messages, messages);
  assert.deepEqual(bodies[0].body.tools, [tool]);
  assert.deepEqual(bodies[0].body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(bodies[1].body.model, modelName);
  assert.equal(bodies[1].body.max_tokens, 4096);
  assert.equal(bodies[1].body.temperature, 0);
  assert.equal(result.inputTokens, 8);
  assert.equal(result.timing.firstTokenMs, null);
  assert.equal(result.compiler.tokenizerCalls, 1);
});

test("candidate window measurement uses the real tokenizer without generating", async () => {
  const { port, bodies } = mockPort();
  assert.equal(await port.measureInputTokens(messages, undefined, [tool]), 8);
  assert.deepEqual(bodies.map(row => row.path), ["/tokenize"]);
  assert.deepEqual(bodies[0].body.tools, [tool]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(port.measureInputTokens(messages, controller.signal));
  assert.equal(bodies.length, 1);
});

test("SDK retryable HTTP failures make exactly one physical generation attempt", async () => {
  for (const status of [429, 500, 503]) {
    const { port, bodies } = mockPort(new Response("provider-private-error", { status }));
    await assert.rejects(port.complete(request), new RegExp(`HTTP ${status}`));
    assert.equal(bodies.filter(row => row.path === "/v1/chat/completions").length, 1);
  }
});

test("SSE reconstructs fragmented arguments and records first visible token", async () => {
  const events: InfraModelEvent[] = [];
  const raw = event(chunk({ role: "assistant" }))
    + event(chunk({ tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: "get_document", arguments: '{"id":' } }] }))
    + event(chunk({ tool_calls: [{ index: 0, function: { arguments: '"caf\u00e9"}' } }] }))
    + event(chunk({}, "tool_calls"))
    + event({ model: modelName, choices: [], usage: { prompt_tokens: 8, completion_tokens: 12, total_tokens: 20 } }) + event("[DONE]");
  const { port } = mockPort(streamed([raw.slice(0, 11), raw.slice(11, 91), raw.slice(91)]), { stream: true, record: e => events.push(e) });
  const result = await port.complete(request);
  assert.equal(result.calls[0].arguments.id, "caf\u00e9");
  assert.ok(result.timing.firstTokenMs !== null);
  assert.equal(events.filter(e => e.type === "model_first_token").length, 1);
  assert.ok(events.every(e => typeof e.monotonicNs === "string" && !!e.clockId));
});

test("stream parser handles byte boundaries inside UTF-8 and CRLF", async () => {
  const raw = event(chunk({ content: "caf\u00e9" })) + event(chunk({}, "stop")) + event("[DONE]");
  const bytes = new TextEncoder().encode(raw.replace(/\n/g, "\r\n"));
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
  const { port } = mockPort(response, { stream: true });
  assert.equal((await port.complete(request)).text, "caf\u00e9");
});

test("wrong model, malformed arguments, unknown tool, duplicate IDs, and incomplete responses fail closed", async () => {
  const variants = [
    completion({ model: "different" }),
    ...["{", "[]", "null", "1", '{"id":7}', '{"id":"ok","extra":true}'].map(arguments_ => completion({ choices: [{ index: 0,
      message: { role: "assistant", content: null, tool_calls: [{ ...call, function: { ...call.function, arguments: arguments_ } }] }, finish_reason: "tool_calls" }] })),
    completion({ choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [call, call] }, finish_reason: "tool_calls" }] }),
    completion({ choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ ...call, function: { ...call.function, name: "purchase" } }] }, finish_reason: "tool_calls" }] }),
    completion({ choices: [{ index: 0, message: { role: "assistant", content: "partial" }, finish_reason: "length" }] }),
  ];
  for (const variant of variants) await assert.rejects(mockPort(variant).port.complete(request));
});

test("missing SSE terminal marker and changed tool IDs never produce calls", async () => {
  for (const raw of [event(chunk({ content: "unfinished" })),
    event(chunk({ tool_calls: [{ index: 0, id: "one", function: { name: "get_document", arguments: "{}" } }] }))
      + event(chunk({ tool_calls: [{ index: 0, id: "two" }] })) + event(chunk({}, "tool_calls")) + event("[DONE]")]) {
    await assert.rejects(mockPort(streamed([raw]), { stream: true }).port.complete(request));
  }
});

test("stream=false must be explicit and no transport retry or model substitution occurs", async () => {
  const { port, bodies } = mockPort(completion(), { stream: true });
  await assert.rejects(port.complete(request), /SSE/);
  assert.equal(bodies.filter(item => item.path === "/v1/chat/completions").length, 1);
});

test("structured output schema and refusals are recorded without dispatchable calls", async () => {
  const format = { name: "goal", strict: true as const, schema: { type: "object", properties: { unknown: { type: "boolean" } }, required: ["unknown"], additionalProperties: false } };
  for (const [text, accepted] of [['{"unknown":true}', true], ['{"wrong":true}', false], ["broken", false]] as const) {
    const { port, bodies } = mockPort(completion({ choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
    const pending = port.complete({ ...request, responseFormat: format });
    if (accepted) assert.deepEqual((await pending).calls, []); else await assert.rejects(pending, /schema|JSON/);
    assert.deepEqual(bodies[1].body.response_format, { type: "json_schema", json_schema: format });
  }
  const { port } = mockPort(completion({ choices: [{ index: 0, message: { role: "assistant", content: null, refusal: "Cannot comply" }, finish_reason: "stop" }] }));
  assert.deepEqual((await port.complete({ ...request, responseFormat: format })).refusals, ["Cannot comply"]);
});

test("fabricated, unresolved, and reused historical call IDs fail before generation", async () => {
  const histories: InfraChatMessage[][] = [
    [...messages, { role: "tool", tool_call_id: "invented", content: "prefetch" }],
    [...messages, { role: "assistant", content: null, tool_calls: [call] }],
    [...messages, { role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: call.id, content: "ok" },
      { role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: call.id, content: "again" }],
  ];
  for (const history of histories) {
    const { port, bodies } = mockPort();
    await assert.rejects(port.complete({ ...request, messages: history }));
    assert.equal(bodies.length, 0);
  }
  const { port } = mockPort();
  await assert.rejects(port.complete({ ...request, messages: [...messages, { role: "assistant", content: null, tool_calls: [call] },
    { role: "tool", tool_call_id: call.id, content: "ok" }] }), /historical call ID/);
});

test("token budget uses server tokenizer and never truncates mandatory messages", async () => {
  let generation = 0;
  const port = new LocalChatModelPort({ baseUrl: "http://localhost:8000", model: modelName, stream: false,
    fetch: (async input => { if (String(input).endsWith("/tokenize")) return tokenResponse(30000); generation++; return Response.json(completion()); }) as typeof fetch });
  await assert.rejects(port.complete(request), /Mandatory actor input/);
  assert.equal(generation, 0);
});

test("compiler removes complete optional history groups and preserves latest evidence", async () => {
  const history: InfraChatMessage[] = [...messages, { role: "assistant", content: "optional" },
    { role: "assistant", content: null, tool_calls: [{ ...call, id: "old-real" }] }, { role: "tool", tool_call_id: "old-real", content: "evidence" }];
  const bodies: Record<string, unknown>[] = [];
  const port = new LocalChatModelPort({ baseUrl: "http://localhost:8000", model: modelName, stream: false,
    fetch: (async (input, init) => {
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      return String(input).endsWith("/tokenize") ? tokenResponse(body.messages.length > 4 ? 30000 : 8) : Response.json(completion());
    }) as typeof fetch });
  const result = await port.complete({ ...request, messages: history, optionalGroups: [{ id: "old", messageIndexes: [2] }] });
  assert.deepEqual(result.compiler.omittedGroups, ["old"]);
  assert.equal(result.compiler.tokenizerCalls, 2);
  assert.deepEqual(result.compiler.selectedMessageIndexes, [0, 1, 3, 4]);
  for (const indexes of [[0], [1], [3], [3, 4]]) {
    await assert.rejects(port.complete({ ...request, messages: history, optionalGroups: [{ id: "invalid", messageIndexes: indexes }] }));
  }
});

test("invalid tokenizer metadata fails before model dispatch", async () => {
  for (const value of [{ count: 10, tokens: [1], max_model_len: 32768 }, { count: 1, tokens: [1], max_model_len: 8192 }]) {
    let calls = 0;
    const port = new LocalChatModelPort({ baseUrl: "http://localhost", model: modelName, fetch: (async () => { calls++; return Response.json(value); }) as typeof fetch });
    await assert.rejects(port.complete(request)); assert.equal(calls, 1);
  }
});

test("generation usage must agree with the model's own compiled tokenizer count", async () => {
  await assert.rejects(mockPort(completion({ usage: { prompt_tokens: 9, completion_tokens: 12, total_tokens: 21 } })).port.complete(request), /token usage differs/);
});

test("cancellation and deadlines terminate request ownership without claiming server cancellation", async () => {
  for (const cause of ["cancel", "timeout"] as const) {
    const controller = new AbortController(), events: InfraModelEvent[] = [];
    const port = new LocalChatModelPort({ baseUrl: "http://localhost", model: modelName, stream: false, timeoutMs: 20,
      record: e => events.push(e), fetch: (async (input, init) => {
        if (String(input).endsWith("/tokenize")) return tokenResponse();
        return await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          if (cause === "cancel") setTimeout(() => controller.abort(), 2);
        });
      }) as typeof fetch });
    // Hold one test timer because the port's watchdog intentionally does not keep a process alive.
    const keepAlive = setTimeout(() => {}, 100);
    try { await assert.rejects(port.complete({ ...request, signal: controller.signal }), cause === "cancel" ? /cancelled/ : /timeout/); }
    finally { clearTimeout(keepAlive); }
    assert.equal(events.at(-1)?.cancellationConfirmed, false);
    assert.equal(events.at(-1)?.dispatched, true);
  }
});

test("operational events exclude prompts, observations, function arguments and error bodies", async () => {
  const events: InfraModelEvent[] = [];
  const port = new LocalChatModelPort({ baseUrl: "http://localhost", model: modelName, record: e => events.push(e),
    fetch: (async input => String(input).endsWith("/tokenize") ? tokenResponse() : new Response("private-secret-payload", { status: 500 })) as typeof fetch });
  await assert.rejects(port.complete({ ...request, messages: [{ role: "user", content: "private-secret-payload" }] }), /HTTP 500/);
  assert.ok(!JSON.stringify(events).includes("private-secret-payload"));
});

test("native adapter preserves logical transcript and ignores historical derived Acephale context", async () => {
  const boundary = { policy: "policy", tools: [tool], messages: [
    { role: "user" as const, content: "user" },
    { role: "assistant" as const, content: null, tool_calls: [{ id: "history-call", name: "get_document", arguments: { id: "old" } }],
      raw_data: { acephaleActorContext: { version: 1 as const, boundary: 0, scopeHash: "a".repeat(64), snapshotId: "snapshot", text: "unrequested-evidence" } } },
    { role: "tool" as const, id: "history-call", content: "real evidence" },
  ] };
  const converted = localActorMessages(boundary);
  assert.ok(!JSON.stringify(converted).includes("unrequested-evidence"));
  assert.equal(converted.at(-1)?.role, "tool");
  const result = await localActorDecision(boundary, mockPort().port, { id: "native", maxOutputTokens: 4096 });
  assert.equal(result.tool_calls?.[0].id, call.id);
  assert.equal(result.raw_data.acephaleCompiler.actorContextMode, "none");
});

test("native actor preserves an actual assistant preamble alongside tool calls", async () => {
  const result = await localActorDecision({ policy: "policy", messages: [{ role: "user", content: "read it" }], tools: [tool] },
    mockPort(completion({ choices: [{ index: 0, message: { role: "assistant", content: "I will inspect that document.", tool_calls: [call] }, finish_reason: "tool_calls" }] })).port,
    { id: "preamble", maxOutputTokens: 4096 });
  assert.equal(result.content, "I will inspect that document.");
  assert.equal(result.tool_calls?.[0].id, call.id);
});

test("real loopback HTTP endpoint exercises tokenizer plus streaming model transport", async () => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url!); req.resume();
    req.on("end", () => {
      if (req.url === "/tokenize") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ count: 8, max_model_len: 32768, tokens: Array(8).fill(1) })); }
      else { res.setHeader("content-type", "text/event-stream"); res.write(event(chunk({ content: "actual transport" }))); res.end(event(chunk({}, "stop")) + event("[DONE]")); }
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const port = new LocalChatModelPort({ baseUrl: `http://127.0.0.1:${address.port}`, model: modelName });
    assert.equal((await port.complete(request)).text, "actual transport");
    assert.deepEqual(paths, ["/tokenize", "/v1/chat/completions"]);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

function manifest(): InfraExperimentManifestV2 {
  const sha = "a".repeat(64);
  const identity = { servedModel: "actor", weightsHash: sha, tokenizerHash: sha, chatTemplateHash: sha,
    precision: "bfloat16" as const, temperature: 0 as const, topP: 1 as const, thinking: false as const, weightsFrozen: true as const };
  return {
    version: 2, profile: "acephale-infra-v1", experimentId: "fixture-only", createdAt: "2026-11-05T00:00:00Z", sourceCommit: "b".repeat(40),
    actor: { ...identity, ...INFRA_MODEL_PINS.actor, contextWindow: 32768, inputBudget: 28672, outputCap: 4096 },
    predictor: { ...identity, ...INFRA_MODEL_PINS.predictor, servedModel: "predictor", contextWindow: 8192, inputBudget: 7168, outputCap: 1024 },
    runtime: { imageDigest: INFRA_MODEL_PINS.image, vllm: "0.32.0", torch: "2.13.0", cuda: "13.0.2", transformers: "5.16.1-fixture",
      node: "22.23.4", python: "3.12.16", dependencyLockHash: sha, packageInventoryHash: sha, toolParser: "qwen3_xml" },
    hardware: { provider: "fixture", instanceType: "fixture", imageId: "fixture", gpu: "fixture", gpuCount: 1, gpuMemoryBytes: 48 * 1024 ** 3,
      driver: "580-fixture", cpu: "fixture", ramBytes: 100 * 1024 ** 3 },
    data: { datasetHash: sha, splitHash: sha, memoryHash: sha, calibrationHash: sha, toolSchemaHash: sha, environmentRevision: "fixture",
      trainingFamilies: ["train"], developmentFamilies: ["dev"], heldoutFamilies: ["test"] },
    arms: ["demand-only", "goal-neutral", "goal-conditioned"], seeds: [0, 1],
    budgets: { totalCeilingMicrodollars: 500000000, trancheMicrodollars: 150000000, infrastructureMicrodollars: 35000000,
      protectedContingencyMicrodollars: 65000000, maximumGpuHours: 24, ledgerCheckpointHash: sha },
    protocol: { actorContext: "none", exposeEvidence: false, frozenMemory: true, sameCandidatePool: true, lookaheadHops: 1, rankedCandidates: 3,
      perRunConcurrency: 2, globalConcurrency: 4, startsPerRun: 12, deadlineMs: 5000, cachePolicy: "disabled", scheduleHash: sha },
  };
}

test("v2 manifest freezes exact pins and artifact lineage without changing v1", () => {
  const value = manifest(); validateInfraManifest(value);
  const frozen = freezeInfraManifest(value);
  assert.equal(frozen.contentHash.length, 64);
  assert.ok(Object.isFrozen(frozen.manifest.actor));
  value.actor.servedModel = "changed";
  assert.equal(frozen.manifest.actor.servedModel, "actor");
});

test("v2 manifest rejects substitutions, contamination, invalid budgets and behavioral arms", () => {
  for (const mutate of [
    (m: InfraExperimentManifestV2) => { m.actor.revision = "f".repeat(40); },
    (m: InfraExperimentManifestV2) => { m.data.heldoutFamilies = ["train"]; },
    (m: InfraExperimentManifestV2) => { m.actor.inputBudget = 32000; },
    (m: InfraExperimentManifestV2) => { m.budgets.trancheMicrodollars = 1; },
    (m: InfraExperimentManifestV2) => { (m.protocol as unknown as Record<string, unknown>).exposeEvidence = true; },
    (m: InfraExperimentManifestV2) => { m.arms = ["demand-only", "demand-only", "goal-conditioned"]; },
  ]) { const value = manifest(); mutate(value); assert.throws(() => validateInfraManifest(value)); }
});
