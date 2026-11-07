import Ajv2020 from "ajv/dist/2020";
import { canonical, copy, hash } from "../../src/lib/acephale/canonical";
import type { Candidate, ExecutionFrame, Invocation, Json, SourceRef } from "../../src/lib/acephale/contracts/generated";
import { isNativeNonMutatingTool, nativeEmailFallbackSources } from "./native-read-policy";

const ENVIRONMENT = "2174a603f6d014ef94473ffa95957f6ce27100db";
const SCALAR_TOOLS: Record<string, string> = { find_user_id_by_email: "email", get_user_details: "user_id",
  get_order_details: "order_id", get_product_details: "product_id", get_item_details: "item_id", get_reservation_details: "reservation_id" };
const FIELDS = new Set([...Object.values(SCALAR_TOOLS), "first_name", "last_name", "zip"]);
const ARRAYS: Record<string, string> = { orders: "order_id", reservations: "reservation_id" };
const object = (value: unknown): value is Record<string, Json> => !!value && typeof value === "object" && !Array.isArray(value);
const scalar = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/\s/.test(value);
const airport = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const ajv = new Ajv2020({ strict: false });
const validators = new Map<string, ReturnType<Ajv2020["compile"]>>();
type Tools = Record<string, Record<string, unknown>>;
type Atom = { value: string; ref: SourceRef };
type Tuple = { arguments: Record<string, Json>; refs: SourceRef[]; role?: "outbound" | "return" };
type Call = { tool: string; arguments: Record<string, Json>; result: Json; resultIndex: number; requestIndex: number };
function reference(sourceId: string, path: (string | number)[]): SourceRef {
  if (path.length > 8) throw new Error("Native binding exceeds source path limit");
  return { sourceId, path: path as SourceRef["path"] };
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function addDays(value: string, amount: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}
function validArguments(tool: string, args: Record<string, Json>, tools: Tools): boolean {
  if (!Object.hasOwn(tools, tool)) return false;
  try {
    const key = hash(tools[tool]);
    let validator = validators.get(key);
    if (!validator) { validator = ajv.compile(tools[tool]); validators.set(key, validator); }
    return !!validator(args);
  } catch { return false; }
}
function currentCalls(frame: ExecutionFrame, domain: "retail" | "airline") {
  const events = frame.sources._binding_events;
  if (!Array.isArray(events)) return;
  const pending = new Map<string, { tool: string; arguments: Record<string, Json>; speculative: boolean; index: number }>();
  const completed = new Set<string>(), calls: Call[] = [];
  let latestMutation = -1;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (!object(event)) return;
    if (event.kind === "tool_request") {
      if (!scalar(event.call_id) || typeof event.tool !== "string" || !object(event.arguments) || pending.has(event.call_id)) return;
      pending.set(event.call_id, { tool: event.tool, arguments: event.arguments, speculative: event.speculative === true, index });
      if (!isNativeNonMutatingTool(domain, event.tool)) latestMutation = index;
    } else if (event.kind === "tool_result") {
      if (!scalar(event.call_id)) return;
      const request = pending.get(event.call_id);
      if (!request || completed.has(event.call_id) || event.tool !== request.tool || (event.speculative === true) !== request.speculative) return;
      completed.add(event.call_id);
      if (event.status === "success") calls.push({ tool: request.tool, arguments: request.arguments,
        result: event.result, resultIndex: index, requestIndex: request.index });
    }
  }
  return { calls, visited: new Set(calls.filter(call => call.requestIndex > latestMutation)
    .map(call => hash({ tool: call.tool, arguments: call.arguments, scope: frame.scope }))) };
}

/** An audited current-evidence proposal graph, not permission or a learned goal.
 * Typed arrays and complete tuples retain source paths and relationship roles.
 * Historical examples and inferred goals never supply values. No Cartesian
 * product joins unrelated entities or route/date observations.
 */
