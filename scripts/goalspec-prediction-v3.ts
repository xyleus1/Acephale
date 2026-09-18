import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import { validateGoals } from "../src/lib/goalspec/compiler";
import type { Candidate, ExecutionFrame, GoalSet, Json, Scope } from "../src/lib/goalspec/contracts/generated";
import { validateContract } from "../src/lib/goalspec/contracts/validate";
import { compactGoalContext, predictCompactGoals } from "../src/lib/goalspec/compact-goals";
import { predictCompactCandidates } from "../src/lib/goalspec/compact-candidates";
import { memoryQuery, retrieveMemory, validateMemoryArtifact, type FrozenExperienceMemory, type MemoryRetrieval } from "../src/lib/goalspec/experience-memory";
import { RESEARCH_MODELS, providerFailure, type ModelPort, type ModelRequest } from "../src/lib/goalspec/model";
import { bindWorkflowPatterns, ContractPredictors, countTokens } from "../src/lib/goalspec/predictors";
import { FrozenRepository, type Experience } from "../src/lib/goalspec/repository";
import { isNativeNonMutatingTool, NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";
import { nativeDeterministicCandidates } from "../services/goalspec-runtime/native-bindings";
import { orderedConcurrentMap } from "./goalspec-replay-concurrency";

export const REPLAY_VERSION = "goalspec-prediction-v3.3";
export const REPLAY_ARMS = ["stateless", "paste", "salesforce", "goalspec"] as const;
export const EXTENDED_REPLAY_ARMS = ["stateless", "paste", "paste_memory", "goalspec_no_episodic", "goalspec", "oracle_goals", "shuffled_goals", "salesforce"] as const;
export type ReplayArm = typeof EXTENDED_REPLAY_ARMS[number];
export const NLL_EPSILON = 0.001;
const ENVIRONMENT = "2174a603f6d014ef94473ffa95957f6ce27100db";
const READS = {
  retail: ["find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"],
  airline: ["get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"],
};
type Domain = keyof typeof READS;
type Tool = { type: "function"; function: { name: string; parameters: Record<string, unknown>; description?: string } };
type Action = { id: string; tool: string; arguments: Record<string, Json> };
type PublicMessage = { role: "user" | "assistant" | "tool"; content: string | null; id?: string; error?: boolean; calls: Action[] };
type FileSource = { path: string; sha256: string };
type EventRow = { body: { sequence: number; previousHash: string; event: Record<string, unknown> }; hash: string };
type RunDeclaration = { runId: string; arm: string; domain: Domain; tools: Tool[] };
type ServiceManifest = { schemaVersion: number; runtimeVersion: string; snapshotId: string; heldoutFamilies: string[]; runs: RunDeclaration[] };
type DecisionKind = "read_only" | "mixed" | "write_only" | "other_tool" | "message" | "no_response" | "no_checkpoint";
export interface ReplayCheckpoint {
  id: string; runId: string; familyId: string; domain: Domain; boundary: number;
  frame: ExecutionFrame | null; frameHash: string | null; eventHash: string | null;
  nativeArtifactHash: string; prefixHash: string | null; tools: Record<string, Record<string, unknown>>;
  actual: Action[] | null; decisionKind: DecisionKind; unavailableReason: string | null;
}
export interface ReplayCohort {
  version: typeof REPLAY_VERSION; snapshotId: string; manifestHash: string; recordsHash: string; memoryHash: string;
  sourceFiles: FileSource[]; baseRunIds: string[]; excludedArmRuns: number;
  checkpoints: ReplayCheckpoint[]; records: Experience[]; memory: FrozenExperienceMemory;
}
export interface ReplayPrediction {
  arm: ReplayArm; status: "completed" | "failed" | "unavailable";
  candidates: Candidate[]; rejected: { candidateId: string; reason: string }[];
  failure: ReturnType<typeof providerFailure> | null; failureCode: string | null;
  goals: GoalSet; modelRequests: number; goalCacheHit: boolean; elapsedMs: number;
  goalStatus?: "not_requested" | "completed" | "failed" | "teacher_reference" | "deliberately_shuffled_context";
  events: unknown[];
}
export interface ReplayDecision {
  version: typeof REPLAY_VERSION; checkpoint: Omit<ReplayCheckpoint, "frame" | "tools"> & { readToolSchemaNames: string[] };
  predictions: ReplayPrediction[];
  sharedPool: { hash: string; candidates: Candidate[]; rankings: Record<string, { candidateId: string; score: number }[]> };
}
export interface ReplayOptions {
  // The caller supplies the existing budgeted provider. This module never opens
  // a ledger, reads credentials, creates a provider, or dispatches on import.
  model: ModelPort; maximumAttemptMicrodollars: number;
  concurrency?: number;
  record?: (event: unknown) => void; emit?: (row: ReplayDecision) => void | Promise<void>;
  arms?: readonly ReplayArm[];
  inferredGoals?: Record<string, GoalSet | null>;
  oracleGoals?: Record<string, GoalSet | null>;
  shuffledContexts?: Record<string, { sourceCheckpointId: string; hypotheses: { objective: string; constraints: string[] }[] } | null>;
}

const unknownGoals = (): GoalSet => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) });
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const safeRunId = (id: string) => typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
const actionKey = (action: Pick<Action, "tool" | "arguments">) => canonical([action.tool, action.arguments]);
const candidateKey = (candidate: Candidate) => actionKey(candidate.invocation);
const scopeFor = (run: RunDeclaration): Scope => ({ tenantId: `custom-tau-${run.domain}`, principalId: "native-actor",
  authorizationVersion: "native-v1", environmentVersion: ENVIRONMENT, toolSchemaHash: hash(run.tools) });

