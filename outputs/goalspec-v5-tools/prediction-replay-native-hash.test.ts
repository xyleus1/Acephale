import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hash } from "../../src/lib/goalspec/canonical";
import { verifyNativePlanHash } from "./prediction-replay";

test("native plan bridge preserves integral floats and non-ASCII producer bytes; tampering fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-native-plan-hash-"));
  try {
    const body = '{"budget":90.0,"name":"τ étude","nested":{"ratio":1.0},"version":"goalspec-experiment-v5"}';
    const expected = createHash("sha256").update(body, "utf8").digest("hex");
    assert.notEqual(hash(JSON.parse(body)), expected, "fixture must exercise Python/JS serialization difference");
    const path = join(directory, "plan.json");
    const original = body.slice(0, -1) + `,"planHash":"${expected}"}\n`;
    writeFileSync(path, original, { flag: "wx" });
    verifyNativePlanHash(path);
    assert.equal(readFileSync(path, "utf8"), original, "verification never normalizes original bytes");
    writeFileSync(path, original.replace("90.0", "91.0"));
    assert.throws(() => verifyNativePlanHash(path), /Native plan hash mismatch/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
