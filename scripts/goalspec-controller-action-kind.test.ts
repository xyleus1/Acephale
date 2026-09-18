import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { LocalActionKindController, ACTION_KINDS } from "../src/lib/goalspec/controller-action-kind";
import { hash } from "../src/lib/goalspec/canonical";
const root = "research/goalspec/runs/local-controller-v4-action-kind-20260916";
const artifact = JSON.parse(readFileSync(`${root}/action-kind.json`, "utf8"));
const fixtures = JSON.parse(readFileSync(`${root}/parity-fixtures.json`, "utf8"));
test("auxiliary kind head matches CPU probabilities, preserves unavailable STOP and discloses support", () => {
  const controller = new LocalActionKindController(artifact);
  for (const fixture of fixtures) {
    const result = controller.score(fixture.state);
    assert.equal(result.probabilities.stop, null); assert.equal(result.supportCounts.stop, 0);
    assert.equal(result.supportCounts.compute, 3); assert.equal(result.conditionalOnObservedClasses, true);
    ACTION_KINDS.forEach((kind, i) => { const probability = result.probabilities[kind]; if (fixture.probabilities[i] === null) assert.equal(probability, null); else assert.ok(Math.abs(probability! - fixture.probabilities[i]) < 1e-6); });
    assert.ok(Math.abs(Object.values(result.probabilities).reduce<number>((sum, p) => sum + (p ?? 0), 0) - 1) < 1e-12);
  }
});
test("auxiliary class support cannot be invented or crossed between families", () => {
  const corrupt = structuredClone(artifact); corrupt.trained[4] = true;
  const rehash = (value: typeof artifact) => { const { contentHash: _old, ...body } = value; value.contentHash = hash(body); return value; };
  assert.throws(() => new LocalActionKindController(rehash(corrupt)), /class support/);
  const overlap = structuredClone(artifact); overlap.lineage.selectionFamilies.push(overlap.lineage.trainFamilies[0]);
  assert.throws(() => new LocalActionKindController(rehash(overlap)), /contamination/);
});
