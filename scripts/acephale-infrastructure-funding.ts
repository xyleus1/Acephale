import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { budgetPolicyPath } from "../services/acephale-runtime/budget-policy";
import { checkedFundingFile, frozenApiProjection, INFRASTRUCTURE_FUNDING_V1, infrastructureFundingPath,
  validateInfrastructureFunding, type FundingRow, type InfrastructureFunding } from "../services/acephale-runtime/infrastructure-funding";
import { canonical, hash } from "../src/lib/acephale/canonical";

const source = () => {
  const options = { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" as const };
  if (execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], options).trim()) throw new Error("Clean committed funding implementation required");
  return execFileSync("git", ["rev-parse", "HEAD"], options).trim();
};

/** Creation-only authority, retaining the sole journal and every unknown hold. */
export function addInfrastructureFunding(journal: string, slicePath: string, authorizedAt: string, reason: string, sourceProbe = source) {
  const path = resolve(journal), slice = resolve(slicePath), lockPath = `${slice}.lock`;
  const journalStat = lstatSync(path);
  if (!journalStat.isFile() || journalStat.isSymbolicLink() || !journalStat.size) throw new Error("Existing nonempty original journal required");
  checkedFundingFile(slice);
  const lock = openSync(lockPath, "wx", 0o600);
  let owner: DurableBudget | undefined;
  try {
    writeFileSync(lock, String(process.pid)); fsyncSync(lock);
    owner = new DurableBudget(path, { recoveryCheckpoint: false });
    const base = owner.policy, value = JSON.parse(readFileSync(slice, "utf8"));
    const plan = value.plan, leases = value.leases as FundingRow[];
    const overheads = (value.overheads ?? []) as FundingRow[], windows = (value.trainingWindows ?? []) as FundingRow[];
    const financial = Object.fromEntries(Object.entries(value).filter(([key]) => !["leases", "overheads", "trainingWindows"].includes(key)));
    if (base?.version !== 3 || value.schemaVersion !== 2 || value.provider !== "lambda" || !plan
      || plan.studyLedgerPath !== path || resolve(plan.infrastructureLedgerPath) !== slice
      || hash(plan) !== base.infrastructurePlanHash || value.planHash !== hash(plan) || hash(financial) !== base.infrastructureBindingHash
      || !Array.isArray(leases) || leases.some(row => row.status !== "terminated" && !(row.status === "launch_unknown" && row.instanceId === null))
      || !Array.isArray(overheads) || !Array.isArray(windows)) throw new Error("Funding requires the original v3 slice with closed or retained unknown work");
    const entries = owner.ledger.snapshot();
    const body = { version: 1 as const, profile: "acephale-infrastructure-funding-v1" as const,
      policy: INFRASTRUCTURE_FUNDING_V1, policyHash: hash(INFRASTRUCTURE_FUNDING_V1), baseBudgetPolicyHash: base.policyHash,
      baseBudgetAmendmentHash: base.contentHash,
      baseBudgetAmendmentSha256: createHash("sha256").update(checkedFundingFile(budgetPolicyPath(path, 3))).digest("hex"),
      studyLedgerPathHash: hash(path), infrastructureLedgerPathHash: hash(slice),
      infrastructureBindingHash: base.infrastructureBindingHash, infrastructurePlanHash: base.infrastructurePlanHash,
      baselineEntries: entries, baselineLeases: leases, baselineOverheads: overheads, baselineTrainingWindows: windows,
      authorizedAt, authorizationSource: "explicit_user_instruction" as const, authorizationReason: reason.trim(), sourceCommit: sourceProbe(),
      basePolicyBytesChanged: false as const, effectiveFinancialCeilingsChanged: true as const,
      existingReservationsChanged: false as const, modelContractsChanged: false as const };
    const result: InfrastructureFunding = { ...body, contentHash: hash(body) };
    validateInfrastructureFunding(result, path, entries.map(({ id, ...row }) => [id, row]), base);
    frozenApiProjection(entries, 0, base, result);
    const descriptor = openSync(infrastructureFundingPath(path), "wx", 0o600);
    try { writeFileSync(descriptor, canonical(result) + "\n"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    if (process.platform !== "win32") {
      const directory = openSync(dirname(path), "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    return result;
  } finally {
    try { owner?.close(); } finally { closeSync(lock); unlinkSync(lockPath); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const request = JSON.parse(readFileSync(process.argv[2], "utf8")) as { ledgerPath: string; slicePath: string; authorizedAt: string; reason: string };
  const result = addInfrastructureFunding(request.ledgerPath, request.slicePath, request.authorizedAt, request.reason);
  console.log(JSON.stringify({ contentHash: result.contentHash, fundingPolicyHash: result.policyHash,
    baseBudgetPolicyHash: result.baseBudgetPolicyHash, effectiveFinancialCeilingsChanged: true }));
}
