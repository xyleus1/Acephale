import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { verifyInfraPilotBundle } from "./goalspec-infra-memory";

function fixture() {
  const directory = resolve("research/goalspec/runs", `infra-memory-test-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const split = { families: { fitting: "train", selection: "development" }, fresh_heldout: false };
  const memoryBody = { frozen: true, split_hash: hash(split), training_families: ["fitting"] };
  const files: Record<string, { sha256: string }> = {};
  const write = (name: string, value: unknown) => {
    const path = join(directory, name);
    writeFileSync(path, name.endsWith(".jsonl") ? `${canonical(value)}\n` : canonical(value));
    files[name] = { sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
  };
  write("split.json", split);
  write("memory.json", { ...memoryBody, snapshot_hash: hash(memoryBody) });
  write("lineage.json", { fresh_heldout: false, fresh_qwen_traces: false });
  write("metadata.jsonl", { episode_id: "one" });
  writeFileSync(join(directory, "manifest.json"), canonical({ schema_version: "goalspec-infra-data-v1", files, bundle_hash: hash(files) }));
  return directory;
}

test("runtime bridge verifies pilot bytes and historical-only identity", () => {
  const directory = fixture();
  const pilot = verifyInfraPilotBundle(directory);
  assert.deepEqual(pilot.expected, ["fitting"]);
  writeFileSync(join(directory, "memory.json"), "{}");
  assert.throws(() => verifyInfraPilotBundle(directory), /artifact changed/);
});

test("runtime bridge rejects a tampered manifest", () => {
  const directory = fixture();
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  manifest.bundle_hash = "0".repeat(64);
  writeFileSync(join(directory, "manifest.json"), canonical(manifest));
  assert.throws(() => verifyInfraPilotBundle(directory), /manifest/);
});
