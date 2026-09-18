import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { WebArenaReadExecutor } from "../services/goalspec-runtime/browser-adapter";
import { existsSync } from "node:fs";

test("browser speculation isolates backend/session and blocks writes and authoritative navigation", async () => {
  const executable = process.env.GOALSPEC_CHROMIUM_PATH ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/usr/bin/chromium");
  assert.ok(existsSync(executable), "Configure GOALSPEC_CHROMIUM_PATH for the browser integration test");
  let authoritativeVisits = 0, writes = 0, released = 0, epoch = 1;
  const authoritative = createServer((request, response) => { authoritativeVisits++; response.end("authoritative"); });
  await new Promise<void>(resolve => authoritative.listen(0, "127.0.0.1", resolve));
  const authoritativeOrigin = `http://127.0.0.1:${(authoritative.address() as { port: number }).port}`;
  const replica = createServer((request, response) => {
    if (request.method !== "GET") writes++;
    response.setHeader("Content-Type", "text/html");
    response.end(`<title>Snapshot</title><body>Verified listing<a href="/next">Next</a><script>document.cookie='replica=1';fetch('/write',{method:'POST'}).catch(()=>{});fetch('${authoritativeOrigin}/mutating-get').catch(()=>{});</script></body>`);
  });
  await new Promise<void>(resolve => replica.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(replica.address() as { port: number }).port}`;
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  const scope = { tenantId: "browser", principalId: "fixture", authorizationVersion: "1", environmentVersion: "fixture", toolSchemaHash: "0".repeat(64) };
  const adapter = new WebArenaReadExecutor(browser, {
    async acquire() { return { id: "isolated", origin, stateVersion: String(epoch), isolationAudit: "local-fixture-two-servers" }; },
    async fresh(snapshot) { return snapshot.stateVersion === String(epoch); }, async release() { released++; },
    async reset() { epoch++; }, async verify(expected) { return { passed: expected === epoch, evidence: { epoch } }; },
  }, authoritativeOrigin, scope, () => {});
  try {
    const originalContext = await browser.newContext();
    await originalContext.addCookies([{ name: "authoritative", value: "untouched", url: authoritativeOrigin }]);
    const invocation = { tool: "browser_observe", arguments: { url: authoritativeOrigin + "/listing" }, scope };
    const observation = await adapter.read(invocation, new AbortController().signal);
    assert.equal((observation as { title: string }).title, "Snapshot");
    assert.equal(authoritativeVisits, 0); assert.equal(writes, 0);
    assert.deepEqual((await originalContext.cookies()).map(c => c.name), ["authoritative"]);
    assert.deepEqual(await adapter.validate(invocation, observation, new AbortController().signal), observation);
    epoch++;
    await assert.rejects(adapter.validate(invocation, observation, new AbortController().signal), /freshness/);
    assert.equal(adapter.eligible({ ...invocation, tool: "browser_click" }), false);
    await adapter.reset();
    assert.equal(released, 1);
    assert.equal((await adapter.verify(3)).passed, true);
  } finally {
    await adapter.close(); await browser.close();
    await Promise.all([new Promise<void>(resolve => authoritative.close(() => resolve())), new Promise<void>(resolve => replica.close(() => resolve()))]);
  }
});
