import { copy, hash } from "./canonical";
import { actorEvidence, resolveSource, validateGoals } from "./compiler";
import type { Candidate, EvidenceEnvelope, ExecutionFrame, GoalSet } from "./contracts/generated";
import { validateContract } from "./contracts/validate";
import { buildDecisionState } from "./controller-features";
import { LocalController } from "./controller";
import type { LocalActionKindController } from "./controller-action-kind";
import { buildGoalState, updateGoalState, goalStateContext, type GoalState } from "./goal-state";
import { addEvidenceSources } from "./evidence-sources";
import type { ExperienceRepository } from "./repository";
import { SpeculationScheduler, type EvidenceSelection } from "./scheduler";
import type { Predictors } from "./session";

export interface V4SessionPolicy {
  controller?: LocalController;
  actionKind?: LocalActionKindController;
  inferGoals: boolean;
  exposeEvidence: boolean;
  query(frame: ExecutionFrame): string;
  bindCurrent(frame: ExecutionFrame): Candidate[];
  validateCurrent?(candidate: Candidate, frame: ExecutionFrame): boolean;
  nonMutating(invocation: Candidate["invocation"]): boolean;
  inferState?(previous: GoalState, frame: ExecutionFrame): Promise<GoalState>;
  estimate: { toolMs: number; validationMs: number; schedulingMs: number; predictionMs: number;
    contentionMs: number; contextMs: number; measuredExposureBenefitMs: number };
  // An explicitly bounded development experiment, never a production default.
  experiment?: { seed: string; exposureProbability: number; maximumStarts: number; waitMs?: number };
  countTokens(text: string): number;
}
type Dependency = { candidate: Candidate; values: string[] };
const emptyGoals = (): GoalSet => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) });
const optionalEvidenceContext = (evidence: Pick<EvidenceEnvelope, "invocation" | "observation">[]) => evidence.length ? "\n\n" + actorEvidence(emptyGoals(), evidence, true) : "";

/** Shared controller composition for native research and Derya. Remote goal
 * updates are managed background work; actor boundaries never await them. */
