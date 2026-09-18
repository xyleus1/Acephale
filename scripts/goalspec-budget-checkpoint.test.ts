import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { canonical, hash } from "../src/lib/goalspec/canonical";
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-budget-checkpoint-")), path = join(directory, "budget.jsonl");
  const close = () => { const target = resolve(directory); if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes("goalspec-budget-checkpoint-")) throw new Error("Unsafe cleanup"); rmSync(target, { recursive: true, force: true }); };
  return { directory, path, close };
}
function seed(path: string) { const owner = new DurableBudget(path); owner.ledger.reserve("parent", "training", 100);
  owner.ledger.reserveChild("parent", "request", 50); owner.ledger.settle("request", 12); owner.close(); }
function pointer(path: string) { return JSON.parse(readFileSync(`${path}.checkpoint-pointer.json`, "utf8")); }
test("verified checkpoint equals full journal replay and preserves every journal byte", () => {
  const f = fixture();
  try {
    seed(f.path); const bytes = readFileSync(f.path), fast = new DurableBudget(f.path);
    assert.equal(fast.recovery.checkpointUsed, true); assert.equal(fast.recovery.replayedRecords, 0);
    assert.equal(fast.recovery.verifiedPrefixBytes, bytes.length); const expected = fast.ledger.snapshot(); fast.close();
    const legacy = new DurableBudget(f.path, { recoveryCheckpoint: false });
    assert.equal(legacy.recovery.checkpointUsed, false); assert.equal(legacy.recovery.replayedRecords, 3);
    assert.deepEqual(legacy.ledger.snapshot(), expected); legacy.close(); assert.deepEqual(readFileSync(f.path), bytes);
  } finally { f.close(); }
});
test("checkpoint authenticates a prefix then replays append-only mixed tail records", () => {
  const f = fixture();
  try {
    seed(f.path); const oldPointer = readFileSync(`${f.path}.checkpoint-pointer.json`), before = readFileSync(f.path);
    const owner = new DurableBudget(f.path); owner.ledger.finishParent("parent"); owner.ledger.reserve("new", "replay", 10); owner.close();
    writeFileSync(`${f.path}.checkpoint-pointer.json`, oldPointer);
    const recovered = new DurableBudget(f.path); assert.equal(recovered.recovery.replayedRecords, 2);
    assert.equal(recovered.ledger.snapshot().find(row => row.id === "parent")!.actual, 12); recovered.close();
    assert.ok(readFileSync(f.path).subarray(0, before.length).equals(before));
  } finally { f.close(); }
});
test("truncated prefix, tampered bytes, corrupt sidecar and malformed tail fail closed", () => {
  for (const defect of ["prefix", "bytes", "sidecar", "tail"]) {
    const f = fixture();
    try {
      seed(f.path);
      if (defect === "prefix") truncateSync(f.path, 1);
      if (defect === "bytes") { const bytes = readFileSync(f.path); bytes[10] ^= 1; writeFileSync(f.path, bytes); }
      if (defect === "sidecar") appendFileSync(join(f.directory, pointer(f.path).checkpointFile), "x");
      if (defect === "tail") appendFileSync(f.path, '{"partial":');
      assert.throws(() => new DurableBudget(f.path), /checkpoint|Truncated/);
      assert.equal(existsSync(`${f.path}.lock`), false);
    } finally { f.close(); }
  }
});
test("checkpoint sequence bounds and parent validity cannot bypass recovery checks", () => {
  for (const defect of ["sequence", "offset", "parent"]) {
    const f = fixture();
    try {
      seed(f.path); const p = pointer(f.path), path = join(f.directory, p.checkpointFile), checkpoint = JSON.parse(readFileSync(path, "utf8"));
      if (defect === "sequence") checkpoint.nextSequence++;
      if (defect === "offset") checkpoint.prefixBytes = -1;
      if (defect === "parent") { checkpoint.entries[1][1].parentId = "absent"; checkpoint.entriesHash = hash(checkpoint.entries); }
      const { contentHash: _hash, ...body } = checkpoint; checkpoint.contentHash = hash(body);
      const bytes = Buffer.from(canonical(checkpoint) + "\n"); writeFileSync(path, bytes);
      p.sha256 = createHash("sha256").update(bytes).digest("hex"); writeFileSync(`${f.path}.checkpoint-pointer.json`, JSON.stringify(p));
      assert.throws(() => new DurableBudget(f.path), /checkpoint|recovered budget parent/);
    } finally { f.close(); }
  }
});
test("exclusive ownership fences checkpoint generation and orphan files do not become trusted", () => {
  const f = fixture();
  try {
    const owner = new DurableBudget(f.path); owner.ledger.reserve("a", "replay", 10);
    assert.throws(() => new DurableBudget(f.path), /EEXIST/); owner.close();
    writeFileSync(`${f.path}.checkpoint.v1.orphan.json`, '{"invalid":true}');
    const next = new DurableBudget(f.path); assert.equal(next.ledger.snapshot().length, 1); next.close();
    const p = pointer(f.path); p.checkpointFile = "../outside.json";
    writeFileSync(`${f.path}.checkpoint-pointer.json`, JSON.stringify(p));
    assert.throws(() => new DurableBudget(f.path), /pointer/);
  } finally { f.close(); }
});
