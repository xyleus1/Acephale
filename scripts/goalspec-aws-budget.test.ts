import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { awsBudget, type AwsBudgetRequest } from "./goalspec-aws-budget";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-aws-budget-")), path = join(directory, "original.jsonl"), checkpointPath = join(directory, "checkpoint.json");
  const owner = new DurableBudget(path); owner.ledger.reserve("original-unknown", "training", 2_000_000);
  const entries = owner.ledger.snapshot(); owner.close();
  const checkpoint = { version: 1, ledgerPathHash: hash(resolve(path)), entriesHash: hash(entries), entries };
  writeFileSync(checkpointPath, canonical(checkpoint));
  const request: AwsBudgetRequest = { operation: "reserve", ledgerPath: path, checkpointPath, checkpointHash: hash(checkpoint),
    sliceLedgerPath: join(directory, "aws-slice.json"), deploymentHash: "b".repeat(64),
    reservationId: "aws-infra:11111111-1111-4111-8111-111111111111", maximumMicrodollars: 4_400_000 };
  awsBudget({ ...request, operation: "bind" });
  const cleanup = () => { const target = resolve(directory); if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes("goalspec-aws-budget-")) throw new Error("Unsafe cleanup"); rmSync(target, { recursive: true, force: true }); };
  return { path, request, cleanup };
}

test("AWS reservations append once to the original journal and retain unknown history", () => {
  const f = fixture();
  try {
    const before = readFileSync(f.path), first = awsBudget(f.request), reserved = readFileSync(f.path);
    assert.equal(first.infrastructureMicrodollars, 4_400_000);
    assert.ok(reserved.subarray(0, before.length).equals(before));
    assert.deepEqual(awsBudget(f.request), first);
    assert.deepEqual(readFileSync(f.path), reserved);
    const owner = new DurableBudget(f.path);
    assert.equal(owner.ledger.snapshot().find(row => row.id === "original-unknown")!.actual, undefined);
    owner.close();
  } finally { f.cleanup(); }
});

test("AWS bridge rejects replacement journals, stale identities and changed reservation amounts", () => {
  const f = fixture();
  try {
    awsBudget(f.request);
    assert.throws(() => awsBudget({ ...f.request, maximumMicrodollars: 1 }), /differs/);
    assert.throws(() => awsBudget({ ...f.request, requireNewReservation: true }), /another launch/);
    assert.throws(() => awsBudget({ ...f.request, sliceLedgerPath: join(tmpdir(), "new-slice.json") }), /binding/);
    assert.throws(() => awsBudget({ ...f.request, deploymentHash: "c".repeat(64) }), /binding/);
    assert.throws(() => awsBudget({ ...f.request, operation: "bind" }), /EEXIST/);
    assert.throws(() => awsBudget({ ...f.request, checkpointHash: "0".repeat(64) }), /checkpoint/);
    const empty = join(resolve(f.path, ".."), "empty.jsonl"); writeFileSync(empty, "");
    assert.throws(() => awsBudget({ ...f.request, ledgerPath: empty }), /nonempty/);
  } finally { f.cleanup(); }
});

test("AWS bridge preserves later study progress but refuses allocation overflow", () => {
  const f = fixture();
  try {
    const owner = new DurableBudget(f.path); owner.ledger.settle("original-unknown", 1_000_000);
    owner.ledger.reserve("prior-infrastructure", "infrastructure", 33_000_000); owner.close();
    const before = readFileSync(f.path);
    assert.throws(() => awsBudget(f.request), /exhausted/);
    assert.deepEqual(readFileSync(f.path), before);
    const report = awsBudget({ ...f.request, operation: "inspect" });
    assert.equal(report.committedMicrodollars, 34_000_000);
  } finally { f.cleanup(); }
});
