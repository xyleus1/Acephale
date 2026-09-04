// Who runs a submitted sourcing request. Derya does every step of it now, from
// supplier discovery through outreach, replies and quote reading, and it writes
// the lifecycle status itself, so the external procurement worker is no longer
// woken when a request arrives. The owner stays configurable so a single
// environment variable, not a deploy, puts the worker back in the path.

export type ProcurementWorkflowOwner = "derya" | "bourne";

export function parseProcurementWorkflowOwner(value: unknown): ProcurementWorkflowOwner {
  return value === "bourne" ? "bourne" : "derya";
}

export function procurementWorkflowOwner(): ProcurementWorkflowOwner {
  return parseProcurementWorkflowOwner(process.env.PROCUREMENT_WORKFLOW_OWNER);
}

export function bourneWorkflowWakeEnabled(): boolean {
  return procurementWorkflowOwner() === "bourne";
}
