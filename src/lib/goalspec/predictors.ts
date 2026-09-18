import Ajv2020 from "ajv/dist/2020";
import { countTokens } from "./tokens";
export { countTokens } from "./tokens";
import { canonical, copy, hash } from "./canonical";
import { resolveSource } from "./compiler";
import type { Candidate, ExecutionFrame, GoalSet } from "./contracts/generated";
import schema from "./contracts/v1.schema.json";
import { validateContract } from "./contracts/validate";
import type { ModelPort } from "./model";
import { predictCompactGoals, CompactGoalContractError } from "./compact-goals";
import { predictCompactCandidates } from "./compact-candidates";
import type { Predictors } from "./session";
import type { Experience } from "./repository";
import type { Allocation } from "./budget";
import { resolveBinding, type ArgumentBinding, type BindingEvent } from "./patterns";


// Extract only a literal token/phrase that is present in a referenced string.
// Email and identifier fragments do not establish a current entity binding.
export function exactTextValue(text: string, value: string): boolean {
  if (!value || value.trim() !== value) return false;
  const identifier = /[\p{L}\p{N}\p{M}_@.+-]/u;
  for (let offset = text.indexOf(value); offset !== -1; offset = text.indexOf(value, offset + 1)) {
    const before = Array.from(text.slice(0, offset)).at(-1) ?? "";
    const suffix = Array.from(text.slice(offset + value.length));
    const after = suffix[0] ?? "";
    const following = suffix[1] ?? "";
    const sentencePeriod = after === "." && (!following || /[\s)\]}"']/u.test(following));
    if ((!before || !identifier.test(before)) && (!after || !identifier.test(after) || sentencePeriod)) return true;
  }
  return false;
}
export function bindWorkflowPatterns(frame: ExecutionFrame, records: Experience[]): Candidate[] {
  const events = frame.sources._binding_events;
  const signatures = frame.sources._signatures;
  if (!Array.isArray(events) || !Array.isArray(signatures)) return [];
  const candidates: Candidate[] = [];
  for (const record of records) {
    const pattern = record.pattern;
    // Unsupported prerequisite predicates fail closed, rather than treating
    // empirical ordering as proof that a policy prerequisite was satisfied.
    if (pattern.policyPrerequisites.length || pattern.verificationTier !== "native_verified") continue;
    let position = 0;
    for (const signature of signatures) if (pattern.prefix[position] === signature) position++;
    if (position !== pattern.prefix.length) continue;
    try {
      const binding = pattern.binding as unknown as ArgumentBinding;
      if (binding.language_version !== 1 || binding.examples < 2 || binding.total_examples < binding.examples) continue;
      const value = resolveBinding(binding.expression, events as unknown as BindingEvent[], Number.MAX_SAFE_INTEGER);
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const invocation = { tool: pattern.tool, arguments: value as Candidate["invocation"]["arguments"], scope: frame.scope };
      candidates.push({ schemaVersion: 1, id: hash({ pattern: pattern.id, invocation }), invocation,
        probability: (binding.examples / binding.total_examples) * pattern.successes / Math.max(1, pattern.successes + pattern.failures),
        bindings: [{ sourceId: "_binding_events", path: [] }], hop: 1, patternId: pattern.id });
    } catch { /* A missing current binding produces no candidate. */ }
  }
  return candidates;
}
export function contractSchema(name: string) {
  const definitions: Record<string, unknown> = {};
  function visit(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const reference = (value as { $ref?: string }).$ref;
    if (reference?.startsWith("#/$defs/")) {
      const target = reference.slice("#/$defs/".length);
      if (!Object.hasOwn(definitions, target)) {
        definitions[target] = (schema.$defs as Record<string, unknown>)[target];
        visit(definitions[target]);
      }
    }
    Object.values(value).forEach(visit);
  }
  const root = { $ref: `#/$defs/${name}` };
  visit(root);
  return { ...root, $defs: definitions };
}

export class ContractPredictors implements Predictors {
  private validators = new Map<string, ReturnType<Ajv2020["compile"]>>();
  constructor(private model: ModelPort, private embedding: (query: string) => Promise<number[]>,
    private tools: Record<string, Record<string, unknown>>, private allocation: Allocation,
    private maximumAttemptMicrodollars: number, private record: (metadata: unknown) => void,
    private binder: (frame: ExecutionFrame, records: Experience[]) => Candidate[] = bindWorkflowPatterns,
    private threshold = 0.8, private memoryHints?: (frame: ExecutionFrame) => string[]) {}
  embed(query: string) { return this.embedding(query); }
  bindPatterns(frame: ExecutionFrame, records: Experience[]) { return this.binder(frame, records); }
  calibrated(candidates: Candidate[]) { return candidates.some(c => c.probability >= this.threshold); }
  async inferGoals(frame: ExecutionFrame, relevantSourceIds: string[] = []): Promise<GoalSet> {
    try {
      return (await predictCompactGoals(this.model, frame, { allocation: this.allocation,
        maximumAttemptMicrodollars: this.maximumAttemptMicrodollars, record: this.record, relevantSourceIds })).goals;
    } catch (error) {
      if (!(error instanceof CompactGoalContractError)) throw error;
      return { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) };
    }
  }
  candidates(frame: ExecutionFrame, records: Experience[]): Promise<Candidate[]> {
    return predictCompactCandidates(this.model, frame, records, { tools: this.tools, allocation: this.allocation,
      maximumAttemptMicrodollars: this.maximumAttemptMicrodollars, countTokens, record: this.record,
      memoryHints: this.memoryHints?.(frame) });
  }
  validateArguments(candidate: Candidate, frame: ExecutionFrame): boolean {
    const parameters = this.tools[candidate.invocation.tool];
    if (!parameters || hash(candidate.invocation.scope) !== hash(frame.scope)) return false;
    try {
      let validate = this.validators.get(candidate.invocation.tool);
      if (!validate) { validate = new Ajv2020({ strict: false }).compile(parameters); this.validators.set(candidate.invocation.tool, validate); }
      if (!validate(candidate.invocation.arguments)) return false;
      const visible = new Set<string>();
      const referencedText: string[] = [];
      function collect(v: unknown) {
        visible.add(canonical(v));
        if (typeof v === "string") referencedText.push(v);
        if (v && typeof v === "object") Object.values(v).forEach(collect);
      }
      candidate.bindings.forEach(ref => collect(resolveSource(ref, frame.sources)));
      function grounded(v: unknown, s: Record<string, unknown>): boolean {
        if (visible.has(canonical(v))) return true;
        if (Object.hasOwn(s, "const") && canonical(v) === canonical(s.const)) return true;
        if (Array.isArray(s.enum) && s.enum.some(x => canonical(x) === canonical(v))) return true;
        if ((typeof v === "string" && v.length > 0 || typeof v === "number" && Number.isFinite(v))
          && referencedText.some(text => exactTextValue(text, String(v)))) return true;
        if (Array.isArray(v)) return v.every(x => grounded(x, (s.items ?? {}) as Record<string, unknown>));
        if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => grounded(x, ((s.properties ?? {}) as Record<string, Record<string, unknown>>)[k] ?? {}));
        // Constants remain conservative. Arbitrary historical scalar values never bind.
        return v === null || typeof v === "boolean";
      }
      return grounded(candidate.invocation.arguments, parameters);
    } catch { return false; }
  }
}
