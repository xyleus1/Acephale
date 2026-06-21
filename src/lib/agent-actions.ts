"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { parsePipeLines } from "./quote-lines";
import { recordTargetPriceHistory, targetPriceChanged } from "./target-price-history";

// AI extracts a structured action from a free-form user message when scoped
// to a job. Returns one of:
//   { action: "edit-job", fields: {...} }     — update Job.* fields
//   { action: "move-stage", status: "..." }   — change Job.status
//   { action: "add-milestone", type, plannedAt?, actualAt? }
//   { action: "none" }                        — fall through to chat
//
// We avoid full tool-use plumbing here — single Haiku call returns JSON,
// the caller validates and applies. Cheap and predictable.

type ExtractedAction =
  | { action: "edit-job"; fields: Record<string, unknown> }
  | { action: "move-stage"; status: string }
  | { action: "add-milestone"; type: string; plannedAt?: string; actualAt?: string; note?: string }
  | { action: "set-customer"; companyName: string; createIfMissing?: boolean }
  | { action: "rename-company"; newName: string }
  | { action: "edit-inquiry"; fields: Record<string, unknown> }
  | { action: "set-quote-line"; description: string; amount: number; currency?: string }
  | { action: "set-revenue"; amount: number; currency?: string }
  | { action: "set-cost"; amount: number; currency?: string }
  | { action: "delete-job"; confirm: boolean }
  | { action: "split-supplier"; supplierHint: string }
  | { action: "none" };

const VALID_STATUSES = ["PROPOSED", "INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED", "CANCELLED"] as const;
const VALID_MILESTONES = ["BOOKING", "CARGO_READY", "DELIVERY"] as const;