/** Parse only explicit public fields. raw_data, task and evaluator fields never enter a checkpoint. */
export function publicReplayMessages(value: unknown): PublicMessage[] {
  if (!Array.isArray(value)) throw new Error("Missing native public messages");
  return value.map(message => {
    if (!message || typeof message !== "object" || !["user", "assistant", "tool"].includes(message.role)
      || message.content !== null && message.content !== undefined && typeof message.content !== "string") throw new Error("Invalid native public message");
    const calls: Action[] = (message.tool_calls ?? []).map((call: Record<string, unknown>) => {
      if (typeof call.id !== "string" || !call.id || typeof call.name !== "string" || !call.name
        || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) throw new Error("Invalid native public call");
      return { id: call.id, tool: call.name, arguments: copy(call.arguments) as Action["arguments"] };
    });
    if (message.role !== "assistant" && calls.length) throw new Error("Calls outside an actor message");
    return { role: message.role, content: message.content ?? null, calls,
      ...(typeof message.id === "string" ? { id: message.id } : {}), ...(message.error === true ? { error: true } : {}) };
  });
}

export function publicPrefixSources(prefix: PublicMessage[]): ExecutionFrame["sources"] {
  const sources: ExecutionFrame["sources"] = {}, events: Json[] = [], signatures: string[] = [];
  const requests = new Map<string, string>(), finished = new Set<string>();
  prefix.forEach((message, index) => {
    if (message.role === "user") sources[`requirement:${index}`] = message.content ?? "";
    for (const call of message.calls) {
      if (requests.has(call.id)) throw new Error("Duplicate public call ID");
      requests.set(call.id, call.tool);
      events.push({ seq: events.length, kind: "tool_request", call_id: call.id, tool: call.tool, arguments: call.arguments });
    }
    if (message.role === "tool") {
      const tool = requests.get(message.id ?? "");
      if (!tool || finished.has(message.id!)) throw new Error("Unmatched or duplicate public observation");
      finished.add(message.id!);
      let result: Json = message.content ?? "";
      try { result = JSON.parse(message.content ?? "null") as Json; } catch { /* Preserve actual public text. */ }
      sources[`observation:${index}`] = result;
      const status = message.error ? "error" : "success";
      events.push({ seq: events.length, kind: "tool_result", call_id: message.id!, tool, status, result });
      signatures.push(`${tool}:${status}`);
    }
  });
  sources._binding_events = events; sources._signatures = signatures; return sources;
}

export function closedReplayEvents(text: string): EventRow[] {
  let previousHash = "0".repeat(64), sequence = 0;
  const rows = text.trim().split(/\r?\n/).map(line => {
    const row = JSON.parse(line) as EventRow;
    if (row.body.sequence !== sequence++ || row.body.previousHash !== previousHash || hash(row.body) !== row.hash) throw new Error("Invalid replay event hash chain");
    previousHash = row.hash; return row;
  });
  if (rows[0]?.body.event.type !== "research_manifest" || rows.at(-1)?.body.event.type !== "service_closed") throw new Error("Replay requires a closed native service");
  return rows;
}

