import { hash } from "../../src/lib/acephale/canonical";
import type { BudgetLedger } from "../../src/lib/acephale/budget";
import type { InfraExperimentManifestV2 } from "../../src/lib/acephale/infra-manifest";
import { validateInfraHosted, type InfraHostedConfiguration } from "./infra-hosted-workers";

export interface CohortRun {
  runId: string; taskId: string; familyId: string; domain: string; arm: string;
  seed: number; maxBoundaries: number; tools: unknown[];
}
export interface NativeCohortPlan {
  version: 1; stage: "development" | "heldout"; scopeHash: string;
  originalScheduleHash: string; originalRuns: CohortRun[]; runs: CohortRun[]; segments: string[][];
  hosted: InfraHostedConfiguration;
}
export interface NativeCohortReservation {
  kind: "acephale-native-cohort-reservation-v1"; plan: NativeCohortPlan;
  ledgerPathHash: string; beforeEntriesHash: string; reservedEntriesHash: string;
  contentHash: string;
}
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const parentId = (runId: string) => `infra:${runId}`;
const claimId = (runId: string) => `infra-claim:${runId}`;

/** Identities common to all weight segments. Weight-specific artifacts remain
 * independently validated by the ordinary native configuration validator. */
export function nativeCohortScope(manifest: InfraExperimentManifestV2, taskBundleHash: string) {
  const { calibrationHash: _calibration, ...data } = manifest.data;
  const { scheduleHash: _schedule, ...protocol } = manifest.protocol;
  void _calibration; void _schedule;
  return hash({ sourceCommit: manifest.sourceCommit, actor: manifest.actor, data, protocol,
    taskBundleHash, runtime: manifest.runtime, hardware: manifest.hardware });
}

export function validateNativeCohortPlan(plan: NativeCohortPlan) {
  if (plan?.version !== 1 || !["development", "heldout"].includes(plan.stage)
    || !digest(plan.scopeHash) || !digest(plan.originalScheduleHash)
    || !Array.isArray(plan.runs) || !plan.runs.length || !Array.isArray(plan.segments) || !plan.segments.length) {
    throw new Error("Invalid native cohort reservation plan");
  }
  validateInfraHosted(plan.hosted, plan.stage);
  if (!Array.isArray(plan.originalRuns) || hash(plan.originalRuns) !== plan.originalScheduleHash
    || hash(plan.originalRuns.map(run => hash(run)).sort()) !== hash(plan.runs.map(run => hash(run)).sort())) {
    throw new Error("Serving order changed the original cohort slots");
  }
  const ids = new Set<string>(), blocks = new Map<string, CohortRun[]>();
  for (const run of plan.runs) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(run.runId) || ids.has(run.runId)
      || !run.taskId || !run.familyId || !["retail", "airline"].includes(run.domain)
      || !["base", "neutral_memory_prefetch", "acephale"].includes(run.arm)
      || !Number.isSafeInteger(run.seed) || !Number.isSafeInteger(run.maxBoundaries)
      || run.maxBoundaries < plan.hosted.maxSteps || !Array.isArray(run.tools) || !run.tools.length) {
      throw new Error("Invalid or duplicated native cohort run");
    }
    ids.add(run.runId);
    const key = hash([run.familyId, run.taskId, run.domain, run.seed]);
    blocks.set(key, [...(blocks.get(key) ?? []), run]);
  }
  if ([...blocks.values()].some(block => block.length !== 3 || new Set(block.map(run => run.arm)).size !== 3
    || new Set(block.map(run => run.maxBoundaries)).size !== 1)) throw new Error("Cohort requires complete three-arm blocks");
  const orderedBlocks = (runs: CohortRun[]) => {
    const result = new Map<string, string[]>();
    let previous: string | undefined;
    for (const run of runs) {
      const key = hash([run.familyId, run.taskId, run.domain, run.seed]);
      if (key !== previous && result.has(key)) throw new Error("Paired cohort blocks must stay contiguous");
      result.set(key, [...(result.get(key) ?? []), run.runId]); previous = key;
    }
    return result;
  };
  const originalBlocks = orderedBlocks(plan.originalRuns), executionBlocks = orderedBlocks(plan.runs);
  if ([...originalBlocks].some(([key, ids]) => hash(ids) !== hash(executionBlocks.get(key)))) {
    throw new Error("Original randomized within-block arm order changed");
  }
  const flattened = plan.segments.flat();
  if (plan.segments.some(segment => !Array.isArray(segment) || !segment.length)
    || hash(flattened) !== hash(plan.runs.map(run => run.runId))) throw new Error("Segments must partition the complete ordered cohort");
  for (const block of blocks.values()) if (!plan.segments.some(segment => block.every(run => segment.includes(run.runId)))) {
    throw new Error("A serving segment cannot split a paired block");
  }
  return plan;
}

