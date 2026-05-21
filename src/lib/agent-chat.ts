"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TOOLS, dispatchTool } from "@/lib/agent-tools";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export type ChatResult = {
  reply: string;
  /** True if the agent ingested a new RFQ during this turn. Client refreshes data. */
  ingestedInquiryId?: string;
};

const SYSTEM = `You are the in-app agent for Derya Freight OS — a freight forwarding & procurement platform for an Istanbul-based office.

You have a set of tools (see the tools list). USE THEM. Do not describe what you would do — call the tool and report the actual result.

**TOOL ROUTING SHORTCUTS (memorize these):**
- "suppliers" / "offers" / "prices" / "shortlist" / "cheapest" / "best" / "compare" → call **summarize_supplier_offers** (auto-resolves to focused job or the most recent open SOURCING job). NEVER call search_email_threads first for these — the dedicated tool already aggregates and ranks supplier offers.
- "rates" / "carrier prices" on a forwarding job → **summarize_carrier_rates**.
- "what's stuck" / "stale" → **list_stuck_jobs**.
- "who's waiting on me" / "needs reply" → **list_threads_awaiting_reply**.
- "morning briefing" / "what's on my plate" → **morning_briefing**.
- "find emails about X" / "search for Y" → **search_email_threads**.
- "tell me about JOB-X" / "what's the status of X" → **get_job**.

Pick the most specific tool. ONE tool call answers most questions — don't chain unnecessary searches.

When the user asks a question:
- If the answer requires looking up data you don't already have (jobs, inquiries, threads, customers, supplier offers, carrier rates, milestones, etc.) — **call the right search/lookup tool first**, then answer.
- Don't say "I don't see X in my view" — search for it. There are search_jobs, search_inquiries, search_companies, search_email_threads, get_job, list_open_inquiries, list_threads_awaiting_reply, list_stuck_jobs, summarize_supplier_offers, summarize_carrier_rates.

**HARD RULE — never confuse pricing models:**
- A SOURCING (procurement) job's pricing is **SUPPLIER OFFERS**, NOT carrier quotes. Suppliers are the parties selling the commodity. When the user asks about "rates" / "prices" / "offers" / "what we got" / "how much" on a SOURCING job, ALWAYS call summarize_supplier_offers — never mention carriers, never say "no carrier quotes yet."
- A FORWARDING (logistics) job's pricing is **CARRIER QUOTES**. Carriers are shipping lines / trucking companies. Use summarize_carrier_rates here.
- The focused job's type is in the scoped context below. Read it before answering.
- If summarize_supplier_offers returns no offers, your reply should say "no supplier replies yet" — or if there are linked threads but no parsed prices, suggest running extract_supplier_offers / link_threads_to_job. NEVER say "no carrier quotes" on a SOURCING job. That's wrong vocabulary.

When the user asks for an action (merge, award, populate, set, rename, edit, move stage, draft, hide, delete):
- Call the matching tool. Don't ask permission unless the action is destructive (delete_job).
- If the user is focused on a job, you don't need a job_id — the tool inherits scope.

**WHEN ASKED ABOUT SUPPLIERS / OFFERS / RATES / PRICES / SHORTLIST / CHEAPEST / BEST**
- IMMEDIATELY call summarize_supplier_offers (for SOURCING) or summarize_carrier_rates (for FORWARDING). DO NOT ask the user for a thread ID or job ref. The tool auto-resolves to the focused job, or to the most recent open job of the right type.
- If the result has zero offers/rates, call list_open_inquiries to find what's available and report what suppliers exist with their thread IDs — don't apologize about "lookups returning empty."
- Never say "this may be a platform sync issue." That's wrong. The tool either returned data or it didn't. Report what's actually there.

**Asking the operator to do your work is a fail mode.** If you'd say "do you have the X, or should I search for Y" — just call search_X yourself first. The operator opened the agent so you'd save them clicks, not the other way around.

**HARDEST RULE — never claim success without a tool call.**
- DO NOT write phrases like "Done", "Renamed", "Updated", "Job is now X" UNLESS you just received a successful tool_result for that exact action in this turn.
- If no tool exists for what the user asked, SAY SO. Don't fabricate. Example: "There's no tool for that — closest options are X or Y."
- If you tried a tool and it failed (returned ok=false), report the error verbatim and don't claim success.
- A reply that announces a result MUST be preceded in this turn by a tool_use block whose result confirms it.

Style:
- Be terse, operational, professional. No emojis. No markdown headers. Plain prose. Under 150 words unless the result genuinely needs more.
- After a tool call returns, briefly state what happened in human terms (e.g. "Awarded ORLAZUL — job moved to Awarded, child forwarding job spun up.") rather than dumping the JSON.
- When listing supplier offers / rates / stuck jobs, format as a short bulleted list with the most useful field first (price, days idle, etc).
- For SOURCING jobs the pricing comes from supplier offers (each linked thread has one). For FORWARDING jobs it's carrier quotes. Use the right tool for the job type.

What you CAN'T do:
- Modify users, offices, or auth data.
- Send arbitrary emails outside of the draft-reply / counter-offer / award flows.
- Bypass the platform — every action goes through a tool.

Never invent results. If a tool errored, say so. If you skipped calling a tool because the user's intent was unclear, ask one short clarifying question instead of guessing.`;

