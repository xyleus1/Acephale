"use server";

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma";

// Classify an email attachment into one of our doc types and attach it as a
// JobDocument on the linked job. Idempotent: skips attachments already
// converted to a JobDocument (matched by URL pointing back to this attachment).
//
// We don't store the file bytes — JobDocument.url points to the streaming
// /api/gmail/attachment endpoint which fetches on demand.
const VALID_DOC_TYPES = ["BOOKING", "INVOICE", "PACKING_LIST", "BL", "COO", "CUSTOMS", "OTHER"];

export async function classifyEmailAttachments(args: {
  jobId: string;
  officeId: string;
}): Promise<{ ok: true; created: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: true, created: 0 };

  const job = await prisma.job.findFirst({
    where: { id: args.jobId, officeId: args.officeId },
    include: {
      documents: { select: { url: true } },
      emailThreads: { include: { messages: { orderBy: { sentAt: "asc" } } } },
      inquiry: {
        include: { emailThreads: { include: { messages: { orderBy: { sentAt: "asc" } } } } },
      },
    },
  });
  if (!job) return { ok: true, created: 0 };

  // Collect threads from job + via inquiry, dedup by id.
  const threadIds = new Set<string>();
  const allThreads = [
    ...job.emailThreads,
    ...(job.inquiry?.emailThreads ?? []),
  ].filter((t) => {
    if (threadIds.has(t.id)) return false;
    threadIds.add(t.id);
    return true;
  });

  const existingUrls = new Set(job.documents.map((d) => d.url).filter(Boolean));
  const client = new Anthropic({ apiKey });
  let created = 0;

  for (const thread of allThreads) {
    for (const msg of thread.messages) {
      if (!msg.attachments) continue;
      let atts: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];
      try { atts = JSON.parse(msg.attachments); } catch { continue; }
      for (const a of atts) {
        const url = `/api/gmail/attachment?messageDbId=${msg.id}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}`;
        if (existingUrls.has(url)) continue;

        // Ask Haiku to classify based on filename + email subject + body excerpt.
        const result = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 120,
          system: `You classify a single freight document attachment by its filename + the email it arrived in.

Output ONLY this JSON: { "docType": "BOOKING"|"INVOICE"|"PACKING_LIST"|"BL"|"COO"|"CUSTOMS"|"OTHER", "confidence": 0-100 }

Doc types:
- BOOKING — booking confirmation from carrier/freight forwarder
- INVOICE — commercial invoice (CI), pro forma invoice (PI), proforma
- PACKING_LIST — packing list, PL
- BL — Bill of Lading, B/L, master/house BL, sea waybill
- COO — Certificate of Origin
- CUSTOMS — customs declaration / entry / clearance papers
- OTHER — anything that doesn't clearly match (contracts, photos, generic PDFs)

Match common filename patterns: "BL_..." / "B_L_..." / "COO_..." / "Invoice_..." / "Packing-List_..." / "Booking_Confirmation_...".`,
          messages: [{
            role: "user",
            content: `Filename: ${a.filename}\nMIME: ${a.mimeType}\nEmail subject: ${msg.subject ?? "(none)"}\nEmail body (first 600 chars): ${(msg.bodyText ?? "").slice(0, 600)}`,
          }],
        });
        const text = result.content[0].type === "text" ? result.content[0].text : "";
        const m = text.match(/\{[\s\S]*\}/);
        let docType = "OTHER";
        if (m) {
          try {
            const j = JSON.parse(m[0]);
            if (typeof j.docType === "string" && VALID_DOC_TYPES.includes(j.docType)) docType = j.docType;
          } catch {}
        }

        // Promote any existing PENDING JobDocument of the same type before creating
        // a new one, since initJobMilestones/initJobDocuments seeded one per type.
        const placeholder = await prisma.jobDocument.findFirst({
          where: { jobId: args.jobId, docType, status: "PENDING", url: null },
        });
        if (placeholder) {
          await prisma.jobDocument.update({
            where: { id: placeholder.id },
            data: { name: a.filename, url, status: "UPLOADED" },
          });
        } else {
          await prisma.jobDocument.create({
            data: {
              jobId: args.jobId,
              officeId: args.officeId,
              name: a.filename,
              url,
              docType,
              status: "UPLOADED",
            },
          });
        }
        existingUrls.add(url);
        created++;
      }
    }
  }

  return { ok: true, created };
}