export class GoalSpecSessionV4 {
  private state?: GoalState;
  private latest?: ExecutionFrame;
  private latestGeneration?: number;
  private task?: Promise<void>;
  private finishedRevision?: string;
  private closedV4 = false;
  private closePromise?: Promise<void>;
  private cycles = 0;
  private boundaryRevision = 0;
  private experimentalStarts = 0;
  private dependencies = new Map<string, Dependency>();
  private exposureScores = new Map<string, number>();
  private exposureAllowed = new Set<string>();
  private exposureAssignments = new Map<string, boolean>();
  constructor(private repository: ExperienceRepository, private predictors: Predictors,
    readonly scheduler: SpeculationScheduler, private record: (event: unknown) => void,
    private policy: V4SessionPolicy) {
    if (Object.values(policy.estimate).some(value => !Number.isFinite(value) || value < 0)) throw new Error("Invalid v4 utility estimate");
    const e = policy.experiment;
    if (e && (!e.seed || !Number.isFinite(e.exposureProbability) || e.exposureProbability <= 0 || e.exposureProbability >= 1
      || !Number.isInteger(e.maximumStarts) || e.maximumStarts < 0 || e.maximumStarts > 12 || !policy.exposeEvidence
      || (e.waitMs !== undefined && (!Number.isFinite(e.waitMs) || e.waitMs < 0 || e.waitMs > 250)))) throw new Error("Invalid v4 exposure experiment");
  }
  async boundary(input: ExecutionFrame, _relevantSourceIds: string[]) {
    if (this.closedV4) throw new Error("GoalSpec session closed");
    validateContract("ExecutionFrame", input);
    const revision = ++this.boundaryRevision;
    const frame = copy(input);
    const superseded = () => this.closedV4 || revision !== this.boundaryRevision;
    const withheld = () => ({ frame, evidence: [] as EvidenceEnvelope[], actorContext: "" });
    frame.sources.server_policy = frame.policy;
    const prior = this.latest;
    const hardChange = prior && (hash(prior.scope) !== hash(frame.scope) || prior.snapshotId !== frame.snapshotId || prior.policy !== frame.policy);
    if (hardChange) {
      const nextGeneration = this.scheduler.generation + 1;
      await this.scheduler.invalidate("scope_policy_or_snapshot_changed");
      if (superseded() || this.scheduler.generation !== nextGeneration) return withheld();
      this.dependencies.clear(); this.exposureScores.clear(); this.exposureAllowed.clear(); this.state = undefined;
    }
    const beforeRevision = this.state?.revisionHash;
    this.state = this.state ? updateGoalState(this.state, frame, this.state.goals) : buildGoalState(frame, emptyGoals());
    if (beforeRevision && beforeRevision !== this.state.revisionHash) {
      const nextGeneration = this.scheduler.generation + 1;
      await this.scheduler.invalidate("requirements_changed");
      if (superseded() || this.scheduler.generation !== nextGeneration) return withheld();
      this.dependencies.clear(); this.exposureScores.clear(); this.exposureAllowed.clear();
    } else {
      const generation = this.scheduler.generation;
      const changed = [...this.dependencies].filter(([, dependency]) => !this.currentDependencies(dependency, frame)
        || !this.scheduler.eligible(dependency.candidate.invocation)).map(([key]) => key);
      await this.scheduler.invalidateKeys(changed, "binding_dependency_changed");
      if (superseded() || this.scheduler.generation !== generation) return withheld();
      for (const key of changed) { this.dependencies.delete(key); this.exposureScores.delete(key); this.exposureAllowed.delete(key); }
    }
    frame.goals = copy(this.state.goals);
    validateGoals(frame.goals, frame.sources);
    this.latest = copy(frame);
    this.latestGeneration = this.scheduler.generation;
    const generation = this.scheduler.generation, latest = this.latest;
    const current = () => !superseded() && this.scheduler.generation === generation && this.latest === latest;
    this.record({ type: "execution_frame", runtimeVersion: "goalspec-v4", frame: copy(frame) });
    const admitted = this.propose(frame), waitMs = this.policy.experiment?.waitMs ?? 0;
    // Development can give newly admitted local reads a bounded head start.
    // Both exposure assignments wait identically; remote predictors never join.
    if (waitMs > 0 && admitted.length) {
      const started = performance.now();
      await this.scheduler.waitForReads(admitted, waitMs);
      this.record({ type: "experimental_read_head_start", boundary: frame.boundary, maximumMs: waitMs,
        latencyMs: performance.now() - started, admittedKeys: admitted, assignmentIndependent: true });
    }
    if (!current()) return withheld();
    const evidence = this.policy.exposeEvidence ? await this.scheduler.evidenceAtBoundary(2, this.selection(current)) : [];
    if (!current()) return withheld();
    if (evidence.length) {
      addEvidenceSources(frame, evidence);
      this.state = updateGoalState(this.state, frame, this.state.goals);
      this.latest = copy(frame);
      this.propose(frame, 2);
    }
    this.startGoals();
    frame.goals = copy(this.state.goals);
    this.record({ type: "decision_context", frame: copy(frame), evidence: copy(evidence), predictionPending: !!this.task,
      goalState: copy(this.state), optionalEvidenceTokenBudget: 512 });
    // Requested constraints remain separate from the optional evidence budget.
    const actorContext = this.policy.exposeEvidence ? goalStateContext(this.state) + optionalEvidenceContext(evidence) : "";
    return { frame, evidence, actorContext };
  }
  private currentDependencies(dependency: Dependency, frame: ExecutionFrame) {
    try { return dependency.candidate.bindings.every((ref, index) => hash(resolveSource(ref, frame.sources)) === dependency.values[index]); }
    catch { return false; }
  }
  private valid(candidate: Candidate, frame: ExecutionFrame) {
    try {
      validateContract("Candidate", candidate);
      return hash(candidate.invocation.scope) === hash(frame.scope) && candidate.bindings.every(ref => resolveSource(ref, frame.sources) !== undefined)
        && (this.policy.validateCurrent?.(candidate, frame) || this.predictors.validateArguments(candidate, frame));
    } catch { return false; }
  }
  private observed(candidate: Candidate, frame: ExecutionFrame) {
    const raw = frame.sources._binding_events;
    if (!Array.isArray(raw)) return false;
    const events = raw.filter((value): value is Record<string, import("./contracts/generated").Json> => !!value && typeof value === "object" && !Array.isArray(value));
    const success = new Set(events.filter(event => event.kind === "tool_result" && event.status === "success").map(event => event.call_id));
    for (const event of [...events].reverse()) {
      if (event.kind !== "tool_request") continue;
      const invocation = { tool: event.tool, arguments: event.arguments, scope: frame.scope } as Candidate["invocation"];
      if (!this.policy.nonMutating(invocation)) break;
      if (success.has(event.call_id) && hash(invocation) === hash(candidate.invocation)) return true;
    }
    return false;
  }
  private propose(frame: ExecutionFrame, hop = 1) {
    const records = this.repository.retrieveLocal?.(frame, this.policy.query(frame), 12) ?? [];
    const unique = new Map<string, Candidate>();
    for (const raw of [...this.policy.bindCurrent(frame), ...this.predictors.bindPatterns(frame, records)]) {
      const candidate = { ...raw, hop };
      if (!this.valid(candidate, frame) || !this.scheduler.eligible(candidate.invocation) || this.observed(candidate, frame)) continue;
      const key = hash(candidate.invocation);
      if (!unique.has(key) && unique.size < 32) unique.set(key, candidate);
    }
    const candidates = [...unique.values()], decisionState = buildDecisionState(frame), visibleInputHash = hash(frame);
    if (this.policy.actionKind) this.record({ type: "controller_action_kind", boundary: frame.boundary,
      scores: this.policy.actionKind.score(decisionState), telemetryOnly: true });
    // The local artifact was trained from public request prefixes. Generated
    // unresolved-fact text must not replace those same runtime input features.
    const decision = this.policy.controller?.decide(decisionState, candidates);
    const elapsedMs = decision?.scores.elapsedMs;
    this.record({ type: "controller_decision", boundary: frame.boundary, visibleInputHash,
      ...(typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && elapsedMs >= 0 ? { latencyMs: elapsedMs, latencySource: "controller_scores_elapsed_ms" } : {}),
      candidatePool: candidates, decision: decision ?? { action: "NO_READ", reason: "controller_artifact_unavailable" } });
    if (!decision) return [];
    const admitted: string[] = [];
    const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
    const experiment = this.policy.experiment;
    // Optional development exploration covers the controller's false negatives
    // too. Selection is deterministic within the current policy-eligible pool;
    // only subsequent exposure is randomized, with its conditional propensity.
    const experimentalIds = experiment ? [...decision.scores.candidates].sort((a, b) =>
      (b.nextAction + b.usefulWithin2) - (a.nextAction + a.usefulWithin2) || a.candidateId.localeCompare(b.candidateId)).map(score => score.candidateId) : [];
    const rankedIds = [...new Set([...decision.rankedCandidateIds, ...experimentalIds])].slice(0, 3);
    const eligiblePoolHash = hash(candidates.map(candidate => ({ id: candidate.id, invocation: candidate.invocation, bindings: candidate.bindings })));
    for (const id of rankedIds) {
      const candidate = byId.get(id), score = decision.scores.candidates.find(item => item.candidateId === id);
      if (!candidate || !score) continue;
      const key = hash(candidate.invocation), estimate = this.policy.estimate;
      this.exposureScores.set(key, score.exposure ?? 0);
      if (decision.exposeCandidateIds.includes(id)) this.exposureAllowed.add(key); else this.exposureAllowed.delete(key);
      const saving = score.nextAction * score.readiness * estimate.toolMs
        + (this.policy.exposeEvidence ? (score.exposure ?? 0) * estimate.measuredExposureBenefitMs : 0)
        - estimate.validationMs - estimate.schedulingMs - estimate.predictionMs - estimate.contentionMs - estimate.contextMs;
      const exploratory = !!experiment && this.experimentalStarts < experiment.maximumStarts && !this.dependencies.has(key);
      const measuredUtility = decision.action === "read" && decision.rankedCandidateIds.includes(id) && saving > 0;
      const permitted = measuredUtility || exploratory;
      const keys = permitted ? this.scheduler.admit([{ ...candidate, probability: score.nextAction }]) : [];
      if (keys.length) {
        admitted.push(...keys);
        if (exploratory) this.experimentalStarts++;
        this.dependencies.set(key, { candidate, values: candidate.bindings.map(ref => hash(resolveSource(ref, frame.sources))) });
        if (exploratory && experiment && !this.exposureAssignments.has(key)) {
          const uniform = parseInt(hash([experiment.seed, frame.runId, key]).slice(0, 13), 16) / 0x10000000000000;
          const expose = uniform < experiment.exposureProbability;
          this.exposureAssignments.set(key, expose);
          this.record({ type: "exposure_assignment", key, boundary: frame.boundary, expose,
            propensity: experiment.exposureProbability, assignedGroupProbability: expose ? experiment.exposureProbability : 1 - experiment.exposureProbability,
            randomizedUnit: "run_invocation", seedHash: hash(experiment.seed), eligiblePoolHash,
            admissionSelection: "deterministic_rank_within_current_policy_eligible_pool", controllerAction: decision.action,
            appliesTo: "exposure_if_ready_valid_and_within_context_budget", outcomeAnalysis: "assignment_intent_to_treat" });
        }
      }
      this.record({ type: "candidate_prediction", boundary: frame.boundary, visibleInputHash, candidate: copy(candidate),
        admission: !!keys.length, expectedSavingMs: saving, reason: keys.length ? measuredUtility ? "measured_utility" : "bounded_development_experiment" : "abstained_or_nonpositive_utility" });
    }
    return admitted;
  }
  private selection(current: () => boolean): EvidenceSelection {
    const accepted: EvidenceEnvelope[] = [];
    const seen = new Set<string>();
    return {
      rank: ready => (current() ? ready : []).filter(job => this.exposureAssignments.has(job.key) ? this.exposureAssignments.get(job.key)
        : this.exposureAllowed.has(job.key))
        .sort((a, b) => (this.exposureScores.get(b.key) ?? 0) - (this.exposureScores.get(a.key) ?? 0) || b.observedAt - a.observedAt || a.key.localeCompare(b.key))
        .filter(job => {
          // An oversized previous observation is conservatively withheld before
          // an expensive full-query validation. Exact authoritative promotion
          // remains available; any selected observation still requires validation.
          const size = this.policy.countTokens(optionalEvidenceContext([job]));
          if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid evidence token count");
          if (size <= 512) return true;
          this.record({ type: "evidence_withheld", key: job.key, reason: "optional_token_budget", stage: "before_validation", tokens: size });
          return false;
        })
        .map(job => job.key),
      accept: (evidence: EvidenceEnvelope) => {
        if (!current()) return false;
        // Count the exact actor-visible block, including its explanation and
        // separators, as one serialization. Identical observations from distinct
        // invocations are not redundant (two different empty searches, for example).
        const size = this.policy.countTokens(optionalEvidenceContext([...accepted, evidence]));
        const evidenceKey = hash({ invocation: evidence.invocation, observationHash: evidence.observationHash });
        if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid evidence token count");
        if (seen.has(evidenceKey) || size > 512) {
          this.record({ type: "evidence_withheld", id: evidence.id, reason: seen.has(evidenceKey) ? "redundant" : "optional_token_budget", tokens: size });
          return false;
        }
        accepted.push(evidence); seen.add(evidenceKey); return true;
      },
    };
  }
  private startGoals() {
    if (!this.policy.inferGoals || this.closedV4 || this.task || !this.latest || !this.state || this.cycles >= 12
      || this.latestGeneration !== this.scheduler.generation
      || this.finishedRevision === this.state.revisionHash) return;
    const frame = copy(this.latest), state = copy(this.state), generation = this.scheduler.generation;
    this.cycles++;
    const started = Date.now();
    let finished = false;
    this.record({ type: "prediction_cycle_started", boundary: frame.boundary, inputHash: hash(frame), role: "goal", revisionHash: state.revisionHash });
    this.task = (async () => {
      const next = this.policy.inferState ? await this.policy.inferState(state, frame)
        : updateGoalState(state, frame, await this.predictors.inferGoals(frame));
      if (this.closedV4 || this.scheduler.generation !== generation || this.state?.revisionHash !== state.revisionHash || !this.latest) return;
      validateGoals(next.goals, this.latest.sources);
      // Preserve current observation progress when inference began at an older
      // boundary with the same requested intent. Never roll the ledger backward.
      this.state = updateGoalState(next, this.latest, next.goals);
      this.latest.goals = copy(this.state.goals);
      finished = true;
      this.record({ type: "goal_state_updated", boundary: this.latest.boundary, state: copy(this.state) });
      // Rerank the current pool locally. A new goal never launches a candidate API call.
      this.propose(this.latest);
    })().catch(error => {
      finished = this.scheduler.generation === generation && this.state?.revisionHash === state.revisionHash;
      this.record({ type: "prediction_cycle_failed", boundary: frame.boundary,
        errorType: error instanceof Error ? error.constructor.name : "Error", actorContinues: true });
    })
      .finally(() => {
        if (finished) this.finishedRevision = state.revisionHash;
        this.task = undefined;
        this.record({ type: "prediction_cycle_completed", boundary: frame.boundary, latencyMs: Date.now() - started });
        this.startGoals();
      });
  }
  async settlePredictions() { while (this.task) await this.task; }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closedV4 = true;
    this.closePromise = Promise.allSettled([this.scheduler.close(), this.settlePredictions()]).then(results => {
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    });
    return this.closePromise;
  }
}
