import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import { validateGoals } from "../src/lib/goalspec/compiler";
import type { ExecutionFrame, GoalSet } from "../src/lib/goalspec/contracts/generated";
import { predictCompactGoals } from "../src/lib/goalspec/compact-goals";
import { RESEARCH_MODELS, providerFailure, type ModelPort } from "../src/lib/goalspec/model";
import { maximumCost } from "../services/goalspec-runtime/provider";
import { annotateRequested, gradeRequested, validateRequestedAnnotation, type AnnotationRecord,
  type PredictionRecord, type ReplayCheckpoint as RequestedCheckpoint } from "../services/goalspec-runtime/prediction-replay";
import { EXTENDED_REPLAY_ARMS, runPredictionReplay, type ReplayCheckpoint, type ReplayCohort,
  type ReplayDecision, type ReplayOptions } from "./goalspec-prediction-v3";
import { orderedConcurrentMap } from "./goalspec-replay-concurrency";

export const EXTENDED_VERSION = "goalspec-requested-replay-v3.1";
export const MINI_MAXIMUM = maximumCost(RESEARCH_MODELS.candidate, 8192, 1024);
export const TEACHER_MAXIMUM = maximumCost(RESEARCH_MODELS.teacher, 32768, 4096);
type Revision = { key: string; frame: ExecutionFrame; row: RequestedCheckpoint; checkpointIds: string[];
  runIds: string[]; familyIds: string[]; sourceMap: Record<string, string> };
export interface GoalAnnotation { revision: string; checkpointIds: string[]; reference: AnnotationRecord }
export interface GoalAssessment {
  revision: string; checkpointIds: string[]; runIds: string[]; familyIds: string[];
  prediction: PredictionRecord; referenceHash: string; grade: Awaited<ReturnType<typeof gradeRequested>>;
}
export interface ReplaySelection {
  method: "all_checkpoints" | "sha256_checkpoint_id_order"; seed: typeof EXTENDED_VERSION;
  inputCheckpointIds: string[]; selectedCheckpointIds: string[]; omittedCheckpointIds: string[];
  maximumMicrodollars: number; contentHash: string;
}

