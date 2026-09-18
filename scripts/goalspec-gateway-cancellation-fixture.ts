import assert from "node:assert/strict";
import { NativeGateway } from "../services/goalspec-runtime/gateway-client";

async function main() {
const gateway = new NativeGateway(process.env.GOALSPEC_GATEWAY_URL!, process.env.GOALSPEC_GATEWAY_TOKEN!);
const controller = new AbortController();
const pending = gateway.read({ runId: "isolation", tool: "read", arguments: {} }, controller.signal);
// The Python fixture releases this sentinel only after the read physically starts.
await gateway.request("/validate", { runId: "isolation", lease: "wait-until-started", tool: "read", arguments: {} });
controller.abort();
await assert.rejects(pending);
const result = await gateway.request<{ done: boolean }>("/validate", { runId: "isolation", lease: "assert-finished", tool: "read", arguments: {} });
assert.equal(result.done, true);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
