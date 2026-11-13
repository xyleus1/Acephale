import assert from "node:assert/strict";
import { test } from "node:test";
import { BudgetLedger, type Reservation } from "../src/lib/acephale/budget";
import { hash } from "../src/lib/acephale/canonical";
import { attachInfraHostedWorkers } from "../services/acephale-runtime/infra-hosted-workers";
import { claimNativeCohortSegment, reserveNativeCohort, validateNativeCohortPlan,
  validateNativeCohortSegment, type NativeCohortPlan } from "../services/acephale-runtime/infra-cohort-reservations";

const path = "original-budget.jsonl";
function plan(): NativeCohortPlan {
  const runs = [17, 29].flatMap(seed => ["base", "neutral_memory_prefetch", "acephale"].map((arm, index) => ({
    runId: `trial-${seed}-${index}`, taskId: `task-${seed}`, familyId: "family", domain: "retail", arm,
    seed, maxBoundaries: 40, tools: [{ type: "function", function: { name: "read" } }],
  })));
  return { version: 1, stage: "development", scopeHash: hash("scope"), originalScheduleHash: hash(runs), originalRuns: runs, runs,
    segments: [runs.slice(0, 3).map(run => run.runId), runs.slice(3).map(run => run.runId)],
    hosted: { allocation: "development", maxCostMicrodollarsPerRun: 1_250_000, maxSteps: 40, maxErrors: 5,
      timeoutSeconds: 600, evaluationType: "ALL_WITH_NL_ASSERTIONS" } };
}

test("cohort reserves all paired slots once, then claims segments without charging twice", () => {
  const writes: [string, Reservation][][] = [], ledger = new BudgetLedger(rows => writes.push(rows));
  ledger.reserve("prior-unknown", "preparation", 100);
  const declared = plan(), receipt = reserveNativeCohort(declared, ledger, path);
  assert.equal(writes.length, 2); assert.equal(ledger.snapshot().length, 8);
  assert.equal(ledger.remaining("development"), 40_000_000 - 6 * 1_250_000);
  claimNativeCohortSegment(receipt, declared.segments[0], ledger, path);
  assert.equal(writes.length, 3); assert.equal(ledger.remaining("development"), 40_000_000 - 6 * 1_250_000);
  claimNativeCohortSegment(receipt, declared.segments[1], ledger, path);
  assert.equal(writes.length, 4);
  assert.equal(ledger.snapshot().find(row => row.id === "prior-unknown")?.actual, undefined);
  assert.throws(() => claimNativeCohortSegment(receipt, declared.segments[0], ledger, path), /already claimed/);
  assert.throws(() => reserveNativeCohort(declared, ledger, path), /reservation/);
});

test("cohort rejects duplicate slots, partial blocks and changed segment runs before any write", () => {
  const declared = plan();
  assert.throws(() => validateNativeCohortPlan({ ...declared, segments: [[declared.runs[0].runId], declared.runs.slice(1).map(run => run.runId)] }), /split a paired/);
  assert.throws(() => validateNativeCohortPlan({ ...declared, runs: [...declared.runs, declared.runs[0]] }), /original cohort slots/);
  const partial = declared.runs.slice(1);
  assert.throws(() => validateNativeCohortPlan({ ...declared, runs: partial, originalRuns: partial, originalScheduleHash: hash(partial) }), /complete three-arm/);
  const receipt = reserveNativeCohort(declared, new BudgetLedger(), path);
  const input = { stage: declared.stage, scopeHash: declared.scopeHash, hosted: declared.hosted, runs: declared.runs.slice(0, 3) };
  assert.equal(validateNativeCohortSegment(receipt, input), 0);
  assert.throws(() => validateNativeCohortSegment(receipt, { ...input, runs: [...input.runs].reverse() }), /differs/);
  assert.throws(() => validateNativeCohortSegment(receipt, { ...input, runs: input.runs.map(run => ({ ...run, seed: 31 })) }), /differs/);
  assert.throws(() => validateNativeCohortSegment(receipt, { ...input, scopeHash: hash("changed-actor") }), /differs/);
});

