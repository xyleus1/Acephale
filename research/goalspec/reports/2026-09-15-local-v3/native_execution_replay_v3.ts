import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, copy, canonical } from "../../../../src/lib/goalspec/canonical";
import { resolveSource } from "../../../../src/lib/goalspec/compiler";
import { validateContract } from "../../../../src/lib/goalspec/contracts/validate";
import type { Candidate, Scope, Invocation, ExecutionFrame } from "../../../../src/lib/goalspec/contracts/generated";
import { SpeculationScheduler } from "../../../../src/lib/goalspec/scheduler";
import { NativeReadPolicy } from "../../../../services/goalspec-runtime/native-read-policy";
import { NativeGateway, NativeReadExecutor } from "../../../../services/goalspec-runtime/gateway-client";
import { ResearchService } from "../../../../services/goalspec-runtime/service";
import { ImmutableEventLog } from "../../../../services/goalspec-runtime/artifacts";
import type { NativeMessage } from "../../../../services/goalspec-runtime/actor";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FINAL_TREE = "39d7c7aaef4241d96fd9c274355862632eb45d6adec9882394fc7f45d6b8e022";
type Source = { path: string; sha256: string; bytes: number };
type ReplayRun = { runId: string; domain: "retail" | "airline"; scope: Scope; reads: string[]; turns: NativeMessage[] };
type Input = { runs: ReplayRun[]; sourceLogs: string[] };
type Method = { schemaVersion: string; replayInput: Source; sourceInputs: Source[]; sourceLogs: string[];
  serviceManifest: Source;
  coverage: { runId: string; replayed: boolean }[];
  finalSource: { sourceTreeHash: string; manifest: Source; checkedExecutionFiles: Source[]; checkedFrozenInputs: Source[] } };
type CandidateEvent = { type: "candidate_prediction"; boundary: number; candidate: Candidate;
  admission: boolean; reason?: string; visibleInputHash: string };

function verifyFile(source: Source) {
  const path = resolve(ROOT, source.path), rel = relative(ROOT, path);
  if (!rel || rel.startsWith("..") || source.path.includes("\\") || source.path.includes(":")) throw new Error("Unsafe replay input path");
  const bytes = readFileSync(path);
  if (bytes.length !== source.bytes || createHash("sha256").update(bytes).digest("hex") !== source.sha256) throw new Error("Replay input hash changed");
}

