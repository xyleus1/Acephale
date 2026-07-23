import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { createJobWithReference } from "@/lib/job-actions";
import { resolveCompanyIdByName } from "@/lib/company-resolve";
import { NewJobForm } from "@/components/new-job-form";
import { Icon } from "@/components/icon";
import { recordTargetPriceHistory } from "@/lib/target-price-history";
import { recordAuditLog } from "@/lib/audit";

export const metadata = { title: "New job" };

const VALID_STATUSES = ["PROPOSED", "INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "DELIVERED"];

async function createJob(formData: FormData) {
  "use server";
  const session = await requireSession();

  const companyId = await resolveCompanyIdByName(session.officeId, String(formData.get("companyName") || ""));
  const etd = formData.get("etd") ? new Date(String(formData.get("etd"))) : null;
  const eta = formData.get("eta") ? new Date(String(formData.get("eta"))) : null;
  const statusRaw = String(formData.get("status") || "INQUIRY");
  const status = VALID_STATUSES.includes(statusRaw) ? statusRaw : "INQUIRY";
  const mode = String(formData.get("mode") || "");
  const isFcl = mode === "SEA-FCL";
  const targetPrice = formData.get("targetPrice") ? Number(formData.get("targetPrice")) : null;
  const targetPriceStatus = targetPrice != null
    ? "PROVIDED"
    : String(formData.get("targetPriceStatus") || "UNKNOWN");
  const targetCurrency = String(formData.get("targetCurrency") || "USD");
  const targetPriceSource = String(formData.get("targetPriceSource") || "").trim() || null;

  const job = await createJobWithReference(session.officeId, (reference) => prisma.job.create({
    data: {
      officeId:    session.officeId,
      companyId,
      reference,
      title:       String(formData.get("title") || "").trim() || null,
      cadence:     String(formData.get("cadence") || "") || null,
      status:      status as never,
      mode,
      origin:      String(formData.get("origin") || ""),
      destination: String(formData.get("destination") || ""),
      commodity:   String(formData.get("commodity") || ""),
      incoterms:   String(formData.get("incoterms") || ""),
      weight:      formData.get("weight") ? Number(formData.get("weight")) : null,
      volume:      !isFcl && formData.get("volume") ? Number(formData.get("volume")) : null,
      dimensions:  !isFcl && formData.get("dimensions") ? String(formData.get("dimensions")) : null,
      stackable:   !isFcl ? String(formData.get("stackable") || "UNKNOWN") : null,
      topLoad:     !isFcl ? String(formData.get("topLoad") || "") || null : null,
      dangerousGoods: String(formData.get("dangerousGoods") || "UNKNOWN"),
      customsBy:   String(formData.get("customsBy") || "UNKNOWN"),
      containerCount: isFcl && formData.get("containerCount") ? Number(formData.get("containerCount")) : null,
      containerType:  isFcl ? String(formData.get("containerType") || "") || null : null,
      quantity:    formData.get("quantity") ? Number(formData.get("quantity")) : null,
      quantityUnit: String(formData.get("quantityUnit") || "").trim().toUpperCase() || null,
      targetPrice,
      targetCurrency,
      targetPriceStatus,
      targetPriceSource,
      revenue:     formData.get("revenue") ? Number(formData.get("revenue")) : null,
      cost:        formData.get("cost") ? Number(formData.get("cost")) : null,
      notes:       String(formData.get("notes") || "").trim() || null,
      currency:    "USD",
      etd,
      eta,
      // Loads start unassigned: people take them from the board (or an admin
      // assigns them) - creation is not ownership.
    },
  }));
  await recordAuditLog({
    officeId: session.officeId,
    actorUserId: session.userId,
    actorEmail: session.email,
    action: "load.created",
    entityId: job.id,
    entityRef: job.reference,
    summary: "Created this load manually",
  });
  if (targetPrice != null || targetPriceStatus === "NO_TARGET") {
    await recordTargetPriceHistory({
      officeId: session.officeId,
      jobId: job.id,
      createdByUserId: session.userId,
      amount: targetPrice,
      currency: targetCurrency,
      status: targetPriceStatus,
      source: targetPriceSource,
      note: "Manual job creation.",
    });
  }

  revalidatePath("/dashboard/jobs");
  redirect(`/dashboard/jobs/${job.id}`);
}

export default async function NewJobPage() {
  const session = await requireSession();

  const companies = await prisma.company.findMany({
    where: { officeId: session.officeId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="form-page">
      <div className="form-back-row">
        <a href="/dashboard/jobs" className="back-link">
          <Icon name="chevron-left" size={14} />
          Jobs
        </a>
      </div>

      <div className="page-header form-page-header">
        <div>
          <h1 className="page-title">New Job</h1>
          <p className="page-subtitle">Create a manual job without an RFQ</p>
        </div>
      </div>

      <NewJobForm companies={companies} action={createJob} />
    </div>
  );
}