test("whole-block regrouping preserves original randomized arm order and contiguity", () => {
  const declared = plan();
  const reversed = [...declared.runs.slice(3), ...declared.runs.slice(0, 3)];
  assert.doesNotThrow(() => validateNativeCohortPlan({ ...declared, runs: reversed, segments: [...declared.segments].reverse() }));
  const arms = [...declared.runs]; [arms[0], arms[1]] = [arms[1], arms[0]];
  assert.throws(() => validateNativeCohortPlan({ ...declared, runs: arms }), /arm order/);
  const interleaved = [declared.runs[0], declared.runs[3], ...declared.runs.slice(1, 3), ...declared.runs.slice(4)];
  assert.throws(() => validateNativeCohortPlan({ ...declared, runs: interleaved }), /contiguous/);
});

test("missing future reservation and consumed trial fail before atomic claims", () => {
  const declared = plan(), ledger = new BudgetLedger(), receipt = reserveNativeCohort(declared, ledger, path);
  assert.throws(() => claimNativeCohortSegment(receipt, declared.segments[1], ledger, path), /Earlier/);
  assert.throws(() => claimNativeCohortSegment(receipt, declared.segments[0], ledger, "another"), /identity/);
  ledger.reserveChild(`infra:${declared.runs[0].runId}`, "unknown-api", 50);
  assert.throws(() => claimNativeCohortSegment(receipt, declared.segments[0], ledger, path), /consumed/);
  assert.equal(ledger.snapshot().filter(row => row.id.startsWith("infra-claim:")).length, 0);
  const missing = new BudgetLedger(undefined, ledger.snapshot().filter(row => row.id !== `infra:${declared.runs[5].runId}`)
    .map(({ id, ...row }) => [id, row]));
  assert.throws(() => claimNativeCohortSegment(receipt, declared.segments[0], missing, path), /missing or changed/);
});

test("failed persistence leaves claims absent and existing holds untouched", () => {
  let fail = false;
  const ledger = new BudgetLedger(() => { if (fail) throw new Error("disk failure"); });
  const declared = plan(), receipt = reserveNativeCohort(declared, ledger, path), before = ledger.snapshot();
  fail = true;
  assert.throws(() => claimNativeCohortSegment(receipt, declared.segments[0], ledger, path), /disk failure/);
  assert.deepEqual(ledger.snapshot(), before);
});

test("hosted workers consume reserved parents, retain unknown charges and fence retries", async () => {
  const declared = plan(), ledger = new BudgetLedger(), receipt = reserveNativeCohort(declared, ledger, path);
  const actors = declared.runs.slice(0, 3).map(run => ({ runId: run.runId, worker: { async decision() {}, async close() {} } }));
  let constructed = 0;
  const factory: Parameters<typeof attachInfraHostedWorkers>[4] = (trial, allocation) => {
    constructed++;
    return { model: { async complete(request) { trial.reserve(request.id, allocation, 100); throw new Error("unknown charge"); } }, embed: async () => [] };
  };
  const workers = attachInfraHostedWorkers(actors, declared.hosted, ledger, () => {}, factory, { receipt, ledgerPath: path });
  assert.equal(constructed, 3);
  await assert.rejects(workers[1].worker.decision({ policy: "policy", tools: [], messages: [] }, "request"), /unknown charge/);
  for (const worker of workers) await worker.worker.close();
  assert.equal(ledger.snapshot().find(row => row.id === `infra:${actors[0].runId}`)?.actual, undefined);
  assert.equal(ledger.snapshot().find(row => row.id === `infra:${declared.runs[5].runId}`)?.actual, undefined);
  assert.throws(() => attachInfraHostedWorkers(actors, declared.hosted, ledger, () => {}, factory, { receipt, ledgerPath: path }), /already claimed/);
  assert.equal(constructed, 3);
});