/** Cohort selection uses only declarations and base-arm public checkpoints, never outcomes. */
export function loadReplayCohort(paths: { runDirectory: string; closedEventsPath: string; memoryPath: string; recordsPath: string }): ReplayCohort {
  const files: FileSource[] = [];
  const read = (path: string) => { const absolute = resolve(path), bytes = readFileSync(absolute);
    files.push({ path: absolute, sha256: sha(bytes) }); return bytes.toString("utf8"); };
  const manifest = JSON.parse(read(join(paths.runDirectory, "service-manifest.json"))) as ServiceManifest;
  const design = JSON.parse(read(join(paths.runDirectory, "design.json"))) as { designHash?: string; studyStage?: string; trials: { family: string; arm: string; domain?: string; taskId?: string; trial?: number; seed?: number }[] };
  if (manifest.schemaVersion !== 1 || manifest.runtimeVersion !== "v3" || !manifest.snapshotId || !Array.isArray(manifest.runs)
    || !manifest.runs.length || !Array.isArray(design.trials) || design.trials.length !== manifest.runs.length
    || new Set(manifest.runs.map(run => run.runId)).size !== manifest.runs.length) throw new Error("Invalid completed v3 cohort declaration");
  const contexts = JSON.parse(read(join(paths.runDirectory, "public-contexts.json"))) as Record<string, { capturedBeforeExecution: boolean; policy: string; tools: Tool[] }>;
  const events = closedReplayEvents(read(paths.closedEventsPath));
  const declaration = events[0].body.event;
  const declaredRuns = declaration.runs as { id: string; arm: string }[];
  if (declaration.manifestHash !== hash(manifest) || declaration.runtimeVersion !== "goalspec-v3" || !Array.isArray(declaredRuns)
    || hash(declaredRuns.map(run => [run.id, run.arm]).sort()) !== hash(manifest.runs.map(run => [run.runId, run.arm]).sort())) throw new Error("Replay events belong to another manifest");
  const memory = validateMemoryArtifact(JSON.parse(read(paths.memoryPath)));
  const records = JSON.parse(read(paths.recordsPath)) as Experience[];
  const frozen = new FrozenRepository(manifest.snapshotId, records, manifest.heldoutFamilies);
  if (memory.repositorySnapshotId !== manifest.snapshotId || declaration.memoryHash !== memory.contentHash
    || declaration.snapshotHash !== frozen.digest) throw new Error("Replay repository differs from the evaluated frozen repository");
  let retainedOutcomes: Map<string, Record<string, unknown>> | undefined;
  const validateRetainedFailure = (native: { record: Record<string, unknown>; retainedStageFailure?: boolean; notRetried?: boolean; retainedSlotFailure?: { remainingDeclaredSlotsContinue?: boolean } }, run: RunDeclaration) => {
    if (!retainedOutcomes) {
      const outcomes = read(join(paths.runDirectory, "outcomes.jsonl")).trim().split(/\r?\n/).map(line => JSON.parse(line) as Record<string, unknown>);
      retainedOutcomes = new Map(outcomes.map(row => [String(row.runId), row]));
      if (outcomes.length !== manifest.runs.length || retainedOutcomes.size !== manifest.runs.length) throw new Error("Retained failure requires every declared outcome exactly once");
      for (const [index, declared] of manifest.runs.entries()) {
        const outcome = retainedOutcomes.get(declared.runId), trial = design.trials[index];
        if (!outcome || outcome.arm !== declared.arm || outcome.domain !== declared.domain || outcome.familyId !== trial.family
          || typeof outcome.success !== "boolean" || ["taskId", "trial", "seed"].some(field => {
            const key = field as "taskId" | "trial" | "seed";
            return trial[key] !== undefined && outcome[key] !== trial[key];
          })) throw new Error("Retained failure outcomes differ from declared cohort");
      }
    }
    const record = native.record;
    if (hash(record) !== hash(retainedOutcomes.get(run.runId)) || record.success !== false || record.officialReward !== null)
      throw new Error("Retained failure artifact differs from immutable outcome");
    if (record.termination === "stage_abort") {
      const receipt = JSON.parse(read(join(paths.runDirectory, "stage-abort.json"))) as Record<string, unknown>;
      if (!native.retainedStageFailure || !native.notRetried || receipt.stageAborted !== true || receipt.allDeclaredSlotsRetained !== true
        || receipt.notRetried !== true || receipt.studyId !== record.studyId || receipt.studyStage !== record.studyStage
        || !design.designHash || receipt.designHash !== design.designHash || design.studyStage !== record.studyStage)
        throw new Error("Retained stage failure lacks matching cohort abort receipt");
    } else if (record.termination === "service_startup_error") {
      if (record.serviceReadyBeforeTrial !== false) throw new Error("Invalid retained startup failure");
    } else if (record.termination === "slot_setup_or_telemetry_error") {
      if (native.retainedSlotFailure?.remainingDeclaredSlotsContinue !== true) throw new Error("Invalid retained slot failure");
    } else throw new Error("Missing native trace is not a declared retained failure");
  };
  const checkpoints: ReplayCheckpoint[] = [], baseRunIds: string[] = [];
  for (const [runIndex, run] of manifest.runs.entries()) {
    if (!safeRunId(run.runId) || !Object.hasOwn(READS, run.domain)) throw new Error("Invalid declared run");
    if (run.arm !== "base") continue;
    baseRunIds.push(run.runId);
    if (memory.runs.some(historical => historical.id === run.runId)) throw new Error("Replay run contaminated frozen memory");
    const trial = design.trials[runIndex];
    if (trial.arm !== "base" || typeof trial.family !== "string" || !trial.family) throw new Error("Replay family provenance unavailable");
    const context = contexts[run.runId], scope = scopeFor(run);
    if (!context?.capturedBeforeExecution || !context.policy || hash(context.tools) !== hash(run.tools)) throw new Error("Replay public context differs from declared schema");
    const normalPath = join(paths.runDirectory, `${run.runId}.json`);
    const artifactPath = existsSync(normalPath) ? normalPath : join(paths.runDirectory, `${run.runId}-stage-abort.json`);
    const artifactText = read(artifactPath);
    const native = JSON.parse(artifactText) as { record: Record<string, unknown>; simulation?: { messages: unknown[] };
      retainedStageFailure?: boolean; notRetried?: boolean; retainedSlotFailure?: { remainingDeclaredSlotsContinue?: boolean } };
    if (native.record?.runId !== run.runId) throw new Error("Replay native artifact run mismatch");
    const traceMissing = native.simulation == null;
    if (traceMissing || artifactPath !== normalPath) validateRetainedFailure(native, run);
    const messages = traceMissing ? [] : publicReplayMessages(native.simulation!.messages);
    // Native simulations can begin with a fixed assistant greeting. It is not an
    // actor decision and has no execution_frame, unlike later assistant turns.
    let userSeen = false;
    const actorIndexes = messages.flatMap((message, index) => {
      if (message.role === "user") userSeen = true;
      return message.role === "assistant" && userSeen ? [index] : [];
    });
    const frames = events.flatMap(row => {
      const event = row.body.event;
      const nested = event.event as { type?: string; frame?: ExecutionFrame } | undefined;
      return event.runId === run.runId && nested?.type === "execution_frame" ? [{ frame: nested.frame!, eventHash: row.hash }] : [];
    });
    const tools = Object.fromEntries(run.tools.filter(tool => READS[run.domain].includes(tool.function.name))
      .map(tool => [tool.function.name, tool.function.parameters]));
    if (frames.length && ["stage_abort", "service_startup_error"].includes(String(native.record.termination))) throw new Error("Unstarted retained failure has execution frames");
    if (actorIndexes.length > frames.length) throw new Error("Actor response lacks a public replay checkpoint");
    if (!frames.length) checkpoints.push({ id: hash([run.runId, "no_checkpoint"]), runId: run.runId, familyId: trial.family,
      domain: run.domain, boundary: -1, frame: null, frameHash: null, eventHash: null, nativeArtifactHash: sha(artifactText),
      prefixHash: null, tools, actual: null, decisionKind: "no_checkpoint", unavailableReason: traceMissing
        ? `retained_${native.record.termination}_without_public_trace` : "native_run_has_no_public_checkpoint" });
    for (const [{ frame, eventHash }, index] of frames.map((entry, index) => [entry, index] as const)) {
      validateContract("ExecutionFrame", frame);
      if (frame.runId !== run.runId || frame.boundary !== index || hash(frame.scope) !== hash(scope)
        || frame.snapshotId !== manifest.snapshotId || frame.policy !== context.policy || frame.goals.hypotheses.length || frame.goals.unknown !== 1) throw new Error("Invalid base-arm frame provenance");
      const actorIndex = actorIndexes[index], actual = actorIndex === undefined ? null : messages[actorIndex].calls;
      const prefix = messages.slice(0, actorIndex ?? messages.length);
      const sources = publicPrefixSources(prefix);
      const prefixAvailable = prefix.some(message => message.role === "user");
      if (prefixAvailable && (hash(sources) !== hash(frame.sources)
        || frame.requestedObjective !== prefix.filter(message => message.role === "user").map(message => message.content ?? "").join("\n"))) throw new Error("Frame does not match its native visible prefix");
      if (!prefixAvailable && actual !== null) throw new Error("Actor continuation has no native user prefix");
      if (actual?.some(action => !run.tools.some(tool => tool.function.name === action.tool))) throw new Error("Actor called an undeclared tool");
      const reads = actual?.filter(action => Object.hasOwn(tools, action.tool)).length ?? 0;
      const decisionKind: DecisionKind = actual === null ? "no_response" : !actual.length ? "message"
        : reads === actual.length ? "read_only" : reads ? "mixed"
          : actual.every(action => isNativeNonMutatingTool(run.domain, action.tool)) ? "other_tool" : "write_only";
      checkpoints.push({ id: hash([run.runId, index, eventHash]), runId: run.runId, familyId: trial.family, domain: run.domain,
        boundary: index, frame: copy(frame), frameHash: hash(frame), eventHash, nativeArtifactHash: sha(artifactText),
        prefixHash: prefixAvailable ? hash(prefix) : null, tools, actual, decisionKind,
        unavailableReason: !prefixAvailable ? "native_public_prefix_unavailable" : actual === null ? "actor_returned_no_saved_response" : null });
    }
  }
  if (!baseRunIds.length) throw new Error("Replay cohort has no base arm");
  return { version: REPLAY_VERSION, snapshotId: manifest.snapshotId, manifestHash: hash(manifest), recordsHash: frozen.digest,
    memoryHash: memory.contentHash, sourceFiles: files, baseRunIds, excludedArmRuns: manifest.runs.length - baseRunIds.length,
    checkpoints, records, memory };
}

