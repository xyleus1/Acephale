import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash, type Json } from "../src/lib/goalspec/canonical";
import { buildMemoryArtifact, type MemoryAction, type MemoryEpisode, type MemoryFile, type MemoryMessage,
  type MemoryMiss, type MemoryRun, type MemoryScope, type MemoryStage, type ArgumentProvenance } from "../src/lib/goalspec/experience-memory";

const ENVIRONMENT = "2174a603f6d014ef94473ffa95957f6ce27100db";
const SOURCES = [
  { stage: "v1-training", directory: "local-training-v2-verdicts-20260915", count: 48, eventFile: null },
  { stage: "v2-development-1", directory: "local-v2-development-1-20260915", count: 24,
    eventFile: "events-8d62260c-e4ab-46fc-976e-fc69d1182f4a.jsonl" },
  { stage: "v2-development-2", directory: "local-v2-development-2-20260915", count: 24,
    eventFile: "events-254eb9cf-cecf-45ca-8ba1-d3b5394cdd80.jsonl" },
] as const;

// Native artifacts are read only through explicit public fields. raw_data,
// reward internals, hidden task instructions and finalDatabase never enter memory.
type NativeMessage = { role: string; content?: string | null; id?: string;
  tool_calls?: { id: string; name: string; arguments: Record<string, Json> }[] | null };
type NativeArtifact = { record: { runId: string; success: boolean }; simulation: { messages: NativeMessage[] };
  verdict: { success: boolean; constraintViolations: number; verifierVersion: string; stateMatch: boolean; communicationMatch: boolean } };
type Outcome = { runId: string; familyId: string; domain: string; success: boolean; termination: string;
  constraintViolations: number; studyStage?: string; verifierHash: string; fixtureHash: string };
type ServiceManifest = { snapshotId: string; runs: { runId: string; domain: string; tools: unknown[] }[] };
type EventEntry = { body: { sequence: number; previousHash: string; event: Record<string, unknown> }; hash: string };

function publicMessage(message: NativeMessage, index: number): MemoryMessage {
  if (!["user", "assistant", "tool"].includes(message.role)) throw new Error("Unexpected native public message role");
  let observation: Json = null;
  if (message.role === "tool") {
    try { observation = JSON.parse(message.content ?? "null"); } catch { observation = message.content ?? null; }
  }
  return { index, role: message.role as MemoryMessage["role"], content: message.content ?? null,
    calls: (message.tool_calls ?? []).map(call => ({ id: call.id, tool: call.name, arguments: call.arguments })),
    callId: message.role === "tool" ? message.id ?? null : null, observation };
}

function leafValues(value: Json, initial: (string | number)[] = []) {
  const result: { value: Json; path: (string | number)[] }[] = [];
  let remaining = 2048;
  function visit(node: Json, path: (string | number)[]) {
    if (--remaining < 0 || path.length > 12) return;
    if (node !== null && typeof node === "object") Object.entries(node).forEach(([key, entry]) => visit(entry, [...path, Array.isArray(node) ? Number(key) : key]));
    else result.push({ value: node, path });
  }
  visit(value, initial); return result;
}
function provenance(actions: MemoryAction[], prefix: MemoryMessage[]): ArgumentProvenance[] {
  const sources = prefix.flatMap(message => [
    ...leafValues(message.observation, ["observation"]),
    ...leafValues(message.calls as unknown as Json, ["calls"]),
    ...(message.role === "user" && message.content !== null ? [{ value: message.content, path: ["content"] }] : []),
  ].map(source => ({ ...source, messageIndex: message.index })));
  return actions.flatMap(action => leafValues(action.arguments).map(argument => ({
    actionId: action.id, argumentPath: argument.path,
    sources: sources.flatMap(source => {
      const exact = canonical(source.value) === canonical(argument.value);
      const substring = typeof argument.value === "string" && argument.value.length > 0 && typeof source.value === "string" && source.value.includes(argument.value);
      return exact || substring ? [{ messageIndex: source.messageIndex, path: source.path,
        method: exact ? "exact" as const : "substring" as const }] : [];
    }).slice(-8),
  })));
}

