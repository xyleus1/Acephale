import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { ALLOCATIONS, type BudgetLedger } from "../src/lib/goalspec/budget";
import { RESEARCH_MODELS, providerFailure, type ModelPort } from "../src/lib/goalspec/model";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../services/goalspec-runtime/artifacts";
import { maximumCost, PRICE_SOURCE, researchProvider, TrialLedger } from "../services/goalspec-runtime/provider";
import { createReplayWriter, loadReplayCohort, replayCodeSources, REPLAY_VERSION, runPredictionReplay, type ReplayCohort } from "./goalspec-prediction-v3";
import { extendedRequestBound, runExtendedPredictionReplay, selectExtendedCohort, MINI_MAXIMUM, TEACHER_MAXIMUM,
  type ReplaySelection } from "./goalspec-prediction-v3-extended";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const SHARED_REPLAY_BUDGET = join(ROOT, "research/goalspec/runs/local-evaluation-20260914/budget.jsonl");
const VERSION = "goalspec-replay-plan-v1";
type InputPaths = Parameters<typeof loadReplayCohort>[0];
export interface ReplayPlan {
  version: typeof VERSION; replayVersion: typeof REPLAY_VERSION; createdAtUtc: string;
  inputs: InputPaths; outputDirectory: string; budgetJournal: string;
  manifestHash: string; memoryHash: string; recordsHash: string; checkpointIds: string[];
  sourceFiles: ReplayCohort["sourceFiles"]; codeSources: { path: string; sha256: string }[]; codeHash: string;
  model: typeof RESEARCH_MODELS.candidate; allocation: "replay"; maxInputTokens: 8192; maxOutputTokens: 1024; retries: 0;
  maximumAttemptMicrodollars: number; maximumRequests: number; maximumTotalMicrodollars: number;
  comparison: "seven_requested_plus_salesforce"; selection: ReplaySelection; miniRequests: number; teacherRequests: number;
  replayConcurrency: 4;
  teacher: typeof RESEARCH_MODELS.teacher; teacherOutputCap: 4096; teacherMaximumAttemptMicrodollars: number;
  allocationCeilingMicrodollars: number; priceSource: string;
}
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

export function replayRequestBound(cohort: Pick<ReplayCohort, "checkpoints">) {
  // Per usable checkpoint: stateless candidate, Salesforce candidate, GoalSpec
  // goal and candidate. PASTE is deterministic. Reused goal revisions cost less.
  return 4 * cohort.checkpoints.filter(checkpoint => checkpoint.frame !== null && checkpoint.unavailableReason === null).length;
}
function runnerCodeSources() {
  const extra = ["scripts/goalspec-prediction-v3-run.ts", "services/goalspec-runtime/provider.ts",
    "scripts/goalspec-prediction-v3-extended.ts", "services/goalspec-runtime/prediction-replay.ts",
    "services/goalspec-runtime/durable-budget.ts", "services/goalspec-runtime/artifacts.ts", "package.json", "package-lock.json"];
  return [...replayCodeSources(), ...extra.map(path => ({ path, sha256: sha(readFileSync(join(ROOT, path))) }))]
    .sort((a, b) => a.path.localeCompare(b.path));
}
function sameSnapshot(plan: ReplayPlan, cohort: ReplayCohort) {
  return plan.manifestHash === cohort.manifestHash && plan.memoryHash === cohort.memoryHash && plan.recordsHash === cohort.recordsHash
    && hash(plan.checkpointIds) === hash(cohort.checkpoints.map(checkpoint => checkpoint.id)) && hash(plan.sourceFiles) === hash(cohort.sourceFiles);
}

