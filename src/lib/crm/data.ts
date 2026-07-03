import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { crmCompanyScope, type CrmUserScope } from "@/lib/crm/scope";

const ACTIVE_RFQ_STATUSES = ["INGESTED", "PARSED", "PRICED", "QUOTED"];
const OPEN_OPPORTUNITY_STAGES = ["idea", "researching", "qualified", "contacted", "meeting_scheduled", "active"];

export type CrmFilters = {
  q?: string | null;
  category?: string | null;
  stage?: string | null;
  priority?: string | null;
  type?: string | null;
  source?: string | null;
};

function nonEmpty(value: string | null | undefined) {
  const clean = value?.trim();
  return clean ? clean : null;
}

function companyTextSearch(q: string): Prisma.CompanyWhereInput[] {
  return [
    { name: { contains: q, mode: "insensitive" } },
    { domain: { contains: q, mode: "insensitive" } },
    { crmNotes: { contains: q, mode: "insensitive" } },
    { product: { contains: q, mode: "insensitive" } },
    { lane: { contains: q, mode: "insensitive" } },
  ];
}

function opportunityTextSearch(q: string): Prisma.CrmOpportunityWhereInput[] {
  return [
    { name: { contains: q, mode: "insensitive" } },
    { notes: { contains: q, mode: "insensitive" } },
    { company: { name: { contains: q, mode: "insensitive" } } },
    { contact: { fullName: { contains: q, mode: "insensitive" } } },
    { inquiry: { subject: { contains: q, mode: "insensitive" } } },
  ];
}

function contactTextSearch(q: string): Prisma.ContactWhereInput[] {
  return [
    { fullName: { contains: q, mode: "insensitive" } },
    { email: { contains: q, mode: "insensitive" } },
    { title: { contains: q, mode: "insensitive" } },
    { notes: { contains: q, mode: "insensitive" } },
    { company: { name: { contains: q, mode: "insensitive" } } },
  ];
}

