import test from "node:test";
import assert from "node:assert/strict";
import { orderedConcurrentMap } from "./goalspec-replay-concurrency";

function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const turn = () => new Promise<void>(done => setImmediate(done));

test("replay concurrency is bounded and emissions stay in input order despite out-of-order completion", async () => {
  const gates = Array.from({ length: 6 }, gate), starts: number[] = [], emitted: number[] = [];
  let active = 0, peak = 0;
  const pending = orderedConcurrentMap([0, 1, 2, 3, 4, 5], 4, async value => {
    starts.push(value); active++; peak = Math.max(peak, active);
    await gates[value].promise; active--; return value * 2;
  }, async (result, index) => { await turn(); emitted.push(index); assert.equal(result, index * 2); });
  assert.deepEqual(starts, [0, 1, 2, 3]);
  gates[3].resolve(); gates[2].resolve(); gates[1].resolve(); await turn();
  assert.deepEqual(emitted, []); assert.ok(starts.length >= 5);
  gates.forEach(item => item.resolve());
  assert.deepEqual(await pending, [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(emitted, [0, 1, 2, 3, 4, 5]); assert.equal(peak, 4); assert.equal(active, 0);
});

test("fatal replay errors stop new scheduling and drain already-started work before rejecting", async () => {
  const failureGate = gate(), runningGate = gate(), started: number[] = [];
  let settled = false, drained = false;
  const pending = orderedConcurrentMap([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (value === 0) { await failureGate.promise; throw new Error("fixture fatal"); }
    await runningGate.promise; drained = true; return value;
  });
  const observed = pending.then(() => { settled = true; }, error => { settled = true; throw error; });
  failureGate.resolve(); await turn();
  assert.equal(settled, false); assert.deepEqual(started, [0, 1]);
  runningGate.resolve(); await assert.rejects(observed, /fixture fatal/);
  assert.equal(drained, true); assert.deepEqual(started, [0, 1]);
});

test("ordered emission failures also drain requests and invalid concurrency dispatches no work", async () => {
  const outstanding = gate(); let drained = false;
  const pending = orderedConcurrentMap([0, 1], 2, async value => {
    if (value) { await outstanding.promise; drained = true; }
    return value;
  }, () => { throw new Error("fixture disk failure"); });
  const observed = assert.rejects(pending, /fixture disk failure/);
  await turn(); assert.equal(drained, false); outstanding.resolve(); await observed; assert.equal(drained, true);
  for (const concurrency of [0, 5, 1.5]) await assert.rejects(orderedConcurrentMap([1], concurrency, async () => { throw new Error("dispatched"); }), /between one and four/);
});