export function extractMemoryEpisodes(run: MemoryRun, messages: MemoryMessage[]): MemoryEpisode[] {
  const result: MemoryEpisode[] = [];
  let boundary = 0;
  for (let index = 1; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const prefix = messages.slice(0, index), requirements = prefix.filter(row => row.role === "user").map(row => row.content ?? "");
    if (!requirements.length) continue;
    const previous = prefix.flatMap(row => row.calls).at(-1)?.tool ?? "__start__";
    const observations: MemoryMessage[] = [];
    for (let next = index + 1; next < messages.length && messages[next].role === "tool"; next++) observations.push(messages[next]);
    const episode: MemoryEpisode = { id: hash({ run: run.id, boundary }), runId: run.id, boundary, scope: run.scope,
      prefixHash: hash(prefix), prefix, requirements, previousTool: previous, nextActions: message.calls,
      nextMessage: message.content, resultingObservations: observations, argumentSources: provenance(message.calls, prefix),
      lesson: run.success && run.outcomeVerified
        ? "This continuation occurred in a verified successful task. Rebind every argument from current evidence and recheck current policy."
        : "This continuation occurred in a failed task. It is a contrastive example, not an approved workflow or a diagnosis of the failure." };
    result.push(episode); boundary++;
  }
  return result;
}

export function verifiedEventRows(text: string): EventEntry[] {
  let previousHash = "0".repeat(64), sequence = 0;
  const rows: EventEntry[] = [];
  for (const line of text.trim().split(/\r?\n/)) {
    const row = JSON.parse(line) as EventEntry;
    if (row.body.sequence !== sequence || row.body.previousHash !== previousHash || hash(row.body) !== row.hash) throw new Error("Invalid memory event-chain provenance");
    previousHash = row.hash; sequence++; rows.push(row);
  }
  if (rows.at(-1)?.body.event.type !== "service_closed") throw new Error("Memory input service was not closed");
  return rows;
}

function predictionMisses(rows: EventEntry[], source: MemoryFile, episodes: MemoryEpisode[], allowedRuns: Set<string>) {
  const episodeMap = new Map(episodes.map(episode => [canonical([episode.runId, episode.boundary]), episode]));
  const declared = rows.find(row => row.body.event.type === "research_manifest")?.body.event.runs as { id: string }[] | undefined;
  if (!declared || canonical(declared.map(run => run.id).sort()) !== canonical([...allowedRuns].sort())) throw new Error("Memory event manifest differs from declared cohort");
  const boundaries = new Map<string, number>(), identifiers = new Map<string, string>(), responses = new Map<string, number>();
  const checkedFrames = new Set<string>();
  for (const row of rows) {
    const runId = row.body.event.runId, event = row.body.event.event as Record<string, unknown> | undefined;
    if (typeof runId !== "string" || !event || !allowedRuns.has(runId)) continue;
    if (event.type === "actor_boundary") {
      const boundary = boundaries.get(runId) ?? 0; boundaries.set(runId, boundary + 1);
      identifiers.set(canonical([runId, event.boundaryId]), canonical([runId, boundary]));
    } else if (event.type === "execution_frame") {
      const frame = event.frame as { boundary: number; scope: MemoryScope; sources: Record<string, Json> };
      const decision = canonical([runId, frame.boundary]), episode = episodeMap.get(decision);
      // A failed decision may have a public frame but no returned actor action.
      if (!episode) continue;
      const requirements = Object.entries(frame.sources).filter(([key]) => key.startsWith("requirement:"))
        .sort(([a], [b]) => Number(a.slice(12)) - Number(b.slice(12))).map(([, value]) => value);
      const events = frame.sources._binding_events as { kind: string; tool?: string; arguments?: Json }[];
      const calls = events.filter(value => value.kind === "tool_request").map(value => ({ tool: value.tool, arguments: value.arguments }));
      const prefixCalls = episode.prefix.flatMap(message => message.calls).map(({ tool, arguments: args }) => ({ tool, arguments: args }));
      if (canonical(frame.scope) !== canonical(episode.scope) || canonical(requirements) !== canonical(episode.requirements)
        || canonical(calls) !== canonical(prefixCalls)) throw new Error("Memory event boundary differs from native visible prefix");
      checkedFrames.add(decision);
    } else if (event.type === "actor_response") {
      const decision = identifiers.get(canonical([runId, event.boundaryId]));
      if (!decision) throw new Error("Memory actor response lacks matching public boundary");
      responses.set(decision, row.body.sequence);
    }
  }
  const result: MemoryMiss[] = [];
  let unpaired = 0;
  for (const row of rows) {
    const runId = row.body.event.runId, event = row.body.event.event as Record<string, unknown> | undefined;
    if (typeof runId !== "string" || !allowedRuns.has(runId) || event?.type !== "candidate_prediction") continue;
    const decision = canonical([runId, event.boundary]), episode = episodeMap.get(decision);
    if (!episode) { unpaired++; continue; }
    if (!checkedFrames.has(decision)) throw new Error("Memory prediction has no verified public decision frame");
    const candidate = event.candidate as { invocation: { scope: MemoryScope; tool: string; arguments: Record<string, Json> } };
    if (canonical(candidate.invocation.scope) !== canonical(episode.scope)) throw new Error("Memory prediction scope mismatch");
    const predicted = { tool: candidate.invocation.tool, arguments: candidate.invocation.arguments };
    const actual = episode.nextActions.map(({ tool, arguments: args }) => ({ tool, arguments: args }));
    result.push({ id: hash({ source, sequence: row.body.sequence }), episodeId: episode.id, predicted, actual,
      fullMatch: actual.some(action => canonical(action) === canonical(predicted)), toolMatch: actual.some(action => action.tool === predicted.tool),
      admitted: event.admission === true, beforeActorResponse: responses.has(decision) && row.body.sequence < responses.get(decision)!,
      eventSequence: row.body.sequence, eventHash: row.hash, source });
  }
  return { misses: result, unpaired };
}

