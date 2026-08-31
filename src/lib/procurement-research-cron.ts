import { runProcurementResearchCron } from "@/lib/procurement-research-bridge";
import { runQueuedSourcingResearchWorkers } from "@/lib/supply-os/supplier-research-worker";

type EnqueueResult = Awaited<ReturnType<typeof runProcurementResearchCron>>;
type DrainResult = Awaited<ReturnType<typeof runQueuedSourcingResearchWorkers>>;

export type ProcurementResearchCronCycleResult = {
  enqueue: EnqueueResult | null;
  enqueueError: string | null;
  drain: DrainResult | null;
  drainError: string | null;
};

export type ProcurementResearchCronCycleDependencies = {
  enqueue?: () => Promise<EnqueueResult>;
  drain?: (options: { limit?: number }) => Promise<DrainResult>;
  drainLimit?: number;
};

export async function runProcurementResearchCronCycle(
  dependencies: ProcurementResearchCronCycleDependencies = {},
): Promise<ProcurementResearchCronCycleResult> {
  let enqueue: EnqueueResult | null = null;
  let enqueueError: string | null = null;
  let drain: DrainResult | null = null;
  let drainError: string | null = null;

  try {
    enqueue = await (dependencies.enqueue ?? (() => runProcurementResearchCron()))();
  } catch {
    enqueueError = "enqueue_failed";
  }

  try {
    drain = await (
      dependencies.drain
      ?? ((options: { limit?: number }) => runQueuedSourcingResearchWorkers(options))
    )({ limit: dependencies.drainLimit ?? 2 });
  } catch {
    drainError = "drain_failed";
  }

  return { enqueue, enqueueError, drain, drainError };
}