function modelGuard(model: ModelPort, maximum: number, log: (event: unknown) => void, dispatched: () => void): ModelPort {
  return { async complete(request: ModelRequest) {
    if (request.model !== RESEARCH_MODELS.candidate || request.maxOutputTokens !== 1024 || request.allocation !== "replay"
      || request.retries !== 0 || request.maximumAttemptMicrodollars !== maximum || request.tools?.length) throw new Error("Invalid replay model reservation contract");
    log({ type: "replay_model_request", id: request.id, model: request.model, allocation: request.allocation,
      maximumAttemptMicrodollars: maximum, retries: 0, maxOutputTokens: 1024,
      serializedInputHash: hash({ instructions: request.instructions, input: request.input, responseFormat: request.responseFormat ?? null }) });
    dispatched();
    const result = await model.complete(request);
    log({ type: "replay_model_response", id: request.id, model: result.model, status: result.status,
      usage: result.usage ?? null, responseTextHash: hash(result.text), refusalCount: result.refusals.length });
    if (result.model !== request.model || result.status !== "completed" || result.refusals.length || result.calls.length) throw new Error("Invalid replay model response");
    return result;
  } };
}

function validatedCandidates(candidates: Candidate[], frame: ExecutionFrame, domain: Domain,
  tools: Record<string, Record<string, unknown>>, model: ModelPort, maximum: number) {
  const validator = new ContractPredictors(model, async () => { throw new Error("Replay embeddings are disabled"); }, tools, "replay", maximum, () => {});
  const policy = new NativeReadPolicy(domain, frame.scope); policy.updateFrame(frame);
  const rejected: ReplayPrediction["rejected"] = [], accepted = new Map<string, Candidate>();
  for (const candidate of candidates) {
    let reason: string | null = null;
    try { validateContract("Candidate", candidate); } catch { reason = "candidate_contract"; }
    if (!reason && !validator.validateArguments(candidate, frame)) reason = "current_argument_binding_or_schema";
    if (!reason && !policy.eligible(candidate.invocation)) reason = "native_policy_prerequisite";
    if (reason) { rejected.push({ candidateId: candidate.id ?? "unavailable", reason }); continue; }
    const key = candidateKey(candidate), previous = accepted.get(key);
    if (!previous || previous.probability < candidate.probability) accepted.set(key, copy(candidate));
  }
  return { candidates: [...accepted.values()].sort((a, b) => b.probability - a.probability || candidateKey(a).localeCompare(candidateKey(b))).slice(0, 3), rejected };
}

function words(text: string) { return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []); }
function overlap(a: string, b: string) { const left = words(a), right = words(b); return [...left].filter(word => right.has(word)).length / Math.max(1, left.size); }

/** These are fixed feature-ranking diagnostics, not additional authentic paper implementations. */
export function sharedPoolDiagnostics(predictions: ReplayPrediction[], frame: ExecutionFrame | null, records: Experience[], memory: MemoryRetrieval | null) {
  const union = new Map<string, Candidate>();
  for (const prediction of predictions) for (const candidate of prediction.candidates) {
    const key = candidateKey(candidate);
    const previous = union.get(key);
    const normalized = { ...copy(candidate), id: hash({ sharedPool: key, scope: candidate.invocation.scope }) };
    if (!previous || previous.probability < candidate.probability
      || previous.probability === candidate.probability && canonical(normalized) < canonical(previous)) union.set(key, normalized);
  }
  const pool = [...union.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, candidate]) => candidate);
  const goals = predictions.find(prediction => prediction.arm === "goalspec")?.goals ?? unknownGoals();
  const patternCandidates = frame ? bindWorkflowPatterns(frame, records) : [];
  const scores = (candidate: Candidate) => {
    const pattern = Math.max(0, ...patternCandidates.filter(item => candidateKey(item) === candidateKey(candidate)).map(item => item.probability));
    const transition = memory?.transitions.find(item => item.to === candidate.invocation.tool);
    const context = transition ? transition.confidence * (0.5 + 0.5 * transition.successRate) : 0;
    const confusions = memory?.confusions.filter(item => item.predictedTool === candidate.invocation.tool && item.count >= 3) ?? [];
    const penalty = Math.min(0.5, confusions.reduce((total, item) => total + item.count, 0) * 0.01);
    const goal = goals.hypotheses.reduce((total, item) => total + item.probability
      * Math.max(overlap(item.objective, candidate.invocation.tool), ...records.filter(record => record.pattern.tool === candidate.invocation.tool).map(record => overlap(item.objective, record.text)), 0), 0);
    return { uniform: 0, pattern_frequency: pattern, contextual_memory: pattern + context - penalty,
      goal_plus_memory: pattern + context - penalty + goal };
  };
  const rankings = Object.fromEntries(["uniform", "pattern_frequency", "contextual_memory", "goal_plus_memory"].map(name => [name,
    pool.map(candidate => ({ candidateId: candidate.id, score: scores(candidate)[name as keyof ReturnType<typeof scores>] }))
      .sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId))]));
  return { hash: hash(pool.map(candidate => candidate.invocation)), candidates: pool, rankings };
}

