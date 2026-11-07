import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import fixture from "../research/goalspec/examples/infra-manifest-v2.fixture.json";
import { hash, copy } from "../src/lib/goalspec/canonical";
import { LocalChatModelPort } from "../src/lib/goalspec/infra-model";
import type { InfraExperimentManifestV2 } from "../src/lib/goalspec/infra-manifest";
import { buildMemoryArtifact, LEXICAL_MEMORY_RETRIEVAL_HASH } from "../src/lib/goalspec/experience-memory";
import { NativeGateway } from "../services/goalspec-runtime/gateway-client";
import { INFRA_PREDICTOR_CONTRACT_HASH } from "../services/goalspec-runtime/infra-predictors";
import { infraCandidateCompilerHash } from "../services/goalspec-runtime/infra-compiler-identity";
import { infraOpportunityProfile } from "../services/goalspec-runtime/infra-opportunity-profile";
import { buildInfraNativeWorkers, infraNativeToolsHash, loadInfraNativeConfiguration, runInfraNativeService,
  validateInfraNativeConfiguration, type InfraNativeArtifacts, type InfraNativeConfiguration } from "./goalspec-infra-native";

const tools = [{ type: "function" as const, function: { name: "list_all_airports", parameters: { type: "object", properties: {}, additionalProperties: false } } }];
function configured() {
  const configuration: InfraNativeConfiguration = { version: 1, stage: "collection", manifestPath: "manifest.json", ledgerCheckpointPath: "checkpoint.json",
    actorBaseUrl: "http://localhost:8000", snapshotId: "memory-snapshot", stream: false, maximumLifetimeSeconds: 60,
    runs: [{ runId: "run", taskId: "task", familyId: "train", domain: "airline", arm: "base", seed: 0, maxBoundaries: 2, tools }] };
  const manifest = copy(fixture) as InfraExperimentManifestV2;
  manifest.data.environmentRevision = "2174a603f6d014ef94473ffa95957f6ce27100db";
  manifest.data.toolSchemaHash = infraNativeToolsHash(configuration.runs);
  manifest.protocol.scheduleHash = hash(configuration.runs);
  manifest.budgets.ledgerCheckpointHash = hash({ fixture: true });
  return { configuration, artifacts: { manifest } as InfraNativeArtifacts };
}
function speculative() {
  const { configuration, artifacts } = configured();
  configuration.stage = "development";
  configuration.predictorBaseUrl = "http://localhost:8001";
  configuration.runs[0].familyId = "dev";
  configuration.runs = (["base", "neutral_memory_prefetch", "goalspec"] as const).map(arm => ({ ...configuration.runs[0], arm, runId: `run-${arm}` }));
  artifacts.manifest.protocol.scheduleHash = hash(configuration.runs);
  artifacts.memory = buildMemoryArtifact({ repositorySnapshotId: configuration.snapshotId, sourceFiles: [], runs: [], episodes: [], misses: [] }, { profile: "v5" });
  const provenance = { model: { repository: "fixture", revision: "a".repeat(40) }, memoryHash: artifacts.memory.contentHash,
    predictorContractHash: "b".repeat(64), candidateCompilerHash: "c".repeat(64), condition: "neutral" };
  const calibration = { version: 2 as const, probabilitySemantics: "independent_next_batch_hit" as const, predictionMode: "selected_candidates" as const,
    sourceDatasetHash: artifacts.manifest.data.datasetHash, fittingFamilies: ["train"], validationFamilies: ["dev"], bins: [{ upper: 1, probability: 0.5, count: 20 }], provenance };
  const conditional = { ...calibration, provenance: { ...provenance, condition: "conditional" } };
  const paired = { ...calibration, conditionalCalibration: { ...conditional, contentHash: hash(conditional) } };
  artifacts.calibration = { ...paired, contentHash: hash(paired) };
  artifacts.manifest.data.memoryHash = artifacts.memory.contentHash;
  artifacts.manifest.data.calibrationHash = artifacts.calibration.contentHash;
  const opportunity = { version: 2 as const, sourceDatasetHash: artifacts.manifest.data.datasetHash, families: ["dev"], sampleCount: 20,
    profile: infraOpportunityProfile(artifacts.manifest, "native", { stream: configuration.stream }),
    estimate: { toolMs: 0.2, actorLeadMs: 100, predictionMs: 3, schedulingMs: 1, validationMs: 1, contentionMs: 0 } };
  artifacts.opportunity = { ...opportunity, contentHash: hash(opportunity) };
  const z = 1.959963984540054, p = 18 / 20;
  const audit = { version: 1 as const, sourceDatasetHash: artifacts.manifest.data.datasetHash, families: ["train"], annotationHash: "c".repeat(64),
    auditedCount: 20, acceptedCount: 18, unsupportedBindings: 0, gradedCount: 20, agreedCount: 18,
    provenance: { model: { repository: artifacts.manifest.predictor.repository, revision: artifacts.manifest.predictor.revision },
      memoryHash: artifacts.memory.contentHash, predictorContractHash: INFRA_PREDICTOR_CONTRACT_HASH,
      retrievalHash: LEXICAL_MEMORY_RETRIEVAL_HASH,
      candidateCompilerHash: infraCandidateCompilerHash("native") },
    reliability: (p + z * z / 40 - z * Math.sqrt(p * (1 - p) / 20 + z * z / 1600)) / (1 + z * z / 20) };
  artifacts.goalReliability = { ...audit, contentHash: hash(audit) };
  return { configuration, artifacts };
}

