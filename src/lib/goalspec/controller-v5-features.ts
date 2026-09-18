import { canonical, copy, hash } from "./canonical";
import { resolveSource, validateGoals } from "./compiler";
import type { Candidate, ExecutionFrame, GoalSet } from "./contracts/generated";
import { buildDecisionState, featureTokens, type DecisionState } from "./controller-features";
import type { ContextualMemoryRetrieval } from "./experience-memory";
import type { GoalState } from "./goal-state";
import type { Experience } from "./repository";

export const V5_FEATURE_VERSION = "goalspec-controller-features-v5.1" as const;
export const V5_NEUTRAL_DIMENSION = 120;
export const V5_GOAL_DIMENSION = 72;
export type V5Sentinel = "NO_READ" | "READ_UNCOVERED";
export interface SpeculationContext {
  version: "goalspec-speculation-context-v5";
  frame: ExecutionFrame;
  publicInputHash: string;
  requestRevisionHash: string;
  goals: { set: GoalSet; sourceRevisionHash: string; grounded: boolean; kind: "inferred" | "literal-proxy"; rejection: string | null };
  memory: ContextualMemoryRetrieval | null;
  workflows: Experience[];
}
export interface V5Features { neutral: number[]; goal: number[] }
export function publicRevision(frame: ExecutionFrame): string {
  return hash({ scope: frame.scope, policy: frame.policy, snapshotId: frame.snapshotId,
    objective: frame.requestedObjective, sources: Object.fromEntries(Object.entries(frame.sources)
      .filter(([id]) => /^(requirement:|request:|current_user_request$|clock|current_date$|current_time$|today$|timezone$|date_context$)/.test(id))) });
}
export function buildSpeculationContext(frame: ExecutionFrame, options: { goalState?: GoalState; memory?: ContextualMemoryRetrieval;
  workflows?: Experience[]; goals?: GoalSet; sourceRevisionHash?: string; goalKind?: "inferred" | "literal-proxy" } = {}): SpeculationContext {
  const revision = publicRevision(frame), state = options.goalState;
  const goals = copy(options.goals ?? state?.goals ?? frame.goals);
  const sourceRevisionHash = options.sourceRevisionHash ?? (state && state.inferenceRevisionHash === state.revisionHash ? revision : "");
  let rejection: string | null = null;
  try {
    validateGoals(goals, frame.sources);
    if (sourceRevisionHash !== revision) throw new Error("stale_goal_revision");
    if (!goals.hypotheses.length) throw new Error("unknown_goal");
    for (const goal of goals.hypotheses) for (const ref of [...goal.sources, ...goal.constraints.flatMap(item => item.sources)]) {
      if (!/^(requirement:|request:|current_user_request$)/.test(ref.sourceId) || resolveSource(ref, frame.sources) === undefined) throw new Error("unsupported_goal_source");
    }
    if (state && (state.runId !== frame.runId || state.scopeHash !== hash(frame.scope) || state.snapshotId !== frame.snapshotId)) throw new Error("goal_scope_mismatch");
  } catch (error) { rejection = error instanceof Error ? error.message : "invalid_goals"; }
  const { goals: _ignoredGoals, ...publicFrame } = frame;
  return { version: "goalspec-speculation-context-v5", frame: copy(frame),
    publicInputHash: hash(publicFrame), requestRevisionHash: revision,
    goals: { set: goals, sourceRevisionHash, grounded: rejection === null, kind: options.goalKind ?? "inferred", rejection },
    memory: options.memory ? copy(options.memory) : null, workflows: copy(options.workflows ?? []) };
}
const cap = (value: number, scale: number) => Math.min(1, Math.max(0, value / scale));
function overlap(a: string[], b: string[]) { const left = new Set(a), right = new Set(b); return right.size ? [...right].filter(t => left.has(t)).length / right.size : 0; }
function hashed(tokens: string[], buckets: number) {
  const result = Array.from({ length: buckets }, () => 0);
  for (const token of tokens) {
    let value = 2166136261;
    for (let i = 0; i < token.length; i++) value = Math.imul(value ^ token.charCodeAt(i), 16777619) >>> 0;
    result[value % buckets] += value & 0x80000000 ? -1 : 1;
  }
  const norm = Math.sqrt(result.reduce((sum, n) => sum + n * n, 0)) || 1;
  return result.map(n => n / norm);
}
/** No historical entity value becomes an argument. Full episode observations,
 * binding provenance, transitions and confusions contribute descriptive features. */
