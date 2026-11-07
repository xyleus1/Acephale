type Work<T> = { kind: "goal" | "ranking"; signal: AbortSignal; run: () => Promise<T>; resolve: (value: T) => void;
  reject: (reason: unknown) => void; onAbort: () => void };

/** Serializes this predictor port's HTTP work. This is not a GPU reservation across model servers. */
export class InfraPredictorCoordinator {
  private queue: Work<unknown>[] = [];
  private active = false;
  private scheduled = false;
  run<T>(kind: Work<T>["kind"], signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      const work: Work<T> = { kind, signal, run, resolve, reject, onAbort: () => {
        const index = this.queue.indexOf(work as Work<unknown>);
        if (index >= 0) { this.queue.splice(index, 1); reject(signal.reason ?? new Error("Prediction cancelled")); }
      } };
      this.queue.push(work as Work<unknown>); signal.addEventListener("abort", work.onAbort, { once: true });
      this.schedule();
    });
  }
  private schedule() {
    if (this.active || this.scheduled) return;
    this.scheduled = true;
    const dispatch = () => { this.scheduled = false; void this.drain(); };
    // Give synchronous candidate compilation and its promise continuations one turn to queue
    // urgent ranking. Otherwise observe()'s earlier goal microtask always wins an idle port.
    if (this.queue.some(work => work.kind === "ranking")) queueMicrotask(dispatch);
    else setTimeout(dispatch, 0);
  }
  private async drain() {
    if (this.active) return;
    const ranking = this.queue.findIndex(work => work.kind === "ranking");
    const work = this.queue.splice(ranking < 0 ? 0 : ranking, 1)[0];
    if (!work) return;
    this.active = true; work.signal.removeEventListener("abort", work.onAbort);
    try { work.signal.throwIfAborted(); work.resolve(await work.run()); }
    catch (error) { work.reject(error); }
    finally { this.active = false; this.schedule(); }
  }
}

const shared = new WeakMap<object, InfraPredictorCoordinator>();
export function predictorCoordinatorFor(port: object): InfraPredictorCoordinator {
  let coordinator = shared.get(port);
  if (!coordinator) { coordinator = new InfraPredictorCoordinator(); shared.set(port, coordinator); }
  return coordinator;
}
