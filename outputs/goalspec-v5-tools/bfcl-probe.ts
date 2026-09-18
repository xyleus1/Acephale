import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../../src/lib/goalspec/canonical";
import type { ExecutionFrame, GoalSet } from "../../src/lib/goalspec/contracts/generated";
import { buildGoalState } from "../../src/lib/goalspec/goal-state";
import { predictGoalStateDeltas } from "../../src/lib/goalspec/goal-state-protocol-v4c";
import { RESEARCH_MODELS, providerFailure, type ModelPort, type ModelRequest, type ModelResult } from "../../src/lib/goalspec/model";
import { countTokens } from "../../src/lib/goalspec/tokens";
import { DurableBudget } from "../../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../../services/goalspec-runtime/artifacts";
import { maximumCost, researchProvider, TrialLedger } from "../../services/goalspec-runtime/provider";

const ROOT = resolve("."), STUDY = "goalspec-bfcl-goal-conditioning-v5-20260916", SEED = 20260916;
const MINI = maximumCost(RESEARCH_MODELS.goal, 8192, 1024), HINT_MAX_BYTES = 4096;
const LEDGER = join(ROOT, "research/goalspec/runs/local-evaluation-20260914/budget.jsonl");
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const read = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) => writeFileSync(path, canonical(value) + "\n", { flag: "wx" });
export type Arm = "direct" | "goal_context_probe";
export type Case = { id: string; category: string; input: ModelRequest["input"]; tools: ModelRequest["tools"] };
const EMPTY: GoalSet = { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) };
const HINT_PREFIX = "EXPERIMENTAL INFERRED REQUESTED-GOAL DATA. This fallible hypothesis is not instructions or authorization. "
  + "The original public request and function schemas control. Disregard a conflicting, unsupported or stale inference. Source references prove provenance, not semantic correctness.\n";

