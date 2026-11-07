import { canonical, copy, hash } from "./canonical";
import { validateContract } from "./contracts/validate";
import { memoryRunHasKnownOutcome } from "./episodic-retrieval";
import { validateMemoryArtifact, type FrozenExperienceMemory, type MemoryFile, type MemoryMiss } from "./experience-memory";
import type { Candidate, Json } from "./contracts/generated";

interface ToolCall { id: string; name: string; arguments: Record<string, Json> }
interface ActorResponse extends Record<string, unknown> {
  tool_calls?: ToolCall[] | null; raw_data?: { acephaleCompiler?: { inputHash?: string } };
}
interface PublicRow extends Record<string, unknown> { type: string; runId: string; boundaryId: string; inputHash: string; response: ActorResponse }
interface Event {
  type: string; runId: string; checkpoint: number; boundary: number; boundaryId: string; frameHash: string;
  sequence: number; processClockId: string; monotonicNs: string; publicInputHash: string; actorInputHash: string;
  actorInputHashKind: string; actorResponseHash: string; toolCalls: ToolCall[]; candidatePool: Candidate[]; poolHash: string;
  probabilitySemantics: string; decision: { action: string; scores: { candidateId: string; probability: number }[] };
  candidateId: string; admitted: boolean;
}
function objectRows<T>(rows: unknown[]): T[] {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Causal source must contain object rows");
  return rows as T[]; // Individual event payloads are checked before their fields are consumed below.
}
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const key = (row: Event) => canonical([row.runId, row.checkpoint]);
/** Inputs must come from receipt-verified immutable files. Never infer ordering from wall time. */
export function extractCausalMemoryMisses(memoryInput: FrozenExperienceMemory, eventInput: unknown[], publicInput: unknown[], source: MemoryFile): MemoryMiss[] {
  const events = objectRows<Event>(eventInput), publicRows = objectRows<PublicRow>(publicInput);
  const memory = validateMemoryArtifact(memoryInput);
  if (!events.length || !digest(source.sha256) || !source.path) throw new Error("Sealed event source required");
  let clock: string | undefined, monotonic = -1n;
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index || typeof event.processClockId !== "string" || !event.processClockId
      || clock && event.processClockId !== clock || !/^\d+$/.test(event.monotonicNs)) throw new Error("Noncontiguous causal event sequence");
    const tick = BigInt(event.monotonicNs);
    if (tick < monotonic) throw new Error("Nonmonotonic causal event clock");
    clock = event.processClockId; monotonic = tick;
  }
  if (!events.some(row => row.type === "infra_native_service_closed")) throw new Error("Unclosed causal event service");
  const runs = new Map(memory.runs.filter(memoryRunHasKnownOutcome).map(run => [run.id, run]));
  const episodes = new Map(memory.episodes.filter(row => runs.has(row.runId)).map(row => [canonical([row.runId, row.boundary]), row]));
  const responses = new Map<string, ActorResponse>(), inputs = new Map<string, PublicRow>();
  for (const row of publicRows.filter(row => row.type === "public_checkpoint" && runs.has(row.runId))) {
    const identity = canonical([row.runId, row.boundaryId]);
    const input: Record<string, unknown> = { ...row }; delete input.type; delete input.inputHash;
    if (inputs.has(identity) || hash(input) !== row.inputHash) throw new Error("Changed causal public input");
    inputs.set(identity, row);
  }
  for (const row of publicRows.filter(row => row.type === "public_response" && runs.has(row.runId))) {
    const identity = canonical([row.runId, row.boundaryId]);
    if (responses.has(identity)) throw new Error("Repeated causal public response");
    responses.set(identity, row.response);
  }
  const checkpoints = new Map<string, Event>(), generations = new Map<string, Event>(), rankings = new Map<string, Event>();
  for (const row of events) {
    if (!runs.has(row.runId) || !["infra_native_checkpoint", "actor_generated", "infra_ranking"].includes(row.type)) continue;
    if (!Number.isSafeInteger(row.checkpoint) || row.checkpoint < 0 || row.boundary !== row.checkpoint || !digest(row.frameHash)) throw new Error("Invalid causal checkpoint");
    const target = row.type === "infra_native_checkpoint" ? checkpoints : row.type === "actor_generated" ? generations : rankings;
    if (target.has(key(row))) throw new Error("Repeated causal event for one checkpoint");
    target.set(key(row), row);
  }
  const misses: MemoryMiss[] = [];
  for (const [identity, ranking] of rankings) {
    const episode = episodes.get(identity), checkpoint = checkpoints.get(identity), generated = generations.get(identity);
    if (!episode || !checkpoint || !generated) throw new Error("Causal prediction has no exact training checkpoint");
    if (checkpoint.sequence >= ranking.sequence || ranking.sequence >= generated.sequence) continue; // late predictions are not causal lessons
    if (ranking.frameHash !== checkpoint.frameHash || generated.frameHash !== checkpoint.frameHash
      || generated.boundaryId !== checkpoint.boundaryId || generated.publicInputHash !== checkpoint.publicInputHash
      || !digest(generated.publicInputHash) || !digest(generated.actorInputHash) || !digest(generated.actorResponseHash)
      || generated.actorInputHashKind !== "compiled_model_input") throw new Error("Causal actor/frame identity mismatch");
    const responseKey = canonical([generated.runId, generated.boundaryId]);
    const original = responses.get(responseKey);
    if (!original || inputs.get(responseKey)?.inputHash !== generated.publicInputHash) throw new Error("Causal generated response/input missing from sealed public trace");
    const response = copy(original);
    delete response._acephalePromotions;
    if (response.tool_calls != null && !Array.isArray(response.tool_calls) || !Array.isArray(generated.toolCalls)) throw new Error("Invalid causal actor calls");
    const responseCalls = (response.tool_calls ?? []).map(call => ({ id: call.id, name: call.name, arguments: call.arguments }));
    if (hash(response) !== generated.actorResponseHash || response.raw_data?.acephaleCompiler?.inputHash !== generated.actorInputHash
      || canonical(responseCalls) !== canonical(generated.toolCalls)) throw new Error("Causal actor response hash or tool IDs changed");
    const actual = generated.toolCalls.map(call => ({ id: call.id, tool: call.name, arguments: call.arguments }));
    if (canonical(actual) !== canonical(episode.nextActions)) throw new Error("Causal actor actions differ from training trace");
    if (!Array.isArray(ranking.candidatePool) || hash(ranking.candidatePool) !== ranking.poolHash
      || ranking.probabilitySemantics !== "independent_next_batch_hit") throw new Error("Causal candidate pool identity mismatch");
    for (const candidate of ranking.candidatePool) {
      validateContract("Candidate", candidate);
      if (canonical(candidate.invocation.scope) !== canonical(episode.scope)) throw new Error("Causal candidate scope mismatch");
    }
    const decision = ranking.decision;
    if (!decision || !Array.isArray(decision.scores) || !["READ", "NO_READ", "READ_UNCOVERED"].includes(decision.action)
      || new Set(decision.scores.map(row => row.candidateId)).size !== decision.scores.length
      || decision.scores.some(row => !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1
        || !ranking.candidatePool.some(candidate => candidate.id === row.candidateId))) throw new Error("Invalid causal ranking");
    if (decision.action !== "READ" || !decision.scores.length) continue;
    // Only the primary prediction is a confusion. Alternative top-k branches are not errors.
    const primary = [...decision.scores].sort((a, b) => b.probability - a.probability || a.candidateId.localeCompare(b.candidateId))[0];
    const candidate = ranking.candidatePool.find(row => row.id === primary.candidateId)!;
    const predicted = { tool: candidate.invocation.tool, arguments: copy(candidate.invocation.arguments) };
    const observed = episode.nextActions.map(({ tool, arguments: args }) => ({ tool, arguments: copy(args) }));
    misses.push({ id: hash({ source: source.sha256, sequence: ranking.sequence, episode: episode.id }), episodeId: episode.id,
      predicted, actual: observed, fullMatch: observed.some(row => canonical(row) === canonical(predicted)),
      toolMatch: observed.some(row => row.tool === predicted.tool), beforeActorResponse: true,
      admitted: events.some(row => row.type === "infra_admission" && row.runId === episode.runId && row.checkpoint === episode.boundary
        && row.candidateId === candidate.id && row.admitted === true && row.sequence > ranking.sequence && row.sequence < generated.sequence),
      eventSequence: ranking.sequence, eventHash: hash(ranking), source: copy(source) });
  }
  return misses;
}