const RFQ_KEYWORDS = /\b(FCL|LCL|RFQ|quote|shipment|container|ETD|ETA|freight|cargo|BL|TEU|shipping|Incoterms|EXW|FOB|DAP|DDP|forwarder|carrier|ocean|airfreight|trucking)\b/i;

function looksLikeRFQ(text: string): boolean {
  if (text.length < 80) return false;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return false;
  return RFQ_KEYWORDS.test(text);
}

async function buildOpsContext(officeId: string) {
  const [activeJobs, pendingRFQs] = await Promise.all([
    prisma.job.findMany({
      where: { officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      include: { company: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 15,
    }),
    prisma.inquiry.findMany({
      where: { officeId, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] } },
      include: { company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 10,
    }),
  ]);

  const jobLines = activeJobs.map((j) =>
    `- ${j.reference} | ${j.type} | ${j.company?.name ?? "no customer"} | ${j.origin ?? "?"} → ${j.destination ?? "?"} | ${j.status}`
  );
  const rfqLines = pendingRFQs.map((r) =>
    `- "${r.subject}" | ${r.type} | ${r.company?.name ?? r.fromCompany ?? r.fromEmail ?? "?"} | ${r.origin ?? "?"} → ${r.destination ?? "?"} | ${r.status}`
  );

  return `OPS SNAPSHOT (current state of this office)

Active jobs (${activeJobs.length}):
${jobLines.join("\n") || "  (none)"}

Pending RFQs (${pendingRFQs.length}):
${rfqLines.join("\n") || "  (none)"}`;
}

async function buildScopedJobContext(jobId: string, officeId: string): Promise<string> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId },
    include: {
      company: { select: { name: true } },
      inquiry: {
        include: {
          emailThreads: {
            select: {
              id: true,
              subject: true,
              messages: {
                select: { fromEmail: true, fromName: true, sentAt: true, attachments: true },
                where: { attachments: { not: null } },
                orderBy: { sentAt: "desc" },
              },
            },
          },
        },
      },
      milestones: { select: { type: true, plannedAt: true, actualAt: true } },
      documents: { select: { name: true, docType: true, status: true, aiSummary: true } },
      emailThreads: {
        select: {
          id: true,
          subject: true,
          messages: {
            select: { fromEmail: true, fromName: true, sentAt: true, attachments: true },
            where: { attachments: { not: null } },
            orderBy: { sentAt: "desc" },
          },
        },
      },
    },
  });
  if (!job) return "";
  const threadCount = job.inquiry?.emailThreads.length ?? 0;

  // Collect every attachment across all linked threads (job-direct + via inquiry).
  type EmailAtt = { filename: string; size: number; sender: string; subject: string; sentAt: string };
  const allAtts: EmailAtt[] = [];
  const seenThreads = new Set<string>();
  for (const t of [...job.emailThreads, ...(job.inquiry?.emailThreads ?? [])]) {
    if (seenThreads.has(t.id)) continue;
    seenThreads.add(t.id);
    for (const m of t.messages) {
      if (!m.attachments) continue;
      let parsed: { filename: string; size: number }[] = [];
      try { parsed = JSON.parse(m.attachments); } catch {}
      for (const a of parsed) {
        allAtts.push({
          filename: a.filename,
          size: a.size,
          sender: m.fromName ?? m.fromEmail,
          subject: t.subject,
          sentAt: new Date(m.sentAt).toISOString().split("T")[0],
        });
      }
    }
  }
  const typeBlock = job.type === "SOURCING"
    ? `**THIS IS A PROCUREMENT (SOURCING) JOB.** Pricing = SUPPLIER OFFERS, not carrier quotes. For any "rate / price / offer / cheapest" question, call summarize_supplier_offers. To attach related supplier emails, call link_threads_to_job. To pick a winner, call award_supplier. NEVER call summarize_carrier_rates here. NEVER say "no carrier quotes" — the operator is asking about SUPPLIER prices.`
    : `**THIS IS A FORWARDING JOB.** Pricing = CARRIER QUOTES. For any "rate / price" question, call summarize_carrier_rates.`;

  // Inline document inventory — when the operator asks "how many documents"
  // or "what docs do we have", the answer is right here in the system prompt.
  // No tool call needed.
  const approved = job.documents.filter((d) => d.status === "APPROVED").length;
  const uploaded = job.documents.filter((d) => d.status === "UPLOADED").length;
  const pending = job.documents.filter((d) => d.status === "PENDING").length;
  const docLines = job.documents.length === 0
    ? "  (none)"
    : job.documents.map((d) => `  - ${d.name} · ${d.docType} · ${d.status.toLowerCase()}${d.aiSummary ? ` · AI: ${d.aiSummary.slice(0, 120)}` : ""}`).join("\n");

  return `

FOCUSED JOB (the user is currently looking at this — operate on it by default):
${job.reference} (${job.type}) | ${job.company?.name ?? "no customer"} | ${job.origin ?? "?"} → ${job.destination ?? "?"} | ${job.mode ?? "—"} | ${job.status}
Commodity: ${job.commodity ?? "—"} | Weight: ${job.weight ?? "—"}kg | Volume: ${job.volume ?? "—"}cbm
Revenue: ${job.revenue ?? "—"} | Cost: ${job.cost ?? "—"} | ETD: ${job.etd?.toISOString().split("T")[0] ?? "—"} | ETA: ${job.eta?.toISOString().split("T")[0] ?? "—"}
Inquiry id: ${job.inquiryId ?? "—"} | Linked email threads: ${threadCount}

Documents on this load (${job.documents.length} total · ${approved} approved · ${uploaded} uploaded · ${pending} pending):
${docLines}

Email attachments on linked threads (${allAtts.length} total):
${allAtts.length === 0 ? "  (none)" : allAtts.slice(0, 30).map((a) => `  - ${a.filename}${a.size ? ` · ${Math.round(a.size / 1024)}KB` : ""} · from ${a.sender} · "${a.subject}" · ${a.sentAt}`).join("\n")}${allAtts.length > 30 ? `\n  …and ${allAtts.length - 30} more` : ""}

${typeBlock}

**"this load" / "this job" / "this deal" / "the deal" ALWAYS means the focused job above.** Don't ask the operator which job they mean. Answer directly from the data above; only call tools (get_job, summarize_supplier_offers, etc) when you need data NOT already in the prompt.`;
}

