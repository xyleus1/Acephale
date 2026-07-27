"use server";

import Gpt56Client from "./gpt56-client";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { getValidAccessToken } from "./gmail-oauth";

// Fetch a JobDocument's actual bytes (Gmail attachment, public URL, or
// data: URL), extract text from PDFs, ask GPT-5.6 to generate a structured
// commentary, and persist results. Surfaced on the job workbench.
//
// Idempotent: skips if aiAnalyzedAt is recent (within 7 days) and force=false.
export async function analyzeJobDocument(args: {
  documentId: string;
  force?: boolean;
}): Promise<{ ok: true; summary: string; flags: string[]; keyFields: Record<string, unknown> } | { error: string }> {
  const session = await requireSession();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY is not set" };

  const doc = await prisma.jobDocument.findFirst({
    where: { id: args.documentId, officeId: session.officeId },
    include: { job: { include: { inquiry: { select: { commodity: true } } } } },
  });
  if (!doc) return { error: "Document not found" };
  if (!doc.url) return { error: "Document has no file URL yet" };

  // Skip recent analyses unless forced.
  if (!args.force && doc.aiAnalyzedAt && Date.now() - doc.aiAnalyzedAt.getTime() < 7 * 24 * 3600 * 1000) {
    return {
      ok: true,
      summary: doc.aiSummary ?? "",
      flags: doc.aiFlags ? safeJsonArray(doc.aiFlags) : [],
      keyFields: doc.aiKeyFields ? safeJsonObject(doc.aiKeyFields) : {},
    };
  }

  // Get the bytes. Gmail attachment URL has the form
  // /api/gmail/attachment?messageDbId=...&attachmentId=...
  let pdfText = "";
  try {
    if (doc.url.startsWith("/api/gmail/attachment")) {
      // Internal Gmail proxy - we have to call the Gmail API directly here
      // because the proxy expects a session and we already validated above.
      const u = new URL(doc.url, "http://localhost");
      const messageDbId = u.searchParams.get("messageDbId");
      const attachmentId = u.searchParams.get("attachmentId");
      if (!messageDbId || !attachmentId) return { error: "Malformed attachment URL" };
      const msg = await prisma.emailMessage.findFirst({
        where: { id: messageDbId, account: { officeId: session.officeId } },
        select: { gmailMessageId: true, account: { select: { id: true, provider: true } } },
      });
      if (!msg?.account || msg.account.provider !== "GMAIL" || !msg.gmailMessageId) {
        return { error: "Cannot fetch attachment - provider mismatch" };
      }
      const token = await getValidAccessToken(msg.account.id);
      const apiUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.gmailMessageId}/attachments/${attachmentId}`;
      const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { error: `Gmail attachment fetch failed (${res.status})` };
      const json: { data?: string } = await res.json();
      if (!json.data) return { error: "Empty attachment" };
      const buf = Buffer.from(json.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      pdfText = await extractPdfText(buf);
    } else if (doc.url.startsWith("data:")) {
      // data:application/pdf;base64,...
      const m = doc.url.match(/^data:[^;]+;base64,(.+)$/);
      if (m) {
        pdfText = await extractPdfText(Buffer.from(m[1], "base64"));
      }
    } else {
      // Fallback: try fetching as a public URL.
      const res = await fetch(doc.url);
      if (!res.ok) return { error: `Doc fetch failed (${res.status})` };
      const buf = Buffer.from(await res.arrayBuffer());
      pdfText = await extractPdfText(buf);
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "PDF fetch/parse failed" };
  }

  if (!pdfText.trim()) {
    return { error: "Couldn't extract any text from the document - may be a scanned image (OCR not yet supported)" };
  }

  const client = new Gpt56Client({ apiKey });
  const result = await client.messages.create({
    model: "gpt-5.6",
    max_tokens: 600,
    system: `You are a freight forwarding office assistant analyzing a single shipment document.

Doc type: ${doc.docType}
Job context: ${doc.job?.reference ?? "?"} | commodity ${doc.job?.inquiry?.commodity ?? "-"} | ${doc.job?.origin ?? "?"} → ${doc.job?.destination ?? "?"}

Output ONLY this JSON (no markdown):
{
  "summary": "1-3 sentences describing what's in this document",
  "flags": ["short bullet of any red flag, discrepancy, or unusual item - empty array if all normal"],
  "key_fields": { /* object of structured fields specific to the doc type */ }
}

For BL: extract bl_number, vessel, voyage, container_no, gross_weight_kg, shipper, consignee, port_of_loading, port_of_discharge.
For INVOICE: invoice_no, invoice_date, currency, total, qty, unit_price, payment_terms, seller, buyer.
For PACKING_LIST: total_packages, gross_weight_kg, net_weight_kg, dimensions, package_type.
For COO: certificate_no, country_of_origin, exporter, hs_codes (array).
For CUSTOMS: declaration_no, hs_code, duty_rate, customs_value.
For BOOKING: booking_no, vessel, etd, eta, container_count, carrier.
For OTHER: free-form key_fields with whatever is most useful.

Flags should call out: weights that don't match, dates inconsistent with job ETD/ETA, missing signatures noted in the doc, expired validity, unusual currency, anything that should make the operator look closer. If nothing's wrong, return [].

Be conservative with flags - false alarms erode trust.`,
    messages: [{
      role: "user",
      content: `Document text (first 12000 chars):\n\n${pdfText.slice(0, 12000)}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "AI returned no JSON" };
  let parsed: { summary?: string; flags?: string[]; key_fields?: Record<string, unknown> };
  try { parsed = JSON.parse(m[0]); } catch { return { error: "AI JSON parse failed" }; }

  const summary = (parsed.summary ?? "").slice(0, 1000);
  const flags = Array.isArray(parsed.flags) ? parsed.flags.filter((x) => typeof x === "string").slice(0, 8) : [];
  const keyFields = parsed.key_fields && typeof parsed.key_fields === "object" ? parsed.key_fields : {};

  await prisma.jobDocument.updateMany({
    where: { id: doc.id, officeId: doc.officeId },
    data: {
      aiSummary: summary,
      aiFlags: JSON.stringify(flags),
      aiKeyFields: JSON.stringify(keyFields),
      aiAnalyzedAt: new Date(),
    },
  });
  revalidatePath(`/dashboard/jobs/${doc.jobId}`);
  return { ok: true, summary, flags, keyFields };
}