test("base collection validates without inventing predictor calibration or memory", async () => {
  const { configuration, artifacts } = configured();
  validateInfraNativeConfiguration(configuration, artifacts);
  const roles: string[] = [];
  const runs = buildInfraNativeWorkers(configuration, artifacts, new NativeGateway("http://127.0.0.1:1", "x".repeat(32)), () => {}, role => {
    roles.push(role);
    return new LocalChatModelPort({ baseUrl: configuration.actorBaseUrl, model: "actor" });
  });
  assert.deepEqual(roles, ["actor"]);
  await Promise.all(runs.map(run => run.worker.close()));
});

test("shadow prediction builds only training collection workers with frozen lexical memory", async () => {
  const { configuration, artifacts } = configured();
  configuration.shadowPrediction = true;
  configuration.predictorBaseUrl = "http://localhost:8001";
  artifacts.memory = buildMemoryArtifact({ repositorySnapshotId: configuration.snapshotId, sourceFiles: [], runs: [], episodes: [], misses: [] }, { profile: "v5" });
  artifacts.manifest.data.memoryHash = artifacts.memory.contentHash;
  validateInfraNativeConfiguration(configuration, artifacts);
  const roles: string[] = [];
  const workers = buildInfraNativeWorkers(configuration, artifacts, new NativeGateway("http://127.0.0.1:1", "x".repeat(32)), () => {}, role => {
    roles.push(role);
    return new LocalChatModelPort({ baseUrl: configuration.actorBaseUrl, model: role });
  });
  assert.deepEqual(roles, ["actor", "predictor"]);
  await Promise.all(workers.map(run => run.worker.close()));
  for (const change of [
    (config: InfraNativeConfiguration) => { delete config.predictorBaseUrl; },
    (config: InfraNativeConfiguration) => { config.runs[0].familyId = "dev"; },
    (config: InfraNativeConfiguration) => { config.episodicEmbeddingsPath = "embeddings.json"; },
  ]) {
    const changed = copy(configuration), changedArtifacts = copy(artifacts);
    change(changed); changedArtifacts.manifest.protocol.scheduleHash = hash(changed.runs);
    assert.throws(() => validateInfraNativeConfiguration(changed, changedArtifacts), /Shadow prediction/);
  }
  const stale = copy(artifacts); stale.manifest.data.memoryHash = "0".repeat(64);
  assert.throws(() => validateInfraNativeConfiguration(configuration, stale), /memory provenance/);
});

