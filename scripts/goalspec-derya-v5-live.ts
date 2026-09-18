import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, Invocation, Json } from "../src/lib/goalspec/contracts/generated";
import { RESEARCH_MODELS, type ModelPort } from "../src/lib/goalspec/model";
import { countTokens, ContractPredictors } from "../src/lib/goalspec/predictors";
import { predictGoalStateDeltas } from "../src/lib/goalspec/goal-state-protocol-v4c";
import { GoalSpecSessionV5 } from "../src/lib/goalspec/session-v5";
import { LocalControllerV5, type ControllerV5Artifact } from "../src/lib/goalspec/controller-v5";
import { V5_FEATURE_VERSION, V5_NEUTRAL_DIMENSION, V5_GOAL_DIMENSION } from "../src/lib/goalspec/controller-v5-features";
import { FrozenRepository } from "../src/lib/goalspec/repository";
import { SpeculationScheduler } from "../src/lib/goalspec/scheduler";
import { DeryaReadExecutor, readDeryaAuthoritative, auditedDeryaConnection, DERYA_READ_TOOLS, type DeryaReadTool } from "../src/lib/goalspec-adapters/derya-read-executor";
import { deryaProjection } from "../src/lib/goalspec-adapters/derya-projections";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../services/goalspec-runtime/artifacts";
import { researchProvider, TrialLedger, maximumCost, assertResearchHostReady } from "../services/goalspec-runtime/provider";

