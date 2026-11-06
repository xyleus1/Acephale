import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import fixture from "../research/goalspec/examples/infra-manifest-v2.fixture.json";
import { copy, hash } from "../src/lib/goalspec/canonical";
import type { InfraExperimentManifestV2 } from "../src/lib/goalspec/infra-manifest";
import { DOCUMENT_TOOLS, documentCandidates } from "../services/goalspec-runtime/document-adapter";
import { runDocumentTrial, type DocumentTask } from "../services/goalspec-runtime/infra-document-runner";
import { InfraTelemetry } from "../services/goalspec-runtime/infra-telemetry";
import { closeDocumentCollection, documentScope, exportDocumentCollection, verifyDocumentBundle } from "./goalspec-infra-document-data";
import { publicInfraFrame, runInfraPrediction } from "./goalspec-infra-predict";
import { verifyInfraAnnotationSource } from "./goalspec-infra-annotation-source";
import { compileTeacherInput } from "./goalspec-infra-annotate";
import { runOpportunityProfile } from "./goalspec-infra-profile";

const write = (file: string, value: unknown) => writeFile(file, JSON.stringify(value) + "\n", { flag: "wx" });
const rows = async (file: string) => (await readFile(file, "utf8")).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
async function collection(directory: string) {
  const content = "Fixture runtime is Node 22.", body = { version: 1 as const, id: "fixture", documents: [{ id: "setup", title: "Runtime setup", snippet: "runtime", familyId: "docs",
    url: `https://raw.githubusercontent.com/example/docs/${"a".repeat(40)}/README.md`, sha256: createHash("sha256").update(content).digest("hex") }] };
  const corpus = { ...body, contentHash: hash(body) }, scope = documentScope(corpus.contentHash);
  const tasks: DocumentTask[] = ["train", "dev", "failed"].map((familyId, index) => ({ id: `task-${index}`, familyId, split: index === 1 ? "development" : "train",
    prompt: "Find the runtime requirements", answerContains: ["Node 22"], expectedDocuments: ["setup"] }));
  const manifest = copy(fixture) as InfraExperimentManifestV2;
  manifest.data.trainingFamilies = ["train", "failed"]; manifest.data.developmentFamilies = ["dev"];
  manifest.data.datasetHash = hash(tasks); manifest.data.environmentRevision = corpus.contentHash; manifest.data.toolSchemaHash = hash(DOCUMENT_TOOLS);
  const configuration = { stage: "collection", schedule: tasks.map(task => ({ taskId: task.id, arm: "base", seed: manifest.seeds[0] })) };
  manifest.protocol.scheduleHash = hash(configuration.schedule);
  const telemetry = await InfraTelemetry.create(directory), results = [];
  for (let index = 0; index < tasks.length; index++) {
    let step = 0;
    const result = await runDocumentTrial({ runId: `${manifest.experimentId}:${index}`, task: tasks[index], corpus, scope, snapshotId: manifest.data.memoryHash,
      seed: manifest.seeds[0], telemetry, experimentKind: "live_local_actor", fetch: async () => new Response(content),
      policy: { arm: "base", memoryHash: manifest.data.memoryHash, goalReliability: 0, candidates: () => [], validateBinding: () => false,
        opportunity: () => ({ toolMs: 0, actorLeadMs: 0, predictionMs: 0, schedulingMs: 0, validationMs: 0, contentionMs: 0 }), rank: async () => ({ action: "NO_READ", scores: [] }) },
      actor: async () => {
        if (index === 2) throw new Error("Retained fixture actor failure");
        if (step++ === 0) return { role: "assistant", tool_calls: [{ id: "search", name: "search_documents", arguments: { query: "runtime" } }] };
        if (step === 2) return { role: "assistant", tool_calls: [{ id: "fetch", name: "fetch_document", arguments: { document_id: "setup" } }] };
        return { role: "assistant", content: "Node 22 [setup]" };
      } });
    results.push(result); await write(join(directory, `trial-${String(index).padStart(4, "0")}.json`), result);
  }
  await write(join(directory, "frozen-run.json"), { configuration, manifest, corpusHash: corpus.contentHash, taskHash: hash(tasks), inputConfigurationHash: hash(configuration) });
  await write(join(directory, "tasks.json"), tasks); await write(join(directory, "corpus.json"), corpus);
  await write(join(directory, "results.json"), { manifestHash: hash(manifest), results });
  await telemetry.close(); closeDocumentCollection(directory, results.length);
  return { tasks, corpus, manifest };
}

