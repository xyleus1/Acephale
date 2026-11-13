import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { BUDGET_POLICY_V2, BUDGET_POLICY_V3, budgetPolicyPath, type BudgetAmendment } from "../services/acephale-runtime/budget-policy";
import { BudgetLedger, type Allocation } from "../src/lib/acephale/budget";
import { canonical, hash } from "../src/lib/acephale/canonical";

export function amendBudgetPolicy(ledgerPath: string, slicePath: string, authorizedAt: string, version: 2 | 3 = 2): BudgetAmendment {
  if (version !== 2 && version !== 3) throw new Error("Unknown budget amendment version");
  const policy = version === 2 ? BUDGET_POLICY_V2 : BUDGET_POLICY_V3;
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
    const windows = (slice.trainingWindows ?? []) as { reservedSeconds: number; trainingKind?: string; budgetAmendmentHash?: string }[];
    if ((version === 2 ? !!owner.policy : owner.policy?.version !== 2) || slice.schemaVersion !== 2 || slice.provider !== "lambda" || !plan
      || plan.studyLedgerPath !== path || resolve(String(plan.infrastructureLedgerPath)) !== resolve(slicePath)
      || slice.planHash !== hash(plan) || !Array.isArray(leases) || leases.some(row => row.status !== "terminated")
      || !Array.isArray(overheads) || !Array.isArray(windows)
      || !Number.isFinite(Number(slice.priorGpuHours)) || Number(slice.priorGpuHours) < 0
      || leases.some(row => !Number.isFinite(row.reservedHours) || row.reservedHours < 0)
      || windows.some(row => !Number.isFinite(row.reservedSeconds) || row.reservedSeconds < 0)
      || Number(slice.priorGpuHours) + leases.reduce((sum, row) => sum + row.reservedHours, 0) > policy.maxGpuHours
      || windows.reduce((sum, row) => sum + row.reservedSeconds, 0) > policy.priorTrainingSeconds) {
      throw new Error("Closed original infrastructure slice required for amendment");
    }
    if (version === 3) {
      const parent = owner.policy!;
      for (const [prior, current] of [[parent.baselineLeases, leases], [parent.baselineOverheads, overheads],
        [parent.baselineTrainingWindows, windows]] as const) {
        if (hash(current.slice(0, prior.length)) !== hash(prior)) throw new Error("Parent amendment operational history changed");
      }
      const previousWindows = windows.slice(parent.baselineTrainingWindows.length);
      if (previousWindows.some(row => !["fit", "smoke"].includes(row.trainingKind ?? "")
        || row.budgetAmendmentHash !== parent.contentHash)) throw new Error("Parent training window binding differs");
      for (const [kind, limit] of [["fit", parent.policy.additionalFittingSeconds], ["smoke", parent.policy.additionalSmokeSeconds]] as const) {
        if (previousWindows.filter(row => row.trainingKind === kind).reduce((sum, row) => sum + row.reservedSeconds, 0) > limit) {
          throw new Error("Parent training allowance exceeded");
        }
      }
    }
    const entries = owner.ledger.snapshot();
    if (!entries.length) throw new Error("Existing study history required");
    const recovered = new BudgetLedger(undefined, entries.map(({ id, ...entry }) => [id, entry]), policy.allocationsMicrodollars);
    for (const allocation of Object.keys(policy.allocationsMicrodollars) as Allocation[]) {
      recovered.reserve(`policy-check:${allocation}`, allocation, 0);
    }
    const financial = Object.fromEntries(Object.entries(slice).filter(([key]) => !["leases", "overheads", "trainingWindows"].includes(key)));
    if (version === 3 && (hash(financial) !== owner.policy!.infrastructureBindingHash
      || hash(plan) !== owner.policy!.infrastructurePlanHash)) throw new Error("Parent amendment original financial binding changed");
    if (version === 3 && Date.parse(authorizedAt) < Date.parse(owner.policy!.authorizedAt)) throw new Error("Authorization predates parent amendment");
    const body = { version, profile: `acephale-budget-amendment-v${version}` as BudgetAmendment["profile"],
      ...(version === 3 ? { parentAmendmentHash: owner.policy!.contentHash } : {}),
      policy, policyHash: hash(policy), studyLedgerPathHash: hash(path),
      infrastructureBindingHash: hash(financial), infrastructurePlanHash: hash(plan), baselineEntries: entries,
      baselineLeases: leases, baselineOverheads: overheads, baselineTrainingWindows: windows, authorizedAt };
    const result = { ...body, contentHash: hash(body) };
    const descriptor = openSync(budgetPolicyPath(path, version), "wx", 0o600);
    try { writeFileSync(descriptor, canonical(result) + "\n"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    return result;
  } finally {
    try { owner?.close(); } finally { closeSync(sliceLock); unlinkSync(sliceLockPath); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const request = JSON.parse(readFileSync(process.argv[2], "utf8")) as { ledgerPath: string; slicePath: string; authorizedAt: string; version?: 2 | 3 };
  const result = amendBudgetPolicy(request.ledgerPath, request.slicePath, request.authorizedAt, request.version);
  console.log(JSON.stringify({ version: result.version, contentHash: result.contentHash, policyHash: result.policyHash }));
}