export function loadAdmittedPredictions(config: Input, method: Method) {
  if (method.schemaVersion !== "native-execution-replay-v3-admitted-1" || method.finalSource.sourceTreeHash !== FINAL_TREE
    || hash(config.sourceLogs) !== hash(method.sourceLogs)
    || hash(config.runs.map(r => r.runId).sort()) !== hash(method.coverage.filter(r => r.replayed).map(r => r.runId).sort())) {
    throw new Error("V3 replay input manifest mismatch");
  }
  [method.replayInput, method.finalSource.manifest, ...method.sourceInputs,
    ...method.finalSource.checkedExecutionFiles, ...method.finalSource.checkedFrozenInputs].forEach(verifyFile);
  verifyFile(method.serviceManifest);
  if (!method.sourceInputs.some(source => hash(source) === hash(method.serviceManifest))) throw new Error("Unmanifested service ownership file");
  const serviceManifest = JSON.parse(readFileSync(resolve(ROOT, method.serviceManifest.path), "utf8"));
  const declaredRunIds = method.coverage.map(run => run.runId).sort();
  if (hash(serviceManifest.runs.map((run: { runId: string }) => run.runId).sort()) !== hash(declaredRunIds)) {
    throw new Error("Source service does not own the declared cohort");
  }
  const finalManifest = JSON.parse(readFileSync(resolve(ROOT, method.finalSource.manifest.path), "utf8"));
  if (hash(finalManifest.sources) !== FINAL_TREE || finalManifest.sourceTreeHash !== FINAL_TREE) throw new Error("Frozen source map mismatch");
  const wanted = new Map(config.runs.map(r => [r.runId, r]));
  const declared = new Set(method.coverage.map(r => r.runId));
  const frames = new Map<string, { frame: ExecutionFrame; path: string; sequence: number; eventId: string }>();
  const contexts = new Map<string, { frame: ExecutionFrame; path: string; sequence: number; eventId: string }[]>();
  const candidateEvents: { runId: string; event: CandidateEvent; path: string; sequence: number; eventId: string }[] = [];
  const logReceipts: { path: string; records: number; finalHash: string }[] = [];
  const eventIds = new Set<string>(), paths = new Set<string>();
  for (const path of config.sourceLogs) {
    const resolved = resolve(path);
    if (paths.has(resolved) || !method.sourceInputs.some(s => resolve(ROOT, s.path) === resolved)) throw new Error("Duplicate or unmanifested source log");
    paths.add(resolved);
    let previous = "0".repeat(64), sequence = 0, finalEventType: unknown;
    const source = readFileSync(resolved, "utf8");
    if (!source.endsWith("\n")) throw new Error("Incomplete immutable source log");
    for (const line of source.split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      if (canonical(row) !== line) throw new Error("Noncanonical original event bytes");
      if (row.body.previousHash !== previous || row.body.sequence !== sequence++ || hash(row.body) !== row.hash) throw new Error("Source event chain changed");
      previous = row.hash;
      const wrapper = row.body.event, event = wrapper.event ?? wrapper;
      if (row.body.sequence === 0 && (event.type !== "research_manifest" || event.manifestHash !== hash(serviceManifest)
        || hash(event.runs.map((run: { id: string }) => run.id).sort()) !== hash(declaredRunIds))) {
        throw new Error("Source event genesis does not match its saved service manifest");
      }
      finalEventType = event.type;
      const runId = wrapper.runId ?? event.runId;
      if (!["execution_frame", "decision_context", "candidate_prediction"].includes(event.type)) continue;
      if (typeof runId !== "string" || !declared.has(runId)) throw new Error("Source event belongs to an undeclared run");
      const eventId = `${relative(ROOT, resolved).replaceAll("\\", "/")}:${row.body.sequence}:${row.hash}`;
      if (eventIds.has(eventId)) throw new Error("Duplicate source event identity");
      eventIds.add(eventId);
      if (event.type === "execution_frame" || event.type === "decision_context") {
        const frame = event.frame as ExecutionFrame;
        validateContract("ExecutionFrame", frame);
        if (frame.runId !== runId) throw new Error("Execution frame run ID mismatch");
        const key = `${runId}:${frame.boundary}`;
        const captured = { frame, path: resolved, sequence: row.body.sequence, eventId };
        if (event.type === "execution_frame") {
          if (frames.has(key)) throw new Error("Repeated native execution frame");
          frames.set(key, captured);
        } else {
          const entries = contexts.get(key) ?? [];
          entries.push(captured); contexts.set(key, entries);
        }
      } else candidateEvents.push({ runId, event, path: resolved, sequence: row.body.sequence, eventId });
    }
    if (finalEventType !== "service_closed") throw new Error("Source event log has no final service closure record");
    logReceipts.push({ path: relative(ROOT, resolved).replaceAll("\\", "/"), records: sequence, finalHash: previous });
  }
  const predictions = new Map<string, Map<number, Candidate[]>>();
  const excluded: Record<string, number> = {}, records: Record<string, unknown>[] = [];
  let admitted = 0, replayable = 0;
  for (const item of candidateEvents) {
    const { runId, event, eventId } = item;
    if (typeof event.admission !== "boolean") throw new Error("V3 candidate admission must be explicit");
    const key = `${runId}:${event.boundary}`;
    const originalFrame = frames.get(key);
    // V3 eager evidence may add current sources between execution_frame and
    // candidate prediction. Only a captured PRIOR same-boundary context is a
    // valid binding source. This never supplies cached evidence to the fresh
    // native executor: it still authorizes observations through its own leases.
    const frame = [...(contexts.get(key) ?? [])].reverse().find(value => value.path === item.path && value.sequence < item.sequence) ?? originalFrame;
    if (!frame || frame.path !== item.path || frame.sequence >= item.sequence || !/^[a-f0-9]{64}$/.test(event.visibleInputHash)) {
      throw new Error("Candidate event lacks its prior current-source frame");
    }
    let reason: string | null = event.admission ? null : `original_admission_false:${event.reason ?? "scheduler_rejection"}`;
    if (event.admission) {
      admitted++;
      validateContract("Candidate", event.candidate);
      if (hash(event.candidate.invocation.scope) !== hash(frame.frame.scope)) throw new Error("Candidate scope changed");
      event.candidate.bindings.forEach(ref => resolveSource(ref, frame.frame.sources));
      const run = wanted.get(runId);
      if (!run || event.boundary >= run.turns.length) reason = "no_recorded_actor_turn_to_replay";
      else {
        if (!Number.isInteger(event.boundary) || event.boundary < 0 || hash(run.scope) !== hash(frame.frame.scope)) throw new Error("Replay run boundary or scope mismatch");
        const boundaries = predictions.get(runId) ?? new Map<number, Candidate[]>();
        const candidates = boundaries.get(event.boundary) ?? [];
        candidates.push(copy(event.candidate)); boundaries.set(event.boundary, candidates); predictions.set(runId, boundaries);
        replayable++;
      }
    }
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    records.push({ runId, boundary: event.boundary, sourceEventId: eventId, frameEventId: frame.eventId,
      originalExecutionFrameEventId: originalFrame?.eventId,
      bindingFrameKind: frame === originalFrame ? "execution_frame" : "prior_decision_context",
      visibleInputHash: event.visibleInputHash, candidateId: event.candidate.id,
      originalAdmission: event.admission, replayedCandidateInput: reason === null, exclusionReason: reason });
  }
  return { predictions, frames, audit: { method: method.schemaVersion, finalSourceTreeHash: FINAL_TREE, logReceipts,
    candidateEvents: candidateEvents.length, originallyAdmitted: admitted, replayableAdmitted: replayable, excluded, records,
    sameBoundarySourcePathsVerified: true,
    sourceServiceManifestVerified: true,
    availabilityMeaning: "Replayed at the original numbered boundary; asynchronous live admission does not prove availability before the original actor decision.",
    visibleInputHashMeaning: "Retained from the immutable candidate event. Asynchronous goal adoption can differ from the earlier execution frame; no full frame-hash equality is claimed." } };
}