// Ask a free-form question about a JobDocument. Fetches the PDF text on the
// fly (or reuses cached aiSummary + key fields if PDF text is unavailable)
// and feeds the operator's question through GPT-5.6 for a grounded answer.
export async function askAboutDocument(args: {
  documentId: string;
  question: string;
}): Promise<{ ok: true; answer: string } | { error: string }> {
  const session = await requireSession();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OPENAI_API_KEY is not set" };

  const doc = await prisma.jobDocument.findFirst({
    where: { id: args.documentId, officeId: session.officeId },
    include: { job: { include: { inquiry: { select: { commodity: true } } } } },
  });
  if (!doc) return { error: "Document not found" };
  if (!doc.url) return { error: "Document has no file yet" };

  // Try to load full PDF text. If it fails (e.g. data: placeholder),
  // fall back to the cached aiSummary + key_fields, which are already
  // structured representations of the doc.
  let pdfText = "";
  try {
    if (doc.url.startsWith("/api/gmail/attachment")) {
      const u = new URL(doc.url, "http://localhost");
      const messageDbId = u.searchParams.get("messageDbId");
      const attachmentId = u.searchParams.get("attachmentId");
      if (messageDbId && attachmentId) {
        const msg = await prisma.emailMessage.findFirst({
          where: { id: messageDbId, account: { officeId: session.officeId } },
          select: { gmailMessageId: true, account: { select: { id: true, provider: true } } },
        });
        if (msg?.account?.provider === "GMAIL" && msg.gmailMessageId) {
          const token = await getValidAccessToken(msg.account.id);
          const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.gmailMessageId}/attachments/${attachmentId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const j: { data?: string } = await res.json();
            if (j.data) {
              pdfText = await extractPdfText(Buffer.from(j.data.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
            }
          }
        }
      }
    } else if (doc.url.startsWith("data:")) {
      const m = doc.url.match(/^data:[^;]+;base64,(.+)$/);
      if (m) pdfText = await extractPdfText(Buffer.from(m[1], "base64"));
    } else {
      const res = await fetch(doc.url);
      if (res.ok) pdfText = await extractPdfText(Buffer.from(await res.arrayBuffer()));
    }
  } catch { /* fall through to cached summary */ }

  let context: string;
  if (pdfText.trim().length > 200) {
    context = `Full document text:\n\n${pdfText.slice(0, 14000)}`;
  } else if (doc.aiSummary || doc.aiKeyFields) {
    let keyFields: Record<string, unknown> = {};
    try { keyFields = JSON.parse(doc.aiKeyFields ?? "{}"); } catch {}
    context = `(PDF text unavailable - answering from cached AI summary + extracted fields.)\n\nSummary: ${doc.aiSummary ?? "-"}\n\nExtracted fields:\n${Object.entries(keyFields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}`;
  } else {
    return { error: "Couldn't read the document and no cached analysis exists. Approve the doc first to trigger analysis." };
  }

  const client = new Gpt56Client({ apiKey });
  const result = await client.messages.create({
    model: "gpt-5.6",
    max_tokens: 600,
    system: `You answer the operator's question about a single freight document. Be concise (<120 words). Quote specific numbers/dates from the doc when relevant. If the answer isn't in the document, say so plainly - don't speculate. No emojis, no markdown headers.

Doc type: ${doc.docType}. Filename: ${doc.name}. Job: ${doc.job?.reference ?? "?"} (${doc.job?.inquiry?.commodity ?? "-"}, ${doc.job?.origin ?? "?"} → ${doc.job?.destination ?? "?"}).`,
    messages: [{
      role: "user",
      content: `${context}\n\n────\n\nOperator question: ${args.question}`,
    }],
  });

  const text = result.content[0].type === "text" ? result.content[0].text : "";
  return { ok: true, answer: text.trim() };
}

async function extractPdfText(buf: Buffer): Promise<string> {
  // Lazy import - pdf-parse pulls in node fs at import time which makes
  // unrelated server actions trip on cold start.
  // @ts-expect-error pdf-parse has no types
  const pdfParse = (await import("pdf-parse")).default;
  const result: { text?: string } = await pdfParse(buf);
  return result.text ?? "";
}

function safeJsonArray(s: string): string[] {
  try {
    const x = JSON.parse(s);
    return Array.isArray(x) ? x.filter((y) => typeof y === "string") : [];
  } catch { return []; }
}
function safeJsonObject(s: string): Record<string, unknown> {
  try {
    const x = JSON.parse(s);
    return x && typeof x === "object" && !Array.isArray(x) ? x : {};
  } catch { return {}; }
}
