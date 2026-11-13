import { copy, hash } from "./canonical";
import { NEXT_BATCH_MEMBERSHIP } from "./score-semantics";
import type { Candidate, ExecutionFrame, GoalSet, Invocation, SourceRef } from "./contracts/generated";
import { validateContract } from "./contracts/validate";
import { resolveSource, validateGoals } from "./compiler";
import { SpeculationScheduler, type Observation } from "./scheduler";

export interface InfraOpportunity {
  toolMs: number;
  actorLeadMs: number;
  predictionMs: number;
  schedulingMs: number;
  validationMs: number;
  contentionMs: number;
}
export function expectedInfraSaving(probability: number, estimate: InfraOpportunity): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1
    || Object.values(estimate).some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error("Invalid measured opportunity");
  }
  const overlap = Math.min(estimate.toolMs, Math.max(0, estimate.actorLeadMs - estimate.predictionMs - estimate.schedulingMs));
  return probability * overlap - estimate.validationMs - estimate.schedulingMs - estimate.contentionMs;
}
export type InfraDecision = {
  action: "READ" | "NO_READ" | "READ_UNCOVERED";
  scores: { candidateId: string; probability: number }[];
};
export function mixInfraDecisions(neutral: InfraDecision, conditional: InfraDecision, reliability: number): InfraDecision {
  if (!Number.isFinite(reliability) || reliability < 0 || reliability > 1) throw new Error("Invalid goal reliability");
  const weights = new Map<string, number>();
  for (const [decision, weight] of [[neutral, 1 - reliability], [conditional, reliability]] as const) {
    for (const score of decision.scores) weights.set(score.candidateId, (weights.get(score.candidateId) ?? 0) + score.probability * weight);
  }
  const scores = [...weights]
    .map(([candidateId, probability]) => ({ candidateId, probability })).sort((a, b) => b.probability - a.probability || a.candidateId.localeCompare(b.candidateId));
  // Legacy offline diagnostic only. Runtime dispatches one condition, never this two-call mixture.
  return { action: reliability > 0.5 ? conditional.action : neutral.action, scores };
}
export interface InfraSessionPolicy {
  arm: "base" | "neutral_memory_prefetch" | "acephale";
  memoryHash: string;
  opportunity(frame: ExecutionFrame): InfraOpportunity;
  candidates(frame: ExecutionFrame): Candidate[] | Promise<Candidate[]>;
  validateBinding(candidate: Candidate, frame: ExecutionFrame): boolean;
  rank(frame: ExecutionFrame, candidates: Candidate[], goals: GoalSet, signal: AbortSignal, getLatestGoals?: () => GoalSet): Promise<InfraDecision>;
  inferGoals?(frame: ExecutionFrame, signal: AbortSignal): Promise<GoalSet>;
  goalReliability: number;
  relevantGoalEvidence?(frame: ExecutionFrame): unknown;
}
export type InfraRecord = (event: Record<string, unknown>) => void;
const unknownGoals = (): GoalSet => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) });
type GoalDependency = { source: SourceRef; valueHash: string };
function goalDependencies(goals: GoalSet, frame: ExecutionFrame): GoalDependency[] {
  const references = goals.hypotheses.flatMap(goal => [...goal.sources, ...goal.constraints.flatMap(constraint => constraint.sources)]);
  return [...new Map(references.map(source => [hash(source), source])).values()]
    .map(source => ({ source: copy(source), valueHash: hash(resolveSource(source, frame.sources)) }));
}
function sameGoalSources(dependencies: GoalDependency[], frame: ExecutionFrame): boolean {
  try { return dependencies.every(({ source, valueHash }) => hash(resolveSource(source, frame.sources)) === valueHash); }
  catch { return false; }
}

