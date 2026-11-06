import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { hash } from "../src/lib/goalspec/canonical";
import { validateInfraManifest, INFRA_MODEL_PINS } from "../src/lib/goalspec/infra-manifest";
import { LocalChatModelPort } from "../src/lib/goalspec/infra-model";
import { expectedInfraSaving, type InfraOpportunity, type InfraSessionPolicy } from "../src/lib/goalspec/infra-session";
import { InfraTelemetry } from "../services/goalspec-runtime/infra-telemetry";
import { aggregateInfraMetrics } from "../services/goalspec-runtime/infra-metrics-store";
import { DocumentReadExecutor, DOCUMENT_TOOLS, documentCandidates, validateDocumentBinding, verifyDocumentCorpus, type DocumentCorpus } from "../services/goalspec-runtime/document-adapter";
import { documentFrame, runDocumentTrial, type DocumentTask, type DocumentTrialResult } from "../services/goalspec-runtime/infra-document-runner";
import { localActorDecision } from "../services/goalspec-runtime/local-actor";
import { InfraLocalPredictors, validateInfraCalibration } from "../services/goalspec-runtime/infra-predictors";
import { validateMemoryArtifact } from "../src/lib/goalspec/experience-memory";
import { SpeculationScheduler } from "../src/lib/goalspec/scheduler";
import { validateInfraGoalReliabilityArtifact, validateInfraOpportunityArtifact } from "../services/goalspec-runtime/infra-artifacts";
import { infraCandidateCompilerHash } from "../services/goalspec-runtime/infra-compiler-identity";

