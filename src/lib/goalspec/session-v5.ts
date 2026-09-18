import { copy, hash } from "./canonical";
import { actorEvidence, resolveSource, validateGoals } from "./compiler";
import type { Candidate, EvidenceEnvelope, ExecutionFrame, GoalSet } from "./contracts/generated";
import { validateContract } from "./contracts/validate";
import { LocalControllerV5, buildSpeculationContext, v5ExpectedSaving, type SpeculationContext } from "./controller-v5";
import { retrieveContextualMemory, type FrozenExperienceMemory } from "./experience-memory";
import { buildObligationLedger, obligationLedgerContext, type ObligationLedger } from "./obligation-ledger";
import { buildGoalState, updateGoalState, type GoalState } from "./goal-state";
import { addEvidenceSources } from "./evidence-sources";
import type { ExperienceRepository } from "./repository";
import { SpeculationScheduler, type EvidenceSelection } from "./scheduler";
import type { Predictors } from "./session";

export interface V5SessionPolicy {
  controller: LocalControllerV5;
  memory?: FrozenExperienceMemory;
  actorContext: "none" | "literal" | "hypotheses";
  goalConditioning: boolean;
  experimentalUncalibratedGoalWeight?: number;
  memoryAllowedFamilies?: string[];
  familyId?: string;
  uncoveredFallback?: { maximumCalls: number; predictorOverheadMs: number; opportunityMs: number;
    predict(context: SpeculationContext): Promise<Candidate[]> };
  inferGoals: boolean;
  exposeEvidence: boolean;
  query(frame: ExecutionFrame): string;
  bindCurrent(frame: ExecutionFrame): Candidate[];
  validateCurrent?(candidate: Candidate, frame: ExecutionFrame): boolean;
  nonMutating(invocation: Candidate["invocation"]): boolean;
  inferState?(previous: GoalState, frame: ExecutionFrame): Promise<GoalState>;
  estimate: { toolMs: number; validationMs: number; schedulingMs: number; predictionMs: number;
    contentionMs: number; contextMs: number; measuredExposureBenefitMs: number };
  countTokens(text: string): number;
}
type Dependency = { candidate: Candidate; values: string[] };
const emptyGoals = (): GoalSet => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) });
const optionalEvidenceContext = (evidence: Pick<EvidenceEnvelope, "invocation" | "observation">[]) => evidence.length ? "\n\n" + actorEvidence(emptyGoals(), evidence, true) : "";

/** Shared controller composition for native research and Derya. Remote goal
 * updates are managed background work; actor boundaries never await them. */
