import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DurableBudget } from "../../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../../services/goalspec-runtime/artifacts";

// Isolated local interoperability fixture. No provider, shared research ledger,
// credentials, benchmark task data, or upstream source is opened.
const [interpreter, outputArgument] = process.argv.slice(2);
if (!interpreter || !outputArgument) throw new Error("Usage: NATIVE_PYTHON NEW_OUTPUT_DIRECTORY");
const root = resolve(__dirname, "../.."), output = resolve(outputArgument);
if (existsSync(output)) throw new Error("Fresh verification output required");
mkdirSync(output, { recursive: true });
const budget = new DurableBudget(join(output, "budget.jsonl"));
try {
  const events = new ImmutableEventLog(join(output, "publication-fixture.jsonl"));
  events.append({ type: "research_manifest", manifestHash: "native-interoperability-fixture" });
  events.append({ runId: "synthetic-run", event: { type: "model_attempt", costMicrodollars: 12345, fractionFixture: 1.25 } });
  events.close();
  const script = `
import json, sys
from pathlib import Path
from goalspec.native_runner_v5 import ServiceTelemetry
directory = Path(sys.argv[1])
telemetry = ServiceTelemetry(directory, 'native-interoperability-fixture')
(directory / 'publication-fixture.jsonl').rename(directory / 'events-interop.jsonl')
telemetry.bind(int(sys.argv[2]))
first = telemetry.summary('synthetic-run', True)
second = telemetry.summary('synthetic-run', True)
assert first == second
assert first['providerCalls'] == 1 and first['billedUsd'] == .012345
assert not first['unknownProviderCharge']
print(json.dumps({'passed': True, 'interpreter': sys.executable, 'summary': first}))
`;
  const child = spawnSync(resolve(interpreter), ["-c", script, output, String(process.pid)], {
    cwd: root, encoding: "utf8", env: { ...process.env, PYTHONPATH: join(root, "research/goalspec/src") },
  });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim());
  const sourcePaths = ["outputs/goalspec-v5-tools/verify_native_telemetry.ts", "research/goalspec/src/goalspec/native_runner_v5.py",
    "research/goalspec/src/goalspec/contracts_v1.py", "services/goalspec-runtime/artifacts.ts", "services/goalspec-runtime/durable-budget.ts"];
  const receipt = { ...result, providerCallsActuallyDispatched: 0, syntheticProviderEvent: true,
    actualDurableBudgetLockMatched: true, actualNodeEventChainValidatedByNativePython: true, duplicateCountingAbsent: true,
    sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex")])) };
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(receipt));
} finally { budget.close(); }
