import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { createJobWithReference } from "@/lib/job-actions";
import { resolveCompanyIdByName } from "@/lib/company-resolve";
import { NewJobForm } from "@/components/new-job-form";

const VALID_STATUSES = ["PROPOSED", "INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"];

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

  const job = await createJobWithReference(session.officeId, (reference) => prisma.job.create({
    data: {
      officeId:    session.officeId,
      companyId,
      reference,
      status:      status as never,
      mode,
      origin:      String(formData.get("origin") || ""),
      destination: String(formData.get("destination") || ""),
      commodity:   String(formData.get("commodity") || ""),
      incoterms:   String(formData.get("incoterms") || ""),
      weight:      formData.get("weight") ? Number(formData.get("weight")) : null,
      volume:      !isFcl && formData.get("volume") ? Number(formData.get("volume")) : null,
      dimensions:  !isFcl && formData.get("dimensions") ? String(formData.get("dimensions")) : null,
      containerCount: isFcl && formData.get("containerCount") ? Number(formData.get("containerCount")) : null,
      containerType:  isFcl ? String(formData.get("containerType") || "") || null : null,
      revenue:     formData.get("revenue") ? Number(formData.get("revenue")) : null,
      cost:        formData.get("cost") ? Number(formData.get("cost")) : null,
      notes:       String(formData.get("notes") || "").trim() || null,
      currency:    "USD",
      etd,
      eta,
      assignedToUserId: session.userId,
    },
  }));

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
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 16 }}>
        <a href="/dashboard/jobs" className="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Jobs
        </a>
      </div>

      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">New Job</h1>
          <p className="page-subtitle">Create a manual job without an RFQ</p>
        </div>
      </div>

      <NewJobForm companies={companies} action={createJob} />
    </div>
  );
}