export function extractV5Features(context: SpeculationContext, candidate: Candidate | V5Sentinel, preparedState?: DecisionState): V5Features {
  const state = preparedState ?? buildDecisionState(context.frame), present = typeof candidate !== "string";
  const toolName = present ? candidate.invocation.tool : candidate;
  const tool = featureTokens(toolName.replace(/_/g, " "));
  const request = featureTokens(state.unresolvedRequirements.slice(-3).join(" ") || state.requestedObjective);
  const argsText = present ? canonical(candidate.invocation.arguments) : "";
  const args = featureTokens(argsText), values = present ? Object.values(candidate.invocation.arguments) : [];
  const transitions = context.memory?.transitions.filter(row => row.to === toolName) ?? [];
  const confusions = context.memory?.confusions ?? [];
  const episodes = context.memory?.episodes ?? [];
  const matching = episodes.filter(item => item.episode.nextActions.some(action => action.tool === toolName));
  const provenance = matching.flatMap(item => item.episode.argumentSources);
  const observations = matching.flatMap(item => item.episode.resultingObservations);
  const successes = transitions.reduce((n, row) => n + row.successes, 0);
  const total = transitions.reduce((n, row) => n + row.successes + row.failures, 0);
  const neutral = [1, Number(present), Number(candidate === "NO_READ"), Number(candidate === "READ_UNCOVERED"),
    cap(state.boundary, 40), cap(state.unresolvedRequirements.length, 12), cap(state.recentTools.length, 12),
    cap(present ? candidate.bindings.length : 0, 8), cap(values.length, 8), overlap(request, tool), overlap(request, args),
    Number(state.recentTools.includes(toolName)), cap(state.visibleText.length, 32768), cap(argsText.length, 1024),
    transitions.reduce((n, row) => n + row.confidence, 0), total ? successes / total : 0,
    cap(confusions.filter(row => row.actualTool === toolName).reduce((n, row) => n + row.count, 0), 10),
    cap(confusions.filter(row => row.predictedTool === toolName).reduce((n, row) => n + row.count, 0), 10),
    cap(matching.length, 4), matching.reduce((n, row) => n + row.similarity, 0) / Math.max(1, matching.length),
    provenance.length ? provenance.filter(row => row.sources.length > 0).length / provenance.length : 0,
    cap(observations.length, 8), cap(context.workflows.length, 12), cap(episodes.length, 4)];
  const goalWords = context.goals.grounded ? featureTokens(context.goals.set.hypotheses.map(goal =>
    [goal.objective, ...goal.constraints.map(item => item.text)].join(" ")).join(" ")) : [];
  const goalNumeric = [Number(context.goals.grounded), Number(present), Number(candidate === "NO_READ"), Number(candidate === "READ_UNCOVERED"),
    overlap(goalWords, tool), overlap(goalWords, args), overlap(goalWords, request), cap(goalWords.length, 100)];
  return { neutral: [...neutral, ...hashed([...request.map(t => `r:${t}`), ...tool.map(t => `t:${t}`),
    ...state.recentTools.slice(-3).map(t => `p:${t}`), ...request.map(t => `x:${toolName}:${t}`), ...args.map(t => `a:${t}`)], 96)],
    goal: [...goalNumeric, ...hashed([...goalWords.map(t => `g:${t}`), ...goalWords.map(t => `x:${toolName}:${t}`)], 64)] };
}