/** All actual labels remain outside this function's model inputs and feature ranking. */
export async function runPredictionReplay(cohort: ReplayCohort, options: ReplayOptions): Promise<ReplayDecision[]> {
  if (cohort.version !== REPLAY_VERSION || !Number.isSafeInteger(options.maximumAttemptMicrodollars) || options.maximumAttemptMicrodollars < 1) throw new Error("Invalid replay configuration");
  const memory = validateMemoryArtifact(cohort.memory);
  const repository = new FrozenRepository(cohort.snapshotId, cohort.records);
  if (repository.digest !== cohort.recordsHash || memory.contentHash !== cohort.memoryHash || memory.repositorySnapshotId !== cohort.snapshotId) throw new Error("Replay sources changed");
  const goalCache = new Map<string, GoalSet>(), concurrency = options.concurrency ?? 1;
  const arms = options.arms ?? REPLAY_ARMS;
  if (!arms.length || new Set(arms).size !== arms.length || arms.some(arm => !(EXTENDED_REPLAY_ARMS as readonly string[]).includes(arm))) throw new Error("Invalid replay arms");
  if (concurrency > 1 && arms.some(arm => arm === "goalspec" || arm === "goalspec_no_episodic")
    && cohort.checkpoints.some(checkpoint => checkpoint.frame && checkpoint.unavailableReason === null
      && (!options.inferredGoals || !Object.hasOwn(options.inferredGoals, checkpoint.id))))
    throw new Error("Concurrent checkpoint replay requires all inferred goals precomputed");
  return orderedConcurrentMap(cohort.checkpoints, concurrency, async (checkpoint, index) => {
    const predictions: ReplayPrediction[] = [];
    const tools = Object.fromEntries(Object.entries(checkpoint.tools).sort(([a], [b]) => a.localeCompare(b)));
    const usable = checkpoint.frame !== null && checkpoint.unavailableReason === null;
    const frame = checkpoint.frame ? copy(checkpoint.frame) : null;
    if (frame && (hash(frame) !== checkpoint.frameHash || frame.runId !== checkpoint.runId || frame.snapshotId !== cohort.snapshotId)) throw new Error("Replay checkpoint changed");
    const records = usable ? repository.retrieveLocal(frame!, memoryQuery(frame!), 12) : [];
    const retrieved = usable ? retrieveMemory(frame!, memoryQuery(frame!), memory) : null;
    // Rotate execution order across checkpoints; labels do not affect order.
    const order = [...arms.slice(index % arms.length), ...arms.slice(0, index % arms.length)];
    let neutralPrediction: { candidates: Candidate[]; failed: boolean } | undefined;
    for (const arm of order) {
      const started = Date.now(), events: unknown[] = [];
      let modelRequests = 0, goals = unknownGoals(), goalCacheHit = false;
      let goalStatus: ReplayPrediction["goalStatus"] = "not_requested";
      const log = (event: unknown) => { events.push(copy(event)); options.record?.({ checkpointId: checkpoint.id, arm, event }); };
      const guarded = modelGuard(options.model, options.maximumAttemptMicrodollars, log, () => modelRequests++);
      const model: ModelPort = arm !== "shuffled_goals" ? guarded : { async complete(request) {
        const diagnostic = options.shuffledContexts?.[checkpoint.id];
        if (!diagnostic || request.responseFormat?.name !== "read_candidates_v2") throw new Error("Shuffled goal context unavailable");
        // Alter only the explicit goal hint section. It never becomes a source,
        // canonical requested goal, binding reference, or actor-visible fact.
        const input = copy(request.input), message = input[0] as { content: string };
        const sections = JSON.parse(message.content) as { id: string; text: string }[];
        const section = sections.find(item => item.id === "goals");
        if (!section) throw new Error("Shuffled goal section unavailable");
        section.text = canonical(diagnostic.hypotheses);
        message.content = canonical(sections);
        const changed = { ...request, input }, serialized = canonical({ instructions: changed.instructions, input: changed.input, responseFormat: changed.responseFormat });
        if (countTokens(serialized) > 8192 - 128) throw new Error("Shuffled diagnostic exceeds predictor input budget");
        log({ type: "shuffled_goal_context", sourceCheckpointId: diagnostic.sourceCheckpointId,
          deliberatelyUngrounded: true, insertedIntoCurrentSources: false, inputHash: hash(serialized), tokens: countTokens(serialized) });
        return guarded.complete(changed);
      } };
      let candidates: Candidate[] = [], rejected: ReplayPrediction["rejected"] = [], failure: ReplayPrediction["failure"] = null;
      let failureCode: string | null = null, status: ReplayPrediction["status"] = usable ? "completed" : "unavailable";
      if (usable) try {
        const current = { ...copy(frame!), goals };
        if (!["stateless", "paste", "goalspec_no_episodic"].includes(arm)) log({ type: "replay_memory_retrieval", queryHash: retrieved!.queryHash,
          artifactHash: retrieved!.artifactHash, episodeIds: retrieved!.episodeIds,
          transitions: retrieved!.transitions.length, recurringConfusions: retrieved!.confusions.length });
        if (arm === "goalspec" || arm === "goalspec_no_episodic") {
          const goalKey = hash([current.runId, compactGoalContext(current).revisionHash]);
          const cached = goalCache.get(goalKey);
          if (options.inferredGoals && Object.hasOwn(options.inferredGoals, checkpoint.id)) {
            const precomputed = options.inferredGoals[checkpoint.id]; goals = precomputed ? copy(precomputed) : unknownGoals();
            goalStatus = precomputed ? "completed" : "failed"; goalCacheHit = true;
          } else if (cached) { goals = copy(cached); goalCacheHit = true; goalStatus = "completed"; }
          else {
            goalStatus = "failed";
            goals = (await predictCompactGoals(model, current, { allocation: "replay", maximumAttemptMicrodollars: options.maximumAttemptMicrodollars,
              maxOutputTokens: 1024, record: log })).goals;
            goalCache.set(goalKey, copy(goals)); goalStatus = "completed";
          }
          current.goals = goals;
        } else if (arm === "oracle_goals") {
          const reference = options.oracleGoals?.[checkpoint.id];
          if (!reference) throw new Error("Teacher requested-goal reference unavailable");
          goals = copy(reference); current.goals = goals; goalStatus = "teacher_reference";
        } else if (arm === "shuffled_goals") {
          if (!options.shuffledContexts?.[checkpoint.id]) throw new Error("No cross-run shuffled goal context");
          goalStatus = "deliberately_shuffled_context";
        }
        validateGoals(current.goals, current.sources);
        if (arm === "paste") candidates = bindWorkflowPatterns(current, records);
        else {
          const neutral = arm === "salesforce" || arm === "paste_memory";
          let proposals: Candidate[];
          if (neutral && neutralPrediction) {
            proposals = copy(neutralPrediction.candidates);
            log({ type: "shared_neutral_candidate_prediction", failed: neutralPrediction.failed });
            if (neutralPrediction.failed) { status = "failed"; failureCode = "shared_neutral_prediction_failed"; }
          } else try {
            proposals = await predictCompactCandidates(model, current, arm === "stateless" ? [] : records, {
              tools, allocation: "replay", maximumAttemptMicrodollars: options.maximumAttemptMicrodollars,
              countTokens, record: log, memoryHints: arm === "stateless" || arm === "goalspec_no_episodic" ? [] : retrieved!.hints });
            if (neutral) neutralPrediction = { candidates: copy(proposals), failed: events.some(event => (event as { reason?: string })?.reason === "compact_contract") };
          } catch (error) { if (neutral) neutralPrediction = { candidates: [], failed: true }; throw error; }
          candidates = ["goalspec", "goalspec_no_episodic", "oracle_goals", "shuffled_goals"].includes(arm)
            ? [...bindWorkflowPatterns(current, records), ...(() => {
              const policy = new NativeReadPolicy(checkpoint.domain, current.scope); policy.updateFrame(current);
              return nativeDeterministicCandidates(current, tools, invocation => policy.eligible(invocation));
            })(), ...proposals]
            : arm === "paste_memory" ? [...bindWorkflowPatterns(current, records), ...proposals] : proposals;
        }
        const checked = validatedCandidates(candidates, current, checkpoint.domain, tools, model, options.maximumAttemptMicrodollars);
        candidates = checked.candidates; rejected = checked.rejected;
        if (events.some(event => event && typeof event === "object" && (event as { type?: string; reason?: string }).type === "prediction_rejected"
          && (event as { reason?: string }).reason === "compact_contract")) { status = "failed"; failureCode = "compact_candidate_contract"; }
      } catch (error) {
        status = "failed"; candidates = []; failure = providerFailure(error);
        const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
        failureCode = typeof code === "string" && /^[A-Za-z0-9_:.-]{1,160}$/.test(code) ? code : "prediction_exception";
      }
      predictions.push({ arm, status, candidates, rejected, failure, failureCode, goals, modelRequests, goalCacheHit,
        elapsedMs: Date.now() - started, goalStatus, events });
    }
    predictions.sort((a, b) => arms.indexOf(a.arm) - arms.indexOf(b.arm));
    const { frame: _frame, tools: _tools, ...publicCheckpoint } = checkpoint;
    const row: ReplayDecision = { version: REPLAY_VERSION, checkpoint: { ...copy(publicCheckpoint), readToolSchemaNames: Object.keys(tools).sort() }, predictions,
      sharedPool: sharedPoolDiagnostics(predictions, frame, records, retrieved) };
    return row;
  }, options.emit);
}

