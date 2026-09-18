import Ajv2020 from "ajv/dist/2020";
import { createHash } from "node:crypto";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, Json } from "../src/lib/goalspec/contracts/generated";
import { LocalController } from "../src/lib/goalspec/controller";
import { buildDecisionState, extractCandidateFeatures } from "../src/lib/goalspec/controller-features";
import { nativeCandidateGraph } from "../services/goalspec-runtime/native-candidate-graph";
import { publicPrefixSources } from "./goalspec-prediction-v3";
import { scorePublicPrediction, type PublicPrediction } from "./goalspec-controller-native-v4-replay";

export const APIGEN_VERSION = "goalspec-apigen-frozen-read-prediction-v1";
const NATIVE_BINDER_VERSION = "2174a603f6d014ef94473ffa95957f6ce27100db";
const REVISION = "abc4a517d67c541f85f6470cbd8fd3186b36830e";
export const APIGEN_READS = { retail: ["find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"],
  airline: ["get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"] };
type Domain = keyof typeof APIGEN_READS;
type Action = { tool: string; arguments: Record<string, Json> };
type Message = { role: "user" | "assistant" | "function_call" | "tool"; content: string };
type PublicMessage = Parameters<typeof publicPrefixSources>[0][number];
export type Episode = { id: string; source_id: string; family_id: string; content_hash: string; split: string; policy: string;
  source: string; revision: string; license: string; license_text: string; verification_tier: string; native_executable: boolean;
  tools: { name: string; parameters: Record<string, unknown> }[]; messages: Message[] };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export async function fileSha(path: string) { const result = createHash("sha256"); for await (const chunk of createReadStream(path)) result.update(chunk); return result.digest("hex"); }
const ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
const validatorCache = new Map<string, ReturnType<Ajv2020["compile"]>>();
function validator(schema: Record<string, unknown>) { const key = hash(schema); let result = validatorCache.get(key); if (!result) { result = ajv.compile(schema); validatorCache.set(key, result); } return result; }
export function parseAPIGenAction(content: string, catalog: Record<string, Record<string, unknown>>) {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return { action: null, reason: "malformed_call_json" }; }
  if (!object(raw) || typeof raw.name !== "string" || !raw.name || !Object.hasOwn(raw, "arguments")
    || Object.keys(raw).some(k => !["name", "arguments"].includes(k))) return { action: null, reason: "malformed_call_envelope" };
  let args: unknown = raw.arguments;
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { return { action: null, reason: "malformed_argument_json" }; } }
  if (!object(args)) return { action: null, reason: "arguments_not_object" };
  const action = { tool: raw.name, arguments: args as Record<string, Json> };
  if (!Object.hasOwn(catalog, raw.name)) return { action, reason: "tool_outside_source_catalog" };
  try { if (!validator(catalog[raw.name])(args)) return { action, reason: "arguments_fail_source_schema" }; }
  catch { return { action, reason: "unsupported_source_schema" }; }
  return { action, reason: null };
}
function catalogFor(episode: Episode) {
  if (!Array.isArray(episode.tools) || !episode.tools.length) throw new Error("Missing source catalog");
  const tools: Record<string, Record<string, unknown>> = {};
  for (const tool of episode.tools) {
    if (!tool || typeof tool.name !== "string" || Object.hasOwn(tools, tool.name) || !object(tool.parameters)) throw new Error("Invalid source catalog");
    validator(tool.parameters); tools[tool.name] = tool.parameters;
  }
  return tools;
}
export function apigenFrame(episode: Episode, prefix: PublicMessage[], boundary: number): ExecutionFrame {
  return { schemaVersion: 1, runId: episode.id, boundary, snapshotId: `APIGen-source:${episode.revision}`, policy: episode.policy,
    scope: { tenantId: "apigen-public-research", principalId: "unverified-source-actor", authorizationVersion: "not-established",
      environmentVersion: `unverified-apigen:${episode.revision}`, toolSchemaHash: hash(episode.tools) },
    requestedObjective: prefix.filter(m => m.role === "user").map(m => m.content ?? "").join("\n"),
    sources: publicPrefixSources(prefix), goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
}
/** No next action or outcome parameter. This static compatibility view cannot authorize or execute reads. */
export function predictAPIGenPrefix(frame: ExecutionFrame, tools: Record<string, Record<string, unknown>>, controller: LocalController): PublicPrediction {
  if (!frame.scope.environmentVersion.startsWith("unverified-apigen:") || frame.scope.authorizationVersion !== "not-established") throw new Error("Only non-executable APIGen source frames accepted");
  const compatibilityView = { ...frame, scope: { ...frame.scope, environmentVersion: NATIVE_BINDER_VERSION } };
  // The frozen binder is version-gated. Its native version here denotes the
  // static binding algorithm, not the source environment or authorization.
  const candidates: Candidate[] = nativeCandidateGraph(compatibilityView, tools, () => true, { maxCandidates: 32 }).map(candidate => {
    const invocation = { ...candidate.invocation, scope: frame.scope };
    return { ...candidate, invocation, id: hash(["apigen-static-proposal", invocation]) };
  });
  const state = buildDecisionState(frame), scores = controller.score(state, candidates), byId = new Map(scores.candidates.map(s => [s.candidateId, s]));
  const threshold = controller.artifact.thresholds, poolHash = hash(candidates);
  const universes: PublicPrediction["universes"] = (["current-prior", "frozen-logistic"] as const).map(ranker => {
    const actionReadProbability = ranker === "current-prior" ? Number(candidates.length > 0) : scores.actionRead;
    const ranked = candidates.map(candidate => ({ candidate, nextAction: ranker === "current-prior" ? candidate.probability : byId.get(candidate.id)!.nextAction,
      usefulWithin2: ranker === "current-prior" ? candidate.probability : byId.get(candidate.id)!.usefulWithin2,
      readiness: ranker === "current-prior" ? 1 : byId.get(candidate.id)!.readiness }))
      .sort((a, b) => b.nextAction + b.usefulWithin2 - a.nextAction - a.usefulWithin2 || a.candidate.id.localeCompare(b.candidate.id));
    const predictedRead = actionReadProbability >= (ranker === "current-prior" ? .5 : threshold.actionRead);
    const admitted = predictedRead ? ranked.filter(r => ranker === "current-prior" || r.usefulWithin2 >= threshold.usefulWithin2 && r.readiness >= threshold.readiness) : [];
    return { universe: "proposal", ranker, poolHash, poolSize: candidates.length, actionReadProbability, predictedRead, ranked,
      admittedCandidateIds: admitted.slice(0, 3).map(r => r.candidate.id) };
  });
  return { frameHash: hash(frame), stateHash: hash(state), actionFeaturesHash: hash(extractCandidateFeatures(state, null)), candidatePoolHash: poolHash,
    candidates: candidates.map(candidate => ({ candidate, eligible: false, featureHash: hash(extractCandidateFeatures(state, candidate)) })), universes };
}
/** Prediction precedes parsing each target. All source messages, including invalid calls, remain coverage records. */
export function replayAPIGenEpisode(episode: Episode, controller: LocalController,
  emit: (checkpoint: Record<string, unknown>, scores: ReturnType<typeof scorePublicPrediction>) => void) {
  const domain = episode.family_id.split(":")[0] as Domain;
  if (!Object.hasOwn(APIGEN_READS, domain) || !Array.isArray(episode.messages)) throw new Error("Unsupported APIGen episode");
  const catalog = catalogFor(episode), readNames = APIGEN_READS[domain].filter(name => Object.hasOwn(catalog, name));
  const readTools = Object.fromEntries(readNames.map(name => [name, catalog[name]])), prefix: PublicMessage[] = [];
  const errors: Record<string, number> = {}; let pending: { id: string; valid: boolean } | null = null, boundary = 0, tainted = false;
  for (const [index, message] of episode.messages.entries()) {
    if (!message || typeof message.content !== "string" || !["user", "assistant", "tool", "function_call"].includes(message.role)) throw new Error("Unsupported source message");
    if (message.role === "user") { prefix.push({ role: "user", content: message.content, calls: [] }); continue; }
    if (message.role === "tool") {
      if (!pending) { errors.unmatched_tool_observation = (errors.unmatched_tool_observation ?? 0) + 1; tainted = true; }
      else if (pending.valid) prefix.push({ role: "tool", id: pending.id, content: message.content, calls: [] });
      pending = null; continue;
    }
    const frame = apigenFrame(episode, prefix, boundary), prediction = predictAPIGenPrefix(frame, readTools, controller);
    // Target parsing is intentionally below prediction. A different future
    // action can change labels but cannot change this checkpoint's candidates.
    const parsed = message.role === "function_call" ? parseAPIGenAction(message.content, catalog) : { action: null, reason: null };
    const reason = parsed.reason, actual = reason ? null : parsed.action ? [parsed.action] : [];
    if (reason) errors[reason] = (errors[reason] ?? 0) + 1;
    const identity = { id: hash([episode.id, index]), runId: episode.id, sourceMessageIndex: index, boundary, domain, familyId: episode.family_id, sourceSplit: episode.split };
    const scores = scorePublicPrediction(prediction, actual, readNames, identity, reason).map(row => ({ ...row,
      sourceRole: message.role, prefixHasInvalidAction: tainted, executionAllowed: false }));
    emit({ ...identity, prefixHash: hash(prefix), frameHash: prediction.frameHash, stateHash: prediction.stateHash,
      actionFeaturesHash: prediction.actionFeaturesHash, candidatePoolHash: prediction.candidatePoolHash,
      candidateCount: prediction.candidates.length, candidates: prediction.candidates.map(entry => ({ candidate: entry.candidate, featureHash: entry.featureHash })),
      candidateScores: prediction.universes.find(row => row.ranker === "frozen-logistic")!.ranked.map(row => ({ candidateId: row.candidate.id,
        nextAction: row.nextAction, usefulWithin2: row.usefulWithin2, readiness: row.readiness })),
      actual, sourceRole: message.role, unavailableReason: reason, prefixHasInvalidAction: tainted, executionAllowed: false }, scores);
    boundary++;
    if (message.role === "assistant") prefix.push({ role: "assistant", content: message.content, calls: [] });
    else {
      const id = `source-call-${index}`; pending = { id, valid: reason === null && parsed.action !== null };
      if (pending.valid) prefix.push({ role: "assistant", content: null, calls: [{ id, ...parsed.action! }] });
      else { prefix.push({ role: "assistant", content: message.content, calls: [] }); tainted = true; }
    }
  }
  return { episodeId: episode.id, domain, familyId: episode.family_id, sourceSplit: episode.split, contentHash: episode.content_hash,
    firstRequestHash: hash(episode.messages.find(m => m.role === "user")?.content.toLowerCase().replace(/\s+/g, " ").trim() ?? ""),
    sourceMessageCount: episode.messages.length, checkpoints: boundary, errors, executionAllowed: false };
}
export function sourceClosure(root: string) {
  const pending = [resolve(root, "scripts/goalspec-controller-apigen-replay.ts")], visited = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!; if (visited.has(path)) continue; visited.add(path);
    if (!path.endsWith(".ts")) continue;
    for (const match of readFileSync(path, "utf8").matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*["'](\.[^"']+)["']/g)) {
      const target = resolve(dirname(path), match[1]), found = [target, `${target}.ts`, `${target}.json`, join(target, "index.ts")].find(existsSync);
      if (found && found.startsWith(resolve(root) + "/") || found && found.startsWith(resolve(root) + "\\")) pending.push(found);
    }
  }
  return [...visited, resolve(root, "package.json"), resolve(root, "package-lock.json")].sort().map(path => ({ path, sha256: sha(readFileSync(path)) }));
}
export async function runAPIGenReplay(input: { episodesPath: string; corpusManifestPath: string; controllerPath: string; controllerSha256: string }, output: string) {
  if (existsSync(output)) throw new Error("APIGen output must be new");
  const codeFiles = sourceClosure(resolve(".")), sourceFiles = await Promise.all(Object.values({ episodes: input.episodesPath,
    corpus: input.corpusManifestPath, controller: input.controllerPath }).map(async path => ({ path: resolve(path), sha256: await fileSha(path) })));
  const corpus = JSON.parse(readFileSync(input.corpusManifestPath, "utf8"));
  if (corpus.source !== "Salesforce/APIGen-MT-5k" || corpus.revision !== REVISION || corpus.counts?.admitted !== 5000 || corpus.license !== "cc-by-nc-4.0"
    || sourceFiles[2].sha256 !== input.controllerSha256) throw new Error("Pinned corpus or controller lineage mismatch");
  const controller = new LocalController(JSON.parse(readFileSync(input.controllerPath, "utf8")));
  if (controller.artifact.architecture !== "logistic") throw new Error("Frozen selected logistic required");
  mkdirSync(output, { recursive: true });
  const checkpointsPath = join(output, "checkpoints.jsonl"), scoresPath = join(output, "scores.jsonl"), episodesPath = join(output, "episodes.jsonl");
  for (const path of [checkpointsPath, scoresPath, episodesPath]) writeFileSync(path, "", { flag: "wx" });
  let episodes = 0, checkpoints = 0, scoreRows = 0; const ids = new Set<string>(), seenContent = new Map<string, number>(), requests = new Map<string, number>();
  const families = new Set<string>(), domainCounts: Record<string, number> = {}, errorEpisodes: Record<string, number> = {}, errorCounts: Record<string, number> = {};
  const startedAt = new Date().toISOString();
  for await (const line of createInterface({ input: createReadStream(input.episodesPath, "utf8"), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const episode = JSON.parse(line) as Episode;
    if (episode.source !== corpus.source || episode.revision !== REVISION || episode.license !== corpus.license || episode.native_executable !== false
      || episode.verification_tier !== "source_reported" || ids.has(episode.id)) throw new Error("Source episode lineage mismatch");
    ids.add(episode.id); const emitted: string[] = [], scored: string[] = [];
    const receipt = replayAPIGenEpisode(episode, controller, (checkpoint, rows) => { checkpoints++; scoreRows += rows.length; emitted.push(canonical(checkpoint)); scored.push(...rows.map(canonical)); });
    appendFileSync(checkpointsPath, emitted.join("\n") + "\n"); appendFileSync(scoresPath, scored.join("\n") + "\n"); appendFileSync(episodesPath, canonical(receipt) + "\n");
    episodes++; families.add(receipt.familyId); domainCounts[receipt.domain] = (domainCounts[receipt.domain] ?? 0) + 1;
    seenContent.set(receipt.contentHash, (seenContent.get(receipt.contentHash) ?? 0) + 1); requests.set(receipt.firstRequestHash, (requests.get(receipt.firstRequestHash) ?? 0) + 1);
    for (const [reason, count] of Object.entries(receipt.errors)) { errorCounts[reason] = (errorCounts[reason] ?? 0) + count; errorEpisodes[reason] = (errorEpisodes[reason] ?? 0) + 1; }
    if (episodes % 250 === 0) console.log(JSON.stringify({ episodes, checkpoints, scoreRows }));
  }
  if (episodes !== 5000) throw new Error("Entire pinned 5000-episode corpus required");
  for (const source of [...sourceFiles, ...codeFiles]) if (await fileSha(source.path) !== source.sha256) throw new Error("Input changed during APIGen replay");
  const duplicateCounts = (groups: Map<string, number>) => ({ groups: [...groups.values()].filter(n => n > 1).length,
    extraRecords: [...groups.values()].reduce((total, n) => total + Math.max(0, n - 1), 0) });
  const manifest = { version: APIGEN_VERSION, startedAt, closedAt: new Date().toISOString(), episodes, checkpoints, scoreRows, domains: domainCounts,
    families: families.size, errorCounts, errorEpisodes, duplicates: { exactContent: duplicateCounts(seenContent), normalizedFirstRequest: duplicateCounts(requests),
      retained: true, crossSourceNearDuplicateAudit: "not established; no certified heldout claim" }, sourceFiles, codeFiles,
    scoresSha256: await fileSha(scoresPath), checkpointsSha256: await fileSha(checkpointsPath), episodesSha256: await fileSha(episodesPath),
    frozenControllerHash: controller.artifact.contentHash, controllerFileSha256: input.controllerSha256, thresholds: controller.artifact.thresholds,
    corpus, completeDeclaredCorpus: true, sourceInputsExcludeFutureActions: true, providerCalls: 0, nativeToolExecutions: 0, independentReplayVerified: false,
    semantics: { population: "Every assistant or function_call source message, with all 5000 episodes retained. These are source-message checkpoints, not reconstructed native actor batches.",
      compatibility: "Static graph binding only. Temporary native binder version is an algorithm compatibility view; final candidates retain unverified APIGen scope, no authorization, and cannot execute.",
      gates: "READ and learned useful/readiness thresholds only; imitation labels from native training. No claim of actual native readiness, causal usefulness, latency savings, or authorization.",
      invalid: "Malformed/out-of-catalog actions remain unknown-label checkpoints and in coverage denominators. Their unverified results cannot seed later proposals. No aliases or target-dependent candidate insertion.",
      labels: "Strict JSON argument object and original supplied catalog schema without coercion. Native-read subset only; assistant text and valid writes/compute are NO_READ. Source-reported verification only.",
      license: "CC BY-NC 4.0, research only. Salesforce/APIGen-MT-5k source and pinned dataset card restrictions retained.",
      uncertainty: "Provisional action-family clustered intervals. Dataset families are not certified independent heldout task families. APIGen task success is not measured." } };
  writeFileSync(join(output, "manifest.json"), canonical(manifest) + "\n", { flag: "wx" }); return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8"));
  runAPIGenReplay(input, resolve(process.argv[3])).then(m => console.log(JSON.stringify({ episodes: m.episodes, checkpoints: m.checkpoints, errors: m.errorCounts })))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
