export const PROCUREMENT_REPLY_SENDER_UNAVAILABLE = "gmail_sender_unavailable" as const;

export class ProcurementReplySenderUnavailableError extends Error {
  readonly reason = PROCUREMENT_REPLY_SENDER_UNAVAILABLE;

  constructor(readonly accountEmail: string) {
    super(`This thread belongs to ${accountEmail}, but that Gmail inbox is disconnected or disabled for sending in this Derya office.`);
    this.name = "ProcurementReplySenderUnavailableError";
  }
}
