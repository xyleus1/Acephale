import Gpt56Client from "./gpt56-client";

const gpt56 = process.env.OPENAI_API_KEY
  ? new Gpt56Client({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ── Meeting note from raw transcript ────────────────────────────────────────

export async function buildMeetingNote(rawTranscript: string): Promise<string | null> {
  if (!rawTranscript.trim()) return null;

  if (gpt56) {
    try {
      const msg = await gpt56.messages.create({
        model: "gpt-5.6",
        max_tokens: 600,
        messages: [
          {
            role: "user",
            content: `You are a freight forwarding CRM assistant. Convert the following raw meeting/call transcript into a concise, professional corporate meeting note in the same language as the transcript.

Structure:
- Summary (2-3 sentences)
- Key points discussed
- Next actions (concrete, with who does what)

Keep it under 250 words. Be factual and direct.

Transcript:
${rawTranscript}`,
          },
        ],
      });
      const block = msg.content[0];
      return block.type === "text" ? block.text : null;
    } catch (e) {
      console.error("GPT-5.6 meeting note error:", e);
    }
  }

  // Fallback: rule-based
  return buildMeetingNoteFallback(rawTranscript);
}

function buildMeetingNoteFallback(rawInput: string): string {
  const normalized = rawInput.replace(/\s+/g, " ").trim();
  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences.slice(0, 2).join(" ");
  const actions = sentences
    .filter((s) => /will|next|plan|follow|send|prepare|share|call|visit/i.test(s))
    .slice(0, 3);
  return [
    "Meeting Note",
    "",
    "Summary:",
    summary || normalized,
    "",
    "Next Actions:",
    actions.length > 0
      ? actions.map((a) => `- ${a}`).join("\n")
      : "- Follow up with customer on discussed points.",
  ].join("\n");
}

// ── Email draft ──────────────────────────────────────────────────────────────

export async function buildEmailDraft(input: {
  customerName: string;
  purpose: string;
  context?: string;
  senderName?: string;
}): Promise<string> {
  const { customerName, purpose, context, senderName = "Sales Team" } = input;

  if (gpt56) {
    try {
      const msg = await gpt56.messages.create({
        model: "gpt-5.6",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `You are a freight forwarding sales assistant. Write a short, professional sales email.

Customer: ${customerName}
Purpose: ${purpose}
${context ? `Context: ${context}` : ""}
Sender: ${senderName}

Requirements:
- Include Subject: line at the top
- Professional but warm tone
- Focused on freight forwarding business
- Under 150 words
- End with a clear call to action
- Write in the same language as the purpose/context if not English`,
          },
        ],
      });
      const block = msg.content[0];
      return block.type === "text" ? block.text : buildEmailDraftFallback(input);
    } catch (e) {
      console.error("GPT-5.6 email draft error:", e);
    }
  }

  return buildEmailDraftFallback(input);
}

function buildEmailDraftFallback(input: {
  customerName: string;
  purpose: string;
  context?: string;
  senderName?: string;
}): string {
  return [
    `Subject: ${input.customerName} – ${input.purpose}`,
    "",
    `Dear ${input.customerName} team,`,
    "",
    `Thank you for your time. This is a follow-up regarding: ${input.purpose}.`,
    input.context ? `Context: ${input.context}` : "",
    "",
    "Please confirm your availability and we will proceed accordingly.",
    "",
    `Best regards,`,
    input.senderName ?? "Sales Team",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}