/** Planning reads immutable inputs and source code only. It never opens the budget or provider. */
export function makeReplayPlan(inputs: InputPaths, outputDirectory: string, maximumMicrodollars: number = ALLOCATIONS.replay) {
  const original = loadReplayCohort(inputs), target = resolve(outputDirectory);
  if (dirname(target) !== join(ROOT, "research/goalspec/runs") || existsSync(target)) throw new Error("Replay output must be a new direct child of research/goalspec/runs");
  const { cohort, selection, bound } = selectExtendedCohort(original, maximumMicrodollars);
  const maximumAttemptMicrodollars = MINI_MAXIMUM, { maximumRequests, maximumTotalMicrodollars } = bound;
  if (!Number.isSafeInteger(maximumMicrodollars) || maximumMicrodollars < 0 || maximumMicrodollars > ALLOCATIONS.replay
    || !Number.isSafeInteger(maximumTotalMicrodollars) || maximumTotalMicrodollars > maximumMicrodollars) throw new Error("Complete replay cohort exceeds its replay allowance");
  const codeSources = runnerCodeSources();
  const plan: ReplayPlan = { version: VERSION, replayVersion: REPLAY_VERSION, createdAtUtc: new Date().toISOString(),
    inputs: Object.fromEntries(Object.entries(inputs).map(([name, path]) => [name, resolve(path)])) as InputPaths,
    outputDirectory: target, budgetJournal: SHARED_REPLAY_BUDGET,
    manifestHash: cohort.manifestHash, memoryHash: cohort.memoryHash, recordsHash: cohort.recordsHash,
    checkpointIds: cohort.checkpoints.map(checkpoint => checkpoint.id), sourceFiles: cohort.sourceFiles,
    codeSources, codeHash: hash(codeSources), model: RESEARCH_MODELS.candidate, allocation: "replay", maxInputTokens: 8192,
    maxOutputTokens: 1024, retries: 0, maximumAttemptMicrodollars, maximumRequests, maximumTotalMicrodollars,
    comparison: "seven_requested_plus_salesforce", selection, miniRequests: bound.miniRequests, teacherRequests: bound.teacherRequests, replayConcurrency: 4,
    teacher: RESEARCH_MODELS.teacher, teacherOutputCap: 4096, teacherMaximumAttemptMicrodollars: TEACHER_MAXIMUM,
    allocationCeilingMicrodollars: ALLOCATIONS.replay, priceSource: PRICE_SOURCE };
  return plan;
}

export function validateReplayPlan(value: unknown): ReplayPlan {
  const plan = value as ReplayPlan;
  if (!plan || plan.version !== VERSION || plan.replayVersion !== REPLAY_VERSION || plan.model !== RESEARCH_MODELS.candidate
    || plan.allocation !== "replay" || plan.maxInputTokens !== 8192 || plan.maxOutputTokens !== 1024 || plan.retries !== 0
    || plan.budgetJournal !== SHARED_REPLAY_BUDGET || plan.allocationCeilingMicrodollars !== ALLOCATIONS.replay
    || plan.priceSource !== PRICE_SOURCE || !Array.isArray(plan.checkpointIds) || !Array.isArray(plan.sourceFiles)
    || !Array.isArray(plan.codeSources) || hash(plan.codeSources) !== plan.codeHash
    || new Set(plan.codeSources.map(source => source.path)).size !== plan.codeSources.length
    || plan.maximumAttemptMicrodollars !== maximumCost(RESEARCH_MODELS.candidate, 8192, 1024)
    || !Number.isSafeInteger(plan.maximumRequests) || plan.maximumRequests < 0
    || plan.comparison !== "seven_requested_plus_salesforce" || plan.replayConcurrency !== 4 || plan.teacher !== RESEARCH_MODELS.teacher || plan.teacherOutputCap !== 4096
    || plan.teacherMaximumAttemptMicrodollars !== TEACHER_MAXIMUM || !Number.isSafeInteger(plan.miniRequests) || plan.miniRequests < 0
    || !Number.isSafeInteger(plan.teacherRequests) || plan.teacherRequests < 0 || plan.maximumRequests !== plan.miniRequests + plan.teacherRequests
    || !plan.selection || !Number.isSafeInteger(plan.selection.maximumMicrodollars)
    || plan.maximumTotalMicrodollars !== plan.miniRequests * MINI_MAXIMUM + plan.teacherRequests * TEACHER_MAXIMUM
    || !Number.isSafeInteger(plan.maximumTotalMicrodollars) || plan.maximumTotalMicrodollars > ALLOCATIONS.replay
    || dirname(resolve(plan.outputDirectory)) !== join(ROOT, "research/goalspec/runs")) throw new Error("Invalid replay dispatch plan");
  return plan;
}

export function reserveReplayCohort(ledger: BudgetLedger, plan: ReplayPlan, planHash: string) {
  validateReplayPlan(plan);
  if (!/^[a-f0-9]{64}$/.test(planHash)) throw new Error("Invalid replay plan hash");
  const parentId = `prediction-replay:${planHash}`;
  // Existing allocation usage and the protected infrastructure/contingency caps
  // are enforced by the same durable global ledger used by native evaluations.
  ledger.reserve(parentId, "replay", plan.maximumTotalMicrodollars);
  return { parentId, ledger: new TrialLedger(ledger, parentId, "replay") };
}