test("native launcher rejects opportunity measured on different hardware, transport or retrieval", () => {
  const { configuration, artifacts } = speculative();
  for (const alter of [
    (config: InfraNativeConfiguration, data: InfraNativeArtifacts) => { data.manifest.hardware.gpu = "different-gpu"; },
    (config: InfraNativeConfiguration) => { config.stream = !config.stream; },
    (_config: InfraNativeConfiguration, data: InfraNativeArtifacts) => {
      const { contentHash: _hash, ...body } = data.opportunity!;
      void _hash;
      body.profile.retrievalHash = "0".repeat(64);
      data.opportunity = { ...body, contentHash: hash(body) };
    },
  ]) {
    const changed = copy(configuration), changedArtifacts = copy(artifacts);
    alter(changed, changedArtifacts);
    assert.throws(() => validateInfraNativeConfiguration(changed, changedArtifacts), /opportunity profile differs/);
  }
});

test("native speculative configuration requires measured matching artifacts", () => {
  const { configuration, artifacts } = speculative();
  validateInfraNativeConfiguration(configuration, artifacts);
  for (const missing of ["memory", "calibration", "opportunity"] as const) {
    const changed = copy(artifacts); delete changed[missing];
    assert.throws(() => validateInfraNativeConfiguration(configuration, changed), /requires/);
  }
  const tampered = copy(artifacts); tampered.opportunity!.estimate.toolMs = 1000;
  assert.throws(() => validateInfraNativeConfiguration(configuration, tampered), /hash/);
  const swapped = copy(artifacts);
  const { contentHash: _hash, ...body } = swapped.calibration!;
  const conditional = { ...body.conditionalCalibration!, fittingFamilies: ["dev"], validationFamilies: ["train"] };
  const { contentHash: _conditionalHash, ...conditionalBody } = conditional;
  const changed = { ...body, fittingFamilies: ["dev"], validationFamilies: ["train"],
    conditionalCalibration: { ...conditionalBody, contentHash: hash(conditionalBody) } };
  swapped.calibration = { ...changed, contentHash: hash(changed) };
  swapped.manifest.data.calibrationHash = swapped.calibration.contentHash;
  assert.throws(() => validateInfraNativeConfiguration(configuration, swapped), /contamination/);
});

test("goal conditioning cannot use unsupported or fabricated audit reliability", () => {
  const { configuration, artifacts } = speculative();
  const provenance = artifacts.goalReliability!.provenance;
  delete artifacts.goalReliability;
  assert.throws(() => validateInfraNativeConfiguration(configuration, artifacts), /audited reliability/);
  const reliability = { version: 1 as const, sourceDatasetHash: artifacts.manifest.data.datasetHash, families: ["train"], annotationHash: "c".repeat(64),
    auditedCount: 20, acceptedCount: 18, unsupportedBindings: 0, gradedCount: 20, agreedCount: 18, reliability: 0.9, provenance };
  artifacts.goalReliability = { ...reliability, contentHash: hash(reliability) };
  assert.throws(() => validateInfraNativeConfiguration(configuration, artifacts), /independent audit/);
  const z = 1.959963984540054, p = 18 / 20;
  reliability.reliability = (p + z * z / 40 - z * Math.sqrt(p * (1 - p) / 20 + z * z / 1600)) / (1 + z * z / 20);
  artifacts.goalReliability = { ...reliability, contentHash: hash(reliability) };
  validateInfraNativeConfiguration(configuration, artifacts);
  const devReliability = { ...reliability, families: ["dev"] };
  artifacts.goalReliability = { ...devReliability, contentHash: hash(devReliability) };
  assert.throws(() => validateInfraNativeConfiguration(configuration, artifacts), /independent audit/);
  artifacts.goalReliability = { ...reliability, provenance: { ...provenance!, memoryHash: "0".repeat(64) }, contentHash: "" };
  const { contentHash: _, ...stale } = artifacts.goalReliability;
  artifacts.goalReliability.contentHash = hash(stale);
  assert.throws(() => validateInfraNativeConfiguration(configuration, artifacts), /frozen predictor and memory/);
});

