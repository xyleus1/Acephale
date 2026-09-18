import { copy, hash } from "../../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, Invocation, SourceRef } from "../../src/lib/goalspec/contracts/generated";
import { bindCurrentSources } from "../../src/lib/goalspec/current-bindings";
export { nativeCandidateGraph as nativeDeterministicCandidatesV4, validateNativeCandidateV4 } from "./native-candidate-graph";

const PINNED_ENVIRONMENT = "2174a603f6d014ef94473ffa95957f6ce27100db";
const IDENTITY = new Set(["find_user_id_by_email", "find_user_id_by_name_zip"]);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const token = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/\s/.test(value);

function successfulCalls(frame: ExecutionFrame) {
  const events = frame.sources._binding_events;
  if (!Array.isArray(events)) return null;
  const requests = new Map<string, { tool: string; arguments: Record<string, unknown>; speculative: boolean }>(), completed = new Set<string>();
  const successes: { tool: string; arguments: Record<string, unknown>; result: unknown; index: number }[] = [];
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!object(event)) return null;
    if (event.kind === "tool_request") {
      if (!token(event.call_id) || typeof event.tool !== "string" || !object(event.arguments) || requests.has(event.call_id)) return null;
      requests.set(event.call_id, { tool: event.tool, arguments: event.arguments, speculative: event.speculative === true });
    } else if (event.kind === "tool_result") {
      if (!token(event.call_id)) return null;
      const request = requests.get(event.call_id);
      if (!request || completed.has(event.call_id) || event.tool !== request.tool || (event.speculative === true) !== request.speculative) return null;
      completed.add(event.call_id);
      if (event.status === "success") successes.push({ tool: request.tool, arguments: request.arguments, result: event.result, index });
    }
  }
  return successes;
}

/** Audited output-type edge, not a prediction learned from historical entities.
 * The identity result is a scalar user ID, which the generic field binder cannot
 * identify. It proposes one profile read only when the current guard admits it.
 * Speculative event metadata alone never grants authorization: eligible must be
 * the server-owned NativeReadPolicy, updated from this exact current frame.
 */
export function bindNativeOutputEdges(
  domain: "retail" | "airline", frame: ExecutionFrame,
  tools: Record<string, Record<string, unknown>>, eligible: (invocation: Invocation) => boolean,
): Candidate[] {
  if (domain !== "retail" || frame.scope.environmentVersion !== PINNED_ENVIRONMENT) return [];
  const schema = tools.get_user_details;
  if (!schema || !Array.isArray(schema.required) || schema.required.length !== 1 || schema.required[0] !== "user_id"
    || !object(schema.properties) || Object.keys(schema.properties).length !== 1
    || !object(schema.properties.user_id) || schema.properties.user_id.type !== "string") return [];
  const successes = successfulCalls(frame);
  if (!successes) return [];
  const values = new Map<string, SourceRef>();
  for (const call of successes) {
    if (IDENTITY.has(call.tool) && token(call.result)) values.set(call.result, { sourceId: "_binding_events", path: [call.index, "result"] });
  }
  if (values.size !== 1) return [];
  const [userId, binding] = [...values.entries()][0];
  const invocation: Invocation = { tool: "get_user_details", arguments: { user_id: userId }, scope: copy(frame.scope) };
  if (!eligible(invocation)) return [];
  return [{ schemaVersion: 1, id: hash({ binder: "native-identity-profile-v3", invocation }), invocation,
    bindings: [binding], probability: 0.86, hop: 1, patternId: null }];
}

/** Once-observed profile data makes another deterministic profile proposal
 * unhelpful. This filter does not assert the old data is fresh, and never stops
 * an actual actor refresh. It remains conservative after a write or calculate.
 */
export function nativeDeterministicCandidates(
  frame: ExecutionFrame, tools: Record<string, Record<string, unknown>>, eligible: (invocation: Invocation) => boolean,
): Candidate[] {
  const successes = successfulCalls(frame);
  if (!successes) return [];
  const profiles = new Set(successes.filter(call => call.tool === "get_user_details" && token(call.arguments.user_id)
    && object(call.result) && call.result.user_id === call.arguments.user_id).map(call => call.arguments.user_id));
  const domain = [...IDENTITY].some(tool => Object.hasOwn(tools, tool)) ? "retail" : "airline";
  const candidates = [...bindCurrentSources(frame, tools), ...bindNativeOutputEdges(domain, frame, tools, eligible)];
  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (candidate.invocation.tool === "get_user_details" && profiles.has(candidate.invocation.arguments.user_id)) continue;
    if (eligible(candidate.invocation)) unique.set(hash(candidate.invocation), candidate);
  }
  return [...unique.values()];
}
