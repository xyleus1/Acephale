import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, utimes, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregateInfraMetrics } from "../services/goalspec-runtime/infra-metrics-store";
import { InfraMetrics, InfraTelemetry } from "../services/goalspec-runtime/infra-telemetry";

async function fixture(run: (root: string, save: (name: string, text: string) => Promise<string>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "goalspec-metrics-"));
  const save = async (name: string, text: string) => { const directory = join(root, name); await mkdir(directory, { recursive: true }); const file = join(directory, "metrics.prom"); await writeFile(file, text); return file; };
  try { await run(root, save); } finally { await rm(root, { recursive: true, force: true }); }
}
test("aggregator sums counters and histograms but selects latest gauge", async () => {
  await fixture(async (root, save) => {
    const one = new InfraMetrics(); one.increment("goalspec_tasks_total", { arm: "base", outcome: "success" }, 2);
    one.observe("goalspec_task_duration_seconds", { arm: "base" }, 0.5); one.gauge("goalspec_reserved_usd", { category: "infra" }, 10);
    const two = new InfraMetrics(); two.increment("goalspec_tasks_total", { arm: "base", outcome: "success" }, 3);
    two.observe("goalspec_task_duration_seconds", { arm: "base" }, 1.5); two.gauge("goalspec_reserved_usd", { category: "infra" }, 5);
    const old = await save("first", one.render()), latest = await save("second", two.render());
    await utimes(old, 1000, 1000); await utimes(latest, 2000, 2000);
    const output = await aggregateInfraMetrics(root);
    assert.equal(output.files, 2); assert.equal(output.skipped, 0);
    assert.match(output.text, /goalspec_tasks_total\{arm="base",outcome="success"\} 5/);
    assert.match(output.text, /goalspec_task_duration_seconds_count\{arm="base"\} 2/);
    assert.match(output.text, /goalspec_task_duration_seconds_sum\{arm="base"\} 2/);
    assert.match(output.text, /goalspec_task_duration_seconds_bucket\{arm="base",le="1"\} 1/);
    assert.match(output.text, /goalspec_reserved_usd\{category="infra"\} 5/);
  });
});
test("aggregator rejects malformed, nonfinite, incomplete and duplicate snapshots", async () => {
  await fixture(async (root, save) => {
    const header = "# TYPE goalspec_tasks_total counter\n";
    await save("nan", header + "goalspec_tasks_total{} NaN\n");
    await save("incomplete", header + "goalspec_tasks_total{} 1");
    await save("private-label", header + 'goalspec_tasks_total{customer_id="secret"} 1\n');
    await save("duplicates", header + "goalspec_tasks_total{} 1\ngoalspec_tasks_total{} 1\n");
    await save("good", header + "goalspec_tasks_total{} 2\n");
    const result = await aggregateInfraMetrics(root); assert.equal(result.files, 1); assert.equal(result.skipped, 4);
    assert.match(result.text, /goalspec_tasks_total\{\} 2/); assert.doesNotMatch(result.text, /secret/);
  });
});
test("aggregator canonicalizes label order and enforces file and size bounds", async () => {
  await fixture(async (root, save) => {
    const header = "# TYPE goalspec_tasks_total counter\n";
    await save("a", header + 'goalspec_tasks_total{outcome="success",arm="base"} 1\n');
    await save("b", header + 'goalspec_tasks_total{arm="base",outcome="success"} 2\n');
    assert.match((await aggregateInfraMetrics(root)).text, /goalspec_tasks_total\{arm="base",outcome="success"\} 3/);
    assert.equal((await aggregateInfraMetrics(root, { maxFiles: 1 })).limited, true);
    const bounded = await aggregateInfraMetrics(root, { maxFileBytes: 10 }); assert.equal(bounded.files, 0); assert.equal(bounded.skipped, 2);
    await assert.rejects(() => aggregateInfraMetrics(root, { maxFiles: 1001 }), /bounds/);
  });
});
test("aggregator does not follow directory junctions or symlinks", async () => {
  await fixture(async (root, save) => {
    const file = await save("real", "# TYPE goalspec_tasks_total counter\ngoalspec_tasks_total{} 1\n");
    await symlink(join(file, ".."), join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    const result = await aggregateInfraMetrics(root); assert.equal(result.files, 1); assert.equal(result.skipped, 1);
  });
});
test("telemetry rejects high-cardinality labels and drains event files", async () => {
  await fixture(async root => {
    const telemetry = await InfraTelemetry.create(join(root, "run"));
    assert.throws(() => telemetry.metrics.increment("goalspec_test_total", { customerId: "private" }), /cardinality/);
    telemetry.record({ type: "test_event" });
    assert.equal(await telemetry.span("unit", "run", { arm: "base" }, async () => "ok"), "ok");
    await telemetry.close(); assert.throws(() => telemetry.record({ type: "late" }), /closed/);
  });
});
