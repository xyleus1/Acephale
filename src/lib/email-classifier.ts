import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma";
import { openInquiryStatusFilter } from "./inquiry-status";
import { isDeryaRfqSourceSender } from "./derya-inboxes";

export type ClassifiedKind = "RFQ" | "CARRIER_REPLY" | "CUSTOMER_REPLY" | "RELATED_NOTE" | "OTHER";

export type Classification = {
  kind: ClassifiedKind;
  // For RFQ: parsed shipment fields
  parsed?: ParsedRFQ;
  // For CARRIER_REPLY: matched inquiry + parsed rate
  matchInquiryId?: string | null;
  rate?: ParsedRate;
  // For CUSTOMER_REPLY / RELATED_NOTE: matched job
  matchJobId?: string | null;
  intent?: "ACCEPT" | "REJECT" | "CLARIFY" | "STATUS_REQUEST" | "OTHER";
  // Always: short reason for the classification
  reason: string;
  // Confidence in any related-job/inquiry match: 0-100
  relatedConfidence?: number;
};

export type ParsedRFQ = {
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  containerCount?: number | null;
  containerType?: string | null;
  stackable?: string | null;
  topLoad?: string | null;
  dangerousGoods?: string | null;
  customsBy?: string | null;
  incoterms?: string | null;
  commodity?: string | null;
  weight?: number | null;
  volume?: number | null;
  targetPrice?: number | null;
  targetCurrency?: string | null;
  targetPriceStatus?: string | null;
  targetPriceSource?: string | null;
  cargoReadyDate?: string | null;
};

export type ParsedRate = {
  carrier?: string | null;
  total20?: number | null;
  total40?: number | null;
  total40HC?: number | null;
  transitDays?: number | null;
  service?: string | null;
  validity?: string | null;
};

