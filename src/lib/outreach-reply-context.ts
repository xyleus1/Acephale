export const OUTREACH_REPLY_CONTEXT_BLOCKER =
  "Auto-reply is on but the campaign has no reply context. Add pitch, offer, FAQs and limits, or set reply mode to OFF.";

export function replyContextBlocker(replyMode: string, replyContext: unknown): string | null {
  if (replyMode === "OFF") return null;
  const context = replyContext && typeof replyContext === "object" && !Array.isArray(replyContext)
    ? replyContext as Record<string, unknown>
    : null;
  return typeof context?.pitch === "string" && context.pitch.trim() ? null : OUTREACH_REPLY_CONTEXT_BLOCKER;
}