export async function extractActionFromMessage(args: {
  userMessage: string;
  scopeJobId: string;
  scopeType: "SOURCING" | "FORWARDING";
  scopeStatus: string;
}): Promise<ExtractedAction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { action: "none" };

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 450,
    system: `You parse a single chat message into ONE structured action against the focused freight job. Output ONLY JSON, no preamble.

Action options:

1. Update Job fields:
   { "action": "edit-job", "fields": { "origin"?: string, "destination"?: string, "mode"?: "SEA-FCL"|"SEA-LCL"|"AIR"|"ROAD"|"COURIER", "incoterms"?: string, "commodity"?: string, "weight"?: number, "volume"?: number, "packages"?: number, "currency"?: "USD"|"EUR"|"GBP"|"TRY", "notes"?: string } }

2. Move job to a new stage:
   { "action": "move-stage", "status": "PROPOSED" | "INQUIRY" | "QUOTED" | "BOOKED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED" }

3. Add or update a milestone:
   { "action": "add-milestone", "type": "BOOKING"|"CARGO_READY"|"DELIVERY", "plannedAt"?: "YYYY-MM-DD", "actualAt"?: "YYYY-MM-DD", "note"?: string }

4. Set or change the CUSTOMER linked to this job. Triggers: "the customer is X", "set customer to X", "link to X", "this is for X", "add customer X". If the company doesn't exist yet, set createIfMissing true.
   { "action": "set-customer", "companyName": string, "createIfMissing": true }

5. Rename the customer / company on this job. Triggers: "rename customer to X", "rename the customer X", "change customer name to X", "the customer's name is X" (when a customer is already linked).
   { "action": "rename-company", "newName": string }

6. Update fields on the linked Inquiry (origin, destination, mode, incoterms, commodity, weight, volume, fromEmail, fromCompany, subject). Use this when the user is talking about the RFQ/source email rather than the job itself.
   { "action": "edit-inquiry", "fields": { ... } }

7. Set the customer-facing revenue (price quoted to customer) on the job:
   { "action": "set-revenue", "amount": number, "currency"?: "USD"|"EUR"|"GBP"|"TRY" }

8. Set the cost (carrier/supplier expense) on the job:
   { "action": "set-cost", "amount": number, "currency"?: "USD"|"EUR"|"GBP"|"TRY" }

9. Add a line item to the customer quote (description + amount):
   { "action": "set-quote-line", "description": string, "amount": number, "currency"?: "USD"|"EUR"|"GBP"|"TRY" }

10. Delete this job entirely. Only fire this when the user EXPLICITLY says "delete this job", "remove this job", "kill this job". Set confirm=true.
    { "action": "delete-job", "confirm": true }

11. None of the above:
    { "action": "none" }

Rules:
- Only emit one action. Pick the most specific.
- Only fire delete-job for explicit "delete/remove/kill". Never for "discard" alone unless paired with "this job".
- Convert relative dates (today, tomorrow, next week, May 20) to absolute YYYY-MM-DD.
- Convert MT/tons → kg (×1000).
- "Rename customer to X" → rename-company (we have a customer; change its name). "Set customer to X" / "the customer is X" / "this is for X" → set-customer (link/create).
- Currency: USD/EUR/GBP/TRY only.
- For SOURCING type, "supplier" mentions go into notes, not origin (origin = supplier port already extracted). For FORWARDING, "supplier"/"shipper" maps to origin entity but don't auto-create a Company for it.
- If unsure, return { "action": "none" }.

Job context:
- type: ${args.scopeType}
- current status: ${args.scopeStatus}
- today: ${new Date().toISOString().split("T")[0]}`,
    messages: [{ role: "user", content: args.userMessage }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { action: "none" };
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return { action: "none" }; }

  if (parsed.action === "edit-job" && parsed.fields && typeof parsed.fields === "object") {
    return { action: "edit-job", fields: parsed.fields };
  }
  if (parsed.action === "move-stage" && (VALID_STATUSES as readonly string[]).includes(parsed.status)) {
    return { action: "move-stage", status: parsed.status };
  }
  if (parsed.action === "add-milestone" && (VALID_MILESTONES as readonly string[]).includes(parsed.type)) {
    return {
      action: "add-milestone",
      type: parsed.type,
      plannedAt: typeof parsed.plannedAt === "string" ? parsed.plannedAt : undefined,
      actualAt: typeof parsed.actualAt === "string" ? parsed.actualAt : undefined,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
    };
  }
  if (parsed.action === "set-customer" && typeof parsed.companyName === "string" && parsed.companyName.trim()) {
    return { action: "set-customer", companyName: parsed.companyName.trim().slice(0, 200), createIfMissing: parsed.createIfMissing !== false };
  }
  if (parsed.action === "rename-company" && typeof parsed.newName === "string" && parsed.newName.trim()) {
    return { action: "rename-company", newName: parsed.newName.trim().slice(0, 200) };
  }
  if (parsed.action === "edit-inquiry" && parsed.fields && typeof parsed.fields === "object") {
    return { action: "edit-inquiry", fields: parsed.fields };
  }
  if (parsed.action === "set-revenue" && typeof parsed.amount === "number") {
    return { action: "set-revenue", amount: parsed.amount, currency: typeof parsed.currency === "string" ? parsed.currency : undefined };
  }
  if (parsed.action === "set-cost" && typeof parsed.amount === "number") {
    return { action: "set-cost", amount: parsed.amount, currency: typeof parsed.currency === "string" ? parsed.currency : undefined };
  }
  if (parsed.action === "set-quote-line" && typeof parsed.description === "string" && typeof parsed.amount === "number") {
    return { action: "set-quote-line", description: parsed.description.slice(0, 300), amount: parsed.amount, currency: typeof parsed.currency === "string" ? parsed.currency : undefined };
  }
  if (parsed.action === "delete-job" && parsed.confirm === true) {
    return { action: "delete-job", confirm: true };
  }
  return { action: "none" };
}

// ── Apply ──────────────────────────────────────────────────────────────────

