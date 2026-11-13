import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import approvedPolicy from "../../src/lib/acephale/contracts/budget-policy-v2.json";
import { type Reservation } from "../../src/lib/acephale/budget";
import { hash } from "../../src/lib/acephale/canonical";

export const BUDGET_POLICY_V2 = approvedPolicy;
export type BudgetAmendment = {
  version: 2; profile: "acephale-budget-amendment-v2";
  policy: typeof approvedPolicy; policyHash: string; studyLedgerPathHash: string;
  infrastructureBindingHash: string; infrastructurePlanHash: string;
  baselineEntries: (Reservation & { id: string })[];
  baselineLeases: unknown[]; baselineOverheads: unknown[]; baselineTrainingWindows: unknown[];
  authorizedAt: string; contentHash: string;
};
export const budgetPolicyPath = (ledgerPath: string) => `${resolve(ledgerPath)}.policy-v2.json`;

/** The sidecar changes future ceilings, never the original journal or slice. */
export function readBudgetPolicy(ledgerPath: string, entries: [string, Reservation][]): BudgetAmendment | undefined {
  const path = budgetPolicyPath(ledgerPath);
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error("Invalid budget amendment file");
  const amendment = JSON.parse(readFileSync(path, "utf8")) as BudgetAmendment;
  const { contentHash, ...body } = amendment;
  if (amendment.version !== 2 || amendment.profile !== "acephale-budget-amendment-v2"
    || contentHash !== hash(body) || amendment.policyHash !== hash(approvedPolicy) || hash(amendment.policy) !== hash(approvedPolicy)
    || amendment.studyLedgerPathHash !== hash(resolve(ledgerPath))
    || !/^[a-f0-9]{64}$/.test(amendment.infrastructureBindingHash) || !/^[a-f0-9]{64}$/.test(amendment.infrastructurePlanHash)
    || !Number.isFinite(Date.parse(amendment.authorizedAt)) || !Array.isArray(amendment.baselineEntries) || !amendment.baselineEntries.length
    || !Array.isArray(amendment.baselineLeases) || !Array.isArray(amendment.baselineOverheads) || !Array.isArray(amendment.baselineTrainingWindows)) {
    throw new Error("Invalid approved budget amendment");
  }
  const current = new Map(entries), seen = new Set<string>();
  for (const prior of amendment.baselineEntries) {
    const row = current.get(prior.id);
    if (seen.has(prior.id) || !row || row.allocation !== prior.allocation || row.maximum !== prior.maximum
      || row.parentId !== prior.parentId || (prior.actual !== undefined && row.actual !== prior.actual)) {
      throw new Error("Budget amendment history changed or disappeared");
    }
    seen.add(prior.id);
  }
  return amendment;
}