/** Only this explicitly invoked function can open the existing shared journal. */
export async function dispatchReplayPlan(planPath: string, expectedPlanHash: string,
  providerFactory: typeof researchProvider = researchProvider) {
  const bytes = readFileSync(resolve(planPath)), planHash = sha(bytes);
  if (!/^[a-f0-9]{64}$/.test(expectedPlanHash) || expectedPlanHash !== planHash) throw new Error("Replay plan SHA256 changed");
  const plan = validateReplayPlan(JSON.parse(bytes.toString("utf8")));
  if (hash(runnerCodeSources()) !== plan.codeHash) throw new Error("Replay execution source changed after planning");
  const selected = selectExtendedCohort(loadReplayCohort(plan.inputs), plan.selection.maximumMicrodollars), cohort = selected.cohort;
  if (!sameSnapshot(plan, cohort) || hash(plan.selection) !== hash(selected.selection)
    || selected.bound.maximumRequests !== plan.maximumRequests || selected.bound.maximumTotalMicrodollars !== plan.maximumTotalMicrodollars) throw new Error("Replay immutable inputs changed after planning");
  if (!existsSync(SHARED_REPLAY_BUDGET)) throw new Error("Existing shared research budget journal required; fresh ledger creation is forbidden");
  const writer = createReplayWriter(plan.outputDirectory, cohort);
  writeFileSync(join(plan.outputDirectory, "dispatch-plan.json"), bytes, { flag: "wx" });
  writeFileSync(join(plan.outputDirectory, "selection.json"), canonical(plan.selection) + "\n", { flag: "wx" });
  const events = new ImmutableEventLog(join(plan.outputDirectory, "provider-events.jsonl"));
  let durable: DurableBudget | undefined, parentId: string | undefined;
  let failure: ReturnType<typeof providerFailure> | null = null;
  try {
    // Exclusive ownership rejects an active native runner. The lock is held
    // until every model response and final accounting operation has drained.
    durable = new DurableBudget(SHARED_REPLAY_BUDGET);
    const reservation = reserveReplayCohort(durable.ledger, plan, planHash); parentId = reservation.parentId;
    events.append({ type: "replay_started", planHash, parentId, allocation: "replay", maximumTotalMicrodollars: plan.maximumTotalMicrodollars,
      maximumRequests: plan.maximumRequests, memoryHash: plan.memoryHash, recordsHash: plan.recordsHash, codeHash: plan.codeHash,
      replayConcurrency: plan.replayConcurrency, timingLabel: "offline concurrent prediction throughput, not live latency" });
    const model: ModelPort = plan.maximumRequests ? providerFactory(reservation.ledger, "replay", event => events.append(event)).model
      : { complete: async () => { throw new Error("No usable replay checkpoints"); } };
    let miniAttempts = 0, teacherAttempts = 0;
    const fenced: ModelPort = { async complete(request) {
      // Recheck source and input bytes before every physical provider attempt.
      // SDK retries are disabled and the request contract permits zero retries.
      if (hash(runnerCodeSources()) !== plan.codeHash
        || plan.sourceFiles.some(source => sha(readFileSync(source.path)) !== source.sha256)) throw new Error("Frozen replay inputs changed before dispatch");
      const isTeacher = request.model === RESEARCH_MODELS.teacher;
      if (request.model !== RESEARCH_MODELS.candidate && !isTeacher || request.allocation !== "replay" || request.retries !== 0
        || request.maxOutputTokens !== (isTeacher ? 4096 : 1024)
        || request.maximumAttemptMicrodollars !== (isTeacher ? TEACHER_MAXIMUM : MINI_MAXIMUM)
        || isTeacher && request.reasoning !== "medium") throw new Error("Replay dispatch differs from frozen model and reservation contract");
      if (isTeacher ? ++teacherAttempts > plan.teacherRequests : ++miniAttempts > plan.miniRequests) throw new Error("Replay dispatch exceeds its complete-cohort request bound");
      return model.complete(request);
    } };
    const extended = await runExtendedPredictionReplay(cohort, { model: fenced, maximumAttemptMicrodollars: plan.maximumAttemptMicrodollars, concurrency: plan.replayConcurrency,
      record: writer.record, emit: writer.emit,
      freezeAnnotations: (annotations, annotationsHash) => {
        writeFileSync(join(plan.outputDirectory, "requested-annotations.jsonl"), annotations.map(row => canonical(row)).join("\n") + "\n", { flag: "wx" });
        writeFileSync(join(plan.outputDirectory, "annotations-frozen.json"), canonical({ annotationsHash, source: "visible_policy_and_requirements_only",
          teacher: RESEARCH_MODELS.teacher, beforeAnyPredictorCall: true }) + "\n", { flag: "wx" });
      } });
    writeFileSync(join(plan.outputDirectory, "requested-grades.jsonl"), extended.assessments.map(row => canonical(row)).join("\n") + "\n", { flag: "wx" });
    writeFileSync(join(plan.outputDirectory, "goal-summary.json"), canonical(extended.summary) + "\n", { flag: "wx" });
    if (hash(runnerCodeSources()) !== plan.codeHash
      || plan.sourceFiles.some(source => sha(readFileSync(source.path)) !== source.sha256)) throw new Error("Frozen replay sources changed during execution");
    durable.ledger.finishParent(parentId);
    const entries = durable.ledger.snapshot(), parent = entries.find(entry => entry.id === parentId)!;
    const children = entries.filter(entry => entry.parentId === parentId);
    const accounting = { parentId, allocation: "replay", maximumMicrodollars: parent.maximum,
      settledMicrodollars: parent.actual ?? null, chargedOrReservedMicrodollars: parent.actual ?? parent.maximum,
      knownBilledMicrodollars: children.reduce((sum, child) => sum + (child.actual ?? 0), 0),
      unresolvedRequests: children.filter(child => child.actual === undefined).map(child => ({ id: child.id, maximumMicrodollars: child.maximum })),
      totalAllocationChargedOrReservedMicrodollars: entries.filter(entry => !entry.parentId && entry.allocation === "replay")
        .reduce((sum, entry) => sum + (entry.actual ?? entry.maximum), 0),
      allAllocationChargedOrReservedMicrodollars: entries.filter(entry => !entry.parentId).reduce((sum, entry) => sum + (entry.actual ?? entry.maximum), 0) };
    writeFileSync(join(plan.outputDirectory, "billing.json"), canonical(accounting) + "\n", { flag: "wx" });
    const summary = writer.finish();
    return { outputDirectory: plan.outputDirectory, planHash, accounting, summary };
  } catch (error) {
    failure = providerFailure(error);
    events.append({ type: "replay_failed", planHash, failure });
    writeFileSync(join(plan.outputDirectory, "failure.json"), canonical({ planHash, failure, incompleteReplay: true }) + "\n", { flag: "wx" });
    throw error;
  } finally {
    try {
      if (durable && parentId && durable.ledger.snapshot().find(entry => entry.id === parentId)?.actual === undefined) durable.ledger.finishParent(parentId);
      events.append({ type: "replay_closed", planHash, failed: failure !== null });
    } finally { try { events.close(); } finally { durable?.close(); } }
    if (failure === null) {
      const files = ["dispatch-plan.json", "selection.json", "manifest.json", "predictions.jsonl", "model-events.jsonl", "provider-events.jsonl",
        "requested-annotations.jsonl", "annotations-frozen.json", "requested-grades.jsonl", "goal-summary.json", "billing.json", "summary.json", "completion.json"];
      writeFileSync(join(plan.outputDirectory, "execution-receipt.json"), canonical({ status: "complete", planHash,
        files: files.map(path => ({ path, sha256: sha(readFileSync(join(plan.outputDirectory, path))) })) }) + "\n", { flag: "wx" });
    }
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "prepare" && (args.length === 6 || args.length === 7)) {
    const [runDirectory, closedEventsPath, memoryPath, recordsPath, planPath, outputDirectory, maximumDollars = "30"] = args;
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(maximumDollars)) throw new Error("Invalid replay dollar allowance");
    const plan = makeReplayPlan({ runDirectory, closedEventsPath, memoryPath, recordsPath }, outputDirectory, Math.round(Number(maximumDollars) * 1_000_000));
    const bytes = canonical(plan) + "\n"; writeFileSync(resolve(planPath), bytes, { flag: "wx" });
    process.stdout.write(JSON.stringify({ planPath: resolve(planPath), planHash: sha(bytes), maximumRequests: plan.maximumRequests,
      maximumTotalMicrodollars: plan.maximumTotalMicrodollars, allocation: "replay", providerCalls: 0, ledgerOpened: false }) + "\n");
  } else if (command === "dispatch" && args.length === 2) {
    const result = await dispatchReplayPlan(args[0], args[1]);
    process.stdout.write(JSON.stringify({ outputDirectory: result.outputDirectory, planHash: result.planHash, accounting: result.accounting }) + "\n");
  } else throw new Error("Usage: goalspec-prediction-v3-run.ts prepare RUN CLOSED_EVENTS MEMORY RECORDS NEW_PLAN NEW_OUTPUT [MAX_USD]; dispatch PLAN EXPECTED_SHA256");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  process.stderr.write(JSON.stringify({ type: "replay_cli_failed", ...providerFailure(error) }) + "\n"); process.exitCode = 1;
});