export async function applyEditJob(jobId: string, officeId: string, fields: Record<string, unknown>): Promise<{ ok: true; applied: string[] }> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId },
    select: {
      id: true,
      inquiryId: true,
      targetPrice: true,
      targetCurrency: true,
      targetPriceStatus: true,
      targetPriceSource: true,
    },
  });
  if (!job) return { ok: true, applied: [] };

  const update: Record<string, unknown> = {};
  const applied: string[] = [];
  const passKey = (k: string, t: "string" | "number" | "date") => {
    const v = fields[k];
    if (v == null || v === "") return;
    if (t === "number") {
      const n = Number(v);
      if (!isNaN(n)) { update[k] = n; applied.push(`${k}=${n}`); }
    } else if (t === "date") {
      const d = new Date(String(v));
      if (!isNaN(d.getTime())) { update[k] = d; applied.push(`${k}=${d.toISOString().split("T")[0]}`); }
    } else {
      update[k] = String(v); applied.push(`${k}=${String(v)}`);
    }
  };
  passKey("origin", "string");
  passKey("destination", "string");
  passKey("mode", "string");
  passKey("incoterms", "string");
  passKey("commodity", "string");
  passKey("containerType", "string");
  passKey("stackable", "string");
  passKey("topLoad", "string");
  passKey("dangerousGoods", "string");
  passKey("customsBy", "string");
  passKey("weight", "number");
  passKey("volume", "number");
  passKey("containerCount", "number");
  passKey("targetPrice", "number");
  passKey("targetCurrency", "string");
  passKey("targetPriceStatus", "string");
  passKey("targetPriceSource", "string");
  passKey("packages", "number");
  passKey("revenue", "number");
  passKey("cost", "number");
  passKey("currency", "string");
  passKey("notes", "string");
  passKey("etd", "date");
  passKey("eta", "date");

  if (Object.keys(update).length > 0) {
    await prisma.job.update({ where: { id: jobId }, data: update });
    if (targetPriceChanged(job, { ...job, ...update })) {
      await recordTargetPriceHistory({
        officeId,
        jobId,
        inquiryId: job.inquiryId,
        amount: typeof update.targetPrice === "number" ? update.targetPrice : job.targetPrice,
        currency: typeof update.targetCurrency === "string" ? update.targetCurrency : job.targetCurrency,
        status: typeof update.targetPriceStatus === "string" ? update.targetPriceStatus : job.targetPriceStatus,
        source: typeof update.targetPriceSource === "string" ? update.targetPriceSource : job.targetPriceSource,
        note: "Agent edit job action.",
      });
    }
  }
  // Mirror onto inquiry too
  if (job.inquiryId) {
    const inquiryBefore = await prisma.inquiry.findUnique({
      where: { id: job.inquiryId },
      select: { targetPrice: true, targetCurrency: true, targetPriceStatus: true, targetPriceSource: true },
    });
    const inqUpdate: Record<string, unknown> = {};
    for (const k of [
      "origin", "destination", "mode", "incoterms", "commodity", "weight", "volume",
      "containerCount", "containerType", "stackable", "topLoad", "dangerousGoods", "customsBy",
      "targetPrice", "targetCurrency", "targetPriceStatus", "targetPriceSource",
    ]) {
      if (k in update) inqUpdate[k] = update[k];
    }
    if (Object.keys(inqUpdate).length > 0) {
      await prisma.inquiry.update({ where: { id: job.inquiryId }, data: inqUpdate });
      if (inquiryBefore && targetPriceChanged(inquiryBefore, { ...inquiryBefore, ...inqUpdate })) {
        await recordTargetPriceHistory({
          officeId,
          inquiryId: job.inquiryId,
          jobId,
          amount: typeof inqUpdate.targetPrice === "number" ? inqUpdate.targetPrice : inquiryBefore.targetPrice,
          currency: typeof inqUpdate.targetCurrency === "string" ? inqUpdate.targetCurrency : inquiryBefore.targetCurrency,
          status: typeof inqUpdate.targetPriceStatus === "string" ? inqUpdate.targetPriceStatus : inquiryBefore.targetPriceStatus,
          source: typeof inqUpdate.targetPriceSource === "string" ? inqUpdate.targetPriceSource : inquiryBefore.targetPriceSource,
          note: "Agent edit job mirrored to inquiry.",
        });
      }
    }
  }
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  return { ok: true, applied };
}

