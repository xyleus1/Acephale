import Ajv2020 from "ajv/dist/2020";
import { hash } from "../../src/lib/acephale/canonical";
import { RESEARCH_MODELS } from "../../src/lib/acephale/model";
import type { SourceRef } from "../../src/lib/acephale/contracts/generated";
import type { GoalDraft } from "./infra-training-export";

export const INFRA_ANNOTATION_VERSION = "acephale-infra-annotation-v1";
interface Source { id: string; kind: string; value: unknown }
export interface InfraAnnotationInput {
  checkpoint_id: string; input_hash: string; request_revision: string;
  input: { policy: string; tools: unknown[]; events: unknown[]; sources: Source[] };
}
interface DraftReference { source_id: string; pointer: string }
interface DraftGoal {
  action: string; object_type: string; objective: string; confidence: number;
  sources: DraftReference[]; constraints: { text: string; sources: DraftReference[] }[];
}
interface Draft { goals: DraftGoal[]; unknown_probability: number }
function resolvePointer(value: unknown, pointer: string): { value: unknown; path: (string | number)[] } {
  const path: (string | number)[] = [];
  if (pointer === "") return { value, path };
  if (!pointer.startsWith("/")) throw new Error("Invalid source pointer");
  for (const raw of pointer.slice(1).split("/")) {
    if (/~(?![01])/u.test(raw)) throw new Error("Invalid source pointer escape");
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(value)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) throw new Error("Source array index not visible");
      path.push(Number(key)); value = value[Number(key)];
    } else if (value && typeof value === "object" && Object.hasOwn(value, key)) {
      path.push(key); value = (value as Record<string, unknown>)[key];
    }
    else throw new Error("Source pointer not visible");
  }
  return { value, path };
}
export function teacherSchema(ids: string[]) {
  const reference = { type: "object", additionalProperties: false, required: ["source_id", "pointer"], properties: {
    source_id: { type: "string", enum: ids }, pointer: { type: "string", maxLength: 256 },
  } };
  const refs = { type: "array", minItems: 1, maxItems: 8, items: reference };
  return { type: "object", additionalProperties: false, required: ["goals", "unknown_probability"], properties: {
    unknown_probability: { type: "number", minimum: 0, maximum: 1 },
    goals: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false,
      required: ["action", "object_type", "objective", "confidence", "sources", "constraints"], properties: {
        action: { type: "string", enum: ["retrieve", "compare", "explain", "diagnose", "modify", "transact", "communicate", "unknown"] },
        object_type: { type: "string", minLength: 1, maxLength: 120 }, objective: { type: "string", minLength: 1, maxLength: 800 },
        confidence: { type: "number", minimum: 0, maximum: 1 }, sources: refs,
        constraints: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false,
          required: ["text", "sources"], properties: { text: { type: "string", minLength: 1, maxLength: 320 }, sources: refs } } },
      } } },
  } };
}

export function bindTeacherDraft(value: unknown, row: InfraAnnotationInput, selectedSourceIds: string[]) {
  if (!new Ajv2020({ strict: false }).compile(teacherSchema(selectedSourceIds))(value)) throw new Error("Invalid teacher draft schema");
  const draft = value as unknown as Draft;
  if (Math.abs(draft.unknown_probability + draft.goals.reduce((sum, goal) => sum + goal.confidence, 0) - 1) > 1e-6) throw new Error("Invalid teacher goal probability distribution");
  const sources = new Map(row.input.sources.map(source => [source.id, source.value]));
  const bind = (ref: DraftReference) => {
    if (!selectedSourceIds.includes(ref.source_id) || !sources.has(ref.source_id)) throw new Error("Teacher cited a non-visible source");
    return { ...ref, value_hash: hash(resolvePointer(sources.get(ref.source_id), ref.pointer).value) };
  };
  return { checkpoint_id: row.checkpoint_id, input_hash: row.input_hash, request_revision: row.request_revision,
    teacher_model: RESEARCH_MODELS.teacher, annotation_version: INFRA_ANNOTATION_VERSION,
    unknown_probability: draft.unknown_probability,
    goals: draft.goals.map(goal => ({ ...goal, sources: goal.sources.map(bind),
      constraints: goal.constraints.map(constraint => ({ ...constraint, sources: constraint.sources.map(bind) })) })),
  };
}

/** Convert the teacher's bound annotation without accepting stale or invented evidence. */
export function annotationGoalDraft(value: unknown, row: InfraAnnotationInput): GoalDraft {
  if (!row.request_revision || row.input_hash !== hash(row.input)) throw new Error("Invalid public annotation input identity");
  const sources = new Map(row.input.sources.map(source => [source.id, source.value]));
  if (sources.size !== row.input.sources.length) throw new Error("Duplicate visible source ID");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid bound teacher annotation");
  const annotation = value as ReturnType<typeof bindTeacherDraft>;
  const keys = ["checkpoint_id", "input_hash", "request_revision", "teacher_model", "annotation_version", "goals", "unknown_probability"];
  if (Object.keys(annotation).sort().join(",") !== keys.sort().join(",")
    || annotation.checkpoint_id !== row.checkpoint_id || annotation.input_hash !== row.input_hash
    || annotation.request_revision !== row.request_revision || annotation.teacher_model !== RESEARCH_MODELS.teacher
    || annotation.annotation_version !== INFRA_ANNOTATION_VERSION || !Array.isArray(annotation.goals)) {
    throw new Error("Teacher annotation identity differs from the public checkpoint");
  }
  const reference = (ref: { source_id: string; pointer: string; value_hash: string }): SourceRef => {
    if (!ref || Object.keys(ref).sort().join(",") !== "pointer,source_id,value_hash" || typeof ref.pointer !== "string"
      || !sources.has(ref.source_id) || !/^[a-f0-9]{64}$/.test(ref.value_hash)) throw new Error("Invalid bound annotation reference");
    const { value, path } = resolvePointer(sources.get(ref.source_id), ref.pointer);
    if (path.length > 8 || hash(value) !== ref.value_hash) throw new Error("Annotation source value changed or exceeds runtime path limit");
    return { sourceId: ref.source_id, path: path as SourceRef["path"] };
  };
  // Reuse the teacher's schema and binding checks rather than maintaining a second goal vocabulary.
  const draft = { unknown_probability: annotation.unknown_probability, goals: annotation.goals.map(goal => ({ ...goal,
    sources: goal.sources.map(ref => { reference(ref); return { source_id: ref.source_id, pointer: ref.pointer }; }),
    constraints: goal.constraints.map(constraint => ({ ...constraint, sources: constraint.sources.map(ref => {
      reference(ref); return { source_id: ref.source_id, pointer: ref.pointer };
    }) })) })) };
  const checked = bindTeacherDraft(draft, row, [...sources.keys()]);
  return { schemaVersion: 1, unknown: checked.unknown_probability, hypotheses: checked.goals.map((goal, index) => ({
    id: `${goal.action}:${goal.object_type}:${index}`, objective: goal.objective, probability: goal.confidence,
    sources: goal.sources.map(reference) as [SourceRef, ...SourceRef[]],
    constraints: goal.constraints.map(constraint => ({ text: constraint.text, sources: constraint.sources.map(reference) as [SourceRef, ...SourceRef[]] })),
  })) as GoalDraft["hypotheses"] };
}
