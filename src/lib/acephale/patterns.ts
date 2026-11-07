import { canonical, copy } from "./canonical";
import Ajv2020 from "ajv/dist/2020";

export interface Reference { source: "result" | "arguments"; tool: string; occurrence: number; path: (string | number)[] }
export type Expression = { kind: "literal" | "reference" | "object" | "array"; value?: unknown; reference?: Reference | null; fields?: Record<string, Expression>; items?: Expression[] };
export interface BindingEvent { seq: number; kind: string; call_id?: string | null; tool?: string | null; status?: string | null; arguments?: unknown; result?: unknown }

// Port of Python's bounded PrefixSpan projection. Support counts families, not trials.
export function frequentContexts(histories: string[][], groups: string[], maxContext: number, minSupport: number): [string[], number[]][] {
  if (histories.length !== groups.length || !Number.isInteger(maxContext) || maxContext < 0 || maxContext > 6 || !Number.isInteger(minSupport) || minSupport < 1) throw new Error("Invalid miner bounds");
  const result: [string[], number[]][] = [];
  function project(context: string[], rows: [number, number][]) {
    const indexes = rows.map(([i]) => i);
    if (new Set(indexes.map(i => groups[i])).size < minSupport) return;
    result.push([context, indexes]);
    if (context.length >= maxContext) return;
    const extensions = new Map<string, [number, number][]>();
    for (const [index, start] of rows) {
      const seen = new Set<string>();
      for (let pos = start; pos < histories[index].length; pos++) {
        const symbol = histories[index][pos];
        if (!seen.has(symbol)) { const next = extensions.get(symbol) ?? []; next.push([index, pos + 1]); extensions.set(symbol, next); seen.add(symbol); }
      }
    }
    for (const symbol of [...extensions.keys()].sort()) project([...context, symbol], extensions.get(symbol)!);
  }
  project([], histories.map((_, i) => [i, 0]));
  return result;
}

export function resolveBinding(expression: Expression, events: BindingEvent[], throughSeq: number): unknown {
  let remaining = 256;
  const visible = events.filter(e => e.seq <= throughSeq);
  const requests = new Map(visible.filter(e => e.kind === "tool_request").map(e => [e.call_id, e.seq]));
  function visit(node: Expression, depth: number): unknown {
    if (depth > 8 || --remaining < 0) throw new Error("Argument expression exceeds bounds");
    const hasFields = Object.keys(node.fields ?? {}).length > 0;
    const hasItems = (node.items ?? []).length > 0;
    if (node.kind !== "reference" && node.reference != null) throw new Error("Unexpected expression reference");
    if (node.kind === "reference" && (node.value != null || hasFields || hasItems)) throw new Error("Invalid reference expression");
    if (node.kind === "literal" && (hasFields || hasItems)) throw new Error("Invalid literal expression");
    if (node.kind === "object" && (node.value != null || hasItems)) throw new Error("Invalid object expression");
    if (node.kind === "array" && (node.value != null || hasFields)) throw new Error("Invalid array expression");
    if (node.kind === "literal") {
      if (typeof node.value === "object" && node.value !== null) throw new Error("Literal must be a JSON scalar");
      return copy(node.value ?? null);
    }
    if (node.kind === "object") return Object.fromEntries(Object.entries(node.fields ?? {}).map(([k, v]) => [k, visit(v, depth + 1)]));
    if (node.kind === "array") return (node.items ?? []).map(v => visit(v, depth + 1));
    if (node.kind !== "reference" || !node.reference) throw new Error("Invalid expression");
    const ref = node.reference;
    if (ref.source !== "result" && ref.source !== "arguments") throw new Error("Invalid reference source");
    if (!Number.isInteger(ref.occurrence) || ref.occurrence < 1 || ref.occurrence > 8 || ref.path.length > 8) throw new Error("Invalid reference bounds");
    const matches = visible.filter(e => e.tool === ref.tool && (ref.source === "arguments" ? e.kind === "tool_request" : e.kind === "tool_result" && e.status === "success" && requests.has(e.call_id)))
      .sort((a, b) => ref.source === "arguments" ? b.seq - a.seq : requests.get(b.call_id)! - requests.get(a.call_id)!);
    const event = matches[ref.occurrence - 1];
    if (!event) throw new Error("Referenced event unavailable");
    let value = ref.source === "arguments" ? event.arguments : event.result;
    for (const key of ref.path) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, key)
        || (Array.isArray(value) ? typeof key !== "number" || !Number.isInteger(key) || key < 0 : typeof key !== "string")) throw new Error("Invalid JSON path");
      value = (value as Record<string | number, unknown>)[key];
    }
    return copy(value);
  }
  return visit(expression, 0);
}

export function identicalCandidatePool<T extends { tool: string; arguments: unknown }>(conditions: T[][]): T[] {
  const union = new Map<string, T>();
  for (const condition of conditions) for (const candidate of condition) union.set(canonical([candidate.tool, candidate.arguments]), copy(candidate));
  return [...union.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, c]) => c);
}

