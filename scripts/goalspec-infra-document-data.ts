/** Export closed base document collections without exposing answer keys to prediction. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, copy, hash, type Json } from "../src/lib/goalspec/canonical";
import { validateInfraManifest, type InfraExperimentManifestV2 } from "../src/lib/goalspec/infra-manifest";
import { buildMemoryArtifact, type MemoryMessage, type MemoryRun, validateMemoryArtifact } from "../src/lib/goalspec/experience-memory";
import { documentFrame, type DocumentTask, type DocumentTrialResult } from "../services/goalspec-runtime/infra-document-runner";
import type { ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { DOCUMENT_TOOLS, verifyDocumentCorpus, type DocumentCorpus } from "../services/goalspec-runtime/document-adapter";
import type { NativeMessage, PublicBoundary } from "../services/goalspec-runtime/actor";
import { extractMemoryEpisodes } from "./goalspec-build-memory-v3";

const json = <T = any>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const lines = (path: string): any[] => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const write = (path: string, value: unknown) => writeFileSync(path, canonical(value) + "\n", { flag: "wx", mode: 0o600 });
export const documentScope = (corpusHash: string) => ({ tenantId: "research-documents", principalId: "research-operator",
  authorizationVersion: "read-only-v1", environmentVersion: corpusHash, toolSchemaHash: hash(DOCUMENT_TOOLS) });
export function documentPublicInput(boundary: PublicBoundary, frame: ExecutionFrame) {
  return { policy: boundary.policy,
    tools: DOCUMENT_TOOLS.map(tool => ({ name: tool.function.name, parameters: tool.function.parameters,
      description: tool.function.description, side_effects: "read_only", cacheable: tool.function.name === "fetch_document" })),
    events: boundary.messages.map((message, seq) => ({ kind: "message", seq, role: message.role, content: message.content ?? "",
      call_id: message.id ?? null, tool_calls: copy(message.tool_calls ?? []) })),
    sources: [{ id: "policy", kind: "policy", value: boundary.policy }, ...Object.entries(frame.sources).filter(([id]) => !id.startsWith("_"))
      .map(([id, value]) => ({ id, kind: id.startsWith("requirement:") ? "user" : "observation", value }))] };
}

/** Called only after telemetry drains successfully. A failed cohort has no closed receipt. */
export function closeDocumentCollection(directory: string, count: number) {
  const names = ["frozen-run.json", "tasks.json", "corpus.json", "events.jsonl", "results.json",
    ...Array.from({ length: count }, (_, index) => `trial-${String(index).padStart(4, "0")}.json`)];
  const body = { version: 1, kind: "closed_document_collection", closed: true,
    files: Object.fromEntries(names.map(name => [name, sha(join(directory, name))])) };
  write(join(directory, "collection-receipt.json"), { ...body, contentHash: hash(body) });
}

export function verifyDocumentBundle(directory: string) {
  const manifest = json(join(directory, "manifest.json"));
  if (manifest.schema_version !== "goalspec-infra-data-v1" || hash(manifest.files) !== manifest.bundle_hash
    || ["public.jsonl", "labels.jsonl", "verdicts.jsonl", "split.json", "document-lineage.json"].some(name => !manifest.files[name])) throw new Error("Invalid document dataset manifest");
  for (const [name, details] of Object.entries(manifest.files) as [string, { sha256: string }][]) {
    if (basename(name) !== name || sha(join(directory, name)) !== details.sha256) throw new Error("Document dataset changed");
  }
  const lineage = json(join(directory, "document-lineage.json")), split = json(join(directory, "split.json"));
  if (lineage.version !== "goalspec-infra-document-data-v1" || lineage.allDeclaredSlotsRetained !== true
    || !/^[a-f0-9]{64}$/.test(lineage.taskHash) || !/^[a-f0-9]{64}$/.test(lineage.corpusHash)
    || split.fresh_heldout !== false || !split.families || Object.values(split.families).some(value => !["train", "development", "test"].includes(String(value)))) throw new Error("Invalid document dataset lineage");
  const expected = Object.keys(split.families).filter(family => split.families[family] === "train");
  for (const row of lines(join(directory, "public.jsonl"))) {
    if (row.domain !== "documents" || hash(row.input) !== row.input_hash || split.families[row.family_id] !== row.split
      || !["train", "development"].includes(row.split) || row.runtime_tool_schema_hash !== hash(DOCUMENT_TOOLS)
      || row.environment_version !== lineage.corpusHash || row.scope.tenant_id !== "research-documents"
      || row.scope.principal_id !== "research-operator" || row.scope.authorization_revision !== "read-only-v1"
      || hash(row.document_boundary.tools) !== hash(DOCUMENT_TOOLS)
      || hash(documentPublicInput(row.document_boundary, documentFrame(row.document_boundary, row.episode_id, row.checkpoint_number,
        documentScope(lineage.corpusHash), "verify"))) !== row.input_hash) throw new Error("Document checkpoint identity mismatch");
  }
  return { manifest, lineage, split, expected };
}

