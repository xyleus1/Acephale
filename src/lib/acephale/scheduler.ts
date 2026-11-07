import { copy, hash } from "./canonical";
import type { Candidate, EvidenceEnvelope, Invocation } from "./contracts/generated";
import { validateContract } from "./contracts/validate";

export type JobState = "running" | "ready" | "promoted" | "validating" | "consumed" | "cancelled" | "invalidated" | "failed";
export type Observation = EvidenceEnvelope["observation"];
export type ReadValidation =
  | { status: "verified"; observation: Observation }
  | { status: "stale"; reason?: string }
  | { status: "denied"; reason: string };
export class ReadAuthorizationDeniedError extends Error {
  constructor(reason = "Read authorization denied") { super(reason); this.name = "ReadAuthorizationDeniedError"; }
}
export interface EvidenceSelection {
  // Selection runs over already completed reads. It never grants permission to
  // expose an observation: verify() still performs the authoritative check.
  rank(ready: { key: string; invocation: Invocation; observation: Observation; observedAt: number }[]): string[];
  accept?(evidence: EvidenceEnvelope): boolean;
}
export interface ReadExecutor {
  // Policy and authorization are server-owned. Implementations must fail closed.
  eligible(invocation: Invocation): boolean;
  read(invocation: Invocation, signal: AbortSignal): Promise<Observation>;
  // Full scoped reread or Python-owned snapshot lease verification. Never !blocked.
  validate(invocation: Invocation, previous: Observation, signal: AbortSignal): Promise<Observation>;
  // Explicit discrimination avoids interpreting arbitrary tool JSON as a proof.
  // A denial is terminal for this invocation, including authoritative promotion.
  validateFreshness?(invocation: Invocation, previous: Observation, signal: AbortSignal): Promise<ReadValidation>;
  // Immutable receipt checks can perform zero physical reads. Existing adapters
  // retain their conservative one-call validation accounting.
  validationPhysicalCalls?(invocation: Invocation): number;
}
export type RuntimeEvent = { type: string; at: number; runId: string; key: string; details: Record<string, string | number | boolean> };
type Job = {
  invocation: Invocation; key: string; state: JobState; controller: AbortController;
  completion: Promise<void>; observation?: Observation; observedAt: number; epoch: number;
  exposed: boolean; promotion?: Promise<EvidenceEnvelope | undefined>;
  physicalCalls: number;
  denial?: string;
};

// A process-wide speculative pool leaves authoritative execution outside its capacity.
// No queued speculation: returning authoritative work never waits behind a queued read.
export class SpeculativeCapacity {
  private active = 0;
  constructor(readonly limit = 4) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid capacity");
  }
  acquire(): (() => void) | undefined {
    if (this.active >= this.limit) return;
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
  get used() { return this.active; }
}
export const globalSpeculativeCapacity = new SpeculativeCapacity();
export const invocationKey = (invocation: Invocation) => hash(invocation);

