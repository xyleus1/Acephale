import { writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { ALLOCATIONS } from "../src/lib/goalspec/budget";
import { PRICE_SOURCE } from "../services/goalspec-runtime/provider";

const [directory, destination] = process.argv.slice(2);
if (!directory || !destination) throw new Error("Usage: goalspec-budget-report BUDGET_DIRECTORY NEW_OUTPUT_JSON");
const budget = new DurableBudget(join(resolve(directory), "budget.jsonl"));
try {
  const rows = budget.ledger.snapshot();
  const parents = new Set(rows.filter(row => row.parentId).map(row => row.parentId));
  const allocations = Object.entries(ALLOCATIONS).map(([allocation, ceiling]) => {
    const entries = rows.filter(row => row.allocation === allocation);
    const requests = entries.filter(row => !parents.has(row.id));
    return { allocation, ceilingUsd: ceiling / 1_000_000,
      knownUsageCostUsd: requests.reduce((sum, row) => sum + (row.actual ?? 0), 0) / 1_000_000,
      spentOrReservedUsd: entries.filter(row => !row.parentId).reduce((sum, row) => sum + (row.actual ?? row.maximum), 0) / 1_000_000,
      unresolvedRequests: requests.filter(row => row.actual === undefined).length };
  });
  const result = { schemaVersion: 1, currency: "USD", priceSource: PRICE_SOURCE,
    basis: "Provider-reported token usage at pinned standard prices; not reconciled to an invoice",
    totalCeilingUsd: 500, awsChargesUsd: 0, allocations,
    totalKnownUsageCostUsd: allocations.reduce((sum, row) => sum + row.knownUsageCostUsd, 0),
    totalSpentOrReservedUsd: allocations.reduce((sum, row) => sum + row.spentOrReservedUsd, 0),
    unresolvedRequests: allocations.reduce((sum, row) => sum + row.unresolvedRequests, 0) };
  writeFileSync(resolve(destination), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(result) + "\n");
} finally { budget.close(); }