export interface BindingSample { events: BindingEvent[]; throughSeq: number; arguments: Record<string, unknown> }
export interface ArgumentBinding { expression: Expression; examples: number; total_examples: number; language_version: 1 }

function referenceMap(sample: BindingSample): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const visible = sample.events.filter(e => e.seq <= sample.throughSeq);
  const requests = new Map(visible.filter(e => e.kind === "tool_request").map(e => [e.call_id, e.seq]));
  for (const source of ["result", "arguments"] as const) {
    const occurrences = new Map<string, number>();
    const ordered = visible.filter(e => source === "arguments" ? e.kind === "tool_request" : e.kind === "tool_result" && e.status === "success" && requests.has(e.call_id))
      .sort((a, b) => source === "arguments" ? b.seq - a.seq : requests.get(b.call_id)! - requests.get(a.call_id)!);
    for (const event of ordered) {
      if (!event.tool) continue;
      const occurrence = (occurrences.get(event.tool) ?? 0) + 1;
      occurrences.set(event.tool, occurrence);
      if (occurrence > 8) continue;
      let remaining = 256;
      const tool = event.tool;
      function visit(value: unknown, path: (string | number)[]) {
        if (path.length > 8 || --remaining < 0) return;
        const key = canonical(value);
        const refs = found.get(key) ?? new Set<string>();
        refs.add(canonical({ source, tool, occurrence, path })); found.set(key, refs);
        if (Array.isArray(value)) value.forEach((child, i) => visit(child, [...path, i]));
        else if (value && typeof value === "object") for (const k of Object.keys(value).sort()) visit((value as Record<string, unknown>)[k], [...path, k]);
      }
      visit(source === "arguments" ? event.arguments : event.result, []);
    }
  }
  return found;
}

export function inferBinding(samples: BindingSample[], parameters: Record<string, unknown>, minExamples = 2): ArgumentBinding | undefined {
  if (samples.length < Math.max(2, minExamples)) return;
  try {
    const validate = new Ajv2020({ strict: false }).compile(parameters);
    if (samples.some(s => !validate(s.arguments))) return;
    const references = samples.map(referenceMap);
    let remaining = 256;
    function learn(values: unknown[], schema: Record<string, unknown>, path: (string | number)[]): Expression {
      if (path.length > 8 || --remaining < 0) throw new Error("Binding bounds exceeded");
      const counts = new Map<string, number>();
      values.forEach((v, i) => { for (const r of references[i].get(canonical(v)) ?? []) counts.set(r, (counts.get(r) ?? 0) + 1); });
      const recurring = [...counts].filter(([, n]) => n >= Math.max(2, minExamples));
      if (recurring.length) {
        const best = Math.max(...recurring.map(([, n]) => n));
        const options: Reference[] = recurring.filter(([, n]) => n === best).map(([r]) => JSON.parse(r));
        options.sort((a, b) => Number(a.source !== "result") - Number(b.source !== "result") || a.occurrence - b.occurrence || a.path.length - b.path.length || (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0) || (canonical(a.path) < canonical(b.path) ? -1 : 1));
        return { kind: "reference", reference: options[0] };
      }
      const first = values[0];
      if (first && typeof first === "object" && !Array.isArray(first) && values.every(v => v && typeof v === "object" && !Array.isArray(v) && canonical(Object.keys(v).sort()) === canonical(Object.keys(first).sort()))) {
        const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
        return { kind: "object", fields: Object.fromEntries(Object.keys(first).sort().map(k => [k, learn(values.map(v => (v as Record<string, unknown>)[k]), properties?.[k] ?? {}, [...path, k])])) };
      }
      if (Array.isArray(first) && values.every(v => Array.isArray(v) && v.length === first.length)) return { kind: "array", items: first.map((_, i) => learn(values.map(v => (v as unknown[])[i]), schema.items && typeof schema.items === "object" && !Array.isArray(schema.items) ? schema.items as Record<string, unknown> : {}, [...path, i])) };
      const same = values.every(v => canonical(v) === canonical(first));
      const enumerated = (Object.hasOwn(schema, "const") && canonical(schema.const) === canonical(first)) || (Array.isArray(schema.enum) && schema.enum.some(v => canonical(v) === canonical(first)));
      const field = String(path.at(-1) ?? "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      const entity = /(^|_)(id|name|email|date|address|phone|number|code)($|_)/.test(field);
      const safe = !entity && (typeof first === "string" ? first.length <= 64 && /^[a-zA-Z _-]*$/.test(first) : first === null || typeof first === "boolean" || [-1, 0, 1].includes(first as number));
      if (same && (enumerated || safe)) return { kind: "literal", value: first };
      throw new Error("No repeated argument mapping");
    }
    const expression = learn(samples.map(s => s.arguments), parameters, []);
    const matches = samples.filter(s => {
      try { return canonical(resolveBinding(expression, s.events, s.throughSeq)) === canonical(s.arguments); } catch { return false; }
    }).length;
    if (matches >= Math.max(2, minExamples)) return { expression, examples: matches, total_examples: samples.length, language_version: 1 };
  } catch { return; }
}
