import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../services/goalspec-runtime/artifacts";
import { researchProvider, maximumCost } from "../services/goalspec-runtime/provider";
import { RESEARCH_MODELS } from "../src/lib/goalspec/model";

async function main() {
  const directory = resolve(process.argv[2]);
  mkdirSync(directory, { recursive: true });
  const budget = new DurableBudget(join(directory, "budget.jsonl"));
  const events = new ImmutableEventLog(join(directory, "provider-smoke-events.jsonl"));
  try {
    const provider = researchProvider(budget.ledger, "preparation", e => events.append(e));
    const results = [];
    for (const model of [RESEARCH_MODELS.actor, RESEARCH_MODELS.user]) {
      const result = await provider.model.complete({ id: `smoke:${model}`, model, instructions: "Reply with OK only.",
        input: [{ role: "user", content: "Protocol access check." }], maxOutputTokens: model === RESEARCH_MODELS.actor ? 4096 : 1024,
        ...(model === RESEARCH_MODELS.actor ? { reasoning: "medium" as const } : {}), allocation: "preparation",
        maximumAttemptMicrodollars: maximumCost(model, 512, model === RESEARCH_MODELS.actor ? 4096 : 1024), retries: 0 });
      results.push({ model: result.model, completed: result.status === "completed", reply: result.text });
    }
    const vector = await provider.embed("Protocol access check.");
    const report = { models: results, embeddingDimensions: vector.length, costMicrodollars: budget.ledger.snapshot().reduce((s, r) => s + (r.actual ?? r.maximum), 0) };
    writeFileSync(join(directory, "provider-smoke.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(report));
  } finally { events.close(); budget.close(); }
}
main().catch(error => { console.error(JSON.stringify({ failed: true, type: error?.constructor?.name ?? "Error", status: error?.status ?? null })); process.exitCode = 1; });
