import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../services/goalspec-runtime/artifacts";
import { researchProvider } from "../services/goalspec-runtime/provider";
import { annotateRequested, gradeRequested, predictCheckpoint, verifyCheckpoint,
  type AnnotationRecord, type PredictionRecord, type ReplayCheckpoint } from "../services/goalspec-runtime/prediction-replay";
import { RESEARCH_MODELS } from "../src/lib/goalspec/model";
import { hash } from "../src/lib/goalspec/canonical";

function readRows<T>(path: string): T[] { return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
async function main() {
  const [mode, queueArgument, budgetArgument, outputArgument, predictionArgument, annotationArgument] = process.argv.slice(2);
  if (!["predict", "annotate", "grade"].includes(mode) || !queueArgument || !budgetArgument || !outputArgument
    || mode === "grade" && (!predictionArgument || !annotationArgument)) throw new Error("Usage: goalspec-prediction-replay.ts predict|annotate|grade QUEUE BUDGET_DIRECTORY NEW_OUTPUT [PREDICTION_DIRECTORY ANNOTATION_DIRECTORY]");
  const rows = readRows<ReplayCheckpoint>(resolve(queueArgument));
  if (!rows.length || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Expected unique nonempty causal checkpoint queue");
  rows.forEach(verifyCheckpoint);
  const output = resolve(outputArgument);
  mkdirSync(output, { recursive: false });
  const budget = new DurableBudget(join(resolve(budgetArgument), "budget.jsonl"));
  const events = new ImmutableEventLog(join(output, "events.jsonl"));
  const progress = new ImmutableEventLog(join(output, "progress.jsonl"));
  const requested: unknown[] = Array(rows.length);
  const frozen: unknown[] = Array(rows.length);
  let index = 0, complete = 0, failures = 0;
  try {
    const provider = researchProvider(budget.ledger, mode === "predict" ? "replay" : "preparation", event => events.append(event));
    const predictions = mode === "grade" ? new Map(readRows<PredictionRecord>(join(resolve(predictionArgument), "requested-predictions.jsonl")).map(row => [row.id, row])) : new Map();
    const annotations = mode === "grade" ? new Map(readRows<AnnotationRecord>(join(resolve(annotationArgument), "requested-annotations.jsonl")).map(row => [row.requested_input_hash, row])) : new Map();
    if (mode === "grade" && (predictions.size !== rows.length || annotations.size !== new Set(rows.map(row => row.requested_input_hash)).size
      || rows.some(row => !predictions.has(row.id) || !annotations.has(row.requested_input_hash)))) throw new Error("Complete matching predictions and annotations required before grading");
    const jobs = mode === "annotate" ? [...new Map(rows.map(row => [row.requested_input_hash, row])).values()] : rows;
    const workers = await Promise.allSettled(Array.from({ length: 2 }, async () => {
      for (;;) {
        const position = index++;
        if (position >= jobs.length) return;
        const row = jobs[position];
        try {
          if (mode === "predict") {
            const result = await predictCheckpoint(row, provider.model, event => events.append(event));
            requested[position] = result.requested; frozen[position] = result.frozen;
          } else if (mode === "annotate") requested[position] = await annotateRequested(row, provider.model);
          else requested[position] = await gradeRequested(row, predictions.get(row.id)!, annotations.get(row.requested_input_hash)!, provider.model);
          progress.append({ position, result: requested[position], ...(mode === "predict" ? { frozen: frozen[position] } : {}) });
          complete++;
        } catch (error) {
          const error_type = error instanceof Error ? error.constructor.name : "Error";
          if (mode === "predict") {
            requested[position] = { id: row.id, requested_input_hash: row.requested_input_hash, status: "failed", model: RESEARCH_MODELS.goal, error_type };
            frozen[position] = { trajectory_id: row.trajectory_id, through_seq: row.through_seq, visible_input_hash: row.visible_input_hash,
              posterior: { probabilities: { __unknown__: 1 }, through_seq: row.through_seq, model_id: RESEARCH_MODELS.goal }, status: "failed", error_type };
          } else if (mode === "annotate") requested[position] = { requested_input_hash: row.requested_input_hash, status: "failed", model: RESEARCH_MODELS.teacher, error_type };
          else requested[position] = { id: row.id, status: "failed", prediction_hash: hash(predictions.get(row.id)), annotation_hash: hash(annotations.get(row.requested_input_hash)), ranked_ids: [], matches: [], error_type };
          progress.append({ position, result: requested[position], ...(mode === "predict" ? { frozen: frozen[position] } : {}) });
          failures++;
        }
        console.log(JSON.stringify({ mode, completed: complete + failures, failed: failures, total: jobs.length }));
      }
    }));
    if (workers.some(result => result.status === "rejected")) throw new Error("Replay artifact persistence failed after managed request drain");
    const name = mode === "predict" ? "requested-predictions.jsonl" : mode === "annotate" ? "requested-annotations.jsonl" : "requested-grades.jsonl";
    writeFileSync(join(output, name), requested.slice(0, jobs.length).map(row => JSON.stringify(row)).join("\n") + "\n", { flag: "wx" });
    if (mode === "predict") writeFileSync(join(output, "frozen-goals.jsonl"), frozen.map(row => JSON.stringify(row)).join("\n") + "\n", { flag: "wx" });
    const report = { mode, queueHash: hash(rows), attemptedJobs: jobs.length, completed: complete, failed: failures,
      status: failures ? "complete_with_failures" : "complete", models: { predictor: RESEARCH_MODELS.goal, teacher: RESEARCH_MODELS.teacher },
      noRetriesOrSubstitutions: true, requestedAnnotationInput: "visible_user_messages_and_policy_only",
      spentOrReservedMicrodollars: budget.ledger.snapshot().filter(row => !row.parentId).reduce((sum, row) => sum + (row.actual ?? row.maximum), 0) };
    writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(report));
  } finally { progress.close(); events.close(); budget.close(); }
}
main().catch(error => { console.error(JSON.stringify({ failed: true, error_type: error instanceof Error ? error.constructor.name : "Error" })); process.exitCode = 1; });
