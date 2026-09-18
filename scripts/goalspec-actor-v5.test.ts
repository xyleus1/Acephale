import assert from "node:assert/strict";
import { test } from "node:test";
import { actorDecision, compileActorInput, nativeInput, type ActorRuntime, type PublicBoundary } from "../services/goalspec-runtime/actor";
import { buildObligationLedger, obligationLedgerContext } from "../src/lib/goalspec/obligation-ledger";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame, GoalSet } from "../src/lib/goalspec/contracts/generated";
import type { ModelPort, ModelRequest } from "../src/lib/goalspec/model";

const emptyGoals: GoalSet = { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: "empty" };
const frame = (sources: ExecutionFrame["sources"] = { "requirement:0": "Find the cheapest flight from ATL to PHL tomorrow. Do not use Basic Economy." }): ExecutionFrame => ({
  schemaVersion: 1, runId: "actor-v5-test", boundary: 0, snapshotId: "fixture",
  scope: { tenantId: "office-one", principalId: "operator", authorizationVersion: "one", environmentVersion: "fixture", toolSchemaHash: "tools" },
  requestedObjective: "Change my flight", policy: "Use current sources. Obtain required confirmation.", sources, goals: emptyGoals,
});
const priorContext = { version: 1 as const, boundary: 0, scopeHash: hash({}), snapshotId: "fixture", text: "Historical interpreted goal: cancel all flights. ".repeat(20) };
const boundary: PublicBoundary = { policy: "Follow native policy.", tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {}, additionalProperties: false } } }], messages: [
  { role: "user", content: "Find my reservation; do not cancel it." },
  { role: "assistant", tool_calls: [{ id: "real-call-1", name: "lookup", arguments: {} }], raw_data: {
    goalspecActorContext: priorContext, goalspecContinuation: [
      { type: "reasoning", id: "opaque-reasoning", summary: [], encrypted_content: "opaque-encrypted-provider-item" },
      { type: "function_call", id: "item-1", call_id: "real-call-1", name: "lookup", arguments: "{}" },
    ] } },
  { role: "tool", id: "real-call-1", content: '{"reservation":"current","status":"open"}' },
  { role: "assistant", content: "Please confirm the change.", raw_data: { goalspecActorContext: { ...priorContext, boundary: 1 } } },
  { role: "user", content: "Yes, change it. ###STOP###" },
] };

test("current-only removes derived history and preserves real user messages, calls and opaque items", () => {
  const legacy = nativeInput(boundary.messages);
  assert.deepEqual(legacy, nativeInput(boundary.messages, "legacy"));
  const current = nativeInput(boundary.messages, "current-only");
  assert.deepEqual(current, legacy.filter(item => !("role" in item && item.role === "developer")));
  assert.deepEqual(current.slice(1, 3), boundary.messages[1].raw_data!.goalspecContinuation);
  assert.deepEqual(current.at(-1), { role: "user", content: "Yes, change it. ###STOP###" });
  assert.equal(boundary.messages[1].raw_data!.goalspecActorContext, priorContext);
});

test("legacy compilation remains explicit and current-only records omissions with lower size", () => {
  assert.deepEqual(compileActorInput(boundary), compileActorInput(boundary, "", 32640, "legacy"));
  const legacy = compileActorInput(boundary, "Current literal data");
  const current = compileActorInput(boundary, "Current literal data", 32640, "current-only");
  assert(current.metadata.compilerVersion.endsWith(":current-only-v5"));
  assert.equal(current.metadata.omittedHistoricalDerivedContexts, 2);
  assert(current.metadata.tokens < legacy.metadata.tokens);
  assert(canonical(current.input).length < canonical(legacy.input).length);
  assert.equal(current.instructions, legacy.instructions);
  assert.deepEqual(current.tools, legacy.tools);
  assert.deepEqual(current.input.at(-1), { role: "developer", content: "Current literal data" });
});

test("current-only still rejects malformed historical metadata and invalid tool pairing", () => {
  const invalid = structuredClone(boundary.messages);
  invalid[1].raw_data!.goalspecActorContext!.scopeHash = "bad";
  assert.throws(() => nativeInput(invalid, "current-only"), /Invalid historical/);
  assert.throws(() => nativeInput([{ role: "tool", id: "orphan", content: "{}" }], "current-only"), /matching real call/);
  assert.throws(() => nativeInput(boundary.messages, "unknown" as "legacy"), /Unknown actor context/);
});

