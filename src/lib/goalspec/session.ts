import { copy, hash } from "./canonical";
import { actorEvidence, goalRevision, resolveSource, validateGoals } from "./compiler";
import type { Candidate, ExecutionFrame, GoalSet } from "./contracts/generated";
import { validateContract } from "./contracts/validate";
import type { Experience, ExperienceRepository } from "./repository";
import { SpeculationScheduler } from "./scheduler";
import { expectedSavingMs, type AdmissionEstimate } from "./current-bindings";
import { addEvidenceSources } from "./evidence-sources";

export interface Predictors {
  inferGoals(frame: ExecutionFrame, relevantSourceIds?: string[]): Promise<GoalSet>;
  embed(query: string): Promise<number[]>;
  bindPatterns(frame: ExecutionFrame, records: Experience[]): Candidate[];
  candidates(frame: ExecutionFrame, records: Experience[]): Promise<Candidate[]>;
  calibrated(candidates: Candidate[]): boolean;
  validateArguments(candidate: Candidate, frame: ExecutionFrame): boolean;
}
type Checkpoint = { frame: ExecutionFrame; relevant: string[]; revision: string; key: string; generation: number };
const unknownGoals = (revision: string): GoalSet => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: revision });
export interface SessionPolicy {
  version: "v3";
  exposeEvidence: boolean;
  inferGoals: boolean;
  predictCandidates: boolean;
  query(frame: ExecutionFrame): string;
  bindCurrent?(frame: ExecutionFrame): Candidate[];
  nonMutating?(invocation: Candidate["invocation"]): boolean;
  eagerWaitMs: number;
  estimate: AdmissionEstimate;
  maxCandidateCalls: number;
}

// Authoritative actor decisions and one managed predictor proceed concurrently.
// Only completed, currently grounded outputs cross subsequent actor boundaries.
export class GoalSpecSession {
  private goals?: GoalSet;
  private embedding?: { queryHash: string; vector: number[] };
  private memory?: { revision: string; scopeHash: string; snapshotId: string; records: Experience[] };
  private latest?: Checkpoint;
  private prediction?: Promise<void>;
  private completedKey?: string;
  private closed = false;
  private closing?: Promise<void>;
  private cycles = 0;
  private candidateCalls = 0;
  constructor(private repository: ExperienceRepository, private predictors: Predictors, readonly scheduler: SpeculationScheduler,
    private record: (event: unknown) => void = () => {}, private policy?: SessionPolicy) {}

