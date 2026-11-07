import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { budgetReport } from "./acephale-budget-report";

test("budget report cannot initialize a replacement journal", () => {
  const directory = mkdtempSync(join(tmpdir(), "acephale-budget-report-"));
  try {
    assert.throws(() => budgetReport(directory, join(directory, "result.json")), /ENOENT/);
    assert.equal(existsSync(join(directory, "budget.jsonl")), false);
    writeFileSync(join(directory, "budget.jsonl"), "");
    assert.throws(() => budgetReport(directory, join(directory, "result.json")), /nonempty/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("budget report preserves opaque historical entries and uncertain infrastructure commitments", () => {
  const directory = mkdtempSync(join(tmpdir(), "acephale-budget-report-"));
  try {
    const body = { sequence: 0, previous: "0".repeat(64), entries: [
      ["historical-provider-opaque-123", { allocation: "training", maximum: 2000000, actual: 1500000 }],
      ["historical-infrastructure-charge", { allocation: "infrastructure", maximum: 1000000, actual: 500000 }],
      ["historical-unsettled-infrastructure", { allocation: "infrastructure", maximum: 3000000 }],
    ] };
    const bytes = canonical({ body, hash: hash(body) }) + "\n", path = join(directory, "budget.jsonl");
    writeFileSync(path, bytes);
    const report = budgetReport(directory, join(directory, "result.json"));
    assert.equal(report.totalKnownUsageCostUsd, 2); assert.equal(report.totalSpentOrReservedUsd, 5);
    assert.equal(report.infrastructureKnownCostUsd, 0.5); assert.equal(report.infrastructureSpentOrReservedUsd, 3.5);
    assert.equal(report.unresolvedRequests, 1); assert.equal(readFileSync(path, "utf8"), bytes);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
