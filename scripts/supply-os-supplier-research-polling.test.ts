import assert from "node:assert/strict";
import {
  isTerminalSupplierResearchRun,
  pollSupplierResearchRun,
} from "../src/app/dashboard/supply-os/supplier-research-polling";
import type { SavedSourcingResearchRun } from "../src/app/dashboard/supply-os/supply-os-sourcing-research-types";

function run(status: string): SavedSourcingResearchRun {
  return {
    id: "run-1",
    status,
    input: {
      componentItemKey: "GUILD-001",
      componentName: "6061-T6 aluminum sheet",
      manufacturer: null,
      mpn: null,
      specification: "6061-T6 aluminum sheet, 2.0 mm",
      targetCountry: null,
      requestText: "Source four blanks",
    },
    output: status === "SUCCEEDED" ? { candidates: [], degraded: true, warnings: [] } : null,
    error: status === "FAILED" ? { message: "PROVIDER_TIMEOUT: Public supplier research timed out." } : null,
    createdAt: "2026-08-12T12:00:00.000Z",
    completedAt: status === "SUCCEEDED" ? "2026-08-12T12:01:00.000Z" : null,
  };
}

async function main() {
  assert.equal(isTerminalSupplierResearchRun(run("QUEUED")), false);
  assert.equal(isTerminalSupplierResearchRun(run("RUNNING")), false);
  assert.equal(isTerminalSupplierResearchRun(run("FAILED")), true);
  assert.equal(isTerminalSupplierResearchRun(run("SUCCEEDED")), true);

  const responses = [run("RUNNING"), run("SUCCEEDED")];
  let requests = 0;
  const outcome = await pollSupplierResearchRun({
    run: run("QUEUED"),
    signal: new AbortController().signal,
    wait: async () => {},
    fetchImpl: async (input, init) => {
      requests += 1;
      assert.match(String(input), /runId=run-1/);
      assert.equal(init?.method, undefined, "polling must never enqueue another provider request");
      return Response.json({ run: responses.shift() });
    },
  });
  assert.equal(outcome.state, "terminal");
  assert.equal(outcome.run.status, "SUCCEEDED");
  assert.equal(requests, 2);

  let now = 0;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const background = await pollSupplierResearchRun({
      run: run("RUNNING"),
      signal: new AbortController().signal,
      deadlineMs: 5,
      wait: async () => { now += 10; },
      fetchImpl: async () => Response.json({ run: run("RUNNING") }),
    });
    assert.equal(background.state, "background");
    assert.equal(background.run.status, "RUNNING");
  } finally {
    Date.now = realNow;
  }

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => pollSupplierResearchRun({ run: run("RUNNING"), signal: controller.signal }),
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );

  console.log("Supply OS supplier research polling checks passed.");
}

void main();
