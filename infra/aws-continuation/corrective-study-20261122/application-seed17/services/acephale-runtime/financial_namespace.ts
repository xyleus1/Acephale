import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
import { hash } from "../../src/lib/acephale/canonical";

/** Financial identities only. Scientific run IDs, settings, order and ledger policy stay unchanged. */
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const need = (ok: unknown, message: string) => { if (!ok) throw Error(message); };
function readRef(ref: any): any {
  need(ref && typeof ref.path === "string" && isAbsolute(ref.path) && /^[a-f0-9]{64}$/.test(ref.sha256), "Exact financial evidence FileRef required");
  const bytes = readFileSync(ref.path);
  need(digest(bytes) === ref.sha256 && (ref.bytes === undefined || ref.bytes === bytes.length), "Financial evidence bytes changed");
  return JSON.parse(bytes.toString());
}
let memo: {key: string; value: any} | undefined;
function context(): any | undefined {
  const path = process.env.ACEPHALE_CORRECTIVE_FINANCIAL_LINEAGE;
  if (!path) {
    need(!process.env.ACEPHALE_CORRECTIVE_FINANCIAL_LINEAGE_SHA256, "Financial lineage path absent");
    return undefined;
  }
  const sha256 = process.env.ACEPHALE_CORRECTIVE_FINANCIAL_LINEAGE_SHA256;
  const key = path + ":" + sha256;
  if (memo?.key === key) return memo.value;
  const d = readRef({path, sha256});
  need(d.kind === "acephale-corrective-native-financial-lineage-v1" && d.generation === "20261122-01"
    && ["development", "heldout"].includes(d.stage), "Corrective financial namespace scope mismatch");
  const plan = readRef(d.plan), reference = readRef(d.referencePlan);
  const original = reference.plan ?? reference;
  need(plan.stage === d.stage && plan.version === 1 && original.stage === d.stage
    && hash(plan.originalRuns) === hash(original.originalRuns)
    && hash(plan.runs) === hash(original.runs) && hash(plan.segments) === hash(original.segments)
    && plan.originalScheduleHash === original.originalScheduleHash
    && hash(plan.hosted) === hash(original.hosted), "Corrective financial plan changed scientific slots, order or caps");
  const n = d.stage === "development" ? 18 : 48;
  need(plan.segments.length === 2 && plan.segments.every((ids: any) => Array.isArray(ids) && ids.length === n)
    && plan.runs.length === n * 2 && new Set(plan.runs.map((r: any) => r.runId)).size === n * 2
    && hash(plan.segments.flat()) === hash(plan.runs.map((r: any) => r.runId)), "Exact original whole segments required");
  const expected = d.stage === "development"
    ? ["corrective-development-1-20261122-01:segment-1", "corrective-development-2-20261122-01:segment-2"]
    : ["corrective-heldout-1-20261122-01:segment-1", "corrective-heldout-2-20261122-01:segment-2"];
  need(hash(d.participants) === hash(expected), "Corrective participants changed");
  const checkpoint = readRef(d.predecessorCheckpoint);
  need(checkpoint.version === 1 && Array.isArray(checkpoint.entries)
    && checkpoint.entriesHash === hash(checkpoint.entries), "Original exported ledger checkpoint required");
  need(Array.isArray(d.closedCohortReceipts) && d.closedCohortReceipts.length > 0, "Closed predecessor cohorts required");
  const represented: string[] = [];
  for (const ref of d.closedCohortReceipts) {
    const receipt = readRef(ref);
    need(receipt.version === 1 && receipt.stage === d.stage && receipt.closed === true
      && receipt.allDeclaredSlotsRetained === true && Number.isInteger(receipt.serviceExitCode), "Predecessor cohort is not physically closed");
    const files = receipt.files.filter((r: any) => r.path === "configuration.json");
    need(files.length === 1, "Exact predecessor configuration binding required");
    const config = readRef({path: resolve(dirname(ref.path), "configuration.json"), sha256: files[0].sha256});
    need(hash(config) === receipt.configurationHash && Array.isArray(config.runs), "Predecessor configuration identity mismatch");
    represented.push(...config.runs.map((r: any) => r.runId));
  }
  const ids = plan.runs.map((r: any) => r.runId);
  need(represented.length === ids.length && new Set(represented).size === ids.length
    && hash([...represented].sort()) === hash([...ids].sort()), "Closed predecessor coverage missing, duplicated or extraneous");
  const value = {...d, planValue: plan, snapshot: checkpoint.entries, ledgerPathHash: checkpoint.ledgerPathHash, documentSha256: sha256};
  memo = {key, value}; return value;
}
function parent(d: any, runId: string): string {
  need(d.planValue.runs.some((r: any) => r.runId === runId), "Run outside corrective financial lineage");
  return `infra-corrective:${d.generation}:${runId}`;
}
function unchangedOrOriginallySettled(before: any[], now: any[]): boolean {
  if (before.length !== now.length) return false;
  return before.every((old, i) => {
    const current = now[i];
    if (!current) return false;
    const {actual: oa, ...ob} = old, {actual: ca, ...cb} = current;
    return hash(ob) === hash(cb) && (oa !== undefined ? ca === oa :
      ca === undefined || Number.isSafeInteger(ca) && ca >= 0 && ca <= current.maximum);
  });
}
function predecessors(d: any, ledger: any) {
  const now = ledger.snapshot(), before = d.snapshot;
  for (const run of d.planValue.runs) {
    const match = (r: any) => !r.parentId && (r.id === `infra:${run.runId}`
      || r.id.startsWith("infra-opcont:") && r.id.endsWith(":" + run.runId));
    const priorParents = before.filter(match), currentParents = now.filter(match);
    need(priorParents.length > 0 && unchangedOrOriginallySettled(priorParents, currentParents), "Original financial parents absent or changed");
    for (const prior of priorParents) {
      need(prior.allocation === d.stage && prior.maximum === d.planValue.hosted.maxCostMicrodollarsPerRun,
        "Original predecessor cap or allocation changed");
      const oldChildren = before.filter((r: any) => r.parentId === prior.id);
      const currentChildren = now.filter((r: any) => r.parentId === prior.id);
      need(unchangedOrOriginallySettled(oldChildren, currentChildren), "Original provider charges or unknown holds changed");
    }
  }
}
export function correctiveParentId(runId: string): string {
  const d = context(); return d ? parent(d, runId) : `infra:${runId}`;
}
export function correctiveClaimId(runId: string): string {
  const d = context(); if (!d) return `infra-claim:${runId}`;
  parent(d, runId); return `infra-claim-corrective:${d.generation}:${runId}`;
}
export function correctiveCohortId(plan: any): string {
  const d = context(); if (!d) return `infra-cohort:${hash(plan)}`;
  need(hash(plan) === hash(d.planValue), "Corrective cohort differs from pinned plan");
  return `infra-cohort-corrective:${d.generation}:${hash(plan)}`;
}
export function validateCorrectiveCohort(plan: any, ledger: any, ledgerPath: string, reserve: boolean) {
  const d = context(); if (!d) return;
  need(hash(plan) === hash(d.planValue) && hash(ledgerPath) === d.ledgerPathHash, "Corrective plan or journal identity mismatch");
  predecessors(d, ledger);
  if (reserve) {
    const ids = new Set(ledger.snapshot().map((r: any) => r.id));
    need(!ids.has(correctiveCohortId(plan)) && plan.runs.every((r: any) =>
      !ids.has(parent(d,r.runId)) && !ids.has(correctiveClaimId(r.runId))
      && !ledger.snapshot().some((x: any) => x.parentId === parent(d,r.runId))), "Corrective cohort already reserved or consumed");
  }
}
export function validateCorrectiveParticipant(runIds: string[], plan: any) {
  const d = context(); if (!d) return;
  need(hash(plan) === hash(d.planValue), "Corrective participant plan mismatch");
  const index = plan.segments.findIndex((ids: string[]) => hash(ids) === hash(runIds));
  need(index >= 0 && process.env.ACEPHALE_BUDGET_RPC_PARTICIPANT === d.participants[index], "Corrective participant or original segment order mismatch");
}
export function requireCorrectiveCohort(reservedCohort: unknown) {
  if (context()) need(reservedCohort, "Corrective execution requires the whole reserved cohort");
}

export function correctiveFinancialEnabled(): boolean { return context() !== undefined; }
