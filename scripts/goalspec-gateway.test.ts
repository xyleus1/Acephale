import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { NativeGateway, NativeReadExecutor } from "../services/goalspec-runtime/gateway-client";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";
import { hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame, Invocation, Json, Scope } from "../src/lib/goalspec/contracts/generated";

test("remote cancellation holds the caller until physical completion is confirmed", async () => {
  const gateway = new NativeGateway("http://127.0.0.1:1", "x".repeat(32));
  const abort = new AbortController();
  let finished = false;
  let operationId: unknown;
  let polls = 0;
  gateway.request = async <T>(path: string, payload: unknown): Promise<T> => {
    const body = payload as Record<string, unknown>;
    if (path === "/read") { operationId = body.operationId; abort.abort(); throw new Error("disconnected"); }
    assert.equal(body.operationId, operationId);
    assert.equal(body.cancel, true);
    assert.equal(finished, false);
    if (++polls === 1) throw new Error("temporary network loss");
    return { state: polls < 3 ? "running" : "cancelled" } as T;
  };
  const read = gateway.read({ runId: "r", tool: "read", arguments: {} }, abort.signal).finally(() => { finished = true; });
  await assert.rejects(read, /disconnected/);
  assert.equal(polls, 3);
  assert.equal(finished, true);
});

test("native completion unwraps the observation and pre-aborted reads never dispatch", async () => {
  const gateway = new NativeGateway("http://127.0.0.1:1", "x".repeat(32));
  let calls = 0;
  gateway.request = async <T>(): Promise<T> => { calls++; return { state: "completed", result: { lease: "lease", observation: { data: 1 } } } as T; };
  const payload = { runId: "r", tool: "read", arguments: {} };
  assert.deepEqual(await gateway.read(payload, new AbortController().signal), { lease: "lease", observation: { data: 1 } });
  await assert.rejects(gateway.read(payload, AbortSignal.abort()));
  assert.equal(calls, 1);
});

const nativeScope: Scope = { tenantId: "custom-tau-retail", principalId: "native-actor", authorizationVersion: "native-v1",
  environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash([]) };
const fixtures = JSON.parse(readFileSync(new URL("./goalspec-native-observations.json", import.meta.url), "utf8")) as {
  cases: { tool: string; arguments: Record<string, Json>; wireObservation: Json; decodedObservation: Json }[] };
function nativeFrame(): ExecutionFrame {
  return { schemaVersion: 1, runId: "wire-test", scope: nativeScope, snapshotId: "frozen", boundary: 0,
    policy: "retail native policy", requestedObjective: "Help with my orders", goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) },
    sources: { "requirement:1": "My email is mia.garcia2723@example.com.", _binding_events: [], _signatures: [] } };
}

test("captured native ToolMessages establish verified identity, profile and owned orders through the real policy", async () => {
  const gateway = new NativeGateway("http://127.0.0.1:1", "x".repeat(32));
  let active = fixtures.cases[0];
  gateway.read = async <T>() => ({ lease: "original-lease", observation: active.wireObservation }) as T;
  gateway.request = async <T>() => ({ lease: "refreshed-lease", observation: active.wireObservation }) as T;
  const executor = new NativeReadExecutor(gateway, "wire-test", nativeScope, new Set(fixtures.cases.map(x => x.tool)), new NativeReadPolicy("retail", nativeScope));
  executor.updateFrame(nativeFrame());
  for (const example of fixtures.cases) {
    active = example;
    const invocation: Invocation = { tool: example.tool, arguments: example.arguments, scope: nativeScope };
    assert.equal(executor.eligible(invocation), true, example.tool);
    const read = await executor.read(invocation, new AbortController().signal);
    assert.deepEqual(read, example.decodedObservation);
    assert.deepEqual(await executor.validate(invocation, read, new AbortController().signal), example.decodedObservation);
    assert.equal(executor.takeLease(invocation), "refreshed-lease", "Original Python lease identity survives decoding");
  }
});

test("unsuccessful or malformed native envelopes grant no lease or dependent access", async () => {
  for (const malformed of [{ content: "user_a", error: true }, { content: "user_a" }, { content: 123, error: false }, null, "user_a"]) {
    const gateway = new NativeGateway("http://127.0.0.1:1", "x".repeat(32));
    gateway.read = async <T>() => ({ lease: "bad-lease", observation: malformed }) as T;
    const executor = new NativeReadExecutor(gateway, "wire-test", nativeScope, new Set(["find_user_id_by_email", "get_user_details"]), new NativeReadPolicy("retail", nativeScope));
    executor.updateFrame(nativeFrame());
    const invocation: Invocation = { tool: fixtures.cases[0].tool, arguments: fixtures.cases[0].arguments, scope: nativeScope };
    await assert.rejects(executor.read(invocation, new AbortController().signal), /Invalid or unsuccessful/);
    assert.equal(executor.takeLease(invocation), undefined);
    assert.equal(executor.eligible({ ...invocation, tool: "get_user_details", arguments: { user_id: "user_a" } }), false);
  }
});

test("a failed refresh removes the existing lease, and legacy executors retain wire observations", async () => {
  const gateway = new NativeGateway("http://127.0.0.1:1", "x".repeat(32));
  const example = fixtures.cases[0], invocation: Invocation = { tool: example.tool, arguments: example.arguments, scope: nativeScope };
  gateway.read = async <T>() => ({ lease: "lease", observation: example.wireObservation }) as T;
  gateway.request = async <T>() => ({ lease: "bad-lease", observation: { content: "failure", error: true } }) as T;
  const executor = new NativeReadExecutor(gateway, "wire-test", nativeScope, new Set([example.tool]), new NativeReadPolicy("retail", nativeScope));
  executor.updateFrame(nativeFrame());
  const read = await executor.read(invocation, new AbortController().signal);
  await assert.rejects(executor.validate(invocation, read, new AbortController().signal), /Invalid or unsuccessful/);
  assert.equal(executor.takeLease(invocation), undefined);
  const legacy = new NativeReadExecutor(gateway, "legacy", nativeScope, new Set([example.tool]));
  assert.deepEqual(await legacy.read(invocation, new AbortController().signal), example.wireObservation);
});
