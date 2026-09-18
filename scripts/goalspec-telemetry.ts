import { createHash } from "node:crypto";
import { createReadStream, readFileSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame, ExperimentManifest, GoalSet, Outcome } from "../src/lib/goalspec/contracts/generated";
import type { BindingEvent } from "../src/lib/goalspec/patterns";
import { researchDatabase } from "../src/lib/goalspec/postgres-store";
import { PostgresPublicationStore } from "../src/lib/goalspec/postgres-publication";
import { PostgresTelemetryStore, type CandidateRecord, type FrameRecord, type RunTelemetry } from "../src/lib/goalspec/postgres-telemetry";
import { researchScope, type ResearchManifest } from "../services/goalspec-runtime/research-bootstrap";
import type { NativeMessage } from "../services/goalspec-runtime/actor";

type RecordObject = Record<string, unknown>;
type Logged = { type: string; payload: unknown; artifactUri: string; flattened: RecordObject };
const load = <T,>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const unknownGoals = (): GoalSet => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) });

export function requestedObjectiveFromArtifacts(firstFrame: Pick<ExecutionFrame, "requestedObjective"> | undefined, messages: readonly NativeMessage[]) {
  // Preserve existing frame-backed imports exactly for immutable retry identity.
  if (firstFrame) return { requestedObjective: firstFrame.requestedObjective };
  const requests = messages.flatMap((message, index) => message.role === "user" && message.content?.trim()
    ? [{ index, content: message.content }] : []);
  return {
    requestedObjective: requests.length ? requests.map(request => request.content).join("\n")
      : "[Unobserved: no public user request was recorded before execution ended.]",
    requestedObjectiveObservation: { status: requests.length ? "native_user_messages" : "unobserved_no_public_request",
      actorBoundaryObserved: false, nativeMessageIndexes: requests.map(request => request.index) },
  };
}

export function reconstructFrame(messages: NativeMessage[], runId: string, boundary: number, snapshotId: string, scope: ExecutionFrame["scope"], policy: string): ExecutionFrame {
  const sources: ExecutionFrame["sources"] = {}, events: BindingEvent[] = [], calls = new Map<string, string>(), signatures: string[] = [], requirements: string[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user") { sources[`requirement:${index}`] = message.content ?? ""; requirements.push(message.content ?? ""); }
    for (const call of message.tool_calls ?? []) { calls.set(call.id, call.name); events.push({ seq: events.length, kind: "tool_request", call_id: call.id, tool: call.name, arguments: call.arguments }); }
    if (message.role === "tool") {
      const tool = calls.get(message.id ?? ""); if (!tool) throw new Error("Cannot reconstruct unmatched native result");
      let result: unknown = message.content ?? ""; try { result = JSON.parse(message.content ?? "null"); } catch { /* Preserve native textual observations. */ }
      const status = (message as NativeMessage & { error?: boolean }).error ? "error" : "success";
      sources[`observation:${index}`] = JSON.parse(canonical(result));
      events.push({ seq: events.length, kind: "tool_result", call_id: message.id, tool, status, result }); signatures.push(`${tool}:${status}`);
    }
  });
  sources._binding_events = JSON.parse(canonical(events)); sources._signatures = signatures;
  return { schemaVersion: 1, runId, boundary, scope, snapshotId, policy, requestedObjective: requirements.join("\n"), sources, goals: unknownGoals() };
}

