import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { parseQuoteLines } from "@/lib/quote-lines";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await requireSession();
  const { jobId } = await params;

  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    include: { company: { select: { name: true } } },
  });

  if (!job) return new NextResponse("Not found", { status: 404 });

  const lines = parseQuoteLines(job);

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const currency = lines[0]?.cur ?? job.currency ?? "USD";

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const validUntil = new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Quote ${job.reference}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #111; background: #fff; padding: 48px; font-size: 14px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 2px solid #1e3a8a; }
  .brand { font-size: 22px; font-weight: 800; color: #1e3a8a; }
  .brand-sub { font-size: 12px; color: #6b7280; font-weight: 400; }
  .ref { font-size: 13px; color: #6b7280; text-align: right; }
  .ref strong { font-size: 18px; color: #111; display: block; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; font-weight: 600; margin-bottom: 6px; }
  .section { margin-bottom: 28px; }
  .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 18px; background: #f9fafb; border-radius: 8px; }
  .meta-item .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; font-weight: 600; margin-bottom: 4px; }
  .meta-item .value { font-size: 14px; font-weight: 600; color: #111; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; font-weight: 600; padding: 10px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
  td { padding: 12px 12px; border-bottom: 1px solid #f3f4f6; color: #111; }
  tr:last-child td { border-bottom: none; }
  .amount { font-weight: 600; text-align: right; }
  th.amount { text-align: right; }
  .total-row { background: #f9fafb; }
  .total-row td { font-weight: 800; font-size: 16px; padding: 14px 12px; border-top: 2px solid #e5e7eb; }
  .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  @media print { body { padding: 24px; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="brand">Derya</div>
    <div class="brand-sub">Freight Desk</div>
  </div>
  <div class="ref">
    <strong>${job.reference}</strong>
    Quote Date: ${today}
  </div>
</div>

<div class="section">
  <h2>Quote for</h2>
  <div class="meta-grid">
    <div class="meta-item">
      <div class="label">Customer</div>
      <div class="value">${job.company?.name ?? "—"}</div>
    </div>
    <div class="meta-item">
      <div class="label">Route</div>
      <div class="value">${job.origin && job.destination ? `${job.origin} → ${job.destination}` : "—"}</div>
    </div>
    <div class="meta-item">
      <div class="label">Mode</div>
      <div class="value">${job.mode ?? "—"}</div>
    </div>
    <div class="meta-item">
      <div class="label">Commodity</div>
      <div class="value">${job.commodity ?? "—"}</div>
    </div>
    <div class="meta-item">
      <div class="label">Incoterms</div>
      <div class="value">${job.incoterms ?? "—"}</div>
    </div>
    <div class="meta-item">
      <div class="label">Valid Until</div>
      <div class="value">${validUntil}</div>
    </div>
  </div>
</div>

<div class="section">
  <h2>Charges</h2>
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="amount">Amount</th>
        <th>Currency</th>
      </tr>
    </thead>
    <tbody>
      ${lines.length > 0
        ? lines.map((l) => `
        <tr>
          <td>${l.desc}</td>
          <td class="amount">${l.amount.toLocaleString()}</td>
          <td style="color:#6b7280">${l.cur}</td>
        </tr>`).join("")
        : `<tr><td colspan="3" style="color:#9ca3af;text-align:center;padding:24px">No charges added</td></tr>`
      }
    </tbody>
    ${lines.length > 0 ? `
    <tfoot>
      <tr class="total-row">
        <td>Total</td>
        <td class="amount">${total.toLocaleString()}</td>
        <td>${currency}</td>
      </tr>
    </tfoot>` : ""}
  </table>
</div>

<div class="footer">
  This quotation is valid for 7 days from the date of issue. Rates are subject to availability and space confirmation.
  Derya Deal Desk · Generated ${today}
</div>

<script>window.print();</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
