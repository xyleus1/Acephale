import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, utimes, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregateInfraMetrics } from "../services/acephale-runtime/infra-metrics-store";
import { InfraMetrics, InfraTelemetry } from "../services/acephale-runtime/infra-telemetry";

async function fixture(run: (root: string, save: (name: string, text: string) => Promise<string>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "acephale-metrics-"));
  const save = async (name: string, text: string) => { const directory = join(root, name); await mkdir(directory, { recursive: true }); const file = join(directory, "metrics.prom"); await writeFile(file, text); return file; };
  try { await run(root, save); } finally { await rm(root, { recursive: true, force: true }); }
}
test("aggregator sums counters and histograms but selects latest gauge", async () => {
  await fixture(async (root, save) => {
    const one = new InfraMetrics(); one.increment("acephale_tasks_total", { arm: "base", outcome: "success" }, 2);
    one.observe("acephale_task_duration_seconds", { arm: "base" }, 0.5); one.gauge("acephale_reserved_usd", { category: "infra" }, 10);
    const two = new InfraMetrics(); two.increment("acephale_tasks_total", { arm: "base", outcome: "success" }, 3);
    two.observe("acephale_task_duration_seconds", { arm: "base" }, 1.5); two.gauge("acephale_reserved_usd", { category: "infra" }, 5);
    const old = await save("first", await one.render()), latest = await save("second", await two.render());
    await utimes(old, 1000, 1000); await utimes(latest, 2000, 2000);
    const output = await aggregateInfraMetrics(root);
    assert.equal(output.files, 2); assert.equal(output.skipped, 0);
    assert.match(output.text, /acephale_tasks_total\{arm="base",outcome="success"\} 5/);
    assert.match(output.text, /acephale_task_duration_seconds_count\{arm="base"\} 2/);
    assert.match(output.text, /acephale_task_duration_seconds_sum\{arm="base"\} 2/);
    assert.match(output.text, /acephale_task_duration_seconds_bucket\{arm="base",le="1"\} 1/);
    assert.match(output.text, /acephale_reserved_usd\{category="infra"\} 5/);
  });
});
test("aggregator rejects malformed, nonfinite, incomplete and duplicate snapshots", async () => {
  await fixture(async (root, save) => {
    const header = "# TYPE acephale_tasks_total counter\n";
    await save("nan", header + "acephale_tasks_total{} NaN\n");
    await save("incomplete", header + "acephale_tasks_total{} 1");
    await save("private-label", header + 'acephale_tasks_total{customer_id="secret"} 1\n');
    await save("duplicates", header + "acephale_tasks_total{} 1\nacephale_tasks_total{} 1\n");
    await save("good", header + "acephale_tasks_total{} 2\n");
    const result = await aggregateInfraMetrics(root); assert.equal(result.files, 1); assert.equal(result.skipped, 4);
    assert.match(result.text, /acephale_tasks_total\{\} 2/); assert.doesNotMatch(result.text, /secret/);
  });
});
test("aggregator canonicalizes label order and enforces file and size bounds", async () => {
  await fixture(async (root, save) => {
    const header = "# TYPE acephale_tasks_total counter\n";
    await save("a", header + 'acephale_tasks_total{outcome="success",arm="base"} 1\n');
    await save("b", header + 'acephale_tasks_total{arm="base",outcome="success"} 2\n');
    assert.match((await aggregateInfraMetrics(root)).text, /acephale_tasks_total\{arm="base",outcome="success"\} 3/);
    assert.equal((await aggregateInfraMetrics(root, { maxFiles: 1 })).limited, true);
    const bounded = await aggregateInfraMetrics(root, { maxFileBytes: 10 }); assert.equal(bounded.files, 0); assert.equal(bounded.skipped, 2);
    await assert.rejects(() => aggregateInfraMetrics(root, { maxFiles: 1001 }), /bounds/);
  });
});
test("aggregator does not follow directory junctions or symlinks", async () => {
  await fixture(async (root, save) => {
    const file = await save("real", "# TYPE acephale_tasks_total counter\nacephale_tasks_total{} 1\n");
    await symlink(join(file, ".."), join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
    const result = await aggregateInfraMetrics(root); assert.equal(result.files, 1); assert.equal(result.skipped, 1);
  });
});
test("telemetry rejects high-cardinality labels and drains event files", async () => {
  await fixture(async root => {
    const telemetry = await InfraTelemetry.create(join(root, "run"));
    assert.throws(() => telemetry.metrics.increment("acephale_test_total", { customerId: "private" }), /cardinality/);
    telemetry.record({ type: "test_event" });
    assert.equal(await telemetry.span("unit", "run", { arm: "base" }, async () => "ok"), "ok");
    await telemetry.close(); assert.throws(() => telemetry.record({ type: "late" }), /closed/);
  });
});

test("independent telemetry instances preserve unique clocks and ordered journals", async () => {
  await fixture(async root => {
    const left = await InfraTelemetry.create(join(root, "left")), right = await InfraTelemetry.create(join(root, "right"));
    left.record({ type: "prediction", runId: "a", sequence: 999, processClockId: "forged" });
    right.record({ type: "prediction", runId: "b" });
    left.record({ type: "actor_generated", runId: "a" });
    await Promise.all([left.close(), right.close()]);
    const events = async (name: string) => (await readFile(join(root, name, "events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const a = await events("left"), b = await events("right");
    assert.deepEqual(a.map(row => row.sequence), [0, 1]);
    assert.equal(a[0].processClockId, a[1].processClockId);
    assert.notEqual(a[0].processClockId, b[0].processClockId);
    assert.notEqual(a[0].processClockId, "forged");
  });
});

test("OTLP receipts distinguish actual collector acceptance from partial rejection", async () => {
  await fixture(async root => {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      req.resume(); req.on("end", () => {
        requests.push(req.url!); res.setHeader("content-type", "application/json");
        res.end(req.url === "/v1/traces" ? JSON.stringify({ partialSuccess: { rejectedSpans: "1" } }) : "{}");
      });
    }).listen(0, "127.0.0.1");
    await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
    try {
      const telemetry = await InfraTelemetry.create(join(root, "run"), `http://127.0.0.1:${address.port}`);
      await telemetry.span("actual-local-fixture", "run", {}, async () => "ok");
      await telemetry.close();
      assert.deepEqual(requests, ["/v1/traces", "/v1/metrics"]);
      assert.deepEqual(telemetry.exportSummary(), { endpoint: `http://127.0.0.1:${address.port}`, spans: 1, tracesAccepted: 0, metricsAccepted: 1, failed: 1 });
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
