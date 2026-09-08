import type { ProcurementInboundTriage, SupplierInboundKind } from "@/lib/procurement-inbound-triage";
import type { EmailSuppressionReason } from "@/lib/email-delivery-feedback";
import { supplierChaseDecision } from "@/lib/procurement-supplier-chase";
import {
  SUPPLIER_QUOTE_MISSING_FACT_ASK,
  type SupplierQuoteMissingFact,
} from "@/lib/procurement-supplier-quote-reading";

// The autopilot decides what a sourcing request needs next from the state of
// each supplier thread. The decision is a pure function so the loop is
// reproducible and reviewable, and so no supplier facing action can be taken
// for a reason that is not written down here.

export const AUTOPILOT_QUOTES_FOR_PO = 3;

export type AutopilotPolicy = {
  // The scheduled pass turns sending on, while price, terms, dates and legal
  // issues still escalate rather than being answered automatically.
  autoSend: boolean;
  // Injected by tests so a chase decision is reproducible.
  now?: number;
};

export type AutopilotVendorState = {
  vendorId: string;
  vendorName: string;
  lastDirection: "INBOUND" | "OUTBOUND" | null;
  inboundKind: SupplierInboundKind | null;
  triageDecision: ProcurementInboundTriage["decision"] | null;
  hasDraft: boolean;
  hasQuote: boolean;
  suppressed?: EmailSuppressionReason | null;
  // Set for threads that can be chased. Left out by callers that only report a
  // plan, in which case a quiet thread stays untouched.
  lastMessageAt?: string | null;
  chasesSent?: number;
  // What the supplier's own replies still leave unsaid. A thread that priced
  // without dating (or dated without pricing) is one question away from a
  // purchase order, so the follow up asks for exactly that.
  missingQuoteFacts?: readonly SupplierQuoteMissingFact[] | null;
  // What the supplier asked that the stored request facts do not answer. An
  // escalation saying only that a question went unanswered sends an operator
  // into the mailbox to find out which one, so the question travels with it.
  unansweredQuestions?: readonly string[] | null;
  // What this pass did with a wrong contact reply, so the plan reports the
  // recovery rather than the notice, and only a recovery that could not be
  // written reaches a person.
  wrongContactRecovery?: "RESOURCED" | "FADED" | "FAILED" | null;
  draftBinding?: {
    taskId: string;
    inputHash: string;
  } | null;
};

export function autopilotDraftBindingMatches(
  state: AutopilotVendorState,
  draft: { taskId?: string | null; inputHash?: string | null } | null,
) {
  return Boolean(
    state.draftBinding
      && draft?.taskId
      && draft.inputHash
      && state.draftBinding.taskId === draft.taskId
      && state.draftBinding.inputHash === draft.inputHash,
  );
}

export type AutopilotAction =
  | { kind: "SEND_DRAFT"; reason: string }
  | { kind: "ASK_QUOTE_FACTS"; reason: string; missing: SupplierQuoteMissingFact[] }
  | { kind: "DRAFT_REPLY"; reason: string }
  | { kind: "CHASE"; reason: string }
  | { kind: "AWAIT_APPROVAL"; reason: string }
  | { kind: "RESOURCE_CONTACT"; reason: string }
  | { kind: "ESCALATE"; reason: string; questions?: string[] }
  | { kind: "NONE"; reason: string };