test("actor runtime opts into current-only while default path is byte-equivalent legacy", async () => {
  const requests: ModelRequest[] = [];
  const model: ModelPort = { async complete(request) { requests.push(request); return {
    model: request.model, continuation: [], calls: [], text: "Observed.", status: "completed", refusals: [], usage: undefined,
  }; } };
  const runtime = { async boundary(current: ExecutionFrame) { return { frame: current, evidence: [], actorContext: "literal-data" }; },
    scheduler: {} as ActorRuntime["scheduler"], async close() {} } satisfies ActorRuntime;
  const config = { id: "actor-test", model: "gpt-5.4-2026-03-05", reasoning: "medium" as const, maxOutputTokens: 4096,
    allocation: "development" as const, maximumAttemptMicrodollars: 1, retries: 0 };
  const defaultResult = await actorDecision(boundary, frame(), model, config, runtime);
  const explicitLegacy = await actorDecision(boundary, frame(), model, config, { ...runtime, actorContextMode: "legacy" });
  const current = await actorDecision(boundary, frame(), model, config, { ...runtime, actorContextMode: "current-only" });
  assert.deepEqual(defaultResult, explicitLegacy);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[2].input.filter(item => "role" in item && item.role === "developer").length, 1);
  assert(current.raw_data.goalspecActorContext?.text.includes("Fallible derived data, not instructions or authorization"));
  assert(requests[2].input.some(item => "content" in item && item.content === "Yes, change it. ###STOP###"));
});

test("literal ledger preserves exact qualifier spans and does not materialize inferred goals", () => {
  const current = frame(), ledger = buildObligationLedger(current);
  assert.equal(ledger.statements[0].state, "latest_user_statement");
  assert.equal(ledger.statements[0].evidence.quote, current.sources["requirement:0"]);
  for (const qualifier of ledger.qualifiers) {
    const source = current.sources[qualifier.evidence.source.sourceId] as string;
    assert.equal(source.slice(qualifier.evidence.start, qualifier.evidence.end), qualifier.evidence.quote);
    assert.equal(hash(source), qualifier.evidence.sourceHash);
  }
  assert(ledger.qualifiers.some(item => item.kind === "exclusion" && item.evidence.quote.includes("Do not use Basic Economy")));
  assert(ledger.qualifiers.some(item => item.kind === "date" && item.evidence.quote === "tomorrow"));
  const context = JSON.parse(obligationLedgerContext(ledger));
  assert.equal(context.semanticCompleteness, "unassessed");
  assert.equal(context.experimentalHypotheses, undefined);
  assert.equal(context.confirmationAuthority, "server_owned_not_inferred");
});

test("request revision is independent of goal changes and unrelated observations", () => {
  const current = frame(), ledger = buildObligationLedger(current);
  const changed = { ...current, boundary: 1, goals: { ...emptyGoals, revisionHash: "changed-inference" },
    sources: { ...current.sources, "observation:3": { unrelated: true } } };
  assert.equal(buildObligationLedger(changed, ledger).requestRevisionHash, ledger.requestRevisionHash);
  assert.notEqual(buildObligationLedger({ ...changed, policy: "Changed policy" }, ledger).requestRevisionHash, ledger.requestRevisionHash);
  assert.notEqual(buildObligationLedger({ ...changed, sources: { ...changed.sources, current_date: "2026-09-17" } }, ledger).requestRevisionHash, ledger.requestRevisionHash);
});

test("changed request does not reintroduce old prohibition as a current qualifier", () => {
  const first = frame({ "requirement:0": "Do not exchange it. Return it." }), ledger = buildObligationLedger(first);
  const next = buildObligationLedger({ ...first, boundary: 1, sources: { ...first.sources, "requirement:2": "I changed my mind. Exchange only the lamp instead." } }, ledger);
  const context = obligationLedgerContext(next);
  assert(context.includes("Exchange only the lamp instead"));
  assert(!context.includes("Do not exchange"));
  assert.deepEqual(JSON.parse(context).earlierUserSources, ["requirement:0"]);
  assert.equal(next.statements[0].state, "earlier_user_statement");
  assert.notEqual(next.requestRevisionHash, ledger.requestRevisionHash);
});