/** A lossless execution profile. No method produces actor prompt additions. */
export class InfraSession {
  private latest?: ExecutionFrame;
  private revision = "";
  private goalRevision = "";
  private goals = unknownGoals();
  private goalDependencies: GoalDependency[] = [];
  private serial = 0;
  private closed = false;
  private tasks = new Set<Promise<void>>();
  private controllers = new Set<AbortController>();
  private goalTask?: { revision: string; controller: AbortController; task: Promise<void> };
  private pendingInvalidation: Promise<void> = Promise.resolve();
  private pendingPrediction?: AbortController;
  private dependencies = new Map<string, { candidate: Candidate; values: string[] }>();
  constructor(readonly scheduler: SpeculationScheduler, private policy: InfraSessionPolicy, private record: InfraRecord = () => {}) {
    if (!/^[a-f0-9]{64}$/.test(policy.memoryHash) || !Number.isFinite(policy.goalReliability)
      || policy.goalReliability < 0 || policy.goalReliability > 1) throw new Error("Invalid infrastructure policy");
  }
  private track(task: Promise<void>) {
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
    return task;
  }
  /** Returns immediately. The actor request must be dispatched without awaiting prediction. */
  observe(input: ExecutionFrame): void {
    if (this.closed) throw new Error("Infrastructure run closed");
    validateContract("ExecutionFrame", input);
    const frame = copy({ ...input, goals: unknownGoals() });
    this.latest = frame;
    const serial = ++this.serial;
    this.pendingPrediction?.abort();
    const revision = hash({ request: frame.requestedObjective, policy: frame.policy, scope: frame.scope, snapshot: frame.snapshotId });
    if (this.revision && revision !== this.revision) {
      this.pendingInvalidation = this.scheduler.invalidate("infra_requirements_changed");
      this.dependencies.clear();
    } else {
      const changed = [...this.dependencies].filter(([, item]) => {
        try { return !this.policy.validateBinding(item.candidate, frame) || item.candidate.bindings.some((ref, index) => hash(resolveSource(ref, frame.sources)) !== item.values[index]); }
        catch { return true; }
      }).map(([key]) => key);
      if (changed.length) {
        this.pendingInvalidation = Promise.all([this.pendingInvalidation, this.scheduler.invalidateKeys(changed, "infra_binding_changed")]).then(() => {});
        changed.forEach(key => this.dependencies.delete(key));
      }
    }
    this.revision = revision;
    this.record({ type: "infra_checkpoint", runId: frame.runId, checkpoint: frame.boundary, frameHash: hash(frame), memoryHash: this.policy.memoryHash, arm: this.policy.arm });
    const goalRevision = hash({ revision, relevant: this.policy.relevantGoalEvidence?.(frame) ?? null });
    if (goalRevision !== this.goalRevision || !sameGoalSources(this.goalDependencies, frame)) {
      this.goalTask?.controller.abort(); this.goals = unknownGoals(); this.goalDependencies = []; this.goalRevision = "";
    }
    if (this.policy.arm === "base") return;
    const opportunity = this.policy.opportunity(frame);
    // Even a perfect predictor must have a positive measured opportunity before retrieval or model calls.
    if (expectedInfraSaving(1, opportunity) <= 0) {
      this.record({ type: "infra_opportunity_rejected", runId: frame.runId, checkpoint: frame.boundary, estimate: opportunity });
      return;
    }
    if (goalRevision !== this.goalRevision) {
      this.goalRevision = goalRevision;
      if (this.policy.arm === "acephale" && this.policy.inferGoals && this.policy.goalReliability > 0) this.startGoals(frame, goalRevision);
    }
    const controller = new AbortController();
    this.pendingPrediction = controller; this.controllers.add(controller);
    this.track(this.predict(frame, serial, controller).catch(error => {
      this.record({ type: "infra_prediction_failed", runId: frame.runId, checkpoint: frame.boundary, errorType: error instanceof Error ? error.name : "Error", cancelled: controller.signal.aborted });
    }).finally(() => { this.controllers.delete(controller); if (this.pendingPrediction === controller) this.pendingPrediction = undefined; }));
  }
  private startGoals(frame: ExecutionFrame, revision: string) {
    const controller = new AbortController(); this.controllers.add(controller);
    const task = this.track(Promise.resolve().then(() => this.policy.inferGoals!(copy(frame), controller.signal)).then(goals => {
      validateGoals(goals, frame.sources);
      if (!this.closed && !controller.signal.aborted && revision === this.goalRevision) {
        const dependencies = goalDependencies(goals, frame);
        if (!this.latest || !sameGoalSources(dependencies, this.latest)) {
          this.goals = unknownGoals(); this.goalDependencies = []; this.goalRevision = "";
          this.record({ type: "infra_goals_stale", runId: frame.runId, checkpoint: frame.boundary, revision, reason: "referenced_source_changed" });
          // Inference can finish after a newer public checkpoint. Refresh from
          // that checkpoint without installing or exposing the stale result.
          if (this.latest && expectedInfraSaving(1, this.policy.opportunity(this.latest)) > 0) {
            this.goalRevision = revision; this.startGoals(copy(this.latest), revision);
          }
          return;
        }
        this.goals = copy(goals);
        this.goalDependencies = dependencies;
        this.record({ type: "infra_goals_ready", runId: frame.runId, checkpoint: frame.boundary, revision, goals: copy(goals), reliability: this.policy.goalReliability });
      }
    }).catch(error => this.record({ type: "infra_goals_failed", runId: frame.runId, checkpoint: frame.boundary, revision, errorType: error instanceof Error ? error.name : "Error" }))
      .finally(() => { this.controllers.delete(controller); if (this.goalTask?.controller === controller) this.goalTask = undefined; }));
    this.goalTask = { revision, controller, task };
  }
  private async predict(frame: ExecutionFrame, serial: number, controller: AbortController) {
    const started = performance.now();
    const current = () => !this.closed && !controller.signal.aborted && serial === this.serial;
    await this.pendingInvalidation;
    if (!current()) return;
    const generation = this.scheduler.generation;
    const proposed = await this.policy.candidates(copy(frame));
    if (!current() || generation !== this.scheduler.generation) return;
    const unique = new Map<string, Candidate>();
    for (const raw of proposed) {
      try {
        validateContract("Candidate", raw);
        if (raw.hop !== 1 || hash(raw.invocation.scope) !== hash(frame.scope)
          || !this.policy.validateBinding(raw, frame) || !this.scheduler.eligible(raw.invocation)) continue;
        raw.bindings.forEach(ref => resolveSource(ref, frame.sources));
        const key = hash(raw.invocation);
        if (!unique.has(key) && unique.size < 128) unique.set(key, copy(raw));
      } catch { /* A malformed proposal never reaches scheduling. */ }
    }
    const candidates = [...unique.values()];
    let goalView = unknownGoals();
    const latestGoals = () => {
      if (!current()) throw new Error("Stale prediction dispatch");
      goalView = this.policy.arm === "acephale" && this.policy.goalReliability > 0 && sameGoalSources(this.goalDependencies, frame)
        ? copy(this.goals) : unknownGoals();
      validateGoals(goalView, frame.sources);
      return copy(goalView);
    };
    const validateDecision = (decision: InfraDecision) => {
      if (!["READ", "NO_READ", "READ_UNCOVERED"].includes(decision.action) || !Array.isArray(decision.scores)
      || decision.scores.length > 3 || new Set(decision.scores.map(score => score.candidateId)).size !== decision.scores.length
      || decision.scores.some(score => !candidates.some(candidate => candidate.id === score.candidateId)
        || !Number.isFinite(score.probability) || score.probability < 0 || score.probability > 1)) throw new Error("Invalid candidate ranking");
    };
    const decision = await this.policy.rank(copy(frame), copy(candidates), latestGoals(), controller.signal, latestGoals);
    validateDecision(decision);
    if (!current() || generation !== this.scheduler.generation) return;
    this.record({ type: "infra_ranking", runId: frame.runId, checkpoint: frame.boundary, boundary: frame.boundary, frameHash: hash(frame),
      poolHash: hash(candidates), candidatePool: candidates, scoreSemanticsVersion: 3, probabilitySemantics: NEXT_BATCH_MEMBERSHIP,
      decision, goalsHash: hash(goalView), rankingMs: performance.now() - started, arm: this.policy.arm });
    if (decision.action !== "READ") return;
    const measured = this.policy.opportunity(frame);
    measured.predictionMs = Math.max(measured.predictionMs, performance.now() - started);
    for (const score of [...decision.scores].sort((a, b) => b.probability - a.probability || a.candidateId.localeCompare(b.candidateId)).slice(0, 3)) {
      const candidate = candidates.find(item => item.id === score.candidateId)!;
      const savingMs = expectedInfraSaving(score.probability, measured);
      const admitted = savingMs > 0 ? this.scheduler.admit([{ ...candidate, probability: score.probability }]) : [];
      for (const key of admitted) this.dependencies.set(key, { candidate, values: candidate.bindings.map(ref => hash(resolveSource(ref, frame.sources))) });
      this.record({ type: "infra_admission", runId: frame.runId, checkpoint: frame.boundary, frameHash: hash(frame), candidateId: candidate.id, savingMs, admitted: admitted.length > 0 });
    }
  }
  authoritative(invocation: Invocation, execute: () => Promise<Observation>) { return this.scheduler.authoritative(invocation, execute); }
  promoteOnly(invocation: Invocation) { return this.scheduler.promoteOnly(invocation); }
  async mutationBatch<T>(execute: () => Promise<T>): Promise<T> {
    this.serial++; this.controllers.forEach(controller => controller.abort()); this.dependencies.clear();
    this.goalRevision = ""; this.goals = unknownGoals(); this.goalDependencies = [];
    return this.scheduler.mutationBatch(execute);
  }
  async settled() { while (this.tasks.size) await Promise.allSettled([...this.tasks]); }
  async close() {
    this.closed = true; this.serial++; this.controllers.forEach(controller => controller.abort());
    this.goalDependencies = []; this.goals = unknownGoals();
    const close = this.scheduler.close();
    await this.settled(); await this.pendingInvalidation; await close;
  }
}
