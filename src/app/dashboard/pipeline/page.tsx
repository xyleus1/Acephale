import { revalidatePath } from "next/cache";
import { CustomerStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getLang, getT } from "@/lib/i18n";
import { PipelineBoard } from "@/components/pipeline-board";

const STATUS_ORDER: CustomerStatus[] = ["UNTOUCHED", "IN_PROGRESS", "WORKED", "LOST"];
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  UNTOUCHED:   { bg: "#eadfc4", border: "#c8a970", text: "#5b4b34" },
  IN_PROGRESS: { bg: "#ded8bf", border: "#b8ae82", text: "#4f573b" },
  WORKED:      { bg: "#dde0c9", border: "#adb789", text: "#4f623f" },
  LOST:        { bg: "#e5cec3", border: "#bd8d78", text: "#6f3f31" },
};

export default async function PipelinePage() {
  const session = await requireSession();
  const lang = await getLang();
  const t = getT(lang);
  const canViewAll =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    session.canViewWholeOffice;
  const companyScope = canViewAll
    ? { officeId: session.officeId }
    : { officeId: session.officeId, owners: { some: { userId: session.userId } } };

  async function updateStatusAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const companyId = String(formData.get("companyId") ?? "");
    const status = String(formData.get("status") ?? "") as CustomerStatus;
    if (!companyId || !Object.values(CustomerStatus).includes(status)) return;
    await prisma.company.update({
      where: { id: companyId, officeId: s.officeId },
      data: { status },
    });
    revalidatePath("/dashboard/pipeline");
  }

  const companies = await prisma.company.findMany({
    where: { ...companyScope, officeId: session.officeId },
    include: {
      owners: { include: { user: { select: { fullName: true } } } },
      activities: { orderBy: { occurredAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  const grouped = STATUS_ORDER.reduce<Record<string, typeof companies>>((acc, status) => {
    acc[status] = companies.filter((c) => c.status === status);
    return acc;
  }, {} as Record<string, typeof companies>);

  // Serialize dates for client component
  const serializedGrouped = Object.fromEntries(
    STATUS_ORDER.map((status) => [
      status,
      grouped[status].map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        owners: c.owners,
        activities: c.activities.map((a) => ({ occurredAt: a.occurredAt.toISOString() })),
      })),
    ])
  );

  const statusLabels = Object.fromEntries(
    STATUS_ORDER.map((s) => [s, t.statuses[s as keyof typeof t.statuses]])
  );

  return (
    <div className="stack-sections">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.025em", margin: 0 }}>{t.pipeline.pageTitle}</h1>
        <div style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--text-3)" }}>
          {STATUS_ORDER.map((s) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[s].border, display: "inline-block" }} />
              {t.statuses[s as keyof typeof t.statuses]} <strong style={{ color: "var(--text-2)" }}>{grouped[s].length}</strong>
            </span>
          ))}
        </div>
      </div>

      <PipelineBoard
        initialGrouped={serializedGrouped}
        statusOrder={STATUS_ORDER}
        statusColors={STATUS_COLORS}
        statusLabels={statusLabels}
        t={{ lastActivity: t.pipeline.lastActivity, noActivity: t.pipeline.noActivity, noCompanies: t.pipeline.noCompanies }}
        updateStatusAction={updateStatusAction}
      />
    </div>
  );
}