async function main() {
  const inputPath = resolve(process.argv[2]), output = resolve(process.argv[3]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Offline replay permits only loopback native gateway traffic");
    return originalFetch(input, init);
  }) as typeof fetch;
  const config = JSON.parse(readFileSync(inputPath, "utf8")) as Input;
  const method = JSON.parse(readFileSync(join(output, "replay-method-manifest.json"), "utf8")) as Method;
  if (resolve(ROOT, method.replayInput.path) !== inputPath) throw new Error("Replay configuration path mismatch");
  const { predictions, frames, audit } = loadAdmittedPredictions(config, method);
  writeFileSync(join(output, "candidate-source-audit.json"), JSON.stringify(audit, null, 2) + "\n", { flag: "wx" });
  const gateway = new NativeGateway(process.env.GOALSPEC_GATEWAY_URL!, process.env.GOALSPEC_GATEWAY_TOKEN!);
  const service = new ResearchService(gateway);
  const events = new ImmutableEventLog(join(output, "scheduler-events.jsonl"));
  const counts: Record<string, number> = {}, durations: number[] = [];
  let calls = 0, submittedCandidates = 0, replaySchedulerAdmissions = 0;
  for (const run of config.runs) {
    const reads = new NativeReadExecutor(gateway, run.runId, run.scope, new Set(run.reads), new NativeReadPolicy(run.domain, run.scope));
    const scheduler = new SpeculationScheduler(run.runId, reads, event => { counts[event.type] = (counts[event.type] ?? 0) + 1; events.append(event); });
    let boundary = 0;
    service.register(run.runId, {
      async decision() {
        const index = boundary++;
        if (index >= run.turns.length) throw new Error("Recorded actor decisions exhausted");
        const start = performance.now();
        const captured = frames.get(`${run.runId}:${index}`);
        if (!captured) throw new Error("Recorded actor turn lacks its original frame");
        reads.updateFrame(captured.frame);
        await scheduler.evidenceAtBoundary();
        const candidates = predictions.get(run.runId)?.get(index) ?? [];
        submittedCandidates += candidates.length;
        replaySchedulerAdmissions += scheduler.admit(candidates).length;
        const response = copy(run.turns[index]);
        const invocations: Invocation[] = (response.tool_calls ?? []).map(call => ({ tool: call.name,
          arguments: JSON.parse(canonical(call.arguments)), scope: run.scope }));
        const promotions: Record<string, string> = {};
        if (invocations.some(invocation => !reads.nonMutating(invocation))) await scheduler.invalidate("recorded_mutating_or_mixed_batch");
        else for (const [position, invocation] of invocations.entries()) {
          if (!reads.eligible(invocation)) continue;
          const observation = await scheduler.authoritative(invocation, async () => null);
          if (observation !== null) {
            const lease = reads.takeLease(invocation);
            if (lease) promotions[response.tool_calls![position].id] = lease;
          }
        }
        calls++; durations.push(performance.now() - start);
        return { ...response, _goalspecPromotions: promotions };
      }, close: () => scheduler.close(),
    });
  }
  try { while (!(await gateway.request<{ closed: boolean }>("/status", {})).closed) await service.step(); }
  finally { await service.close(); events.close(); }
  durations.sort((a, b) => a - b);
  writeFileSync(join(output, "scheduler-summary.json"), JSON.stringify({
    label: "V3 native fixed-tape replay of originally admitted live predictions; not live timing or a task-success improvement",
    method: method.schemaVersion, runs: config.runs.length, boundaries: calls, sourcePredictionRuns: predictions.size,
    submittedCandidates, replaySchedulerAdmissions, counts,
    replayBoundaryLatencyMs: { sampleCount: durations.length, median: durations[Math.floor(durations.length / 2)] ?? null,
      p95: durations[Math.ceil(durations.length * .95) - 1] ?? null, max: durations.at(-1) ?? null }, providerCalls: 0, billedUsd: 0,
  }, null, 2) + "\n", { flag: "wx" });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`V3 native replay failed: ${error instanceof Error ? error.stack : "Error"}\n`); process.exitCode = 1; });
}
