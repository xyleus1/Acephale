import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame, Json } from "../src/lib/goalspec/contracts/generated";
import { validateContract } from "../src/lib/goalspec/contracts/validate";
import { LocalController } from "../src/lib/goalspec/controller";
import { buildDecisionState, extractCandidateFeatures, CONTROLLER_FEATURE_VERSION } from "../src/lib/goalspec/controller-features";
import { nativeCandidateGraph } from "../services/goalspec-runtime/native-candidate-graph";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";
import { closedReplayEvents, publicPrefixSources, publicReplayMessages } from "./goalspec-prediction-v3";

export const VERSION = "goalspec-frozen-native-controller-replay-v1";
const ENVIRONMENT = "2174a603f6d014ef94473ffa95957f6ce27100db";
const READS = { retail: ["find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"],
  airline: ["get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"] };
type Domain = keyof typeof READS;
type Tool = { type: "function"; function: { name: string; parameters: Record<string, unknown> } };
type Action = { tool: string; arguments: Record<string, Json> };
type Run = { runId: string; arm: string; domain: Domain; tools: Tool[] };
type Trial = { family: string; domain: Domain; taskId: string; variant: number; trial: number; seed: number; arm: string };
type Input = { runDirectory: string; closedEventsPath: string; controllerPath: string; controllerSha256: string;
  expectedStage: "development" | "confirmation"; closedConfirmed: boolean };
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const invocationKey = (value: Action) => canonical([value.tool, value.arguments]);
const safeRunId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
const sourceHash = (path: string) => ({ path: resolve(path), sha256: sha(readFileSync(path)) });

/** This function has no action-label or native-task input. Both rankers share exactly this bounded public pool. */
export function predictPublicCheckpoint(frame: ExecutionFrame, domain: Domain,
  tools: Record<string, Record<string, unknown>>, controller: LocalController) {
  validateContract("ExecutionFrame", frame);
  const state = buildDecisionState(frame), policy = new NativeReadPolicy(domain, frame.scope);
  policy.updateFrame(frame);
  const pool = nativeCandidateGraph(frame, tools, () => true, { maxCandidates: 32 });
  const candidateEntries = pool.map(candidate => ({ candidate, eligible: policy.eligible(candidate.invocation),
    featureHash: hash(extractCandidateFeatures(state, candidate)) }));
  const universes = (["proposal", "policy-ready"] as const).flatMap(universe => {
    const entries = candidateEntries.filter(entry => universe === "proposal" || entry.eligible), candidates = entries.map(entry => entry.candidate);
    const scores = controller.score(state, candidates), byId = new Map(scores.candidates.map(score => [score.candidateId, score]));
    const poolHash = hash(candidates), threshold = controller.artifact.thresholds;
    return (["current-prior", "frozen-logistic"] as const).map(ranker => {
      const actionReadProbability = ranker === "current-prior" ? Number(candidates.length > 0) : scores.actionRead;
      const ranked = candidates.map(candidate => {
        const model = byId.get(candidate.id)!;
        return { candidate, nextAction: ranker === "current-prior" ? candidate.probability : model.nextAction,
          usefulWithin2: ranker === "current-prior" ? candidate.probability : model.usefulWithin2,
          readiness: ranker === "current-prior" ? 1 : model.readiness };
      }).sort((a, b) => (b.nextAction + b.usefulWithin2) - (a.nextAction + a.usefulWithin2) || a.candidate.id.localeCompare(b.candidate.id));
      const predictedRead = actionReadProbability >= (ranker === "current-prior" ? 0.5 : threshold.actionRead);
      const admitted = predictedRead ? ranked.filter(entry => ranker === "current-prior"
        || entry.usefulWithin2 >= threshold.usefulWithin2 && entry.readiness >= threshold.readiness) : [];
      return { universe, ranker, poolHash, poolSize: candidates.length, actionReadProbability, predictedRead,
        ranked, admittedCandidateIds: admitted.slice(0, 3).map(entry => entry.candidate.id) };
    });
  });
  return { frameHash: hash(frame), stateHash: hash(state), actionFeaturesHash: hash(extractCandidateFeatures(state, null)),
    candidatePoolHash: hash(pool), candidates: candidateEntries, universes };
}
export type PublicPrediction = ReturnType<typeof predictPublicCheckpoint>;

