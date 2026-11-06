import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { hash, copy, canonical } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame, Json, GoalSet } from "../src/lib/goalspec/contracts/generated";
import { validateContract } from "../src/lib/goalspec/contracts/validate";
import { INFRA_MODEL_PINS } from "../src/lib/goalspec/infra-manifest";
import { LocalChatModelPort } from "../src/lib/goalspec/infra-model";
import { validateMemoryArtifact } from "../src/lib/goalspec/experience-memory";
import { createInfraNativeCandidates } from "../services/goalspec-runtime/infra-candidates";
import { infraCandidateCompilerHash } from "../services/goalspec-runtime/infra-compiler-identity";
import { InfraLocalPredictors, INFRA_PREDICTOR_CONTRACT_HASH } from "../services/goalspec-runtime/infra-predictors";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";
import { verifyInfraPilotBundle } from "./goalspec-infra-memory";

interface PublicRow {
  checkpoint_id: string; input_hash: string; episode_id: string; family_id: string; split: string; domain: string; through_seq: number;
  environment_version: string; tool_schema_hash: string;
  scope: { tenant_id: string; principal_id: string; authorization_revision: string };
  input: { policy: string; sources: { id: string; kind: string; value: Json }[];
    events: { kind: string; seq: number; role?: string; content?: string; tool?: string; status?: string; [key: string]: unknown }[];
    tools: { name: string; parameters: Record<string, unknown> }[] };
}
/** Round-robin family partitions so a bounded replay includes development rows. */
export function selectInfraReplayRows<T extends { split: string; family_id: string; checkpoint_id: string }>(rows: T[], limit: number): T[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid replay bound");
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    if (row.split === "test") continue;
    if (!["train", "development"].includes(row.split)) throw new Error("Unknown replay partition");
    const key = `${row.split}:${row.family_id}`;
    const bucket = buckets.get(key) ?? []; bucket.push(row); buckets.set(key, bucket);
  }
  const groups = [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([, bucket]) => bucket);
  const selected: T[] = [];
  for (let index = 0; selected.length < limit && groups.some(group => index < group.length); index++) {
    for (const group of groups) if (index < group.length && selected.length < limit) selected.push(group[index]);
  }
  return selected;
}
export function publicInfraFrame(row: PublicRow, snapshotId: string): ExecutionFrame {
  if (hash(row.input) !== row.input_hash || !["train", "development", "test"].includes(row.split)
    || !["retail", "airline"].includes(row.domain) || !Array.isArray(row.input.sources) || row.input.events.some(event => event.seq > row.through_seq)) throw new Error("Invalid public checkpoint provenance");
  const sources: Record<string, Json> = Object.fromEntries(row.input.sources.map(source => [source.id, copy(source.value)]));
  const requirements = row.input.events.filter(event => event.kind === "message" && event.role === "user" && typeof event.content === "string");
  for (const event of requirements) {
    const id = `requirement:${event.seq}`;
    if (Object.hasOwn(sources, id) && sources[id] !== event.content) throw new Error("Conflicting public requirement provenance");
    sources[id] = event.content!;
  }
  sources._binding_events = copy(row.input.events.filter(event => ["tool_request", "tool_result"].includes(event.kind))) as Json;
  sources._signatures = row.input.events.filter(event => event.kind === "tool_result").map(event => `${event.tool}:${event.status}`);
  const frame: ExecutionFrame = { schemaVersion: 1, runId: `replay:${row.episode_id}`, boundary: row.through_seq + 1,
    scope: { tenantId: row.scope.tenant_id, principalId: row.scope.principal_id, authorizationVersion: row.scope.authorization_revision,
      environmentVersion: row.environment_version, toolSchemaHash: row.tool_schema_hash }, snapshotId,
    requestedObjective: requirements.map(event => event.content).join("\n") || "No requested objective is visible at this checkpoint.",
    policy: row.input.policy, sources, goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
  validateContract("ExecutionFrame", frame); return frame;
}
export async function runInfraPrediction(input: { bundle: string; memory: string; output: string; baseUrl: string; limit: number; inferGoals: boolean }) {
  const pilot = verifyInfraPilotBundle(input.bundle);
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error("Invalid replay bound");
  const memory = validateMemoryArtifact(JSON.parse(await readFile(input.memory, "utf8")));
  const rows = selectInfraReplayRows((await readFile(join(input.bundle, "public.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as PublicRow), input.limit);
  const output = resolve(input.output); await mkdir(output, { recursive: false });
  const candidateCompilerHash = infraCandidateCompilerHash("native");
  const lineage = { version: 1, kind: "uncalibrated_prediction_replay", model: INFRA_MODEL_PINS.predictor, memoryHash: memory.contentHash,
    predictorContractHash: INFRA_PREDICTOR_CONTRACT_HASH, candidateCompilerHash,
    sourceDatasetHash: pilot.manifest.bundle_hash, limit: input.limit, selection: "family-partition-round-robin-v1", inferGoals: input.inferGoals, rowIds: rows.map(row => row.checkpoint_id), executionAllowed: false };
  await writeFile(join(output, "manifest.json"), canonical({ ...lineage, contentHash: hash(lineage) }) + "\n", { flag: "wx" });
  const model = new LocalChatModelPort({ baseUrl: input.baseUrl, model: INFRA_MODEL_PINS.predictor.repository, contextWindow: 8192, inputBudget: 7168, maxOutputTokens: 1024 });
  let completed = 0;
  const lifetime = AbortSignal.timeout(2 * 3600 * 1000);
  for (const row of rows) {
    try {
    lifetime.throwIfAborted();
    const frame = publicInfraFrame(row, memory.repositorySnapshotId), tools = Object.fromEntries(row.input.tools.map(tool => [tool.name, tool.parameters]));
    const reads = new NativeReadPolicy(row.domain as "retail" | "airline", frame.scope); reads.updateFrame(frame);
    const pool = createInfraNativeCandidates(memory, tools, invocation => reads.eligible(invocation), { excludeFamilies: [row.family_id], allowedFamilies: pilot.expected });
    const candidates = pool.candidates(frame);
    const predictor = new InfraLocalPredictors(model, { memory, allowedFamilies: pilot.expected, excludeFamilies: [row.family_id] });
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(120000)]);
      const goals: GoalSet = input.inferGoals ? await predictor.inferGoals(frame, signal) : frame.goals;
      const neutral = await predictor.rawRank(frame, candidates, frame.goals, signal);
      const conditional = input.inferGoals ? await predictor.rawRank(frame, candidates, goals, signal) : null;
      await appendFile(join(output, "predictions.jsonl"), canonical({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash, family_id: row.family_id,
        split: row.split, candidates, goals, neutral, conditional, status: "completed" }) + "\n"); completed++;
    } catch (error) {
      await appendFile(join(output, "predictions.jsonl"), canonical({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash, family_id: row.family_id,
        split: row.split, status: lifetime.aborted ? "not_dispatched" : "failed", errorType: error instanceof Error ? error.name : "Error" }) + "\n");
    }
  }
  const receipt = { declared: rows.length, completed, failed: rows.length - completed, liveActorExecuted: false, toolExecutionPerformed: false };
  await writeFile(join(output, "receipt.json"), canonical(receipt) + "\n", { flag: "wx" }); return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [bundle, memory, output, baseUrl, limit = "100", condition = "neutral"] = process.argv.slice(2);
  if (!bundle || !memory || !output || !baseUrl || !["neutral", "goals"].includes(condition)) throw new Error("Usage: goalspec-infra-predict.ts BUNDLE MEMORY OUTPUT LOCAL_MODEL_URL [LIMIT] [neutral|goals]");
  runInfraPrediction({ bundle, memory, output, baseUrl, limit: Number(limit), inferGoals: condition === "goals" }).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error instanceof Error ? error.message : "Prediction replay failed"); process.exitCode = 1; });
}