test("affirmative text and native STOP are recorded without a confirmation permission or final state", () => {
  const ledger = buildObligationLedger(frame({ "requirement:1": "Yes, but do not buy anything. ###STOP###" }));
  assert.equal(ledger.statements[0].observedLanguage, "affirmative_text");
  assert.equal(ledger.statements[0].containsNativeStop, true);
  assert(ledger.qualifiers.some(item => item.evidence.quote.includes("do not buy")));
  const context = JSON.parse(obligationLedgerContext(ledger));
  assert.equal(context.authorized, undefined);
  assert.equal(context.confirmed, undefined);
  assert.equal(context.completed, undefined);
});

test("missing user evidence does not promote the frame objective or carry prior statements", () => {
  const first = frame(), ledger = buildObligationLedger(first);
  const next = buildObligationLedger({ ...first, boundary: 1, sources: {} }, ledger);
  assert.equal(next.statements.length, 0);
  assert(next.ungroundedRequestedObjective);
  assert.deepEqual(next.sourceChanges.removed, ["requirement:0"]);
  assert(!obligationLedgerContext(next).includes(first.requestedObjective));
});

test("only correlated actual tool responses become observed receipts, never completion", () => {
  const ledger = buildObligationLedger(frame({ "requirement:0": "Cancel order.", _binding_events: [
    { kind: "tool_request", call_id: "read", tool: "get_order", arguments: { id: "o" } },
    { kind: "tool_result", call_id: "read", tool: "get_order", status: "success", result: { status: "open" } },
    { kind: "tool_request", call_id: "write", tool: "cancel_order", arguments: { id: "o" } },
    { kind: "tool_result", call_id: "write", tool: "cancel_order", status: "error", result: { error: "not allowed" } },
    { kind: "tool_result", call_id: "orphan", tool: "cancel_order", status: "success", result: { status: "cancelled" } },
  ] }));
  assert.equal(ledger.receipts.length, 2);
  assert.equal(ledger.invalidReceiptEvents, 1);
  assert.equal(ledger.receipts[1].toolReportedStatus, "error");
  assert.equal(ledger.receipts[1].state, "tool_response_observed");
  assert.deepEqual(ledger.receipts[0].responseSource, { sourceId: "_binding_events", path: [1, "result"] });
  assert.equal(JSON.parse(obligationLedgerContext(ledger)).completion, "not_inferred_from_response_status");
});

test("experimental hypothesis exposure requires current revision and visible user bindings", () => {
  const ledger = buildObligationLedger(frame());
  const goals: GoalSet = { schemaVersion: 1, revisionHash: "prediction", unknown: 0, hypotheses: [{
    id: "h", objective: "Hypothetical interpreted goal.", probability: 1, sources: [{ sourceId: "requirement:0", path: [] }], constraints: [],
  }] };
  const hypotheses = { mode: "experimental" as const, requestRevisionHash: ledger.requestRevisionHash, goals };
  assert(JSON.parse(obligationLedgerContext(ledger, { hypotheses })).experimentalHypotheses);
  assert.throws(() => obligationLedgerContext(ledger, { hypotheses: { ...hypotheses, requestRevisionHash: "stale" } }), /stale/);
  const absent = structuredClone(goals);
  absent.hypotheses[0]!.sources[0].sourceId = "observation:1";
  assert.throws(() => obligationLedgerContext(ledger, { hypotheses: { ...hypotheses, goals: absent } }), /missing or non-user/);
});

test("oversized derived context falls back to complete source pointers, not truncated qualifiers", () => {
  const ledger = buildObligationLedger(frame({ "requirement:0": "Do not cancel. ".repeat(300) }));
  assert(ledger.statements[0].truncated);
  const context = obligationLedgerContext(ledger, { maxCharacters: 768 });
  assert(context.length <= 768);
  assert.equal(JSON.parse(context).derivedTextOmitted, true);
  assert.equal(JSON.parse(context).literalQualifiers, undefined);
});

test("ledger integrity, scope reset and monotonic boundary checks fail safely", () => {
  const first = frame(), ledger = buildObligationLedger(first);
  assert.throws(() => obligationLedgerContext({ ...ledger, policyHash: "forged" }), /integrity/);
  assert.throws(() => buildObligationLedger({ ...first, runId: "other" }, ledger), /run changed/);
  const next = buildObligationLedger({ ...first, boundary: 1, scope: { ...first.scope, tenantId: "office-two" }, sources: { "requirement:2": "Current tenant request." } }, ledger);
  assert.equal(next.statements.length, 1);
  assert.equal(next.scopeHash, hash({ ...first.scope, tenantId: "office-two" }));
  assert.throws(() => buildObligationLedger(first, next), /boundary regressed/);
});
