import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { InfraTelemetry, publishInfraMetricsSnapshot } from "../services/acephale-runtime/infra-telemetry";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "acephale-publication-test-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function denied(code = "EPERM") { return Object.assign(new Error("Synthetic sharing-denial fixture"), { code }); }
async function noTemporaryFiles(root: string) { assert.deepEqual((await readdir(root)).filter(name => name.endsWith(".tmp")), []); }

test("Windows sharing retries replace atomically and keep the old snapshot until success", async () => {
  await fixture(async root => {
    const target = join(root, "metrics.prom"); await writeFile(target, "old\n");
    let attempts = 0, clock = 0; const sources = new Set<string>();
    await publishInfraMetricsSnapshot(root, "new\n", { platform: "win32", now: () => clock, sleep: async ms => { clock += ms; },
      renameFile: async (source, destination) => {
        sources.add(String(source)); assert.equal(await readFile(target, "utf8"), "old\n");
        if (++attempts < 3) throw denied();
        await rename(source, destination);
      } });
    assert.equal(attempts, 3); assert.equal(sources.size, 1);
    assert.equal(await readFile(target, "utf8"), "new\n"); await noTemporaryFiles(root);
  });
});

test("exhausted retries and non-sharing errors remain failures with the old snapshot intact", async () => {
  await fixture(async root => {
    const target = join(root, "metrics.prom"); await writeFile(target, "old\n");
    let attempts = 0, clock = 0;
    await assert.rejects(publishInfraMetricsSnapshot(root, "new\n", { platform: "win32", now: () => clock, sleep: async ms => { clock += ms; },
      renameFile: async () => { attempts++; throw denied(); } }), { code: "EPERM" });
    assert.ok(attempts > 1 && attempts <= 16); assert.ok(clock <= 1000);
    assert.equal(await readFile(target, "utf8"), "old\n"); await noTemporaryFiles(root);
    for (const [platform, code] of [["linux", "EPERM"], ["win32", "ENOENT"]] as const) {
      attempts = 0;
      await assert.rejects(publishInfraMetricsSnapshot(root, "new\n", { platform,
        renameFile: async () => { attempts++; throw denied(code); } }), { code });
      assert.equal(attempts, 1); await noTemporaryFiles(root);
    }
  });
});

test("independent concurrent publications have separate owned temporary paths", async () => {
  await fixture(async root => {
    const sources = new Set<string>();
    const snapshots = Array.from({ length: 20 }, (_, index) => `complete-snapshot-${index}\n`);
    await Promise.all(snapshots.map(snapshot => publishInfraMetricsSnapshot(root, snapshot, {
      renameFile: async (source, destination) => { sources.add(String(source)); await rename(source, destination); },
    })));
    assert.equal(sources.size, snapshots.length);
    assert.ok(snapshots.includes(await readFile(join(root, "metrics.prom"), "utf8"))); await noTemporaryFiles(root);
  });
});

