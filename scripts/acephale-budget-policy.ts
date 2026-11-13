import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { BUDGET_POLICY_V2, budgetPolicyPath, type BudgetAmendment } from "../services/acephale-runtime/budget-policy";
import { BudgetLedger, type Allocation } from "../src/lib/acephale/budget";
import { canonical, hash } from "../src/lib/acephale/canonical";

export function amendBudgetPolicy(ledgerPath: string, slicePath: string, authorizedAt: string): BudgetAmendment {
  if (!Number.isFinite(Date.parse(authorizedAt))) throw new Error("Explicit authorization timestamp required");
  const path = resolve(ledgerPath), sliceLockPath = `${resolve(slicePath)}.lock`;
  for (const existing of [path, resolve(slicePath)]) {
    const stat = lstatSync(existing);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error("Existing nonempty original study files required");
  }
  const sliceLock = openSync(sliceLockPath, "wx", 0o600);
  let owner: DurableBudget | undefined;
  try {
    writeFileSync(sliceLock, String(process.pid)); fsyncSync(sliceLock);
    owner = new DurableBudget(path);
    const slice = JSON.parse(readFileSync(resolve(slicePath), "utf8")) as Record<string, unknown>;
    const plan = slice.plan as Record<string, unknown> | undefined;
    const leases = slice.leases as { status: string; reservedHours: number }[];
    const overheads = (slice.overheads ?? []) as unknown[];
    const windows = (slice.trainingWindows ?? []) as { reservedSeconds: number }[];
    if (owner.policy || slice.schemaVersion !== 2 || slice.provider !== "lambda" || !plan
      || plan.studyLedgerPath !== path || resolve(String(plan.infrastructureLedgerPath)) !== resolve(slicePath)
      || slice.planHash !== hash(plan) || !Array.isArray(leases) || leases.some(row => row.status !== "terminated")
      || !Array.isArray(overheads) || !Array.isArray(windows)
      || Number(slice.priorGpuHours) + leases.reduce((sum, row) => sum + row.reservedHours, 0) > BUDGET_POLICY_V2.maxGpuHours
      || windows.reduce((sum, row) => sum + row.reservedSeconds, 0) > BUDGET_POLICY_V2.priorTrainingSeconds) {
      throw new Error("Closed original infrastructure slice required for amendment");
    }
    const entries = owner.ledger.snapshot();
    if (!entries.length) throw new Error("Existing study history required");
    const recovered = new BudgetLedger(undefined, entries.map(({ id, ...entry }) => [id, entry]), BUDGET_POLICY_V2.allocationsMicrodollars);
    for (const allocation of Object.keys(BUDGET_POLICY_V2.allocationsMicrodollars) as Allocation[]) {
      recovered.reserve(`policy-check:${allocation}`, allocation, 0);
    }
    const financial = Object.fromEntries(Object.entries(slice).filter(([key]) => !["leases", "overheads", "trainingWindows"].includes(key)));
    const body = { version: 2 as const, profile: "acephale-budget-amendment-v2" as const,
      policy: BUDGET_POLICY_V2, policyHash: hash(BUDGET_POLICY_V2), studyLedgerPathHash: hash(path),
      infrastructureBindingHash: hash(financial), infrastructurePlanHash: hash(plan), baselineEntries: entries,
      baselineLeases: leases, baselineOverheads: overheads, baselineTrainingWindows: windows, authorizedAt };
    const result = { ...body, contentHash: hash(body) };
    const descriptor = openSync(budgetPolicyPath(path), "wx", 0o600);
    try { writeFileSync(descriptor, canonical(result) + "\n"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    return result;
  } finally {
    try { owner?.close(); } finally { closeSync(sliceLock); unlinkSync(sliceLockPath); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const request = JSON.parse(readFileSync(process.argv[2], "utf8")) as { ledgerPath: string; slicePath: string; authorizedAt: string };
  const result = amendBudgetPolicy(request.ledgerPath, request.slicePath, request.authorizedAt);
  console.log(JSON.stringify({ version: result.version, contentHash: result.contentHash, policyHash: result.policyHash }));
}
