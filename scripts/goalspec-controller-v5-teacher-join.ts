import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { buildDecisionState } from "../src/lib/goalspec/controller-features";
import { buildSpeculationContext, extractV5Features } from "../src/lib/goalspec/controller-v5-features";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const CONTINUATION = "goalspec-v5-never-dispatched-annotation-continuation-v1";
const CONTINUATION_V2 = "goalspec-v5-never-dispatched-annotation-continuation-v2";
const parseRows = (bytes: Buffer) => bytes.toString("utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));

/** Verify a closed continuation without replacing any previously attempted row. */
function verifyContinuationRows(plan: any, summary: any, originalPlan: any, combined: any[], prior: any[], resumed: any[], attempted: Set<string>) {
  if (![CONTINUATION, CONTINUATION_V2].includes(plan.version) || summary.version !== plan.version || summary.historyPreserved !== true
    || summary.originalPlanSha256 !== plan.originalPlanSha256 || plan.originalCount !== originalPlan.selected.length
    || combined.length !== plan.originalCount || prior.length !== plan.originalCount || summary.retained !== combined.length
    || resumed.length !== plan.continuation.length || summary.resumed !== resumed.length
    || summary.originalAttemptedRowsRetained !== plan.retainedAttemptedOrdinals.length || summary.originallyNeverDispatched !== resumed.length) throw new Error("Incomplete continuation history");
  const continuation = new Map<number, string>(plan.continuation.map((row: any) => [row.ordinal, row.groupId]));
  const retained = new Set<number>(plan.retainedAttemptedOrdinals), byId = new Map(resumed.map(row => [row.groupId, row]));
  if (continuation.size !== plan.continuation.length || byId.size !== resumed.length || retained.size !== plan.retainedAttemptedOrdinals.length
    || attempted.size !== retained.size || continuation.size + retained.size !== prior.length
    || [...continuation.keys(), ...retained].some(i => !Number.isSafeInteger(i) || i < 0 || i >= prior.length)) throw new Error("Continuation ordinal coverage mismatch");
  for (const [ordinal, old] of prior.entries()) {
    const declared = originalPlan.selected[ordinal];
    for (const key of ["groupId", "familyId", "frameHash", "prefixHash", "publicInputHash", "reliabilitySplit"])
      if (old[key] !== declared[key] || combined[ordinal][key] !== old[key]) throw new Error("Continuation changed checkpoint identity");
    if (retained.has(ordinal)) {
      if (continuation.has(ordinal) || !attempted.has(old.groupId) || canonical(combined[ordinal]) !== canonical(old)) throw new Error("Previously attempted annotation row changed");
    } else {
      if (continuation.get(ordinal) !== old.groupId || attempted.has(old.groupId) || old.goals !== null || old.prediction.status !== "failed"
        || old.annotation.status !== "failed" || old.annotation.value !== null || old.agreement.label !== null
        || !byId.has(old.groupId) || canonical(combined[ordinal]) !== canonical(byId.get(old.groupId))) throw new Error("Continuation replaced a previously dispatched row or lost history");
    }
  }
}

function teacherEventAudit(records: any[], allowUnknown: boolean) {
  let previous = "0".repeat(64), cost = 0;
  const attempted = new Set<string>(), requestIds = new Set<string>(), unknown: { id: string; model: string }[] = [];
  for (const [sequence, record] of records.entries()) {
    if (record.body.sequence !== sequence || record.body.previousHash !== previous || hash(record.body) !== record.hash) throw new Error("Original annotation provider chain mismatch");
    previous = record.hash;
    const event = record.body.event;
    if (typeof event.type !== "string" || typeof event.id !== "string") throw new Error("Unclassified original provider event");
    if (event.type.startsWith("model_attempt")) {
      const match = /^v5-annotation:([a-f0-9]{64}):(blind|prediction|agreement)$/.exec(event.id);
      if (!match || requestIds.has(event.id)) throw new Error("Repeated or unrecognized annotation provider attempt");
      requestIds.add(event.id); attempted.add(match[1]!);
      if (event.type === "model_attempt" && Number.isSafeInteger(event.costMicrodollars) && event.costMicrodollars >= 0) cost += event.costMicrodollars;
      else if (allowUnknown && event.type === "model_attempt_failed" && event.reservationRetained === true
        && ["gpt-4.1-mini-2025-04-14", "gpt-5.4-2026-03-05"].includes(event.model)) unknown.push({ id: event.id, model: event.model });
      else throw new Error("Unreconciled original provider attempt");
    }
  }
  return { attempted, requestIds, unknown, cost, finalHash: previous, events: records.length };
}
export function verifyV5TeacherContinuation(plan: any, summary: any, originalPlan: any, combined: any[], prior: any[], resumed: any[], originalEvents: any[]) {
  if (plan.version !== CONTINUATION) throw new Error("Use complete history verification for continuation v2");
  const audit = teacherEventAudit(originalEvents, false);
  if (audit.finalHash !== plan.audit.finalHash || audit.events !== plan.audit.events || audit.cost !== plan.audit.knownCostMicrodollars
    || canonical([...audit.attempted].sort()) !== canonical([...plan.audit.attemptedGroupIds].sort())) throw new Error("Continuation attempt audit mismatch");
  verifyContinuationRows(plan, summary, originalPlan, combined, prior, resumed, audit.attempted);
}

export interface TeacherHistoryStage { directory: string; plan: any; summary: any; annotations: any[]; events: any[]; resumed: any[] }
/** Pure provenance check. The caller separately verifies file/archive hashes. */
export function verifyV5TeacherHistory(plan: any, summary: any, originalPlan: any, combined: any[], prior: any[], resumed: any[], stages: TeacherHistoryStage[]) {
  if (plan.version !== CONTINUATION_V2 || !stages.length || stages.length > 8 || stages.length !== plan.history.length
    || new Set(stages.map(stage => resolve(stage.directory))).size !== stages.length
    || resolve(stages[0]!.directory) !== resolve(plan.original) || resolve(stages.at(-1)!.directory) !== resolve(plan.previousDirectory)) throw new Error("Invalid bounded continuation history");
  const attempted = new Set<string>(), requests = new Set<string>(), unknown: { id: string; model: string; maximumMicrodollars: number }[] = [];
  let knownCost = 0;
  for (const [index, stage] of stages.entries()) {
    const declared = plan.history[index];
    if (resolve(stage.directory) !== resolve(declared.directory) || stage.annotations.length !== originalPlan.selected.length) throw new Error("Continuation history directory/denominator changed");
    if (index) {
      if (resolve(stage.plan.previousDirectory ?? stage.plan.original) !== resolve(stages[index - 1]!.directory)
        || stage.plan.originalPlanSha256 !== plan.originalPlanSha256) throw new Error("Continuation history order changed");
      verifyContinuationRows(stage.plan, stage.summary, originalPlan, stage.annotations, stages[index - 1]!.annotations, stage.resumed, attempted);
    } else if (stage.plan.version !== "goalspec-train-annotation-v5") throw new Error("History must begin at the original pilot");
    const audit = teacherEventAudit(stage.events, true), recorded = declared.audit;
    if (audit.finalHash !== recorded.finalHash || audit.events !== recorded.events || audit.cost !== recorded.knownCostMicrodollars
      || canonical([...audit.attempted].sort()) !== canonical([...recorded.attemptedGroupIds].sort())
      || canonical([...audit.requestIds].sort()) !== canonical([...recorded.physicalRequestIds].sort())
      || canonical(audit.unknown) !== canonical(recorded.uncertainRequests.map(({ id, model }: { id: string; model: string }) => ({ id, model })))
      || recorded.uncertainRequests.some((entry: any) => !Number.isSafeInteger(entry.maximumMicrodollars) || entry.maximumMicrodollars <= 0)
      || recorded.unknownMaximumMicrodollars !== recorded.uncertainRequests.reduce((sum: number, entry: any) => sum + entry.maximumMicrodollars, 0)) throw new Error("Continuation historical attempt audit mismatch");
    if ([...audit.attempted].some(id => attempted.has(id)) || [...audit.requestIds].some(id => requests.has(id))) throw new Error("A previously attempted checkpoint was called again");
    audit.attempted.forEach(id => attempted.add(id)); audit.requestIds.forEach(id => requests.add(id)); knownCost += audit.cost;
    unknown.push(...recorded.uncertainRequests);
    for (const [ordinal, row] of stage.annotations.entries()) {
      const selected = originalPlan.selected[ordinal];
      for (const key of ["groupId", "familyId", "frameHash", "prefixHash", "publicInputHash", "reliabilitySplit"])
        if (row[key] !== selected[key]) throw new Error("Historical public identity changed");
      if (!attempted.has(row.groupId) && (row.goals !== null || row.prediction.status !== "failed" || row.annotation.status !== "failed"
        || row.annotation.value !== null || row.agreement.label !== null)) throw new Error("Unattempted historical row contains a result");
    }
  }
  if (canonical(prior) !== canonical(stages.at(-1)!.annotations) || knownCost !== plan.audit.knownCostMicrodollars
    || canonical([...attempted].sort()) !== canonical([...plan.audit.attemptedGroupIds].sort()) || requests.size !== plan.audit.physicalRequests
    || canonical(unknown) !== canonical(plan.audit.uncertainRequests)
    || unknown.reduce((sum, item) => sum + item.maximumMicrodollars, 0) !== plan.audit.unknownMaximumMicrodollars) throw new Error("Continuation union audit mismatch");
  verifyContinuationRows(plan, summary, originalPlan, combined, prior, resumed, attempted);
}

export function joinV5TeacherRow(source: any, annotation: any, declaration: any) {
  if (!source || !annotation || !declaration || source.split !== "train" || annotation.split !== "train" || /confirmation/.test(source.cohort)) throw new Error("Teacher row not permitted training");
  const identity = ["groupId", "familyId", "frameHash", "prefixHash"];
  for (const key of identity) if (source[key] !== annotation[key] || declaration[key] !== annotation[key]) throw new Error("Teacher identity join mismatch");
  const current = buildSpeculationContext(source.context.frame);
  if (source.frameHash !== hash(source.context.frame) || annotation.publicInputHash !== current.publicInputHash
    || declaration.publicInputHash !== annotation.publicInputHash || annotation.sourceRevisionHash !== current.requestRevisionHash
    || declaration.reliabilitySplit !== annotation.reliabilitySplit || !["train", "calibration"].includes(annotation.reliabilitySplit)) throw new Error("Teacher public-prefix revision mismatch");
  if (annotation.annotation.futureInformation !== false || annotation.annotation.requestedGoalOnly !== true || annotation.annotation.blindedToPrediction !== true
    || annotation.annotation.publicInputHash !== current.publicInputHash || annotation.agreement.publicInputHash !== current.publicInputHash
    || annotation.prediction.model !== "gpt-4.1-mini-2025-04-14" || annotation.annotation.teacherModel !== "gpt-5.4-2026-03-05"
    || annotation.agreement.independentTeacherModel !== "gpt-5.4-2026-03-05") throw new Error("Teacher provenance contract mismatch");
  if (annotation.prediction.status !== "completed" || annotation.annotation.status !== "completed" || annotation.agreement.status !== "completed"
    || annotation.goals === null || ![0, 1].includes(annotation.agreement.label)) return null;
  const context = buildSpeculationContext(source.context.frame, { goals: annotation.goals, sourceRevisionHash: annotation.sourceRevisionHash,
    goalKind: "inferred", ...(source.context.memory ? { memory: source.context.memory } : {}), workflows: source.context.workflows });
  if (!context.goals.grounded && context.goals.rejection === "unknown_goal") return null;
  if (!context.goals.grounded) throw new Error("Completed teacher goal is not currently source-grounded");
  const state = buildDecisionState(context.frame), features = [...source.candidates, "NO_READ", "READ_UNCOVERED"].map(candidate => extractV5Features(context, candidate, state));
  return { ...source, context, features, goalAgreement: annotation.agreement.label, reliabilitySplit: annotation.reliabilitySplit,
    teacherProvenance: { publicInputHash: current.publicInputHash, goalAnnotationHash: hash(annotation), predictionModel: annotation.prediction.model,
      annotationModel: annotation.annotation.teacherModel, agreementModel: annotation.agreement.independentTeacherModel,
      interpretation: "conservative independent teacher agreement, not semantic truth or task success" } };
}
export function joinV5Teacher(dataset: string, annotations: string, output: string) {
  if (existsSync(output)) throw new Error("Teacher join output must be new");
  const sources: { path: string; sha256: string }[] = [];
  const read = (path: string) => { const bytes = readFileSync(path); sources.push({ path: resolve(path), sha256: sha(bytes) }); return bytes; };
  const sourceBytes = read(join(dataset, "dataset.jsonl")), sourceManifest = JSON.parse(read(join(dataset, "manifest.json")).toString("utf8"));
  const annotationBytes = read(join(annotations, "annotations.jsonl")), summary = JSON.parse(read(join(annotations, "summary.json")).toString("utf8"));
  const planBytes = read(join(annotations, "plan.json")), closedPlan = JSON.parse(planBytes.toString("utf8"));
  if (sha(sourceBytes) !== sourceManifest.datasetHash || !["prior-v4-train-families-only-no-confirmation-cohorts", "prior-v4-train-families-plus-fresh-v5-training-only"].includes(sourceManifest.sourcePolicy)
    || sha(annotationBytes) !== summary.outputSha256 || sha(planBytes) !== summary.planSha256) throw new Error("Teacher join closed input hash mismatch");
  let plan = closedPlan;
  if ([CONTINUATION, CONTINUATION_V2].includes(closedPlan.version)) {
    const originals = new Map<string, Buffer>();
    for (const file of closedPlan.inputs) {
      const bytes = read(resolve(file.path)); if (sha(bytes) !== file.sha256) throw new Error("Continuation original input hash mismatch");
      originals.set(resolve(file.path), bytes);
    }
    const historical = (directory: string, name: string) => { const bytes = originals.get(resolve(directory, name)); if (!bytes) throw new Error("Continuation missing original input"); return bytes; };
    const original = (name: string) => historical(closedPlan.original, name);
    const verifyArchive = (directory: string, step: any) => {
      const archiveRoot = resolve(directory, "source") + sep;
      for (const entry of step.code ?? []) {
        const path = resolve(directory, "source", entry.path);
        if (!path.startsWith(archiveRoot) || sha(read(path)) !== entry.sha256) throw new Error("Historical annotation executable archive changed");
      }
    };
    const originalPlanBytes = original("plan.json"), originalSummary = JSON.parse(original("summary.json").toString("utf8"));
    plan = JSON.parse(originalPlanBytes.toString("utf8"));
    if (sha(originalPlanBytes) !== closedPlan.originalPlanSha256 || originalSummary.planSha256 !== closedPlan.originalPlanSha256
      || sha(original("annotations.jsonl")) !== originalSummary.outputSha256) throw new Error("Continuation original closed cohort changed");
    const priorBytes = read(join(annotations, "prior-annotations.jsonl")), resumedBytes = read(join(annotations, "continuation-annotations.jsonl"));
    const previousDirectory = closedPlan.previousDirectory ?? closedPlan.original;
    if (!priorBytes.equals(historical(previousDirectory, "annotations.jsonl"))) throw new Error("Continuation failed to retain previous annotation bytes");
    verifyArchive(annotations, closedPlan);
    const currentAudit = teacherEventAudit(parseRows(read(join(annotations, "provider-events.jsonl"))), true);
    if ([...currentAudit.attempted].some(id => !closedPlan.continuation.some((row: any) => row.groupId === id))) throw new Error("Current continuation called a previously attempted checkpoint");
    if (closedPlan.version === CONTINUATION) {
      verifyArchive(closedPlan.original, plan);
      verifyV5TeacherContinuation(closedPlan, summary, plan, parseRows(annotationBytes), parseRows(priorBytes), parseRows(resumedBytes), parseRows(original("provider-events.jsonl")));
    } else {
      const stages: TeacherHistoryStage[] = closedPlan.history.map((entry: any, index: number) => {
        const directory = entry.directory, stepBytes = historical(directory, "plan.json"), results = historical(directory, "annotations.jsonl");
        const step = JSON.parse(stepBytes.toString("utf8")), closed = JSON.parse(historical(directory, "summary.json").toString("utf8"));
        if (sha(stepBytes) !== entry.planSha256 || sha(results) !== entry.annotationsSha256 || closed.planSha256 !== entry.planSha256
          || closed.outputSha256 !== entry.annotationsSha256 || closed.version !== step.version || closed.retained !== closedPlan.originalCount
          || resolve(step.output) !== resolve(directory)
          || hash(JSON.parse(historical(directory, "selected-public-inputs.json").toString("utf8"))) !== hash(JSON.parse(original("selected-public-inputs.json").toString("utf8")))) throw new Error("Historical annotation stage is not closed and hash-bound");
        if (index && !historical(directory, "prior-annotations.jsonl").equals(historical(closedPlan.history[index - 1].directory, "annotations.jsonl"))) throw new Error("Historical continuation lost prior bytes");
        verifyArchive(directory, step);
        return { directory, plan: step, summary: closed, annotations: parseRows(results), events: parseRows(historical(directory, "provider-events.jsonl")),
          resumed: index ? parseRows(historical(directory, "continuation-annotations.jsonl")) : [] };
      });
      verifyV5TeacherHistory(closedPlan, summary, plan, parseRows(annotationBytes), parseRows(priorBytes), parseRows(resumedBytes), stages);
    }
  }
  const rows = new Map(sourceBytes.toString("utf8").trim().split(/\r?\n/).map(line => { const row = JSON.parse(line); return [row.groupId, row] as const; }));
  const selected = new Map<string, any>(plan.selected.map((row: any) => [row.groupId, row]));
  const labels = annotationBytes.toString("utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  if (labels.length !== summary.retained || labels.length !== plan.selected.length || new Set(labels.map(row => row.groupId)).size !== labels.length
    || selected.size !== plan.selected.length) throw new Error("Incomplete or duplicated annotation cohort");
  const familyReliabilitySplits: Record<string, string> = {};
  for (const row of plan.selected) {
    if (familyReliabilitySplits[row.familyId] && familyReliabilitySplits[row.familyId] !== row.reliabilitySplit) throw new Error("Reliability family split differs");
    familyReliabilitySplits[row.familyId] = row.reliabilitySplit;
  }
  const joined = [], masked = [];
  for (const row of labels) {
    const source = rows.get(row.groupId);
    if (!source || sourceManifest.splits[source.familyId] !== "train") throw new Error("Annotation outside declared training split");
    const result = joinV5TeacherRow(source, row, selected.get(row.groupId));
    if (result) joined.push(result); else masked.push({ groupId: row.groupId, familyId: row.familyId, reason: "no_completed_source_grounded_goal_and_agreement" });
  }
  const content = Buffer.from(joined.map(row => canonical(row)).join("\n") + (joined.length ? "\n" : ""));
  const manifest = { version: "goalspec-controller-v5-teacher-join", datasetHash: sha(content), sourceDatasetHash: sourceManifest.datasetHash,
    rows: joined.length, planned: labels.length, masked, familyReliabilitySplits, sources,
    annotationCohort: { version: closedPlan.version, sourcePlanSha256: closedPlan.originalPlanSha256 ?? summary.planSha256,
      continuation: [CONTINUATION, CONTINUATION_V2].includes(closedPlan.version), attemptedHistoricalRowsUnchanged: [CONTINUATION, CONTINUATION_V2].includes(closedPlan.version) ? summary.originalAttemptedRowsRetained : null },
    code: { path: "scripts/goalspec-controller-v5-teacher-join.ts", sha256: sha(readFileSync("scripts/goalspec-controller-v5-teacher-join.ts")) },
    label: "Conservative independent annotation-teacher agreement; missing calls masked; no task success claim" };
  for (const source of sources) if (sha(readFileSync(source.path)) !== source.sha256) throw new Error("Teacher join source changed during compilation");
  mkdirSync(output, { recursive: true }); writeFileSync(join(output, "dataset.jsonl"), content, { flag: "wx" });
  writeFileSync(join(output, "manifest.json"), canonical(manifest) + "\n", { flag: "wx" });
  return { rows: joined.length, masked: masked.length, datasetHash: manifest.datasetHash, output };
}
if (process.argv[1]?.endsWith("goalspec-controller-v5-teacher-join.ts")) {
  if (!process.argv[2] || !process.argv[3] || !process.argv[4]) throw new Error("Usage: teacher-join DATASET_DIR CLOSED_ANNOTATIONS_DIR NEW_OUTPUT_DIR");
  console.log(JSON.stringify(joinV5Teacher(resolve(process.argv[2]), resolve(process.argv[3]), resolve(process.argv[4])), null, 2));
}
