import { lstatSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { ALLOCATIONS } from "../src/lib/acephale/budget";
import { PRICE_SOURCE } from "../services/acephale-runtime/provider";

export function budgetReport(directory: string, destination: string) {
const ledgerPath = join(resolve(directory), "budget.jsonl"), metadata = lstatSync(ledgerPath);
if (!metadata.isFile() || metadata.isSymbolicLink() || !metadata.size) throw new Error("Existing nonempty original budget journal required");
const budget = new DurableBudget(ledgerPath);
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
    basis: "Recorded settled costs and unresolved reservations in the original study journal; not independently reconciled to invoices",
    totalCeilingUsd: 500, allocations,
    infrastructureKnownCostUsd: allocations.find(row => row.allocation === "infrastructure")!.knownUsageCostUsd,
    infrastructureSpentOrReservedUsd: allocations.find(row => row.allocation === "infrastructure")!.spentOrReservedUsd,
    totalKnownUsageCostUsd: allocations.reduce((sum, row) => sum + row.knownUsageCostUsd, 0),
    totalSpentOrReservedUsd: allocations.reduce((sum, row) => sum + row.spentOrReservedUsd, 0),
    unresolvedRequests: allocations.reduce((sum, row) => sum + row.unresolvedRequests, 0) };
  writeFileSync(resolve(destination), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  return result;
} finally { budget.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, destination] = process.argv.slice(2);
  if (!directory || !destination) throw new Error("Usage: acephale-budget-report BUDGET_DIRECTORY NEW_OUTPUT_JSON");
  process.stdout.write(JSON.stringify(budgetReport(directory, destination)) + "\n");
}
