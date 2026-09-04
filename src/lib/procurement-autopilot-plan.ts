import type { ProcurementInboundTriage, SupplierInboundKind } from "@/lib/procurement-inbound-triage";
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
  // Off by default. Only an explicit operator instruction turns supplier
  // facing sending on, and even then it covers file delivery and answers the
  // stored facts fully support, never price, terms, dates or legal replies.
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
  // Set for threads that can be chased. Left out by callers that only report a
  // plan, in which case a quiet thread stays untouched.
  lastMessageAt?: string | null;
  chasesSent?: number;
  // What the supplier's own replies still leave unsaid. A thread that priced
  // without dating (or dated without pricing) is one question away from a
  // purchase order, so the follow up asks for exactly that.
  missingQuoteFacts?: readonly SupplierQuoteMissingFact[] | null;
};

export type AutopilotAction =
  | { kind: "SEND_DRAFT"; reason: string }
  | { kind: "ASK_QUOTE_FACTS"; reason: string; missing: SupplierQuoteMissingFact[] }
  | { kind: "DRAFT_REPLY"; reason: string }
  | { kind: "CHASE"; reason: string }
  | { kind: "AWAIT_APPROVAL"; reason: string }
  | { kind: "ESCALATE"; reason: string }
  | { kind: "NONE"; reason: string };

export function planAutopilotVendorAction(
  state: AutopilotVendorState,
  policy: AutopilotPolicy,
): AutopilotAction {
  if (state.hasQuote) return { kind: "NONE", reason: "A supplier quote is already recorded." };
  if (state.inboundKind === "BOUNCE") {
    return { kind: "ESCALATE", reason: "Delivery bounced, so this supplier needs a new address." };
  }

  if (state.inboundKind === "WRONG_RECIPIENT") {
    return { kind: "ESCALATE", reason: "The supplier says this is the wrong contact." };
  }
  if (state.triageDecision === "NEEDS_HUMAN") {
    return { kind: "ESCALATE", reason: "The reply asks something the stored request facts do not answer." };
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

export type AutopilotStage = "COLLECTING_REPLIES" | "QUOTES_READY_FOR_PO";

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
    .map((entry) => ({ vendorId: entry.vendorId, vendorName: entry.vendorName, reason: entry.action.reason }));
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