export async function partitionEvents(directory: string, stage: string, runIds: Set<string>, expectedManifestHash: string) {
  const counts = new Map<string, number>();
  for (const file of readdirSync(directory).filter(name => /^events-.*\.jsonl$/.test(name)).sort()) {
    const path = join(directory, file), shared: Logged[] = [], touched = new Set<string>(), declared = new Set<string>();
    let previousHash = "0".repeat(64), sequence = 0, lastType = "";
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
      if (!line) continue;
      const entry = JSON.parse(line);
      if (entry.body.sequence !== sequence || entry.body.previousHash !== previousHash || hash(entry.body) !== entry.hash) throw new Error(`Invalid immutable event chain: ${file}`);
      const event = entry.body.event as RecordObject;
      const flattened: RecordObject = event.event && typeof event.event === "object" ? { ...(event.event as RecordObject), runId: event.runId } : event;
      if (sequence === 0 && flattened.type === "research_manifest" && Array.isArray(flattened.runs)) {
        for (const run of flattened.runs) if (run && typeof run === "object" && runIds.has(String((run as RecordObject).id))) declared.add(String((run as RecordObject).id));
        if (!declared.size) break;
        if (flattened.manifestHash !== expectedManifestHash) throw new Error("Native event stream belongs to a different phase manifest");
      }
      const row: Logged = { type: typeof flattened.type === "string" ? flattened.type : "untyped", payload: entry, artifactUri: `${path}#L${sequence + 1}`, flattened };
      const runId = String(flattened.runId ?? "");
      if (runIds.has(runId)) { appendFileSync(join(stage, `${runId}.jsonl`), JSON.stringify(row) + "\n"); counts.set(runId, (counts.get(runId) ?? 0) + 1); touched.add(runId); }
      else if (["research_manifest", "service_started", "service_closed"].includes(row.type)) shared.push(row);
      previousHash = entry.hash; sequence++; lastType = row.type;
    }
    if ((touched.size || declared.size) && lastType !== "service_closed") throw new Error("Cannot freeze telemetry from an active or undrained service");
    // Retain only original shared rows for declared runs that never emitted an event.
    // The native execution-error artifact is checked before such a run is imported.
    for (const runId of declared) if (!counts.has(runId)) counts.set(runId, 0);
    for (const runId of new Set([...touched, ...declared])) for (const row of shared) appendFileSync(join(stage, `${runId}.jsonl`), JSON.stringify(row) + "\n");
  }
  return counts;
}

export function unobservedFailureProvenance(runId: string, native: {
  record: { success: boolean; termination?: string; nativeTermination?: string; nativeStopObserved?: boolean };
  verdict: { success: boolean };
  simulation: { failure?: string; messages: NativeMessage[] };
}, rows: Logged[]) {
  const [declaration, started, closed] = rows;
  const message = native.simulation.messages[0];
  const declaredRuns = declaration?.flattened.runs;
  const startedRuns = started?.flattened.runs;
  if (rows.length !== 3 || declaration.type !== "research_manifest" || started.type !== "service_started" || closed.type !== "service_closed"
      || !Array.isArray(declaredRuns) || !declaredRuns.some(run => run && typeof run === "object" && (run as RecordObject).id === runId)
      || !Array.isArray(startedRuns) || !startedRuns.includes(runId)
      || rows.some(row => row.artifactUri.split("#L")[0] !== declaration.artifactUri.split("#L")[0])
      || native.record.success !== false || native.verdict.success !== false || native.record.termination !== "execution_error"
      || native.record.nativeTermination !== "execution_error" || native.record.nativeStopObserved !== false
      || native.simulation.failure !== "execution_error" || native.simulation.messages.length !== 1
      || message?.role !== "assistant" || message.content !== "Hi! How can I help you today?"
      || message.tool_calls?.length || message.raw_data?.goalspecContinuation) {
    throw new Error("Zero-event native run lacks closed declared ownership and an unobserved execution-error artifact");
  }
  return { status: "declared_unobserved_execution_failure", perRunEvents: 0, retainedSharedEvents: 3,
    declaration: declaration.artifactUri, serviceStarted: started.artifactUri, serviceClosed: closed.artifactUri };
}

