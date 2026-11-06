/** Native component measurements use a live Python snapshot gateway, never trace durations. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { validateInfraManifest } from "../src/lib/goalspec/infra-manifest";
import { LocalChatModelPort } from "../src/lib/goalspec/infra-model";
import { validateMemoryArtifact } from "../src/lib/goalspec/experience-memory";
import { SpeculationScheduler, type ReadExecutor } from "../src/lib/goalspec/scheduler";
import { NativeGateway, NativeReadExecutor } from "../services/goalspec-runtime/gateway-client";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";
import { createInfraNativeCandidates } from "../services/goalspec-runtime/infra-candidates";
import { infraCandidateCompilerHash } from "../services/goalspec-runtime/infra-compiler-identity";
import { InfraLocalPredictors, INFRA_PREDICTOR_CONTRACT_HASH } from "../services/goalspec-runtime/infra-predictors";
import { localActorDecision, localActorMessages } from "../services/goalspec-runtime/local-actor";
import type { PublicBoundary } from "../services/goalspec-runtime/actor";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { validateInfraLedgerCheckpoint } from "../services/goalspec-runtime/infra-hosted-workers";
import { nativeSplitGuard } from "../services/goalspec-runtime/infra-split-guard";
import { publicInfraFrame, selectInfraReplayRows } from "./goalspec-infra-predict";
import { verifyInfraPilotBundle } from "./goalspec-infra-memory";

export interface NativeProfileConfig {
  version: 1; datasetPath: string; cohortPath: string; memoryPath: string; manifestPath: string; ledgerCheckpointPath: string;
  budgetDirectory: string; actorBaseUrl: string; predictorBaseUrl: string; limit: number; seed: number; maximumLifetimeSeconds: number;
  otlpBaseUrl?: string; splitGuardPath?: string;
}
type Span = { clockId: string; startMs: number; endMs: number };
type Spans = Partial<Record<"actorLeadMs" | "predictionMs" | "toolMs" | "validationMs" | "schedulingMs", Span>>
  & { contentionMs?: { method: "paired_difference"; baseline: Span; concurrent: Span } };
const json = async <T = any>(file: string): Promise<T> => JSON.parse(await readFile(file, "utf8"));
const write = (file: string, value: unknown) => writeFile(file, canonical(value) + "\n", { flag: "wx", mode: 0o600 });
export const NATIVE_PROFILE_PROTOCOL = "native-paired-component-profile-v1: pinned ephemeral native state reconstructed from verified public prefix only; same seeded actor input alone versus overlapping grounded goal, neutral and conditional prediction plus one authorized scheduler-managed native snapshot read and freshness refresh; alternate pair order; actual monotonic gateway-inclusive spans; negative paired actor excess remains failed; no proposed actor calls executed; all operations drained and failures retained; not a benchmark or causal speedup estimate";

async function inputs(configurationPath: string) {
  const config = await json<NativeProfileConfig>(configurationPath), base = dirname(resolve(configurationPath));
  const path = (file: string) => resolve(base, file);
  if (config.version !== 1 || !Number.isSafeInteger(config.limit) || config.limit < 1 || config.limit > 100
    || !Number.isSafeInteger(config.seed) || config.seed < 0 || !Number.isSafeInteger(config.maximumLifetimeSeconds)
    || config.maximumLifetimeSeconds < 1 || config.maximumLifetimeSeconds > 28800) throw new Error("Invalid bounded native profile configuration");
  const dataset = verifyInfraPilotBundle(path(config.datasetPath)), memory = validateMemoryArtifact(await json(path(config.memoryPath)));
  const manifest = await json(path(config.manifestPath)); validateInfraManifest(manifest);
  const checkpoint = await json(path(config.ledgerCheckpointPath));
  if (dataset.lineage.fresh_qwen_traces !== true || memory.repositorySnapshotId !== `infra-fresh:${dataset.manifest.bundle_hash}`
    || manifest.data.datasetHash !== dataset.manifest.bundle_hash || manifest.data.memoryHash !== memory.contentHash
    || manifest.data.environmentRevision !== "2174a603f6d014ef94473ffa95957f6ce27100db"
    || hash(checkpoint) !== manifest.budgets.ledgerCheckpointHash || !manifest.seeds.includes(config.seed)) throw new Error("Native profile source or ledger identity mismatch");
  const partitions = dataset.split.declared_family_policy ?? dataset.split.families;
  for (const [key, split] of [["trainingFamilies", "train"], ["developmentFamilies", "development"], ["heldoutFamilies", "test"]] as const) {
    const expected = Object.entries(partitions).filter(([, value]) => value === split).map(([family]) => family).sort();
    if (canonical([...manifest.data[key]].sort()) !== canonical(expected)) throw new Error("Native profile changed the frozen family partitions");
  }
  // Constructors reject credential-bearing endpoints before any plan is persisted.
  for (const role of ["actor", "predictor"] as const) new LocalChatModelPort({ baseUrl: config[`${role}BaseUrl`], model: manifest[role].servedModel });
  nativeSplitGuard(config, manifest, resolve(configurationPath));
  const publicRows = (await readFile(join(path(config.datasetPath), "public.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  return { config, path, dataset, memory, manifest, checkpoint, publicRows };
}

function poolFor(row: any, memory: ReturnType<typeof validateMemoryArtifact>, training: string[]) {
  const frame = publicInfraFrame(row, memory.repositorySnapshotId), policy = new NativeReadPolicy(row.domain, frame.scope);
  policy.updateFrame(frame);
  const tools = Object.fromEntries(row.input.tools.map((tool: any) => [tool.name, tool.parameters]));
  return { frame, policy, candidates: createInfraNativeCandidates(memory, tools, invocation => policy.eligible(invocation),
    { allowedFamilies: training, excludeFamilies: [row.family_id] }).candidates(frame) };
}

export async function prepareNativeProfile(configurationPath: string, output: string) {
  const data = await inputs(configurationPath), { config, path, dataset, memory, manifest, checkpoint, publicRows } = data;
  const ledgerPath = resolve(path(config.budgetDirectory), "budget.jsonl"), metadata = await stat(ledgerPath);
  if (!metadata.isFile() || metadata.size === 0) throw new Error("Original nonempty budget journal required");
  const budget = new DurableBudget(ledgerPath);
  try { validateInfraLedgerCheckpoint(checkpoint, budget.ledger, ledgerPath); } finally { budget.close(); }
  // Never consult next-action labels to select prefixes or candidate IDs.
  const selected = selectInfraReplayRows(publicRows.filter(row => row.split !== "test" && poolFor(row, memory, dataset.expected).candidates.length > 0), config.limit);
  if (!selected.length || selected.some(row => !(row.split === "train" ? manifest.data.trainingFamilies : manifest.data.developmentFamilies).includes(row.family_id))) throw new Error("No eligible declared train/development native prefixes");
  const body = { version: 1, kind: "native_component_profile", configuration: config, configurationHash: hash(config),
    manifestHash: hash(manifest), sourceDatasetHash: dataset.manifest.bundle_hash, memoryHash: memory.contentHash,
    candidateCompilerHash: infraCandidateCompilerHash("native"), predictorContractHash: INFRA_PREDICTOR_CONTRACT_HASH,
    protocol: NATIVE_PROFILE_PROTOCOL, rowIds: selected.map(row => row.checkpoint_id), benchmarkClaim: false,
    rows: selected.map((row, ordinal) => ({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash,
      family_id: row.family_id, split: row.split, episode_id: row.episode_id, ordinal, baselineFirst: ordinal % 2 === 0,
      candidate: poolFor(row, memory, dataset.expected).candidates[0] })) };
  await mkdir(output, { recursive: false }); await write(join(output, "profile-plan.json"), { ...body, contentHash: hash(body) });
  return body;
}

/** Exported separately so offline tests can exercise paired execution without live endpoints. */
export async function measureNativePair(options: {
  boundary: PublicBoundary; checkpointId: string; ordinal: number; seed: number; signal: AbortSignal;
  candidate: ReturnType<typeof poolFor>["candidates"][number]; executor: ReadExecutor;
  nonMutating?: (invocation: ReturnType<typeof poolFor>["candidates"][number]["invocation"]) => boolean;
  actor: (suffix: string) => ReturnType<typeof localActorDecision>; prediction: () => Promise<unknown>;
}): Promise<Record<string, any> & { status: string; errorType?: string }> {
  const { candidate, executor, signal } = options;
  localActorMessages(options.boundary);
  const clockId = `native-profile:${process.pid}:${randomUUID()}`, spans: Spans = {}, raw: Record<string, any> = {
    kind: "observed_infra_timing", checkpoint_id: options.checkpointId, spans, candidate, boundaryHash: hash(options.boundary),
    baselineFirst: options.ordinal % 2 === 0, actorToolsExecuted: false };
  const timed = async <T,>(operation: () => Promise<T>) => {
    const startMs = performance.now(); const result = await operation(); return { result, span: { clockId, startMs, endMs: performance.now() } };
  };
  const actorCall = async (suffix: string) => {
    signal.throwIfAborted(); const result = await timed(() => options.actor(suffix)); raw[`actor_${suffix}`] = result; return result;
  };
  let errorType: string | null = null;
  try {
    const joint = async () => {
      const trace: unknown[] = [], wrapped: ReadExecutor = {
        eligible: invocation => executor.eligible(invocation),
        read: async (invocation, inner) => {
          const measured = await timed(() => executor.read(invocation, AbortSignal.any([signal, inner])));
          spans.toolMs = measured.span; return measured.result;
        },
        validate: async (invocation, previous, inner) => {
          const measured = await timed(() => executor.validate(invocation, previous, AbortSignal.any([signal, inner])));
          spans.validationMs = measured.span; return measured.result;
        },
      };
      const scheduler = new SpeculationScheduler(`profile:${options.checkpointId}`, wrapped, event => trace.push(event));
      const actorPromise = actorCall("concurrent");
      const background = (async () => {
        const prediction = await timed(options.prediction); spans.predictionMs = prediction.span; raw.prediction = prediction.result;
        signal.throwIfAborted();
        const startMs = performance.now(), admitted = scheduler.admit([{ ...candidate, probability: 1 }]);
        spans.schedulingMs = { clockId, startMs, endMs: performance.now() };
        if (admitted.length !== 1) throw new Error("Eligible native profiling read was not admitted");
        const promoted = await scheduler.promoteOnly(candidate.invocation);
        if (!promoted) throw new Error("Native freshness lease was not validated");
        raw.observationHash = hash(promoted.observation);
      })();
      const settled = await Promise.allSettled([actorPromise, background]);
      try { await scheduler.close(); } finally { raw.schedulerEvents = trace; }
      if (settled[0].status === "rejected") throw settled[0].reason;
      if (settled[1].status === "rejected") throw settled[1].reason;
      return settled[0].value;
    };
    const baseline = options.ordinal % 2 === 0 ? await actorCall("baseline") : null;
    const concurrent = await joint(), control = baseline ?? await actorCall("baseline");
    spans.actorLeadMs = control.span;
    spans.contentionMs = { method: "paired_difference", baseline: control.span, concurrent: concurrent.span };
    if (control.result.raw_data.goalspecCompiler.inputHash !== concurrent.result.raw_data.goalspecCompiler.inputHash) throw new Error("Paired actor input changed");
    const requested = (response: typeof control.result) => response.tool_calls?.some(call => call.name === candidate.invocation.tool && hash(call.arguments) === hash(candidate.invocation.arguments))
      && (!options.nonMutating || response.tool_calls.every(call => options.nonMutating!({ tool: call.name, arguments: JSON.parse(canonical(call.arguments)), scope: candidate.invocation.scope })));
    if (!requested(control.result) || !requested(concurrent.result)) errorType = "actor_did_not_request_profiled_read";
    if (concurrent.span.endMs - concurrent.span.startMs < control.span.endMs - control.span.startMs) errorType = "paired_contention_unresolved_negative_excess";
    if (Object.keys(spans).length !== 6) errorType = "incomplete_measured_components";
  } catch (error) { errorType = signal.aborted ? "profile_deadline" : "native_component_failure"; raw.error = error instanceof Error ? error.message : "Native profiling failed"; }
  return { ...raw, status: errorType ? "failed" : "completed", ...(errorType ? { errorType } : {}) };
}