/** Annotation and semantic grading reuse the existing v2 complete-request contract. */
export function requestedRevisions(cohort: Pick<ReplayCohort, "checkpoints">): Revision[] {
  const revisions = new Map<string, Revision>();
  for (const checkpoint of cohort.checkpoints) {
    if (!checkpoint.frame || checkpoint.unavailableReason !== null) continue;
    const frame = checkpoint.frame;
    const entries = Object.entries(frame.sources).filter(([key, value]) => key.startsWith("requirement:") && typeof value === "string")
      .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
    const sourceMap = Object.fromEntries(entries.map(([key], index) => [`request:${index}`, key]));
    const requested_input = { policy: frame.policy, sources: Object.fromEntries(entries.map(([, value], index) => [`request:${index}`, value as string])) };
    const key = hash(requested_input), previous = revisions.get(key);
    if (previous) {
      previous.checkpointIds.push(checkpoint.id); previous.runIds = [...new Set([...previous.runIds, checkpoint.runId])];
      previous.familyIds = [...new Set([...previous.familyIds, checkpoint.familyId])]; continue;
    }
    const row: RequestedCheckpoint = { schemaVersion: "1.0.0", id: `requested:${key}`, trajectory_id: checkpoint.runId,
      through_seq: checkpoint.boundary, familyId: checkpoint.familyId, taskId: checkpoint.id, domain: checkpoint.domain, trial: 0,
      visible_input_hash: checkpoint.frameHash!, requested_input_hash: key, requested_input,
      pattern_goal_catalog: [], catalog_hash: hash([]) };
    revisions.set(key, { key, frame: copy(frame), row, checkpointIds: [checkpoint.id], runIds: [checkpoint.runId], familyIds: [checkpoint.familyId], sourceMap });
  }
  return [...revisions.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function extendedRequestBound(cohort: Pick<ReplayCohort, "checkpoints">) {
  const checkpoints = cohort.checkpoints.filter(checkpoint => checkpoint.frame && checkpoint.unavailableReason === null).length;
  const revisions = requestedRevisions(cohort).length;
  // Salesforce and PASTE+memory share the exact neutral candidate response. All
  // remaining model comparisons receive separate candidate requests.
  const miniRequests = 6 * checkpoints + revisions, teacherRequests = 2 * revisions;
  return { checkpoints, revisions, miniRequests, teacherRequests, maximumRequests: miniRequests + teacherRequests,
    maximumTotalMicrodollars: miniRequests * MINI_MAXIMUM + teacherRequests * TEACHER_MAXIMUM };
}

/** Selection depends only on checkpoint identifiers and visible revision reuse, before annotations. */
export function selectExtendedCohort(cohort: ReplayCohort, maximumMicrodollars: number) {
  if (!Number.isSafeInteger(maximumMicrodollars) || maximumMicrodollars < 0 || maximumMicrodollars > 30_000_000) throw new Error("Invalid extended replay allowance");
  let selected = cohort.checkpoints;
  const all = extendedRequestBound(cohort), method = all.maximumTotalMicrodollars <= maximumMicrodollars ? "all_checkpoints" : "sha256_checkpoint_id_order";
  if (method !== "all_checkpoints") {
    const retained = cohort.checkpoints.filter(checkpoint => !checkpoint.frame || checkpoint.unavailableReason !== null);
    const ordered = cohort.checkpoints.filter(checkpoint => checkpoint.frame && checkpoint.unavailableReason === null)
      .sort((a, b) => hash([EXTENDED_VERSION, a.id]).localeCompare(hash([EXTENDED_VERSION, b.id])));
    for (const checkpoint of ordered) {
      const proposed = [...retained, checkpoint];
      if (extendedRequestBound({ checkpoints: proposed }).maximumTotalMicrodollars <= maximumMicrodollars) retained.push(checkpoint);
    }
    const ids = new Set(retained.map(checkpoint => checkpoint.id)); selected = cohort.checkpoints.filter(checkpoint => ids.has(checkpoint.id));
    if (all.checkpoints && !extendedRequestBound({ checkpoints: selected }).checkpoints) throw new Error("Replay allowance cannot fund even one complete comparison and goal assessment");
  }
  const ids = new Set(selected.map(checkpoint => checkpoint.id));
  const body = { method, seed: EXTENDED_VERSION, inputCheckpointIds: cohort.checkpoints.map(checkpoint => checkpoint.id),
    selectedCheckpointIds: selected.map(checkpoint => checkpoint.id), omittedCheckpointIds: cohort.checkpoints.filter(checkpoint => !ids.has(checkpoint.id)).map(checkpoint => checkpoint.id), maximumMicrodollars } as const;
  return { cohort: { ...cohort, checkpoints: selected }, selection: { ...body, contentHash: hash(body) } as ReplaySelection,
    bound: extendedRequestBound({ checkpoints: selected }) };
}

function remapGoals(goals: GoalSet, sourceMap: Record<string, string>): GoalSet {
  const result = copy(goals);
  for (const goal of result.hypotheses) for (const reference of [...goal.sources, ...goal.constraints.flatMap(constraint => constraint.sources)]) {
    const mapped = sourceMap[reference.sourceId];
    if (!mapped) throw new Error("Requested goal reference has no visible user-source mapping");
    reference.sourceId = mapped;
  }
  return result;
}
function oracleGoals(reference: AnnotationRecord, revision: Revision): GoalSet | null {
  if (reference.status !== "completed" || !reference.annotation) return null;
  const annotation = validateRequestedAnnotation(reference.annotation, revision.row.requested_input.sources);
  if (annotation.unknown) return { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: revision.key };
  const goals: GoalSet = { schemaVersion: 1, unknown: 0, revisionHash: revision.key, hypotheses: [{ id: hash(annotation),
    objective: annotation.objective, probability: 1,
    sources: [...new Set(annotation.evidence.map(evidence => evidence.sourceId))].map(sourceId => ({ sourceId, path: [] })) as GoalSet["hypotheses"][number]["sources"],
    constraints: annotation.requirements.map(requirement => ({ text: requirement.text, sources: [{ sourceId: requirement.sourceId, path: [] }] })) }] };
  return remapGoals(goals, revision.sourceMap);
}

export async function runExtendedPredictionReplay(cohort: ReplayCohort, options: ReplayOptions & {
  freezeAnnotations: (annotations: GoalAnnotation[], hash: string) => void | Promise<void>;
  emitGoalAssessment?: (assessment: GoalAssessment) => void | Promise<void>;
}) {
  if (options.maximumAttemptMicrodollars !== MINI_MAXIMUM) throw new Error("Extended mini reservation differs from the pinned pricing bound");
  const revisions = requestedRevisions(cohort), references = new Map<string, AnnotationRecord>(), concurrency = options.concurrency ?? 1;
  const log = options.record ?? (() => {});
  const teacher: ModelPort = { async complete(request) {
    if (request.model !== RESEARCH_MODELS.teacher || request.maxOutputTokens !== 4096 || request.retries !== 0
      || request.maximumAttemptMicrodollars !== TEACHER_MAXIMUM || request.reasoning !== "medium") throw new Error("Invalid requested-goal teacher contract");
    const effective = { ...request, allocation: "replay" as const };
    log({ type: "requested_teacher_request", id: request.id, model: request.model,
      allocation: "replay", contractDefaultAllocation: request.allocation, maximumAttemptMicrodollars: TEACHER_MAXIMUM,
      inputHash: hash({ instructions: request.instructions, input: request.input }), maxOutputTokens: 4096, retries: 0,
      compilerVersion: "goalspec-input-v1", selected: ["instructions", "visible_checkpoint"], omitted: [] });
    const result = await options.model.complete(effective);
    if (result.model !== RESEARCH_MODELS.teacher || result.status !== "completed" || result.refusals.length || result.calls.length) throw new Error("Invalid requested-goal teacher response");
    log({ type: "requested_teacher_response", id: request.id, status: result.status, usage: result.usage ?? null, responseHash: hash(result.text) });
    return result;
  } };
  const annotationRows = await orderedConcurrentMap(revisions, concurrency, async revision => {
    let reference: AnnotationRecord;
    try { reference = await annotateRequested(revision.row, teacher); }
    catch (error) { reference = { requested_input_hash: revision.key, status: "failed", model: RESEARCH_MODELS.teacher, error_type: "TeacherAnnotationFailure" };
      log({ type: "requested_annotation_failed", revision: revision.key, ...providerFailure(error) }); }
    references.set(revision.key, reference); return { revision: revision.key, checkpointIds: revision.checkpointIds, reference };
  });
  // This mandatory persistence barrier occurs before ANY predictor request.
  const annotationsHash = hash(annotationRows); await options.freezeAnnotations(annotationRows, annotationsHash);
  const inferredByCheckpoint: Record<string, GoalSet | null> = {}, oracleByCheckpoint: Record<string, GoalSet | null> = {};
  const predictions = new Map<string, PredictionRecord>();
  await orderedConcurrentMap(revisions, concurrency, async revision => {
    let goals: GoalSet | null = null, prediction: PredictionRecord;
    try {
      goals = (await predictCompactGoals(options.model, revision.frame, { allocation: "replay", maximumAttemptMicrodollars: MINI_MAXIMUM,
        maxOutputTokens: 1024, record: event => log({ type: "requested_goal_prediction", revision: revision.key, event }) })).goals;
      validateGoals(goals, revision.frame.sources);
      prediction = { id: revision.row.id, requested_input_hash: revision.key, status: "completed", model: RESEARCH_MODELS.goal,
        requested_goals: remapGoals(goals, Object.fromEntries(Object.entries(revision.sourceMap).map(([opaque, actual]) => [actual, opaque]))) };
    } catch (error) {
      goals = null; prediction = { id: revision.row.id, requested_input_hash: revision.key, status: "failed", model: RESEARCH_MODELS.goal, error_type: "GoalPredictionFailure" };
      log({ type: "requested_prediction_failed", revision: revision.key, ...providerFailure(error) });
    }
    predictions.set(revision.key, prediction);
    const oracle = oracleGoals(references.get(revision.key)!, revision);
    if (oracle) validateGoals(oracle, revision.frame.sources);
    for (const id of revision.checkpointIds) {
      const current = cohort.checkpoints.find(checkpoint => checkpoint.id === id)!.frame!;
      const currentKeys = Object.keys(current.sources).filter(key => key.startsWith("requirement:"))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      const remapping = Object.fromEntries(Object.values(revision.sourceMap).map((key, index) => [key, currentKeys[index]]));
      inferredByCheckpoint[id] = goals ? remapGoals(goals, remapping) : null;
      oracleByCheckpoint[id] = oracle ? remapGoals(oracle, remapping) : null;
      if (inferredByCheckpoint[id]) validateGoals(inferredByCheckpoint[id]!, current.sources);
      if (oracleByCheckpoint[id]) validateGoals(oracleByCheckpoint[id]!, current.sources);
    }
  });
  const shuffledContexts: NonNullable<ReplayOptions["shuffledContexts"]> = {};
  const byCheckpoint = new Map(cohort.checkpoints.map(checkpoint => [checkpoint.id, checkpoint]));
  for (const revision of revisions) for (const id of revision.checkpointIds) {
    const checkpoint = byCheckpoint.get(id)!;
    const alternatives = revisions.filter(other => !other.runIds.includes(checkpoint.runId)
      && !other.familyIds.includes(checkpoint.familyId) && references.get(other.key)?.status === "completed")
      .sort((a, b) => Number(b.row.domain === checkpoint.domain) - Number(a.row.domain === checkpoint.domain)
        || hash([EXTENDED_VERSION, id, a.key]).localeCompare(hash([EXTENDED_VERSION, id, b.key])));
    const foreign = alternatives[0], annotation = foreign ? references.get(foreign.key)!.annotation! : null;
    shuffledContexts[id] = foreign && annotation ? { sourceCheckpointId: foreign.checkpointIds[0], hypotheses: annotation.unknown ? []
      : [{ objective: annotation.objective, constraints: annotation.requirements.map(requirement => requirement.text) }] } : null;
  }
  const rows = await runPredictionReplay(cohort, { ...options, arms: EXTENDED_REPLAY_ARMS,
    inferredGoals: inferredByCheckpoint, oracleGoals: oracleByCheckpoint, shuffledContexts });
  const assessments = await orderedConcurrentMap(revisions, concurrency, async revision => {
    const prediction = predictions.get(revision.key)!, reference = references.get(revision.key)!;
    let grade: GoalAssessment["grade"];
    try { grade = await gradeRequested(revision.row, prediction, reference, teacher); }
    catch (error) { grade = { id: revision.row.id, prediction_hash: hash(prediction), annotation_hash: hash(reference),
      status: "failed", ranked_ids: [], matches: [], error_type: "TeacherGradingFailure" };
      log({ type: "requested_grading_failed", revision: revision.key, ...providerFailure(error) }); }
    const assessment = { revision: revision.key, checkpointIds: revision.checkpointIds, runIds: revision.runIds, familyIds: revision.familyIds,
      prediction, referenceHash: hash(reference), grade };
    return assessment;
  }, options.emitGoalAssessment);
  return { rows, annotations: annotationRows, annotationsHash, assessments, summary: summarizeGoalAssessment(annotationRows, assessments, rows) };
}

export function summarizeGoalAssessment(annotations: GoalAnnotation[], assessments: GoalAssessment[], rows: ReplayDecision[]) {
  const scored = assessments.filter(assessment => assessment.grade.status === "completed");
  const top1 = (assessment: GoalAssessment) => assessment.grade.matches[0] === true;
  const top3 = (assessment: GoalAssessment) => assessment.grade.matches.slice(0, 3).some(Boolean);
  const weighted = scored.reduce((sum, assessment) => sum + assessment.checkpointIds.length, 0);
  return { version: EXTENDED_VERSION, label: "Automated prefix-only teacher-referenced complete requested-goal agreement",
    predictor: RESEARCH_MODELS.goal, teacher: RESEARCH_MODELS.teacher,
    uniqueGoalRevisions: annotations.length, scoredRevisions: scored.length, missingAnnotationOrGrade: annotations.length - scored.length,
    unknownReferences: annotations.filter(row => row.reference.annotation?.unknown).length,
    failedGoalPredictions: assessments.filter(assessment => assessment.prediction.status === "failed").length,
    goalTop1: scored.length ? scored.filter(top1).length / scored.length : null,
    goalTop3: scored.length ? scored.filter(top3).length / scored.length : null,
    checkpointWeighted: { scored: weighted, goalTop1: weighted ? scored.filter(top1).reduce((sum, row) => sum + row.checkpointIds.length, 0) / weighted : null,
      goalTop3: weighted ? scored.filter(top3).reduce((sum, row) => sum + row.checkpointIds.length, 0) / weighted : null },
    shuffledUnavailableCheckpoints: rows.filter(row => row.predictions.find(prediction => prediction.arm === "shuffled_goals")?.status === "failed").length,
    requestedArms: EXTENDED_REPLAY_ARMS.slice(0, 7), extraArchitectureArm: "salesforce",
    limitations: ["Annotation and semantic grading share one teacher model and can share systematic errors; these are not human labels.",
      "Goal agreement is separate from native task success, achieved endpoints, and teacher-independent benchmark truth.",
      "Oracle uses only independently annotated visible requests, not hidden task instructions or later outcomes.",
      "Shuffled context uses a different task family, preferring the same domain; it supplies no current entity bindings or authorization. No eligible donor remains explicitly unavailable.",
      "Predictor failures count as goal misses when a reference exists; missing teacher references/grades remain unmeasured with explicit coverage."] };
}
