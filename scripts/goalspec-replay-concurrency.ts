/** Independent offline replay work only. Native actor trials never use this helper. */
export async function orderedConcurrentMap<Input, Output>(inputs: readonly Input[], concurrency: number,
  work: (input: Input, index: number) => Promise<Output>, emit?: (output: Output, index: number) => void | Promise<void>): Promise<Output[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("Replay concurrency must be between one and four");
  const results = new Array<Output>(inputs.length), ready = new Set<number>();
  let assigned = 0, emitted = 0, failed = false, failure: unknown;
  let emission = Promise.resolve();
  const fail = (error: unknown) => { if (!failed) { failed = true; failure = error; } };
  const flush = () => {
    emission = emission.then(async () => {
      while (!failed && ready.has(emitted)) {
        await emit?.(results[emitted], emitted);
        ready.delete(emitted++);
      }
    }).catch(fail);
    return emission;
  };
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (!failed && assigned < inputs.length) {
      const index = assigned++;
      try { results[index] = await work(inputs[index], index); ready.add(index); await flush(); }
      catch (error) { fail(error); }
    }
  });
  // Promise.all would reject early. Always drain every already-started request
  // before surfacing fatal orchestration/emit errors to the budget owner.
  await Promise.allSettled(workers); await emission;
  if (failed) throw failure;
  if (emitted !== inputs.length) throw new Error("Incomplete ordered replay emission");
  return results;
}