export function predicateMetrics(probability: number, actualRead: boolean) {
  const p = Math.max(NLL_EPSILON, Math.min(1 - NLL_EPSILON, probability));
  return { probability: p, nllNats: -(actualRead ? Math.log(p) : Math.log(1 - p)), brier: (p - Number(actualRead)) ** 2 };
}
/** Predeclared confidence transform, not calibrated action probabilities. No target labels enter this function. */
export function nextReadToolDistribution(candidates: Candidate[], readToolSchemaNames: string[]) {
  const universe = [...readToolSchemaNames].sort();
  if (!universe.length || new Set(universe).size !== universe.length || universe.some(name => !name)) throw new Error("Invalid audited read-tool universe");
  const weights = new Map(universe.map(name => [name, 0]));
  for (const candidate of candidates) {
    const tool = candidate.invocation.tool, confidence = candidate.probability;
    if (!weights.has(tool) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("Invalid next-tool candidate");
    weights.set(tool, Math.max(weights.get(tool)!, confidence));
  }
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(universe.map(tool => [tool,
    (1 - NLL_EPSILON) * (total ? weights.get(tool)! / total : 1 / universe.length) + NLL_EPSILON / universe.length]));
}
const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
function summarizeArm(rows: ReplayDecision[], arm: ReplayArm) {
  const paired = rows.map(row => ({ checkpoint: row.checkpoint, prediction: row.predictions.find(item => item.arm === arm)! }));
  const scored = paired.filter(({ checkpoint }) => checkpoint.actual !== null && checkpoint.unavailableReason === null);
  const reads = scored.filter(({ checkpoint }) => checkpoint.decisionKind === "read_only");
  const isTopTool = ({ checkpoint, prediction }: typeof scored[number]) => prediction.candidates[0]?.invocation.tool === checkpoint.actual![0].tool;
  const isTopExact = ({ checkpoint, prediction }: typeof scored[number]) => prediction.candidates[0] && candidateKey(prediction.candidates[0]) === actionKey(checkpoint.actual![0]);
  const predictedReads = reads.filter(({ prediction }) => prediction.candidates.length);
  const allPredicted = scored.filter(({ prediction }) => prediction.candidates.length);
  const actualRead = (kind: DecisionKind) => kind === "read_only" || kind === "mixed";
  const metrics = scored.map(({ checkpoint, prediction }) => predicateMetrics(Math.max(0, ...prediction.candidates.map(candidate => candidate.probability)), actualRead(checkpoint.decisionKind)));
  const noRead = scored.filter(({ checkpoint }) => !actualRead(checkpoint.decisionKind));
  const toolNll = reads.map(({ checkpoint, prediction }) => {
    const distribution = nextReadToolDistribution(prediction.candidates, checkpoint.readToolSchemaNames);
    const probability = distribution[checkpoint.actual![0].tool];
    if (probability === undefined) throw new Error("Observed read outside audited schema");
    return -Math.log(probability);
  });
  return { decisions: paired.length, scoredDecisions: scored.length, readOnlyDecisions: reads.length,
    mixedDecisions: scored.filter(({ checkpoint }) => checkpoint.decisionKind === "mixed").length,
    writeOnlyDecisions: scored.filter(({ checkpoint }) => checkpoint.decisionKind === "write_only").length,
    otherToolDecisions: scored.filter(({ checkpoint }) => checkpoint.decisionKind === "other_tool").length,
    messageDecisions: scored.filter(({ checkpoint }) => checkpoint.decisionKind === "message").length,
    unscorableDecisions: paired.length - scored.length, failedPredictions: paired.filter(({ prediction }) => prediction.status === "failed").length,
    modelRequestsAttempted: paired.reduce((sum, { prediction }) => sum + prediction.modelRequests, 0),
    readOnly: { nextToolCrossEntropyNats: ratio(toolNll.reduce((sum, nll) => sum + nll, 0), toolNll.length),
      top1ToolAccuracy: ratio(reads.filter(isTopTool).length, reads.length), top1FullArgumentAccuracy: ratio(reads.filter(isTopExact).length, reads.length),
      coverage: ratio(predictedReads.length, reads.length), conditionalToolPrecision: ratio(predictedReads.filter(isTopTool).length, predictedReads.length),
      conditionalFullArgumentPrecision: ratio(predictedReads.filter(isTopExact).length, predictedReads.length),
      top3FullArgumentRecall: ratio(reads.filter(({ checkpoint, prediction }) => prediction.candidates.some(candidate => candidateKey(candidate) === actionKey(checkpoint.actual![0]))).length, reads.length),
      anyBatchTop1FullArgumentMatch: ratio(reads.filter(({ checkpoint, prediction }) => prediction.candidates[0] && checkpoint.actual!.some(action => candidateKey(prediction.candidates[0]) === actionKey(action))).length, reads.length) },
    allDecisions: { coverage: ratio(allPredicted.length, scored.length), correctNoReadAbstention: ratio(noRead.filter(({ prediction }) => !prediction.candidates.length).length, noRead.length),
      readPrecision: ratio(allPredicted.filter(({ checkpoint }) => actualRead(checkpoint.decisionKind)).length, allPredicted.length),
      binaryReadPredicateNllNats: ratio(metrics.reduce((sum, metric) => sum + metric.nllNats, 0), metrics.length),
      binaryReadPredicateBrier: ratio(metrics.reduce((sum, metric) => sum + metric.brier, 0), metrics.length) } };
}

export function summarizePredictionReplay(rows: ReplayDecision[]) {
  const arms = [...new Set(rows.flatMap(row => row.predictions.map(prediction => prediction.arm)))];
  const summarizeArms = (selected: ReplayDecision[]) => {
    const summaries = Object.fromEntries(arms.map(arm => [arm, summarizeArm(selected, arm)]));
    const paste = summaries.paste?.readOnly.nextToolCrossEntropyNats;
    return Object.fromEntries(arms.map(arm => {
      const summary = summaries[arm], ce = summary.readOnly.nextToolCrossEntropyNats;
      return [arm, { ...summary, readOnly: { ...summary.readOnly,
        crossEntropyReductionVsPasteNats: paste == null || ce === null ? null : paste - ce } }];
    }));
  };
  const reads = rows.filter(row => row.checkpoint.decisionKind === "read_only" && row.checkpoint.actual !== null && row.checkpoint.unavailableReason === null);
  const controls = Object.fromEntries(["uniform", "pattern_frequency", "contextual_memory", "goal_plus_memory"].map(name => [name, {
    decisions: reads.length, top1ToolAccuracy: ratio(reads.filter(row => {
      const first = row.sharedPool.rankings[name]?.[0], candidate = row.sharedPool.candidates.find(item => item.id === first?.candidateId);
      return candidate?.invocation.tool === row.checkpoint.actual![0].tool;
    }).length, reads.length), top1FullArgumentAccuracy: ratio(reads.filter(row => {
      const first = row.sharedPool.rankings[name]?.[0], candidate = row.sharedPool.candidates.find(item => item.id === first?.candidateId);
      return candidate && candidateKey(candidate) === actionKey(row.checkpoint.actual![0]);
    }).length, reads.length), poolOracleFullArgumentCoverage: ratio(reads.filter(row => row.sharedPool.candidates.some(candidate => candidateKey(candidate) === actionKey(row.checkpoint.actual![0]))).length, reads.length),
  }]));
  return { version: REPLAY_VERSION, label: "Frozen base-trajectory read-only prediction replay; not task success or measured live latency",
    model: RESEARCH_MODELS.candidate, maxOutputTokens: 1024, allocation: "replay", retries: 0,
    scoring: { firstCallTarget: true, mixedBatchesExcludedFromReadOnlyAccuracy: true, absentResponsesAreUnscorable: true,
      failureHandling: "All failures remain in denominators; valid deterministic fallback proposals can remain when the model returns a malformed candidate contract",
      predicateProbability: "maximum valid candidate confidence, clipped to [epsilon, 1-epsilon]",
      epsilon: NLL_EPSILON, nll: "Uncalibrated-confidence binary read-predicate cross-entropy estimate in nats, not true conditional entropy",
      nextToolCrossEntropy: "Uncalibrated categorical next-read-tool cross-entropy proxy in nats, conditional on read_only checkpoints; not full-action likelihood or true conditional entropy",
      nextToolDistribution: "Entire declared audited read-tool schema; maximum valid candidate confidence per tool, normalized then mixed with epsilon uniform mass; uniform for abstention or zero total confidence",
      crossEntropyReduction: "PASTE categorical cross-entropy minus arm categorical cross-entropy on the same read-only checkpoints; estimated cross-entropy reduction, not true conditional entropy reduction",
      argumentLikelihood: "Not estimated; full arguments are scored by exact-match accuracy only",
      paperFidelity: "PASTE and Salesforce are read-only paper-based adapters; Salesforce's original action prediction includes writes and messages",
      rankingControls: "Identical union pool with fixed label-blind feature scores; diagnostics, not model replications",
      timing: "Offline replay can overlap independent requests; elapsed prediction timings are not native live latency or fair serial arm latency comparisons. The dispatch plan records concurrency.",
      modelRequestAccounting: "Harness attempts include budget refusals before dispatch; physical request usage and billed cost come from the caller's budgeted provider ledger/events",
      rankingFormula: { uniform: "0", pattern_frequency: "maximum matching symbolic pattern confidence",
        contextual_memory: "pattern + transition_frequency * (0.5 + 0.5 * verified_success_rate) - min(0.5, 0.01 * repeated_confusion_count)",
        goal_plus_memory: "contextual_memory + goal_probability_weighted_lexical_overlap" } },
    baseRuns: new Set(rows.map(row => row.checkpoint.runId)).size, decisions: rows.length,
    arms: summarizeArms(rows), sharedPoolControls: controls,
    families: Object.fromEntries([...new Set(rows.map(row => row.checkpoint.familyId))].sort().map(family => [family,
      summarizeArms(rows.filter(row => row.checkpoint.familyId === family))])) };
}

/** Create immutable output before dispatch. Every completed/failed prediction is appended immediately. */
export function replayCodeSources() {
  const codeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const codePaths = ["scripts/goalspec-prediction-v3.ts", "scripts/goalspec-replay-concurrency.ts", "services/goalspec-runtime/native-read-policy.ts", "services/goalspec-runtime/native-bindings.ts",
    ...["canonical", "compiler", "tokens", "current-bindings", "compact-goals", "compact-candidates", "experience-memory", "model", "budget", "patterns", "predictors", "repository", "contracts/validate"].map(name => `src/lib/goalspec/${name}.ts`),
    "src/lib/goalspec/contracts/v1.schema.json"];
  return codePaths.map(path => ({ path, sha256: sha(readFileSync(resolve(codeRoot, path))) }));
}
export function createReplayWriter(directory: string, cohort: ReplayCohort) {
  const target = resolve(directory); mkdirSync(target, { recursive: false });
  const codeSources = replayCodeSources();
  const manifest = { version: REPLAY_VERSION, snapshotId: cohort.snapshotId, manifestHash: cohort.manifestHash,
    memoryHash: cohort.memoryHash, recordsHash: cohort.recordsHash, sourceFiles: cohort.sourceFiles,
    baseRunIds: cohort.baseRunIds, checkpointIds: cohort.checkpoints.map(checkpoint => checkpoint.id), excludedArmRuns: cohort.excludedArmRuns,
    model: RESEARCH_MODELS.candidate, maxOutputTokens: 1024, allocation: "replay", retries: 0, codeSources, codeHash: hash(codeSources),
    checkpointSelection: "exact chosen base-arm checkpoints listed in checkpointIds; may be a predeclared budget-limited subset; selection.json records the parent cohort and omissions when dispatched by the budgeted runner" };
  writeFileSync(join(target, "manifest.json"), canonical(manifest) + "\n", { flag: "wx" });
  writeFileSync(join(target, "predictions.jsonl"), "", { flag: "wx" });
  writeFileSync(join(target, "model-events.jsonl"), "", { flag: "wx" });
  let previousHash = "0".repeat(64), sequence = 0, closed = false;
  let eventHash = "0".repeat(64), eventSequence = 0;
  const rows: ReplayDecision[] = [];
  return { record(event: unknown) {
    if (closed) throw new Error("Replay output already closed");
    const body = { sequence: eventSequence, previousHash: eventHash, event }, nextHash = hash(body);
    appendFileSync(join(target, "model-events.jsonl"), canonical({ body, hash: nextHash }) + "\n");
    eventHash = nextHash; eventSequence++;
  }, emit(row: ReplayDecision) {
    if (closed || cohort.checkpoints[sequence]?.id !== row.checkpoint.id) throw new Error("Replay output order changed");
    const body = { sequence, previousHash, row }, rowHash = hash(body);
    appendFileSync(join(target, "predictions.jsonl"), canonical({ body, hash: rowHash }) + "\n");
    rows.push(copy(row)); sequence++; previousHash = rowHash;
  }, finish() {
    if (closed || sequence !== cohort.checkpoints.length) throw new Error("Cannot finalize incomplete replay");
    const summary = summarizePredictionReplay(rows);
    writeFileSync(join(target, "summary.json"), canonical(summary) + "\n", { flag: "wx" });
    writeFileSync(join(target, "completion.json"), canonical({ status: "complete", rows: sequence, tailHash: previousHash,
      manifestHash: sha(readFileSync(join(target, "manifest.json"))), predictionsHash: sha(readFileSync(join(target, "predictions.jsonl"))),
      summaryHash: sha(readFileSync(join(target, "summary.json"))), modelEventsHash: sha(readFileSync(join(target, "model-events.jsonl"))),
      modelEventTailHash: eventHash, modelEvents: eventSequence }) + "\n", { flag: "wx" });
    closed = true; return summary;
  } };
}

function main() {
  const [command, runDirectory, closedEventsPath, memoryPath, recordsPath] = process.argv.slice(2);
  if (command !== "inspect" || !runDirectory || !closedEventsPath || !memoryPath || !recordsPath) throw new Error("Usage: goalspec-prediction-v3.ts inspect RUN CLOSED_EVENTS MEMORY RECORDS (no API dispatch)");
  const cohort = loadReplayCohort({ runDirectory, closedEventsPath, memoryPath, recordsPath });
  process.stdout.write(JSON.stringify({ version: cohort.version, baseRuns: cohort.baseRunIds.length, checkpoints: cohort.checkpoints.length,
    scorable: cohort.checkpoints.filter(checkpoint => checkpoint.unavailableReason === null).length,
    memoryHash: cohort.memoryHash, recordsHash: cohort.recordsHash, providerCalls: 0 }) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
