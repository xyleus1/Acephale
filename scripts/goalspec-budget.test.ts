import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { BudgetLedger } from "../src/lib/goalspec/budget";
import { TrialLedger, maximumCost, responseCost } from "../services/goalspec-runtime/provider";
import { canonical, hash } from "../src/lib/goalspec/canonical";

test("legacy journals recover into compact delta records without rewriting history", () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-legacy-budget-"));
  try {
    const path = join(directory, "budget.jsonl");
    const body = { sequence: 0, previous: "0".repeat(64), entries: [["legacy", { allocation: "replay", maximum: 100 }]] };
    const legacy = canonical({ body, hash: hash(body) }) + "\n";
    writeFileSync(path, legacy);
    const first = new DurableBudget(path);
    first.ledger.reserveMany(Array.from({ length: 100 }, (_, i) => ({ id: `trial-${i}`, allocation: "replay" as const, maximum: 100 })));
    first.ledger.settle("legacy", 3);
    first.close();
    const text = readFileSync(path, "utf8");
    assert(text.startsWith(legacy));
    const last = JSON.parse(text.trim().split("\n").at(-1)!);
    assert.equal(last.body.version, 2);
    assert.equal(last.body.changes.length, 1);
    const recovered = new DurableBudget(path);
    assert.equal(recovered.ledger.snapshot().length, 101);
    assert.equal(recovered.ledger.snapshot().find(row => row.id === "legacy")!.actual, 3);
    recovered.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("paired cohort reservations persist atomically and reject partial cohorts", () => {
  let writes = 0;
  const ledger = new BudgetLedger(() => { writes++; });
  assert.throws(() => ledger.reserveMany([
    { id: "a", allocation: "development", maximum: 30_000_000 },
    { id: "b", allocation: "development", maximum: 30_000_000 },
  ]), /Budget exhausted/);
  assert.equal(writes, 0);
  assert.deepEqual(ledger.snapshot(), []);
  ledger.reserveMany([{ id: "a", allocation: "development", maximum: 10 },
    { id: "b", allocation: "development", maximum: 10 }]);
  assert.equal(writes, 1);
  assert.equal(ledger.snapshot().length, 2);
});

test("paired trial reservations share parent allowance and preserve uncertain charges", () => {
  const global = new BudgetLedger();
  global.reserve("trial", "heldout", 100);
  const trial = new TrialLedger(global, "trial", "heldout");
  trial.reserve("actor", "heldout", 80);
  assert.throws(() => trial.reserve("predictor", "heldout", 21), /Trial budget/);
  trial.settle("actor", 10);
  trial.reserve("predictor", "heldout", 80);
  global.finishParent("trial");
  assert.equal(global.snapshot()[0].actual, undefined);
  trial.settle("predictor", 20);
  global.finishParent("trial");
  assert.equal(global.snapshot()[0].actual, 30);
  assert.throws(() => trial.reserve("late", "heldout", 1), /Invalid child/);
  assert.equal(maximumCost("gpt-5.4-2026-03-05", 32768, 4096), 143360);
  assert.equal(responseCost({ model: "gpt-5.4-2026-03-05", service_tier: "default", usage: { input_tokens: 1000, output_tokens: 10, input_tokens_details: { cached_tokens: 800 } } } as never), 850);
});

test("durable reservations survive reopen and exclusive ownership prevents competing dispatch", () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-budget-"));
  try {
    const path = join(directory, "budget.jsonl");
    const first = new DurableBudget(path);
    first.ledger.reserve("unknown-provider-outcome", "development", 40_000_000);
    assert.throws(() => new DurableBudget(path), /EEXIST/);
    first.close();
    const recovered = new DurableBudget(path);
    assert.throws(() => recovered.ledger.reserve("retry", "development", 1), /exhausted/);
    recovered.ledger.settle("unknown-provider-outcome", 1);
    recovered.ledger.reserve("retry", "development", 100);
    recovered.close();
    const third = new DurableBudget(path);
    assert.equal(third.ledger.snapshot().length, 2);
    third.close();
    appendFileSync(path, '{"partial":');
    assert.throws(() => new DurableBudget(path), /Truncated/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a recorded billing overrun halts dispatch after recovery", () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-budget-"));
  try {
    const path = join(directory, "budget.jsonl");
    const budget = new DurableBudget(path);
    budget.ledger.reserve("r", "training", 1);
    assert.throws(() => budget.ledger.settle("r", 2), /exceeded/);
    budget.close();
    const recovered = new DurableBudget(path);
    assert.throws(() => recovered.ledger.reserve("other", "preparation", 1), /halted/);
    recovered.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