export async function measurePreparedNativePrefix(configurationPath: string, output: string, ordinal: number) {
  const { config, dataset, memory, manifest, publicRows } = await inputs(configurationPath);
  const plan = await json(join(output, "profile-plan.json")), { contentHash, ...planBody } = plan;
  const declared = plan.rows[ordinal], row = publicRows.find(row => row.checkpoint_id === declared?.checkpoint_id);
  if (contentHash !== hash(planBody) || plan.configurationHash !== hash(config) || plan.manifestHash !== hash(manifest)
    || plan.sourceDatasetHash !== dataset.manifest.bundle_hash || plan.candidateCompilerHash !== infraCandidateCompilerHash("native") || !row) throw new Error("Prepared native profile identity changed");
  const prefix = await json(join(output, `prefix-${ordinal}.json`));
  if (prefix.checkpoint_id !== row.checkpoint_id || prefix.input_hash !== row.input_hash || prefix.verifiedPublicPrefix !== true
    || prefix.boundaryHash !== hash(prefix.boundary) || hash(prefix.boundary.tools) !== row.runtime_tool_schema_hash
    || prefix.boundary.policy !== row.input.policy) throw new Error("Native prefix gateway provenance mismatch");
  const { frame, policy, candidates } = poolFor(row, memory, dataset.expected);
  if (hash(candidates[0]) !== hash(declared.candidate)) throw new Error("Native candidate identity changed");
  const gateway = new NativeGateway(process.env.GOALSPEC_GATEWAY_URL ?? "", process.env.GOALSPEC_GATEWAY_TOKEN ?? "");
  const executor = new NativeReadExecutor(gateway, row.checkpoint_id, frame.scope, new Set(row.input.tools.filter((tool: any) => tool.side_effects === "read_only").map((tool: any) => tool.name)), policy);
  executor.updateFrame(frame);
  const actorEvents: unknown[] = [], predictorEvents: unknown[] = [];
  const actor = new LocalChatModelPort({ baseUrl: config.actorBaseUrl, model: manifest.actor.servedModel, record: event => actorEvents.push(event) });
  const model = new LocalChatModelPort({ baseUrl: config.predictorBaseUrl, model: manifest.predictor.servedModel,
    contextWindow: 8192, inputBudget: 7168, maxOutputTokens: 1024, record: event => predictorEvents.push(event) });
  const predictor = new InfraLocalPredictors(model, { memory, allowedFamilies: dataset.expected, excludeFamilies: [row.family_id] });
  const guard = nativeSplitGuard(config, manifest, resolve(configurationPath)), interruption = new AbortController();
  const guardIdentity = guard?.();
  const signal = AbortSignal.any([interruption.signal, AbortSignal.timeout(Math.min(180000, Number(process.env.GOALSPEC_PROFILE_REMAINING_MS ?? 0)))]);
  const monitor = guard ? setInterval(() => { try { guard(); } catch { interruption.abort(); } }, 500) : undefined;
  let raw: Record<string, any>;
  try { raw = await measureNativePair({ boundary: prefix.boundary, checkpointId: row.checkpoint_id, ordinal, seed: config.seed, candidate: candidates[0], executor, signal,
    nonMutating: invocation => executor.nonMutating(invocation),
    actor: suffix => localActorDecision(prefix.boundary, actor, { id: `profile:${row.checkpoint_id}:${suffix}`, seed: config.seed, maxOutputTokens: 4096, signal }),
    prediction: async () => {
      const goals = await predictor.inferGoals(frame, signal), neutral = await predictor.rawRank(frame, candidates, frame.goals, signal);
      const conditional = await predictor.rawRank(frame, candidates, goals, signal); return { goals, neutral, conditional };
    } }); } finally { if (monitor) clearInterval(monitor); }
  await write(join(output, `node-measurement-${ordinal}.json`), { ...raw, actorEvents, predictorEvents, prefixHash: hash(prefix), splitGuard: guardIdentity ?? null });
  return { checkpoint_id: row.checkpoint_id, status: raw.status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, configuration, output, ordinal] = process.argv.slice(2);
  if (!configuration || !output || !["prepare", "measure"].includes(mode)) throw new Error("Internal native profiler: prepare|measure CONFIG OUTPUT [ORDINAL]; use python -m goalspec.infra_native_profile for live runs");
  (mode === "prepare" ? prepareNativeProfile(configuration, output) : measurePreparedNativePrefix(configuration, output, Number(ordinal)))
    .then(value => console.log(JSON.stringify({ prepared: mode === "prepare", ...(mode === "measure" ? value : {}) })))
    .catch(error => { console.error(error instanceof Error ? error.message : "Native profile failed"); process.exitCode = 1; });
}