export async function getCrmCommandCenter(scope: CrmUserScope) {
  const companyScope = crmCompanyScope(scope);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const staleCutoff = new Date(Date.now() - 21 * 86_400_000);

  const [
    companyCount,
    contactCount,
    opportunityCount,
    openTaskCount,
    todayTasks,
    highPriorityCompanies,
    highLeverageContacts,
    activeRfqs,
    opportunities,
    staleCompanies,
    recentActivities,
  ] = await Promise.all([
    prisma.company.count({ where: companyScope }),
    prisma.contact.count({ where: { company: companyScope } }),
    prisma.crmOpportunity.count({
      where: { officeId: scope.officeId, company: scope.canViewAll ? undefined : { owners: { some: { userId: scope.userId } } } },
    }),
    prisma.task.count({
      where: {
        officeId: scope.officeId,
        status: "OPEN",
        company: scope.canViewAll ? undefined : { owners: { some: { userId: scope.userId } } },
      },
    }),
    prisma.task.findMany({
      where: {
        officeId: scope.officeId,
        status: "OPEN",
        OR: [{ dueAt: null }, { dueAt: { lte: todayEnd } }],
        company: scope.canViewAll ? undefined : { owners: { some: { userId: scope.userId } } },
      },
      include: {
        company: { select: { id: true, name: true, crmPriority: true } },
        contact: { select: { id: true, fullName: true, email: true } },
        opportunity: { select: { id: true, name: true, stage: true, priority: true } },
        inquiry: { select: { id: true, subject: true, status: true } },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 12,
    }),
    prisma.company.findMany({
      where: {
        officeId: scope.officeId,
        ...companyScope,
        crmPriority: { in: ["critical", "high"] },
      },
      include: {
        contacts: { orderBy: { updatedAt: "desc" }, take: 2 },
        owners: { include: { user: { select: { fullName: true } } } },
        tasks: { where: { status: "OPEN" }, orderBy: [{ dueAt: "asc" }], take: 2 },
        inquiries: { where: { status: { in: ACTIVE_RFQ_STATUSES } }, orderBy: { receivedAt: "desc" }, take: 2 },
      },
      orderBy: [{ crmPriority: "asc" }, { nextActionAt: "asc" }, { updatedAt: "desc" }],
      take: 8,
    }),
    prisma.contact.findMany({
      where: {
        company: companyScope,
        leverageLevel: { in: ["very_high", "high"] },
      },
      include: { company: { select: { id: true, name: true, crmPriority: true } } },
      orderBy: [{ nextActionAt: "asc" }, { updatedAt: "desc" }],
      take: 8,
    }),
    prisma.inquiry.findMany({
      where: {
        officeId: scope.officeId,
        status: { in: ACTIVE_RFQ_STATUSES },
        ...(scope.canViewAll ? {} : { company: { owners: { some: { userId: scope.userId } } } }),
      },
      include: {
        company: { select: { id: true, name: true, crmPriority: true, relationshipStrength: true } },
        job: { select: { id: true, reference: true, status: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: 10,
    }),
    prisma.crmOpportunity.findMany({
      where: {
        officeId: scope.officeId,
        stage: { in: OPEN_OPPORTUNITY_STAGES },
        company: scope.canViewAll ? undefined : { owners: { some: { userId: scope.userId } } },
      },
      include: {
        company: { select: { id: true, name: true, crmPriority: true } },
        contact: { select: { id: true, fullName: true, email: true } },
        inquiry: { select: { id: true, subject: true, status: true } },
      },
      orderBy: [{ priority: "asc" }, { nextActionAt: "asc" }, { updatedAt: "desc" }],
      take: 12,
    }),
    prisma.company.findMany({
      where: {
        ...companyScope,
        OR: [
          { lastTouchAt: { lt: staleCutoff } },
          { lastTouchAt: null, updatedAt: { lt: staleCutoff } },
        ],
        crmStage: { notIn: ["archived", "not_fit"] },
      },
      include: {
        owners: { include: { user: { select: { fullName: true } } } },
        tasks: { where: { status: "OPEN" }, orderBy: [{ dueAt: "asc" }], take: 1 },
      },
      orderBy: [{ crmPriority: "asc" }, { updatedAt: "asc" }],
      take: 8,
    }),
    prisma.activity.findMany({
      where: {
        officeId: scope.officeId,
        company: scope.canViewAll ? undefined : { owners: { some: { userId: scope.userId } } },
      },
      include: {
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, fullName: true } },
        opportunity: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 12,
    }),
  ]);

  const agentSuggestions = [
    ...todayTasks.slice(0, 4).map((task) => ({
      key: `task:${task.id}`,
      title: `Follow up: ${task.title}`,
      rationale: task.company ? `${task.company.name} has an open internal follow-up.` : "Open internal follow-up.",
      label: "Internal only",
      href: `/dashboard/crm/tasks`,
    })),
    ...activeRfqs.filter((rfq) => !rfq.companyId).slice(0, 3).map((rfq) => ({
      key: `rfq:${rfq.id}`,
      title: `Resolve account for ${rfq.subject}`,
      rationale: "RFQ is active but not linked to a CRM company yet.",
      label: "Human approval required",
      href: `/dashboard/rfq/${rfq.id}`,
    })),
    ...staleCompanies.slice(0, 3).map((company) => ({
      key: `company:${company.id}`,
      title: `Refresh ${company.name}`,
      rationale: "Relationship is stale or has no recorded touch.",
      label: "Draft only",
      href: `/dashboard/crm/companies/${company.id}`,
    })),
  ].slice(0, 8);

  return {
    counts: { companyCount, contactCount, opportunityCount, openTaskCount },
    todayTasks,
    highPriorityCompanies,
    highLeverageContacts,
    activeRfqs,
    opportunities,
    staleCompanies,
    recentActivities,
    agentSuggestions,
  };
}

export async function listCrmCompanies(scope: CrmUserScope, filters: CrmFilters = {}) {
  const q = nonEmpty(filters.q);
  const where: Prisma.CompanyWhereInput = {
    ...crmCompanyScope(scope),
    ...(filters.category ? { crmCategory: filters.category } : {}),
    ...(filters.stage ? { crmStage: filters.stage } : {}),
    ...(filters.priority ? { crmPriority: filters.priority } : {}),
    ...(filters.source ? { crmSource: filters.source } : {}),
    ...(q ? { OR: companyTextSearch(q) } : {}),
  };
  return prisma.company.findMany({
    where: { officeId: scope.officeId, ...where },
    include: {
      contacts: { orderBy: { updatedAt: "desc" }, take: 2 },
      owners: { include: { user: { select: { fullName: true } } } },
      tasks: { where: { status: "OPEN" }, orderBy: [{ dueAt: "asc" }], take: 2 },
      inquiries: { where: { status: { in: ACTIVE_RFQ_STATUSES } }, orderBy: { receivedAt: "desc" }, take: 1 },
      crmOpportunities: { where: { stage: { in: OPEN_OPPORTUNITY_STAGES } }, orderBy: { updatedAt: "desc" }, take: 2 },
    },
    orderBy: [{ crmPriority: "asc" }, { nextActionAt: "asc" }, { updatedAt: "desc" }],
    take: 100,
  });
}

export async function getCrmCompany(scope: CrmUserScope, companyId: string) {
  return prisma.company.findFirst({
    where: { id: companyId, officeId: scope.officeId, ...crmCompanyScope(scope) },
    include: {
      contacts: { orderBy: [{ leverageLevel: "desc" }, { updatedAt: "desc" }] },
      owners: { include: { user: { select: { id: true, fullName: true, email: true } } } },
      activities: {
        orderBy: { occurredAt: "desc" },
        take: 50,
        include: {
          contact: { select: { id: true, fullName: true } },
          opportunity: { select: { id: true, name: true } },
          inquiry: { select: { id: true, subject: true } },
        },
      },
      tasks: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
        take: 40,
        include: {
          contact: { select: { id: true, fullName: true } },
          opportunity: { select: { id: true, name: true } },
          inquiry: { select: { id: true, subject: true } },
        },
      },
      inquiries: { orderBy: { receivedAt: "desc" }, take: 20, include: { job: { select: { id: true, reference: true, status: true } } } },
      jobs: { orderBy: { updatedAt: "desc" }, take: 20 },
      crmOpportunities: {
        orderBy: [{ stage: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
        take: 30,
        include: { contact: { select: { id: true, fullName: true } }, inquiry: { select: { id: true, subject: true, status: true } } },
      },
      documents: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
}

export async function listCrmContacts(scope: CrmUserScope, filters: CrmFilters = {}) {
  const q = nonEmpty(filters.q);
  return prisma.contact.findMany({
    where: {
      company: { officeId: scope.officeId, ...crmCompanyScope(scope) },
      ...(filters.type ? { relationshipType: filters.type } : {}),
      ...(filters.priority ? { leverageLevel: filters.priority } : {}),
      ...(q ? { OR: contactTextSearch(q) } : {}),
    },
    include: {
      company: { select: { id: true, name: true, crmCategory: true, crmStage: true, crmPriority: true } },
      tasks: { where: { status: "OPEN" }, orderBy: [{ dueAt: "asc" }], take: 2 },
      crmOpportunities: { orderBy: { updatedAt: "desc" }, take: 2 },
    },
    orderBy: [{ leverageLevel: "desc" }, { nextActionAt: "asc" }, { updatedAt: "desc" }],
    take: 150,
  });
}

export async function getCrmContact(scope: CrmUserScope, contactId: string) {
  return prisma.contact.findFirst({
    where: { id: contactId, company: { officeId: scope.officeId, ...crmCompanyScope(scope) } },
    include: {
      company: { include: { owners: { include: { user: { select: { id: true, fullName: true, email: true } } } } } },
      activities: { orderBy: { occurredAt: "desc" }, take: 40, include: { opportunity: { select: { id: true, name: true } }, inquiry: { select: { id: true, subject: true } } } },
      tasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }], take: 30, include: { opportunity: { select: { id: true, name: true } }, inquiry: { select: { id: true, subject: true } } } },
      crmOpportunities: { orderBy: { updatedAt: "desc" }, include: { inquiry: { select: { id: true, subject: true, status: true } } } },
    },
  });
}

export async function listCrmOpportunities(scope: CrmUserScope, filters: CrmFilters = {}) {
  const q = nonEmpty(filters.q);
  return prisma.crmOpportunity.findMany({
    where: {
      officeId: scope.officeId,
      company: scope.canViewAll ? undefined : { owners: { some: { userId: scope.userId } } },
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.stage ? { stage: filters.stage } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(q ? { OR: opportunityTextSearch(q) } : {}),
    },
    include: {
      company: { select: { id: true, name: true, crmPriority: true, relationshipStrength: true } },
      contact: { select: { id: true, fullName: true, email: true, leverageLevel: true } },
      inquiry: { select: { id: true, subject: true, status: true, origin: true, destination: true, mode: true } },
      tasks: { where: { status: "OPEN" }, orderBy: [{ dueAt: "asc" }], take: 2 },
    },
    orderBy: [{ priority: "asc" }, { nextActionAt: "asc" }, { updatedAt: "desc" }],
    take: 150,
  });
}

export async function getCrmOpportunity(scope: CrmUserScope, opportunityId: string) {
  return prisma.crmOpportunity.findFirst({
    where: {
      id: opportunityId,
      officeId: scope.officeId,
      company: scope.canViewAll ? undefined : { owners: { some: { userId: scope.userId } } },
    },
    include: {
      company: { include: { owners: { include: { user: { select: { id: true, fullName: true, email: true } } } } } },
      contact: true,
      inquiry: { include: { job: { select: { id: true, reference: true, status: true } } } },
      activities: { orderBy: { occurredAt: "desc" }, take: 40, include: { contact: { select: { id: true, fullName: true } }, inquiry: { select: { id: true, subject: true } } } },
      tasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }], take: 30, include: { contact: { select: { id: true, fullName: true } }, inquiry: { select: { id: true, subject: true } } } },
    },
  });
}

export async function listCrmTasks(scope: CrmUserScope, filters: CrmFilters = {}) {
  const q = nonEmpty(filters.q);
  return prisma.task.findMany({
    where: {
      officeId: scope.officeId,
      company: scope.canViewAll ? undefined : { owners: { some: { userId: scope.userId } } },
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.stage === "done" ? { status: "DONE" } : filters.stage === "all" ? {} : { status: "OPEN" }),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { details: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    include: {
      company: { select: { id: true, name: true, crmPriority: true } },
      contact: { select: { id: true, fullName: true, email: true } },
      opportunity: { select: { id: true, name: true, stage: true, priority: true } },
      inquiry: { select: { id: true, subject: true, status: true } },
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { priority: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}
