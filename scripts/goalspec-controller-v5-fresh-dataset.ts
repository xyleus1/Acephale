import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { buildDecisionState } from "../src/lib/goalspec/controller-features";
import { buildSpeculationContext, extractV5Features } from "../src/lib/goalspec/controller-v5-features";
import { memoryQuery, retrieveContextualMemory, validateMemoryArtifact, type MemoryFile } from "../src/lib/goalspec/experience-memory";
import { nativeCandidateGraphV5 } from "../services/goalspec-runtime/native-candidate-graph";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";
import { publicPrefixSources, publicReplayMessages } from "./goalspec-prediction-v3";
import type { V5MemoryBuildPlan } from "./goalspec-build-memory-v5";

export interface V5FreshDatasetPlan {
  version: "goalspec-controller-fresh-dataset-plan-v5";
  prior: { directory: string; datasetHash: string; manifestSha256: string };
  memory: MemoryFile;
  cohort: V5MemoryBuildPlan["cohorts"][number];
}
const READS: Record<string, string[]> = { retail: ["find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"],
  airline: ["get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"] };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function freshV5FamilySplits(declared: Record<string, string>): Record<string, "train" | "selection" | "calibration"> {
  if (!declared || typeof declared !== "object" || Array.isArray(declared)
    || Object.entries(declared).some(([family, split]) => !/^(retail|airline):[^:]+$/.test(family) || !["train", "calibration", "development"].includes(split))) throw new Error("Invalid declared fresh families");
  const result: Record<string, "train" | "selection" | "calibration"> = {};
  for (const domain of ["retail", "airline"]) {
    const train = Object.keys(declared).filter(family => family.startsWith(`${domain}:`) && declared[family] === "train")
      .sort((a, b) => hash(["v5-fresh-neutral-split-before-labels-1", a]).localeCompare(hash(["v5-fresh-neutral-split-before-labels-1", b])));
    const calibration = Object.keys(declared).filter(family => family.startsWith(`${domain}:`) && declared[family] === "calibration");
    if (train.length !== 8 || calibration.length !== 2) throw new Error("Fresh controller requires 8 training and 2 calibration families per domain");
    train.forEach((family, index) => result[family] = index < 2 ? "selection" : "train");
    calibration.forEach(family => result[family] = "calibration");
  }
  return result;
}
export function buildFreshV5Dataset(plan: V5FreshDatasetPlan, output: string) {
  if (plan.version !== "goalspec-controller-fresh-dataset-plan-v5" || existsSync(output)) throw new Error("Invalid/new fresh dataset plan");
  const sources = new Map<string, MemoryFile>();
  const read = (path: string, expected?: string) => {
    const absolute = resolve(path), bytes = readFileSync(absolute), digest = sha(bytes);
    if (expected && digest !== expected) throw new Error("Fresh dataset source hash mismatch");
    const previous = sources.get(absolute); if (previous && previous.sha256 !== digest) throw new Error("Mutable source");
    sources.set(absolute, { path: absolute, sha256: digest }); return bytes;
  };
  const readJson = (file: MemoryFile) => JSON.parse(read(file.path, file.sha256).toString("utf8"));
  const priorManifest = JSON.parse(read(join(plan.prior.directory, "manifest.json"), plan.prior.manifestSha256).toString("utf8"));
  if (priorManifest.version !== "goalspec-controller-dataset-v5" || priorManifest.sourcePolicy !== "prior-v4-train-families-only-no-confirmation-cohorts"
    || plan.prior.datasetHash !== priorManifest.datasetHash) throw new Error("Fresh dataset requires declared permitted historical prefixes");
  const fixture = readJson(plan.cohort.fixtureManifest);
  if (fixture.generator !== "fresh-native-v5" || fixture.studyStage !== "training") throw new Error("Fresh dataset excludes development and confirmation");
  if (fixture.nativeCommit !== "2174a603f6d014ef94473ffa95957f6ce27100db") throw new Error("Fresh dataset requires the audited native candidate-graph environment");
  const freshSplits = freshV5FamilySplits(fixture.learningFamilySplit);
  // Family assignment is completed before native outcomes, messages or labels are read.
  const splits: Record<string, "train" | "selection" | "calibration"> = { ...priorManifest.splits, ...freshSplits };
  if (Object.keys(freshSplits).some(family => Object.hasOwn(priorManifest.splits, family))) throw new Error("Fresh family identity overlaps historical family");
  const memory = validateMemoryArtifact(readJson(plan.memory));
  if (memory.compilerVersion !== "goalspec-memory-v5") throw new Error("Fresh controller requires training-only v5 memory");
  const sourcePriorBytes = read(join(plan.prior.directory, "dataset.jsonl"), plan.prior.datasetHash);
  const priorRows = sourcePriorBytes.toString("utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const fitFamilies = [...new Set([...priorRows.filter(row => row.split === "train").map(row => row.familyId),
    ...Object.keys(freshSplits).filter(family => freshSplits[family] === "train")])].sort();
  const publicMemory = (frame: ExecutionFrame, family: string) => retrieveContextualMemory({ ...frame, snapshotId: memory.repositorySnapshotId }, memoryQuery(frame), memory,
    { allowedFamilies: fitFamilies, excludeFamilies: [family] });
  const rows: any[] = [], annotationInputs: any[] = [], excluded: { runId: string; reason: string }[] = [];
  const featuresFor = (context: ReturnType<typeof buildSpeculationContext>, candidates: any[]) => {
    const state = buildDecisionState(context.frame);
    return [...candidates, "NO_READ" as const, "READ_UNCOVERED" as const].map(candidate => extractV5Features(context, candidate, state));
  };
  for (const source of priorRows) {
    if (!Object.hasOwn(priorManifest.splits, source.familyId) || priorManifest.splits[source.familyId] !== source.split || /confirmation/.test(source.cohort)
      || source.frameHash !== hash(source.context.frame)) throw new Error("Historical prefix lineage changed");
    const frame: ExecutionFrame = source.context.frame;
    const context = buildSpeculationContext(frame, { memory: publicMemory(frame, source.familyId) });
    // Preserve the original public frame/hashes for exact teacher joins. Only
    // the separately declared frozen experience retrieval view is refreshed.
    rows.push({ ...source, context, features: featuresFor(context, source.candidates), goalSupervision: "masked-until-independent-annotation-join",
      retrievalSnapshotId: memory.repositorySnapshotId, originalFrameSnapshotId: frame.snapshotId });
  }
  const files = Object.fromEntries(Object.entries(plan.cohort.files).map(([name, digest]) => [name, read(join(plan.cohort.directory, name), digest).toString("utf8")]));
  const manifest = JSON.parse(files["service-manifest.json"]), design = JSON.parse(files["design.json"]), summary = JSON.parse(files["summary.json"]), contexts = JSON.parse(files["public-contexts.json"]);
  const outcomes = files["outcomes.jsonl"].trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const fixtureTasks = new Map<string, any>((fixture.tasks ?? []).map((task: any) => [task.taskId, task]));
  if (design.version !== "goalspec-experiment-v5" || design.studyStage !== "training" || summary.serviceExitCode !== 0
    || !Array.isArray(design.trials) || !Array.isArray(manifest.runs) || design.trials.length !== 40 || manifest.runs.length !== 40 || outcomes.length !== 40
    || fixtureTasks.size !== 40 || new Set(design.trials.map((trial: any) => trial.taskId)).size !== 40
    || new Set(manifest.runs.map((run: any) => run.runId)).size !== 40
    || design.trials.some((trial: any) => trial.arm !== "base" || !fixtureTasks.has(trial.taskId))
    || Object.keys(freshSplits).some(family => design.trials.filter((trial: any) => trial.family === family).length !== 2)) throw new Error("A complete 40-slot closed Base training cohort is required");
  for (const [index, configured] of manifest.runs.entries()) {
    const trial = design.trials[index], outcome = outcomes[index], task = fixtureTasks.get(trial.taskId);
    if (typeof configured.runId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(configured.runId)
      || configured.arm !== "base" || outcome.arm !== "base" || outcome.runId !== configured.runId || outcome.familyId !== trial.family
      || configured.familyId !== trial.family || configured.domain !== trial.domain || task.domain !== trial.domain
      || task.familyId !== trial.family || !freshSplits[trial.family] || outcome.studyStage !== "training") throw new Error("Fresh cohort declaration mismatch");
    const path = join(plan.cohort.directory, `${configured.runId}.json`), native = JSON.parse(read(path).toString("utf8")), publicContext = contexts[configured.runId];
    if (hash(native.record) !== hash(outcome) || !publicContext?.capturedBeforeExecution || hash(publicContext.tools) !== hash(configured.tools)) throw new Error("Fresh native public lineage mismatch");
    if (!Array.isArray(native.simulation?.messages)) { excluded.push({ runId: configured.runId, reason: "no_public_messages" }); continue; }
    const messages = publicReplayMessages(native.simulation.messages);
    let seenUser = false;
    const decisions = messages.flatMap((message, i) => { if (message.role === "user") seenUser = true; return seenUser && message.role === "assistant" ? [i] : []; });
    if (!READS[configured.domain]) throw new Error("Unsupported fresh native domain");
    const tools = Object.fromEntries(configured.tools.filter((tool: any) => READS[configured.domain].includes(tool.function.name)).map((tool: any) => [tool.function.name, tool.function.parameters]));
    for (const [boundary, index] of decisions.entries()) {
      const prefix = messages.slice(0, index);
      const frame: ExecutionFrame = { schemaVersion: 1, runId: configured.runId, boundary,
        scope: { tenantId: `custom-tau-${configured.domain}`, principalId: "native-actor", authorizationVersion: "native-v1", environmentVersion: fixture.nativeCommit, toolSchemaHash: hash(configured.tools) },
        policy: publicContext.policy, requestedObjective: prefix.filter(message => message.role === "user").map(message => message.content ?? "").join("\n"), sources: publicPrefixSources(prefix),
        goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) }, snapshotId: memory.repositorySnapshotId };
      const context = buildSpeculationContext(frame, { memory: publicMemory(frame, trial.family) });
      const candidates = nativeCandidateGraphV5(frame, tools, () => true), features = featuresFor(context, candidates);
      const policy = new NativeReadPolicy(configured.domain, frame.scope); policy.updateFrame(frame);
      const eligible = candidates.map(candidate => policy.eligible(candidate.invocation));
      // Only now use the next action as a target. No oracle fixture/reference
      // action, final database or outcome grade enters the public context.
      const actual = messages[index].calls, reads = actual.filter(action => Object.hasOwn(tools, action.tool));
      const key = (action: { tool: string; arguments: unknown }) => canonical([action.tool, action.arguments]);
      const actualKeys = new Set(reads.map(key)), targets = candidates.flatMap((candidate, i) => actualKeys.has(key(candidate.invocation)) ? [i] : []);
      if (!targets.length) targets.push(candidates.length + Number(reads.length > 0));
      const metadata = { groupId: hash([configured.runId, boundary]), familyId: trial.family, split: freshSplits[trial.family], runId: configured.runId,
        cohort: "fresh-v5-training", boundary, frameHash: hash(frame), prefixHash: hash(prefix), originalSnapshotId: manifest.snapshotId };
      rows.push({ ...metadata, context, candidates, features, eligible, targets, actual, actualRead: reads.length > 0,
        goalSupervision: "masked-until-independent-annotation-join", retrievalSnapshotId: memory.repositorySnapshotId, originalFrameSnapshotId: frame.snapshotId });
      annotationInputs.push({ ...metadata, frame: copy(frame), publicInputHash: context.publicInputHash, sourceRevisionHash: context.requestRevisionHash,
        annotationPolicy: "requested goals from this public prefix only; no future action or private evaluator" });
    }
  }
  if (new Set(rows.map(row => row.groupId)).size !== rows.length) throw new Error("Duplicate public checkpoint");
  for (const file of sources.values()) if (sha(readFileSync(file.path)) !== file.sha256) throw new Error("Fresh dataset source changed during compilation");
  const bytes = Buffer.from(rows.map(row => canonical(row)).join("\n") + "\n");
  const result = { version: "goalspec-controller-dataset-v5-fresh", sourcePolicy: "prior-v4-train-families-plus-fresh-v5-training-only",
    datasetHash: sha(bytes), splits, freshSplits, rows: rows.length, priorRows: priorRows.length, freshRows: rows.length - priorRows.length,
    preservedPriorDatasetHash: plan.prior.datasetHash, sourceInputsExcludePrivateFields: true, freshSlots: 40, excluded,
    goalLabels: "masked-until-independent-annotation-join", reliabilityLabels: "unavailable", memoryFamilyPolicy: "fit-families-only-exclude-current-family", memoryAllowedFamilies: fitFamilies,
    memoryArtifactHash: memory.contentHash, memorySnapshotId: memory.repositorySnapshotId, sources: [...sources.values()],
    compatibilityView: "Frozen v5 experience snapshot for offline feature compilation; original public frames and annotation identities retained exactly; no source authorization rewritten",
    codeSources: ["scripts/goalspec-controller-v5-fresh-dataset.ts", "src/lib/goalspec/controller-v5-features.ts", "src/lib/goalspec/experience-memory.ts", "services/goalspec-runtime/native-candidate-graph.ts"]
      .map(path => ({ path, sha256: sha(readFileSync(path)) })) };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "dataset.jsonl"), bytes, { flag: "wx" });
  writeFileSync(join(output, "manifest.json"), canonical(result) + "\n", { flag: "wx" });
  writeFileSync(join(output, "fresh-annotation-inputs.jsonl"), annotationInputs.map(row => canonical(row)).join("\n") + "\n", { flag: "wx" });
  writeFileSync(join(output, "plan.json"), canonical(plan) + "\n", { flag: "wx" });
  return { rows: result.rows, priorRows: result.priorRows, freshRows: result.freshRows, datasetHash: result.datasetHash, freshSplits, output };
}
if (process.argv[1]?.endsWith("goalspec-controller-v5-fresh-dataset.ts")) {
  if (!process.argv[2] || !process.argv[3]) throw new Error("Usage: fresh-dataset HASHED_PLAN_JSON NEW_OUTPUT_DIRECTORY");
  console.log(JSON.stringify(buildFreshV5Dataset(JSON.parse(readFileSync(resolve(process.argv[2]), "utf8")), resolve(process.argv[3])), null, 2));
}
