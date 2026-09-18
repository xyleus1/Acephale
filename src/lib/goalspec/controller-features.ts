import { canonical } from "./canonical";
import type { Candidate, ExecutionFrame } from "./contracts/generated";
import type { CandidateFeatures, DecisionState } from "./contracts/v4-controller.generated";
export type { CandidateFeatures, DecisionState } from "./contracts/v4-controller.generated";

export const CONTROLLER_FEATURE_VERSION = "goalspec-controller-features-v1" as const;
export const CONTROLLER_GOAL_FEATURE_POLICY = "public-request-only" as const;
export const CONTROLLER_NUMERIC_FEATURES = ["bias", "boundary", "goalUnknown", "goalCount", "requirementCount", "sourceCount", "recentToolCount", "candidatePresent", "candidatePrior", "hop", "bindingCount", "argumentCount", "stringArgumentCount", "numericArgumentCount", "patternPresent", "toolPreviouslyObserved", "requestToolOverlap", "requestArgumentOverlap", "goalToolOverlap", "goalArgumentOverlap", "boundSourceFraction", "requirementCharacters", "visibleCharacters", "argumentCharacters"] as const;
export const CONTROLLER_HASH_BUCKETS = 192;
export const CONTROLLER_FEATURE_DIMENSION = CONTROLLER_NUMERIC_FEATURES.length + CONTROLLER_HASH_BUCKETS;
const cap = (n: number, scale: number) => Math.min(1, Math.max(0, n / scale));
export const featureTokens = (text: string): string[] => (text.toLowerCase().replace(/[^a-z0-9_]+/g, " ").slice(0, 16384).match(/[a-z0-9_]+/g) ?? []).slice(0, 512);
function fnv(text: string): number { let result = 2166136261; for (let i = 0; i < text.length; i++) result = Math.imul(result ^ text.charCodeAt(i), 16777619) >>> 0; return result; }
function overlap(left: string[], right: string[]) { const a = new Set(left), b = new Set(right); return b.size ? [...b].filter(t => a.has(t)).length / b.size : 0; }

/** Public-prefix inputs only. Neither future actions nor private evaluators enter these features. */
export function buildDecisionState(frame: ExecutionFrame): DecisionState {
  // Session policy is already enforced by server-owned eligibility. It is not
  // present in the Base training prefixes, so injected policy bytes must not
  // perturb source-count or visible-length features for the same public prefix.
  const learnedSources = Object.fromEntries(Object.entries(frame.sources).filter(([id]) => id !== "server_policy"));
  const requirements = Object.entries(learnedSources).filter(([id]) => /^(requirement:|request:|current_user_request$)/.test(id))
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })).map(([, value]) => typeof value === "string" ? value : canonical(value));
  const events = Array.isArray(learnedSources._binding_events) ? learnedSources._binding_events : [];
  const recentTools = events.flatMap(value => value && typeof value === "object" && !Array.isArray(value) && value.kind === "tool_result" && value.status === "success" && typeof value.tool === "string" ? [value.tool] : []).slice(-12);
  return { version: "goalspec-decision-state-v1", boundary: frame.boundary, requestedObjective: frame.requestedObjective,
    activeGoals: frame.goals.hypotheses.map(goal => [goal.objective, ...goal.constraints.map(c => c.text)].join(" ")),
    unresolvedRequirements: requirements, recentTools, sourceIds: Object.keys(learnedSources).sort(),
    visibleText: canonical(learnedSources), unknownGoal: frame.goals.unknown };
}

export function extractCandidateFeatures(state: DecisionState, candidate: Candidate | null): CandidateFeatures {
  const request = featureTokens(state.unresolvedRequirements.slice(-3).join(" ") || state.requestedObjective);
  // Base tapes have no inferred-goal supervision. Keep these slots neutral.
  const goals: string[] = [];
  const tool = featureTokens(candidate?.invocation.tool.replace(/_/g, " ") ?? "NO_READ");
  const argumentsText = candidate ? canonical(candidate.invocation.arguments) : "";
  const args = featureTokens(argumentsText), values = Object.values(candidate?.invocation.arguments ?? {});
  // Every training candidate had prior .86, hop 1 and no pattern ID. Preserve
  // those constants rather than assign meaning to unseen metadata variations.
  // Actual hops, scope and prerequisites remain enforced by the scheduler.
  const numeric = [1, cap(state.boundary, 40), 1, 0, cap(state.unresolvedRequirements.length, 12),
    cap(state.sourceIds.length, 64), cap(state.recentTools.length, 12), Number(candidate !== null), candidate ? .86 : 0, candidate ? .5 : 0,
    cap(candidate?.bindings.length ?? 0, 8), cap(values.length, 8), cap(values.filter(v => typeof v === "string").length, 8), cap(values.filter(v => typeof v === "number").length, 8),
    0, Number(!!candidate && state.recentTools.includes(candidate.invocation.tool)), overlap(request, tool), overlap(request, args), overlap(goals, tool), overlap(goals, args),
    candidate?.bindings.length ? candidate.bindings.filter(ref => state.sourceIds.includes(ref.sourceId)).length / candidate.bindings.length : 0,
    cap(state.unresolvedRequirements.join(" ").length, 4096), cap(state.visibleText.length, 32768), cap(argumentsText.length, 1024)];
  const hashed = Array.from({ length: CONTROLLER_HASH_BUCKETS }, () => 0);
  const tokens = [...request.map(t => `r:${t}`), ...goals.map(t => `g:${t}`), ...tool.map(t => `t:${t}`),
    ...state.recentTools.slice(-3).map(t => `p:${t}`), ...request.map(t => `x:${candidate?.invocation.tool ?? "NO_READ"}:${t}`),
    ...args.map(t => `a:${t}`)];
  for (const token of tokens) { const h = fnv(token); hashed[h % CONTROLLER_HASH_BUCKETS] += (h & 0x80000000) ? -1 : 1; }
  const norm = Math.sqrt(hashed.reduce((sum, value) => sum + value * value, 0)) || 1;
  return { version: CONTROLLER_FEATURE_VERSION, candidateId: candidate?.id ?? "NO_READ", values: [...numeric, ...hashed.map(value => value / norm)] };
}