export function validateNativeCohortReservation(receipt: NativeCohortReservation) {
  if (!receipt || receipt.kind !== "acephale-native-cohort-reservation-v1") throw new Error("Invalid cohort reservation receipt");
  const { contentHash, ...body } = receipt;
  if (!digest(contentHash) || hash(body) !== contentHash || !digest(receipt.ledgerPathHash)
    || !digest(receipt.beforeEntriesHash) || !digest(receipt.reservedEntriesHash)) throw new Error("Cohort reservation receipt hash mismatch");
  validateNativeCohortPlan(receipt.plan);
  return receipt;
}

/** One durable write reserves every original arm/trial before any segment can run.
 * The one-level ledger hierarchy stays unchanged: each trial owns API children. */
export function reserveNativeCohort(plan: NativeCohortPlan, ledger: BudgetLedger, ledgerPath: string): NativeCohortReservation {
  validateNativeCohortPlan(plan);
  const beforeEntriesHash = hash(ledger.snapshot());
  ledger.reserveMany([{ id: `infra-cohort:${hash(plan)}`, allocation: plan.hosted.allocation, maximum: 0 },
    ...plan.runs.map(run => ({ id: parentId(run.runId), allocation: plan.hosted.allocation,
      maximum: plan.hosted.maxCostMicrodollarsPerRun }))]);
  const body = { kind: "acephale-native-cohort-reservation-v1" as const, plan, ledgerPathHash: hash(ledgerPath),
    beforeEntriesHash, reservedEntriesHash: hash(ledger.snapshot()) };
  return { ...body, contentHash: hash(body) };
}

export function validateNativeCohortSegment(receipt: NativeCohortReservation, input: {
  stage: string; scopeHash: string; runs: CohortRun[]; hosted: InfraHostedConfiguration;
}) {
  const { plan } = validateNativeCohortReservation(receipt);
  const ids = input.runs.map(run => run.runId);
  const segment = plan.segments.findIndex(value => hash(value) === hash(ids));
  if (segment < 0 || input.stage !== plan.stage || input.scopeHash !== plan.scopeHash || hash(input.hosted) !== hash(plan.hosted)
    || hash(input.runs) !== hash(plan.runs.filter(run => ids.includes(run.runId)))) {
    throw new Error("Native serving segment differs from the fully reserved cohort");
  }
  return segment;
}

/** Zero-cost durable markers claim the whole segment atomically. A failed or
 * interrupted segment is never eligible for replacement; unclaimed trial holds
 * remain reserved. Prior markers permit the next declared segment, not a retry. */
export function claimNativeCohortSegment(receipt: NativeCohortReservation, runIds: string[], ledger: BudgetLedger, ledgerPath: string) {
  const { plan } = validateNativeCohortReservation(receipt);
  const segment = plan.segments.findIndex(ids => hash(ids) === hash(runIds));
  if (segment < 0 || receipt.ledgerPathHash !== hash(ledgerPath)) throw new Error("Cohort claim identity mismatch");
  const snapshot = ledger.snapshot(), entries = new Map(snapshot.map(entry => [entry.id, entry]));
  const cohort = entries.get(`infra-cohort:${hash(plan)}`);
  if (!cohort || cohort.parentId || cohort.maximum !== 0 || cohort.allocation !== plan.hosted.allocation) {
    throw new Error("Whole cohort declaration is not reserved in the original journal");
  }
  for (const run of plan.runs) {
    const entry = entries.get(parentId(run.runId));
    if (!entry || entry.parentId || entry.allocation !== plan.hosted.allocation || entry.maximum !== plan.hosted.maxCostMicrodollarsPerRun) {
      throw new Error("Original cohort reservation is missing or changed");
    }
  }
  for (const id of plan.segments.slice(0, segment).flat()) {
    const marker = entries.get(claimId(id));
    if (!marker || marker.parentId || marker.maximum !== 0 || marker.allocation !== plan.hosted.allocation) {
      throw new Error("Earlier cohort segment has not been claimed");
    }
  }
  for (const id of runIds) if (entries.has(claimId(id)) || entries.get(parentId(id))!.actual !== undefined
    || snapshot.some(entry => entry.parentId === parentId(id))) throw new Error("Native trial was already claimed or consumed");
  ledger.reserveMany(runIds.map(id => ({ id: claimId(id), allocation: plan.hosted.allocation, maximum: 0 })));
}
