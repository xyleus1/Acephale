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
  // Sourcing found the supplier but no address to mail, or the address is
  // suppressed after a complaint or opt out, so there is no conversation to
  // carry and no action the loop can take.
  | "NO_CONTACT_METHOD"
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
  // The supplier told us to stop writing to it and named nowhere else, so the
  // request is no longer pursuing it. The row and its thread are kept.
  | "SUPPLIER_FADED"
  // Only a human can move this thread: a bounce, or a question the request
  // cannot answer.
  | "NEEDS_OPERATOR";

export type SupplierConversationInput = AutopilotVendorState & {
  // What the thread's own replies still leave unsaid. Empty means the supplier
  // said everything a purchase order needs, absent means nothing commercial was
  // read from the thread at all.
  missingQuoteFacts?: readonly SupplierQuoteMissingFact[] | null;
  // Whether this supplier has ever answered. A pass reads a thread only for
  // suppliers that replied, so for everybody else this is all the request
  // knows, and a contacted supplier who never answered is waiting on a first
  // reply rather than on a quote.
  repliedEver?: boolean;
  // Whether the request holds an address for this supplier. Absent means the
  // caller did not look, which is the case for every thread a pass read, since
  // a thread only exists because we mailed somebody.
  contactable?: boolean;
};

// Reached the end of the funnel: a recorded quote is what the request buys on,
// and it is the only stage that owes nobody anything. NOT_CONTACTED still owes
// a first contact, which the nudge path takes, and NEEDS_OPERATOR still owes
// an action, just not one the loop may take, so neither settles.
export const CONVERSATION_SETTLED_STAGES: readonly SupplierConversationStage[] = [
  "QUOTED",
];

// A supplier row with no address was never a conversation: sourcing found the
// shop but no way to reach it, so no pass can move it and counting it as owed
// would bury the threads that are genuinely stalled. It keeps its own stage so
// the gap stays visible instead of disappearing into the contacted count.
export const CONVERSATION_UNREACHABLE_STAGES: readonly SupplierConversationStage[] = [
  "NO_CONTACT_METHOD",
  // A shop that says it is the wrong place and names no other address is not a
  // thread anybody can move, so it owes nothing and is not reported as work
  // waiting on a person either.
  "SUPPLIER_FADED",
];

export function supplierConversationStage(
  input: SupplierConversationInput,
): SupplierConversationStage {
  if (input.hasQuote) return "QUOTED";
  if (input.suppressed === "BOUNCED" || input.suppressed === "UNDELIVERABLE") {
    return "NEEDS_OPERATOR";
  }
  if (input.suppressed) return "NO_CONTACT_METHOD";
  if (input.inboundKind === "BOUNCE") return "NEEDS_OPERATOR";
  if (input.inboundKind === "WRONG_RECIPIENT") {
    // A wrong contact is worked by the loop: it either moves to another address
    // at the same supplier, which puts the thread back at a first contact, or it
    // fades. Only a recovery that could not be written needs a person.
    if (input.wrongContactRecovery === "RESOURCED") return "NOT_CONTACTED";
    if (input.wrongContactRecovery === "FADED") return "SUPPLIER_FADED";
    return "NEEDS_OPERATOR";
  }
  if (input.triageDecision === "NEEDS_HUMAN") return "NEEDS_OPERATOR";
  if (input.hasDraft) return "ANSWER_READY";
  // An automatic out of office notice is not an answer, so a thread holding one
  // is still waiting on the supplier rather than on us.
  if (input.lastDirection === "INBOUND" && input.inboundKind !== "AUTO_REPLY") return "REPLY_UNANSWERED";
  if (input.missingQuoteFacts?.length) return "QUOTE_INCOMPLETE";
  if (input.lastDirection === null) {
    return input.contactable === false ? "NO_CONTACT_METHOD" : "NOT_CONTACTED";
  }
  if (input.repliedEver === false) return "AWAITING_FIRST_REPLY";
  return input.lastDirection === "OUTBOUND" || input.inboundKind === "AUTO_REPLY"
    ? "AWAITING_QUOTE"
    : "AWAITING_FIRST_REPLY";
}

// The funnel has to cover the whole request, not only the threads a pass read:
// a reply scan walks the suppliers that answered, so a request with hundreds of
// silent suppliers would otherwise report nothing owed and look finished. A
// supplier whose thread was not read still has a stage, because the request
// records whether we mailed them, whether they ever answered, and whether a
// quote is recorded.
//
// What the request cannot say without reading the thread is who spoke last, so
// a supplier who has answered at some point is reported as waiting on us. That
// errs toward attention: a thread wrongly called REPLY_UNANSWERED is read by a
// later pass and corrected, while one wrongly called AWAITING_QUOTE hides a
// reply nobody answered, which is the failure this funnel exists to catch.
export function unreadConversationInput(vendor: {
  id: string;
  name: string;
  contacted: boolean;
  responseCount: number;
  quote: Record<string, unknown> | null;
  contact?: { email: string | null } | null;
}): SupplierConversationInput {
  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    lastDirection: vendor.contacted
      ? (vendor.responseCount > 0 ? "INBOUND" : "OUTBOUND")
      : null,
    inboundKind: null,
    triageDecision: null,
    hasDraft: false,
    hasQuote: Boolean(vendor.quote),
    repliedEver: vendor.responseCount > 0,
    // A caller that did not project the contact at all leaves this unknown, and
    // an unknown address is treated as mailable so the supplier stays owed work
    // rather than being written off on missing data.
    contactable: "contact" in vendor
      ? Boolean(vendor.contact?.email?.includes("@"))
      : undefined,
  };
}

// A stage owes an action while the conversation has not settled. The loop can
// take that action itself in every stage except NEEDS_OPERATOR, which is the
// only place a thread may legitimately wait on a person, and that is why it is
// reported by name rather than counted.
export function conversationOwesAction(stage: SupplierConversationStage): boolean {
  return !CONVERSATION_SETTLED_STAGES.includes(stage)
    && !CONVERSATION_UNREACHABLE_STAGES.includes(stage);
}

export type ConversationFunnel = {
  suppliers: number;
  stages: Record<SupplierConversationStage, number>;
  // Threads that still owe an action, whether the loop takes it or a person
  // does. A request is only finished when this reaches zero.
  owed: number;
  // Threads no pass can move, so they are the only ones a person has to look
  // at, and a request whose funnel stalls says so instead of looking finished.
  needsOperator: Array<{
    vendorId: string;
    vendorName: string;
    reason: string;
    // The supplier's own words where the thread stalled on a question, so the
    // person who has to answer it reads it here instead of in the mailbox.
    questions: string[];
  }>;
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
  NO_CONTACT_METHOD: 0,
  AWAITING_FIRST_REPLY: 0,
  REPLY_UNANSWERED: 0,
  ANSWER_READY: 0,
  AWAITING_QUOTE: 0,
  QUOTE_INCOMPLETE: 0,
  QUOTED: 0,
  SUPPLIER_FADED: 0,
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
        questions: entry.action?.kind === "ESCALATE"
          ? [...(entry.action.questions ?? [])]
          : [...(entry.input.unansweredQuestions ?? [])],
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