export function planAutopilotVendorAction(
  state: AutopilotVendorState,
  policy: AutopilotPolicy,
): AutopilotAction {
  if (state.hasQuote) return { kind: "NONE", reason: "A supplier quote is already recorded." };
  if (state.suppressed === "BOUNCED" || state.suppressed === "UNDELIVERABLE") {
    return { kind: "ESCALATE", reason: "Delivery bounced, so this supplier needs a new address." };
  }
  if (state.suppressed) {
    return { kind: "NONE", reason: "This address is suppressed (complaint or opt out), so it is not contacted again." };
  }
  if (state.inboundKind === "BOUNCE") {
    return { kind: "ESCALATE", reason: "Delivery bounced, so this supplier needs a new address." };
  }

  if (state.inboundKind === "WRONG_RECIPIENT") {
    // A shop that read the RFQ and named somebody else is not work for a person:
    // the request moves to another address at the same supplier, and fades the
    // row when the supplier offers none, so it neither sits escalated nor holds
    // the request open.
    if (state.wrongContactRecovery === "FAILED") {
      return { kind: "ESCALATE", reason: "The supplier says this is the wrong contact and no other address could be recorded." };
    }
    return {
      kind: "RESOURCE_CONTACT",
      reason: state.wrongContactRecovery === "RESOURCED"
        ? "The supplier named another address, so the RFQ goes there."
        : state.wrongContactRecovery === "FADED"
          ? "The supplier says this is the wrong contact and offers no other address, so it leaves the funnel."
          : "The supplier says this is the wrong contact, so another address at the same supplier is tried.",
    };
  }
  if (state.triageDecision === "NEEDS_HUMAN") {
    const questions = [...(state.unansweredQuestions ?? [])].filter((question) => question.trim());
    return {
      kind: "ESCALATE",
      reason: "The reply asks something the stored request facts do not answer.",
      ...(questions.length ? { questions } : {}),
    };
  }
  if (state.hasDraft) {
    return policy.autoSend
      ? { kind: "SEND_DRAFT", reason: "A saved reply carrying the request files is ready to deliver." }
      : { kind: "AWAIT_APPROVAL", reason: "A saved reply is waiting for an operator to confirm delivery." };
  }
  // An automatic out of office notice is not an answer, so a thread holding one
  // is not waiting on us and is not finished either: it goes back to the quiet
  // thread follow up rather than resting on a notice forever.
  const answered = state.lastDirection === "INBOUND" && state.inboundKind !== "AUTO_REPLY";
  if (answered) {
    return { kind: "DRAFT_REPLY", reason: "The supplier replied and the request files answer it." };
  }
  if (state.lastDirection !== null) {
    // A supplier that replied once and then went quiet is chased on the same
    // thread, carrying the same request files, up to the bounded limit.
    const chase = supplierChaseDecision({
      lastDirection: "OUTBOUND",
      lastMessageAt: state.lastMessageAt ?? null,
      chasesSent: state.chasesSent ?? 0,
      hasQuote: state.hasQuote,
      now: policy.now,
    });
    const missing = [...(state.missingQuoteFacts ?? [])];
    // A supplier who already stated part of a quote is worth one precise
    // question, and that question is not the generic package chase, so it is
    // planned as its own action and reported as its own reason.
    if (chase.chase && missing.length) {
      return {
        kind: "ASK_QUOTE_FACTS",
        reason: `${chase.reason} The reply is short of ${missing.map((fact) => SUPPLIER_QUOTE_MISSING_FACT_ASK[fact]).join(" and ")}.`,
        missing,
      };
    }
    return chase.chase
      ? { kind: "CHASE", reason: chase.reason }
      : { kind: "NONE", reason: chase.reason };
  }
  return { kind: "NONE", reason: "This supplier has no thread yet." };
}

const AUTOPILOT_ACTION_PAGE_PRIORITY: Record<AutopilotAction["kind"], number> = {
  SEND_DRAFT: 0,
  DRAFT_REPLY: 1,
  ASK_QUOTE_FACTS: 2,
  CHASE: 3,
  RESOURCE_CONTACT: 4,
  ESCALATE: 5,
  AWAIT_APPROVAL: 6,
  NONE: 7,
};

// A runtime packet is intentionally bounded, while a procurement request can
// contain more suppliers than one packet may carry. Select suppliers whose
// state can advance first. Once a draft is created or sent, its action changes
// and the still-actionable suppliers naturally move into the next page.
export function selectAutopilotVendorPage(
  states: readonly AutopilotVendorState[],
  policy: AutopilotPolicy,
  limit: number,
) {
  const bounded = Math.max(1, Math.trunc(limit));
  return states
    .map((state, index) => ({
      state,
      index,
      priority: AUTOPILOT_ACTION_PAGE_PRIORITY[planAutopilotVendorAction(state, policy).kind],
    }))
    .sort((left, right) => (
      left.priority - right.priority
      || left.index - right.index
      || left.state.vendorId.localeCompare(right.state.vendorId)
    ))
    .slice(0, bounded)
    .map(({ state }) => state);
}

export type AutopilotStage = "COLLECTING_REPLIES" | "QUOTES_READY_FOR_PO";

export type AutopilotGoal = { quotes: number; quoteGoal: number | null };

export function autopilotGoalReached(goal: AutopilotGoal): boolean {
  return goal.quoteGoal !== null
    && goal.quotes >= Math.max(1, Math.trunc(goal.quoteGoal));
}

export function autopilotNudgeBudget(limit: number, deliverable: number): number {
  return Math.max(0, limit - Math.min(limit, deliverable));
}