export function nativeCandidateGraph(frame: ExecutionFrame, tools: Tools,
  eligible: (invocation: Invocation) => boolean, options: { maxCandidates?: number } = {}): Candidate[] {
  const limit = options.maxCandidates ?? 32;
  if (!Number.isInteger(limit) || limit < 0 || limit > 32) throw new Error("Invalid native candidate graph limit");
  return candidateGraph(frame, tools, eligible, limit);
}

/** V5 opts into a larger proposal universe. The legacy export retains its
 * original bound and ordering; this does not authorize speculative execution. */
export function nativeCandidateGraphV5(frame: ExecutionFrame, tools: Tools,
  eligible: (invocation: Invocation) => boolean, options: { maxCandidates?: number } = {}): Candidate[] {
  const limit = options.maxCandidates ?? 128;
  if (!Number.isInteger(limit) || limit < 0 || limit > 128) throw new Error("Invalid v5 native candidate graph limit");
  return candidateGraph(frame, tools, eligible, limit);
}

function candidateGraph(frame: ExecutionFrame, tools: Tools, eligible: (invocation: Invocation) => boolean, limit: number): Candidate[] {
  if (!limit || frame.scope.environmentVersion !== ENVIRONMENT) return [];
  const domain = Object.hasOwn(tools, "find_user_id_by_email") || Object.hasOwn(tools, "find_user_id_by_name_zip") ? "retail" : "airline";
  const history = currentCalls(frame, domain);
  if (!history) return [];
  const atoms = new Map<string, Atom[]>(), identities: Tuple[] = [], routes: Tuple[] = [], flights: Tuple[] = [];
  const requirements = Object.entries(frame.sources).filter(([key, value]) => (key.startsWith("requirement:") || key === "current_user_request") && typeof value === "string")
    .sort(([a], [b]) => Number(a.split(":")[1] ?? -1) - Number(b.split(":")[1] ?? -1));
  const addAtom = (field: string, value: Json, ref: SourceRef) => {
    if (scalar(value)) atoms.set(field, [...(atoms.get(field) ?? []), { value, ref }]);
  };
  let nodes = 0, exceeded = false;
  const walk = (value: Json, sourceId: string, path: (string | number)[] = [], trip?: { origin: string; destination: string }) => {
    if (++nodes > 8_192) { exceeded = true; return; }
    if (path.length >= 8) return;
    if (Array.isArray(value)) { for (let i = 0; i < value.length && !exceeded; i++) walk(value[i], sourceId, [...path, i], trip); return; }
    if (!object(value)) return;
    if (airport(value.origin) && airport(value.destination) && Array.isArray(value.flights)) trip = { origin: value.origin, destination: value.destination };
    const refs = (fields: string[]) => fields.map(field => reference(sourceId, [...path, field]));
    if (scalar(value.first_name) && scalar(value.last_name) && scalar(value.zip)) identities.push({ arguments: {
      first_name: value.first_name, last_name: value.last_name, zip: value.zip }, refs: refs(["first_name", "last_name", "zip"]) });
    if (airport(value.origin) && airport(value.destination) && date(value.date) && value.origin !== value.destination) {
      const role = trip && value.origin === trip.origin && value.destination === trip.destination ? "outbound"
        : trip && value.origin === trip.destination && value.destination === trip.origin ? "return" : undefined;
      routes.push({ arguments: { origin: value.origin, destination: value.destination, date: value.date }, refs: refs(["origin", "destination", "date"]), role });
    }
    if (scalar(value.flight_number) && date(value.date)) flights.push({ arguments: { flight_number: value.flight_number, date: value.date }, refs: refs(["flight_number", "date"]) });
    for (const [field, child] of Object.entries(value)) {
      if (exceeded) break;
      const childPath = [...path, field];
      if (FIELDS.has(field)) addAtom(field, child, reference(sourceId, childPath));
      if (ARRAYS[field] && Array.isArray(child) && childPath.length < 8) child.forEach((entry, i) => addAtom(ARRAYS[field], entry, reference(sourceId, [...childPath, i])));
      walk(child, sourceId, childPath, trip);
    }
  };
  for (const [sourceId, value] of Object.entries(frame.sources)) {
    if (/^(?:requirement:|observation:|tool:|prefetch:)/.test(sourceId) || sourceId === "current_user_request") walk(value, sourceId);
    if (exceeded) return [];
  }
  // Results have tool-defined types even when a duplicate observation source is
  // absent (for example an identity scalar or a verified prefetched receipt).
  for (const call of history.calls) {
    const ref: SourceRef = { sourceId: "_binding_events", path: [call.resultIndex, "result"] };
    if (["find_user_id_by_email", "find_user_id_by_name_zip"].includes(call.tool)) addAtom("user_id", call.result, ref);
    walk(call.result, ref.sourceId, ref.path);
    if (exceeded) return [];
  }

  const requestedRoutes: Tuple[] = [];
  for (const [sourceId, raw] of requirements) {
    const value = raw as string, ref: SourceRef = { sourceId, path: [] };
    for (const match of value.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi)) addAtom("email", match[0].replace(/[.,]$/, ""), ref);
    // Explicit typed labels or native identifier morphology. The connective in
    // "my user ID and ..." must never become a proposed profile identifier.
    for (const field of ["user_id", "order_id", "reservation_id", "product_id", "item_id"] as const) {
      const label = field.replace("_", "[ _-]*");
      const expression = new RegExp(`\\b${label}\\b\\s*(?:(is\\s+|[:=]\\s*))?["']?([#A-Za-z0-9][A-Za-z0-9_#.-]*)`, "gi");
      for (const match of value.matchAll(expression)) {
        const entry = match[2].replace(/[.,]$/, "");
        if (!match[1] && !/[_\d#]/.test(entry)) continue;
        addAtom(field, entry, ref);
      }
    }
    const explicit: Record<string, string> = {};
    for (const field of ["first_name", "last_name", "zip"] as const) {
      const label = field === "zip" ? "(?:zip(?:[ -]*code)?|postal[ -]*code)" : field.replace("_", "[ _-]*");
      const match = new RegExp(`\\b${label}\\b\\s*(?:(?:is|:)\\s*|=\\s*)["']?([\\p{L}0-9][\\p{L}0-9'\\u2019-]*)`, "iu").exec(value);
      if (match) explicit[field] = match[1];
    }
    const name = /\b(?:[Mm]y name is|I am|I'm|I\u2019m)\s+([\p{Lu}][\p{L}'\u2019-]+)\s+([\p{Lu}][\p{L}'\u2019-]+)(?=[,.\s]|$)/u.exec(value);
    const zip = /\b(?:zip(?:[ -]*code)?|postal[ -]*code)\b\s*(?:(?:is|:)\s*|=\s*)?(\d{5}(?:-\d{4})?)\b/i.exec(value);
    if (name) { explicit.first_name ??= name[1]; explicit.last_name ??= name[2]; }
    if (zip) explicit.zip ??= zip[1];
    if (explicit.first_name && explicit.last_name && explicit.zip) identities.push({ arguments: explicit, refs: [ref] });
    const route = /\bfrom\s+([A-Z]{3})\s+to\s+([A-Z]{3})\b/.exec(value);
    const dates = [...value.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(match => match[0]).filter(date);
    if (route && dates.length === 1 && route[1] !== route[2]) requestedRoutes.push({ arguments: { origin: route[1], destination: route[2], date: dates[0] }, refs: [ref] });
  }
  // Resolve bounded calendar offsets only against an unambiguous visible trip
  // or an explicit clock. Never treat the machine's wall clock as user evidence.
  const latest = [...requirements].reverse().find(([, value]) => /\b(?:flight|fly|trip|depart|leave|outbound|return|days?\s+(?:later|earlier|after|before)|tomorrow|today)\b/i.test(value as string));
  if (latest) {
    const [sourceId, raw] = latest, value = raw as string, ref: SourceRef = { sourceId, path: [] };
    const offset = /\b(one|two|three|[1-9]\d?)\s+days?\s+(later|earlier|after|before)\b/i.exec(value);
    const direction = /\bfrom\s+([A-Z]{3})\s+to\s+([A-Z]{3})\b/.exec(value);
    const role = /\boutbound\b/i.test(value) && !/\breturn\b/i.test(value) ? "outbound"
      : /\breturn\b/i.test(value) && !/\boutbound\b/i.test(value) ? "return" : undefined;
    if (offset && !/\b(?:not|don't|do not|cancel)\b/i.test(value)) {
      const amount = ({ one: 1, two: 2, three: 3 } as Record<string, number>)[offset[1].toLowerCase()] ?? Number(offset[1]);
      const eligibleRoutes = routes.filter(route => (!direction || route.arguments.origin === direction[1] && route.arguments.destination === direction[2])
        && (!role || route.role === role));
      const unique = [...new Map(eligibleRoutes.map(route => [canonical(route.arguments), route])).values()];
      if (unique.length === 1) {
        const anchor = unique[0];
        const explicitDates = [...value.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map(match => match[0]);
        if (!explicitDates.length || explicitDates.length === 1 && explicitDates[0] === anchor.arguments.date) requestedRoutes.push({
          arguments: { ...anchor.arguments, date: addDays(String(anchor.arguments.date), /earlier|before/i.test(offset[2]) ? -amount : amount) }, refs: [...anchor.refs, ref], role: anchor.role });
      }
    }
    if (direction && /\b(?:tomorrow|today)\b/i.test(value)) {
      const clock = Object.entries(frame.sources).filter(([key, entry]) => /^(?:current_date|today)$/.test(key) && date(entry));
      const timezone = frame.sources.timezone;
      if (clock.length === 1 && typeof timezone === "string" && timezone.length && !(value.match(/\b(?:tomorrow|today)\b/gi)?.length !== 1)) {
        requestedRoutes.push({ arguments: { origin: direction[1], destination: direction[2], date: addDays(clock[0][1] as string, /\btomorrow\b/i.test(value) ? 1 : 0) },
          refs: [ref, { sourceId: clock[0][0], path: [] }, { sourceId: "timezone", path: [] }] });
      }
    }
  }

  const candidates = new Map<string, Candidate>();
  const add = (tool: string, args: Record<string, Json>, refs: SourceRef[]) => {
    if (candidates.size >= limit || !isNativeNonMutatingTool(domain, tool) || tool === "calculate" || !validArguments(tool, args, tools)) return;
    const invocation: Invocation = { tool, arguments: copy(args), scope: copy(frame.scope) }, key = hash(invocation);
    if (history.visited.has(key) || candidates.has(key) || !eligible(invocation)) return;
    const bindings = [...new Map(refs.map(ref => [canonical(ref), ref])).values()];
    candidates.set(key, { schemaVersion: 1, id: hash({ binder: "native-candidate-graph-v4", invocation, bindings }), invocation,
      bindings: copy(bindings), probability: .86, hop: 1, patternId: null });
  };
  for (const tuple of requestedRoutes) for (const tool of ["search_direct_flight", "search_onestop_flight"]) add(tool, tuple.arguments, tuple.refs);
  for (const tuple of identities) add("find_user_id_by_name_zip", tuple.arguments, [...tuple.refs, ...nativeEmailFallbackSources(frame)]);
  for (const [tool, field] of Object.entries(SCALAR_TOOLS)) for (const atom of atoms.get(field) ?? []) add(tool, { [field]: atom.value }, [atom.ref]);
  for (const tuple of routes) for (const tool of ["search_direct_flight", "search_onestop_flight"]) add(tool, tuple.arguments, tuple.refs);
  for (const tuple of flights) add("get_flight_status", tuple.arguments, tuple.refs);
  return [...candidates.values()];
}

/** Recompute deterministic transformations against the current visible source
 * graph. This is needed for calendar arithmetic, whose result is not a literal
 * substring. It grants no authorization and accepts no supplied proof object.
 */
export function validateNativeCandidateV4(candidate: Candidate, frame: ExecutionFrame, tools: Tools,
  eligible: (invocation: Invocation) => boolean): boolean {
  return nativeCandidateGraph(frame, tools, eligible).some(current => current.id === candidate.id
    && canonical(current.invocation) === canonical(candidate.invocation) && canonical(current.bindings) === canonical(candidate.bindings));
}