async function json<T = unknown>(file: string): Promise<T> { return JSON.parse(await readFile(file, "utf8")) as T; }
async function exclusiveJson(file: string, value: unknown) { await writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
interface RunConfiguration {
  version: 1; stage: "collection" | "development" | "heldout"; manifestPath: string; ledgerCheckpointPath: string; corpusPath: string; tasksPath: string;
  actorBaseUrl: string; predictorBaseUrl?: string; calibrationPath?: string; memoryPath?: string; opportunityPath?: string; goalReliabilityPath?: string;
  schedule: { taskId: string; arm: InfraSessionPolicy["arm"]; seed: number }[];
  maximumLifetimeSeconds: number; maxSteps: number;
}
export async function runLive(configurationPath: string, output: string) {
  const config = await json<RunConfiguration>(configurationPath);
  const artifact = <T,>(file: string) => json<T>(resolve(dirname(resolve(configurationPath)), file));
  if (config.version !== 1 || !["collection", "development", "heldout"].includes(config.stage)
    || !Array.isArray(config.schedule) || !config.schedule.length || config.schedule.length > 1000
    || !Number.isSafeInteger(config.maximumLifetimeSeconds) || config.maximumLifetimeSeconds < 1 || config.maximumLifetimeSeconds > 28800
    || !Number.isSafeInteger(config.maxSteps) || config.maxSteps < 1 || config.maxSteps > 100) throw new Error("Invalid bounded run configuration");
  const manifest = await artifact(config.manifestPath); validateInfraManifest(manifest);
  if (!config.ledgerCheckpointPath || hash(await artifact(config.ledgerCheckpointPath)) !== manifest.budgets.ledgerCheckpointHash) throw new Error("Budget checkpoint mismatch");
  const corpus = verifyDocumentCorpus(await artifact<DocumentCorpus>(config.corpusPath));
  const tasks = await artifact<DocumentTask[]>(config.tasksPath);
  if (!Array.isArray(tasks) || !tasks.length || new Set(tasks.map(task => task.id)).size !== tasks.length
    || tasks.some(task => !task.id || !task.familyId || !task.prompt || !Array.isArray(task.answerContains) || !task.answerContains.length
      || !Array.isArray(task.expectedDocuments) || !task.expectedDocuments.length || task.expectedDocuments.some(id => !corpus.documents.some(doc => doc.id === id)))) throw new Error("Invalid independently verified task fixtures");
  if (hash(tasks) !== manifest.data.datasetHash || hash(DOCUMENT_TOOLS) !== manifest.data.toolSchemaHash || corpus.contentHash !== manifest.data.environmentRevision
    || hash(config.schedule) !== manifest.protocol.scheduleHash) throw new Error("Frozen dataset, tool or schedule mismatch");
  const families = config.stage === "collection" ? manifest.data.trainingFamilies : config.stage === "development" ? manifest.data.developmentFamilies : manifest.data.heldoutFamilies;
  const expectedSplit = config.stage === "collection" ? "train" : config.stage === "development" ? "development" : "test";
  const blocks = new Map<string, Set<string>>();
  for (const row of config.schedule) {
    const task = tasks.find(task => task.id === row.taskId);
    if (!task || task.split !== expectedSplit || !families.includes(task.familyId) || !manifest.seeds.includes(row.seed)
      || !["base", "neutral_memory_prefetch", "goalspec"].includes(row.arm)) throw new Error("Task family or seed outside frozen schedule");
    const key = `${row.taskId}:${row.seed}`, block = blocks.get(key) ?? new Set<string>();
    if (block.has(row.arm)) throw new Error("Duplicate trial identity"); block.add(row.arm); blocks.set(key, block);
  }
  if (config.stage === "collection" ? config.schedule.some(row => row.arm !== "base") : [...blocks.values()].some(block => block.size !== 3)) throw new Error("Incomplete paired trial blocks");
  const usesPrediction = config.schedule.some(row => row.arm !== "base");
  let estimate: InfraOpportunity = { toolMs: 0, actorLeadMs: 0, predictionMs: 0, schedulingMs: 0, validationMs: 0, contentionMs: 0 };
  let reliability = 0;
  let snapshotId = manifest.data.memoryHash;
  let predictors: InfraLocalPredictors | undefined;
  // Validate endpoints before persisting configuration, which must never contain URL credentials.
  new LocalChatModelPort({ baseUrl: config.actorBaseUrl, model: manifest.actor.servedModel });
  if (config.predictorBaseUrl) new LocalChatModelPort({ baseUrl: config.predictorBaseUrl, model: manifest.predictor.servedModel,
    contextWindow: 8192, inputBudget: 7168, maxOutputTokens: 1024 });
  const directory = resolve(output); await mkdir(directory, { recursive: false });
  await exclusiveJson(join(directory, "frozen-run.json"), { configuration: config, manifest, corpusHash: corpus.contentHash, taskHash: hash(tasks), inputConfigurationHash: hash(config) });
  const telemetry = await InfraTelemetry.create(directory, process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  try {
    const actor = new LocalChatModelPort({ baseUrl: config.actorBaseUrl, model: manifest.actor.servedModel, record: event => telemetry.record(event) });
    if (usesPrediction) {
      if (!config.predictorBaseUrl || !config.memoryPath || !config.calibrationPath || !config.opportunityPath || !config.goalReliabilityPath) throw new Error("Prediction needs frozen memory, calibration, measured opportunity and audited reliability");
      const memory = validateMemoryArtifact(await artifact(config.memoryPath));
      const calibration = validateInfraCalibration(await artifact(config.calibrationPath));
      if (memory.contentHash !== manifest.data.memoryHash || calibration.contentHash !== manifest.data.calibrationHash || calibration.sourceDatasetHash !== manifest.data.datasetHash
        || calibration.fittingFamilies.some(family => !manifest.data.trainingFamilies.includes(family))
        || calibration.validationFamilies.some(family => !manifest.data.developmentFamilies.includes(family))
        || memory.runs.some(run => run.split !== "train" || !manifest.data.trainingFamilies.includes(run.familyId))) throw new Error("Memory or calibration provenance mismatch");
      snapshotId = memory.repositorySnapshotId;
      const provenance = { datasetHash: manifest.data.datasetHash, allowedFamilies: [...manifest.data.trainingFamilies, ...manifest.data.developmentFamilies], excludedFamilies: manifest.data.heldoutFamilies };
      const opportunity = validateInfraOpportunityArtifact(await artifact(config.opportunityPath), provenance);
      if (opportunity.sampleCount < 10) throw new Error("Insufficient measured opportunity samples");
      estimate = opportunity.estimate; expectedInfraSaving(1, estimate);
      const audit = validateInfraGoalReliabilityArtifact(await artifact(config.goalReliabilityPath), provenance);
      reliability = audit.reliability;
      predictors = new InfraLocalPredictors(new LocalChatModelPort({ baseUrl: config.predictorBaseUrl, model: manifest.predictor.servedModel,
        contextWindow: 8192, inputBudget: 7168, maxOutputTokens: 1024, record: event => telemetry.record(event) }), {
        calibration, memory, expectedCandidateCompilerHash: infraCandidateCompilerHash("documents"),
        allowedFamilies: manifest.data.trainingFamilies, excludeFamilies: [...manifest.data.developmentFamilies, ...manifest.data.heldoutFamilies], record: telemetry.record,
      });
    }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), config.maximumLifetimeSeconds * 1000);
    const results: DocumentTrialResult[] = [];
    if (config.stage !== "collection") await exclusiveJson(join(directory, "paired-design.json"), {
      schema_version: "goalspec-infra-evaluation-v1", measurement_kind: "live", label: "Custom immutable-document retrieval pilot",
      source_commit: manifest.sourceCommit, actor_config_hash: hash(manifest.actor), memory_snapshot_hash: manifest.data.memoryHash, frozen_before_execution: true,
      trials: config.schedule.map((row, index) => ({ slot_id: String(index), task_id: row.taskId, family_id: tasks.find(task => task.id === row.taskId)!.familyId,
        domain: "documents", trial: manifest.seeds.indexOf(row.seed), seed: row.seed, arm: row.arm })),
    });
    try {
      for (let index = 0; index < config.schedule.length; index++) {
        const row = config.schedule[index], task = tasks.find(task => task.id === row.taskId)!;
        const policy: InfraSessionPolicy = { arm: row.arm, memoryHash: manifest.data.memoryHash, goalReliability: reliability,
          opportunity: () => ({ ...estimate }), candidates: documentCandidates, validateBinding: validateDocumentBinding,
          rank: predictors ? predictors.rank.bind(predictors) : async () => ({ action: "NO_READ", scores: [] }),
          ...(predictors ? { inferGoals: predictors.inferGoals.bind(predictors) } : {}) };
        const result = await runDocumentTrial({ runId: `${manifest.experimentId}:${index}`, task, corpus,
          scope: { tenantId: "research-documents", principalId: "research-operator", authorizationVersion: "read-only-v1", environmentVersion: manifest.data.environmentRevision, toolSchemaHash: hash(DOCUMENT_TOOLS) },
          snapshotId, seed: row.seed, actor: async (boundary, identity) => {
            const response = await localActorDecision(boundary, actor, { ...identity, maxOutputTokens: 4096 });
            return { role: response.role, content: response.content, tool_calls: response.tool_calls };
          },
          policy, telemetry, experimentKind: "live_local_actor", signal: controller.signal, maxSteps: config.maxSteps });
        results.push(result); await exclusiveJson(join(directory, `trial-${String(index).padStart(4, "0")}.json`), result);
      }
    } finally { clearTimeout(timer); }
    await exclusiveJson(join(directory, "results.json"), { version: 1, kind: "custom-document-retrieval-pilot", manifestHash: hash(manifest), results });
    if (config.stage !== "collection") await writeFile(join(directory, "paired-results.jsonl"), results.map((result, index) => JSON.stringify({
      slot_id: String(index), run_id: result.runId,
      status: result.actorCalls === 0 ? "not_started" : result.termination === "completed" ? "completed" : result.termination === "deadline_or_cancelled" ? "censored" : "failed",
      success: result.success, latency_valid: result.actorCalls > 0, latency_ms: result.actorCalls > 0 ? result.latencyMs : null, cost_usd: null,
      logical_calls: result.logicalCalls, physical_calls: result.physicalCalls, revalidation_calls: 0,
      speculative_starts: result.speculativeStarts, useful_speculations: result.useful,
      actor_config_hash: hash(manifest.actor), memory_snapshot_hash: manifest.data.memoryHash,
    })).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    return { output: directory, trials: results.length, succeeded: results.filter(result => result.success).length };
  } finally { await telemetry.close(); }
}

export async function profileCorpus(corpusPath: string, output: string) {
  const corpus = verifyDocumentCorpus(await json<DocumentCorpus>(corpusPath));
  const directory = resolve(output); await mkdir(directory, { recursive: false });
  const scope = { tenantId: "research-documents", principalId: "research-operator", authorizationVersion: "read-only-v1", environmentVersion: corpus.contentHash, toolSchemaHash: hash(DOCUMENT_TOOLS) };
  const events: Record<string, unknown>[] = [], observations: unknown[] = [];
  const executor = new DocumentReadExecutor(corpus, scope, { record: event => events.push(event) });
  const samples: Record<string, unknown>[] = [];
  for (const doc of corpus.documents.slice(0, 10)) {
    const boundary = { policy: "Profile immutable read adapter", tools: DOCUMENT_TOOLS, messages: [{ role: "user" as const, content: "Read document" },
      { role: "assistant" as const, tool_calls: [{ id: "search", name: "search_documents", arguments: { query: doc.title } }] },
      { role: "tool" as const, id: "search", content: JSON.stringify([{ document_id: doc.id }]) }] };
    const frame = documentFrame(boundary, `profile:${doc.id}`, 0, scope, corpus.contentHash); executor.updateFrame(frame);
    const candidate = documentCandidates(frame)[0], start = performance.now();
    try {
      const observation = await executor.read(candidate.invocation, AbortSignal.timeout(5000));
      const readMs = performance.now() - start, validateStart = performance.now();
      const proof = await executor.validateFreshness(candidate.invocation, observation, AbortSignal.timeout(5000));
      if (proof.status !== "verified") throw new Error("Receipt validation failed");
      samples.push({ documentId: doc.id, readMs, validationMs: performance.now() - validateStart, observationHash: hash(observation), success: true });
      observations.push(observation);
    } catch (error) { samples.push({ documentId: doc.id, success: false, errorType: error instanceof Error ? error.name : "Error", elapsedMs: performance.now() - start }); }
  }
  const report = { version: 1, kind: "real-http-adapter-profile", corpusHash: corpus.contentHash, samples, physicalReads: events.filter(event => event.type === "document_physical_started").length,
    validationQueries: 0, actorExecuted: false, taskSuccessMeasured: false, speedupMeasured: false };
  await exclusiveJson(join(directory, "profile.json"), report);
  await exclusiveJson(join(directory, "observations.json"), observations);
  return report;
}

export async function serveTelemetry() {
  const artifactRoot = resolve(process.env.GOALSPEC_ARTIFACT_DIR ?? "research/goalspec/runs");
  const directory = join(artifactRoot, `infra-service-${Date.now()}`);
  const telemetry = await InfraTelemetry.create(directory, process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const port = Number(process.env.GOALSPEC_PORT ?? 4319), host = process.env.GOALSPEC_HOST ?? "127.0.0.1";
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || !["127.0.0.1", "0.0.0.0"].includes(host)) throw new Error("Invalid service listener");
  const server = createServer((request, response) => {
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (request.url === "/metrics") {
      void aggregateInfraMetrics(artifactRoot).then(snapshot => {
        response.setHeader("content-type", "text/plain; version=0.0.4");
        response.setHeader("x-goalspec-metric-files", String(snapshot.files));
        response.setHeader("x-goalspec-metric-skipped", String(snapshot.skipped));
        response.setHeader("x-goalspec-metric-limited", String(snapshot.limited));
        response.end(snapshot.text);
      }).catch(() => response.writeHead(503).end("Metrics unavailable\n"));
    }
    else if (request.url === "/health") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ status: "ready", profile: "goalspec-infra-v1", execution: "explicit-cli-only" })); }
    else response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(port, host, resolve));
  process.stdout.write(JSON.stringify({ listening: `${host}:${port}`, artifacts: directory }) + "\n");
  await new Promise<void>(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await telemetry.close();
}

