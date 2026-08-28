// A supplier that answered once and then went quiet needs a chase, not a new
// RFQ: the thread already carries the request files and the derived facts, so
// the follow up repeats them rather than asking the supplier to dig.
// The policy is pure so the loop is reproducible and every chase has a written
// reason, and it is bounded so a silent supplier is never mailed forever.

export const CHASE_QUIET_MS = 4 * 24 * 60 * 60_000;
export const MAX_SUPPLIER_CHASES = 2;

export type SupplierChaseDecision = {
  chase: boolean;
  reason: string;
};

export function supplierChaseDecision(args: {
  lastDirection: "INBOUND" | "OUTBOUND" | null;
  // The time of the newest message on the thread, which for a quiet supplier is
  // the reply we sent them.
  lastMessageAt: string | null;
  // Outbound messages already sent after the supplier's newest reply. The first
  // one is the answer they asked for, the rest are chases.
  chasesSent: number;
  hasQuote: boolean;
  now?: number;
}): SupplierChaseDecision {
  if (args.hasQuote) {
    return { chase: false, reason: "A supplier quote is already recorded." };
  }
  if (args.lastDirection !== "OUTBOUND") {
    return { chase: false, reason: "The thread is not waiting on the supplier." };
  }
  if (args.chasesSent >= MAX_SUPPLIER_CHASES) {
    return { chase: false, reason: "This supplier already had every follow up this request allows." };
  }
  const sentAt = args.lastMessageAt ? Date.parse(args.lastMessageAt) : Number.NaN;
  if (!Number.isFinite(sentAt)) {
    return { chase: false, reason: "The time of the last message on this thread is unknown." };
  }
  const quietFor = (args.now ?? Date.now()) - sentAt;
  if (quietFor < CHASE_QUIET_MS) {
    return { chase: false, reason: "The supplier has not answered the last message yet." };
  }
  const days = Math.floor(quietFor / (24 * 60 * 60_000));
  return {
    chase: true,
    reason: `The supplier has been quiet for ${days} days after our last message.`,
  };
}

// Outbound messages sent after the supplier's newest inbound message. A thread
// with no supplier reply at all is not a chase candidate, so it counts as none.
export function chasesSentAfterLastReply(
  messages: readonly { direction: "INBOUND" | "OUTBOUND" }[],
): number {
  let lastInbound = -1;
  messages.forEach((message, index) => {
    if (message.direction === "INBOUND") lastInbound = index;
  });
  if (lastInbound < 0) return 0;
  return Math.max(0, messages.slice(lastInbound + 1).filter((message) => message.direction === "OUTBOUND").length - 1);
}
