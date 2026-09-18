import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { Response } from "openai/resources/responses/responses";
import { BudgetLedger, ALLOCATIONS } from "../src/lib/goalspec/budget";
import { copy, hash } from "../src/lib/goalspec/canonical";
import { RESEARCH_MODELS, ResponsesModelPort } from "../src/lib/goalspec/model";
import { maximumCost, PRICE_SOURCE, responseCost } from "../services/goalspec-runtime/provider";
import { REPLAY_VERSION, type ReplayCohort } from "./goalspec-prediction-v3";
import { EXTENDED_VERSION, MINI_MAXIMUM, TEACHER_MAXIMUM } from "./goalspec-prediction-v3-extended";
import { dispatchReplayPlan, replayRequestBound, reserveReplayCohort, SHARED_REPLAY_BUDGET,
  validateReplayPlan, type ReplayPlan } from "./goalspec-prediction-v3-run";

function plan(): ReplayPlan {
  const maximumAttemptMicrodollars = maximumCost(RESEARCH_MODELS.candidate, 8192, 1024);
  return { version: "goalspec-replay-plan-v1", replayVersion: REPLAY_VERSION, createdAtUtc: "2026-09-15T00:00:00Z",
    inputs: { runDirectory: "fixture", closedEventsPath: "fixture/events", memoryPath: "fixture/memory", recordsPath: "fixture/records" },
    outputDirectory: join(dirname(dirname(SHARED_REPLAY_BUDGET)), "new-replay-fixture"), budgetJournal: SHARED_REPLAY_BUDGET,
    manifestHash: hash("manifest"), memoryHash: hash("memory"), recordsHash: hash("records"), checkpointIds: ["checkpoint"],
    sourceFiles: [], codeSources: [], codeHash: hash([]), model: RESEARCH_MODELS.candidate, allocation: "replay",
    maxInputTokens: 8192, maxOutputTokens: 1024, retries: 0, maximumAttemptMicrodollars,
    maximumRequests: 9, maximumTotalMicrodollars: 7 * MINI_MAXIMUM + 2 * TEACHER_MAXIMUM,
    comparison: "seven_requested_plus_salesforce", miniRequests: 7, teacherRequests: 2, replayConcurrency: 4,
    teacher: RESEARCH_MODELS.teacher, teacherOutputCap: 4096, teacherMaximumAttemptMicrodollars: TEACHER_MAXIMUM,
    selection: { method: "all_checkpoints", seed: EXTENDED_VERSION, inputCheckpointIds: ["checkpoint"], selectedCheckpointIds: ["checkpoint"],
      omittedCheckpointIds: [], maximumMicrodollars: ALLOCATIONS.replay, contentHash: hash("selection") },
    allocationCeilingMicrodollars: ALLOCATIONS.replay, priceSource: PRICE_SOURCE };
}

test("replay plans reject model, cap, allocation, journal and total-ceiling changes", () => {
  assert.equal(validateReplayPlan(plan()).maximumRequests, 9);
  const invalid: Record<string, unknown>[] = [
    { model: "gpt-4.1-mini" }, { maxOutputTokens: 2048 }, { retries: 1 }, { allocation: "contingency" }, { replayConcurrency: 5 },
    { budgetJournal: join(tmpdir(), "new-empty-ledger.jsonl") }, { maximumAttemptMicrodollars: 1 },
    { maximumRequests: 100000, maximumTotalMicrodollars: 100000 * plan().maximumAttemptMicrodollars },
  ];
  for (const changed of invalid) assert.throws(() => validateReplayPlan({ ...plan(), ...changed }), /dispatch plan/);
});

test("whole-cohort reservation respects already-used replay headroom and does not borrow other allocations", () => {
  const ledger = new BudgetLedger();
  ledger.reserve("earlier-replay", "replay", ALLOCATIONS.replay - 1);
  const before = copy(ledger.snapshot());
  assert.throws(() => reserveReplayCohort(ledger, plan(), hash("new-plan")), /Budget exhausted/);
  assert.deepEqual(ledger.snapshot(), before);
  assert.ok(ledger.snapshot().every(entry => entry.allocation === "replay"));
});

test("each physical replay request uses existing TrialLedger accounting and exact billed usage", async () => {
  const ledger = new BudgetLedger(), configuration = plan(), reserved = reserveReplayCohort(ledger, configuration, hash("budgeted-plan"));
  let calls = 0;
  const model = new ResponsesModelPort(async () => {
    calls++;
    return { model: RESEARCH_MODELS.candidate, service_tier: "default", status: "completed", output: [],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 0 } } } as unknown as Response;
  }, reserved.ledger, responseCost, () => {});
  await model.complete({ id: "physical-request", model: RESEARCH_MODELS.candidate, input: [], instructions: "fixture",
    maxOutputTokens: 1024, allocation: "replay", maximumAttemptMicrodollars: configuration.maximumAttemptMicrodollars, retries: 0 });
  ledger.finishParent(reserved.parentId);
  const parent = ledger.snapshot().find(entry => entry.id === reserved.parentId)!;
  assert.equal(calls, 1); assert.equal(parent.actual, 69);
  assert.equal(ledger.snapshot().filter(entry => entry.parentId === reserved.parentId).length, 1);
  assert.throws(() => reserved.ledger.reserve("wrong-allocation", "heldout", 1), /allocation mismatch/);
});

test("uncertain provider failures retain the reserved replay allowance and never retry implicitly", async () => {
  const ledger = new BudgetLedger(), configuration = plan(), reserved = reserveReplayCohort(ledger, configuration, hash("uncertain-plan"));
  let calls = 0;
  const model = new ResponsesModelPort(async () => { calls++; throw new Error("fixture network failure"); }, reserved.ledger, () => 0, () => {});
  await assert.rejects(model.complete({ id: "unknown-request", model: RESEARCH_MODELS.candidate, input: [], instructions: "fixture",
    maxOutputTokens: 1024, allocation: "replay", maximumAttemptMicrodollars: configuration.maximumAttemptMicrodollars, retries: 0 }));
  ledger.finishParent(reserved.parentId);
  assert.equal(calls, 1); assert.equal(ledger.snapshot().find(entry => entry.id === reserved.parentId)!.actual, undefined);
  assert.equal(ledger.snapshot().find(entry => entry.parentId === reserved.parentId)!.maximum, configuration.maximumAttemptMicrodollars);
});

test("request bound includes every usable comparison and excludes unscorable checkpoints", () => {
  const checkpoints = [{ frame: {}, unavailableReason: null }, { frame: {}, unavailableReason: "missing_response" },
    { frame: null, unavailableReason: "no_checkpoint" }, { frame: {}, unavailableReason: null }] as ReplayCohort["checkpoints"];
  assert.equal(replayRequestBound({ checkpoints }), 8);
});

test("dispatch rejects changed plan bytes and changed source before opening any ledger or provider", async () => {
  const directory = mkdtempSync(join(tmpdir(), "replay-runner-test-")), path = join(directory, "plan.json");
  let factoryCalled = false;
  const factory = (() => { factoryCalled = true; throw new Error("Must not construct provider"); });
  try {
    writeFileSync(path, JSON.stringify(plan()));
    await assert.rejects(dispatchReplayPlan(path, "a".repeat(64), factory), /SHA256 changed/);
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    await assert.rejects(dispatchReplayPlan(path, digest, factory), /source changed/);
    assert.equal(factoryCalled, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