export class GoalSpecSessionV5 {
  readonly actorContextMode = "current-only" as const;
  private ledger?: ObligationLedger;
  private state?: GoalState;
  private latest?: ExecutionFrame;
  private latestGeneration?: number;
  private task?: Promise<void>;
  private fallbackTask?: Promise<void>;
  private fallbackCalls = 0;
  private fallbackAttempted = new Set<string>();
  private fallbackCandidates?: { publicInputHash: string; candidates: Candidate[] };
  private finishedRevision?: string;
  private closedV5 = false;
  private closePromise?: Promise<void>;
  private cycles = 0;
  private boundaryRevision = 0;
  private dependencies = new Map<string, Dependency>();
  private exposureScores = new Map<string, number>();
  private exposureAllowed = new Set<string>();
  constructor(private repository: ExperienceRepository, private predictors: Predictors,
    readonly scheduler: SpeculationScheduler, private record: (event: unknown) => void,
    private policy: V5SessionPolicy) {
    if (Object.values(policy.estimate).some(value => !Number.isFinite(value) || value < 0)) throw new Error("Invalid v5 utility estimate");
    const fallback = policy.uncoveredFallback;
    if (fallback && (!Number.isInteger(fallback.maximumCalls) || fallback.maximumCalls < 0 || fallback.maximumCalls > 4
      || !Number.isFinite(fallback.predictorOverheadMs) || fallback.predictorOverheadMs < 0
      || !Number.isFinite(fallback.opportunityMs) || fallback.opportunityMs < 0)) throw new Error("Invalid v5 fallback budget");
  }
  async boundary(input: ExecutionFrame, _relevantSourceIds: string[]) {
    if (this.closedV5) throw new Error("GoalSpec session closed");
    validateContract("ExecutionFrame", input);
    const revision = ++this.boundaryRevision;
    const frame = copy(input);
    const superseded = () => this.closedV5 || revision !== this.boundaryRevision;
    const withheld = () => ({ frame, evidence: [] as EvidenceEnvelope[], actorContext: "" });
    frame.sources.server_policy = frame.policy;
    const prior = this.latest;
    const hardChange = prior && (hash(prior.scope) !== hash(frame.scope) || prior.snapshotId !== frame.snapshotId || prior.policy !== frame.policy);
    if (hardChange) {
      const nextGeneration = this.scheduler.generation + 1;
      await this.scheduler.invalidate("scope_policy_or_snapshot_changed");
      if (superseded() || this.scheduler.generation !== nextGeneration) return withheld();
      this.dependencies.clear(); this.exposureScores.clear(); this.exposureAllowed.clear(); this.state = undefined; this.ledger = undefined;
    }
    this.ledger = buildObligationLedger(frame, this.ledger);
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
    this.record({ type: "execution_frame", runtimeVersion: "goalspec-v5", frame: copy(frame) });
    this.propose(frame);
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
    const literal = this.policy.actorContext === "none" ? "" : obligationLedgerContext(this.ledger, {
      ...(this.policy.actorContext === "hypotheses" && this.state.inferenceRevisionHash === this.state.revisionHash
        ? { hypotheses: { mode: "experimental" as const, requestRevisionHash: this.ledger.requestRevisionHash, goals: this.state.goals } } : {}) });
    const actorContext = literal + (this.policy.exposeEvidence ? optionalEvidenceContext(evidence) : "");
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
        && (this.policy.validateCurrent ? this.policy.validateCurrent(candidate, frame) : this.predictors.validateArguments(candidate, frame));
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
    const neutralFrame = { ...frame, goals: emptyGoals() };
    const query = this.policy.query(neutralFrame);
    const records = this.repository.retrieveLocal?.(neutralFrame, query, 12) ?? [];
    const memory = this.policy.memory ? retrieveContextualMemory(frame, query, this.policy.memory, {
      allowedFamilies: this.policy.memoryAllowedFamilies,
      excludeFamilies: this.policy.familyId ? [this.policy.familyId] : [] }) : undefined;
    const context = buildSpeculationContext(frame, { goalState: this.state, memory, workflows: records });
    const unique = new Map<string, Candidate>();
    const fallback = this.fallbackCandidates?.publicInputHash === context.publicInputHash ? this.fallbackCandidates.candidates : [];
    for (const raw of [...this.policy.bindCurrent(neutralFrame), ...this.predictors.bindPatterns(neutralFrame, records), ...fallback]) {
      const candidate = { ...raw, hop };
      if (!this.valid(candidate, frame) || this.observed(candidate, frame)) continue;
      const key = hash(candidate.invocation);
      if (!unique.has(key) && unique.size < 128) unique.set(key, candidate);
    }
    const candidates = [...unique.values()];
    const decision = this.policy.controller.decide(context, candidates, { goalConditioning: this.policy.goalConditioning,
      experimentalUncalibratedGoalWeight: this.policy.experimentalUncalibratedGoalWeight });
    const visibleInputHash = context.publicInputHash;
    this.record({ type: "controller_decision", runtimeVersion: "goalspec-v5", boundary: frame.boundary,
      visibleInputHash, contextHash: hash(context), candidatePool: candidates, decision,
      memory: memory ?? null, workflows: records.map(record => record.id),
      latencyMs: decision.elapsedMs, latencySource: "controller_scores_elapsed_ms",
      deterministicEligibility: candidates.map(candidate => ({ id: candidate.id, eligible: this.scheduler.eligible(candidate.invocation) })) });
    const admitted: string[] = [];
    if (!candidates.length || decision.action === "READ_UNCOVERED") this.startFallback(context);
    // Identical pre-policy pool for neutral/goal comparisons. Eligibility and
    // measured utility are independent decisions; no learned readiness gate.
    for (const score of decision.candidates.filter(item => decision.rankedCandidateIds.includes(item.candidateId))) {
      const candidate = candidates.find(item => item.id === score.candidateId)!;
      const key = hash(candidate.invocation), eligible = this.scheduler.eligible(candidate.invocation);
      const saving = v5ExpectedSaving(score.probability, this.policy.estimate);
      const keys = eligible && saving > 0 ? this.scheduler.admit([{ ...candidate, probability: score.probability }]) : [];
      if (keys.length) {
        admitted.push(...keys);
        this.dependencies.set(key, { candidate, values: candidate.bindings.map(ref => hash(resolveSource(ref, frame.sources))) });
        this.exposureScores.set(key, score.probability);
        // Exposure remains a separate opt-in intervention. No imitation label
        // is described as causal evidence of an exposure benefit.
        if (this.policy.exposeEvidence) this.exposureAllowed.add(key);
      }
      this.record({ type: "candidate_prediction", boundary: frame.boundary, visibleInputHash, candidate: copy(candidate),
        admission: !!keys.length, deterministicEligible: eligible, expectedSavingMs: saving,
        controllerAction: decision.action, exposureUtility: "unmeasured",
        reason: keys.length ? "positive_expected_reuse_utility" : !eligible ? "deterministic_policy_rejection" : "nonpositive_expected_reuse_utility" });
    }
    return admitted;
  }
  private startFallback(context: SpeculationContext) {
    const policy = this.policy.uncoveredFallback;
    const revision = context.publicInputHash, generation = this.scheduler.generation;
    if (!policy || this.closedV5 || this.fallbackTask || this.fallbackCalls >= policy.maximumCalls
      || policy.opportunityMs <= policy.predictorOverheadMs || this.fallbackAttempted.has(revision)) return;
    this.fallbackCalls++; this.fallbackAttempted.add(revision);
    this.record({ type: "uncovered_fallback_started", boundary: context.frame.boundary, inputHash: hash(context),
      publicInputHash: revision, predictedOpportunityMs: policy.opportunityMs, predictorOverheadMs: policy.predictorOverheadMs });
    this.fallbackTask = (async () => {
      const proposed = await policy.predict(copy(context));
      if (this.closedV5 || generation !== this.scheduler.generation || !this.latest
        || buildSpeculationContext(this.latest).publicInputHash !== revision) return;
      const valid = proposed.slice(0, 128).filter(candidate => this.valid(candidate, this.latest!) && this.scheduler.eligible(candidate.invocation));
      this.fallbackCandidates = { publicInputHash: revision, candidates: valid };
      this.record({ type: "uncovered_fallback_completed", boundary: this.latest.boundary, accepted: valid.length, rejected: proposed.length - valid.length });
      this.propose(this.latest);
    })().catch(error => this.record({ type: "uncovered_fallback_failed", errorType: error instanceof Error ? error.constructor.name : "Error" }))
      .finally(() => { this.fallbackTask = undefined; });
  }
  private selection(current: () => boolean): EvidenceSelection {
    const accepted: EvidenceEnvelope[] = [];
    const seen = new Set<string>();
    return {
      rank: ready => (current() ? ready : []).filter(job => this.exposureAllowed.has(job.key))
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
    if (!this.policy.inferGoals || this.closedV5 || this.task || !this.latest || !this.state || this.cycles >= 12
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
      if (this.closedV5 || this.scheduler.generation !== generation || this.state?.revisionHash !== state.revisionHash || !this.latest) return;
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
  async settlePredictions() { while (this.task || this.fallbackTask) await Promise.all([this.task, this.fallbackTask]); }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closedV5 = true;
    this.closePromise = Promise.allSettled([this.scheduler.close(), this.settlePredictions()]).then(results => {
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    });
    return this.closePromise;
  }
}