async function main() {
  const [operation, arg, eventArgument, outputArgument] = process.argv.slice(2);
  if (!process.env.GOALSPEC_DATABASE_URL || !arg) throw new Error("Set GOALSPEC_DATABASE_URL. Usage: goalspec-telemetry.ts import PHASE_DIRECTORY EVENT_DIRECTORY OUTPUT_DIRECTORY; export RUN_ID NEW_OUTPUT.json");
  const db = researchDatabase(process.env.GOALSPEC_DATABASE_URL, process.env.DATABASE_URL), store = new PostgresTelemetryStore(db);
  try {
    if (operation === "export") {
      if (!eventArgument) throw new Error("Export output path required");
      writeFileSync(resolve(eventArgument), JSON.stringify(await store.exportRun(arg), null, 2) + "\n", { flag: "wx" }); return;
    }
    if (operation !== "import" || !eventArgument || !outputArgument) throw new Error("Invalid telemetry import arguments");
    const phaseDirectory = resolve(arg), outputDirectory = resolve(outputArgument);
    const summaryPath = join(phaseDirectory, "summary.json"), manifestPath = join(phaseDirectory, "service-manifest.json");
    if (!existsSync(summaryPath)) throw new Error("Only completed phase artifacts can be imported");
    const manifest = load<ResearchManifest>(manifestPath), summary = load<{ phase: string }>(summaryPath);
    const contexts = load<Record<string, { policy: string }>>(join(phaseDirectory, "public-contexts.json"));
    mkdirSync(outputDirectory); const stage = join(outputDirectory, "verified-event-partitions"); mkdirSync(stage);
    const runIds = new Set(manifest.runs.map(run => run.runId));
    if ([...runIds].some(id => !/^[A-Za-z0-9_-]+$/.test(id))) throw new Error("Unsafe native run identity");
    const counts = await partitionEvents(resolve(eventArgument), stage, runIds, hash(manifest));
    if (!manifest.recordsPath) {
      await new PostgresPublicationStore(db).publish({ id: manifest.snapshotId, records: [], episodeIds: [], heldoutFamilies: [], transitions: [], errors: [],
        compilerVersion: "empty-training-library-v1", embeddingModelVersion: "text-embedding-3-small", calibration: { kind: "no_training_library_available" } });
    }
    const results = [];
    for (const run of manifest.runs) {
      if (!counts.has(run.runId)) throw new Error(`Native run has no verified provider event stream: ${run.runId}`);
      const nativePath = join(phaseDirectory, `${run.runId}.json`);
      const native = load<{ record: { snapshotId: string; seed: number; success: boolean; budget_terminated: boolean; verifierHash: string; termination?: string; nativeTermination?: string; nativeStopObserved?: boolean }; simulation: { messages: NativeMessage[]; failure?: string }; verdict: { success: boolean; constraintViolations: number; stateMatch: boolean; communicationMatch: boolean }; independentCheck: RecordObject }>(nativePath);
      if (native.record.snapshotId !== manifest.snapshotId || native.record.success !== native.verdict.success || native.record.budget_terminated && native.record.success) throw new Error("Independent native verdict identity mismatch");
      const rows = readFileSync(join(stage, `${run.runId}.jsonl`), "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line) as Logged);
      const eventCoverage = counts.get(run.runId) === 0 ? unobservedFailureProvenance(run.runId, native, rows) : undefined;
      const frames = new Map<number, FrameRecord>();
      for (const row of rows) if (["execution_frame", "decision_context"].includes(row.type) && row.flattened.frame) {
        const frame = row.flattened.frame as ExecutionFrame;
        const prior = frames.get(frame.boundary);
        frames.set(frame.boundary, { frame, provenance: "runtime", ...(typeof row.flattened.inputHash === "string" ? { inputHash: row.flattened.inputHash } : {}), goals: frame.goals,
          evidence: row.type === "decision_context" ? (row.flattened.evidence ?? []) as FrameRecord["evidence"] : prior?.evidence ?? [] });
      }
      const boundaries = rows.filter(row => row.type === "actor_boundary");
      const messages = native.simulation.messages;
      const actorIndexes = messages.flatMap((message, index) => message.role === "assistant" && message.raw_data?.goalspecContinuation ? [index] : []);
      const possibleEnds = [...actorIndexes, messages.length];
      for (const [boundary, logged] of boundaries.entries()) if (!frames.has(boundary)) {
        let found: ExecutionFrame | undefined;
        for (const end of possibleEnds) for (const start of [0, 1]) {
          if (start > 0 && messages[0]?.role !== "assistant") continue;
          try {
            const frame = reconstructFrame(messages.slice(start, end), run.runId, boundary, manifest.snapshotId, researchScope(run), contexts[run.runId].policy);
            if (hash(frame) === logged.flattened.frameHash) found = frame;
          } catch { /* Another prefix can correspond to this recorded boundary. */ }
        }
        if (!found) throw new Error(`Saved native prefix does not match the originally logged frame hash: ${run.runId}:${boundary}`);
        frames.set(boundary, { frame: found, provenance: "reconstructed_native_prefix", inputHash: String(logged.flattened.inputHash), evidence: [] });
      }
      const frameRows = [...frames.values()].sort((a, b) => a.frame.boundary - b.frame.boundary);
      const candidates: CandidateRecord[] = rows.filter(row => row.type === "candidate_prediction").map(row => {
        const data = row.flattened, candidate = data.candidate as CandidateRecord["candidate"], boundary = Number(data.boundary);
        const authoritative = messages[actorIndexes[boundary]]?.tool_calls ?? [];
        const match = authoritative.some(call => call.name === candidate.invocation.tool && hash(call.arguments) === hash(candidate.invocation.arguments));
        const toolMatch = authoritative.some(call => call.name === candidate.invocation.tool);
        return { candidate, boundary, visibleInputHash: String(data.visibleInputHash), admission: data.admission === true || data.admission === "admitted" ? "admitted" : "rejected", ...(data.reason ? { reason: String(data.reason) } : {}),
          ...(!match ? { observedTool: authoritative.map(call => call.name).join("|") || "none", failureCause: !authoritative.length ? "actor_no_tool_call" : toolMatch ? "argument_mismatch" : "tool_mismatch", supportingEvents: [row.artifactUri] } : {}) };
      });
      const experiment: ExperimentManifest = { schemaVersion: 1, id: run.runId, snapshotId: manifest.snapshotId, datasetHashes: [sha(manifestPath), sha(summaryPath)],
        sourceRevision: researchScope(run).environmentVersion, actorModel: "gpt-5.4-2026-03-05", predictorModel: "gpt-4.1-mini-2025-04-14", embeddingModel: "text-embedding-3-small",
        embeddingDimensions: 1536, actorReasoning: "medium", actorOutputCap: 4096, predictorOutputCap: 1024, actorInputBudget: 32768, predictorInputBudget: 8192,
        arms: ["base", "neutral_memory_prefetch", "goalspec"], seeds: [native.record.seed], frozen: true, totalCeilingUsd: 500 };
      const inferredGoals = frameRows.at(-1)?.goals ?? frameRows.at(-1)?.frame.goals ?? unknownGoals();
      const objective = requestedObjectiveFromArtifacts(frameRows[0]?.frame, messages);
      const outcome: Outcome = { schemaVersion: 1, runId: run.runId, requestedObjective: objective.requestedObjective, inferredGoals,
        achievedOutcomes: [...(native.verdict.stateMatch ? ["Independent expected-state check passed"] : []), ...(native.verdict.communicationMatch ? ["Independent communication check passed"] : [])],
        independentVerdict: { verifierId: String(native.independentCheck.evaluatorVersion), success: native.verdict.success,
          constraintsSatisfied: native.verdict.constraintViolations === 0, evidenceRefs: [nativePath] } };
      if (run.arm !== "base" && run.arm !== "neutral" && run.arm !== "goalspec") throw new Error("This legacy importer only accepts the original three-arm schema; use the versioned experiment archive");
      const telemetry: RunTelemetry = { runId: run.runId, experiment, arm: run.arm, nativeArtifactHash: sha(nativePath), nativeArtifactUri: nativePath, phase: summary.phase,
        events: rows.map(({ type, payload, artifactUri }) => ({ type, payload, artifactUri })), frames: frameRows, candidates, outcome,
        independentEvidence: { verifierHash: native.record.verifierHash, check: native.independentCheck, verdict: native.verdict,
          ...(eventCoverage ? { eventCoverage } : {}),
          ...(objective.requestedObjectiveObservation ? { requestedObjectiveObservation: objective.requestedObjectiveObservation } : {}) } };
      results.push(await store.importRun(telemetry));
      writeFileSync(join(outputDirectory, `${run.runId}.json`), JSON.stringify(await store.exportRun(run.runId)) + "\n", { flag: "wx" });
    }
    const report = { imported: results.length, phase: summary.phase, runs: results, manifestHash: sha(manifestPath), summaryHash: sha(summaryPath),
      importerHash: sha(resolve("scripts/goalspec-telemetry.ts")) };
    writeFileSync(join(outputDirectory, "import.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ imported: results.length, frames: results.reduce((sum, row) => sum + row.frames, 0), candidates: results.reduce((sum, row) => sum + row.candidates, 0) }));
  } finally { await db.$disconnect(); }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/goalspec-telemetry.ts")) main().catch(error => { console.error(error instanceof Error ? error.message : "Telemetry import failed"); process.exitCode = 1; });
