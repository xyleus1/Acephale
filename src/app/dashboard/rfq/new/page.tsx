import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Icon } from "@/components/icon";
import { qualifyRfq } from "@/lib/rfq-qualification";
import { recordTargetPriceHistory } from "@/lib/target-price-history";
import { recordMemoryEvent } from "@/lib/memory/record-event";

async function createRFQ(formData: FormData) {
  "use server";
  const session = await requireSession();

  const companyId = String(formData.get("companyId") || "");
  const cargoReadyDate = formData.get("cargoReadyDate")
    ? new Date(String(formData.get("cargoReadyDate")))
    : null;
  const targetPrice = formData.get("targetPrice") ? Number(formData.get("targetPrice")) : null;
  const data = {
    officeId: session.officeId,
    companyId: companyId || null,
    subject: String(formData.get("subject") || "Manual RFQ"),
    fromEmail: String(formData.get("fromEmail") || ""),
    fromCompany: String(formData.get("fromCompany") || ""),
    origin: String(formData.get("origin") || ""),
    destination: String(formData.get("destination") || ""),
    mode: String(formData.get("mode") || ""),
    containerType: String(formData.get("containerType") || ""),
    containerCount: formData.get("containerCount") ? Number(formData.get("containerCount")) : null,
    dimensions: String(formData.get("dimensions") || "") || null,
    stackable: String(formData.get("stackable") || "UNKNOWN"),
    topLoad: String(formData.get("topLoad") || "UNKNOWN"),
    dangerousGoods: String(formData.get("dangerousGoods") || "UNKNOWN"),
    customsBy: String(formData.get("customsBy") || "UNKNOWN"),
    incoterms: String(formData.get("incoterms") || ""),
    commodity: String(formData.get("commodity") || ""),
    weight: formData.get("weight") ? Number(formData.get("weight")) : null,
    volume: formData.get("volume") ? Number(formData.get("volume")) : null,
    targetPrice,
    targetCurrency: String(formData.get("targetCurrency") || "USD"),
    targetPriceStatus: targetPrice != null
      ? "PROVIDED"
      : String(formData.get("targetPriceStatus") || "UNKNOWN"),
    targetPriceSource: String(formData.get("targetPriceSource") || "").trim() || null,
    notes: String(formData.get("notes") || ""),
    rawEmailBody: String(formData.get("notes") || ""),
    cargoReadyDate,
    receivedAt: new Date(),
  };
  const qualification = qualifyRfq(data);

  const inquiry = await prisma.inquiry.create({
    data: {
      ...data,
      status: qualification.isMature ? "PARSED" : "INGESTED",
      parsedData: JSON.stringify({ qualification }),
    },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "INQUIRY",
    sourceExternalId: `manual_rfq:${inquiry.id}`,
    eventType: "inquiry.created",
    entityType: "inquiry",
    entityId: inquiry.id,
    actorType: "user",
    actorId: session.userId,
    occurredAt: inquiry.createdAt,
    payloadVersion: 1,
    payload: {
      inquiryId: inquiry.id,
      subject: inquiry.subject,
      status: inquiry.status,
      qualification,
      source: "manual_form",
    },
    provenance: {
      source: "inquiry",
      operation: "manual_create",
      path: "src/app/dashboard/rfq/new/page.tsx",
      function: "createRFQ",
      sourceRecordId: inquiry.id,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `inquiry:${inquiry.id}:created`,
  }).catch(() => null);
  if (targetPrice != null || data.targetPriceStatus === "NO_TARGET") {
    await recordTargetPriceHistory({
      officeId: session.officeId,
      inquiryId: inquiry.id,
      createdByUserId: session.userId,
      amount: data.targetPrice,
      currency: data.targetCurrency,
      status: data.targetPriceStatus,
      source: data.targetPriceSource,
      note: "Manual RFQ creation.",
    });
  }

  revalidatePath("/dashboard/rfq");
  redirect(`/dashboard/rfq/${inquiry.id}`);
}

function FormSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="card form-section">
      <header className="form-section-header">
        <h2 className="form-section-title">{title}</h2>
        {note && <p className="form-section-note">{note}</p>}
      </header>
      <div className="form-section-body">{children}</div>
    </section>
  );
}