export const DERYA_LIVE_ARMS = ["base", "neutral", "goal54"] as const;
export type DeryaLiveArm = typeof DERYA_LIVE_ARMS[number];
export const DERYA_LIVE_POLICY = "You are an authorized operator answering a synthetic Derya database read task. Use the available read tools to obtain current facts. Never guess identifiers or values from names. Follow the user's requested field and returned ordering exactly. After reading, return exactly one JSON object with a values array of strings. Do not perform writes or external actions. You have at most two model decisions and four tool calls.";
const searchProperties = { q: { type: "string" }, type: { type: "string", enum: ["FORWARDING", "SOURCING"] }, limit: { type: "integer", minimum: 1, maximum: 50 } };
export const DERYA_LIVE_SCHEMAS: Record<DeryaReadTool, Record<string, unknown>> = {
  search_jobs: { type: "object", properties: searchProperties, additionalProperties: false },
  search_inquiries: { type: "object", properties: searchProperties, additionalProperties: false },
  search_companies: { type: "object", properties: { q: { type: "string" }, limit: searchProperties.limit }, additionalProperties: false },
  list_open_inquiries: { type: "object", properties: { type: searchProperties.type, limit: searchProperties.limit }, additionalProperties: false },
  get_job: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"], additionalProperties: false },
};
const descriptions: Record<DeryaReadTool, string> = {
  search_jobs: "Search office jobs, ordered by latest update then ID. Returns id and reference, among other fields.",
  search_inquiries: "Search office inquiries, ordered by latest received date then ID. Returns id and subject, among other fields.",
  search_companies: "Search visible companies by name, ordered by ID. Returns id and name, among other fields.",
  list_open_inquiries: "List open inquiries, ordered by latest received date then ID. Returns id and subject, among other fields.",
  get_job: "Read a job by explicit job_id. Returns documents (id/name/status), milestones (type/planned/actual), and supplier or carrier offers, among other fields.",
};
const tools = DERYA_READ_TOOLS.map(name => ({ type: "function" as const, name, description: descriptions[name], parameters: DERYA_LIVE_SCHEMAS[name], strict: false }));
type Fixture = { id: string; principal: { id: string; officeId: string; accessKind: string }; invocation: Invocation; ids: Record<string, string> };
export type DeryaLiveTask = { taskId: string; familyId: string; request: string; scope: Invocation["scope"]; principal: Fixture["principal"] };
type Truth = { taskId: string; invocation: Invocation; observationHash: string; values: string[]; field: string; collection?: string };
type SourceFile = { path: string; sha256: string };
type Plan = { version: "derya-live-read-v5.1"; studyId: string; hash: string; budgetJournal: string; allowanceMicrodollars: 750000;
  actor: typeof RESEARCH_MODELS.actor; goal: typeof RESEARCH_MODELS.goal; actorContext: "hypotheses"; epochMode: "off";
  tasks: DeryaLiveTask[]; trials: { runId: string; taskId: string; arm: DeryaLiveArm }[]; sources: SourceFile[];
  privateTruth: SourceFile; fixtureSource: SourceFile; profileReport: SourceFile;
  coldController: ControllerV5Artifact; estimate: { toolMs: number; validationMs: number; schedulingMs: number; predictionMs: number; contentionMs: number; contextMs: number; measuredExposureBenefitMs: number } };
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const source = (path: string): SourceFile => ({ path: resolve(path), sha256: sha(readFileSync(path)) });
const save = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
export function deryaFailureType(error: unknown): string {
  const name = error && typeof error === "object" ? Object.getPrototypeOf(error)?.constructor?.name : undefined;
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(name) ? name : "UnknownError";
}
function databaseUrl() {
  const url = process.env.GOALSPEC_EPOCH_TEST_DATABASE_URL;
  if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/goalspec_derya_v5_test") throw new Error("Dedicated loopback fixture database required");
  return url;
}
function sourcesIn(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourcesIn(join(path, entry.name))
    : /\.(ts|json)$/.test(entry.name) ? [join(path, entry.name)] : []);
}
export function coldDeryaController(): ControllerV5Artifact {
  const body: Omit<ControllerV5Artifact, "contentHash"> = { version: "goalspec-controller-v5", featureVersion: V5_FEATURE_VERSION,
    architecture: "listwise-linear-neutral-plus-goal-residual", neutralWeights: Array(V5_NEUTRAL_DIMENSION).fill(0), goalWeights: Array(V5_GOAL_DIMENSION).fill(0),
    calibration: { neutralTemperature: 1, goalTemperature: 1, reliability: { status: "unavailable", bins: [], sourceHashes: [] } },
    // Reserved empty split identifiers satisfy the artifact shape; no records
    // were fitted. This is explicitly a cold uniform prior, not native transfer.
    lineage: { datasetHash: hash("untrained-cold-business-prior"), trainingFamilies: ["reserved-empty:train"], selectionFamilies: ["reserved-empty:selection"], calibrationFamilies: ["reserved-empty:calibration"], goalTraining: "none", excludedPriorHeldout: true, sources: [] } };
  return { ...body, contentHash: hash(body) };
}
export function deryaLiveCandidates(frame: ExecutionFrame): Candidate[] {
  const request = frame.sources["requirement:0"];
  if (typeof request !== "string") return [];
  const id = /\bjob_id="([^"\r\n]+)"/.exec(request)?.[1];
  const limit = /\blimit=(\d+)\b/.exec(request)?.[1];
  const q = /\bq="([^"\r\n]*)"/.exec(request)?.[1];
  return DERYA_READ_TOOLS.flatMap(tool => {
    if (tool === "get_job" && !id) return [];
    const args: Invocation["arguments"] = tool === "get_job" ? { job_id: id! } : { ...(limit ? { limit: Number(limit) } : {}),
      ...(q !== undefined && tool !== "list_open_inquiries" ? { q } : {}) };
    const invocation: Invocation = { tool, arguments: args, scope: frame.scope };
    return [{ schemaVersion: 1 as const, id: hash(invocation), invocation, probability: .5, bindings: [{ sourceId: "requirement:0", path: [] }], hop: 1, patternId: null }];
  });
}
export function exactDeryaAnswer(text: string, expected: string[]): boolean {
  try { const parsed = JSON.parse(text); return parsed && Object.keys(parsed).length === 1 && Array.isArray(parsed.values)
    && parsed.values.every((value: unknown) => typeof value === "string") && canonical(parsed.values) === canonical(expected); }
  catch { return false; }
}
function valuesAt(observation: unknown, field: string, collection?: string): string[] {
  const result = (observation as { result: unknown }).result;
  const rows = collection ? (result as Record<string, unknown>)[collection] : result;
  if (!Array.isArray(rows)) throw new Error("Expected a result collection");
  return rows.map(row => { const value = row[field]; if (typeof value !== "string") throw new Error("Expected string fixture field"); return value; });
}
function verifyPlan(plan: Plan) {
  const { hash: digest, ...body } = plan;
  if (plan.version !== "derya-live-read-v5.1" || hash(body) !== digest || plan.actor !== RESEARCH_MODELS.actor || plan.goal !== RESEARCH_MODELS.goal
    || plan.epochMode !== "off" || plan.actorContext !== "hypotheses" || plan.allowanceMicrodollars !== 750000
    || plan.tasks.length !== 12 || plan.trials.length !== 36 || new Set(plan.trials.map(t => t.runId)).size !== 36) throw new Error("Invalid frozen live plan");
  for (const task of plan.tasks) for (const arm of DERYA_LIVE_ARMS) if (plan.trials.filter(t => t.taskId === task.taskId && t.arm === arm).length !== 1) throw new Error("Incomplete paired read-task grid");
  for (const file of [...plan.sources, plan.privateTruth, plan.fixtureSource, plan.profileReport]) if (sha(readFileSync(file.path)) !== file.sha256) throw new Error("Frozen source or input changed");
}
export async function prepareDeryaLive(profilePath: string, outputPath: string, budgetPath: string) {
  const out = resolve(outputPath), profile = resolve(profilePath);
  if (existsSync(out) || !existsSync(budgetPath)) throw new Error("New plan directory and existing shared ledger required");
  const report = JSON.parse(readFileSync(join(profile, "report.json"), "utf8"));
  assert(report.complete && report.scenarioCount === 100 && report.equivalencePassed);
  const fixtureFile = source(join(profile, "fixtures.jsonl"));
  assert(report.artifactFiles.some((entry: { path: string; sha256: string }) => entry.path === "fixtures.jsonl" && entry.sha256 === fixtureFile.sha256));
  const studyId = "goalspec-derya-live-v5-local-20260916";
  const fixtures = readFileSync(fixtureFile.path, "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line) as Fixture)
    .sort((a, b) => hash([studyId, a.id]).localeCompare(hash([studyId, b.id]))).slice(0, 12);
  const specs: [DeryaReadTool, string, string | undefined][] = [
    ["search_jobs", "id", undefined], ["search_jobs", "reference", undefined], ["search_inquiries", "id", undefined], ["search_inquiries", "subject", undefined],
    ["search_companies", "id", undefined], ["search_companies", "name", undefined], ["list_open_inquiries", "id", undefined], ["list_open_inquiries", "subject", undefined],
    ["get_job", "id", "documents"], ["get_job", "name", "documents"], ["get_job", "status", "documents"], ["get_job", "planned", "milestones"],
  ];
  const db = auditedDeryaConnection(databaseUrl(), () => {});
  const tasks: DeryaLiveTask[] = [], truth: Truth[] = [];
  try {
    for (const [index, fixture] of fixtures.entries()) {
      const [tool, field, collection] = specs[index];
      const args: Invocation["arguments"] = tool === "get_job" ? { job_id: fixture.ids.Job } : { limit: 3 };
      const request = tool === "get_job" ? `Read the current job with job_id="${fixture.ids.Job}". Return the ${field} values from its ${collection} in the tool's returned order. Use {"values":[...]} and no other fields.`
        : `Use ${tool} to read current office records with limit=3. Return their ${field} values in the tool's returned order. Use {"values":[...]} and no other fields.`;
      const scope = { ...fixture.invocation.scope, environmentVersion: "derya-live-read-v5.1", toolSchemaHash: hash(DERYA_LIVE_SCHEMAS) };
      const invocation: Invocation = { tool, arguments: args, scope };
      const task: DeryaLiveTask = { taskId: `derya-read-${index + 1}`, familyId: `derya-structured-${index + 1}`, request, scope, principal: fixture.principal };
      const observation = await readDeryaAuthoritative(db, deryaProjection, tool, args, { userId: fixture.principal.id, officeId: fixture.principal.officeId, accessKind: "operator" });
      truth.push({ taskId: task.taskId, invocation, observationHash: hash(observation), values: valuesAt(observation, field, collection), field, ...(collection ? { collection } : {}) }); tasks.push(task);
    }
  } finally { await db.$disconnect(); }
  mkdirSync(out);
  save(join(out, "private-truth.json"), truth);
  const sourcePaths = [...sourcesIn("src/lib/goalspec"), ...sourcesIn("src/lib/goalspec-adapters"), "services/goalspec-runtime/provider.ts", "services/goalspec-runtime/durable-budget.ts", "services/goalspec-runtime/artifacts.ts", "src/lib/document-readiness.ts", "src/lib/inquiry-status.ts", "scripts/goalspec-derya-v5-live.ts", "scripts/goalspec-derya-v5-live.test.ts", "prisma/schema.prisma", "package-lock.json"];
  const measured = report.performance.perTool.map((row: { full: { p50Ms: number } }) => row.full.p50Ms);
  // Full reread remains mandatory; equal tool/validation cost yields no positive
  // utility even for a certain candidate. No invented exposure benefit.
  const milliseconds = Math.max(...measured);
  const trials = tasks.flatMap(task => [...DERYA_LIVE_ARMS].sort((a, b) => hash([studyId, task.taskId, a]).localeCompare(hash([studyId, task.taskId, b])))
    .map(arm => ({ runId: `derya-v5-${task.taskId}-${arm}`, taskId: task.taskId, arm })));
  const body: Omit<Plan, "hash"> = { version: "derya-live-read-v5.1", studyId, budgetJournal: resolve(budgetPath), allowanceMicrodollars: 750000,
    actor: RESEARCH_MODELS.actor, goal: RESEARCH_MODELS.goal, actorContext: "hypotheses", epochMode: "off", tasks, trials,
    sources: [...new Set(sourcePaths)].sort().map(source), privateTruth: source(join(out, "private-truth.json")), fixtureSource: fixtureFile, profileReport: source(join(profile, "report.json")), coldController: coldDeryaController(),
    estimate: { toolMs: milliseconds, validationMs: milliseconds, schedulingMs: 1, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 } };
  const plan = { ...body, hash: hash(body) }; save(join(out, "plan.json"), plan);
  return plan;
}

export async function runDeryaTask(task: DeryaLiveTask, arm: DeryaLiveArm, model: ModelPort, record: (event: Record<string, unknown>) => void,
  configuration: Pick<Plan, "coldController" | "estimate">, runId: string) {
  const started = performance.now(); let physicalSql = 0, projectionReads = 0, authoritativeReads = 0, logicalCalls = 0, inputTokens = 0, inputBytes = 0;
  let speculativeReads = 0, validations = 0, actorRequests = 0, predictions = 0, verifiedActorObservations = 0;
  let text = "", completed = false, failure: string | null = null;
  const db = auditedDeryaConnection(databaseUrl(), event => { physicalSql++; record({ ...event, runId }); });
  const projection: typeof deryaProjection = async (...args) => { projectionReads++; return deryaProjection(...args); };
  const executor = new DeryaReadExecutor(db, projection, task.scope.toolSchemaHash, task.scope.environmentVersion, task.principal,
    (type, latencyMs) => { if (type === "speculative_transaction") speculativeReads++; if (type === "validation_transaction") validations++; record({ type, latencyMs, runId }); }, { mode: "off" });
  const scheduler = new SpeculationScheduler(runId, executor, event => record({ ...event }));
  const bounded: ModelPort = { complete: request => {
    if (request.model === RESEARCH_MODELS.actor) { if (++actorRequests > 2) throw new Error("Actor request limit"); }
    else { if (request.model !== RESEARCH_MODELS.goal || ++predictions > 2) throw new Error("Prediction request limit"); }
    return model.complete({ ...request, retries: 1, retryableCauseCodes: ["UND_ERR_SOCKET"] });
  } };
  const predictors = new ContractPredictors(bounded, async () => { throw new Error("Embeddings disabled for empty business memory"); }, DERYA_LIVE_SCHEMAS, "heldout", maximumCost(RESEARCH_MODELS.goal, 8192, 1024), event => record(event as Record<string, unknown>));
  const session = arm === "base" ? undefined : new GoalSpecSessionV5(new FrozenRepository("empty-business-library-v5", [], []), predictors, scheduler, event => record(event as Record<string, unknown>), {
    controller: new LocalControllerV5(configuration.coldController), actorContext: arm === "goal54" ? "hypotheses" : "none", goalConditioning: arm === "goal54", inferGoals: arm === "goal54", exposeEvidence: true,
    query: frame => frame.requestedObjective, bindCurrent: deryaLiveCandidates, validateCurrent: (candidate, frame) => deryaLiveCandidates(frame).some(current => hash(current) === hash(candidate)),
    nonMutating: invocation => DERYA_READ_TOOLS.includes(invocation.tool as DeryaReadTool), countTokens, estimate: configuration.estimate,
    inferState: (previous, frame) => predictGoalStateDeltas(bounded, previous, frame, { allocation: "heldout", maximumAttemptMicrodollars: maximumCost(RESEARCH_MODELS.goal, 8192, 1024), record: event => record(event as Record<string, unknown>) }),
  });
  let frame: ExecutionFrame = { schemaVersion: 1, runId, scope: copy(task.scope), snapshotId: "empty-business-library-v5", boundary: 0,
    requestedObjective: task.request, policy: DERYA_LIVE_POLICY, sources: { "requirement:0": task.request, _binding_events: [] },
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) } };
  const input: ResponseInputItem[] = [{ role: "user", content: task.request }];
  try {
    for (let boundary = 0; boundary < 2; boundary++) {
      frame.boundary = boundary;
      const decision = session ? await session.boundary(frame, ["requirement:0"]) : { frame, actorContext: "", evidence: [] };
      frame = decision.frame;
      verifiedActorObservations += decision.evidence.length;
      const instructions = DERYA_LIVE_POLICY + decision.actorContext;
      const requestBody = { model: RESEARCH_MODELS.actor, instructions, input, tools, max_output_tokens: 4096, reasoning: { effort: "medium" }, store: false, service_tier: "default" };
      const serialized = canonical(requestBody), tokens = countTokens(serialized), bytes = Buffer.byteLength(serialized);
      if (tokens > 32000 || bytes > 32000) throw new Error("Actor mandatory context budget exceeded");
      inputTokens += tokens; inputBytes += bytes;
      record({ type: "actor_request", runId, boundary, model: RESEARCH_MODELS.actor, inputHash: hash(requestBody), compiledInputTokens: tokens, serializedInputBytes: bytes, request: requestBody });
      const result = await bounded.complete({ id: `${runId}:actor:${boundary}`, model: RESEARCH_MODELS.actor, instructions, input: copy(input), tools,
        maxOutputTokens: 4096, reasoning: "medium", allocation: "heldout", maximumAttemptMicrodollars: maximumCost(RESEARCH_MODELS.actor, 32768, 4096), retries: 1 });
      record({ type: "actor_response", runId, boundary, result });
      if (result.refusals.length) throw new Error("Actor refusal");
      input.push(...copy(result.continuation));
      if (!result.calls.length) { text = result.text; completed = true; break; }
      if (logicalCalls + result.calls.length > 4) throw new Error("Read call limit");
      logicalCalls += result.calls.length;
      const settled = await Promise.allSettled(result.calls.map(async call => {
        if (!DERYA_READ_TOOLS.includes(call.name as DeryaReadTool)) throw new Error("Non-read call denied");
        const invocation: Invocation = { tool: call.name, arguments: call.arguments as Invocation["arguments"], scope: task.scope };
        const execute = async () => { authoritativeReads++; return readDeryaAuthoritative(db, projection, call.name as DeryaReadTool, invocation.arguments,
          { userId: task.principal.id, officeId: task.principal.officeId, accessKind: "operator" }); };
        const observation = session ? await scheduler.authoritative(invocation, execute) : await execute();
        record({ type: "tool_result", runId, boundary, callId: call.id, invocation, observation });
        return { call, observation };
      }));
      const rejected = settled.find(result => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
      const observations = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      for (const { call, observation } of observations) {
        verifiedActorObservations++;
        input.push({ type: "function_call_output", call_id: call.id, output: JSON.stringify(observation) });
        const events = frame.sources._binding_events as Json[];
        events.push({ kind: "tool_request", call_id: call.id, tool: call.name, arguments: call.arguments as Json },
          { kind: "tool_result", call_id: call.id, status: "success", observation });
        frame.sources[`tool:${call.id}`] = observation;
      }
    }
    if (!completed) failure = "actor_decision_limit";
  } catch (error) { failure = deryaFailureType(error); }
  finally {
    try { if (session) await session.close(); else await scheduler.close(); }
    catch { failure ??= "managed_drain_failed"; }
    await db.$disconnect();
  }
  return { runId, taskId: task.taskId, familyId: task.familyId, arm, completed, failure, answer: text, totalTrialSeconds: (performance.now() - started) / 1000,
    actorRequests, predictionRequests: predictions, logicalToolCalls: logicalCalls, verifiedActorObservations, physicalToolReads: authoritativeReads + speculativeReads + validations,
    authoritativeReads, speculativeReads, revalidationCalls: validations, projectionReads, physicalSqlStatements: physicalSql, compiledActorInputTokens: inputTokens, serializedActorInputBytes: inputBytes };
}