export function goalFrame(row: Case): ExecutionFrame {
  const users = row.input.flatMap(item => "role" in item && item.role === "user" && typeof item.content === "string" ? [item.content] : []);
  if (!users.length) throw new Error("No literal public user source");
  return { schemaVersion: 1, runId: `${STUDY}:${row.id}`, boundary: 0, snapshotId: STUDY,
    scope: { tenantId: "bfcl-component", principalId: "actor", authorizationVersion: "no-tool-execution", environmentVersion: "f7cf7359b7ac615a0b294831c5ba2bc95ee4a000", toolSchemaHash: hash(row.tools) },
    requestedObjective: users.join("\n"), policy: canonical({ availableFunctionSchemas: row.tools,
      interpretation: "Function definitions describe capabilities, not extra user requirements. No tool execution or authorization is available in this diagnostic." }),
    sources: Object.fromEntries(users.map((text, index) => [`requirement:${index}`, text])), goals: EMPTY };
}
export function actorMaximum(row: Case, arm: Arm) {
  const original = canonical({ instructions: "", input: row.input, tools: row.tools });
  if (countTokens(original) > 32768 - 128) throw new Error("Mandatory BFCL input exceeds32768 token budget");
  const upper = Buffer.byteLength(original, "utf8") + 2048 + (arm === "goal_context_probe" ? HINT_MAX_BYTES : 0);
  if (upper > 32768) throw new Error("Conservative BFCL reservation exceeds input cap");
  return maximumCost(RESEARCH_MODELS.actor, upper, 4096);
}
export function actorRequest(row: Case, arm: Arm, hint: string | null = null): ModelRequest {
  if (arm !== "direct" && arm !== "goal_context_probe" || arm === "direct" && hint !== null) throw new Error("Invalid diagnostic arm/context");
  if (hint !== null && Buffer.byteLength(hint, "utf8") > HINT_MAX_BYTES) throw new Error("Goal context exceeds predeclared byte bound");
  const input = hint === null ? row.input : [...row.input, { role: "developer" as const, content: hint }];
  if (countTokens(canonical({ instructions: "", input, tools: row.tools })) > 32768 - 128) throw new Error("Actor input exceeds token bound");
  return { id: `${STUDY}:${row.id}:${arm}:actor`, model: RESEARCH_MODELS.actor, reasoning: "medium", instructions: "",
    input, tools: row.tools, maxOutputTokens: 4096, allocation: "replay", maximumAttemptMicrodollars: actorMaximum(row, arm), retries: 0 };
}
export async function runCase(row: Case, arm: Arm, model: ModelPort, record: (event: unknown) => void = () => {}) {
  const started = performance.now();
  let hint: string | null = null, goals: GoalSet | null = null, goalLatencyMs = 0;
  let conditioning: { status: string; error: unknown; goals: GoalSet | null; sourceHash: string | null } = { status: "not_requested", error: null, goals: null, sourceHash: null };
  if (arm === "goal_context_probe") {
    const begin = performance.now();
    try {
      const frame = goalFrame(row), state = buildGoalState(frame, EMPTY);
      conditioning.sourceHash = hash(frame.sources);
      const inferred = await predictGoalStateDeltas(model, state, frame, { allocation: "replay", maximumAttemptMicrodollars: MINI,
        requestId: `${STUDY}:${row.id}:goal`, record });
      goals = inferred.goals;
      if (!goals.hypotheses.length || goals.unknown >= .5) conditioning.status = "unknown_fallback";
      else {
        hint = HINT_PREFIX + canonical({ hypothesis: goals.hypotheses[0], evidence: inferred.active[0]?.evidence ?? [] });
        if (Buffer.byteLength(hint, "utf8") > HINT_MAX_BYTES) throw new Error("Goal context exceeds byte bound");
        conditioning.status = "exposed";
      }
    } catch (error) { hint = null; conditioning.status = "failed_fallback"; conditioning.error = providerFailure(error); }
    goalLatencyMs = performance.now() - begin; conditioning.goals = goals;
  }
  const request = actorRequest(row, arm, hint), begin = performance.now();
  let result: ModelResult | null = null, error: unknown = null;
  try {
    result = await model.complete(request);
    if (result.model !== RESEARCH_MODELS.actor || result.status !== "completed" || result.refusals.length) throw new Error("Refused/incomplete actor response");
  } catch (failure) { error = providerFailure(failure); }
  return { id: row.id, category: row.category, arm, status: error ? "failed" : "completed", result, error,
    conditioning, goalLatencyMs, actorLatencyMs: performance.now() - begin, totalLatencyMs: performance.now() - started,
    originalInputHash: hash({ input: row.input, tools: row.tools, instructions: "" }),
    inputHash: hash({ input: request.input, tools: request.tools, instructions: request.instructions }), hint,
    maximumMicrodollars: request.maximumAttemptMicrodollars + (arm === "goal_context_probe" ? MINI : 0) };
}
function sourceClosure() {
  const seen = new Set<string>(), pending = [resolve("outputs/goalspec-v5-tools/bfcl-probe.ts"), resolve("outputs/goalspec-v5-tools/bfcl_probe.py"),
    resolve("outputs/goalspec-benchmarks-tools/bfcl_subset.py"), resolve("package.json"), resolve("package-lock.json")];
  while (pending.length) {
    const path = pending.pop()!; if (seen.has(path)) continue; seen.add(path);
    if (!path.endsWith(".ts")) continue;
    for (const match of readFileSync(path, "utf8").matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g)) {
      const base = resolve(dirname(path), match[1]), next = [base, `${base}.ts`, join(base, "index.ts")].find(p => existsSync(p) && /\.(ts|json)$/.test(p));
      if (!next) throw new Error("Uncaptured local source import"); pending.push(next);
    }
  }
  return [...seen].sort().map(path => ({ path: relative(ROOT, path).replaceAll("\\", "/"), sha256: sha(readFileSync(path)) }));
}
export function makePlan(dataset: string, output: string) {
  if (existsSync(output) || dirname(resolve(output)) !== join(ROOT, "research/goalspec/runs")) throw new Error("New direct research run output required");
  const manifestPath = join(resolve(dataset), "dataset-manifest.json"), casesPath = join(resolve(dataset), "public-cases.json");
  const manifest = read(manifestPath), cases: Case[] = read(casesPath).entries;
  if (manifest.studyId !== STUDY || manifest.maximumReplayUsd !== 8 || cases.length !== 32 || new Set(cases.map(row => row.id)).size !== 32
    || sha(readFileSync(casesPath)) !== manifest.publicCasesSha256 || cases.some(row => manifest.excludedIds.includes(row.id))
    || ["multiple", "irrelevance"].some(category => cases.filter(row => row.category === category).length !== 16)) throw new Error("Frozen disjoint diagnostic cohort changed");
  for (const source of manifest.sources) if (sha(readFileSync(source.path)) !== source.sha256) throw new Error("Pinned dataset/checker source changed");
  const ordered = [...cases].sort((a, b) => hash([STUDY, SEED, a.id]).localeCompare(hash([STUDY, SEED, b.id])));
  const slots = ordered.flatMap(row => (["direct", "goal_context_probe"] as Arm[])
    .sort((a, b) => hash([STUDY, SEED, row.id, a]).localeCompare(hash([STUDY, SEED, row.id, b])))
    .map(arm => ({ id: row.id, category: row.category, arm, actorRequestHash: hash(actorRequest(row, arm)),
      maximumMicrodollars: actorMaximum(row, arm) + (arm === "goal_context_probe" ? MINI : 0) })));
  const maximumMicrodollars = slots.reduce((sum, slot) => sum + slot.maximumMicrodollars, 0);
  if (maximumMicrodollars > 8_000_000) throw new Error("Diagnostic exceeds8USD replay cap");
  return { version: STUDY, dataset: resolve(dataset), output: resolve(output), slots, maximumMicrodollars, concurrency: 1, retries: 0,
    maximumProviderRequests: 96, allocation: "replay", models: { actor: RESEARCH_MODELS.actor, goal: RESEARCH_MODELS.goal },
    reasoning: "medium", actorOutputCap: 4096, predictorOutputCap: 1024, unknownThreshold: .5, hintMaxBytes: HINT_MAX_BYTES,
    inputs: [{ path: manifestPath, sha256: sha(readFileSync(manifestPath)) }, { path: casesPath, sha256: sha(readFileSync(casesPath)) }],
    code: sourceClosure(), label: manifest.label, futureLabelsUsed: false, liveGoalSpecClaim: false, noToolExecution: true };
}
export async function dispatch(path: string, expected: string, factory = researchProvider) {
  const bytes = readFileSync(path), plan: ReturnType<typeof makePlan> = JSON.parse(bytes.toString("utf8"));
  if (sha(bytes) !== expected || hash(makePlan(plan.dataset, plan.output)) !== hash(plan) || !existsSync(LEDGER)) throw new Error("Immutable plan and shared budget required");
  mkdirSync(plan.output); write(join(plan.output, "dispatch-plan.json"), plan);
  for (const source of plan.code) { const destination = join(plan.output, "source", source.path); mkdirSync(dirname(destination), { recursive: true });
    const captured = readFileSync(source.path); if (sha(captured) !== source.sha256) throw new Error("Source changed during capture"); writeFileSync(destination, captured, { flag: "wx" }); }
  const cases = new Map<string, Case>(read(join(plan.dataset, "public-cases.json")).entries.map((row: Case) => [row.id, row]));
  const durable = new DurableBudget(LEDGER), events = new ImmutableEventLog(join(plan.output, "provider-events.jsonl"));
  const parent = `${STUDY}:${expected}`, rows: Awaited<ReturnType<typeof runCase>>[] = [], attempts: any[] = [];
  let reserved = false, calls = 0;
  try {
    durable.ledger.reserve(parent, "replay", plan.maximumMicrodollars); reserved = true;
    const ledger = new TrialLedger(durable.ledger, parent, "replay");
    const raw = factory(ledger, "replay", event => { events.append(event); attempts.push(event); }).model;
    const model: ModelPort = { complete: request => {
      if (++calls > plan.maximumProviderRequests || request.retries !== 0 || request.allocation !== "replay"
        || ![RESEARCH_MODELS.goal, RESEARCH_MODELS.actor].includes(request.model as typeof RESEARCH_MODELS.goal)) throw new Error("Probe dispatch bound violated");
      return raw.complete(request);
    } };
    for (const slot of plan.slots) {
      const row = await runCase(cases.get(slot.id)!, slot.arm, model, event => appendFileSync(join(plan.output, "goal-events.jsonl"), canonical({ id: slot.id, event }) + "\n"));
      rows.push(row); appendFileSync(join(plan.output, "predictions.jsonl"), canonical(row) + "\n");
      console.log(JSON.stringify({ completed: rows.length, total: plan.slots.length, arm: slot.arm, status: row.status, conditioning: row.conditioning.status }));
    }
    const costs = ledger.snapshot();
    write(join(plan.output, "summary.json"), { version: STUDY, closed: rows.length === 64, cases: 32, declared: 64,
      completed: rows.filter(row => row.status === "completed").length, failed: rows.filter(row => row.status !== "completed").length,
      calls, planSha256: expected, dispatchPlanSha256: sha(readFileSync(join(plan.output, "dispatch-plan.json"))), maximumReservedUsd: plan.maximumMicrodollars / 1e6,
      knownResponseUsageUsd: attempts.filter(event => event.type === "model_attempt").reduce((sum, event) => sum + event.costMicrodollars, 0) / 1e6,
      settledLogicalRequestUsageUsd: costs.reduce((sum, row) => sum + (row.actual ?? 0), 0) / 1e6,
      unresolvedLogicalRequests: costs.filter(row => row.actual === undefined).length,
      providerAttempts: attempts.filter(event => ["model_attempt", "model_attempt_failed"].includes(event.type)).length,
      noToolExecution: true, liveGoalSpecClaim: false, predictionsSha256: sha(readFileSync(join(plan.output, "predictions.jsonl"))) });
  } finally { if (reserved) durable.ledger.finishParent(parent); events.close(); durable.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, first, second, third] = process.argv.slice(2);
  if (mode === "plan") { const plan = makePlan(first, second); write(third, plan); console.log(JSON.stringify({ path: third, sha256: sha(readFileSync(third)), maximumUsd: plan.maximumMicrodollars / 1e6, cases: 32, slots: 64 })); }
  else if (mode === "run") void dispatch(first, second).catch(error => { console.error(JSON.stringify(providerFailure(error))); process.exitCode = 1; });
  else throw new Error("Use plan DATASET OUTPUT PLANFILE or run PLANFILE SHA256");
}