// A request is only called PO ready when enough real quotes exist to compare.
// Drafts, replies and interest never count as a quote.
export function autopilotRequestStage(args: { quotes: number; required?: number }): AutopilotStage {
  const required = Math.max(1, Math.trunc(args.required ?? AUTOPILOT_QUOTES_FOR_PO));
  return args.quotes >= required ? "QUOTES_READY_FOR_PO" : "COLLECTING_REPLIES";
}

export function autopilotEscalations(
  plan: readonly { vendorId: string; vendorName: string; action: AutopilotAction }[],
) {
  return plan
    .filter((entry) => entry.action.kind === "ESCALATE")
    .map((entry) => ({
      vendorId: entry.vendorId,
      vendorName: entry.vendorName,
      reason: entry.action.reason,
      questions: entry.action.kind === "ESCALATE" ? entry.action.questions ?? [] : [],
    }));
}

export type AutopilotFailure = {
  vendorId: string;
  vendorName: string;
  error: string;
};

export type AutopilotOutcome = {
  vendorId: string;
  vendorName: string;
  state: string;
  error?: string | null;
};

// Every pass of the loop can fail in a way an operator has to see: a delivery
// that never left, or a priced reply that could not be recorded and so stays
// invisible to the request. Each source names the work that failed, and the
// stored message is the opaque one, so a driver or provider error never leaks.
export function autopilotFailures(args: {
  chase: readonly AutopilotFailure[];
  draft?: readonly AutopilotOutcome[];
  nudge?: readonly AutopilotOutcome[];
  send?: readonly AutopilotOutcome[];
  quote?: readonly AutopilotOutcome[];
}): AutopilotFailure[] {
  const collected = (
    outcomes: readonly AutopilotOutcome[] | undefined,
    failed: (state: string) => boolean,
    fallback: string,
  ) => (outcomes ?? [])
    .filter((outcome) => failed(outcome.state))
    .map((outcome) => ({
      vendorId: outcome.vendorId,
      vendorName: outcome.vendorName,
      error: outcome.error ?? fallback,
    }));
  return [
    ...args.chase,
    // A reply that cannot even be drafted never reaches a supplier, and a
    // target that fails every pass would otherwise be silent, so it is named
    // here.
    ...collected(
      args.draft,
      (state) => state === "FAILED",
      "The supplier reply draft failed.",
    ),
    ...collected(
      args.nudge,
      (state) => state !== "SENT" && state !== "ALREADY_SENT",
      "The supplier follow up failed.",
    ),
    // A send refused for stale state needs an operator as much as one that
    // failed in transport: the draft has to be rebuilt before it can go.
    ...collected(
      args.send,
      (state) => state === "FAILED" || state === "STALE",
      "The supplier send failed.",
    ),
    ...collected(args.quote, (state) => state === "FAILED", "The supplier quote could not be recorded."),
  ];
}

// A pass can only work a few requests, so the requests whose conversations owe
// an action right now lead the queue, in the order their work came due. The
// rotated queue follows, so a request with no stored task is still reached and
// nothing is starved by a request that keeps failing.
export function prioritizeAutopilotQueue(
  queue: readonly string[],
  dueOrderIds: readonly string[],
): string[] {
  const eligible = new Set(queue);
  const ordered: string[] = [];
  for (const orderId of [...dueOrderIds, ...queue]) {
    if (!eligible.has(orderId) || ordered.includes(orderId)) continue;
    ordered.push(orderId);
  }
  return ordered;
}

// A scheduled pass cannot always reach every request inside one invocation, so
// the queue is rotated by the window the pass belongs to: a request left behind
// by one pass is worked first by a later one instead of never being reached.
export const AUTOPILOT_ROTATION_WINDOW_MS = 900_000;

// The queue advances by one request per window, whatever a pass managed to
// work: a step the size of a pass would skip whatever the pass did not reach,
// and a step sharing a factor with the queue length would visit only part of
// the queue forever. One request per window visits every position in turn, so
// every request leads a pass within one queue length of windows.
export function rotateAutopilotQueue<T>(items: readonly T[], startedAt: number): T[] {
  if (items.length < 2 || !Number.isFinite(startedAt)) return [...items];
  const windows = Math.floor(Math.max(0, startedAt) / AUTOPILOT_ROTATION_WINDOW_MS);
  const offset = windows % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

export function rotateAutopilotOrderIds(orderIds: readonly string[], startedAt: number): string[] {
  return rotateAutopilotQueue(orderIds, startedAt);
}
