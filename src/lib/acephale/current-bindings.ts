import { hash } from "./canonical";
import type { Candidate, ExecutionFrame, Json, SourceRef } from "./contracts/generated";

// Fast deterministic proposals, never historical entity substitution. Only a
// single required scalar argument is supported; ambiguity causes abstention.
export function bindCurrentSources(frame: ExecutionFrame, tools: Record<string, Record<string, unknown>>): Candidate[] {
  const result: Candidate[] = [];
  for (const [tool, schema] of Object.entries(tools)) {
    const required = schema.required as string[] | undefined;
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (required?.length !== 1 || !properties || Object.keys(properties).length !== 1) continue;
    const key = required[0], type = properties[key]?.type;
    if (type !== "string" && type !== "number" && type !== "integer") continue;
    const observed = new Map<string, { value: Json; ref: SourceRef; explicit: boolean }>();
    const explicit = new Map<string, { value: Json; ref: SourceRef; explicit: boolean }>();
    const add = (value: Json, ref: SourceRef, direct = false) => {
      if ((type === "string" && typeof value !== "string") || (type !== "string" && typeof value !== "number")) return;
      if (typeof value === "string" && !value.trim()) return;
      (direct ? explicit : observed).set(hash(value), { value, ref, explicit: direct });
    };
    const walk = (value: Json, sourceId: string, path: (string | number)[] = []) => {
      if (!value || typeof value !== "object" || path.length >= 8) return;
      for (const [field, child] of Object.entries(value)) {
        const part = Array.isArray(value) ? Number(field) : field;
        const childPath = [...path, part] as SourceRef["path"];
        if (field === key) add(child, { sourceId, path: childPath });
        walk(child, sourceId, childPath);
      }
    };
    for (const [sourceId, source] of Object.entries(frame.sources)) {
      if (!(sourceId.startsWith("requirement:") || sourceId.startsWith("observation:") || sourceId.startsWith("tool:")
        || sourceId.startsWith("prefetch:") || sourceId === "current_user_request")) continue;
      if (source && typeof source === "object") walk(source, sourceId);
      if (!(sourceId.startsWith("requirement:") || sourceId === "current_user_request") || typeof source !== "string") continue;
      // Email syntax is unambiguous. Other fields require their explicit label.
      const escaped = key.split("_").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const label = escaped.join("[ _-]*");
      const pattern = key === "email" ? /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi
        : new RegExp(`\\b${label}\\b\\s*(?:is\\s+|[:=]\\s*)?["']?([#A-Za-z0-9][A-Za-z0-9_.@#-]*)`, "gi");
      for (const match of source.matchAll(pattern)) {
        const text = (key === "email" ? match[0] : match[1]).replace(/[.,]$/, "");
        if (["is", "my", "the", "please", "unknown", "not"].includes(text.toLowerCase())) continue;
        const value = type === "string" ? text : Number(text);
        if (typeof value === "number" && !Number.isFinite(value)) continue;
        add(value, { sourceId, path: [] }, true);
      }
    }
    const values = explicit.size ? explicit : observed;
    if (values.size !== 1) continue;
    const binding = [...values.values()][0];
    const invocation = { tool, arguments: { [key]: binding.value }, scope: frame.scope };
    result.push({ schemaVersion: 1, id: hash({ binder: "current-fields-v3", invocation }), invocation,
      bindings: [binding.ref], probability: binding.explicit ? 0.97 : 0.86, hop: 1, patternId: null });
  }
  return result;
}

export interface AdmissionEstimate {
  toolMs: number; validationMs: number; schedulingMs: number;
  exposedPredictionMs: number; actorRoundMs: number;
}
export function expectedSavingMs(probability: number, estimate: AdmissionEstimate, exposesEvidence: boolean): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1
    || Object.values(estimate).some(value => !Number.isFinite(value) || value < 0)) throw new Error("Invalid admission estimate");
  return probability * (estimate.toolMs + (exposesEvidence ? estimate.actorRoundMs : 0))
    - estimate.validationMs - estimate.schedulingMs - estimate.exposedPredictionMs;
}
