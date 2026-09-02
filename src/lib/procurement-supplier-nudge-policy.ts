// A supplier that never answered the first RFQ has no inbound message, so the
// reply path cannot chase it. This is the policy for chasing our own outbound
// RFQ instead, kept deterministic and free of database access so the rule is
// testable on its own.

export const NUDGE_QUIET_MS = 4 * 24 * 60 * 60_000;
export const MAX_SUPPLIER_NUDGES = 2;

export type SupplierNudgeDecision =
  | { nudge: true; round: number; reason: string }
  | { nudge: false; reason: string };

export function supplierNudgeDecision(args: {
  hasQuote: boolean;
  hasInboundReply: boolean;
  rfqRecorded: boolean;
  lastOutboundAt: number | null;
  nudgesSent: number;
  now?: number;
}): SupplierNudgeDecision {
  if (args.hasQuote) {
    return { nudge: false, reason: "A supplier quote is already recorded." };
  }
  if (!args.rfqRecorded) {
    return {
      nudge: false,
      reason: "The first RFQ send was not recorded against a thread, so a follow up has nothing to reply to.",
    };
  }
  if (args.hasInboundReply) {
    return { nudge: false, reason: "The supplier replied, so the reply path owns this thread." };
  }
  if (args.nudgesSent >= MAX_SUPPLIER_NUDGES) {
    return { nudge: false, reason: "This supplier already had every follow up this request allows." };
  }
  if (!args.lastOutboundAt || !Number.isFinite(args.lastOutboundAt)) {
    return { nudge: false, reason: "The time of our last message on this thread is unknown." };
  }
  const quietFor = (args.now ?? Date.now()) - args.lastOutboundAt;
  if (quietFor < NUDGE_QUIET_MS) {
    return { nudge: false, reason: "The supplier has not been quiet long enough yet." };
  }
  const days = Math.floor(quietFor / (24 * 60 * 60_000));
  return {
    nudge: true,
    round: args.nudgesSent + 1,
    reason: `The supplier never answered and has been quiet for ${days} days.`,
  };
}
