export const PROCUREMENT_REPLY_SENDER_UNAVAILABLE = "gmail_sender_unavailable" as const;

// Two different operator actions fix a missing sender, so the failure says
// which one it is: reconnect or resume the mailbox that owns the thread, or
// free up the shared sender pool the answer was allowed to fall back to.
export type ProcurementReplySenderBlock = "THREAD_MAILBOX" | "SENDER_POOL";

export class ProcurementReplySenderUnavailableError extends Error {
  readonly reason = PROCUREMENT_REPLY_SENDER_UNAVAILABLE;

  constructor(readonly accountEmail: string, readonly block: ProcurementReplySenderBlock = "THREAD_MAILBOX") {
    super(block === "SENDER_POOL"
      ? `This thread belongs to ${accountEmail}, which cannot send, and no mailbox in the shared sender pool is currently able to answer for it. Check the sender pool for mailboxes that are disconnected, disabled, paused, or at their daily send limit.`
      : `This thread belongs to ${accountEmail}, but that Gmail inbox is disconnected or disabled for sending in this Derya office.`);
    this.name = "ProcurementReplySenderUnavailableError";
  }
}
