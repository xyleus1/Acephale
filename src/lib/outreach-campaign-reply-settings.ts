import type { OutreachReplyContext } from "@/lib/outreach-campaign-reply-prompt";

export function replyModeInput(value: unknown, optional = false): "AUTO" | "DRAFT" | "OFF" | undefined {
  if (value === undefined && optional) return undefined;
  if (value !== "AUTO" && value !== "DRAFT" && value !== "OFF") {
    throw new Error("replyMode must be AUTO, DRAFT, or OFF.");
  }
  return value;
}

export function replyContextInput(value: unknown, optional = false): OutreachReplyContext | null | undefined {
  if (value === undefined && optional) return undefined;
  if (value === null && optional) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("replyContext must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (typeof input.pitch !== "string" || !input.pitch.trim()) {
    throw new Error("replyContext.pitch must be a non-empty string.");
  }
  const strings = (key: string) => {
    const item = input[key];
    if (item === undefined) return undefined;
    if (!Array.isArray(item) || item.some((entry) => typeof entry !== "string")) {
      throw new Error(`replyContext.${key} must be an array of strings.`);
    }
    return item.map((entry) => (entry as string).trim()).filter(Boolean);
  };
  const faqs = input.faqs === undefined
    ? undefined
    : Array.isArray(input.faqs)
      ? input.faqs.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error("replyContext.faqs must contain question and answer objects.");
        }
        const faq = item as Record<string, unknown>;
        if (typeof faq.question !== "string" || typeof faq.answer !== "string") {
          throw new Error("replyContext.faqs must contain question and answer strings.");
        }
        return { question: faq.question.trim(), answer: faq.answer.trim() };
      })
      : (() => {
        throw new Error("replyContext.faqs must be an array.");
      })();
  const optionalText = (key: string) => {
    if (input[key] === undefined || input[key] === null) return input[key] as null | undefined;
    if (typeof input[key] !== "string") throw new Error(`replyContext.${key} must be a string or null.`);
    return (input[key] as string).trim();
  };
  return {
    pitch: input.pitch.trim(),
    offer: optionalText("offer"),
    facts: strings("facts"),
    faqs,
    limits: strings("limits"),
    escalate: strings("escalate"),
    signature: optionalText("signature"),
  };
}