export async function classifyInboundEmail(args: {
  subject: string;
  fromEmail: string;
  bodyText: string;
  officeId: string;
}): Promise<Classification> {
  if (isDeryaRfqSourceSender(args.fromEmail)) {
    return {
      kind: "RFQ",
      reason: "Message came from the configured Derya RFQ source address.",
      relatedConfidence: 95,
      parsed: {},
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { kind: "OTHER", reason: "ANTHROPIC_API_KEY missing" };

  // Pull current state of the office for matching context
  const [inquiries, jobs, customers] = await Promise.all([
    prisma.inquiry.findMany({
      where: { officeId: args.officeId, status: openInquiryStatusFilter() },
      select: { id: true, subject: true, fromEmail: true, fromCompany: true, origin: true, destination: true, mode: true, company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 30,
    }),
    prisma.job.findMany({
      where: { officeId: args.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      select: { id: true, reference: true, origin: true, destination: true, mode: true, company: { select: { name: true } }, inquiry: { select: { fromEmail: true } } },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
    prisma.company.findMany({
      where: { officeId: args.officeId },
      select: { id: true, name: true, contacts: { select: { email: true } } },
      take: 100,
    }),
  ]);

  const inquiryHints = inquiries.map((i) =>
    `${i.id} | "${i.subject}" | ${i.fromEmail ?? i.fromCompany ?? "?"} | ${i.company?.name ?? "—"} | ${i.origin ?? "?"} → ${i.destination ?? "?"} | ${i.mode ?? "—"}`
  ).join("\n");
  const jobHints = jobs.map((j) =>
    `${j.id} | ${j.reference} | ${j.company?.name ?? "—"} | ${j.inquiry?.fromEmail ?? "—"} | ${j.origin ?? "?"} → ${j.destination ?? "?"} | ${j.mode ?? "—"}`
  ).join("\n");
  const customerEmailDomains = new Set<string>();
  for (const c of customers) {
    for (const ct of c.contacts) {
      if (ct.email) {
        const d = ct.email.split("@")[1];
        if (d) customerEmailDomains.add(d.toLowerCase());
      }
    }
  }
  const senderDomain = args.fromEmail.split("@")[1]?.toLowerCase() ?? "";

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 700,
    system: `You analyze inbound emails for a freight forwarding office. You output ONLY one JSON object — no markdown, no commentary.

Important: even if an email isn't a clear-cut RFQ/quote/reply, look at the OPEN INQUIRIES and ACTIVE JOBS lists below. If the sender, subject keywords, or content (cities, container numbers, shipment refs, carrier names) suggests it relates to one of them, set matchJobId or matchInquiryId and use kind "RELATED_NOTE" with a brief reason. Never guess wildly — only relate when there's a real signal. If genuinely unrelated to any freight workflow, use "OTHER".

Output schema:
{
  "kind": "RFQ" | "CARRIER_REPLY" | "CUSTOMER_REPLY" | "RELATED_NOTE" | "OTHER",
  "reason": string,                           // one short sentence explaining the choice
  "relatedConfidence": number,                // 0-100, how sure you are the matchJobId/matchInquiryId is correct (0 if no match)
  "parsed": { ... },                          // only if kind == RFQ
  "matchInquiryId": string | null,            // for CARRIER_REPLY or RELATED_NOTE attached to an Inquiry
  "rate": { ... },                            // only if kind == CARRIER_REPLY
  "matchJobId": string | null,                // for CUSTOMER_REPLY or RELATED_NOTE attached to a Job
  "intent": "ACCEPT" | "REJECT" | "CLARIFY" | "STATUS_REQUEST" | "OTHER"   // only for CUSTOMER_REPLY / RELATED_NOTE
}

Kinds:
- RFQ — a brand new freight quote request from a customer (multi-paragraph, mentions origin/destination/cargo)
- CARRIER_REPLY — a carrier replying to one of OUR rate requests with their offer (lists rates, transit, validity)
- CUSTOMER_REPLY — a customer responding to one of our quotes (acceptance, rejection, clarification, status request)
- RELATED_NOTE — anything else clearly related to one of the open jobs/inquiries (carrier ETA update, broker note, customs query, sender works for the customer, etc.)
- OTHER — newsletters, receipts, account notifications, personal mail, anything not freight-related at all

Hints:
- The sender's email domain is "${senderDomain}". Known customer-contact domains in this office: ${customerEmailDomains.size > 0 ? [...customerEmailDomains].join(", ") : "(none)"}.
- For RFQ, parsed fields: origin, destination, mode (SEA-FCL|SEA-LCL|AIR|ROAD|COURIER), containerCount, containerType (20GP|40GP|40HC|LCL), stackable (YES|NO|UNKNOWN), topLoad (YES|NO|UNKNOWN), dangerousGoods (YES|NO|UNKNOWN), customsBy (US|CUSTOMER|FORWARDER|UNKNOWN), incoterms, commodity, weight (kg number), volume (cbm number), targetPrice, targetCurrency, targetPriceStatus (PROVIDED|NO_TARGET|UNKNOWN), targetPriceSource, cargoReadyDate (ISO).
- For CARRIER_REPLY, rate fields: carrier, total20, total40, total40HC, transitDays, service, validity.
- Always include a non-empty "reason".

OPEN INQUIRIES (id | subject | sender | customer | route | mode):
${inquiryHints || "(none)"}

ACTIVE JOBS (id | reference | customer | source-email | route | mode):
${jobHints || "(none)"}`,
    messages: [{
      role: "user",
      content: `From: ${args.fromEmail}\nSubject: ${args.subject}\n\n${args.bodyText.slice(0, 3500)}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { kind: "OTHER", reason: "AI returned no JSON" };
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return { kind: "OTHER", reason: "AI JSON parse failed" }; }

  const kind: ClassifiedKind = ["RFQ", "CARRIER_REPLY", "CUSTOMER_REPLY", "RELATED_NOTE", "OTHER"].includes(parsed.kind)
    ? parsed.kind
    : "OTHER";

  return {
    kind,
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 240) : "",
    relatedConfidence: typeof parsed.relatedConfidence === "number" ? parsed.relatedConfidence : 0,
    parsed: parsed.parsed,
    rate: parsed.rate,
    matchInquiryId: parsed.matchInquiryId ?? null,
    matchJobId: parsed.matchJobId ?? null,
    intent: parsed.intent,
  };
}