export async function applyMoveStage(jobId: string, officeId: string, status: string): Promise<{ ok: true; from: string; to: string } | { error: string }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId }, select: { id: true, status: true } });
  if (!job) return { error: "Job not found" };
  await prisma.job.update({ where: { id: jobId }, data: { status: status as never } });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  return { ok: true, from: job.status, to: status };
}

export async function applySetCustomer(jobId: string, officeId: string, args: { companyName: string; createIfMissing?: boolean }): Promise<{ ok: true; created: boolean; companyName: string } | { error: string }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId }, select: { id: true, inquiryId: true } });
  if (!job) return { error: "Job not found" };
  // Try to find an existing company in this office (case-insensitive).
  let company = await prisma.company.findFirst({
    where: { officeId, name: { equals: args.companyName, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  let created = false;
  if (!company) {
    if (args.createIfMissing === false) return { error: `No customer named "${args.companyName}" in this office` };
    try {
      company = await prisma.company.create({
        data: { officeId, name: args.companyName },
        select: { id: true, name: true },
      });
      created = true;
    } catch {
      // unique violation race — re-fetch
      company = await prisma.company.findFirst({
        where: { officeId, name: args.companyName },
        select: { id: true, name: true },
      });
      if (!company) return { error: "Couldn't create or find that company" };
    }
  }
  await prisma.job.update({ where: { id: jobId }, data: { companyId: company.id } });
  if (job.inquiryId) {
    await prisma.inquiry.update({ where: { id: job.inquiryId }, data: { companyId: company.id } });
  }
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/customers");
  return { ok: true, created, companyName: company.name };
}

export async function applyRenameCompany(jobId: string, officeId: string, newName: string): Promise<{ ok: true; from: string; to: string } | { error: string }> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId },
    select: { id: true, company: { select: { id: true, name: true } } },
  });
  if (!job) return { error: "Job not found" };
  if (!job.company) return { error: "This job has no customer linked yet — set one first" };
  const from = job.company.name;
  // Avoid duplicate-name collision
  const existing = await prisma.company.findFirst({
    where: { officeId, name: { equals: newName, mode: "insensitive" }, NOT: { id: job.company.id } },
    select: { id: true },
  });
  if (existing) return { error: `Another customer named "${newName}" already exists` };
  await prisma.company.update({ where: { id: job.company.id }, data: { name: newName } });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/customers");
  return { ok: true, from, to: newName };
}

export async function applyEditInquiry(jobId: string, officeId: string, fields: Record<string, unknown>): Promise<{ ok: true; applied: string[] } | { error: string }> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId },
    select: {
      inquiryId: true,
      inquiry: {
        select: { targetPrice: true, targetCurrency: true, targetPriceStatus: true, targetPriceSource: true },
      },
    },
  });
  if (!job?.inquiryId) return { error: "Job has no linked inquiry" };
  const update: Record<string, unknown> = {};
  const applied: string[] = [];
  const set = (k: string, v: unknown, t: "string" | "number") => {
    if (v == null || v === "") return;
    if (t === "number") { const n = Number(v); if (!isNaN(n)) { update[k] = n; applied.push(`${k}=${n}`); } }
    else { update[k] = String(v); applied.push(`${k}=${String(v)}`); }
  };
  set("origin", fields.origin, "string");
  set("destination", fields.destination, "string");
  set("mode", fields.mode, "string");
  set("incoterms", fields.incoterms, "string");
  set("commodity", fields.commodity, "string");
  set("containerType", fields.containerType, "string");
  set("stackable", fields.stackable, "string");
  set("topLoad", fields.topLoad, "string");
  set("dangerousGoods", fields.dangerousGoods, "string");
  set("customsBy", fields.customsBy, "string");
  set("subject", fields.subject, "string");
  set("fromEmail", fields.fromEmail, "string");
  set("fromCompany", fields.fromCompany, "string");
  set("weight", fields.weight, "number");
  set("volume", fields.volume, "number");
  set("containerCount", fields.containerCount, "number");
  set("targetPrice", fields.targetPrice, "number");
  set("targetCurrency", fields.targetCurrency, "string");
  set("targetPriceStatus", fields.targetPriceStatus, "string");
  set("targetPriceSource", fields.targetPriceSource, "string");
  if (Object.keys(update).length === 0) return { error: "No recognized fields to update" };
  await prisma.inquiry.update({ where: { id: job.inquiryId }, data: update });
  if (job.inquiry && targetPriceChanged(job.inquiry, { ...job.inquiry, ...update })) {
    await recordTargetPriceHistory({
      officeId,
      inquiryId: job.inquiryId,
      jobId,
      amount: typeof update.targetPrice === "number" ? update.targetPrice : job.inquiry.targetPrice,
      currency: typeof update.targetCurrency === "string" ? update.targetCurrency : job.inquiry.targetCurrency,
      status: typeof update.targetPriceStatus === "string" ? update.targetPriceStatus : job.inquiry.targetPriceStatus,
      source: typeof update.targetPriceSource === "string" ? update.targetPriceSource : job.inquiry.targetPriceSource,
      note: "Agent edit inquiry action.",
    });
  }
  revalidatePath(`/dashboard/rfq/${job.inquiryId}`);
  revalidatePath(`/dashboard/jobs/${jobId}`);
  return { ok: true, applied };
}

