// ABSOLUTE RULE (Mert, 2026-07-21): nothing Derya emits ever contains an em
// dash. Static copy was swept repo-wide; this helper is the choke-point
// guard for DYNAMIC text (LLM drafts, operator input, sheet data echoed back
// into emails/WhatsApp). Applied at every outbound send path.

export function stripEmDashes(text: string): string {
  return text.replace(/ — /g, " - ").replace(/—/g, "-");
}

// One-line style rule to append to LLM prompts that generate prose.
export const NO_EM_DASH_PROMPT_RULE =
  "Never use the em dash character in your output. Use a comma, colon, period, or plain hyphen instead.";