test("concurrent metric updates and flushes drain once without losing or duplicating events", async () => {
  await fixture(async root => {
    const telemetry = await InfraTelemetry.create(root), pending: Promise<void>[] = [];
    for (let index = 0; index < 100; index++) {
      telemetry.metrics.increment("acephale_concurrent_total"); telemetry.record({ type: "concurrent", index });
      pending.push(telemetry.flush());
    }
    const closing = telemetry.close(); assert.equal(telemetry.close(), closing);
    assert.throws(() => telemetry.record({ type: "too_late" }), /closed/);
    await Promise.all([...pending, closing]); assert.equal(telemetry.close(), closing);
    assert.match(await readFile(join(root, "metrics.prom"), "utf8"), /acephale_concurrent_total 100/);
    const rows = (await readFile(join(root, "events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(rows.map(row => row.index), Array.from({ length: 100 }, (_, index) => index));
    assert.deepEqual(rows.map(row => row.sequence), Array.from({ length: 100 }, (_, index) => index));
    await noTemporaryFiles(root);
  });
});

test("a fatal local publication still drains OTLP and repeated close never reports success", async () => {
  await fixture(async root => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      request.resume(); request.on("end", () => { requests.push(request.url!); response.setHeader("content-type", "application/json"); response.end("{}"); });
    }).listen(0, "127.0.0.1");
    await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
    try {
      const telemetry = await InfraTelemetry.create(root, `http://127.0.0.1:${address.port}`);
      await telemetry.span("publication-failure-fixture", "fixture", {}, async () => "ok");
      await mkdir(join(root, "metrics.prom")); // A directory is not a transient sharing denial.
      const closing = telemetry.close(); await assert.rejects(closing); await assert.rejects(telemetry.close());
      assert.equal(telemetry.close(), closing);
      assert.deepEqual(requests, ["/v1/traces", "/v1/metrics"]);
      assert.throws(() => telemetry.record({ type: "late" }));
      assert.equal((telemetry as unknown as { lastPublishedMetrics?: string }).lastPublishedMetrics, undefined);
      await noTemporaryFiles(root);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

/** Real Windows handle without FILE_SHARE_DELETE, not a simulated errno. */
async function windowsReadLock(path: string) {
  const script = `$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ACEPHALE_TEST_LOCK_PATH_BASE64)); $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); [void][Console]::In.ReadLine() } finally { $stream.Dispose() }`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ACEPHALE_TEST_LOCK_PATH_BASE64: Buffer.from(path).toString("base64") },
  });
  let output = "", errors = "";
  child.stderr.on("data", chunk => { errors = (errors + chunk.toString()).slice(-2048); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("Windows lock startup timed out")); }, 10000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Windows lock exited ${code}: ${errors}`)); });
      child.stdout.on("data", chunk => { output += chunk.toString(); if (output.includes("locked")) { clearTimeout(timer); resolve(); } });
    });
  } catch (error) { child.kill(); throw error; }
  return async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, "exit"); child.stdin.end("\n");
    const timer = setTimeout(() => child.kill(), 5000);
    try { const [code] = await exited; assert.equal(code, 0, errors); } finally { clearTimeout(timer); }
  };
}

test("actual Windows sharing violation recovers when the reader releases its handle", { skip: process.platform !== "win32", timeout: 20000 }, async () => {
  await fixture(async root => {
    const target = join(root, "metrics.prom"); await writeFile(target, "old\n");
    const unlock = await windowsReadLock(target); let sharingErrors = 0;
    try {
      const publication = publishInfraMetricsSnapshot(root, "new\n", { renameFile: async (source, destination) => {
        try { await rename(source, destination); }
        catch (error) {
          assert.ok(["EPERM", "EACCES", "EBUSY"].includes(String((error as NodeJS.ErrnoException).code)));
          sharingErrors++; assert.equal(await readFile(target, "utf8"), "old\n"); throw error;
        }
      } });
      await Promise.all([publication, delay(200).then(unlock)]);
      assert.ok(sharingErrors > 0); assert.equal(await readFile(target, "utf8"), "new\n"); await noTemporaryFiles(root);
    } finally { await unlock(); }
  });
});

test("unchanged snapshots skip locked replacements and failed changes do not advance committed cache", { skip: process.platform !== "win32", timeout: 20000 }, async () => {
  await fixture(async root => {
    const telemetry = await InfraTelemetry.create(root); telemetry.metrics.increment("acephale_cached_total"); await telemetry.flush();
    const target = join(root, "metrics.prom"), before = await readFile(target, "utf8"), unlock = await windowsReadLock(target);
    try {
      await Promise.all(Array.from({ length: 10 }, () => telemetry.flush()));
      telemetry.metrics.increment("acephale_cached_total");
      await assert.rejects(telemetry.flush(), error => ["EPERM", "EACCES", "EBUSY"].includes(String((error as NodeJS.ErrnoException).code)));
      assert.equal(await readFile(target, "utf8"), before);
      assert.equal((telemetry as unknown as { lastPublishedMetrics?: string }).lastPublishedMetrics, before);
    } finally { await unlock(); await assert.rejects(telemetry.close()); }
    await noTemporaryFiles(root);
  });
});
