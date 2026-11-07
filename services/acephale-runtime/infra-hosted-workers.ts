import { canonical, hash } from "../../src/lib/acephale/canonical";
import { ALLOCATIONS, type Allocation, type BudgetLedger } from "../../src/lib/acephale/budget";
import { RESEARCH_MODELS, type ModelPort } from "../../src/lib/acephale/model";
import { countTokens } from "../../src/lib/acephale/tokens";
import { maximumCost, researchProvider, TrialLedger } from "./provider";
import type { BoundaryWorker } from "./service";

/** Hosted calls are exclusively the unchanged native user simulator and judge.
 * The actor and speculative predictor stay on the pinned local Qwen ports. */
export interface InfraHostedConfiguration {
  allocation: Allocation; maxCostMicrodollarsPerRun: number;
  maxSteps: number; maxErrors: number; timeoutSeconds: number;
}
export function validateInfraHosted(value: InfraHostedConfiguration, stage: string) {
  const allocation = stage === "collection" ? "training" : stage;
  if (!value || value.allocation !== allocation || !Object.hasOwn(ALLOCATIONS, value.allocation)
    || !Number.isSafeInteger(value.maxCostMicrodollarsPerRun) || value.maxCostMicrodollarsPerRun < 1
    || value.maxCostMicrodollarsPerRun > ALLOCATIONS[value.allocation]
    || !Number.isSafeInteger(value.maxSteps) || value.maxSteps < 1 || value.maxSteps > 1000
    || !Number.isSafeInteger(value.maxErrors) || value.maxErrors < 1 || value.maxErrors > value.maxSteps
    || !Number.isSafeInteger(value.timeoutSeconds) || value.timeoutSeconds < 1 || value.timeoutSeconds > 8 * 3600) {
    throw new Error("Invalid native hosted simulator limits or allocation");
  }
}

/** Bind the recovered original ledger, not merely a caller's budget claim. */
export function validateInfraLedgerCheckpoint(value: unknown, ledger: BudgetLedger, ledgerPath: string) {
  const checkpoint = value as { version?: number; ledgerPathHash?: string; entriesHash?: string; entries?: unknown };
  if (!checkpoint || checkpoint.version !== 1 || checkpoint.ledgerPathHash !== hash(ledgerPath)
    || !Array.isArray(checkpoint.entries) || checkpoint.entriesHash !== hash(checkpoint.entries)
    || checkpoint.entriesHash !== hash(ledger.snapshot())) throw new Error("Original ledger differs from the frozen checkpoint");
}

export function attachInfraHostedWorkers(
  actors: { runId: string; worker: BoundaryWorker }[],
  configuration: InfraHostedConfiguration,
  ledger: BudgetLedger,
  record: (event: unknown) => void,
  providerFactory: (ledger: BudgetLedger, allocation: Allocation, record: (event: unknown) => void)
    => { model: ModelPort; embed: (text: string) => Promise<number[]> } = researchProvider,
): { runId: string; worker: BoundaryWorker }[] {
  const ids = actors.flatMap(actor => [actor.runId, `${actor.runId}:user`, `${actor.runId}:evaluator`]);
  if (new Set(ids).size !== ids.length) throw new Error("Native hosted worker identity collision");
  ledger.reserveMany(actors.map(({ runId }) => ({ id: `infra:${runId}`, allocation: configuration.allocation,
    maximum: configuration.maxCostMicrodollarsPerRun })));
  return actors.flatMap(({ runId, worker: actor }) => {
    const parent = `infra:${runId}`;
    const provider = providerFactory(new TrialLedger(ledger, parent, configuration.allocation), configuration.allocation,
      event => record({ runId, event }));
    let remaining = 3;
    const finish = () => { if (--remaining === 0) ledger.finishParent(parent); };
    let actorClosing: Promise<void> | undefined;
    const actorWorker: BoundaryWorker = { decision: (boundary, id) => actorClosing
      ? Promise.reject(new Error("Native actor worker closing")) : actor.decision(boundary, id), close() {
      if (!actorClosing) actorClosing = Promise.resolve().then(async () => { await actor.close(); finish(); });
      return actorClosing;
    } };
    const hosted = (role: "user" | "evaluator"): BoundaryWorker => {
      const modelName = role === "user" ? RESEARCH_MODELS.user : RESEARCH_MODELS.teacher;
      const inputCap = role === "user" ? 8192 : 32768, outputCap = role === "user" ? 1024 : 4096;
      let closed = false, calls = 0, closing: Promise<void> | undefined;
      const pending = new Set<Promise<unknown>>();
      return { decision(boundary, boundaryId) {
        const task = (async () => {
          if (closed || calls++ >= configuration.maxSteps) throw new Error("Native hosted step budget exhausted");
          if (boundary.tools.length || boundary.messages.some(message => !["user", "assistant"].includes(message.role))
            || countTokens(canonical(boundary)) > inputCap - 128) throw new Error("Native hosted context or tool contract violated");
          const result = await provider.model.complete({ id: `${boundaryId}:${role}`, model: modelName,
            input: boundary.messages.map(message => ({ role: message.role as "user" | "assistant", content: message.content ?? "" })),
            instructions: boundary.policy, maxOutputTokens: outputCap, allocation: configuration.allocation,
            maximumAttemptMicrodollars: maximumCost(modelName, inputCap, outputCap), retries: 0 });
          // The provider has now settled or retained its reservation. A close fences its response.
          if (closed) throw new Error("Native hosted worker closed during inference");
          if (result.calls.length || result.refusals.length) throw new Error("Invalid native hosted model response");
          return { role: role === "user" ? "user" : "assistant", content: result.text, usage: result.usage };
        })();
        pending.add(task); void task.then(() => pending.delete(task), () => pending.delete(task)); return task;
      }, close() {
        if (!closing) {
          closed = true;
          closing = Promise.resolve().then(async () => { while (pending.size) await Promise.allSettled([...pending]); finish(); });
        }
        return closing;
      } };
    };
    return [{ runId, worker: actorWorker }, { runId: `${runId}:user`, worker: hosted("user") },
      { runId: `${runId}:evaluator`, worker: hosted("evaluator") }];
  });
}