async function main() {
  const [command, input, output] = process.argv.slice(2);
  if (command === "serve") return serveTelemetry();
  if (command === "doctor") {
    const configured = ["LAMBDA_API_KEY", "OPENAI_API_KEY", "GOALSPEC_ACTOR_BASE_URL", "GOALSPEC_PREDICTOR_BASE_URL"].map(name => ({ name, configured: Object.hasOwn(process.env, name) && !!process.env[name] }));
    return { profile: "goalspec-infra-v1", node: process.version, modelPins: INFRA_MODEL_PINS, configured, note: "Presence checks only. GPU serving and account access require separate preflight." };
  }
  if (!input || !output) throw new Error("Usage: goalspec-infra-run.ts doctor | serve | live CONFIG OUTPUT | profile CORPUS OUTPUT | prepare-corpus SOURCES OUTPUT");
  if (command === "live") return runLive(input, output);
  if (command === "profile") return profileCorpus(input, output);
  if (command === "prepare-corpus") {
    const source = await json<{ id: string; documents: Omit<DocumentCorpus["documents"][number], "sha256">[] }>(input);
    const docs = [];
    for (const doc of source.documents) {
      const provisional = { version: 1 as const, id: source.id, documents: [{ ...doc, sha256: "0".repeat(64) }] };
      verifyDocumentCorpus({ ...provisional, contentHash: hash(provisional) });
      const response = await fetch(doc.url, { redirect: "error", signal: AbortSignal.timeout(10000), cache: "no-store" });
      if (!response.ok) throw new Error(`Corpus acquisition failed HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 1048576) throw new Error("Corpus document exceeds byte cap");
      docs.push({ ...doc, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    const body = { version: 1 as const, id: source.id, documents: docs }, corpus = { ...body, contentHash: hash(body) };
    verifyDocumentCorpus(corpus); await exclusiveJson(output, corpus); return { corpusHash: corpus.contentHash, documents: docs.length };
  }
  throw new Error("Unknown infrastructure command");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => { if (result) process.stdout.write(JSON.stringify(result, null, 2) + "\n"); }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Infrastructure run failed"}\n`); process.exitCode = 1;
  });
}
