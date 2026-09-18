import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalBrowserSnapshotProvider } from "../services/goalspec-runtime/browser-local-provider";

test("local browser provider correlates real Python RPC and excludes provider credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-browser-rpc-"));
  const script = join(directory, "fixture.py");
  const config = join(directory, "server-owned.json");
  writeFileSync(config, JSON.stringify({ origin: "http://127.0.0.1:17770" }));
  writeFileSync(script, `import json, os, sys
config = json.load(open(sys.argv[1], encoding="utf-8"))
lease = None
for line in sys.stdin:
    request = json.loads(line)
    response = {"id": request["id"]}
    op = request["operation"]
    if op == "acquire":
        lease = {"id": "fixture", "origin": config["origin"], "stateVersion": "1", "isolationAudit": "fixture-only"}
        response["result"] = lease
    elif op == "fresh":
        response["result"] = request["snapshot"] == lease
    elif op == "release":
        lease = None
        response["result"] = {"released": True}
    elif op == "reset":
        response["result"] = {"reset": True}
    elif op == "verify":
        if request["expected"] != {"taskId": "registered"}:
            response["error"] = "ValueError"
        else:
            response["result"] = {"passed": True, "evidence": {"credentialAbsent": "OPENAI_API_KEY" not in os.environ and "GOALSPEC_BROWSER_RPC_SECRET_SENTINEL" not in os.environ}}
    print(json.dumps(response), flush=True)
`);
  process.env.GOALSPEC_BROWSER_RPC_SECRET_SENTINEL = "fixture-must-not-cross-provider-boundary";
  const python = resolve("research/goalspec/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const provider = new LocalBrowserSnapshotProvider(python, script, config);
  try {
    await provider.reset();
    const snapshot = await provider.acquire();
    assert.equal(await provider.fresh(snapshot), true);
    await provider.release(snapshot);
    assert.equal(await provider.fresh(snapshot), false);
    await assert.rejects(provider.verify({ taskId: "actor-chosen" }), /ValueError/);
    assert.deepEqual(await provider.verify({ taskId: "registered" }), { passed: true, evidence: { credentialAbsent: true } });
    await provider.close();
    await assert.rejects(provider.acquire(), /closed/);
  } finally {
    await provider.close();
    delete process.env.GOALSPEC_BROWSER_RPC_SECRET_SENTINEL;
    rmSync(directory, { recursive: true, force: true });
  }
});
