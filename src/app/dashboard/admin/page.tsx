import { CategoryType, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Badge } from "@/components/ui";
import { reviewedFieldTokenLabel } from "@/lib/agent-proposal-review";
import {
  assessCommercialStrategy,
  buildStrategyExecutionPacket,
  buildStrategyRouteDecision,
  type CommercialStrategy,
  type StrategyEvidenceCheck,
} from "@/lib/commercial-strategy";
import { loadJobStrategyInput } from "@/lib/commercial-strategy-persistence";
import { simulatePricingScenario, type PricingScenarioResult } from "@/lib/pricing-scenario";
import { operatorMetricLabel, operatorPhaseLabel, operatorToolLabel } from "@/lib/operator-action-labels";

type AdminSearchParams = {
  tab?: string;
  brainJobId?: string;
  brainTargetPrice?: string;
  brainBuyCost?: string;
  brainTargetCurrency?: string;
  brainMinMarginPct?: string;
  brainNoTarget?: string;
  brainReplaceQuotes?: string;
};

const CATEGORY_TYPE_LABELS: Record<string, string> = {
  CLASS1: "Class 1",
  CLASS2: "Class 2",
  PRODUCT: "Product",
  LANE: "Lane"
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function auditValue(value: unknown) {
  if (value == null || value === "") return "—";
  if (value instanceof Date) return fmtDateTime(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value).slice(0, 220);
  } catch {
    return String(value).slice(0, 220);
  }
}

function auditInputPreview(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2).slice(0, 900);
  } catch {
    return String(value).slice(0, 900);
  }
}

