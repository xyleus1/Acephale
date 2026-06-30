"use server";

import Anthropic from "@anthropic-ai/sdk";

// Single Haiku call that maps a user message to one of the agent's
// executable verbs. Used as a SAFETY NET — fast regex layer runs first; if
// regex says "no action" but the user clearly meant one, this catches it.
//
// Returns "chat" when the message is a question/statement, not a command.

export type AgentIntent =
  | { intent: "merge-all-into-one"; type?: "SOURCING" | "FORWARDING"; subject?: string; commodity?: string; origin?: string; destination?: string; weightKg?: number }
  | { intent: "dedup" }
  | { intent: "populate-load" }
  | { intent: "award-supplier"; supplierHint?: string }
  | { intent: "draft-reply"; target?: string }
  | { intent: "needs-reply" }
  | { intent: "stuck-jobs" }
  | { intent: "morning-brief" }
  | { intent: "hide-unrelated" }
  | { intent: "summarize-offers"; sortBy?: "price" | "landed" | "lead-time" }
  | { intent: "summarize-rates" }
  | { intent: "chat" };

export async function classifyAgentIntent(args: {
  userMessage: string;
  scopeJobId?: string;
  scopeJobType?: "SOURCING" | "FORWARDING";
}): Promise<AgentIntent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { intent: "chat" };

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    system: `You classify the operator's message to a freight platform's agent into ONE executable action. Output ONLY the JSON, no preamble.

Schema:
{ "intent": "<one of below>", ...optional intent-specific fields }

Action verbs (intents):
- "merge-all-into-one" — operator wants to consolidate multiple inquiries/jobs/RFQs into ONE umbrella job. Triggers: "merge them all", "consolidate", "they're all the same", "categorize under one", "group these", "bundle these procurement deals", "the X jobs are duplicates so combine". Optional fields:
    "type": "SOURCING" if they say procurement/sourcing/buying, "FORWARDING" if they say forwarding/shipping.
    "subject": short headline string if operator describes the consolidated deal (e.g. "Soybean meal — 300 MT to Ashgabat" → "Soybean meal procurement, 300 MT to Ashgabat").
    "commodity": commodity name if mentioned (e.g. "soybean meal", "corn gluten", "wheat").
    "destination": destination city/country if mentioned (e.g. "Ashgabat", "Hamburg, DE").
    "origin": origin if mentioned.
    "weightKg": weight in KILOGRAMS if mentioned. Convert MT/tons → kg by ×1000. "300 MT" → 300000.
- "dedup" — find and remove DUPLICATE inquiries (same exact deal duplicated). "find duplicates", "dedupe".
- "populate-load" — scoped only: extract job fields from linked emails. "create load details", "populate from emails", "fill in the job". Requires scopeJobId.
- "award-supplier" — scoped to SOURCING job: pick a winning supplier. "award the cheapest", "go with X", "select best offer". Optional field: "supplierHint": short name fragment if mentioned.
- "draft-reply" — scoped: write an email reply. "draft a reply", "write back", "compose response". Optional field: "target": stance hint like "counter at $480", "ask for sample".
- "needs-reply" — list threads awaiting reply. "what needs reply", "what's pending", "who's waiting on me".
- "stuck-jobs" — list stale jobs. "what's stuck", "stale jobs", "what needs attention".
- "morning-brief" — pipeline snapshot. "morning briefing", "what's on my plate", "state of pipeline", "daily digest".
- "hide-unrelated" — bulk hide noise threads. "hide unrelated", "dismiss the noise", "clean up the inbox".
- "summarize-offers" — scoped to a SOURCING job: list all supplier offers ranked by price/landed cost. Triggers: "summary of the best rates", "what are the supplier offers", "what's the cheapest offer", "best price for this load", "compare supplier prices", "show me what suppliers quoted", "how much are they asking". Optional field "sortBy": "price" (default) | "landed" | "lead-time".
- "summarize-rates" — scoped to a FORWARDING job: list carrier rate replies. Triggers: same as above but on a forwarding/shipping job.
- "chat" — anything else. Questions, statements, ambiguous messages, or commands the agent can't execute.

Rules:
- If unsure between an action and chat, choose chat. False action triggers are worse than false chats.
- If the user is asking a question (starts with what/where/who/why/how, or ends in ?), it's almost always "chat" UNLESS it explicitly contains an action verb followed by an actionable noun.
- "merge", "consolidate", "combine", "bundle", "categorize", "group", "smush", "fold together" all imply merge-all-into-one when paired with multiple things, all/them/these, or "same".
- Statements like "they are all the same" or "these are duplicates" → merge-all-into-one (operator intent is to fix the duplication).
- Don't classify pure descriptions of the inbox state as actions.

Context:
- Operator is ${args.scopeJobId ? `focused on job ${args.scopeJobId} (type=${args.scopeJobType})` : "viewing the office at large (no specific job in focus)"}.
- Today: ${new Date().toISOString().split("T")[0]}`,
    messages: [{ role: "user", content: args.userMessage }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { intent: "chat" };
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return { intent: "chat" }; }

  const valid = new Set([
    "merge-all-into-one", "dedup", "populate-load", "award-supplier",
    "draft-reply", "needs-reply", "stuck-jobs", "morning-brief",
    "hide-unrelated", "chat",
  ]);
  if (!valid.has(parsed.intent)) return { intent: "chat" };

  // Strip scope-required intents that don't have a job in scope.
  if ((parsed.intent === "populate-load" || parsed.intent === "award-supplier" ||
       parsed.intent === "draft-reply" || parsed.intent === "summarize-offers" ||
       parsed.intent === "summarize-rates")
      && !args.scopeJobId) {
    return { intent: "chat" };
  }
  if (parsed.intent === "award-supplier" && args.scopeJobType !== "SOURCING") {
    return { intent: "chat" };
  }
  if (parsed.intent === "summarize-offers" && args.scopeJobType !== "SOURCING") {
    // Operator asked for offers but the job is forwarding — re-route.
    return { intent: "summarize-rates" };
  }
  if (parsed.intent === "summarize-rates" && args.scopeJobType === "SOURCING") {
    return { intent: "summarize-offers" };
  }

  if (parsed.intent === "merge-all-into-one") {
    const t = parsed.type;
    return {
      intent: "merge-all-into-one",
      type: t === "SOURCING" || t === "FORWARDING" ? t : undefined,
      subject: typeof parsed.subject === "string" ? parsed.subject.slice(0, 200) : undefined,
      commodity: typeof parsed.commodity === "string" ? parsed.commodity.slice(0, 200) : undefined,
      origin: typeof parsed.origin === "string" ? parsed.origin.slice(0, 100) : undefined,
      destination: typeof parsed.destination === "string" ? parsed.destination.slice(0, 100) : undefined,
      weightKg: typeof parsed.weightKg === "number" ? parsed.weightKg : undefined,
    };
  }
  if (parsed.intent === "award-supplier") {
    return { intent: "award-supplier", supplierHint: typeof parsed.supplierHint === "string" ? parsed.supplierHint : undefined };
  }
  if (parsed.intent === "draft-reply") {
    return { intent: "draft-reply", target: typeof parsed.target === "string" ? parsed.target : undefined };
  }
  if (parsed.intent === "summarize-offers") {
    return { intent: "summarize-offers", sortBy: parsed.sortBy === "landed" || parsed.sortBy === "lead-time" ? parsed.sortBy : "price" };
  }
  return { intent: parsed.intent } as AgentIntent;
}