export async function chatWithAgent(history: ChatMsg[], userMessage: string, scopeJobId?: string): Promise<ChatResult> {
  // No-op test: returns immediately without touching session, db, or AI.
  // If this fails, the error is in the framework / deploy / client bundle, not my code.
  if (userMessage.trim().toLowerCase() === "/ping") {
    return { reply: `pong · history-len=${history.length} · scope=${scopeJobId ?? "none"} · build=${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"}` };
  }
  try {
    return await _chatWithAgentImpl(history, userMessage, scopeJobId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : "";
    console.error("[agent-chat] top-level failed:", msg, stack);
    return { reply: `Agent error — ${msg.slice(0, 600)}${stack ? `\n\n${stack.slice(0, 400)}` : ""}` };
  }
}

async function _chatWithAgentImpl(history: ChatMsg[], userMessage: string, scopeJobId?: string): Promise<ChatResult> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { reply: "Agent unavailable — ANTHROPIC_API_KEY is not configured." };
  }

  // Diagnostic: "/debug" reports schema and env state without invoking AI.
  if (userMessage.trim().toLowerCase() === "/debug") {
    const checks: string[] = [];
    try {
      const t = await prisma.emailThread.findFirst({ select: { id: true, supplierOffer: true, awardedAt: true, hiddenAt: true, snoozedUntil: true, externalThreadId: true } });
      checks.push(`emailThread fields readable: ${t ? "yes (1 row)" : "no rows yet but query succeeded"}`);
    } catch (e) { checks.push(`emailThread fields FAIL: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`); }
    try {
      const j = await prisma.job.findFirst({ select: { id: true, parentJobId: true, portalToken: true, notifyCustomer: true, customerEmail: true } });
      checks.push(`job fields readable: ${j ? "yes" : "no rows"}`);
    } catch (e) { checks.push(`job fields FAIL: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`); }
    try {
      const m = await prisma.emailMessage.findFirst({ select: { id: true, gmailMessageId: true } });
      checks.push(`emailMessage gmailMessageId: ${m ? "yes" : "no rows"}`);
    } catch (e) { checks.push(`emailMessage FAIL: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`); }
    return { reply: `Debug:\n· officeId: ${session.officeId}\n· scopeJobId: ${scopeJobId ?? "none"}\n· ANTHROPIC_API_KEY: ${apiKey ? "set" : "MISSING"}\n· ${checks.join("\n· ")}` };
  }

  // Branch 1: pasted RFQ → ingest as Inquiry (kept as a special case because
  // tool-use isn't the right shape for "the message itself is the data").
  if (looksLikeRFQ(userMessage)) {
    const subjectMatch = userMessage.match(/^(?:Subject:\s*)?(.+?)$/m);
    const fromMatch = userMessage.match(/(?:from|sender):\s*(.+)/i)
                   ?? userMessage.match(/<([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})>/)
                   ?? userMessage.match(/\b([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})\b/);
    const subject = subjectMatch?.[1]?.trim().slice(0, 120) ?? "Pasted RFQ";
    const fromEmail = fromMatch?.[1]?.trim() ?? null;

    const inquiry = await prisma.inquiry.create({
      data: {
        officeId: session.officeId,
        subject,
        fromEmail,
        status: "INGESTED",
        rawEmailBody: userMessage,
        receivedAt: new Date(),
      },
    });
    try {
      const client = new Anthropic({ apiKey });
      const parseRes = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: `Extract freight details. Return ONLY JSON. Fields (null if missing): origin, destination, mode (SEA-FCL|SEA-LCL|AIR|ROAD|COURIER), containerType (20GP|40GP|40HC|LCL), incoterms, commodity, weight (kg), volume (cbm), cargoReadyDate (ISO).\n\n${userMessage.slice(0, 2500)}`,
        }],
      });
      const text = parseRes.content[0].type === "text" ? parseRes.content[0].text : "";
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        await prisma.inquiry.update({
          where: { id: inquiry.id },
          data: {
            origin: parsed.origin ?? null,
            destination: parsed.destination ?? null,
            mode: parsed.mode ?? null,
            containerType: parsed.containerType ?? null,
            incoterms: parsed.incoterms ?? null,
            commodity: parsed.commodity ?? null,
            weight: parsed.weight != null ? Number(parsed.weight) : null,
            volume: parsed.volume != null ? Number(parsed.volume) : null,
            cargoReadyDate: parsed.cargoReadyDate ? new Date(parsed.cargoReadyDate) : null,
            status: "PARSED",
            parsedData: JSON.stringify(parsed),
          },
        });
      }
    } catch { /* ignore */ }
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/rfq");
    return { reply: `Captured RFQ "${subject}". Open the inbox to see it parsed.`, ingestedInquiryId: inquiry.id };
  }

  // Branch 2: tool-use loop with pre-fetched price context.
  // ── PERF / RELIABILITY ──
  // - For price/supplier/shortlist questions, we pre-fetch the cached
  //   supplier-offer summary and inject it directly into the system prompt.
  //   The agent stops trying to "figure out which tool to call" and just
  //   formats the data we already have.
  // - System prompt + tools wrapped with cache_control: ephemeral.
  // - In-memory ctx caches (20s TTL).
  // - Tools dispatch in parallel.
  // If no explicit scope, pick the most recently active job as the implicit
  // focus. So "this load" / "the deal" works on every surface — floating
  // pill, workbench, anywhere — without forcing the operator to remember
  // a JOB-ref.
  const effectiveScopeJobId = scopeJobId ?? await getImplicitFocusJobId(session.officeId);
  const [ctx, scopedCtx, priceContext] = await Promise.all([
    cachedOpsContext(session.officeId),
    effectiveScopeJobId ? cachedScopedJobContext(effectiveScopeJobId, session.officeId) : Promise.resolve(""),
    isPriceQuery(userMessage) ? buildPriceContext(session.officeId, effectiveScopeJobId ?? undefined) : Promise.resolve(""),
  ]);

  const client = new Anthropic({ apiKey });
  const messages: any[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  // Use Anthropic prompt caching: the system prompt + tools array become a
  // cached prefix. Cache is reused for ~5 min from first miss.
  const systemBlocks: any[] = [
    { type: "text", text: SYSTEM + "\n\n" + ctx + scopedCtx + priceContext, cache_control: { type: "ephemeral" } },
  ];
  const toolsWithCache = ([...TOOLS] as any[]).map((t, i, arr) =>
    i === arr.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
  );

  // 6 tool rounds is enough for most multi-hop queries. Track whether the
  // last text we saw was a final answer (post-tool) or just a preamble
  // ("Let me search..."), so we don't accidentally return preamble.
  const MAX_TOOL_TURNS = 6;
  let finalText = "";  // text from a non-tool-use response
  let preambleText = ""; // text from a tool-use response (intermediate)
  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemBlocks as any,
        tools: toolsWithCache as any,
        messages,
      });

      const textBlocks = response.content.filter((b: any) => b.type === "text") as any[];
      const text = textBlocks.length ? textBlocks.map((b) => b.text).join("\n").trim() : "";

      if (response.stop_reason !== "tool_use") {
        // Final answer.
        return { reply: text || finalText || preambleText || "(no reply)" };
      }

      // Mid-flight: text is preamble. Keep latest preamble in case we cap out.
      if (text) preambleText = text;

      messages.push({ role: "assistant", content: response.content });

      // Run all requested tools in parallel.
      const toolUseBlocks = response.content.filter((b: any) => b.type === "tool_use") as any[];
      const toolResults = await Promise.all(toolUseBlocks.map(async (tu) => {
        const r = await dispatchTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, {
          officeId: session.officeId,
          scopeJobId: effectiveScopeJobId ?? undefined,
        });
        return {
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(r),
          is_error: !r.ok,
        };
      }));
      messages.push({ role: "user", content: toolResults });

      // After the LAST permitted tool round, force the model to produce a
      // final textual answer instead of more tool calls.
      if (turn === MAX_TOOL_TURNS - 2) {
        messages.push({
          role: "user",
          content: "You have one more turn. Stop calling tools — produce the final answer for the operator now using the data you've gathered.",
        });
      }
    }
    // Capped out without a non-tool-use response. Return whatever text we
    // last saw mid-flight rather than dropping to a generic error.
    return { reply: preambleText || finalText || "I gathered some data but couldn't reach a final answer in time. Try rephrasing more narrowly." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent-chat] tool-use loop failed:", msg, e);
    return { reply: `Agent error — ${msg.slice(0, 400)}` };
  }
}

