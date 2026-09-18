// Deterministic test worker. No provider, credentials, models or shared ledger.
import { readFileSync } from "node:fs";
import { hash } from "../../src/lib/goalspec/canonical";
import { NativeGateway } from "../../services/goalspec-runtime/gateway-client";

async function main() {
  const manifest = JSON.parse(readFileSync(process.env.GOALSPEC_MANIFEST_PATH!, "utf8"));
  const scripts = JSON.parse(readFileSync(process.env.GOALSPEC_OFFLINE_SCRIPTS!, "utf8"));
  const gateway = new NativeGateway(process.env.GOALSPEC_GATEWAY_URL!, process.env.GOALSPEC_GATEWAY_TOKEN!);
  const counters = new Map<string, number>(), closed = new Set<string>();
  const rows = new Map<string, any>(manifest.runs.map((run: any, index: number) => [run.runId, scripts[index]]));
  await gateway.request("/ready", { manifestHash: hash(manifest) });
  while (closed.size < manifest.runs.length * 2) {
    const next: any = await gateway.request("/next", {});
    if (!next) continue;
    const { runId, boundaryId } = next;
    if (next.operation === "close") {
      closed.add(runId); await gateway.request("/respond", { runId, boundaryId, response: { closed: true } }); continue;
    }
    const index = counters.get(runId) ?? 0; counters.set(runId, index + 1);
    const user = runId.endsWith(":user"), script = rows.get(user ? runId.slice(0, -5) : runId);
    if (!script) throw new Error("Undeclared offline worker");
    let response: any;
    if (user) response = { role: "user", content: index === 0 ? script.request : index === 1 ? "Yes, please proceed." : "Thank you. ###STOP###" };
    else if (script.fail) response = { _goalspecError: { type: "BudgetExhausted" } };
    else if (index === 0) {
      const read = await gateway.read<{ lease: string }>({ runId, tool: "get_user_details", arguments: { user_id: script.userId } }, new AbortController().signal);
      response = { role: "assistant", content: null, tool_calls: [{ id: "offline-read", name: "get_user_details", arguments: { user_id: script.userId }, requestor: "assistant" }],
        _goalspecPromotions: { "offline-read": read.lease } };
    } else if (index === 1) response = { role: "assistant", content: "Please confirm the exact requested changes and their costs before I proceed." };
    else if (index - 2 < script.actions.length) response = { role: "assistant", content: null,
      tool_calls: [{ id: `offline-write-${index - 2}`, ...script.actions[index - 2], requestor: "assistant" }] };
    else response = { role: "assistant", content: "The requested changes have been completed with the other records unchanged." };
    await gateway.request("/respond", { runId, boundaryId, response });
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Offline worker error"); process.exitCode = 1; });