/** Apply labels only after prediction. Matching is against any eligible read in the next actor batch. */
export function scorePublicPrediction(prediction: PublicPrediction | null, actual: Action[] | null, readTools: string[],
  identity: Record<string, unknown>, unavailableReason: string | null) {
  const reads = actual?.filter(action => readTools.includes(action.tool)) ?? null;
  const actualRead = reads === null ? null : reads.length > 0;
  const keys = new Set(reads?.map(invocationKey)), tools = new Set(reads?.map(action => action.tool));
  const rows = prediction?.universes ?? (["proposal", "policy-ready"] as const).flatMap(universe =>
    (["current-prior", "frozen-logistic"] as const).map(ranker => ({ universe, ranker, poolHash: null, poolSize: 0,
      actionReadProbability: null, predictedRead: null, ranked: [] as PublicPrediction["universes"][number]["ranked"], admittedCandidateIds: [] as string[] })));
  return rows.map(row => {
    const exact = (top: typeof row.ranked) => top.some(entry => keys.has(invocationKey(entry.candidate.invocation)));
    const tool = (top: typeof row.ranked) => top.some(entry => tools.has(entry.candidate.invocation.tool));
    const status = unavailableReason || actual === null || !prediction ? "unavailable" : "completed";
    const known = actualRead !== null, scoredRead = actualRead === true;
    const p = row.actionReadProbability === null ? null : Math.max(1e-6, Math.min(1 - 1e-6, row.actionReadProbability));
    const mass = Object.fromEntries(readTools.map(name => [name, 0.001]));
    for (const entry of row.ranked) mass[entry.candidate.invocation.tool] += entry.nextAction;
    const total = Object.values(mass).reduce((sum, value) => sum + value, 0);
    return { ...identity, universe: row.universe, ranker: row.ranker, poolHash: row.poolHash, status,
      unavailableReason: unavailableReason ?? (actual === null ? "actor_response_unavailable" : !prediction ? "prediction_unavailable" : null),
      actualRead, actualReadCalls: reads?.length ?? null, poolSize: row.poolSize, poolCovered: scoredRead ? exact(row.ranked) : null,
      toolTop1: scoredRead ? tool(row.ranked.slice(0, 1)) : null, toolTop3: scoredRead ? tool(row.ranked.slice(0, 3)) : null,
      exactTop1: scoredRead ? exact(row.ranked.slice(0, 1)) : null, exactTop3: scoredRead ? exact(row.ranked.slice(0, 3)) : null,
      gatedExactTop1: scoredRead ? exact(row.ranked.filter(entry => row.admittedCandidateIds.includes(entry.candidate.id)).slice(0, 1)) : null,
      predictedRead: row.predictedRead, actionReadProbability: row.actionReadProbability,
      actionNll: known && p !== null ? -Math.log(actualRead ? p : 1 - p) : null,
      actionBrier: known && row.actionReadProbability !== null ? (row.actionReadProbability - Number(actualRead)) ** 2 : null,
      toolCrossEntropyEstimateNats: scoredRead && prediction ? [...tools].reduce((sum, name) => sum - Math.log(mass[name] / total), 0) / tools.size : null,
      ranking: row.ranked.slice(0, 3).map(entry => ({ candidateId: entry.candidate.id, invocation: entry.candidate.invocation,
        nextAction: entry.nextAction, usefulWithin2: entry.usefulWithin2 })) };
  });
}

/** Follow relative imports without executing them; bind the exact feature/compiler/ranker source bytes. */
function codeSources(root: string) {
  const pending = [resolve(root, "scripts/goalspec-controller-native-v4-replay.ts")], found = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!;
    if (found.has(path)) continue;
    found.add(path);
    if (!path.endsWith(".ts")) continue;
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*["'](\.[^"']+)["']/g)) {
      const target = resolve(dirname(path), match[1]);
      const candidate = [target, `${target}.ts`, `${target}.json`, join(target, "index.ts")].find(existsSync);
      if (candidate && (candidate.startsWith(root + "/") || candidate.startsWith(root + "\\"))) pending.push(candidate);
    }
  }
  return [...found, join(root, "package.json"), join(root, "package-lock.json")].sort().map(sourceHash);
}