export class SpeculationScheduler {
  private jobs = new Map<string, Job>();
  private managed = new Set<Promise<unknown>>();
  private starts = 0;
  private active = 0;
  private epoch = 0;
  private closed = false;
  private suspended = false;
  // Background predictors fence admissions against mutation and shutdown.
  get generation() { return this.epoch; }
  eligible(invocation: Invocation) { return this.executor.eligible(invocation); }
  constructor(
    private runId: string,
    private executor: ReadExecutor,
    private emit: (event: RuntimeEvent) => void,
    private capacity = globalSpeculativeCapacity,
    private deadlineMs = 5_000,
  ) {
    if (!runId || !Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error("Invalid scheduler configuration");
  }
  private event(type: string, key: string, details: RuntimeEvent["details"] = {}) {
    this.emit({ type, key, runId: this.runId, at: Date.now(), details });
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    this.managed.add(promise);
    void promise.then(() => this.managed.delete(promise), () => this.managed.delete(promise));
    return promise;
  }
  admit(candidates: Candidate[]): string[] {
    const admitted: string[] = [];
    for (const proposal of candidates.slice(0, 3)) {
      validateContract("Candidate", proposal);
      const candidate = copy(proposal);
      const invocation = candidate.invocation;
      const key = invocationKey(invocation);
      let reason = "";
      if (this.closed || this.suspended) reason = "closed_or_mutating";
      else if (this.starts >= 12) reason = "run_start_limit";
      else if (this.active >= 2) reason = "run_concurrency";
      else if (this.jobs.has(key)) reason = "duplicate";
      else if (!this.executor.eligible(invocation)) reason = "policy_denied";
      if (reason) { this.event("rejected", key, { reason }); continue; }
      const release = this.capacity.acquire();
      if (!release) { this.event("rejected", key, { reason: "global_concurrency" }); continue; }
      this.starts++; this.active++;
      const job: Job = { invocation, key, state: "running", controller: new AbortController(), completion: Promise.resolve(), observedAt: 0, epoch: this.epoch, exposed: false, physicalCalls: 1 };
      this.jobs.set(key, job);
      this.event("started", key);
      const started = Date.now();
      const timer = setTimeout(() => {
        if (job.state === "running" || job.state === "promoted") {
          job.state = "cancelled"; job.controller.abort(); this.event("cancel_requested", key, { reason: "deadline" });
        }
      }, this.deadlineMs);
      job.completion = this.track(Promise.resolve().then(() => this.executor.read(copy(invocation), job.controller.signal)).then(value => {
        if (this.closed || job.controller.signal.aborted || job.epoch !== this.epoch) {
          this.event("late_result_discarded", key); return;
        }
        job.observation = copy(value); job.observedAt = Date.now(); job.state = "ready";
        this.event("ready", key);
      }).catch(error => {
        if (error instanceof ReadAuthorizationDeniedError) job.denial = error.message;
        if (!job.controller.signal.aborted) { job.state = "failed"; this.event("failed", key); }
      }).finally(() => {
        clearTimeout(timer); this.active--; release();
        this.event("physical_read_completed", key, { latencyMs: Date.now() - started });
        if (job.controller.signal.aborted) this.event("cancellation_confirmed", key);
      }));
      admitted.push(key);
    }
    return admitted;
  }
  private async verify(job: Job, authoritative = false): Promise<EvidenceEnvelope | undefined> {
    await job.completion;
    if (this.closed || this.suspended || job.epoch !== this.epoch || job.controller.signal.aborted || job.observation === undefined || job.state === "consumed") return;
    const release = authoritative ? undefined : this.active < 2 ? this.capacity.acquire() : undefined;
    if (!authoritative && !release) { this.event("validation_deferred", job.key); return; }
    if (!authoritative) this.active++;
    const prior = copy(job.observation);
    job.state = "validating";
    const start = Date.now();
    const timer = setTimeout(() => job.controller.abort(), this.deadlineMs);
    try {
      const physicalCalls = this.executor.validationPhysicalCalls?.(copy(job.invocation)) ?? 1;
      if (!Number.isSafeInteger(physicalCalls) || physicalCalls < 0) throw new Error("Invalid validation call accounting");
      job.physicalCalls += physicalCalls;
      const validation: ReadValidation = this.executor.validateFreshness
        ? await this.executor.validateFreshness(copy(job.invocation), prior, job.controller.signal)
        : { status: "verified", observation: await this.executor.validate(copy(job.invocation), prior, job.controller.signal) };
      if (validation.status === "denied") {
        job.denial = validation.reason; job.state = "invalidated"; job.controller.abort();
        this.event("validation_denied", job.key); return;
      }
      if (validation.status === "stale") {
        job.state = "invalidated"; job.controller.abort(); this.event("validation_stale", job.key); return;
      }
      const observation = copy(validation.observation);
      if (this.closed || this.suspended || job.controller.signal.aborted || job.epoch !== this.epoch) return;
      const observationHash = hash(observation);
      const envelope: EvidenceEnvelope = {
        schemaVersion: 1, id: hash({ key: job.key, observationHash, epoch: job.epoch }), invocation: copy(job.invocation),
        observation, observationHash, observedAt: job.observedAt, validatedAt: Date.now(),
        validation: hash(prior) === observationHash ? "fresh" : "replaced", physicalCalls: job.physicalCalls,
      };
      job.state = "ready";
      this.event("verified", job.key, { replaced: envelope.validation === "replaced" });
      return envelope;
    } catch (error) {
      if (error instanceof ReadAuthorizationDeniedError) job.denial = error.message;
      job.state = "invalidated"; job.controller.abort(); this.event("validation_failed", job.key);
    } finally {
      clearTimeout(timer);
      if (!authoritative) { this.active--; release!(); }
      this.event("revalidation_completed", job.key, { latencyMs: Date.now() - start });
    }
  }
  // Exact calls join the existing invocation. A cancellation signal alone never
  // licenses a duplicate: completion of all managed work is awaited first.
  authoritative(invocation: Invocation, execute: () => Promise<Observation>): Promise<Observation> {
    return this.track(this.runAuthoritative(invocation, execute));
  }
  // Native orchestration owns fallback execution. A miss must not manufacture
  // an authoritative attempt or a function result inside the Node process.
  promoteOnly(invocation: Invocation): Promise<{ observation: Observation } | undefined> {
    return this.track(this.promoteExisting(invocation));
  }
  private async promoteExisting(invocation: Invocation): Promise<{ observation: Observation } | undefined> {
    validateContract("Invocation", invocation);
    if (this.closed) throw new Error("Run is closed");
    const key = invocationKey(invocation);
    const job = this.jobs.get(key);
    if (!this.suspended && job && job.epoch === this.epoch && job.state !== "consumed") {
      this.event("promotion_requested", key);
      if (job.state === "running") job.state = "promoted";
      job.promotion ??= this.track(this.verify(job, true));
      const evidence = await job.promotion;
      if (evidence && !this.closed && !this.suspended && job.epoch === this.epoch) {
        job.state = "consumed"; this.event("useful", key);
        return { observation: copy(evidence.observation) };
      }
    }
    if (job) { await job.completion; if (job.promotion) await job.promotion; }
    if (job?.denial !== undefined) throw new ReadAuthorizationDeniedError(job.denial);
    if (this.closed) throw new Error("Run is closed");
    return undefined;
  }
  private async runAuthoritative(invocation: Invocation, execute: () => Promise<Observation>): Promise<Observation> {
    const promoted = await this.promoteExisting(invocation);
    if (promoted) return promoted.observation;
    const key = invocationKey(invocation);
    this.event("authoritative_started", key);
    return this.track(execute());
  }
  async evidenceAtBoundary(limit = 2, selection?: EvidenceSelection): Promise<EvidenceEnvelope[]> {
    if (!Number.isInteger(limit) || limit < 0 || limit > 2) throw new Error("Invalid boundary evidence limit");
    const ready = [...this.jobs.values()].filter(j => j.state === "ready" && !j.exposed && !j.promotion);
    const byKey = new Map(ready.map(job => [job.key, job]));
    const keys = selection ? selection.rank(ready.map(job => ({ key: job.key, invocation: copy(job.invocation),
      observation: copy(job.observation!), observedAt: job.observedAt }))) : ready.map(job => job.key);
    const selected = [...new Set(keys)].map(key => byKey.get(key)).filter((job): job is Job => !!job);
    const result: EvidenceEnvelope[] = [];
    for (const job of selected) {
      if (result.length >= limit) break;
      job.promotion = this.track(this.verify(job));
      const evidence = await job.promotion;
      job.promotion = undefined;
      if (evidence && (!selection?.accept || selection.accept(copy(evidence)))) {
        job.exposed = true; result.push(evidence); this.event("exposed", job.key);
      }
    }
    return result;
  }
  async invalidateKeys(keys: string[], reason: string): Promise<void> {
    const jobs = [...new Set(keys)].map(key => this.jobs.get(key)).filter((job): job is Job => !!job);
    for (const job of jobs) {
      job.state = "invalidated"; job.controller.abort(); this.event("invalidated", job.key, { reason });
    }
    // Confirm cancellation before permitting a replacement of the same call.
    await Promise.allSettled(jobs.flatMap(job => [job.completion, ...(job.promotion ? [job.promotion] : [])]));
    for (const job of jobs) if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
  }
  // A small bounded head start is useful only for deterministic cheap reads.
  // Losing the race does not cancel work or license a duplicate invocation.
  async waitForReads(keys: string[], maximumMs: number): Promise<void> {
    if (!Number.isFinite(maximumMs) || maximumMs < 0 || maximumMs > 250) throw new Error("Invalid eager read wait");
    if (!maximumMs || !keys.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.allSettled(keys.map(key => this.jobs.get(key)?.completion)),
        new Promise<void>(resolve => { timer = setTimeout(resolve, maximumMs); })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async invalidate(reason: string): Promise<void> {
    this.epoch++;
    for (const job of this.jobs.values()) {
      if (!job.controller.signal.aborted && job.state !== "consumed") {
        job.state = "invalidated"; job.controller.abort(); this.event("invalidated", job.key, { reason });
      }
    }
    await Promise.allSettled([...this.managed]);
    this.jobs.clear();
  }
  // The native batch callback is preserved, including its existing parallelism.
  async mutationBatch<T>(executeNativeBatch: () => Promise<T>): Promise<T> {
    if (this.closed || this.suspended) throw new Error("Run unavailable");
    this.suspended = true;
    try { await this.invalidate("mutation_batch"); return await this.track(executeNativeBatch()); }
    finally { this.suspended = false; }
  }
  async close() {
    this.closed = true;
    for (const job of this.jobs.values()) if (!job.exposed && job.state !== "consumed") this.event("wasted", job.key);
    await this.invalidate("request_terminated");
  }
}
