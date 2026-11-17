/** A membership target does not imply independent autoregressive decoder scores. */
export const NEXT_BATCH_MEMBERSHIP = "next_batch_invocation_membership" as const;
export const LEGACY_NEXT_BATCH_HIT = "independent_next_batch_hit" as const;
export const CALIBRATED_MEMBERSHIP = "empirical_next_batch_membership" as const;
export type RawScoreSemantics = "autoregressive_binary_conditional" | "model_reported_marginal";

export function rawScoreSemantics(protocol: "rank_binary_v1" | "rank_marginals_v2"): RawScoreSemantics {
  return protocol === "rank_binary_v1" ? "autoregressive_binary_conditional" : "model_reported_marginal";
}
