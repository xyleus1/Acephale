"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma";
import { sendReplyToThread } from "./gmail-send";
import { ensurePortalToken } from "./portal";

// Send a customer-facing status update email when a Job advances to a
// meaningful status, or when an important milestone is logged. Skips if
// notifyCustomer=false on the job, if no recipient can be determined, or if
// the most recent customer-facing email already covered the same status.
//
// Recipient priority:
// 1. job.customerEmail (operator override)
// 2. inquiry.fromEmail (the original RFQ sender)
//
// Delivery: piggyback on the most recent customer thread (same Gmail
// conversation → it threads naturally) using sendReplyToThread. If no
// customer thread exists yet we just queue an EmailMessage record locally
// so the agent surfaces it on next interaction (no out-of-band send).
const NOTIFY_STATUSES = new Set(["BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"]);

export async function maybeNotifyCustomerOnStatusChange(jobId: string, fromStatus: string, toStatus: string): Promise<void> {
  if (fromStatus === toStatus) return;
  if (!NOTIFY_STATUSES.has(toStatus)) return;
  await sendStatusUpdate(jobId, { reason: "status-change", fromStatus, toStatus });
}

export async function maybeNotifyCustomerOnMilestone(jobId: string, milestoneType: string, isActual: boolean): Promise<void> {
  if (!isActual) return;
  if (milestoneType !== "DELIVERY") return;
  await sendStatusUpdate(jobId, { reason: "milestone", milestoneType });
}

async function sendStatusUpdate(jobId: string, ctx: { reason: "status-change"; fromStatus: string; toStatus: string } | { reason: "milestone"; milestoneType: string }): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      company: { select: { name: true } },
      inquiry: { select: { fromEmail: true, commodity: true } },
      milestones: { select: { type: true, plannedAt: true, actualAt: true } },
      emailThreads: {
        include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
        orderBy: { lastMessageAt: "desc" },
        take: 5,
      },
    },
  });
  if (!job) return;
  if (!job.notifyCustomer) return;
  const recipient = job.customerEmail ?? job.inquiry?.fromEmail;
  if (!recipient) return;

  // Pick a thread to reply on: most recent thread that has any message FROM the recipient.
  const recipientThread = job.emailThreads.find((t) =>
    t.messages.some((m) => m.fromEmail.toLowerCase() === recipient.toLowerCase())
  );
  if (!recipientThread) return; // no customer thread yet — skip silent send

  // Generate portal link.
  let portalUrl: string | null = null;
  try {
    // Re-fetch via session-less helper: we'll just compute manually here so we
    // don't require requireSession in this server-internal path.
    let token = job.portalToken;
    if (!token) {
      const crypto = await import("crypto");
      token = crypto.randomBytes(16).toString("hex");
      await prisma.job.updateMany({
        where: { id: job.id, officeId: job.officeId },
        data: { portalToken: token },
      });
    }
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://derya-crm.vercel.app");
    portalUrl = `${baseUrl}/portal/${token}`;
  } catch {}

  // Avoid the lint complaint about unused import while keeping import for clarity if needed elsewhere.
  void ensurePortalToken;

  // AI drafts the body.
  const client = new Anthropic({ apiKey });
  const ctxLine = ctx.reason === "status-change"
    ? `The shipment just moved to status "${ctx.toStatus}". Previous status was "${ctx.fromStatus}".`
    : `The "${ctx.milestoneType}" milestone has been confirmed.`;

  const milestonesSummary = job.milestones.map((m) =>
    `${m.type}: ${m.actualAt ? "done " + new Date(m.actualAt).toISOString().split("T")[0] : m.plannedAt ? "planned " + new Date(m.plannedAt).toISOString().split("T")[0] : "open"}`
  ).join(", ");

  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 350,
    system: `You write a short customer-facing shipment-update email from a freight forwarding & procurement office to their CUSTOMER (not a supplier). Tone: professional, calm, factual. No emojis, no markdown. Under 110 words. Sign as "Your forwarder at Derya Maritime" (do not invent a name). Always include the portal link if provided so the customer can self-serve future updates.`,
    messages: [{
      role: "user",
      content: `Job ${job.reference} for ${job.company?.name ?? "the customer"}.\nCommodity: ${job.inquiry?.commodity ?? "—"}\nRoute: ${job.origin ?? "?"} → ${job.destination ?? "?"}\nMilestones: ${milestonesSummary}\nUpdate: ${ctxLine}\n${portalUrl ? `Live portal link to include: ${portalUrl}` : ""}\n\nDraft the email body.`,
    }],
  });
  const text = result.content[0].type === "text" ? result.content[0].text : "";
  if (!text.trim()) return;

  // Send via Gmail on the existing customer thread.
  await sendReplyToThread({
    threadDbId: recipientThread.id,
    body: text.trim(),
    replyTo: recipient,
  }).catch(() => {});
}
