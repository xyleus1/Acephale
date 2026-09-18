import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEventChain, neverDispatched } from "./annotation-continue";
import { hash } from "../../src/lib/goalspec/canonical";

function row(id: string) { return { groupId: id, familyId: "retail:fixture", frameHash: "frame", prefixHash: "prefix",
  publicInputHash: "public", sourceRevisionHash: "revision", reliabilitySplit: "train" } as any; }
function result(id: string) { return { ...row(id), goals: null, prediction: { status: "failed" },
  annotation: { status: "failed", value: null }, agreement: { label: null } } as any; }
test("never-dispatched selection preserves incomplete attempted rows and original ordinals", () => {
  const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64);
  assert.deepEqual(neverDispatched([row(a), row(b), row(c)], [result(a), result(b), result(c)], [b]), [{ ordinal: 0, groupId: a }, { ordinal: 2, groupId: c }]);
  assert.throws(() => neverDispatched([row(a)], [{ ...result(a), goals: {} }], []), /completed row/);
  assert.throws(() => neverDispatched([row(a)], [result(b)], []), /order or identity/);
});
test("provider chain rejects tampering and uncertain attempted charges", () => {
  const body = { sequence: 0, previousHash: "0".repeat(64), recordedAtUnixMs: 1,
    event: { type: "model_attempt", id: `v5-annotation:${"a".repeat(64)}:blind`, costMicrodollars: 3 } };
  assert.equal(checkEventChain([{ body, hash: hash(body) }]).knownCostMicrodollars, 3);
  assert.throws(() => checkEventChain([{ body, hash: "bad" }]), /chain mismatch/);
  body.event.type = "model_attempt_failed";
  assert.throws(() => checkEventChain([{ body, hash: hash(body) }]), /Unknown previous provider charge/);
});
test("bounded unknown attempted request is retained, never eligible in later continuation", () => {
  const id = "d".repeat(64), other = "e".repeat(64);
  const body = { sequence: 0, previousHash: "0".repeat(64), recordedAtUnixMs: 1,
    event: { type: "model_attempt_failed", id: `v5-annotation:${id}:agreement`,
      model: "gpt-5.4-2026-03-05", reservationRetained: true } };
  const audit = checkEventChain([{ body, hash: hash(body) }], true);
  assert.equal(audit.unknownMaximumMicrodollars, 81920);
  assert.deepEqual(neverDispatched([row(id), row(other)], [result(id), result(other)], audit.attemptedGroupIds), [{ ordinal: 1, groupId: other }]);
});
