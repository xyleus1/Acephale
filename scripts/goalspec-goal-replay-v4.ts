import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020";
import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import { buildGoalState, predictGoalStateDeltas, updateGoalState, type GoalState } from "../src/lib/goalspec/goal-state";
import { RESEARCH_MODELS, type ModelPort } from "../src/lib/goalspec/model";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../services/goalspec-runtime/artifacts";
import { maximumCost, researchProvider, TrialLedger } from "../services/goalspec-runtime/provider";
import { annotateRequested, gradeRequested, type AnnotationRecord, type PredictionRecord } from "../services/goalspec-runtime/prediction-replay";
import { loadReplayCohort } from "./goalspec-prediction-v3";
import { requestedRevisions, type GoalAssessment, type GoalAnnotation } from "./goalspec-prediction-v3-extended";
import { orderedConcurrentMap } from "./goalspec-replay-concurrency";
import { countTokens } from "../src/lib/goalspec/predictors";

const ROOT = resolve("."), PRIOR = join(ROOT, "research/goalspec/runs/local-v3-confirmation-prediction-corrected-20260915");
const MINI = maximumCost(RESEARCH_MODELS.goal, 8192, 1024), TEACHER = maximumCost(RESEARCH_MODELS.teacher, 32768, 4096);
const sources = ["scripts/goalspec-goal-replay-v4.ts", "src/lib/goalspec/goal-state.ts", "src/lib/goalspec/model.ts", "src/lib/goalspec/canonical.ts",
  "services/goalspec-runtime/prediction-replay.ts", "services/goalspec-runtime/provider.ts", "src/lib/goalspec/predictors.ts"];
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const read = <T = any>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const lines = <T = any>(path: string): T[] => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const write = (path: string, value: unknown) => writeFileSync(path, canonical(value) + "\n", { flag: "wx" });
export function makeGoalReplayPlan(output: string) {
  const inputs = read(join(PRIOR, "original-dispatch-plan.json")).inputs;
  const cohort = loadReplayCohort(inputs), revisions = requestedRevisions(cohort);
  const grades = lines<GoalAssessment>(join(PRIOR, "requested-grades.jsonl"));
  const wrong = grades.filter(row => row.grade.status === "completed" && !row.grade.matches[0]).map(row => row.revision);
  const inputFiles = ["requested-annotations.jsonl", "requested-grades.jsonl"].map(name => ({ path: join(PRIOR, name), sha256: sha(readFileSync(join(PRIOR, name))) }));
  if (existsSync(output) || dirname(resolve(output)) !== join(ROOT, "research/goalspec/runs")) throw new Error("New direct research output required");
  const plan = { version: "goalspec-v4-goal-review-v1", output: resolve(output), inputs, cohortHash: hash(cohort.sourceFiles),
    revisionIds: revisions.map(row => row.key), secondAnnotationRevisions: wrong, inputFiles,
    code: sources.map(path => ({ path, sha256: sha(readFileSync(path)) })),
    maximumMicrodollars: revisions.length * (MINI + TEACHER) + wrong.length * 2 * TEACHER,
    allocation: "replay", concurrency: 4, label: "v3 development prefix replay; frozen original references; actor unchanged",
    calibrationPolicy: "No teacher label or reviewed task is held-out v4 confirmation material" };
  if (plan.maximumMicrodollars > 24_900_000) throw new Error("Goal replay exceeds current bounded replay allowance");
  return plan;
}
export async function dispatchGoalReplay(planPath: string, expectedHash: string, factory = researchProvider) {
  const bytes = readFileSync(planPath), plan = JSON.parse(bytes.toString("utf8")) as ReturnType<typeof makeGoalReplayPlan>;
  if (sha(bytes) !== expectedHash || hash(makeGoalReplayPlan(plan.output)) !== hash(plan)) throw new Error("Goal replay plan or immutable source changed");
  const budgetPath = join(ROOT, "research/goalspec/runs/local-evaluation-20260914/budget.jsonl");
  if (!existsSync(budgetPath)) throw new Error("Existing shared ledger required");
  const cohort = loadReplayCohort(plan.inputs), revisions = requestedRevisions(cohort);
  const byRevision = new Map(revisions.map(row => [row.key, row]));
  const originals = new Map(lines<GoalAnnotation>(join(PRIOR, "requested-annotations.jsonl")).map(row => [row.revision, row.reference]));
  const priorGrades = new Map(lines<GoalAssessment>(join(PRIOR, "requested-grades.jsonl")).map(row => [row.revision, row]));
  mkdirSync(plan.output, { recursive: false }); write(join(plan.output, "plan.json"), plan);
  const durable = new DurableBudget(budgetPath), log = new ImmutableEventLog(join(plan.output, "provider-events.jsonl"));
  const parent = `goal-review-v4:${expectedHash}`;
  durable.ledger.reserve(parent, "replay", plan.maximumMicrodollars);
  const scoped = new TrialLedger(durable.ledger, parent, "replay");
  const raw = factory(scoped, "replay", event => log.append(event)).model;
  let requests = 0;
  const model: ModelPort = { complete: request => {
    if (![RESEARCH_MODELS.goal, RESEARCH_MODELS.teacher].includes(request.model as typeof RESEARCH_MODELS.goal)
      || request.retries !== 0 || ++requests > revisions.length * 2 + plan.secondAnnotationRevisions.length * 2) throw new Error("Goal replay dispatch bound violated");
    return raw.complete({ ...request, allocation: "replay" });
  } };
  const append = (name: string, row: unknown) => appendFileSync(join(plan.output, name), canonical(row) + "\n");
  try {
    // Blinded second annotations see only public-prefix user sources and policy,
    // never either prediction, the old reference, its score, or future outcomes.
    const independent = await orderedConcurrentMap(plan.secondAnnotationRevisions, 4, async revision => {
      let annotation: AnnotationRecord;
      try { annotation = await annotateRequested(byRevision.get(revision)!.row, model); }
      catch { annotation = { requested_input_hash: revision, status: "failed", model: RESEARCH_MODELS.teacher, error_type: "SecondAnnotationFailure" }; }
      const result = { revision, annotation }; append("second-annotations.jsonl", result); return result;
    });
    write(join(plan.output, "second-annotations-frozen.json"), { hash: hash(independent), count: independent.length, blinded: true });
    const groups = new Map<string, typeof revisions>();
    for (const revision of revisions) groups.set(revision.frame.runId, [...(groups.get(revision.frame.runId) ?? []), revision]);
    const assessments: any[] = [];
    await orderedConcurrentMap([...groups.values()], 4, async group => {
      let state: GoalState | undefined;
      for (const revision of group.sort((a, b) => a.frame.boundary - b.frame.boundary)) {
        const input = copy(revision.frame);
        let prediction: PredictionRecord;
        try {
          state = state ? updateGoalState(state, input, state.goals) : buildGoalState(input, { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) });
          state = await predictGoalStateDeltas(model, state, input, { allocation: "replay", maximumAttemptMicrodollars: MINI,
            record: event => append("goal-events.jsonl", { revision: revision.key, ...event }) });
          const goals = copy(state.goals), inverse = Object.fromEntries(Object.entries(revision.sourceMap).map(([a, b]) => [b, a]));
          for (const goal of goals.hypotheses) for (const ref of [...goal.sources, ...goal.constraints.flatMap(c => c.sources)]) {
            if (!inverse[ref.sourceId]) throw new Error("Unmapped requested source"); ref.sourceId = inverse[ref.sourceId];
          }
          prediction = { id: revision.row.id, requested_input_hash: revision.key, status: "completed", model: RESEARCH_MODELS.goal, requested_goals: goals };
        } catch (error) {
          prediction = { id: revision.row.id, requested_input_hash: revision.key, status: "failed", model: RESEARCH_MODELS.goal, error_type: "V4GoalPredictionFailure" };
          append("goal-events.jsonl", { revision: revision.key, type: "goal_prediction_failed", errorType: error instanceof Error ? error.constructor.name : "Error",
            reason: error instanceof Error && error.message.startsWith("Goal state:") ? error.message : "provider_or_contract_failure" });
        }
        const reference = originals.get(revision.key)!;
        let grade: Awaited<ReturnType<typeof gradeRequested>> | null = null;
        try { grade = await gradeRequested(revision.row, prediction, reference, model); } catch { /* Keep explicit missing grade. */ }
        const result = { revision: revision.key, familyIds: revision.familyIds, checkpointIds: revision.checkpointIds, prediction, grade,
          originalGrade: priorGrades.get(revision.key)!.grade, state: state ? copy(state) : null };
        assessments.push(result); append("assessments.jsonl", result);
        process.stdout.write(JSON.stringify({ completed: assessments.length, total: revisions.length, predicted: prediction.status }) + "\n");
      }
    });
    const fieldSchema = { type: "object", additionalProperties: false, properties: {
      uncertain: { type: "boolean" }, originalReferenceSupported: { type: "boolean" },
      v3: { type: "object", additionalProperties: false, properties: { literalCoverage: { type: "number", minimum: 0, maximum: 1 }, staleIntent: { type: "boolean" }, contradiction: { type: "boolean" } }, required: ["literalCoverage", "staleIntent", "contradiction"] },
      v4: { type: "object", additionalProperties: false, properties: { literalCoverage: { type: "number", minimum: 0, maximum: 1 }, staleIntent: { type: "boolean" }, contradiction: { type: "boolean" } }, required: ["literalCoverage", "staleIntent", "contradiction"] },
      reason: { type: "string", maxLength: 600 },
    }, required: ["uncertain", "originalReferenceSupported", "v3", "v4", "reason"] };
    const validateFields = new Ajv2020({ strict: true }).compile(fieldSchema);
    await orderedConcurrentMap(independent, 4, async row => {
      const revision = byRevision.get(row.revision)!, result = assessments.find(a => a.revision === row.revision);
      const instructions = "Audit goal predictions against ONLY currently visible requested sources. Distinguish active, superseded and prohibited actions; literal extrema, dates, route direction and negation matter. "
        + "Score literal requirement coverage in [0,1], flag stale active intent and contradictions separately. Mark uncertainty for ambiguous scope/granularity. "
        + "The independent second annotation was frozen before predictions; do not assume either annotation is correct. Labels v3/v4 are anonymous candidate identifiers, not a preference. Return strict JSON, with an attributable short reason. Never use future outcomes.";
      const input = [{ role: "user" as const, content: canonical({ visible: revision.row.requested_input, originalReference: originals.get(row.revision),
        independentReference: row.annotation, v3: priorGrades.get(row.revision)!.prediction, v4: result.prediction }) }];
      let fields: unknown = null;
      if (countTokens(canonical({ instructions, input, fieldSchema })) <= 32768 - 128) {
        try {
          const response = await model.complete({ id: `v4-fields:${row.revision}`, model: RESEARCH_MODELS.teacher, reasoning: "medium", instructions, input,
            responseFormat: { name: "goal_field_review_v4", strict: true, schema: fieldSchema }, maxOutputTokens: 4096,
            maximumAttemptMicrodollars: TEACHER, allocation: "replay", retries: 0 });
          if (response.status === "completed" && !response.refusals.length && !response.calls.length) {
            const parsed = JSON.parse(response.text); if (validateFields(parsed)) fields = parsed;
          }
        } catch { /* Failed reviews remain missing, original scores never change. */ }
      }
      append("field-reviews.jsonl", { revision: row.revision, fields });
    });
    const scored = assessments.filter(row => row.grade?.status === "completed"), matches = scored.filter(row => row.grade.matches[0] === true).length;
    const paired = scored.filter(row => row.originalGrade.status === "completed");
    write(join(plan.output, "summary.json"), { version: plan.version, label: plan.label, revisions: revisions.length,
      predicted: assessments.filter(row => row.prediction.status === "completed").length, scored: scored.length,
      goalTop1: scored.length ? matches / scored.length : null, goalTop3: scored.length ? scored.filter(row => row.grade.matches.slice(0, 3).some(Boolean)).length / scored.length : null,
      pairedScored: paired.length, v3Matches: paired.filter(row => row.originalGrade.matches[0] === true).length, v4Matches: paired.filter(row => row.grade.matches[0] === true).length,
      secondAnnotations: independent.length, requests, maximumMicrodollars: plan.maximumMicrodollars,
      originalScoresModified: false, heldoutClaim: false });
  } finally { durable.ledger.finishParent(parent); log.close(); durable.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, path, extra] = process.argv.slice(2);
  if (mode === "plan") { const plan = makeGoalReplayPlan(path); write(extra, plan); console.log(JSON.stringify({ plan: extra, sha256: sha(readFileSync(extra)), revisions: plan.revisionIds.length, maximumUsd: plan.maximumMicrodollars / 1e6 })); }
  else if (mode === "run") void dispatchGoalReplay(path, extra).catch(error => { console.error(error instanceof Error ? error.constructor.name : "Error"); process.exitCode = 1; });
  else throw new Error("Use plan OUTPUT PLAN_FILE or run PLAN_FILE SHA256");
}