export function buildLocalMemory(root: string) {
  const files = new Map<string, MemoryFile>();
  function read(path: string) {
    const full = resolve(root, path), bytes = readFileSync(full), source = { path: relative(root, full).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(bytes).digest("hex") };
    files.set(source.path, source); return { source, value: JSON.parse(bytes.toString("utf8")) };
  }
  const runs: MemoryRun[] = [], episodes: MemoryEpisode[] = [], misses: MemoryMiss[] = [];
  const diagnostics: { stage: MemoryStage; runs: number; failedRuns: number; zeroEpisodeRuns: number; episodes: number; predictionRecords: number; unpairedPredictions: number }[] = [];
  for (const input of SOURCES) {
    const directory = join("research/goalspec/runs", input.directory);
    const designRead = read(join(directory, "design.json")), design = designRead.value;
    const expectedPhase = input.stage === "v1-training" ? "train" : "development";
    if (design.phase !== expectedPhase || input.stage !== "v1-training" && design.studyStage !== input.stage.replace("v2-", "")) throw new Error("Disallowed memory phase");
    const manifestRead = read(join(directory, "service-manifest.json")), manifest = manifestRead.value as ServiceManifest;
    const publicRead = read(join(directory, "public-contexts.json"));
    const outcomePath = join(directory, "outcomes.jsonl"), outcomeBytes = readFileSync(resolve(root, outcomePath));
    const outcomeFile = { path: outcomePath.replaceAll("\\", "/"), sha256: createHash("sha256").update(outcomeBytes).digest("hex") };
    files.set(outcomeFile.path, outcomeFile);
    const outcomes = outcomeBytes.toString("utf8").trim().split(/\r?\n/).map(line => JSON.parse(line) as Outcome);
    if (outcomes.length !== input.count || new Set(outcomes.map(outcome => outcome.runId)).size !== input.count
      || canonical(outcomes.map(outcome => outcome.runId).sort()) !== canonical(manifest.runs.map(run => run.runId).sort())) throw new Error("Memory source cohort is incomplete");
    const stageRuns: MemoryRun[] = [], stageEpisodes: MemoryEpisode[] = [];
    for (const outcome of outcomes) {
      if (!/^[a-zA-Z0-9_-]+$/.test(outcome.runId)) throw new Error("Unsafe memory artifact name");
      const traceRead = read(join(directory, `${outcome.runId}.json`)), artifact = traceRead.value as NativeArtifact;
      const declared = manifest.runs.find(run => run.runId === outcome.runId)!;
      const context = publicRead.value[outcome.runId];
      if (!context || context.capturedBeforeExecution !== true || hash(context.tools) !== hash(declared.tools)
        || artifact.record.runId !== outcome.runId || artifact.record.success !== outcome.success
        || artifact.verdict.success !== outcome.success || artifact.verdict.constraintViolations !== outcome.constraintViolations
        || !artifact.verdict.verifierVersion) throw new Error("Memory outcome/public provenance mismatch");
      const messages = artifact.simulation.messages.map(publicMessage);
      const scope = { tenantId: `custom-tau-${declared.domain}`, principalId: "native-actor", authorizationVersion: "native-v1",
        environmentVersion: ENVIRONMENT, toolSchemaHash: hash(declared.tools) };
      const run: MemoryRun = { id: outcome.runId, familyId: outcome.familyId, stage: input.stage, split: expectedPhase === "train" ? "train" : "development",
        scope, policyHash: hash(context.policy), sourceFiles: [traceRead.source, outcomeFile, publicRead.source, manifestRead.source, designRead.source],
        success: outcome.success, outcomeVerified: true, constraintViolations: outcome.constraintViolations,
        termination: outcome.termination, publicMessageCount: messages.length, episodeCount: 0 };
      const extracted = extractMemoryEpisodes(run, messages); run.episodeCount = extracted.length;
      stageRuns.push(run); stageEpisodes.push(...extracted);
    }
    let predictions: MemoryMiss[] = [], unpaired = 0;
    if (input.eventFile) {
      const eventPath = join("research/goalspec/runs/local-evaluation-20260914", input.eventFile), bytes = readFileSync(resolve(root, eventPath));
      const source = { path: eventPath.replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex") };
      files.set(source.path, source);
      const extracted = predictionMisses(verifiedEventRows(bytes.toString("utf8")), source, stageEpisodes, new Set(stageRuns.map(run => run.id)));
      predictions = extracted.misses; unpaired = extracted.unpaired;
    }
    runs.push(...stageRuns); episodes.push(...stageEpisodes); misses.push(...predictions);
    diagnostics.push({ stage: input.stage, runs: stageRuns.length, failedRuns: stageRuns.filter(run => !run.success).length,
      zeroEpisodeRuns: stageRuns.filter(run => !run.episodeCount).length, episodes: stageEpisodes.length, predictionRecords: predictions.length, unpairedPredictions: unpaired });
  }
  const artifact = buildMemoryArtifact({ repositorySnapshotId: "native-training-v1-20260915",
    sourceFiles: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)), runs, episodes, misses });
  return { artifact, summary: { sourcePolicy: artifact.sourcePolicy, contentHash: artifact.contentHash, runs: runs.length,
    episodes: episodes.length, predictions: misses.length, exactMatches: misses.filter(miss => miss.fullMatch).length,
    causalMismatches: misses.filter(miss => !miss.fullMatch && miss.beforeActorResponse).length,
    latePredictions: misses.filter(miss => !miss.beforeActorResponse).length, transitions: artifact.transitions.length,
    confusions: artifact.confusions.length, surfacedConfusions: artifact.confusions.filter(row => row.count >= 3).length,
    hiddenEvaluatorContentIncluded: false, providerCalls: 0, stages: diagnostics } };
}

function main() {
  const root = resolve(process.cwd()), [destination = "research/goalspec/runs/local-memory-v3-20260915"] = process.argv.slice(2);
  const target = resolve(root, destination), runsRoot = resolve(root, "research/goalspec/runs");
  if (resolve(target, "..") !== runsRoot) throw new Error("Memory output must be a new direct child of research/goalspec/runs");
  const result = buildLocalMemory(root);
  mkdirSync(target, { recursive: false });
  writeFileSync(join(target, "artifact.json"), JSON.stringify(result.artifact) + "\n", { flag: "wx" });
  writeFileSync(join(target, "summary.json"), JSON.stringify(result.summary, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(result.summary, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
