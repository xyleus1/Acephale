import { supplierReplyText } from "@/lib/procurement-inbound-triage";

const POSITIVE_REPLY = /\b(happy to (chat|talk|meet|connect)|let'?s (schedule|set up|book|talk|meet)|(schedule|book|set up) a (call|meeting|demo)|send (me )?(a|your) (calendar|calendly|availability)|(i'?m|we'?re|we are|i am) interested|sounds (good|great|interesting)|yes,? (please|let'?s)|(ok|okay) to (meet|buy|proceed)|(we|i) (can|could) (supply|quote|provide|do (this|that))|quote (is )?attached|please find (our|the) (quote|offer|pricing)|move forward|go ahead)\b/i;
const NEGATIVE_REPLY = /\b(not interested|no thanks|unsubscribe|remove me|not a fit|no longer)\b/i;

export function isPositiveReply(body: string | null | undefined) {
  const text = supplierReplyText(body ?? "");
  return Boolean(text && POSITIVE_REPLY.test(text) && !NEGATIVE_REPLY.test(text));
}