export default async function NewRFQPage() {
  const session = await requireSession();

  const companies = await prisma.company.findMany({
    where: { officeId: session.officeId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="form-page">
      <div className="form-back-row">
        <a href="/dashboard/rfq" className="back-link">
          <Icon name="chevron-left" size={14} />
          RFQ Inbox
        </a>
      </div>

      <div className="page-header form-page-header">
        <div>
          <h1 className="page-title">Manual RFQ Entry</h1>
          <p className="page-subtitle">Add a freight request received by phone, chat, or another off-channel source.</p>
        </div>
      </div>

      <form action={createRFQ} className="form-shell">
        <FormSection title="Request Info" note="Identify who asked, what they asked for, and whether a target price exists.">
          <label className="field">
            <span>Subject / Description <span className="required-mark">*</span></span>
            <input name="subject" required placeholder="e.g. FCL Quote Request - Shanghai to Hamburg" />
          </label>
          <div className="form-grid-2">
            <label className="field">
              <span>From (email)</span>
              <input name="fromEmail" type="email" placeholder="customer@example.com" />
            </label>
            <label className="field">
              <span>From (company)</span>
              <input name="fromCompany" placeholder="Company name" />
            </label>
          </div>
          <label className="field">
            <span>Link to Customer</span>
            <select name="companyId">
              <option value="">- Select (optional) -</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <div className="form-grid-3">
            <label className="field">
              <span>Target price status</span>
              <select name="targetPriceStatus" defaultValue="UNKNOWN">
                <option value="UNKNOWN">Ask customer</option>
                <option value="PROVIDED">Target provided</option>
                <option value="NO_TARGET">No target given</option>
              </select>
            </label>
            <label className="field">
              <span>Target price</span>
              <input name="targetPrice" type="number" step="any" placeholder="e.g. 1550" />
            </label>
            <label className="field">
              <span>Currency</span>
              <select name="targetCurrency" defaultValue="USD">
                <option>USD</option>
                <option>EUR</option>
                <option>TRY</option>
                <option>GBP</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Target price source / note</span>
            <input name="targetPriceSource" placeholder="e.g. customer shared this as the shipper budget" />
          </label>
        </FormSection>

        <FormSection title="Freight Details" note="Capture the minimum data needed to price and route the request without re-reading the original message.">
          <div className="form-grid-2">
            <label className="field">
              <span>Origin</span>
              <input name="origin" placeholder="e.g. Shanghai, CN" />
            </label>
            <label className="field">
              <span>Destination</span>
              <input name="destination" placeholder="e.g. Hamburg, DE" />
            </label>
          </div>
          <div className="form-grid-3">
            <label className="field">
              <span>Mode</span>
              <select name="mode">
                <option value="">- Select -</option>
                <option value="SEA-FCL">Sea FCL</option>
                <option value="SEA-LCL">Sea LCL</option>
                <option value="AIR">Air</option>
                <option value="ROAD">Road</option>
                <option value="COURIER">Courier</option>
              </select>
            </label>
            <label className="field">
              <span>Container</span>
              <select name="containerType">
                <option value="">- Select -</option>
                <option value="20GP">20GP</option>
                <option value="40GP">40GP</option>
                <option value="40HC">40HC</option>
                <option value="LCL">LCL</option>
              </select>
            </label>
            <label className="field">
              <span>Container count</span>
              <input name="containerCount" type="number" min="1" placeholder="e.g. 2" />
            </label>
          </div>
          <div className="form-grid-4">
            <label className="field">
              <span>Incoterms</span>
              <select name="incoterms">
                <option value="">- Select -</option>
                {["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Commodity</span>
              <input name="commodity" placeholder="e.g. Machinery" />
            </label>
            <label className="field">
              <span>Weight (kg)</span>
              <input name="weight" type="number" placeholder="0" />
            </label>
            <label className="field">
              <span>Volume (cbm)</span>
              <input name="volume" type="number" placeholder="0" />
            </label>
          </div>
          <div className="form-grid-2">
            <label className="field">
              <span>Dangerous goods?</span>
              <select name="dangerousGoods" defaultValue="UNKNOWN">
                <option value="UNKNOWN">Unknown</option>
                <option value="NO">No</option>
                <option value="YES">Yes</option>
              </select>
            </label>
            <label className="field">
              <span>Customs work by</span>
              <select name="customsBy" defaultValue="UNKNOWN">
                <option value="UNKNOWN">Unknown</option>
                <option value="US">Us</option>
                <option value="CUSTOMER">Customer</option>
                <option value="FORWARDER">Forwarder / agent</option>
              </select>
            </label>
          </div>
          <div className="form-grid-2">
            <label className="field">
              <span>Stackable?</span>
              <select name="stackable" defaultValue="UNKNOWN">
                <option value="UNKNOWN">Unknown</option>
                <option value="YES">Yes</option>
                <option value="NO">No</option>
              </select>
            </label>
            <label className="field">
              <span>Top load?</span>
              <select name="topLoad" defaultValue="UNKNOWN">
                <option value="UNKNOWN">Unknown</option>
                <option value="YES">Requested</option>
                <option value="NO">Not requested</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Cargo ready date</span>
            <input name="cargoReadyDate" type="date" />
          </label>
        </FormSection>

        <FormSection title="Notes">
          <label className="field">
            <span>Additional notes or requirements</span>
            <textarea name="notes" rows={4} placeholder="Hazmat, temperature control, special handling..." />
          </label>
        </FormSection>

        <div className="form-actions">
          <button className="btn" type="submit">Create RFQ</button>
          <a href="/dashboard/rfq" className="btn btn-secondary">Cancel</a>
        </div>
      </form>
    </div>
  );
}