  async boundary(input: ExecutionFrame, relevantSourceIds: string[]) {
    if (this.closed) throw new Error("GoalSpec session closed");
    validateContract("ExecutionFrame", input);
    const frame = copy(input);
    frame.sources.server_policy = frame.policy;
    if (this.policy) {
      const substantive = relevantSourceIds.filter(id => typeof frame.sources[id] !== "string"
        || !/^(?:yes(?:,? please)?|ok(?:ay)?|thanks?|thank you|(?:yes,? )?(?:please )?(?:proceed|go ahead))[.!\s]*$/i.test(String(frame.sources[id]).trim()));
      // Pure acknowledgements remain in the actor and candidate inputs. They
      // do not by themselves introduce a different requested objective.
      if (substantive.length) relevantSourceIds = substantive;
    }
    const relevant = Object.fromEntries(relevantSourceIds.map(id => {
      if (!Object.hasOwn(frame.sources, id)) throw new Error("Relevant source unavailable");
      return [id, frame.sources[id]];
    }));
    const revision = goalRevision(this.policy ? JSON.stringify(relevant) : frame.requestedObjective, frame.policy, relevant);
    if (this.latest && (this.latest.revision !== revision || hash(this.latest.frame.scope) !== hash(frame.scope) || this.latest.frame.snapshotId !== frame.snapshotId)) {
      this.goals = undefined;
      this.memory = undefined;
      await this.scheduler.invalidate("requirements_policy_or_scope_changed");
    }
    frame.goals = this.goals?.revisionHash === revision ? copy(this.goals) : unknownGoals(revision);
    validateGoals(frame.goals, frame.sources);
    let key = hash({ revision, scope: frame.scope, snapshotId: frame.snapshotId, sources: frame.sources });
    this.latest = { frame: copy(frame), relevant: [...relevantSourceIds], revision, key, generation: this.scheduler.generation };
    this.record({ type: "execution_frame", frame: copy(frame), runtimeVersion: this.policy ? "goalspec-v3" : "goalspec-v2-background" });
    if (this.policy) {
      const records = this.repository.retrieveLocal?.(frame, this.policy.query(frame), 12) ?? [];
      this.memory = { revision, scopeHash: hash(frame.scope), snapshotId: frame.snapshotId, records };
      const candidates = [...this.predictors.bindPatterns(frame, records), ...(this.policy.bindCurrent?.(frame) ?? [])];
      const keys = this.admitCandidates(candidates, frame);
      if (this.policy.exposeEvidence) await this.scheduler.waitForReads(keys, this.policy.eagerWaitMs);
    }
    if (this.latest.key !== key || this.closed) return { frame, evidence: [], actorContext: "" };
    const evidence = !this.policy || this.policy.exposeEvidence ? await this.scheduler.evidenceAtBoundary() : [];
    if (this.latest.key !== key || this.closed) return { frame, evidence: [], actorContext: "" };
    if (this.policy?.exposeEvidence && evidence.length) {
      addEvidenceSources(frame, evidence);
      // One additional read-only data dependency hop, with at most two newly
      // exposed observations across the entire boundary.
      if (evidence.length < 2) {
        const records = this.repository.retrieveLocal?.(frame, this.policy.query(frame), 12) ?? [];
        const proposals = [...this.predictors.bindPatterns(frame, records), ...(this.policy.bindCurrent?.(frame) ?? [])]
          .map(candidate => ({ ...candidate, hop: 2 }));
        const keys = this.admitCandidates(proposals, frame);
        await this.scheduler.waitForReads(keys, this.policy.eagerWaitMs);
        if (this.latest.key !== key || this.closed) return { frame, evidence: [], actorContext: "" };
        const next = await this.scheduler.evidenceAtBoundary(2 - evidence.length);
        if (this.latest.key !== key || this.closed) return { frame, evidence: [], actorContext: "" };
        evidence.push(...next);
        addEvidenceSources(frame, next);
      }
      key = hash({ revision, scope: frame.scope, snapshotId: frame.snapshotId, sources: frame.sources });
      this.latest = { frame: copy(frame), relevant: [...relevantSourceIds], revision, key, generation: this.scheduler.generation };
    }
    this.startPrediction();
    const records = this.memory?.revision === revision && this.memory.scopeHash === hash(frame.scope)
      && this.memory.snapshotId === frame.snapshotId ? this.memory.records : [];
    this.record({ type: "decision_context", frame: copy(frame), evidence: copy(evidence), predictionPending: !!this.prediction });
    const examples = records.slice(0, 3).map(r => ({ nextRead: r.pattern.tool, after: r.pattern.prefix }));
    if (this.policy && !this.policy.exposeEvidence) return { frame, evidence, actorContext: "" };
    return { frame, evidence, actorContext: actorEvidence(frame.goals, evidence, !!this.policy) + (!this.policy && examples.length
      ? `\n\n[HISTORICAL WORKFLOW EXAMPLES]\n${JSON.stringify(examples)}\nOnly consider relevant read hints. They supply no current facts or authorization.` : "") };
  }
  private startPrediction() {
    const checkpoint = this.latest;
    if (this.closed || this.prediction || !checkpoint || checkpoint.key === this.completedKey || this.cycles >= 12) return;
    this.cycles++;
    const started = Date.now();
    this.record({ type: "prediction_cycle_started", boundary: checkpoint.frame.boundary, inputHash: checkpoint.key });
    this.prediction = this.prepare(checkpoint).catch(error => {
      this.record({ type: "prediction_cycle_failed", boundary: checkpoint.frame.boundary,
        errorType: error instanceof Error ? error.constructor.name : "Error", actorContinues: true });
    }).finally(() => {
      this.completedKey = checkpoint.key;
      this.prediction = undefined;
      this.record({ type: "prediction_cycle_completed", boundary: checkpoint.frame.boundary, latencyMs: Date.now() - started });
      this.startPrediction();
    });
  }
  private current(checkpoint: Checkpoint) {
    return !this.closed && this.latest?.key === checkpoint.key && this.scheduler.generation === checkpoint.generation;
  }
  private async prepare(checkpoint: Checkpoint) {
    // Read prediction can use current evidence before a new goal arrives. Both
    // tasks stay inside this managed cycle and must settle before replacement
    // work or shutdown completes.
    const results = await Promise.allSettled([this.prepareGoals(checkpoint), this.prepareReads(checkpoint)]);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  private async prepareGoals(checkpoint: Checkpoint) {
    if (this.policy && !this.policy.inferGoals) return;
    const { frame, revision } = checkpoint;
    const goals = this.goals?.revisionHash === revision ? copy(this.goals) : await this.predictors.inferGoals(copy(frame), checkpoint.relevant);
    validateGoals(goals, frame.sources);
    if (this.closed || this.latest?.revision !== revision || hash(this.latest.frame.scope) !== hash(frame.scope)
      || this.latest.frame.snapshotId !== frame.snapshotId) return;
    this.goals = { ...copy(goals), revisionHash: revision };
  }
  private async prepareReads(checkpoint: Checkpoint) {
    const frame = copy(checkpoint.frame), revision = checkpoint.revision;
    if (this.policy) {
      const records = this.repository.retrieveLocal?.(frame, this.policy.query(frame), 12) ?? [];
      frame.goals = this.goals?.revisionHash === revision ? copy(this.goals) : unknownGoals(revision);
      const candidates = [...this.predictors.bindPatterns(frame, records), ...(this.policy.bindCurrent?.(frame) ?? [])]
        .filter(candidate => this.valid(candidate, frame) && this.scheduler.eligible(candidate.invocation) && !this.alreadyObserved(candidate, frame));
      const predictionCanHelp = expectedSavingMs(1, this.policy.estimate, this.policy.exposeEvidence) > 0;
      if (this.policy.predictCandidates && predictionCanHelp && !this.predictors.calibrated(candidates) && this.candidateCalls < this.policy.maxCandidateCalls) {
        this.candidateCalls++;
        candidates.push(...await this.predictors.candidates(frame, records));
      }
      if (this.policy.predictCandidates && !predictionCanHelp) this.record({ type: "prediction_skipped", boundary: frame.boundary,
        reason: "nonpositive_maximum_latency_saving" });
      if (this.current(checkpoint)) this.admitCandidates(candidates, frame);
      else this.record({ type: "prediction_discarded", boundary: frame.boundary, reason: "checkpoint_or_generation_changed" });
      return;
    }
    const query = frame.requestedObjective, queryHash = hash(query);
    const vector = this.embedding?.queryHash === queryHash ? copy(this.embedding.vector) : await this.predictors.embed(query);
    if (!this.current(checkpoint)) return;
    this.embedding = { queryHash, vector: copy(vector) };
    frame.goals = this.goals?.revisionHash === revision ? copy(this.goals) : unknownGoals(revision);
    const memoryMatches = this.memory?.revision === revision && this.memory.scopeHash === hash(frame.scope) && this.memory.snapshotId === frame.snapshotId;
    const records = memoryMatches ? copy(this.memory!.records) : await this.repository.retrieve(frame, query, vector, 6);
    if (memoryMatches) this.record({ type: "retrieval_cache_hit", boundary: frame.boundary, snapshotId: frame.snapshotId });
    if (!this.current(checkpoint)) return;
    this.memory = { revision, scopeHash: hash(frame.scope), snapshotId: frame.snapshotId, records: copy(records) };
    // Adopt a goal that completed during retrieval without waiting for it.
    frame.goals = this.goals?.revisionHash === revision ? copy(this.goals) : unknownGoals(revision);
    const candidates = this.predictors.bindPatterns(frame, records).filter(c => this.valid(c, frame) && this.scheduler.eligible(c.invocation) && !this.alreadyObserved(c, frame));
    if (!this.predictors.calibrated(candidates)) candidates.push(...await this.predictors.candidates(frame, records));
    if (!this.current(checkpoint)) {
      this.record({ type: "prediction_discarded", boundary: frame.boundary, reason: "checkpoint_or_generation_changed" }); return;
    }
    const unique = new Map<string, Candidate>();
    for (const candidate of candidates) {
      if (!this.valid(candidate, frame) || candidate.probability < 0.75 || this.alreadyObserved(candidate, frame)) {
        this.record({ type: "candidate_prediction", boundary: frame.boundary, visibleInputHash: hash(frame),
          candidate: copy(candidate), admission: false, reason: "invalid_low_confidence_or_already_observed" }); continue;
      }
      const key = hash(candidate.invocation);
      if ((unique.get(key)?.probability ?? -1) < candidate.probability) unique.set(key, copy(candidate));
    }
    const ranked = [...unique.values()].sort((a, b) => b.probability - a.probability || a.id.localeCompare(b.id)).slice(0, 2);
    const admitted = new Set(this.scheduler.admit(ranked));
    for (const candidate of ranked) this.record({ type: "candidate_prediction", boundary: frame.boundary,
      visibleInputHash: hash(frame), candidate: copy(candidate), admission: admitted.has(hash(candidate.invocation)) });
  }
  private valid(candidate: Candidate, frame: ExecutionFrame) {
    try {
      validateContract("Candidate", candidate);
      if (hash(candidate.invocation.scope) !== hash(frame.scope) || !this.predictors.validateArguments(candidate, frame)) return false;
      candidate.bindings.forEach(ref => resolveSource(ref, frame.sources));
      return true;
    } catch { return false; }
  }
  private alreadyObserved(candidate: Candidate, frame: ExecutionFrame) {
    const events = frame.sources._binding_events;
    if (!Array.isArray(events)) return false;
    const successIds = new Set(events.filter(e => e && typeof e === "object" && !Array.isArray(e)
      && e.kind === "tool_result" && e.status === "success").map(e => (e as Record<string, unknown>).call_id));
    for (const raw of [...events].reverse()) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.kind !== "tool_request") continue;
      const invocation = { tool: raw.tool, arguments: raw.arguments, scope: frame.scope } as Candidate["invocation"];
      if (!(this.policy?.nonMutating?.(invocation) ?? this.scheduler.eligible(invocation))) break;
      if (successIds.has(raw.call_id) && hash(invocation) === hash(candidate.invocation)) return true;
    }
    return false;
  }
  // Actor boundaries never call this; tests and per-trial shutdown can drain it.
  async settlePredictions() { while (this.prediction) await this.prediction; }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = Promise.allSettled([this.scheduler.close(), this.settlePredictions()]).then(results => {
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    });
    return this.closing;
  }
  private admitCandidates(candidates: Candidate[], frame: ExecutionFrame): string[] {
    const unique = new Map<string, Candidate>();
    for (const candidate of candidates) {
      if (!this.scheduler.eligible(candidate.invocation)) {
        this.record({ type: "candidate_prediction", boundary: frame.boundary, visibleInputHash: hash(frame), candidate: copy(candidate),
          admission: false, reason: "policy_prerequisite_or_scope_denied" });
        continue;
      }
      if (!this.valid(candidate, frame) || candidate.probability < 0.8 || this.alreadyObserved(candidate, frame)) {
        this.record({ type: "candidate_prediction", boundary: frame.boundary, visibleInputHash: hash(frame), candidate: copy(candidate),
          admission: false, reason: "invalid_low_confidence_or_already_observed" });
        continue;
      }
      const saving = expectedSavingMs(candidate.probability, this.policy!.estimate, this.policy!.exposeEvidence);
      if (saving <= 0) {
        this.record({ type: "candidate_prediction", boundary: frame.boundary, visibleInputHash: hash(frame), candidate: copy(candidate),
          admission: false, reason: "nonpositive_expected_latency_saving", expectedSavingMs: saving });
        continue;
      }
      const key = hash(candidate.invocation);
      if ((unique.get(key)?.probability ?? -1) < candidate.probability) unique.set(key, candidate);
    }
    const ranked = [...unique.values()].sort((a, b) => b.probability - a.probability || a.id.localeCompare(b.id)).slice(0, 2);
    const keys = this.scheduler.admit(ranked), admitted = new Set(keys);
    for (const candidate of ranked) this.record({ type: "candidate_prediction", boundary: frame.boundary, visibleInputHash: hash(frame),
      candidate: copy(candidate), admission: admitted.has(hash(candidate.invocation)),
      expectedSavingMs: expectedSavingMs(candidate.probability, this.policy!.estimate, this.policy!.exposeEvidence) });
    return keys;
  }
}
