export const STALE_RUN_MS = 300_000;

/**
 * Paid-provider calls one prospecting run may make across all of its batches
 * (enrichment: one domain search per company; verification: one check per
 * address). Past the budget the run keeps going on the free heuristics.
 */
export const PROSPECTING_PAID_BUDGET = { enrichmentCalls: 200, verificationCalls: 600 } as const;

export type ProspectingPaidUsage = {
  enrichmentCalls: number;
  /** Enrichment calls the provider charged for (a search that returned contacts). */
  enrichmentBillable: number;
  verificationCalls: number;
};

export const EMPTY_PAID_USAGE: ProspectingPaidUsage = { enrichmentCalls: 0, enrichmentBillable: 0, verificationCalls: 0 };

/** Paid calls a run may still make before it falls back to heuristics only. */
export function remainingPaidBudget(usage: ProspectingPaidUsage) {
  return {
    enrichmentCalls: Math.max(0, PROSPECTING_PAID_BUDGET.enrichmentCalls - usage.enrichmentCalls),
    verificationCalls: Math.max(0, PROSPECTING_PAID_BUDGET.verificationCalls - usage.verificationCalls),
  };
}