export function exportDocumentCollection(cohort: string, output: string) {
  if (existsSync(output)) throw new Error("Document export output must be new");
  const receipt = json(join(cohort, "collection-receipt.json")), { contentHash, ...receiptBody } = receipt;
  if (receipt.kind !== "closed_document_collection" || receipt.closed !== true || hash(receiptBody) !== contentHash) throw new Error("Document collection is not closed");
  for (const [name, digest] of Object.entries(receipt.files)) {
    if (basename(name) !== name || sha(join(cohort, name)) !== digest) throw new Error("Document collection file changed");
  }
  const frozen = json(join(cohort, "frozen-run.json")), manifest: InfraExperimentManifestV2 = frozen.manifest;
  validateInfraManifest(manifest);
  const config = frozen.configuration, tasks = json<DocumentTask[]>(join(cohort, "tasks.json"));
  const corpus = verifyDocumentCorpus(json<DocumentCorpus>(join(cohort, "corpus.json")));
  const results = json(join(cohort, "results.json")), events = lines(join(cohort, "events.jsonl"));
  if (config.stage !== "collection" || hash(config) !== frozen.inputConfigurationHash || hash(config.schedule) !== manifest.protocol.scheduleHash
    || hash(tasks) !== frozen.taskHash || hash(tasks) !== manifest.data.datasetHash || corpus.contentHash !== frozen.corpusHash
    || corpus.contentHash !== manifest.data.environmentRevision || results.manifestHash !== hash(manifest)
    || config.schedule.length !== results.results.length || config.schedule.some((row: any) => row.arm !== "base")
    || events.some((event, index) => event.sequence !== index)) throw new Error("Document collection identity or closed schedule differs");
  const required = ["frozen-run.json", "tasks.json", "corpus.json", "events.jsonl", "results.json",
    ...config.schedule.map((_: unknown, index: number) => `trial-${String(index).padStart(4, "0")}.json`)];
  if (hash(Object.keys(receipt.files).sort()) !== hash(required.sort())) throw new Error("Incomplete collection receipt inventory");
  const families: Record<string, string> = {};
  for (const task of tasks) {
    const allowed = task.split === "train" ? manifest.data.trainingFamilies : task.split === "development" ? manifest.data.developmentFamilies : manifest.data.heldoutFamilies;
    if (!allowed.includes(task.familyId) || families[task.familyId] && families[task.familyId] !== task.split) throw new Error("Document family crosses partitions");
    families[task.familyId] = task.split;
  }
  const scope = documentScope(corpus.contentHash), publicRows: any[] = [], labels: any[] = [], verdicts: any[] = [], metadata: any[] = [];
  const runs: MemoryRun[] = [], episodes: ReturnType<typeof extractMemoryEpisodes> = [];
  const sourceFiles = Object.entries(receipt.files).map(([name, digest]) => ({ path: resolve(cohort, name), sha256: String(digest) }));
  for (let index = 0; index < config.schedule.length; index++) {
    const slot = config.schedule[index], task = tasks.find(item => item.id === slot.taskId), result = results.results[index] as DocumentTrialResult;
    if (!task || !["train", "development"].includes(task.split) || !manifest.seeds.includes(slot.seed)
      || result.runId !== `${manifest.experimentId}:${index}` || result.taskId !== task.id || result.familyId !== task.familyId
      || result.arm !== "base" || result.seed !== slot.seed || result.experimentKind !== "live_local_actor"
      || result.corpusHash !== corpus.contentHash || result.taskHash !== hash(task)
      || result.independentVerifier !== "document-evidence-and-answer-v1"
      || hash(result) !== hash(json(join(cohort, `trial-${String(index).padStart(4, "0")}.json`)))) throw new Error("Document declared trial mismatch");
    const captured = events.filter(row => row.runId === result.runId);
    const transcripts = captured.filter(row => row.type === "public_transcript"), completed = captured.filter(row => row.type === "trial_completed");
    if (transcripts.length !== 1 || completed.length !== 1 || hash(completed[0].result) !== hash(result)
      || hash(transcripts[0].messages) !== result.transcriptHash) throw new Error("Missing or changed document transcript/result");
    const messages: NativeMessage[] = transcripts[0].messages;
    const checkpoints = captured.filter(row => row.type === "public_actor_checkpoint");
    if (checkpoints.length !== result.actorCalls || hash(checkpoints.map(row => row.publicInputHash)) !== hash(result.actorInputHashes)) throw new Error("Document checkpoints omitted");
    const fetched = new Set<string>();
    for (const message of messages.filter(message => message.role === "tool")) {
      const value = JSON.parse(message.content ?? "null");
      if (value && typeof value === "object" && !Array.isArray(value) && typeof value.document_id === "string" && typeof value.content === "string") {
        const doc = corpus.documents.find(doc => doc.id === value.document_id);
        if (!doc || value.sha256 !== doc.sha256 || value.corpusHash !== corpus.contentHash
          || createHash("sha256").update(value.content).digest("hex") !== doc.sha256) throw new Error("Document evidence hash mismatch");
        fetched.add(doc.id);
      }
    }
    const final = messages.at(-1), finalText = final?.role === "assistant" && !final.tool_calls?.length ? final.content ?? "" : "";
    const success = result.termination === "completed" && task.expectedDocuments.every(id => fetched.has(id))
      && task.answerContains.every(text => finalText.toLowerCase().includes(text.toLowerCase()));
    if (result.success !== success) throw new Error("Independent document success differs from retained evidence");
    for (const checkpoint of checkpoints) {
      const boundary = checkpoint.publicInput as PublicBoundary;
      const frame = documentFrame(boundary, result.runId, checkpoint.checkpoint, scope, manifest.data.memoryHash);
      if (hash(boundary) !== checkpoint.publicInputHash || hash(frame) !== checkpoint.frameHash || hash(boundary.tools) !== hash(DOCUMENT_TOOLS)
        || hash(messages.slice(0, boundary.messages.length)) !== hash(boundary.messages)) throw new Error("Document public boundary differs from actual captured prefix");
      const responses = captured.filter(row => row.type === "authoritative_actor_response" && row.checkpoint === checkpoint.checkpoint);
      if (responses.length > 1 || responses.length === 1 && hash(messages[boundary.messages.length]) !== hash(responses[0].response)) throw new Error("Document next response differs from transcript");
      const input = documentPublicInput(boundary, frame);
      const key = hash({ runId: result.runId, checkpoint: checkpoint.checkpoint });
      publicRows.push({ schema_version: "goalspec-infra-data-v1", checkpoint_id: key, input_hash: hash(input), episode_id: result.runId, family_id: task.familyId, split: task.split,
        benchmark: "custom-immutable-documents", domain: "documents", through_seq: input.events.length - 1, checkpoint_number: checkpoint.checkpoint,
        request_revision: hash(task.prompt), environment_version: corpus.contentHash, runtime_tool_schema_hash: hash(DOCUMENT_TOOLS), tool_schema_hash: hash(input.tools),
        scope: { tenant_id: scope.tenantId, principal_id: scope.principalId, authorization_revision: scope.authorizationVersion }, input, document_boundary: boundary });
      const eligible = (responses[0]?.response.tool_calls ?? []).filter((call: any) => call.name === "fetch_document").map((call: any) => ({ tool: call.name, arguments: call.arguments }));
      labels.push({ checkpoint_id: key, input_hash: hash(input), eligible_reads: eligible, status: responses.length ? "observed" : "no_returned_actor_response" });
    }
    verdicts.push({ runId: result.runId, familyId: task.familyId, split: task.split, success, termination: result.termination, resultHash: hash(result), memoryEligible: task.split === "train" && success });
    metadata.push({ episode_id: result.runId, family_id: task.familyId, verification_tier: "independent_replay", source_revision: manifest.sourceCommit,
      environment_version: corpus.contentHash, captured_before_execution: true });
    if (task.split === "train" && success) {
      const memoryMessages: MemoryMessage[] = messages.map((message, index) => ({ index, role: message.role as MemoryMessage["role"], content: message.content ?? null,
        calls: (message.tool_calls ?? []).map(call => ({ id: call.id, tool: call.name, arguments: copy(call.arguments) as Record<string, Json> })),
        callId: message.role === "tool" ? message.id ?? null : null, observation: message.role === "tool" ? JSON.parse(message.content ?? "null") : null }));
      const run: MemoryRun = { id: result.runId, familyId: task.familyId, stage: "v5-training", split: "train", scope, policyHash: hash(checkpoints[0].publicInput.policy), sourceFiles,
        success: true, outcomeVerified: true, constraintViolations: 0, termination: result.termination, publicMessageCount: messages.length, episodeCount: 0 };
      const extracted = extractMemoryEpisodes(run, memoryMessages); run.episodeCount = extracted.length; runs.push(run); episodes.push(...extracted);
    }
  }
  const files: Record<string, unknown> = { "public.jsonl": publicRows, "labels.jsonl": labels, "verdicts.jsonl": verdicts,
    "metadata.jsonl": metadata,
    "split.json": { schema_version: "goalspec-infra-data-v1", families: Object.fromEntries(metadata.map(row => [row.family_id, families[row.family_id]])),
      episodes: Object.fromEntries(metadata.map(row => [row.episode_id, row.family_id])),
      metadata_hash: hash([...metadata].sort((a, b) => a.episode_id < b.episode_id ? -1 : a.episode_id > b.episode_id ? 1 : 0)), fresh_heldout: false },
    "document-lineage.json": { version: "goalspec-infra-document-data-v1", taskHash: hash(tasks), corpusHash: corpus.contentHash,
      actor: { repository: manifest.actor.repository, revision: manifest.actor.revision }, collectionReceiptHash: receipt.contentHash, allDeclaredSlotsRetained: true,
      sourceFiles, declaredRuns: config.schedule.length, memoryEligibleRuns: runs.length, endpointGoalsImported: false } };
  if (Object.entries(receipt.files).some(([name, digest]) => sha(join(cohort, name)) !== digest)) throw new Error("Document collection changed during export");
  mkdirSync(output, { recursive: false });
  const inventory: Record<string, { sha256: string; rows?: number }> = {};
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(output, name), name.endsWith(".jsonl") ? (value as unknown[]).map(canonical).join("\n") + "\n" : canonical(value) + "\n", { flag: "wx", mode: 0o600 });
    inventory[name] = { sha256: sha(join(output, name)), ...(Array.isArray(value) ? { rows: value.length } : {}) };
  }
  const dataset = { schema_version: "goalspec-infra-data-v1", files: inventory, bundle_hash: hash(inventory) };
  const memory = buildMemoryArtifact({ repositorySnapshotId: `infra-documents:${dataset.bundle_hash}`, sourceFiles, runs, episodes, misses: [] }, { profile: "v5" });
  validateMemoryArtifact(memory); write(join(output, "runtime-memory.json"), memory);
  // Publish the dataset completion marker only after memory construction succeeds.
  write(join(output, "manifest.json"), dataset);
  verifyDocumentBundle(output);
  return { output: resolve(output), datasetHash: dataset.bundle_hash, memoryHash: memory.contentHash, checkpoints: publicRows.length, declaredRuns: config.schedule.length, memoryRuns: runs.length, memoryEpisodes: episodes.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [cohort, output] = process.argv.slice(2);
  if (!cohort || !output) throw new Error("Usage: goalspec-infra-document-data.ts CLOSED_COLLECTION NEW_OUTPUT");
  console.log(JSON.stringify(exportDocumentCollection(resolve(cohort), resolve(output)), null, 2));
}
