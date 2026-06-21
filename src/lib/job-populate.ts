"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { createPendingJobUpdateProposal } from "./agent-proposals";

export type PopulateResult = {
  ok: true;
  jobId: string;
  proposalId: string;
  proposed: string[];      // human-readable list of fields proposed
  raw: Record<string, unknown>;
} | {
  error: string;
};

const FIELD_LABELS: Record<string, string> = {
  origin: "Origin",
  destination: "Destination",
  mode: "Mode",
  containerType: "Container type",
  stackable: "Stackable",
  topLoad: "Top load",
  dangerousGoods: "Dangerous goods",
  customsBy: "Customs by",
  incoterms: "Incoterms",
  commodity: "Commodity",
  targetCurrency: "Target currency",
  targetPriceStatus: "Target status",
  targetPriceSource: "Target source",
  notes: "Notes",
  containerCount: "Containers",
  weight: "Weight kg",
  volume: "Volume cbm",
  packages: "Packages",
  targetPrice: "Target price",
  revenue: "Revenue",
  cost: "Cost",
  currency: "Currency",
  cargoReadyDate: "Cargo ready date",
};

function displayValue(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

// AI walks every email message on the job (via the linked Inquiry's threads)
// plus any extracted supplier offers, and proposes missing fields on the Job.
// It does not mutate Job/Inquiry records. The proposed diff is reviewed through
// AgentProposal before any write happens.
export async function populateJobFromEmails(jobId: string): Promise<PopulateResult> {
  const session = await requireSession();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "ANTHROPIC_API_KEY is not set" };

  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    include: {
      inquiry: {
        include: {
          emailThreads: {
            include: { messages: { orderBy: { sentAt: "asc" } } },
          },
        },
      },
      emailThreads: {
        include: { messages: { orderBy: { sentAt: "asc" } } },
      },
    },
  });
  if (!job) return { error: "Job not found" };

  // Collect all email threads attached either via the job directly or via its inquiry.
  const threads = [
    ...job.emailThreads,
    ...(job.inquiry?.emailThreads ?? []),
  ];
  if (threads.length === 0) return { error: "No emails linked to this job to populate from" };

  const transcripts: string[] = [];
  const offerSummaries: string[] = [];
  for (const t of threads) {
    if (t.messages.length === 0) continue;
    const body = t.messages.map((m) => {
      const dir = m.direction === "OUTBOUND" ? "[US OUT]" : "[INBOUND]";
      return `${dir} ${m.sentAt.toISOString().split("T")[0]} · ${m.fromName ?? m.fromEmail}\n${m.bodyText ?? ""}`;
    }).join("\n\n────\n\n");
    transcripts.push(`THREAD: "${t.subject}"\n\n${body}`);

    if (t.supplierOffer) {
      try {
        const o = JSON.parse(t.supplierOffer);
        const summary = `Supplier ${o.supplierName ?? "?"} | ${o.pricePerUnit ?? "?"} ${o.currency ?? ""}/${o.unit ?? ""} | qty ${o.qtyAvailable ?? "?"} | ${o.incoterms ?? ""} | origin ${o.origin ?? "?"} | lead ${o.leadTime ?? "?"}`;
        offerSummaries.push(summary);
      } catch {}
    }
  }

  const fullText = (transcripts.join("\n\n════\n\n") + (offerSummaries.length ? `\n\nSUPPLIER OFFERS PARSED EARLIER:\n${offerSummaries.join("\n")}` : "")).slice(0, 18000);

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    system: `You consolidate an entire email/conversation history about ONE freight deal into a structured load record.

Job type: ${job.type} (${job.type === "SOURCING" ? "office is buying a commodity for a customer" : "office is moving cargo for a customer"})

Output ONLY this JSON (no markdown, no commentary):
{
  "origin": string | null,            // city, country code (e.g. "Constanta, RO" or "Turkey" if only country known)
  "destination": string | null,
  "mode": "SEA-FCL" | "SEA-LCL" | "AIR" | "ROAD" | "COURIER" | null,
  "containerCount": number | null,
  "containerType": "20GP" | "40GP" | "40HC" | "LCL" | null,
  "stackable": "YES" | "NO" | "UNKNOWN" | null,
  "topLoad": "YES" | "NO" | "UNKNOWN" | null,
  "dangerousGoods": "YES" | "NO" | "UNKNOWN" | null,
  "customsBy": "US" | "CUSTOMER" | "FORWARDER" | "UNKNOWN" | null,
  "incoterms": string | null,         // FOB, CIF, EXW, DAP, etc
  "commodity": string | null,         // specific (e.g. "Animal feed grade soybean meal, 46% protein")
  "weight": number | null,            // kg
  "volume": number | null,            // cbm
  "packages": number | null,          // pallets/bags/units count
  "targetPrice": number | null,
  "targetCurrency": "USD" | "EUR" | "GBP" | "TRY" | null,
  "targetPriceStatus": "PROVIDED" | "NO_TARGET" | "UNKNOWN" | null,
  "targetPriceSource": string | null,
  "cargoReadyDate": string | null,
  "revenue": number | null,           // total customer-facing price (USD)
  "cost": number | null,              // best supplier/carrier cost (USD)
  "currency": "USD" | "EUR" | "GBP" | "TRY" | null,
  "notes": string | null              // 2-3 sentences operational summary: who's involved, current stage, key open question
}

Be conservative — null is better than guessing. Use the supplier offers section to inform cost. If only one country is mentioned (e.g. "Turkey", "United Kingdom"), put it in origin/destination as-is — better than null. Convert weights from MT to kg (×1000). For SOURCING jobs the buyer is the customer and origin is the supplier's country.`,
    messages: [{
      role: "user",
      content: fullText,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "AI returned no JSON" };
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(m[0]); } catch { return { error: "AI JSON parse failed" }; }

  // Build proposed update: only fill fields that are currently empty on the Job.
  const update: Record<string, unknown> = {};
  const proposed: string[] = [];
  const tryFill = (key: string, currentVal: unknown, parsedVal: unknown, label: string) => {
    if (parsedVal == null || parsedVal === "") return;
    if (currentVal != null && currentVal !== "") return;
    update[key] = parsedVal;
    proposed.push(`${label}: ${String(parsedVal)}`);
  };

  tryFill("origin",        job.origin,        parsed.origin,        "Origin");
  tryFill("destination",   job.destination,   parsed.destination,   "Destination");
  tryFill("mode",          job.mode,          parsed.mode,          "Mode");
  tryFill("containerType", job.containerType, parsed.containerType, "Container Type");
  tryFill("stackable",     job.stackable,     parsed.stackable,     "Stackable");
  tryFill("topLoad",       job.topLoad,       parsed.topLoad,       "Top Load");
  tryFill("dangerousGoods", job.dangerousGoods, parsed.dangerousGoods, "Dangerous Goods");
  tryFill("customsBy",     job.customsBy,     parsed.customsBy,     "Customs By");
  tryFill("incoterms",     job.incoterms,     parsed.incoterms,     "Incoterms");
  tryFill("commodity",     job.commodity,     parsed.commodity,     "Commodity");
  tryFill("targetCurrency", job.targetCurrency, parsed.targetCurrency, "Target Currency");
  tryFill("targetPriceStatus", job.targetPriceStatus, parsed.targetPriceStatus, "Target Price Status");
  tryFill("targetPriceSource", job.targetPriceSource, parsed.targetPriceSource, "Target Price Source");
  tryFill("notes",         job.notes,         parsed.notes,         "Notes");
  if (parsed.containerCount != null && (job.containerCount == null || job.containerCount === 0)) {
    update.containerCount = Number(parsed.containerCount);
    proposed.push(`Containers: ${Number(parsed.containerCount)}`);
  }
  if (parsed.weight != null && (job.weight == null || job.weight === 0)) {
    update.weight = Number(parsed.weight);
    proposed.push(`Weight: ${Number(parsed.weight).toLocaleString()} kg`);
  }
  if (parsed.volume != null && (job.volume == null || job.volume === 0)) {
    update.volume = Number(parsed.volume);
    proposed.push(`Volume: ${Number(parsed.volume).toLocaleString()} cbm`);
  }
  if (parsed.packages != null && (job.packages == null || job.packages === 0)) {
    update.packages = Number(parsed.packages);
    proposed.push(`Packages: ${Number(parsed.packages)}`);
  }
  if (parsed.targetPrice != null && (job.targetPrice == null || job.targetPrice === 0)) {
    update.targetPrice = Number(parsed.targetPrice);
    update.targetPriceStatus = "PROVIDED";
    proposed.push(`Target Price: ${parsed.targetCurrency ?? job.targetCurrency ?? "USD"} ${Number(parsed.targetPrice).toLocaleString()}`);
  }
  if (parsed.revenue != null && (job.revenue == null || job.revenue === 0)) {
    update.revenue = Number(parsed.revenue);
    proposed.push(`Revenue: $${Number(parsed.revenue).toLocaleString()}`);
  }
  if (parsed.cost != null && (job.cost == null || job.cost === 0)) {
    update.cost = Number(parsed.cost);
    proposed.push(`Cost: $${Number(parsed.cost).toLocaleString()}`);
  }
  if (parsed.currency && job.currency === "USD") {
    // currency defaults to USD on creation; only override if AI is confident
    if (parsed.currency !== "USD") {
      update.currency = String(parsed.currency);
      proposed.push(`Currency: ${parsed.currency}`);
    }
  }

  // Mirror onto the inquiry too, so the RFQ page reflects it.
  const inqUpdate: Record<string, unknown> = {};
  if (job.inquiry) {
    const tryFillInq = (key: string, currentVal: unknown, parsedVal: unknown) => {
      if (parsedVal == null || parsedVal === "") return;
      if (currentVal != null && currentVal !== "") return;
      inqUpdate[key] = parsedVal;
    };
    tryFillInq("origin",        job.inquiry.origin,        parsed.origin);
    tryFillInq("destination",   job.inquiry.destination,   parsed.destination);
    tryFillInq("mode",          job.inquiry.mode,          parsed.mode);
    tryFillInq("containerType", job.inquiry.containerType, parsed.containerType);
    tryFillInq("stackable",     job.inquiry.stackable,     parsed.stackable);
    tryFillInq("topLoad",       job.inquiry.topLoad,       parsed.topLoad);
    tryFillInq("dangerousGoods", job.inquiry.dangerousGoods, parsed.dangerousGoods);
    tryFillInq("customsBy",     job.inquiry.customsBy,     parsed.customsBy);
    tryFillInq("incoterms",     job.inquiry.incoterms,     parsed.incoterms);
    tryFillInq("commodity",     job.inquiry.commodity,     parsed.commodity);
    tryFillInq("targetCurrency", job.inquiry.targetCurrency, parsed.targetCurrency);
    tryFillInq("targetPriceStatus", job.inquiry.targetPriceStatus, parsed.targetPriceStatus);
    tryFillInq("targetPriceSource", job.inquiry.targetPriceSource, parsed.targetPriceSource);
    if (parsed.containerCount != null && (job.inquiry.containerCount == null)) inqUpdate.containerCount = Number(parsed.containerCount);
    if (parsed.weight != null && (job.inquiry.weight == null)) inqUpdate.weight = Number(parsed.weight);
    if (parsed.volume != null && (job.inquiry.volume == null)) inqUpdate.volume = Number(parsed.volume);
    if (parsed.targetPrice != null && (job.inquiry.targetPrice == null)) {
      inqUpdate.targetPrice = Number(parsed.targetPrice);
      inqUpdate.targetPriceStatus = "PROVIDED";
    }
    if (parsed.cargoReadyDate && job.inquiry.cargoReadyDate == null) {
      const d = new Date(String(parsed.cargoReadyDate));
      if (!isNaN(d.getTime())) inqUpdate.cargoReadyDate = d;
    }
  }

  for (const [field, value] of Object.entries(inqUpdate)) {
    if (!(field in update)) {
      proposed.push(`RFQ ${FIELD_LABELS[field] ?? field}: ${displayValue(value)}`);
    }
  }

  if (Object.keys(update).length === 0 && Object.keys(inqUpdate).length === 0) {
    return { error: "AI found no empty fields worth proposing." };
  }

  const proposal = await createPendingJobUpdateProposal({
    officeId: session.officeId,
    userId: session.userId,
    jobId: job.id,
    kind: "AI_POPULATE_FROM_EMAILS",
    sourceType: "LINKED_EMAIL_THREADS",
    sourcePreview: fullText,
    update,
    inquiryUpdate: inqUpdate,
    fieldLabels: FIELD_LABELS,
    toolTrace: {
      parser: "populateJobFromEmails",
      linkedThreadCount: threads.length,
      transcriptBytes: fullText.length,
      rawParsed: parsed,
      appliedImmediately: false,
      requiresHumanReview: true,
    },
  });

  if (!proposal.ok) return { error: proposal.error };

  return { ok: true, jobId, proposalId: proposal.proposalId, proposed, raw: parsed };
}