export function runFrozenNativeReplay(input: Input, output: string, root = resolve(".")) {
  if (!input.closedConfirmed || !["development", "confirmation"].includes(input.expectedStage)
    || !/^[0-9a-f]{64}$/.test(input.controllerSha256)) throw new Error("Explicit closed cohort, stage and controller SHA256 required");
  if (existsSync(output)) throw new Error("Replay output must be new");
  const sourceFiles: { path: string; sha256: string }[] = [];
  const read = (path: string) => { const bytes = readFileSync(path); sourceFiles.push({ path: resolve(path), sha256: sha(bytes) }); return bytes.toString("utf8"); };
  const controllerText = read(input.controllerPath);
  if (sha(controllerText) !== input.controllerSha256) throw new Error("Chosen controller file SHA256 mismatch");
  const controller = new LocalController(JSON.parse(controllerText));
  if (controller.artifact.architecture !== "logistic") throw new Error("The frozen selected logistic artifact is required");
  const manifest = JSON.parse(read(join(input.runDirectory, "service-manifest.json"))) as {
    schemaVersion: number; runtimeVersion: string; snapshotId: string; studyId: string; studyStage: string; runs: Run[] };
  const design = JSON.parse(read(join(input.runDirectory, "design.json"))) as { version: string; studyId: string; studyStage: string; designHash: string; trials: Trial[] };
  const summary = JSON.parse(read(join(input.runDirectory, "summary.json")));
  const plan = JSON.parse(read(join(input.runDirectory, "dispatch-plan.json")));
  if (manifest.schemaVersion !== 1 || manifest.runtimeVersion !== "v4" || !manifest.snapshotId || manifest.studyStage !== input.expectedStage
    || design.version !== "goalspec-live-v4" || design.studyId !== manifest.studyId || design.studyStage !== manifest.studyStage
    || summary.version !== "goalspec-live-v4" || summary.designHash !== design.designHash || plan.version !== "goalspec-dispatch-v4"
    || hash(plan.design) !== hash(design) || plan.inputs?.controller?.sha256 !== input.controllerSha256
    || !manifest.runs.length || manifest.runs.length !== design.trials.length
    || new Set(manifest.runs.map(run => run.runId)).size !== manifest.runs.length) throw new Error("Closed v4 declaration or frozen controller lineage mismatch");
  const text = read(input.closedEventsPath), events = closedReplayEvents(text), announcement = events[0].body.event, eventLines = text.split("\n");
  if (!text.endsWith("\n") || events.some((event, i) => canonical(event) !== eventLines[i])) throw new Error("Closed events must retain canonical committed bytes");
  if (announcement.manifestHash !== hash(manifest) || announcement.runtimeVersion !== "goalspec-v4"
    || hash((announcement.runs as any[]).map(run => [run.id, run.arm]).sort()) !== hash(manifest.runs.map(run => [run.runId, run.arm]).sort())) throw new Error("Closed events belong to another cohort");
  const outcomes = read(join(input.runDirectory, "outcomes.jsonl")).trim().split(/\r?\n/).map(line => JSON.parse(line));
  const outcomeMap = new Map(outcomes.map(row => [row.runId, row]));
  if (outcomes.length !== manifest.runs.length || outcomeMap.size !== manifest.runs.length) throw new Error("Entire declared cohort must be closed before Base traces are read");
  const usedFamilies = new Set([...controller.artifact.lineage.trainFamilies, ...controller.artifact.lineage.selectionFamilies, ...controller.artifact.lineage.calibrationFamilies]);
  const counts: Record<string, number> = {};
  for (const [index, run] of manifest.runs.entries()) {
    const row = outcomeMap.get(run.runId), trial = design.trials[index];
    if (!safeRunId(run.runId) || !Object.hasOwn(READS, run.domain) || !row || typeof row.success !== "boolean"
      || row.arm !== run.arm || row.domain !== run.domain || trial.arm !== run.arm || trial.domain !== run.domain
      || ["family", "taskId", "variant", "trial", "seed"].some(key => row[key] !== (trial as any)[key])
      || row.studyId !== design.studyId || row.studyStage !== design.studyStage || row.officialReward !== null) throw new Error("Declared outcome identity mismatch");
    if (usedFamilies.has(trial.family) || usedFamilies.has(`${run.domain}:${trial.family}`)) throw new Error("Fresh replay family overlaps controller fitting or selection");
    counts[run.arm] = (counts[run.arm] ?? 0) + 1;
  }
  if (hash(counts) !== hash(summary.counts) || outcomes.reduce((sum, row) => sum + Number(row.success), 0) !== summary.successes) throw new Error("Cohort summary differs from complete outcomes");
  const sources = codeSources(root);
  for (const source of sources) {
    const name = source.path.slice(resolve(root).length + 1).replace(/\\/g, "/"), frozen = plan.runtimeSources?.[name];
    if (frozen && frozen.sha256 !== source.sha256) throw new Error("Frozen controller execution source changed");
  }
  for (const name of ["src/lib/goalspec/controller.ts", "src/lib/goalspec/controller-features.ts", "services/goalspec-runtime/native-candidate-graph.ts", "services/goalspec-runtime/native-read-policy.ts"])
    if (!plan.runtimeSources?.[name]) throw new Error("Dispatch plan lacks required frozen feature or candidate source");
  const contexts = JSON.parse(read(join(input.runDirectory, "public-contexts.json")));
  const checkpoints: Record<string, unknown>[] = [], scored: ReturnType<typeof scorePublicPrediction> = [], baseRunIds: string[] = [];
  for (const [runIndex, run] of manifest.runs.entries()) {
    if (run.arm !== "base") continue;
    baseRunIds.push(run.runId);
    const trial = design.trials[runIndex], outcome = outcomeMap.get(run.runId), context = contexts[run.runId];
    const tools = Object.fromEntries(run.tools.filter(tool => READS[run.domain].includes(tool.function.name)).map(tool => [tool.function.name, tool.function.parameters]));
    const frames = events.flatMap(event => {
      const nested = event.body.event.event as { type?: string; frame?: ExecutionFrame } | undefined;
      return event.body.event.runId === run.runId && nested?.type === "execution_frame" ? [{ frame: nested.frame!, eventHash: event.hash }] : [];
    });
    let messages: ReturnType<typeof publicReplayMessages> = [], runReason: string | null = null;
    const path = join(input.runDirectory, `${run.runId}.json`);
    try {
      if (!context?.capturedBeforeExecution || !context.policy || hash(context.tools) !== hash(run.tools)) throw new Error("public_context_mismatch");
      const native = JSON.parse(read(path));
      if (hash(native.record) !== hash(outcome)) throw new Error("native_record_mismatch");
      messages = publicReplayMessages(native.simulation?.messages);
    } catch (error) { runReason = error instanceof Error && ["public_context_mismatch", "native_record_mismatch"].includes(error.message) ? error.message : "public_trace_unavailable"; }
    let userSeen = false;
    const actors = messages.flatMap((message, index) => { if (message.role === "user") userSeen = true; return message.role === "assistant" && userSeen ? [index] : []; });
    for (let boundary = 0; boundary < Math.max(1, frames.length, actors.length); boundary++) {
      const entry = frames[boundary], index = actors[boundary], prefix = messages.slice(0, index ?? messages.length);
      const identity = { id: hash([run.runId, boundary, entry?.eventHash ?? "missing"]), runId: run.runId, familyId: trial.family,
        domain: run.domain, boundary, taskId: trial.taskId, variant: trial.variant, trial: trial.trial, stage: design.studyStage };
      let reason = runReason, prediction: PublicPrediction | null = null;
      try {
        if (reason) throw new Error(reason);
        if (!entry) throw new Error("public_checkpoint_unavailable");
        const frame = entry.frame;
        const scope = { tenantId: `custom-tau-${run.domain}`, principalId: "native-actor", authorizationVersion: "native-v1",
          environmentVersion: ENVIRONMENT, toolSchemaHash: hash(run.tools) };
        if (frame.runId !== run.runId || frame.boundary !== boundary || hash(frame.scope) !== hash(scope) || frame.snapshotId !== manifest.snapshotId
          || frame.policy !== context.policy || frame.goals.hypotheses.length || frame.goals.unknown !== 1) throw new Error("base_frame_provenance_mismatch");
        const sources = publicPrefixSources(prefix);
        if (!prefix.some(message => message.role === "user") || hash(sources) !== hash(frame.sources)
          || frame.requestedObjective !== prefix.filter(message => message.role === "user").map(message => message.content ?? "").join("\n")) throw new Error("public_prefix_mismatch");
        prediction = predictPublicCheckpoint(copy(frame), run.domain, tools, controller);
      } catch (error) { reason = error instanceof Error ? error.message : "prediction_unavailable"; }
      // No actual/future action has entered frame, candidates, features or ranking above.
      let actual = index === undefined ? null : messages[index].calls;
      if (actual?.some(action => !run.tools.some(tool => tool.function.name === action.tool))) { actual = null; reason = "undeclared_actual_tool"; }
      const row = { ...identity, status: reason || actual === null ? "unavailable" : "completed", unavailableReason: reason,
        prefixHash: prefix.length ? hash(prefix) : null, eventHash: entry?.eventHash ?? null, actual,
        readToolNames: Object.keys(tools), prediction };
      checkpoints.push(row);
      scored.push(...scorePublicPrediction(prediction, actual, Object.keys(tools), identity, reason));
    }
  }
  if (!baseRunIds.length) throw new Error("Cohort has no declared Base runs");
  for (const source of [...sourceFiles, ...sources]) if (sourceHash(source.path).sha256 !== source.sha256) throw new Error("Replay source changed during scoring");
  const checkpointBytes = checkpoints.map(canonical).join("\n") + "\n", scoreBytes = scored.map(canonical).join("\n") + "\n";
  const report = { version: VERSION, cohortStage: design.studyStage, studyId: design.studyId,
    label: design.studyStage === "confirmation" ? "fresh family-held-out Base-prefix controller replay; custom tau-compatible pilot" : "fresh development Base-prefix controller replay",
    heldoutFamilies: [...new Set(design.trials.map(trial => trial.family))], baseRunIds, declaredRuns: manifest.runs.length,
    checkpoints: checkpoints.length, completeDeclaredCohort: true, sourceInputsExcludePrivateFields: true, labelsReadAfterPredictions: true,
    frozenControllerHash: controller.artifact.contentHash, controllerFileSha256: input.controllerSha256, compilerVersion: CONTROLLER_FEATURE_VERSION,
    scoresSha256: sha(scoreBytes), checkpointsSha256: sha(checkpointBytes), sourceFiles, codeFiles: sources,
    providerCalls: 0, fittedModels: 0, memoryModified: false,
    semantics: { topK: "Any matching eligible read invocation in the next actor batch; ungated rank Top1/Top3, full admission gate separately",
      noRead: "Read-head specificity among observed actor decisions with no catalog read; messages and writes are NO_READ labels",
      crossEntropy: "Normalized summed independent per-candidate nextAction scores plus .001 per read tool; cross-entropy estimate, not true conditional entropy",
      unavailable: "Every Base run and recorded checkpoint retained; unknown labels reported separately; known-label prediction failures remain misses",
      latency: "No live timing or task success inferred from offline replay" } };
  mkdirSync(output, { recursive: false });
  writeFileSync(join(output, "checkpoints.jsonl"), checkpointBytes, { flag: "wx" });
  writeFileSync(join(output, "scores.jsonl"), scoreBytes, { flag: "wx" });
  writeFileSync(join(output, "manifest.json"), canonical(report) + "\n", { flag: "wx" });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [inputPath, output] = process.argv.slice(2);
  if (!inputPath || !output) throw new Error("Use INPUTS_JSON NEW_OUTPUT_DIRECTORY; explicit closedConfirmed and controllerSha256 required in inputs");
  const result = runFrozenNativeReplay(JSON.parse(readFileSync(inputPath, "utf8")), resolve(output));
  console.log(JSON.stringify({ output: resolve(output), checkpoints: result.checkpoints, baseRuns: result.baseRunIds.length,
    controller: result.frozenControllerHash, noProviderCalls: true }));
}