export async function dispatchDeryaLive(planPath: string, outputPath: string) {
  const plan: Plan = JSON.parse(readFileSync(planPath, "utf8"));
  const { hash: digest, ...body } = plan;
  if (plan.version !== "derya-live-read-v5.1" || hash(body) !== digest || !Array.isArray(plan.trials) || plan.trials.length !== 36 || existsSync(outputPath)) throw new Error("Valid paired plan and fresh output required");
  mkdirSync(outputPath);
  save(join(outputPath, "dispatch.json"), { planPath: resolve(planPath), planSha256: sha(readFileSync(planPath)), planHash: plan.hash, trials: plan.trials, maximumMicrodollars: 27_000_000 });
  let ledger: DurableBudget | undefined, events: ImmutableEventLog | undefined, validator: ReturnType<typeof auditedDeryaConnection> | undefined;
  let phase = "preflight", reserved = false, globalFailure: string | null = null;
  const outcomes: Record<string, unknown>[] = [];
  const appendOutcome = (row: Record<string, unknown>) => {
    outcomes.push(row); appendFileSync(join(outputPath, "outcomes.jsonl"), `${JSON.stringify(row)}\n`); events?.append({ type: "trial_outcome", ...row });
  };
  try {
    verifyPlan(plan);
    if (!process.env.GOALSPEC_HOST_STATUS_FILE || !existsSync(plan.budgetJournal)) throw new Error("Guard and existing shared ledger required");
    assertResearchHostReady(); phase = "ledger_recovery";
    ledger = new DurableBudget(plan.budgetJournal);
    events = new ImmutableEventLog(join(outputPath, "events.jsonl"));
    const truth: Truth[] = JSON.parse(readFileSync(plan.privateTruth.path, "utf8"));
    validator = auditedDeryaConnection(databaseUrl(), () => {});
    phase = "paired_reservation";
    ledger.ledger.reserveMany(plan.trials.map(trial => ({ id: `trial:${trial.runId}`, allocation: "heldout", maximum: plan.allowanceMicrodollars })));
    reserved = true; phase = "trial_execution";
    for (const trial of plan.trials) {
      const task = plan.tasks.find(t => t.taskId === trial.taskId)!, expected = truth.find(t => t.taskId === trial.taskId)!;
      let row: Record<string, unknown>;
      const providerEvents: Record<string, unknown>[] = [];
      const record = (event: unknown) => { const value = { ...(event as Record<string, unknown>), runId: trial.runId }; providerEvents.push(value); events!.append(value); };
      const trialLedger = new TrialLedger(ledger.ledger, `trial:${trial.runId}`, "heldout");
      try {
        verifyPlan(plan); assertResearchHostReady();
        const preflightExecutor = new DeryaReadExecutor(validator, deryaProjection, task.scope.toolSchemaHash, task.scope.environmentVersion, task.principal, () => {}, { mode: "off" });
        const current = await preflightExecutor.read(expected.invocation, new AbortController().signal);
        if (hash(current) !== expected.observationHash) throw new Error("Frozen fixture truth changed");
        const provider = researchProvider(trialLedger, "heldout", record);
        const result = await runDeryaTask(task, trial.arm, provider.model, record, plan, trial.runId);
        row = { ...result, success: result.completed && !result.failure && result.verifiedActorObservations > 0 && exactDeryaAnswer(result.answer, expected.values) };
      } catch (error) {
        row = { runId: trial.runId, taskId: task.taskId, familyId: task.familyId, arm: trial.arm, success: false, completed: false,
          failure: deryaFailureType(error), totalTrialSeconds: null, physicalToolReads: null, physicalSqlStatements: null };
      }
      const reservations = trialLedger.snapshot(), known = providerEvents.filter(e => e.type === "model_attempt");
      row.knownUsageSubtotalMicrodollars = known.reduce((sum, e) => sum + Number(e.costMicrodollars ?? 0), 0);
      row.unknownRequestCount = reservations.filter(entry => entry.actual === undefined).length;
      row.providerActorInputTokens = known.filter(e => e.requestedModel === RESEARCH_MODELS.actor).reduce((sum, e) => sum + Number((e.usage as { input_tokens?: number } | null)?.input_tokens ?? 0), 0);
      appendOutcome(row); ledger.ledger.finishParent(`trial:${trial.runId}`);
    }
    phase = "final_integrity"; verifyPlan(plan);
  } catch (error) {
    globalFailure = `${phase}:${deryaFailureType(error)}`;
    for (const trial of plan.trials.filter(trial => !outcomes.some(row => row.runId === trial.runId))) {
      const task = plan.tasks.find(task => task.taskId === trial.taskId);
      appendOutcome({ runId: trial.runId, taskId: trial.taskId, familyId: task?.familyId ?? null, arm: trial.arm,
        success: false, completed: false, notExecuted: true, failure: globalFailure, totalTrialSeconds: null,
        physicalToolReads: null, physicalSqlStatements: null, knownUsageSubtotalMicrodollars: 0, unknownRequestCount: 0 });
      if (reserved) ledger!.ledger.finishParent(`trial:${trial.runId}`);
    }
  } finally {
    if (validator) await validator.$disconnect(); events?.close(); ledger?.close();
  }
  save(join(outputPath, "summary.json"), { version: plan.version, completeDeclaredCohort: outcomes.length === 36, integrityPassed: !globalFailure, globalFailure, planHash: plan.hash, trials: outcomes,
    arms: DERYA_LIVE_ARMS.map(arm => { const rows = outcomes.filter(row => row.arm === arm); return { arm, trials: rows.length, successes: rows.filter(row => row.success).length,
      meanTotalTrialSeconds: rows.every(row => typeof row.totalTrialSeconds === "number") ? rows.reduce((sum, row) => sum + Number(row.totalTrialSeconds), 0) / rows.length : null }; }),
    labels: { synthetic: true, officialBenchmark: false, trainedBusinessController: false, businessMemoryRecords: 0, epochReuse: false,
      goalArm: "Experimental actor-visible literal requirements and current inferred hypotheses; cold goal correction remains uncalibrated.",
      latency: "Includes per-trial connection setup, actor work, read tools, managed predictor drain and disconnect. Excludes shared ledger recovery and frozen fixture/source preflight.",
      calls: "Physical tool reads include authoritative, speculative and validation attempts; SQL statements reported separately." } });
  if (globalFailure) throw new Error("Derya live cohort failed; complete declared slots retained");
}
async function main() {
  const [mode, first, second, third] = process.argv.slice(2);
  if (mode === "prepare" && first && second && third) console.log(JSON.stringify({ plan: join(resolve(second), "plan.json"), hash: (await prepareDeryaLive(first, second, third)).hash }));
  else if (mode === "run" && first && second) await dispatchDeryaLive(first, second);
  else throw new Error("Usage: prepare PROFILE NEW_PLAN EXISTING_LEDGER | run PLAN NEW_OUTPUT");
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/goalspec-derya-v5-live.ts")) main().catch(error => { console.error(JSON.stringify({ failed: true, errorType: deryaFailureType(error) })); process.exitCode = 1; });