export async function applySetMoney(jobId: string, officeId: string, kind: "revenue" | "cost", amount: number, currency?: string): Promise<{ ok: true; kind: string; amount: number } | { error: string }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId }, select: { id: true } });
  if (!job) return { error: "Job not found" };
  const data: Record<string, unknown> = { [kind]: amount };
  if (currency && ["USD", "EUR", "GBP", "TRY"].includes(currency)) data.currency = currency;
  await prisma.job.update({ where: { id: jobId }, data });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  return { ok: true, kind, amount };
}

export async function applyAddQuoteLine(jobId: string, officeId: string, args: { description: string; amount: number; currency?: string }): Promise<{ ok: true } | { error: string }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId }, select: { id: true, notes: true, quoteLines: true, currency: true } });
  if (!job) return { error: "Job not found" };
  const cur = args.currency ?? job.currency ?? "USD";
  // Quote lines are stored pipe-delimited in Job.quoteLines (fold in legacy lines from notes).
  const legacy = job.quoteLines == null
    ? parsePipeLines(job.notes).map((l) => `${l.desc}|${l.amount}|${l.cur}`)
    : [];
  const existing = [job.quoteLines ?? "", ...legacy].filter(Boolean).join("\n");
  const line = `${args.description}|${args.amount}|${cur}`;
  await prisma.job.update({ where: { id: jobId }, data: { quoteLines: existing ? `${existing}\n${line}` : line } });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  return { ok: true };
}

export async function applyDeleteJob(jobId: string, officeId: string): Promise<{ ok: true; reference: string } | { error: string }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId }, select: { id: true, reference: true } });
  if (!job) return { error: "Job not found" };
  await prisma.job.delete({ where: { id: jobId } });
  revalidatePath("/dashboard/jobs");
  return { ok: true, reference: job.reference };
}

export async function applyAddMilestone(jobId: string, officeId: string, args: { type: string; plannedAt?: string; actualAt?: string; note?: string }): Promise<{ ok: true; type: string } | { error: string }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId }, select: { id: true } });
  if (!job) return { error: "Job not found" };

  // Upsert by (jobId, type)
  const existing = await prisma.jobMilestone.findFirst({
    where: { jobId, type: args.type, job: { officeId } },
  });
  const data: Record<string, unknown> = { jobId, type: args.type };
  if (args.plannedAt) {
    const d = new Date(args.plannedAt);
    if (!isNaN(d.getTime())) data.plannedAt = d;
  }
  if (args.actualAt) {
    const d = new Date(args.actualAt);
    if (!isNaN(d.getTime())) data.actualAt = d;
  }
  if (args.note) data.note = args.note;

  if (existing) {
    await prisma.jobMilestone.updateMany({
      where: { id: existing.id, job: { officeId } },
      data,
    });
  } else {
    await prisma.jobMilestone.create({ data: data as never });
  }
  revalidatePath(`/dashboard/jobs/${jobId}`);
  return { ok: true, type: args.type };
}