function fmtDateTime(d: Date) {
  return new Date(d).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseMaybeNumber(value: string | undefined) {
  const clean = String(value ?? "").replace(/,/g, "").trim();
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function money(value: number | null | undefined, currency = "USD") {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${currency} ${Math.round(value).toLocaleString()}`;
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 10) / 10}%`;
}

function signed(value: number | null | undefined, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}${suffix}`;
}

function toneFromEvidence(tone: StrategyEvidenceCheck["tone"] | "rates" | string | null | undefined) {
  if (tone === "ready" || tone === "review" || tone === "blocked" || tone === "rates" || tone === "info") return tone;
  return "info";
}

function guardrailTone(status: CommercialStrategy["price"]["guardrailStatus"]) {
  if (status === "PASS") return "ready";
  if (status === "BLOCKED") return "blocked";
  return "review";
}

function gateTone(status: CommercialStrategy["quoteGate"]["status"]) {
  if (status === "READY_TO_QUOTE") return "ready";
  if (status === "REVIEW_REQUIRED") return "review";
  if (status === "NEEDS_RATES") return "rates";
  return "blocked";
}

function scoreTone(score: number) {
  if (score >= 78) return "ready";
  if (score >= 58) return "review";
  return "blocked";
}

function confidenceTone(confidence: CommercialStrategy["confidence"]) {
  if (confidence === "high") return "ready";
  if (confidence === "medium") return "review";
  return "blocked";
}

function scenarioWasRequested(sp: AdminSearchParams) {
  return Boolean(
    sp.brainTargetPrice?.trim() ||
    sp.brainBuyCost?.trim() ||
    sp.brainMinMarginPct?.trim() ||
    sp.brainNoTarget === "1" ||
    sp.brainReplaceQuotes === "1"
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const session = await requireSession();
  if (session.role !== UserRole.ADMIN && session.role !== UserRole.MANAGER) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const { tab = "team" } = sp;
  const isAdmin = session.role === UserRole.ADMIN;
  const canSeeAgentAudit = session.role === UserRole.ADMIN || session.role === UserRole.MANAGER;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const staleBackgroundJobCutoff = new Date(Date.now() - 30 * 60 * 1000);

  const [users, companyOwners, recentActivities, openTasks, pendingQuotes, categories, agentRunEvents, backgroundJobs, backgroundJobCounts, staleRunningBackgroundJobs, brainJobs, activeBrainAssessments] = await Promise.all([
    prisma.user.findMany({
      where: { officeId: session.officeId, isActive: true },
      orderBy: { fullName: "asc" }
    }),
    prisma.companyOwner.findMany({
      where: { company: { officeId: session.officeId } },
      select: { userId: true, isPrimary: true, companyId: true }
    }),
    prisma.activity.findMany({
      where: { officeId: session.officeId, occurredAt: { gte: sevenDaysAgo } },
      select: { createdByUserId: true, type: true }
    }),
    prisma.task.findMany({
      where: { officeId: session.officeId, status: "OPEN" },
      select: { assignedToUserId: true, dueAt: true }
    }),
    prisma.quote.findMany({
      where: { officeId: session.officeId, result: "PENDING" },
      select: { companyId: true }
    }),
    prisma.categoryOption.findMany({
      where: { officeId: session.officeId },
      orderBy: [{ type: "asc" }, { value: "asc" }]
    }),
    prisma.event.findMany({
      where: { officeId: session.officeId, type: { in: ["agent.run", "agent.proposal_reviewed"] } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.backgroundJob.findMany({
      where: {
        officeId: session.officeId,
        OR: [
          { status: { in: ["QUEUED", "RUNNING", "FAILED"] } },
          { completedAt: { gte: sevenDaysAgo } },
        ],
      },
      orderBy: [{ status: "asc" }, { runAfter: "asc" }, { createdAt: "desc" }],
      take: 80,
    }),
    prisma.backgroundJob.groupBy({
      by: ["status"],
      where: { officeId: session.officeId },
      _count: { _all: true },
    }),
    prisma.backgroundJob.count({
      where: {
        officeId: session.officeId,
        status: "RUNNING",
        lockedAt: { lt: staleBackgroundJobCutoff },
      },
    }),
    prisma.job.findMany({
      where: { officeId: session.officeId, status: { not: "CANCELLED" } },
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        mode: true,
        origin: true,
        destination: true,
        revenue: true,
        cost: true,
        currency: true,
        updatedAt: true,
        company: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
    prisma.strategyAssessment.findMany({
      where: { officeId: session.officeId, status: "ACTIVE" },
      include: {
        job: { select: { id: true, reference: true, title: true, status: true } },
        inquiry: { select: { id: true, subject: true, status: true } },
        priceRecommendation: true,
        riskAssessments: { orderBy: { score: "desc" }, take: 1 },
        actions: { orderBy: { createdAt: "asc" }, take: 2 },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  // ── Unassigned companies ──────────────────────────────────────
  const assignedCompanyIds = new Set(companyOwners.map((o) => o.companyId));
  const unassignedCompanies = await prisma.company.findMany({
    where: { officeId: session.officeId, id: { notIn: Array.from(assignedCompanyIds) } },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
    take: 50,
  });

  // ── Per-user stats ────────────────────────────────────────────
  const pendingCompanyIds = new Set(pendingQuotes.map((q) => q.companyId));
  const now = new Date();

  const salesPeople = users.filter((u) => u.role === "SALES");
  const teamStats = users.map((u) => {
    const owned = companyOwners.filter((o) => o.userId === u.id);
    const primary = owned.filter((o) => o.isPrimary).length;
    const activityCount = recentActivities.filter((a) => a.createdByUserId === u.id).length;
    const myTasks = openTasks.filter((t) => t.assignedToUserId === u.id);
    const overdueTasks = myTasks.filter((t) => t.dueAt && new Date(t.dueAt) < now).length;
    const myCompanyIds = new Set(owned.map((o) => o.companyId));
    const myPendingQuotes = Array.from(pendingCompanyIds).filter((cid) => myCompanyIds.has(cid)).length;
    return {
      ...u,
      accountCount: primary,
      activityCount7d: activityCount,
      openTaskCount: myTasks.length,
      overdueTaskCount: overdueTasks,
      pendingQuoteCount: myPendingQuotes,
    };
  }).filter((u) => u.role !== "ADMIN" || u.id === session.userId);
  const userById = new Map(users.map((user) => [user.id, user]));
  const selectedBrainJobId = brainJobs.some((job) => job.id === sp.brainJobId)
    ? sp.brainJobId
    : brainJobs[0]?.id ?? null;
  const brainInput = selectedBrainJobId ? await loadJobStrategyInput(session.officeId, selectedBrainJobId) : null;
  const brainStrategy = brainInput ? assessCommercialStrategy(brainInput) : null;
  const brainPacket = brainStrategy ? buildStrategyExecutionPacket(brainStrategy) : null;
  const brainRouteDecision = brainStrategy ? buildStrategyRouteDecision(brainStrategy) : null;
  const brainScenarioRequested = scenarioWasRequested(sp);
  const brainScenario = brainInput && brainScenarioRequested
    ? simulatePricingScenario(brainInput, {
      targetPrice: parseMaybeNumber(sp.brainTargetPrice),
      targetCurrency: sp.brainTargetCurrency || brainInput.targetCurrency || brainInput.currency || "USD",
      noTarget: sp.brainNoTarget === "1",
      buyCost: parseMaybeNumber(sp.brainBuyCost),
      assumeLiveBuyCost: parseMaybeNumber(sp.brainBuyCost) != null,
      replaceExistingQuotes: sp.brainReplaceQuotes === "1",
      minMarginPct: parseMaybeNumber(sp.brainMinMarginPct),
    })
    : null;

  // ── Server actions ────────────────────────────────────────────

  async function assignCompanyAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN && s.role !== UserRole.MANAGER) return;
    const companyId = String(formData.get("companyId") ?? "");
    const userId = String(formData.get("userId") ?? "");
    if (!companyId || !userId) return;
    const [company, user] = await Promise.all([
      prisma.company.findFirst({ where: { id: companyId, officeId: s.officeId }, select: { id: true } }),
      prisma.user.findFirst({ where: { id: userId, officeId: s.officeId, isActive: true }, select: { id: true } }),
    ]);
    if (!company || !user) return;
    await prisma.companyOwner.upsert({
      where: { companyId_userId: { companyId, userId } },
      update: { isPrimary: true },
      create: { companyId, userId, isPrimary: true }
    });
    await prisma.assignmentChange.create({
      data: { officeId: s.officeId, companyId, changedByUserId: s.userId, diff: { type: "assign", userId } }
    });
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/customers");
  }

  async function reassignCompaniesAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN && s.role !== UserRole.MANAGER) return;
    const fromUserId = String(formData.get("fromUserId") ?? "");
    const toUserId = String(formData.get("toUserId") ?? "");
    if (!fromUserId || !toUserId || fromUserId === toUserId) return;
    // Find all primary companies owned by fromUser
    const owned = await prisma.companyOwner.findMany({
      where: { userId: fromUserId, isPrimary: true, company: { officeId: s.officeId } },
      select: { companyId: true }
    });
    for (const { companyId } of owned) {
      await prisma.companyOwner.upsert({
        where: { companyId_userId: { companyId, userId: toUserId } },
        update: { isPrimary: true },
        create: { companyId, userId: toUserId, isPrimary: true }
      });
      await prisma.companyOwner.updateMany({
        where: { companyId, userId: fromUserId },
        data: { isPrimary: false }
      });
    }
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/customers");
  }

  async function toggleUserVisibilityAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN) return;
    const userId = String(formData.get("userId") ?? "");
    const nextValue = String(formData.get("canViewWholeOffice") ?? "") === "true";
    await prisma.user.updateMany({
      where: { id: userId, officeId: s.officeId },
      data: { canViewWholeOffice: nextValue },
    });
    revalidatePath("/dashboard/admin");
  }

  async function addCategoryAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN) return;
    const type = String(formData.get("type") ?? "CLASS1") as CategoryType;
    const value = String(formData.get("value") ?? "").trim();
    if (!value) return;
    await prisma.categoryOption.upsert({
      where: { officeId_type_value: { officeId: s.officeId, type, value } },
      update: { isActive: true },
      create: { officeId: s.officeId, type, value, isActive: true }
    });
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/customers");
  }

  async function toggleCategoryAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN) return;
    const id = String(formData.get("id") ?? "");
    const isActive = String(formData.get("isActive") ?? "") === "true";
    await prisma.categoryOption.updateMany({
      where: { id, officeId: s.officeId },
      data: { isActive },
    });
    revalidatePath("/dashboard/admin");
    revalidatePath("/dashboard/customers");
  }

  async function retryBackgroundJobAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN && s.role !== UserRole.MANAGER) return;
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await prisma.backgroundJob.updateMany({
      where: { id, officeId: s.officeId, status: "FAILED" },
      data: {
        status: "QUEUED",
        attempts: 0,
        runAfter: new Date(),
        lockedAt: null,
        startedAt: null,
        failedAt: null,
        lastError: null,
      },
    });
    revalidatePath("/dashboard/admin");
  }

  async function runBackgroundJobNowAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN && s.role !== UserRole.MANAGER) return;
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await prisma.backgroundJob.updateMany({
      where: { id, officeId: s.officeId, status: "QUEUED" },
      data: { runAfter: new Date() },
    });
    revalidatePath("/dashboard/admin");
  }

  async function releaseBackgroundJobLockAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    if (s.role !== UserRole.ADMIN && s.role !== UserRole.MANAGER) return;
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    await prisma.backgroundJob.updateMany({
      where: {
        id,
        officeId: s.officeId,
        status: "RUNNING",
        lockedAt: { lt: cutoff },
      },
      data: {
        status: "QUEUED",
        runAfter: new Date(),
        lockedAt: null,
        lastError: "Released stale RUNNING lock by admin.",
      },
    });
    revalidatePath("/dashboard/admin");
  }

  const categoryGroups = Object.values(CategoryType).reduce<Record<string, typeof categories>>((acc, type) => {
    acc[type] = categories.filter((c) => c.type === type);
    return acc;
  }, {} as Record<string, typeof categories>);

  const salesUsers = users.filter((u) => u.role === "SALES");
  const backgroundCount = (status: string) => backgroundJobCounts.find((row) => row.status === status)?._count._all ?? 0;
  const queuedJobs = backgroundCount("QUEUED");
  const runningJobs = backgroundCount("RUNNING");
  const failedJobs = backgroundCount("FAILED");
  const pageTitle = tab === "brain" ? "Commercial Brain" : tab === "agent" ? "Agent Audit" : tab === "jobs" ? "System Jobs" : "Team";
  const pageSubtitle = tab === "agent"
    ? `${agentRunEvents.length} recent agent events · runs, reviews, tools, and errors`
    : tab === "brain"
      ? brainStrategy
        ? `${brainStrategy.band} band · ${brainStrategy.quoteGate.label} · ${operatorPhaseLabel(brainStrategy.operatorDecision.phase)}`
        : "No job selected for live strategy inspection"
    : tab === "jobs"
      ? `${queuedJobs} queued · ${runningJobs} running · ${staleRunningBackgroundJobs} stale · ${failedJobs} failed`
      : `${salesPeople.length} sales reps · ${companyOwners.filter((o) => o.isPrimary).length} accounts assigned`;

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">{pageTitle}</h1>
          <p className="page-subtitle">{pageSubtitle}</p>
        </div>
        {(isAdmin || canSeeAgentAudit) && (
          <div style={{ display: "flex", gap: 6 }}>
            <Link href="/dashboard/admin?tab=team">
              <button type="button" className={tab === "team" ? "btn-sm" : "secondary btn-sm"}>Team overview</button>
            </Link>
            {canSeeAgentAudit && (
              <Link href="/dashboard/admin?tab=brain">
                <button type="button" className={tab === "brain" ? "btn-sm" : "secondary btn-sm"}>Brain lab</button>
              </Link>
            )}
            {canSeeAgentAudit && (
              <Link href="/dashboard/admin?tab=agent">
                <button type="button" className={tab === "agent" ? "btn-sm" : "secondary btn-sm"}>Agent audit</button>
              </Link>
            )}
            {canSeeAgentAudit && (
              <Link href="/dashboard/admin?tab=jobs">
                <button type="button" className={tab === "jobs" ? "btn-sm" : "secondary btn-sm"}>System jobs</button>
              </Link>
            )}
            {isAdmin && (
              <Link href="/dashboard/admin?tab=settings">
                <button type="button" className={tab === "settings" ? "btn-sm" : "secondary btn-sm"}>Settings</button>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ── TEAM TAB ──────────────────────────────────────────────── */}
      {(tab === "team" || !isAdmin) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Per-rep stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {teamStats.map((u) => {
              const initials = u.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
              const activityLevel = u.activityCount7d >= 10 ? "good" : u.activityCount7d >= 4 ? "warn" : "danger";
              return (
                <div key={u.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--brand-light)", border: "1px solid var(--brand-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "var(--brand)", flexShrink: 0 }}>
                      {initials}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{u.fullName}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "capitalize" }}>{u.role.toLowerCase()}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <StatCell label="Accounts" value={u.accountCount} />
                    <StatCell label="Activities (7d)" value={u.activityCount7d} tone={activityLevel} />
                    <StatCell label="Open tasks" value={u.openTaskCount} tone={u.overdueTaskCount > 0 ? "danger" : "default"} sub={u.overdueTaskCount > 0 ? `${u.overdueTaskCount} overdue` : undefined} />
                    <StatCell label="Pending quotes" value={u.pendingQuoteCount} tone={u.pendingQuoteCount > 3 ? "warn" : "default"} />
                  </div>
                  <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
                    <Link href={`/dashboard/customers?ownerId=${u.id}`} style={{ flex: 1 }}>
                      <button type="button" className="secondary btn-sm" style={{ width: "100%", fontSize: 11 }}>View accounts</button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Activity table — who did what this week */}
          <div className="card">
            <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="section-title">Activity this week</div>
            </div>
            <div className="table-wrap">
              <table style={{ border: "none", borderRadius: 0 }}>
                <thead>
                  <tr>
                    <th>Rep</th>
                    <th>Accounts</th>
                    <th style={{ textAlign: "right" }}>Calls</th>
                    <th style={{ textAlign: "right" }}>Visits</th>
                    <th style={{ textAlign: "right" }}>Emails</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th style={{ textAlign: "right" }}>Open tasks</th>
                    <th style={{ textAlign: "right" }}>Pending quotes</th>
                  </tr>
                </thead>
                <tbody>
                  {teamStats.map((u) => {
                    const myActivities = recentActivities.filter((a) => a.createdByUserId === u.id);
                    const calls = myActivities.filter((a) => a.type === "CALL").length;
                    const visits = myActivities.filter((a) => a.type === "VISIT").length;
                    const emails = myActivities.filter((a) => a.type === "EMAIL").length;
                    return (
                      <tr key={u.id}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{u.fullName}</div>
                          <div style={{ fontSize: 11, color: "var(--text-3)" }}>{u.email}</div>
                        </td>
                        <td style={{ fontSize: 13 }}>{u.accountCount}</td>
                        <td style={{ textAlign: "right", fontSize: 13 }}>{calls}</td>
                        <td style={{ textAlign: "right", fontSize: 13 }}>{visits}</td>
                        <td style={{ textAlign: "right", fontSize: 13 }}>{emails}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, fontSize: 13, color: u.activityCount7d === 0 ? "var(--danger)" : "var(--text)" }}>
                          {u.activityCount7d}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 13, color: u.overdueTaskCount > 0 ? "var(--danger)" : "var(--text-2)", fontWeight: u.overdueTaskCount > 0 ? 700 : 400 }}>
                          {u.openTaskCount}{u.overdueTaskCount > 0 ? ` (${u.overdueTaskCount} late)` : ""}
                        </td>
                        <td style={{ textAlign: "right", fontSize: 13, color: u.pendingQuoteCount > 0 ? "var(--warning)" : "var(--text-2)" }}>
                          {u.pendingQuoteCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Unassigned companies */}
          {unassignedCompanies.length > 0 && (
            <div className="card">
              <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="section-title">Unassigned accounts</div>
                  <Badge tone="warn">{unassignedCompanies.length}</Badge>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>These companies have no owner — assign them to a rep.</p>
              </div>
              <div className="table-wrap">
                <table style={{ border: "none", borderRadius: 0 }}>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Status</th>
                      <th>Assign to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassignedCompanies.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/dashboard/customers/${c.id}`} style={{ fontWeight: 600, color: "var(--brand)", fontSize: 13 }}>{c.name}</Link>
                        </td>
                        <td>
                          <Badge tone={c.status === "WORKED" ? "good" : c.status === "IN_PROGRESS" ? "info" : c.status === "LOST" ? "danger" : "neutral"}>
                            {c.status.replace("_", " ")}
                          </Badge>
                        </td>
                        <td>
                          <form action={assignCompanyAction} style={{ display: "flex", gap: 6 }}>
                            <input type="hidden" name="companyId" value={c.id} />
                            <select name="userId" style={{ fontSize: 12, height: 28, padding: "0 6px" }}>
                              <option value="">Select rep…</option>
                              {salesUsers.map((u) => (
                                <option key={u.id} value={u.id}>{u.fullName}</option>
                              ))}
                            </select>
                            <button type="submit" className="btn-sm" style={{ height: 28, fontSize: 11 }}>Assign</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Reassign bulk */}
          {isAdmin && salesUsers.length >= 2 && (
            <div className="card">
              <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="section-title">Reassign accounts</div>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Move all primary accounts from one rep to another — e.g. when someone leaves.</p>
              </div>
              <div className="card-body">
                <ReassignForm users={salesUsers} action={reassignCompaniesAction} companyOwners={companyOwners} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── COMMERCIAL BRAIN TAB ─────────────────────────────────── */}
      {tab === "brain" && canSeeAgentAudit && (
        <div className="admin-brain" data-agent-target="admin-brain">
          <section className="admin-brain-hero">
            <div>
              <span>Live decision model</span>
              <strong>{brainStrategy ? brainStrategy.recommendationLabel : "No strategy loaded"}</strong>
              <em>
                {brainStrategy
                  ? brainStrategy.strategyMemo
                  : "Pick a job with enough commercial facts to inspect the pricing/risk/route brain."}
              </em>
            </div>
            {brainStrategy && (
              <div className={`admin-brain-score ${scoreTone(brainStrategy.score)}`}>
                <span>{brainStrategy.band}</span>
                <strong>{brainStrategy.score}</strong>
                <em>{brainStrategy.confidence} confidence</em>
              </div>
            )}
          </section>

          <form action="/dashboard/admin" method="get" className="admin-brain-selector">
            <input type="hidden" name="tab" value="brain" />
            <label>
              <span>Inspect job</span>
              <select name="brainJobId" defaultValue={selectedBrainJobId ?? ""}>
                {brainJobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.reference} · {job.title ?? job.company?.name ?? "Untitled"} · {job.status}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-sm">Load brain</button>
            {selectedBrainJobId && (
              <Link href={`/dashboard/jobs/${selectedBrainJobId}`} className="admin-brain-open-link">
                Open job
              </Link>
            )}
          </form>

          {brainStrategy && brainPacket && brainRouteDecision ? (
            <>
              <section className="admin-brain-strip" aria-label="Commercial brain gates">
                <div className={gateTone(brainStrategy.quoteGate.status)}>
                  <span>Quote gate</span>
                  <strong>{brainStrategy.quoteGate.label}</strong>
                  <em>{brainStrategy.quoteGate.decision}</em>
                </div>
                <div className={guardrailTone(brainStrategy.price.guardrailStatus)}>
                  <span>Economics</span>
                  <strong>{brainStrategy.price.guardrailStatus.toLowerCase().replace("_", " ")}</strong>
                  <em>{money(brainStrategy.price.recommendedPrice, brainStrategy.price.currency)} recommended</em>
                </div>
                <div className={toneFromEvidence(brainPacket.evidence.weakest?.tone ?? "ready")}>
                  <span>Weakest proof</span>
                  <strong>{brainPacket.evidence.weakest?.label ?? "No hard gap"}</strong>
                  <em>{brainPacket.evidence.weakest?.detail ?? "The model has enough proof for the current gate."}</em>
                </div>
                <div className={confidenceTone(brainStrategy.confidence)}>
                  <span>Agent move</span>
                  <strong>{operatorToolLabel(brainStrategy.operatorDecision.toolHint)}</strong>
                  <em>{brainPacket.safety.stopCondition}</em>
                </div>
              </section>

              <section className="admin-brain-grid">
                <div className="admin-brain-card admin-brain-wide" data-agent-target="decision-quality">
                  <div className="admin-brain-card-head">
                    <span>Score anatomy</span>
                    <strong>{brainStrategy.label}</strong>
                  </div>
                  <div className="admin-brain-meter-list">
                    {Object.entries(brainStrategy.components).map(([key, value]) => (
                      <div key={key} className="admin-brain-meter">
                        <span>{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                        <strong>{value}/100</strong>
                        <div>
                          <i style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="admin-brain-card" data-agent-target="decision-contract">
                  <div className="admin-brain-card-head">
                    <span>Decision contract</span>
                    <strong>{brainPacket.contract.title}</strong>
                  </div>
                  <p>{brainPacket.contract.summary}</p>
                  <div className="admin-brain-mini-ledger">
                    {brainPacket.contract.proven.slice(0, 2).map((item) => (
                      <span key={`proven-${item.key}`} className={toneFromEvidence(item.tone)}>
                        <strong>{item.label}</strong>
                        <em>{item.value}</em>
                      </span>
                    ))}
                    {brainPacket.contract.assumptions.slice(0, 2).map((item) => (
                      <span key={`assumption-${item.key}`} className={toneFromEvidence(item.tone)}>
                        <strong>{item.label}</strong>
                        <em>{item.detail}</em>
                      </span>
                    ))}
                  </div>
                  <div className="admin-brain-forbidden">
                    {brainPacket.contract.forbidden.slice(0, 3).map((rule) => <span key={rule}>{rule}</span>)}
                  </div>
                </div>

                <div className="admin-brain-card" data-agent-target="financials">
                  <div className="admin-brain-card-head">
                    <span>Price guardrails</span>
                    <strong>{brainStrategy.price.currency}</strong>
                  </div>
                  <div className="admin-brain-price-grid">
                    <span>Buy cost <strong>{money(brainStrategy.price.buyCost, brainStrategy.price.currency)}</strong></span>
                    <span>Floor <strong>{money(brainStrategy.price.floorPrice, brainStrategy.price.currency)}</strong></span>
                    <span>Recommended <strong>{money(brainStrategy.price.recommendedPrice, brainStrategy.price.currency)}</strong></span>
                    <span>Stretch <strong>{money(brainStrategy.price.stretchPrice, brainStrategy.price.currency)}</strong></span>
                    <span>Walk-away <strong>{money(brainStrategy.price.walkAwayPrice, brainStrategy.price.currency)}</strong></span>
                    <span>Expected GP <strong>{money(brainStrategy.price.expectedGrossProfit, brainStrategy.price.currency)}</strong></span>
                  </div>
                  <p>Win probability {brainStrategy.price.winProbability}% · expected margin {pct(brainStrategy.price.expectedMarginPct)}</p>
                </div>
              </section>

              <section className="admin-brain-grid">
                <div className="admin-brain-card admin-brain-wide" data-agent-target="strategy-evidence">
                  <div className="admin-brain-card-head">
                    <span>Evidence matrix</span>
                    <strong>{brainPacket.evidence.checks.length} checks</strong>
                  </div>
                  <div className="admin-brain-evidence-grid">
                    {brainPacket.evidence.checks.map((check) => (
                      <div key={check.key} className={`admin-brain-evidence ${toneFromEvidence(check.tone)}`} data-agent-target={check.key === "decision_quality" ? "decision-quality" : undefined}>
                        <span>{check.label}</span>
                        <strong>{operatorMetricLabel(check.metric, check.tone)}</strong>
                        <em>{check.detail}</em>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="admin-brain-card" data-agent-target="blocker-resolution">
                  <div className="admin-brain-card-head">
                    <span>Proof gaps</span>
                    <strong>{brainPacket.evidence.gaps.length || "Clear"}</strong>
                  </div>
                  <div className="admin-brain-proof-list">
                    {(brainPacket.evidence.gaps.length ? brainPacket.evidence.gaps : [{
                      key: "clear",
                      label: "No blocking gap",
                      tone: "ready" as const,
                      metric: "ready",
                      detail: "No proof gap blocks the current decision gate.",
                      action: "Proceed only within the decision contract.",
                      owner: "INTERNAL" as const,
                      target: "strategy-evidence" as const,
                    }]).slice(0, 8).map((gap) => (
                      <div key={`${gap.key}-${gap.target}`} className={`admin-brain-proof ${toneFromEvidence(gap.tone)}`} data-agent-target={gap.target}>
                        <span>{gap.owner} · {gap.label}</span>
                        <strong>{gap.action}</strong>
                        <em>{operatorMetricLabel(gap.metric, gap.tone)} · {gap.detail}</em>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="admin-brain-grid">
                <div className="admin-brain-card admin-brain-wide" data-agent-target="movement">
                  <div className="admin-brain-card-head">
                    <span>Route decision</span>
                    <strong>{brainRouteDecision.summary}</strong>
                  </div>
                  <div className="admin-brain-route-table">
                    <div className="admin-brain-route-head">
                      <span>Rank</span><span>Route</span><span>Cost</span><span>Proof</span><span>Tradeoff</span>
                    </div>
                    {[brainRouteDecision.selected, ...brainRouteDecision.alternatives].filter(Boolean).slice(0, 5).map((row) => row && (
                      <div key={`${row.rank}-${row.label}-${row.source}`} className="admin-brain-route-row">
                        <span>#{row.rank}</span>
                        <strong>{row.label}</strong>
                        <em>{row.costLabel}</em>
                        <em>{row.source.toLowerCase().replace("_", " ")} · {row.confidence}</em>
                        <small>{row.tradeoff}</small>
                      </div>
                    ))}
                  </div>
                  <p>{brainRouteDecision.selectionRule}</p>
                </div>

                <div className="admin-brain-card" data-agent-target="agent-action">
                  <div className="admin-brain-card-head">
                    <span>Command ledger</span>
                    <strong>{brainPacket.primary.command}</strong>
                  </div>
                  <div className="admin-brain-command-list">
                    {brainPacket.commandLedger.map((item) => (
                      <div key={item.key} className={`admin-brain-command ${toneFromEvidence(item.tone)}`}>
                        <span>{item.owner} · {item.label}</span>
                        <strong>{item.command}</strong>
                        <em>{item.stopRule}</em>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="admin-brain-grid">
                <div className="admin-brain-card" data-agent-target="decision-reasons">
                  <div className="admin-brain-card-head">
                    <span>Decision reasons</span>
                    <strong>{brainStrategy.decisionReasons.length}</strong>
                  </div>
                  <div className="admin-brain-proof-list">
                    {brainStrategy.decisionReasons.map((reason) => (
                      <div key={reason.key} className={`admin-brain-proof ${reason.tone === "blocker" ? "blocked" : reason.tone === "support" ? "ready" : reason.tone}`}>
                        <span>{reason.label}</span>
                        <strong>{reason.summary}</strong>
                        <em>{reason.detail}</em>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="admin-brain-card" data-agent-target="risk">
                  <div className="admin-brain-card-head">
                    <span>Risk register</span>
                    <strong>{brainStrategy.riskAssessments[0]?.level ?? "LOW"}</strong>
                  </div>
                  <div className="admin-brain-proof-list">
                    {brainStrategy.riskAssessments.slice(0, 5).map((risk) => (
                      <div key={`${risk.category}-${risk.reason}`} className={`admin-brain-proof ${risk.level === "CRITICAL" || risk.level === "HIGH" ? "blocked" : risk.level === "MEDIUM" ? "review" : "ready"}`}>
                        <span>{risk.category} · {risk.level} · {risk.score}/100</span>
                        <strong>{risk.reason}</strong>
                        <em>{risk.mitigation}</em>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="admin-brain-card">
                  <div className="admin-brain-card-head">
                    <span>Proposed actions</span>
                    <strong>{brainStrategy.actions.length}</strong>
                  </div>
                  <div className="admin-brain-proof-list">
                    {brainStrategy.actions.map((action) => (
                      <div key={`${action.actionType}-${action.title}`} className={`admin-brain-proof ${action.priority === "critical" ? "blocked" : action.priority === "high" ? "review" : "info"}`}>
                        <span>{action.priority} · {action.actionType.toLowerCase().replace("_", " ")}</span>
                        <strong>{action.title}</strong>
                        <em>{action.rationale}</em>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="admin-brain-grid">
                <form action="/dashboard/admin" method="get" className="admin-brain-card admin-brain-scenario" data-agent-target="pricing-scenario">
                  <input type="hidden" name="tab" value="brain" />
                  <input type="hidden" name="brainJobId" value={selectedBrainJobId ?? ""} />
                  <div className="admin-brain-card-head">
                    <span>What-if sandbox</span>
                    <strong>No writes, no fake history</strong>
                  </div>
                  <div className="admin-brain-scenario-fields">
                    <label>
                      <span>Customer target</span>
                      <input name="brainTargetPrice" defaultValue={sp.brainTargetPrice ?? ""} inputMode="decimal" placeholder="2300" />
                    </label>
                    <label>
                      <span>Buy cost</span>
                      <input name="brainBuyCost" defaultValue={sp.brainBuyCost ?? ""} inputMode="decimal" placeholder="2000" />
                    </label>
                    <label>
                      <span>Currency</span>
                      <select name="brainTargetCurrency" defaultValue={sp.brainTargetCurrency || brainStrategy.price.currency}>
                        {["USD", "EUR", "GBP", "TRY"].map((cur) => <option key={cur} value={cur}>{cur}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Min margin %</span>
                      <input name="brainMinMarginPct" defaultValue={sp.brainMinMarginPct ?? ""} inputMode="decimal" placeholder="floor" />
                    </label>
                  </div>
                  <div className="admin-brain-scenario-toggles">
                    <label><input type="checkbox" name="brainNoTarget" value="1" defaultChecked={sp.brainNoTarget === "1"} /> No target confirmed</label>
                    <label><input type="checkbox" name="brainReplaceQuotes" value="1" defaultChecked={sp.brainReplaceQuotes === "1"} /> Ignore existing quotes</label>
                  </div>
                  <button type="submit" className="btn-sm">Run scenario</button>
                  <p>This uses the same commercial strategy engine as the job page. It does not write target history, quotes, costs, or assessments.</p>
                </form>

                <div className="admin-brain-card admin-brain-scenario-result">
                  <div className="admin-brain-card-head">
                    <span>Scenario result</span>
                    <strong>{brainScenario ? brainScenario.verdict.quote_gate : "Waiting for inputs"}</strong>
                  </div>
                  {brainScenario ? (
                    <BrainScenarioResult result={brainScenario} />
                  ) : (
                    <p>Enter a target, buy cost, or floor margin to see how the brain changes the gate, price, margin, route confidence, and operator action.</p>
                  )}
                </div>
              </section>

              <section className="admin-brain-card admin-brain-wide">
                <div className="admin-brain-card-head">
                  <span>Active brain snapshots</span>
                  <strong>{activeBrainAssessments.length}</strong>
                </div>
                <div className="admin-brain-snapshot-list">
                  {activeBrainAssessments.map((assessment) => {
                    const targetHref = assessment.jobId
                      ? `/dashboard/jobs/${assessment.jobId}`
                      : assessment.inquiryId ? `/dashboard/rfq/${assessment.inquiryId}` : "/dashboard/admin?tab=brain";
                    const risk = assessment.riskAssessments[0];
                    return (
                      <a key={assessment.id} href={targetHref} className={`admin-brain-snapshot ${scoreTone(assessment.score)}`}>
                        <span>{assessment.entityType} · {assessment.job?.reference ?? assessment.inquiry?.subject ?? assessment.subject ?? "Untitled"}</span>
                        <strong>{assessment.recommendationLabel}</strong>
                        <em>
                          {assessment.band} · {assessment.confidence} · {assessment.priceRecommendation?.guardrailStatus ?? "no price"} · {risk ? `${risk.level} ${risk.category}` : "risk clear"}
                        </em>
                      </a>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <div className="card">
              <div className="card-body" style={{ color: "var(--text-3)", fontSize: 13 }}>
                No job is available for the brain lab yet. Create or import a lead/RFQ/job first.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AGENT AUDIT TAB ───────────────────────────────────────── */}
      {tab === "agent" && canSeeAgentAudit && (
        <div className="card agent-audit-card">
          <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="section-title">Recent agent events</div>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
              This is the audit surface for prompts, tool calls, proposal review decisions, final answers, and failures. If the agent did something stupid, this is where you start looking.
            </p>
          </div>
          {agentRunEvents.length === 0 ? (
            <div className="card-body" style={{ color: "var(--text-3)", fontSize: 13 }}>
              No agent events logged yet.
            </div>
          ) : (
            <div className="agent-audit-list">
              {agentRunEvents.map((event) => {
                const payload = asRecord(event.payload);
                const status = typeof payload.status === "string" ? payload.status : "UNKNOWN";
                const decision = typeof payload.decision === "string" ? payload.decision : status;
                const statusClass = decision.toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
                const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
                const reply = typeof payload.reply === "string" ? payload.reply : "";
                const error = typeof payload.error === "string" ? payload.error : "";
                const tools = asRecordList(payload.tools);
                const scopeJobId = typeof payload.scopeJobId === "string" ? payload.scopeJobId : null;
                const proposalId = typeof payload.proposalId === "string" ? payload.proposalId : null;
                const actorUserId = typeof payload.userId === "string" ? payload.userId : null;
                const actor = actorUserId ? userById.get(actorUserId) : null;
                const note = typeof payload.note === "string" ? payload.note : "";
                const sourceType = typeof payload.sourceType === "string" ? payload.sourceType : "";
                const sourcePreview = typeof payload.sourcePreview === "string" ? payload.sourcePreview : "";
                const acceptedFields = asStringList(payload.acceptedFields);
                const changedJobFields = asStringList(payload.changedJobFields);
                const changedInquiryFields = asStringList(payload.changedInquiryFields);
                const reviewedFieldChanges = asRecordList(payload.reviewedFieldChanges);
                const decisionImpact = asRecord(payload.decisionImpact);
                const pageCueCount = tools.reduce((count, tool) => count + asRecordList(tool.pageCues).length, 0);
                const isReview = event.type === "agent.proposal_reviewed";
                return (
                  <details key={event.id} className="agent-audit-item">
                    <summary>
                      <span className={`agent-audit-status ${statusClass}`}>{decision}</span>
                      <strong>
                        {isReview
                          ? `Proposal review${proposalId ? ` ${proposalId.slice(0, 8)}` : ""}`
                          : prompt ? prompt.slice(0, 110) : "Agent run"}
                      </strong>
                      <em>{fmtDateTime(event.createdAt)}</em>
                    </summary>
                    <div className="agent-audit-body">
                      <div className="agent-audit-tools">
                        {scopeJobId && (
                          <Link href={`/dashboard/jobs/${scopeJobId}`}>Scoped job</Link>
                        )}
                        {isReview && event.entityType === "job" && event.entityId && (
                          <Link href={`/dashboard/jobs/${event.entityId}`}>Reviewed job</Link>
                        )}
                        {actor && <span>By {actor.fullName}</span>}
                        {isReview && sourceType && <span>{sourceType}</span>}
                        {isReview && acceptedFields.length > 0 && <span>Accepted {acceptedFields.length} field{acceptedFields.length === 1 ? "" : "s"}</span>}
                        {isReview && changedJobFields.length > 0 && <span>{changedJobFields.length} job field{changedJobFields.length === 1 ? "" : "s"}</span>}
                        {isReview && changedInquiryFields.length > 0 && <span>{changedInquiryFields.length} RFQ field{changedInquiryFields.length === 1 ? "" : "s"}</span>}
                        {!isReview && pageCueCount > 0 && <span>{pageCueCount} page cue{pageCueCount === 1 ? "" : "s"}</span>}
                        {!isReview && tools.length === 0 ? (
                          <span>No tools</span>
                        ) : !isReview && tools.map((tool, index) => (
                          <span key={`${event.id}-${index}`}>
                            {typeof tool.name === "string" ? tool.name : "tool"}
                            {tool.ok === false ? " failed" : ""}
                          </span>
                        ))}
                      </div>
                      {prompt && (
                        <details className="agent-proposal-source">
                          <summary>Prompt</summary>
                          <pre>{prompt.slice(0, 1600)}</pre>
                        </details>
                      )}
                      {sourcePreview && (
                        <details className="agent-proposal-source">
                          <summary>Source preview</summary>
                          <pre>{sourcePreview.slice(0, 1200)}</pre>
                        </details>
                      )}
                      {reviewedFieldChanges.length > 0 && (
                        <div className="agent-review-field-ledger" aria-label="Reviewed agent field changes">
                          <div className="agent-review-field-ledger-head">
                            <span>Scope</span>
                            <span>Field</span>
                            <span>Before</span>
                            <span>After</span>
                          </div>
                          {reviewedFieldChanges.slice(0, 10).map((row, index) => {
                            const scope = typeof row.scope === "string" ? row.scope : "job";
                            const field = typeof row.field === "string" ? row.field : "field";
                            const label = typeof row.label === "string" ? row.label : reviewedFieldTokenLabel(`${scope}:${field}`);
                            return (
                              <div key={`${event.id}-${scope}-${field}-${index}`} className="agent-review-field-row">
                                <span>{scope === "rfq" ? "RFQ" : "Job"}</span>
                                <strong>{label}</strong>
                                <em>{auditValue(row.before)}</em>
                                <em>{auditValue(row.after)}</em>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {!isReview && tools.length > 0 && (
                        <div className="agent-audit-tool-ledger" aria-label="Agent tool calls">
                          {tools.slice(0, 8).map((tool, index) => {
                            const name = typeof tool.name === "string" ? tool.name : "tool";
                            const ok = tool.ok !== false;
                            const toolError = typeof tool.error === "string" ? tool.error : "";
                            const pageCues = asRecordList(tool.pageCues);
                            return (
                              <details key={`${event.id}-tool-${index}`} className={`agent-audit-tool-row ${ok ? "ok" : "failed"}`}>
                                <summary>
                                  <strong>{name}</strong>
                                  <span>{ok ? "ok" : "failed"}</span>
                                  {pageCues.length > 0 && <em>{pageCues.length} page cue{pageCues.length === 1 ? "" : "s"}</em>}
                                </summary>
                                <pre>{auditInputPreview(tool.input)}</pre>
                                {toolError && <p className="agent-audit-error">{toolError.slice(0, 700)}</p>}
                              </details>
                            );
                          })}
                        </div>
                      )}
                      {Object.keys(decisionImpact).length > 0 && (
                        <details className="agent-proposal-source">
                          <summary>Decision impact</summary>
                          <pre>{auditInputPreview(decisionImpact)}</pre>
                        </details>
                      )}
                      {note && <p>{note}</p>}
                      {reply && <p>{reply.slice(0, 1200)}</p>}
                      {error && <p className="agent-audit-error">{error.slice(0, 700)}</p>}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SYSTEM JOBS TAB ──────────────────────────────────────── */}
      {tab === "jobs" && canSeeAgentAudit && (
        <div className="card agent-audit-card">
          <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="section-title">Background job queue</div>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
              Durable queue for AI/document/email work. Failed jobs here are not harmless; they mean production work stopped somewhere.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <Badge tone={failedJobs > 0 ? "danger" : "neutral"}>{failedJobs} failed</Badge>
              <Badge tone={staleRunningBackgroundJobs > 0 ? "danger" : "neutral"}>{staleRunningBackgroundJobs} stale</Badge>
              <Badge tone={runningJobs > 0 ? "info" : "neutral"}>{runningJobs} running</Badge>
              <Badge tone={queuedJobs > 20 ? "warn" : "neutral"}>{queuedJobs} queued</Badge>
            </div>
          </div>
          {backgroundJobs.length === 0 ? (
            <div className="card-body" style={{ color: "var(--text-3)", fontSize: 13 }}>
              No recent background jobs.
            </div>
          ) : (
            <div className="agent-audit-list">
              {backgroundJobs.map((job) => {
                const payload = asRecord(job.payload);
                const staleRunning = job.status === "RUNNING"
                  && job.lockedAt != null
                  && job.lockedAt < staleBackgroundJobCutoff;
                const target =
                  typeof payload.jobId === "string" ? `Job ${payload.jobId.slice(0, 8)}`
                  : typeof payload.documentId === "string" ? `Document ${payload.documentId.slice(0, 8)}`
                  : typeof payload.inquiryId === "string" ? `RFQ ${payload.inquiryId.slice(0, 8)}`
                  : job.dedupeKey ?? job.id.slice(0, 8);
                return (
                  <details key={job.id} className="agent-audit-item">
                    <summary>
                      <span className={`agent-audit-status ${staleRunning ? "failed" : job.status.toLowerCase()}`}>
                        {staleRunning ? "STALE" : job.status}
                      </span>
                      <strong>{job.type} · {target}</strong>
                      <em>{fmtDateTime(job.createdAt)}</em>
                    </summary>
                    <div className="agent-audit-body">
                      <div className="agent-audit-tools">
                        <span>Attempts {job.attempts}/{job.maxAttempts}</span>
                        <span>Run after {fmtDateTime(job.runAfter)}</span>
                        {job.lockedAt && <span>Locked {fmtDateTime(job.lockedAt)}</span>}
                        {job.dedupeKey && <span>{job.dedupeKey.slice(0, 80)}</span>}
                      </div>
                      {job.lastError && <p className="agent-audit-error">{job.lastError.slice(0, 900)}</p>}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {job.status === "FAILED" && (
                          <form action={retryBackgroundJobAction}>
                            <input type="hidden" name="id" value={job.id} />
                            <button type="submit" className="btn-sm">Retry</button>
                          </form>
                        )}
                        {job.status === "QUEUED" && job.runAfter > new Date() && (
                          <form action={runBackgroundJobNowAction}>
                            <input type="hidden" name="id" value={job.id} />
                            <button type="submit" className="secondary btn-sm">Run now</button>
                          </form>
                        )}
                        {staleRunning && (
                          <form action={releaseBackgroundJobLockAction}>
                            <input type="hidden" name="id" value={job.id} />
                            <button type="submit" className="secondary btn-sm">Release lock</button>
                          </form>
                        )}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS TAB ──────────────────────────────────────────── */}
      {tab === "settings" && isAdmin && (
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 20, alignItems: "flex-start" }}>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card">
              <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="section-title" style={{ marginBottom: 4 }}>User permissions</div>
                <p style={{ fontSize: 13, color: "var(--text-3)" }}>Toggle between own-accounts-only and whole-office access per user.</p>
              </div>
              <div className="table-wrap">
                <table style={{ border: "none", borderRadius: 0 }}>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Access</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{user.fullName}</div>
                          <div style={{ fontSize: 12, color: "var(--text-3)" }}>{user.email}</div>
                        </td>
                        <td><Badge tone="info">{user.role}</Badge></td>
                        <td>
                          {user.canViewWholeOffice
                            ? <Badge tone="good">Whole office</Badge>
                            : <Badge tone="neutral">Own accounts</Badge>}
                        </td>
                        <td>
                          <form action={toggleUserVisibilityAction}>
                            <input type="hidden" name="userId" value={user.id} />
                            <input type="hidden" name="canViewWholeOffice" value={user.canViewWholeOffice ? "false" : "true"} />
                            <button type="submit" className="secondary btn-sm">
                              {user.canViewWholeOffice ? "Restrict" : "Expand"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card">
              <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="section-title" style={{ marginBottom: 4 }}>Add category option</div>
              </div>
              <div className="card-body">
                <form action={addCategoryAction} style={{ display: "flex", gap: 8 }}>
                  <select name="type" defaultValue="CLASS1" style={{ width: "auto" }}>
                    {Object.values(CategoryType).map((type) => (
                      <option key={type} value={type}>{CATEGORY_TYPE_LABELS[type] ?? type}</option>
                    ))}
                  </select>
                  <input name="value" placeholder="New value..." required style={{ flex: 1 }} />
                  <button type="submit">Add</button>
                </form>
              </div>
            </div>

            {Object.values(CategoryType).map((type) => (
              <div className="card" key={type}>
                <div className="card-body" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="section-title">{CATEGORY_TYPE_LABELS[type] ?? type}</div>
                    <Badge tone="neutral">{categoryGroups[type]?.length ?? 0}</Badge>
                  </div>
                </div>
                <div className="table-wrap">
                  <table style={{ border: "none", borderRadius: 0 }}>
                    <thead><tr><th>Value</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {(categoryGroups[type]?.length ?? 0) === 0 ? (
                        <tr><td colSpan={3} style={{ color: "var(--text-3)", fontSize: 13, padding: "16px 14px" }}>No options defined yet.</td></tr>
                      ) : categoryGroups[type].map((item) => (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 500 }}>{item.value}</td>
                          <td>{item.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Off</Badge>}</td>
                          <td>
                            <form action={toggleCategoryAction}>
                              <input type="hidden" name="id" value={item.id} />
                              <input type="hidden" name="isActive" value={item.isActive ? "false" : "true"} />
                              <button type="submit" className="secondary btn-sm" style={{ fontSize: 11 }}>
                                {item.isActive ? "Disable" : "Enable"}
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, tone, sub }: { label: string; value: number; tone?: string; sub?: string }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warning)" : tone === "good" ? "var(--success)" : "var(--text)";
  return (
    <div style={{ background: "var(--surface-2)", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ReassignForm({ users, action, companyOwners }: {
  users: { id: string; fullName: string }[];
  action: (fd: FormData) => Promise<void>;
  companyOwners: { userId: string; isPrimary: boolean; companyId: string }[];
}) {
  const counts = users.map((u) => ({
    ...u,
    count: companyOwners.filter((o) => o.userId === u.id && o.isPrimary).length,
  }));

  return (
    <form action={action} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--text-2)" }}>From</span>
        <select name="fromUserId" style={{ width: "auto" }}>
          <option value="">Select rep…</option>
          {counts.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName} ({u.count} accounts)</option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--text-2)" }}>To</span>
        <select name="toUserId" style={{ width: "auto" }}>
          <option value="">Select rep…</option>
          {counts.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName}</option>
          ))}
        </select>
      </div>
      <button type="submit">Reassign all accounts</button>
    </form>
  );
}

function BrainScenarioResult({ result }: { result: PricingScenarioResult }) {
  const scenarioTone = result.verdict.can_quote_customer ? "ready" : result.verdict.approval_required ? "review" : "blocked";
  return (
    <div className={`admin-brain-scenario-output ${scenarioTone}`}>
      <div className="admin-brain-scenario-verdict">
        <div>
          <span>Gate</span>
          <strong>{result.verdict.quote_gate}</strong>
          <em>{result.verdict.operator_action}</em>
        </div>
        <div>
          <span>Guardrail</span>
          <strong>{result.verdict.guardrail.toLowerCase().replace("_", " ")}</strong>
          <em>{result.verdict.target_posture}</em>
        </div>
      </div>
      <div className="admin-brain-price-grid">
        <span>Buy cost <strong>{result.economics.buy_cost ?? "—"}</strong></span>
        <span>Floor <strong>{result.economics.floor_price ?? "—"}</strong></span>
        <span>Recommended <strong>{result.economics.recommended_price ?? "—"}</strong></span>
        <span>Stretch <strong>{result.economics.stretch_price ?? "—"}</strong></span>
        <span>Target margin <strong>{pct(result.economics.margin_at_target_pct)}</strong></span>
        <span>Target buy limit <strong>{result.economics.target_buy_limit_label ?? "—"}</strong></span>
      </div>
      <div className="admin-brain-scenario-change">
        <span>{result.changed_decision.from.quote_gate}</span>
        <strong>→</strong>
        <span>{result.changed_decision.to.quote_gate}</span>
      </div>
      <div className="admin-brain-scenario-deltas">
        <span>Recommended {signed(result.deltas.recommended_price)}</span>
        <span>Floor {signed(result.deltas.floor_price)}</span>
        <span>Win {signed(result.deltas.win_probability, "%")}</span>
        <span>Margin {signed(result.deltas.expected_margin_pct, "%")}</span>
      </div>
      <p>{result.safety}</p>
    </div>
  );
}
