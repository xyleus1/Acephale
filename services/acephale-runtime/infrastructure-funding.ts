import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import approved from "../../src/lib/acephale/contracts/infrastructure-funding-v1.json";
import { type Reservation } from "../../src/lib/acephale/budget";
import { hash } from "../../src/lib/acephale/canonical";
import { type BudgetAmendment, budgetPolicyPath } from "./budget-policy";

export const INFRASTRUCTURE_FUNDING_V1 = approved;
export const infrastructureFundingPath = (journal: string) => `${resolve(journal)}.infrastructure-funding-v1.json`;
export type FundingRow = Record<string, unknown>;
export interface InfrastructureFunding {
  version: 1; profile: "acephale-infrastructure-funding-v1";
  policy: typeof approved; policyHash: string; contentHash: string;
  baseBudgetPolicyHash: string; baseBudgetAmendmentHash: string; baseBudgetAmendmentSha256: string;
  studyLedgerPathHash: string; infrastructureLedgerPathHash: string;
  infrastructureBindingHash: string; infrastructurePlanHash: string;
  baselineEntries: (Reservation & { id: string })[];
  baselineLeases: FundingRow[]; baselineOverheads: FundingRow[]; baselineTrainingWindows: FundingRow[];
  authorizedAt: string; authorizationSource: "explicit_user_instruction"; authorizationReason: string; sourceCommit: string;
  basePolicyBytesChanged: false; effectiveFinancialCeilingsChanged: true;
  existingReservationsChanged: false; modelContractsChanged: false;
}

export function checkedFundingFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error("Invalid infrastructure funding file");
  return readFileSync(path);
}

export function readInfrastructureFunding(journal: string, entries: [string, Reservation][], base?: BudgetAmendment): InfrastructureFunding | undefined {
  const path = infrastructureFundingPath(journal);
  if (!existsSync(path)) return;
  return validateInfrastructureFunding(JSON.parse(checkedFundingFile(path).toString("utf8")), journal, entries, base);
}

export function validateInfrastructureFunding(value: InfrastructureFunding, journal: string,
  entries: [string, Reservation][], base?: BudgetAmendment): InfrastructureFunding {
  const { contentHash, ...body } = value;
  const date = Date.parse(value.authorizedAt), digest = /^[a-f0-9]{64}$/;
  if (base?.version !== 3 || value.version !== 1 || value.profile !== "acephale-infrastructure-funding-v1"
    || contentHash !== hash(body) || value.policyHash !== hash(approved) || hash(value.policy) !== hash(approved)
    || value.baseBudgetPolicyHash !== base.policyHash || value.baseBudgetAmendmentHash !== base.contentHash
    || value.baseBudgetAmendmentSha256 !== createHash("sha256").update(checkedFundingFile(budgetPolicyPath(journal, 3))).digest("hex")
    || value.studyLedgerPathHash !== hash(resolve(journal)) || !digest.test(value.infrastructureLedgerPathHash)
    || value.infrastructureBindingHash !== base.infrastructureBindingHash || value.infrastructurePlanHash !== base.infrastructurePlanHash
    || !Number.isFinite(date) || date < Date.parse(base.authorizedAt) || value.authorizationSource !== "explicit_user_instruction"
    || typeof value.authorizationReason !== "string" || !value.authorizationReason.trim() || value.authorizationReason.length > 1024
    || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || value.basePolicyBytesChanged !== false
    || value.effectiveFinancialCeilingsChanged !== true || value.existingReservationsChanged !== false || value.modelContractsChanged !== false
    || !Array.isArray(value.baselineEntries) || !value.baselineEntries.length
    || !Array.isArray(value.baselineLeases) || !Array.isArray(value.baselineOverheads) || !Array.isArray(value.baselineTrainingWindows)) {
    throw new Error("Infrastructure funding must bind the unchanged base policy and original study");
  }
  const current = new Map(entries), seen = new Set<string>();
  for (const prior of value.baselineEntries) {
    const row = current.get(prior.id);
    if (seen.has(prior.id) || !row || row.allocation !== prior.allocation || row.maximum !== prior.maximum
      || row.parentId !== prior.parentId || (prior.actual !== undefined && row.actual !== prior.actual)) throw new Error("Infrastructure funding retained journal history changed");
    seen.add(prior.id);
  }
  return value;
}

/** A frozen consumer still dispatches under v3, including its $935 non-contingency limit. */
export function frozenApiProjection(entries: (Reservation & { id: string })[], additionalInfrastructure: number,
  base: BudgetAmendment, funding: InfrastructureFunding) {
  if (!Number.isSafeInteger(additionalInfrastructure) || additionalInfrastructure < 0) throw new Error("Invalid infrastructure projection");
  const roots = entries.filter(row => !row.parentId);
  if (entries.some(row => row.actual !== undefined && row.actual > row.maximum)) throw new Error("Funding halted after a recorded overrun");
  const committed = roots.reduce((sum, row) => sum + (row.actual ?? row.maximum), 0);
  const nonContingency = roots.filter(row => row.allocation !== "contingency").reduce((sum, row) => sum + (row.actual ?? row.maximum), 0);
  const headroom = funding.policy.frozenApiHeadroomMicrodollars;
  for (const [allocation, planned] of Object.entries(funding.policy.frozenApiPlanMicrodollars)) {
    const used = roots.filter(row => row.allocation === allocation).reduce((sum, row) => sum + (row.actual ?? row.maximum), 0);
    if (used + planned > base.policy.allocationsMicrodollars[allocation as keyof typeof funding.policy.frozenApiPlanMicrodollars]) {
      throw new Error("Frozen API projection exceeds its unchanged allocation");
    }
  }
  const projected = nonContingency + additionalInfrastructure + headroom;
  const ceiling = base.policy.totalMicrodollars - base.policy.allocationsMicrodollars.contingency;
  if (projected > ceiling || committed + additionalInfrastructure + headroom > base.policy.totalMicrodollars) {
    throw new Error("Infrastructure reservation would exhaust protected frozen API headroom");
  }
  return { frozenApiHeadroomMicrodollars: headroom, frozenProjectedNonContingencyMicrodollars: projected,
    frozenNonContingencyCeilingMicrodollars: ceiling, frozenTotalCeilingMicrodollars: base.policy.totalMicrodollars,
    frozenApiPlanHash: hash(funding.policy.frozenApiPlanMicrodollars) };
}
