import type { AutopilotAction, AutopilotVendorState } from "@/lib/procurement-autopilot-plan";
import type { SupplierQuoteMissingFact } from "@/lib/procurement-supplier-quote-reading";

// A sourcing request only reaches a purchase order if every supplier thread
// keeps moving. Each pass of the loop decides one action per thread, so without
// a stage a thread that received its action and then stalled looks the same as
// one that is finished, and nothing brings it back. The stage says where a
// conversation stands and whether it still owes somebody an action, so a thread
// is either progressing, waiting on the supplier, finished, or named as needing
// a human. Nothing here reads or writes: it is the vocabulary the loop and the
// report share.

export type SupplierConversationStage =
  // Never mailed, so the thread owes a first contact rather than a reply.
  | "NOT_CONTACTED"
  // Mailed and the supplier has not answered at all.
  | "AWAITING_FIRST_REPLY"
  // The supplier is waiting on us.
  | "REPLY_UNANSWERED"
  // Our answer is written and waiting to leave.
  | "ANSWER_READY"
  // We answered and the supplier has said nothing commercial yet.
  | "AWAITING_QUOTE"
  // The supplier stated some commercial facts but not enough to buy on.
  | "QUOTE_INCOMPLETE"
  // A price and a lead time are recorded.
  | "QUOTED"
  // Only a human can move this thread: a bounce, a wrong contact, or a
  // question the request cannot answer.
  | "NEEDS_OPERATOR";

export type SupplierConversationInput = AutopilotVendorState & {
  // What the thread's own replies still leave unsaid. Empty means the supplier
  // said everything a purchase order needs, absent means nothing commercial was
  // read from the thread at all.
  missingQuoteFacts?: readonly SupplierQuoteMissingFact[] | null;
};

// Reached the end of the funnel: a recorded quote is what the request buys on,
// and it is the only stage that owes nobody anything. NOT_CONTACTED still owes
// a first contact, which the nudge path takes, and NEEDS_OPERATOR still owes
// an action, just not one the loop may take, so neither settles.
export const CONVERSATION_SETTLED_STAGES: readonly SupplierConversationStage[] = [
  "QUOTED",
];

export function supplierConversationStage(
  input: SupplierConversationInput,
): SupplierConversationStage {
  if (input.hasQuote) return "QUOTED";
  if (input.inboundKind === "BOUNCE" || input.inboundKind === "WRONG_RECIPIENT") return "NEEDS_OPERATOR";
  if (input.triageDecision === "NEEDS_HUMAN") return "NEEDS_OPERATOR";
  if (input.hasDraft) return "ANSWER_READY";
  // An automatic out of office notice is not an answer, so a thread holding one
  // is still waiting on the supplier rather than on us.
  if (input.lastDirection === "INBOUND" && input.inboundKind !== "AUTO_REPLY") return "REPLY_UNANSWERED";
  if (input.missingQuoteFacts?.length) return "QUOTE_INCOMPLETE";
  if (input.lastDirection === null) return "NOT_CONTACTED";
  return input.lastDirection === "OUTBOUND" || input.inboundKind === "AUTO_REPLY"
    ? "AWAITING_QUOTE"
    : "AWAITING_FIRST_REPLY";
}

// A stage owes an action while the conversation has not settled. The loop can
// take that action itself in every stage except NEEDS_OPERATOR, which is the
// only place a thread may legitimately wait on a person, and that is why it is
// reported by name rather than counted.
export function conversationOwesAction(stage: SupplierConversationStage): boolean {
  return !CONVERSATION_SETTLED_STAGES.includes(stage);
}

export type ConversationFunnel = {
  suppliers: number;
  stages: Record<SupplierConversationStage, number>;
  // Threads that still owe an action, whether the loop takes it or a person
  // does. A request is only finished when this reaches zero.
  owed: number;
  // Threads no pass can move, so they are the only ones a person has to look
  // at, and a request whose funnel stalls says so instead of looking finished.
  needsOperator: Array<{ vendorId: string; vendorName: string; reason: string }>;
  // Threads that stated some commercial facts and are short of a purchase
  // order, with what is still missing.
  quoteIncomplete: Array<{
    vendorId: string;
    vendorName: string;
    missing: SupplierQuoteMissingFact[];
  }>;
};

const EMPTY_STAGES: Record<SupplierConversationStage, number> = {
  NOT_CONTACTED: 0,
  AWAITING_FIRST_REPLY: 0,
  REPLY_UNANSWERED: 0,
  ANSWER_READY: 0,
  AWAITING_QUOTE: 0,
  QUOTE_INCOMPLETE: 0,
  QUOTED: 0,
  NEEDS_OPERATOR: 0,
};

export function conversationFunnel(
  entries: readonly { input: SupplierConversationInput; action?: AutopilotAction }[],
): ConversationFunnel {
  const stages = { ...EMPTY_STAGES };
  const needsOperator: ConversationFunnel["needsOperator"] = [];
  const quoteIncomplete: ConversationFunnel["quoteIncomplete"] = [];
  let owed = 0;
  for (const entry of entries) {
    const stage = supplierConversationStage(entry.input);
    stages[stage] += 1;
    if (conversationOwesAction(stage)) owed += 1;
    if (stage === "NEEDS_OPERATOR") {
      needsOperator.push({
        vendorId: entry.input.vendorId,
        vendorName: entry.input.vendorName,
        reason: entry.action?.reason ?? "This thread cannot be moved without an operator.",
      });
      continue;
    }
    if (stage === "QUOTE_INCOMPLETE") {
      quoteIncomplete.push({
        vendorId: entry.input.vendorId,
        vendorName: entry.input.vendorName,
        missing: [...(entry.input.missingQuoteFacts ?? [])],
      });
    }
  }
  return {
    suppliers: entries.length,
    stages,
    owed,
    needsOperator,
    quoteIncomplete,
  };
}