test("closed document collection exports exact frames, retains failures and calibrates both conditions through Python", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goalspec-document-data-"));
  let profileActorRequests = 0;
  const server = createServer(async (request, response) => {
    let text = ""; for await (const chunk of request) text += chunk;
    const input = JSON.parse(text);
    if (request.url === "/tokenize") { response.end(JSON.stringify({ count: 8, max_model_len: 32768, tokens: Array(8).fill(1) })); return; }
    if (!input.response_format) {
      profileActorRequests++;
      await new Promise(resolve => setTimeout(resolve, [2, 3].includes(profileActorRequests % 4) ? 100 : 1));
      response.setHeader("content-type", "text/event-stream");
      response.end(`data: ${JSON.stringify({ model: input.model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "profile-read", type: "function",
        function: { name: "fetch_document", arguments: '{"document_id":"setup"}' } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 } })}\n\ndata: [DONE]\n\n`); return;
    }
    const context = JSON.parse(input.messages[1].content), goals = input.response_format.json_schema.name === "grounded_goals";
    const output = goals ? { schemaVersion: 1, revisionHash: hash({}), unknown: 0, hypotheses: [{ id: "g", objective: "Find runtime requirements", probability: 1,
      sources: [{ sourceId: "requirement:0", path: [] }], constraints: [] }] } : { action: context.candidates.length ? "READ" : "NO_READ",
      scores: context.candidates.slice(0, 1).map((candidate: any) => ({ candidateId: candidate.id, probability: .8 })) };
    response.setHeader("content-type", "text/event-stream");
    response.end(`data: ${JSON.stringify({ model: input.model, choices: [{ index: 0, delta: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 } })}\n\ndata: [DONE]\n\n`);
  });
  try {
    const collected = await collection(join(directory, "cohort"));
    const bundle = join(directory, "bundle"), exported = exportDocumentCollection(join(directory, "cohort"), bundle);
    assert.equal(exported.declaredRuns, 3); assert.equal(exported.memoryRuns, 1); assert.equal(exported.checkpoints, 7);
    const verified = verifyDocumentBundle(bundle), prefixes = await rows(join(bundle, "public.jsonl"));
    assert.equal(verified.manifest.bundle_hash, exported.datasetHash);
    assert.ok(prefixes.every(row => !JSON.stringify(row.input).includes("answerContains") && !JSON.stringify(row.input).includes("expectedDocuments")));
    const fetchFrame = publicInfraFrame(prefixes[1], "memory");
    assert.equal(documentCandidates(fetchFrame)[0].bindings[0].sourceId, "observation:2");
    assert.equal((await rows(join(bundle, "verdicts.jsonl"))).filter(row => row.success === false).length, 1);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = (server.address() as { port: number }).port, prediction = join(directory, "prediction");
    const receipt = await runInfraPrediction({ bundle, memory: join(bundle, "runtime-memory.json"), output: prediction,
      baseUrl: `http://127.0.0.1:${port}`, limit: 100, inferGoals: true });
    assert.equal(receipt.completed, 7, JSON.stringify(await rows(join(prediction, "predictions.jsonl"))));
    const python = process.platform === "win32" ? "research/goalspec/.venv/Scripts/python.exe" : "research/goalspec/.venv/bin/python";
    const pythonEnvironment = { ...process.env, OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" };
    const pilotDirectory = join(directory, "pilot");
    const pilot = spawnSync(resolve(python), ["-m", "goalspec.infra_cli", "pilot", "--dataset", bundle, "--output", pilotDirectory, "--count", "3", "--audit-count", "2"],
      { cwd: resolve("research/goalspec"), encoding: "utf8", env: pythonEnvironment });
    assert.equal(pilot.status, 0, pilot.stderr);
    const annotationSource = verifyInfraAnnotationSource(pilotDirectory, bundle);
    assert.equal(annotationSource.rows.length, 3);
    for (const row of annotationSource.rows) compileTeacherInput(row, row.checkpoint_id);
    const calibration = spawnSync(resolve(python), ["-m", "goalspec.infra_cli", "fit-calibration", "--bundle", bundle, "--predictions", prediction,
      "--condition", "both", "--output", join(directory, "calibration")], { cwd: resolve("research/goalspec"), encoding: "utf8", env: pythonEnvironment });
    assert.equal(calibration.status, 0, calibration.stderr);
    const artifact = JSON.parse(await readFile(join(directory, "calibration/calibration.json"), "utf8"));
    assert.equal(artifact.provenance.condition, "neutral"); assert.equal(artifact.conditionalCalibration.provenance.condition, "conditional");
    const report = JSON.parse(await readFile(join(directory, "calibration/report.json"), "utf8"));
    assert.equal(report.neutral.unobservedActorActionsExcluded.length, 1);
    const checkpoint = { fixture: true }; collected.manifest.budgets.ledgerCheckpointHash = hash(checkpoint);
    collected.manifest.data.memoryHash = exported.memoryHash;
    await write(join(directory, "manifest.json"), collected.manifest); await write(join(directory, "checkpoint.json"), checkpoint);
    const profileConfig = { version: 1, datasetPath: bundle, memoryPath: join(bundle, "runtime-memory.json"), corpusPath: join(directory, "cohort/corpus.json"),
      manifestPath: "manifest.json", ledgerCheckpointPath: "checkpoint.json", actorBaseUrl: `http://127.0.0.1:${port}`, predictorBaseUrl: `http://127.0.0.1:${port}`,
      seed: collected.manifest.seeds[0], limit: 2, maximumLifetimeSeconds: 30 };
    await write(join(directory, "profile-config.json"), profileConfig);
    const measured = await runOpportunityProfile(join(directory, "profile-config.json"), join(directory, "profile"), { documentFetch: async () => new Response("Fixture runtime is Node 22.") });
    assert.equal(measured.completed, 2); assert.equal(measured.readyForAggregation, false);
    const measurement = JSON.parse(await readFile(join(directory, "profile/measurement-0000.json"), "utf8"));
    assert.equal(measurement.spans.contentionMs.method, "paired_difference");
    assert.equal(Object.keys(measurement.spans).length, 6); assert.equal(measurement.schedulerEvents.filter((event: any) => event.type === "started").length, 1);
    const failed = await runOpportunityProfile(join(directory, "profile-config.json"), join(directory, "failed-profile"), { documentFetch: async () => { throw new Error("Fixture read unavailable"); } });
    assert.equal(failed.completed, 0); assert.equal(failed.failed, 2);
    assert.equal((await rows(join(directory, "failed-profile/rows.jsonl"))).every(row => row.status === "failed" && row.evidence.sha256), true);
    await mkdir(join(directory, "native-dataset")); await write(join(directory, "native-dataset/manifest.json"), { files: {} });
    await write(join(directory, "native-profile-config.json"), { ...profileConfig, datasetPath: "native-dataset" });
    const previousRequests = profileActorRequests;
    await assert.rejects(runOpportunityProfile(join(directory, "native-profile-config.json"), join(directory, "native-profile")), /Native profiling is blocked/);
    assert.equal(profileActorRequests, previousRequests);
    await writeFile(join(directory, "cohort/trial-0000.json"), "{}\n");
    assert.throws(() => exportDocumentCollection(join(directory, "cohort"), join(directory, "tampered")), /changed/);
  } finally { server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