test("heldout native execution refuses incomplete or mismatched paired blocks", () => {
  const { configuration, artifacts } = configured();
  configuration.stage = "heldout"; configuration.runs[0].familyId = "test";
  artifacts.manifest.protocol.scheduleHash = hash(configuration.runs);
  assert.throws(() => validateInfraNativeConfiguration(configuration, artifacts), /complete matched/);
  const changed = configured(); changed.configuration.runs[0].familyId = "test";
  assert.throws(() => validateInfraNativeConfiguration(changed.configuration, changed.artifacts), /split identity/);
  const development = speculative(); development.configuration.runs.pop();
  development.artifacts.manifest.protocol.scheduleHash = hash(development.configuration.runs);
  assert.throws(() => validateInfraNativeConfiguration(development.configuration, development.artifacts), /Comparison native schedule/);
});

test("loader verifies canonical budget checkpoint and rejects modified manifests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goalspec-infra-native-"));
  try {
    const { configuration, artifacts } = configured();
    await writeFile(join(directory, "config.json"), JSON.stringify(configuration));
    await writeFile(join(directory, "manifest.json"), JSON.stringify(artifacts.manifest));
    await writeFile(join(directory, "checkpoint.json"), JSON.stringify({ fixture: true }));
    assert.deepEqual((await loadInfraNativeConfiguration(join(directory, "config.json"))).configuration, configuration);
    await writeFile(join(directory, "checkpoint.json"), JSON.stringify({ fixture: false }));
    await assert.rejects(loadInfraNativeConfiguration(join(directory, "config.json")), /Budget checkpoint/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("credential-bearing model URLs fail before creating any service artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infra-native-url-"));
  try {
    const { configuration, artifacts } = configured();
    await writeFile(join(directory, "manifest.json"), JSON.stringify(artifacts.manifest));
    await writeFile(join(directory, "checkpoint.json"), JSON.stringify({ fixture: true }));
    for (const field of ["actorBaseUrl", "predictorBaseUrl"] as const) {
      const unsafe = { ...configuration, [field]: "http://user:secret@localhost:8000" };
      await writeFile(join(directory, "config.json"), JSON.stringify(unsafe));
      await assert.rejects(runInfraNativeService(join(directory, "config.json"), join(directory, "output"),
        { gatewayUrl: "http://127.0.0.1:1", gatewayToken: "x".repeat(32) }), /credential-free/);
      await assert.rejects(stat(join(directory, "output")), /ENOENT/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("native service runs a real loopback gateway decision and clean close without provider calls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goalspec-infra-native-service-"));
  const { configuration, artifacts } = configured();
  let next = 0, ready = false;
  const responses: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let raw = ""; req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw || "{}"); res.setHeader("content-type", "application/json");
      if (["/next", "/respond", "/status", "/ready"].includes(req.url ?? "") && req.headers.authorization !== `Bearer ${"x".repeat(32)}`) { res.statusCode = 401; res.end("{}"); return; }
      if (req.url === "/ready") { assert.equal(body.manifestHash, hash(configuration)); assert.equal(body.experimentManifestHash, hash(artifacts.manifest)); ready = true; res.end('{"ready":true}'); }
      else if (req.url === "/tokenize") { assert.equal(ready, true); res.end(JSON.stringify({ count: 8, max_model_len: 32768, tokens: Array(8).fill(1) })); }
      else if (req.url === "/v1/chat/completions") res.end(JSON.stringify({ model: "actor", choices: [{ index: 0,
        message: { role: "assistant", content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 } }));
      else if (req.url === "/next") res.end(JSON.stringify(next++ === 0 ? { runId: "run", boundaryId: "first", public: {
        policy: "native policy", tools, messages: [{ role: "user", content: "List airports" }],
      } } : next === 2 ? { runId: "run", boundaryId: "close", operation: "close" } : null));
      else if (req.url === "/respond") { responses.push(body); res.end("{}"); }
      else if (req.url === "/status") res.end(JSON.stringify({ closed: true }));
      else { res.statusCode = 404; res.end("{}"); }
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  configuration.actorBaseUrl = url;
  try {
    await writeFile(join(directory, "config.json"), JSON.stringify(configuration));
    await writeFile(join(directory, "manifest.json"), JSON.stringify(artifacts.manifest));
    await writeFile(join(directory, "checkpoint.json"), JSON.stringify({ fixture: true }));
    const output = join(directory, "output");
    const result = await runInfraNativeService(join(directory, "config.json"), output, { gatewayUrl: url, gatewayToken: "x".repeat(32) });
    assert.deepEqual(result, { decisions: 2, aborted: false });
    assert.equal(ready, true);
    assert.equal(responses.length, 2);
    assert.equal((responses[0].response as Record<string, unknown>).content, "done");
    const trace = (await readFile(join(output, "public-boundaries.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(trace.map(row => row.type), ["public_checkpoint", "public_response"]);
    assert.ok(!(await readFile(join(output, "events.jsonl"), "utf8")).includes("List airports"));
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

for (const stopMode of ["signal", "deadline"] as const) test(`native ${stopMode} stop cancels active inference before closing telemetry`, { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "infra-native-stop-"));
  const { configuration, artifacts } = configured();
  configuration.maximumLifetimeSeconds = stopMode === "deadline" ? 1 : 10;
  const controller = new AbortController();
  let started!: () => void, cancelled!: () => void, responds = 0, lateResponse = false;
  const actorStarted = new Promise<void>(resolve => { started = resolve; });
  const actorCancelled = new Promise<void>(resolve => { cancelled = resolve; });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer((req, res) => {
    req.resume(); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/ready") res.end('{"ready":true}');
      else if (req.url === "/next") res.end(JSON.stringify({ runId: "run", boundaryId: "pending", public: {
        policy: "native policy", tools, messages: [{ role: "user", content: "List airports" }],
      } }));
      else if (req.url === "/tokenize") res.end(JSON.stringify({ count: 8, max_model_len: 32768, tokens: Array(8).fill(1) }));
      else if (req.url === "/v1/chat/completions") {
        started();
        // A broken stop path finishes eventually so the regression fails without a 120s provider wait.
        const timer = setTimeout(() => {
          lateResponse = true;
          res.end(JSON.stringify({ model: "actor", choices: [{ index: 0, message: { role: "assistant", content: "late" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 } }));
        }, stopMode === "deadline" ? 2200 : 500);
        timers.add(timer);
        res.once("close", () => { clearTimeout(timer); timers.delete(timer); if (!res.writableEnded) cancelled(); });
      } else if (req.url === "/respond") { responds++; res.end("{}"); }
      else if (req.url === "/status") res.end('{"closed":true}');
      else { res.statusCode = 404; res.end("{}"); }
    });
  }).listen(0, "127.0.0.1");
  await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`; configuration.actorBaseUrl = url;
  try {
    await writeFile(join(directory, "config.json"), JSON.stringify(configuration));
    await writeFile(join(directory, "manifest.json"), JSON.stringify(artifacts.manifest));
    await writeFile(join(directory, "checkpoint.json"), JSON.stringify({ fixture: true }));
    const output = join(directory, "output");
    const running = runInfraNativeService(join(directory, "config.json"), output,
      { gatewayUrl: url, gatewayToken: "x".repeat(32), signal: controller.signal });
    await actorStarted; if (stopMode === "signal") controller.abort();
    assert.deepEqual(await running, { decisions: 0, aborted: true });
    assert.equal(lateResponse, false); assert.equal(responds, 0);
    await actorCancelled;
    const events = (await readFile(join(output, "events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const failed = events.findIndex(event => event.type === "model_cancelled"), closed = events.findIndex(event => event.type === "infra_native_service_closed");
    assert.ok(failed >= 0 && closed > failed);
    assert.equal(events.filter(event => event.type === "actor_generated").length, 0);
    const trace = (await readFile(join(output, "public-boundaries.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(trace.map(row => row.type), ["public_checkpoint"]);
    assert.equal((await stat(join(output, "telemetry-export-receipt.json"))).isFile(), true);
  } finally {
    controller.abort(); timers.forEach(clearTimeout); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