// Picks the implicit focus job for an office — the most recently updated
// active job. Used when the caller didn't explicitly pass scopeJobId (e.g.
// the floating agent pill on non-workbench routes). So "this load" / "the
// deal" / "what docs do we have" still resolves to something useful.
async function getImplicitFocusJobId(officeId: string): Promise<string | null> {
  const j = await prisma.job.findFirst({
    where: { officeId, status: { notIn: ["DELIVERED", "CANCELLED", "PROPOSED"] } },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  return j?.id ?? null;
}

// Detects "shortlist of prices we received" / "cheapest" / "what offers do we
// have" — anything where the agent should ground its answer on the cached
// supplier-offer summary instead of routing through tool selection.
function isPriceQuery(userMessage: string): boolean {
  const t = userMessage.toLowerCase();
  return /\b(shortlist|cheapest|best (?:price|rate|offer)|prices?|pricing|rates?|offers?|how much|quotes?)\b/.test(t)
      && !/\b(carrier|forwarder)\b/.test(t.slice(0, 80));  // carrier-rate questions go through summarize_carrier_rates
}

// Builds a "PRICE INTEL" block for the system prompt by reading the cached
// summary off the focused inquiry (or the most recent open SOURCING
// inquiry). Triggers a fresh extraction if the cache is empty/stale.
async function buildPriceContext(officeId: string, scopeJobId?: string): Promise<string> {
  const job = await prisma.job.findFirst({
    where: scopeJobId
      ? { id: scopeJobId, officeId }
      : { officeId, type: "SOURCING", status: { notIn: ["DELIVERED", "CANCELLED"] } },
    include: { inquiry: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!job?.inquiry || job.type !== "SOURCING") return "";

  // If cache is empty or older than 5 min, kick off a synchronous prewarm so
  // the data is available NOW. ~5-10s for the first call; sub-100ms after.
  const SUMMARY_TTL_MS = 5 * 60 * 1000;
  const stale = !job.inquiry.summaryCacheAt
    || (Date.now() - job.inquiry.summaryCacheAt.getTime()) > SUMMARY_TTL_MS;
  if (stale) {
    const { prewarmInquirySummary } = await import("./prewarm-summary");
    try { await prewarmInquirySummary(job.inquiry.id); } catch {}
  }

  // Re-read cache.
  const inq = await prisma.inquiry.findUnique({
    where: { id: job.inquiry.id },
    select: { summaryCache: true },
  });
  if (!inq?.summaryCache) {
    return `\n\nPRICE INTEL (focused on ${job.reference} — ${job.inquiry.commodity ?? "?"} → ${job.destination ?? "?"}):\n  No supplier offers parsed yet from the linked threads.\n`;
  }

  let s: any;
  try { s = JSON.parse(inq.summaryCache); } catch { return ""; }
  const offers = (s.offers ?? []) as any[];
  const priced = offers.filter((o) => typeof o.price === "number" && o.price > 0);
  if (priced.length === 0) {
    return `\n\nPRICE INTEL (focused on ${job.reference} — ${s.commodity ?? "?"} → ${s.destination ?? "?"}):\n  ${offers.length} supplier thread${offers.length === 1 ? "" : "s"} parsed. None contain an explicit price yet — most are intro/clarifying replies. To find prices, the operator should re-sync emails or check if specific suppliers have replied since the last extraction.\n`;
  }

  const lines = [`\n\nPRICE INTEL (focused on ${job.reference} — ${s.commodity ?? "?"} → ${s.destination ?? "?"}):`];
  lines.push(`  ${priced.length} priced supplier offer${priced.length === 1 ? "" : "s"} (cheapest first):`);
  priced.slice(0, 12).forEach((o, i) => {
    const tag = i === 0 ? " ← BEST" : "";
    const meta = [o.qty && `qty ${o.qty}`, o.incoterms, o.origin && `origin ${o.origin}`, o.lead_time && `lead ${o.lead_time}`].filter(Boolean).join(" · ");
    lines.push(`    ${i + 1}. ${o.supplier} — ${o.currency ?? ""} ${o.price}${o.unit ? `/${o.unit}` : ""}${tag}${meta ? ` (${meta})` : ""}`);
  });
  if (offers.length > priced.length) {
    lines.push(`  ${offers.length - priced.length} additional supplier thread${offers.length - priced.length === 1 ? "" : "s"} corresponding without a firm price.`);
  }
  lines.push(`\nWhen the operator asks about prices/suppliers/shortlist, USE THIS DATA DIRECTLY. Do not search or call other tools — the answer is right here.`);
  return lines.join("\n");
}

// ── In-memory caches for ops + scoped context (per office / per job).
// 20-second TTL keeps a chat session warm without surfacing stale state when
// the operator pauses to think for a few minutes. Module-scope so it survives
// across requests on the same Vercel function instance.
const OPS_CTX_CACHE = new Map<string, { value: string; at: number }>();
const SCOPED_CTX_CACHE = new Map<string, { value: string; at: number }>();
const CTX_TTL_MS = 20_000;

async function cachedOpsContext(officeId: string): Promise<string> {
  const c = OPS_CTX_CACHE.get(officeId);
  if (c && Date.now() - c.at < CTX_TTL_MS) return c.value;
  const value = await buildOpsContext(officeId);
  OPS_CTX_CACHE.set(officeId, { value, at: Date.now() });
  return value;
}

async function cachedScopedJobContext(jobId: string, officeId: string): Promise<string> {
  const key = `${officeId}::${jobId}`;
  const c = SCOPED_CTX_CACHE.get(key);
  if (c && Date.now() - c.at < CTX_TTL_MS) return c.value;
  const value = await buildScopedJobContext(jobId, officeId);
  SCOPED_CTX_CACHE.set(key, { value, at: Date.now() });
  return value;
}
