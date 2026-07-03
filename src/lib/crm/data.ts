import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { crmCompanyScope, type CrmUserScope } from "@/lib/crm/scope";
import { CRM_OPPORTUNITY_STAGES, categoriesForLayer, leverageRank, priorityRank } from "@/lib/crm/types";

const ACTIVE_RFQ_STATUSES = ["INGESTED", "PARSED", "PRICED", "QUOTED"];
const OPEN_OPPORTUNITY_STAGES = ["idea", "researching", "qualified", "contacted", "meeting_scheduled", "active"];

export type CrmFilters = {
  q?: string | null;
  category?: string | null;
  stage?: string | null;
  priority?: string | null;
  type?: string | null;
  source?: string | null;
  layer?: string | null;
  ownerId?: string | null;
};

function nonEmpty(value: string | null | undefined) {
  const clean = value?.trim();
  return clean ? clean : null;
}

// String enum columns sort alphabetically in the DB, so ranked ordering happens here.
function dateAsc(value: Date | null | undefined) {
  return value ? value.getTime() : Number.POSITIVE_INFINITY;
}

function dateDesc(value: Date | null | undefined) {
  return value ? -value.getTime() : 0;
}

function compareChain(...diffs: number[]) {
  for (const diff of diffs) if (diff !== 0) return diff;
  return 0;
}

function sortCompanies<T extends { crmPriority?: string | null; nextActionAt?: Date | null; updatedAt: Date }>(rows: T[]) {
  return rows.sort((a, b) =>
    compareChain(
      priorityRank(a.crmPriority) - priorityRank(b.crmPriority),
      dateAsc(a.nextActionAt) - dateAsc(b.nextActionAt),
      dateDesc(a.updatedAt) - dateDesc(b.updatedAt),
    ),
  );
}

function sortContacts<T extends { leverageLevel?: string | null; nextActionAt?: Date | null; updatedAt: Date }>(rows: T[]) {
  return rows.sort((a, b) =>
    compareChain(
      leverageRank(a.leverageLevel) - leverageRank(b.leverageLevel),
      dateAsc(a.nextActionAt) - dateAsc(b.nextActionAt),
      dateDesc(a.updatedAt) - dateDesc(b.updatedAt),
    ),
  );
}

function sortOpportunities<T extends { priority?: string | null; stage?: string; nextActionAt?: Date | null; updatedAt: Date }>(rows: T[]) {
  return rows.sort((a, b) =>
    compareChain(
      priorityRank(a.priority) - priorityRank(b.priority),
      dateAsc(a.nextActionAt) - dateAsc(b.nextActionAt),
      dateDesc(a.updatedAt) - dateDesc(b.updatedAt),
    ),
  );
}

function opportunityStageRank(stage: string | null | undefined) {
  const idx = CRM_OPPORTUNITY_STAGES.indexOf((stage ?? "") as (typeof CRM_OPPORTUNITY_STAGES)[number]);
  return idx === -1 ? 99 : idx;
}

function sortTasks<T extends { status: string; dueAt?: Date | null; priority?: string | null; createdAt: Date }>(rows: T[]) {
  return rows.sort((a, b) =>
    compareChain(
      (a.status === "OPEN" ? 0 : 1) - (b.status === "OPEN" ? 0 : 1),
      dateAsc(a.dueAt) - dateAsc(b.dueAt),
      priorityRank(a.priority) - priorityRank(b.priority),
      dateDesc(a.createdAt) - dateDesc(b.createdAt),
    ),
  );
}

function layerFilter(layer: string | null | undefined): Prisma.CompanyWhereInput {
  const categories = categoriesForLayer(layer);
  return categories ? { crmCategory: { in: [...categories] } } : {};
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
    dismissedSuggestions,
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
      orderBy: [{ nextActionAt: "asc" }, { updatedAt: "desc" }],
      take: 24,
    }),
    prisma.contact.findMany({
      where: {
        company: companyScope,
        leverageLevel: { in: ["very_high", "high"] },
      },
      include: { company: { select: { id: true, name: true, crmPriority: true } } },
      orderBy: [{ nextActionAt: "asc" }, { updatedAt: "desc" }],
      take: 24,
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
      orderBy: [{ nextActionAt: "asc" }, { updatedAt: "desc" }],
      take: 36,
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
      orderBy: [{ updatedAt: "asc" }],
      take: 24,
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
    prisma.agentProposal.findMany({
      where: {
        officeId: scope.officeId,
        kind: "CRM_SUGGESTION",
        status: "DISCARDED",
        createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
      select: { payload: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const dismissedKeys = new Set(
    dismissedSuggestions
      .map((proposal) => {
        const payload = proposal.payload as { key?: unknown } | null;
        return typeof payload?.key === "string" ? payload.key : null;
      })
      .filter(Boolean) as string[],
  );

  const rankedHighPriorityCompanies = sortCompanies(highPriorityCompanies).slice(0, 8);
  const rankedHighLeverageContacts = sortContacts(highLeverageContacts).slice(0, 8);
  const rankedOpportunities = sortOpportunities(opportunities).slice(0, 12);
  const rankedStaleCompanies = sortCompanies(staleCompanies).slice(0, 8);

  const agentSuggestions = [
    ...todayTasks.slice(0, 4).map((task) => ({
      key: `task:${task.id}`,
      title: `Follow up: ${task.title}`,
      rationale: task.company ? `${task.company.name} has an open internal follow-up.` : "Open internal follow-up.",
      label: "Internal only",
      href: task.company ? `/dashboard/crm/companies/${task.company.id}` : `/dashboard/crm/tasks`,
    })),
    ...activeRfqs.filter((rfq) => !rfq.companyId).slice(0, 3).map((rfq) => ({
      key: `rfq:${rfq.id}`,
      title: `Resolve account for ${rfq.subject}`,
      rationale: "RFQ is active but not linked to a CRM company yet.",
      label: "Human approval required",
      href: `/dashboard/rfq/${rfq.id}`,
    })),
    ...rankedStaleCompanies.slice(0, 3).map((company) => ({
      key: `company:${company.id}`,
      title: `Refresh ${company.name}`,
      rationale: "Relationship is stale or has no recorded touch.",
      label: "Draft only",
      href: `/dashboard/crm/companies/${company.id}`,
    })),
  ].filter((suggestion) => !dismissedKeys.has(suggestion.key)).slice(0, 8);

  return {
    counts: { companyCount, contactCount, opportunityCount, openTaskCount },
    todayTasks,
    highPriorityCompanies: rankedHighPriorityCompanies,
    highLeverageContacts: rankedHighLeverageContacts,
    activeRfqs,
    opportunities: rankedOpportunities,
    staleCompanies: rankedStaleCompanies,
    recentActivities,
    agentSuggestions,
  };
}

export async function listCrmCompanies(scope: CrmUserScope, filters: CrmFilters = {}) {
  const q = nonEmpty(filters.q);
  const where: Prisma.CompanyWhereInput = {
    ...crmCompanyScope(scope),
    ...layerFilter(filters.layer),
    ...(filters.category ? { crmCategory: filters.category } : {}),
    ...(filters.stage ? { crmStage: filters.stage } : {}),
    ...(filters.priority ? { crmPriority: filters.priority } : {}),
    ...(filters.source ? { crmSource: filters.source } : {}),
    ...(filters.ownerId ? { owners: { some: { userId: filters.ownerId } } } : {}),
    ...(q ? { OR: companyTextSearch(q) } : {}),
  };
  const companies = await prisma.company.findMany({
    where: { officeId: scope.officeId, ...where },
    include: {
      contacts: { orderBy: { updatedAt: "desc" }, take: 2 },
      owners: { include: { user: { select: { fullName: true } } } },
      tasks: { where: { status: "OPEN" }, orderBy: [{ dueAt: "asc" }], take: 2 },
      inquiries: { where: { status: { in: ACTIVE_RFQ_STATUSES } }, orderBy: { receivedAt: "desc" }, take: 1 },
      crmOpportunities: { where: { stage: { in: OPEN_OPPORTUNITY_STAGES } }, orderBy: { updatedAt: "desc" }, take: 2 },
    },
    orderBy: [{ nextActionAt: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return sortCompanies(companies);
}

export async function listCrmCompanyOptions(scope: CrmUserScope) {
  return prisma.company.findMany({
    where: crmCompanyScope(scope),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 300,
  });
}

export async function listCrmOfficeUsers(scope: CrmUserScope) {
  return prisma.user.findMany({
    where: { officeId: scope.officeId, isActive: true },
    select: { id: true, fullName: true, email: true },
    orderBy: { fullName: "asc" },
  });
}

export async function getCrmCompany(scope: CrmUserScope, companyId: string) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, officeId: scope.officeId, ...crmCompanyScope(scope) },
    include: {
      contacts: { orderBy: [{ updatedAt: "desc" }] },
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
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
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
        orderBy: [{ updatedAt: "desc" }],
        take: 30,
        include: { contact: { select: { id: true, fullName: true } }, inquiry: { select: { id: true, subject: true, status: true } } },
      },
      documents: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
  if (!company) return null;
  sortContacts(company.contacts);
  sortTasks(company.tasks);
  company.crmOpportunities.sort((a, b) =>
    compareChain(
      opportunityStageRank(a.stage) - opportunityStageRank(b.stage),
      priorityRank(a.priority) - priorityRank(b.priority),
      dateDesc(a.updatedAt) - dateDesc(b.updatedAt),
    ),
  );
  return company;
}

export async function listCrmContacts(scope: CrmUserScope, filters: CrmFilters = {}) {
  const q = nonEmpty(filters.q);
  const contacts = await prisma.contact.findMany({
    where: {
      company: { officeId: scope.officeId, ...crmCompanyScope(scope), ...layerFilter(filters.layer) },
      ...(filters.type ? { relationshipType: filters.type } : {}),
      ...(filters.priority ? { leverageLevel: filters.priority } : {}),
      ...(q ? { OR: contactTextSearch(q) } : {}),
    },
    include: {
      company: { select: { id: true, name: true, crmCategory: true, crmStage: true, crmPriority: true } },
      tasks: { where: { status: "OPEN" }, orderBy: [{ dueAt: "asc" }], take: 2 },
      crmOpportunities: { orderBy: { updatedAt: "desc" }, take: 2 },
    },
    orderBy: [{ nextActionAt: "asc" }, { updatedAt: "desc" }],
    take: 300,
  });
  return sortContacts(contacts);
}

export async function getCrmContact(scope: CrmUserScope, contactId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, company: { officeId: scope.officeId, ...crmCompanyScope(scope) } },
    include: {
      company: { include: { owners: { include: { user: { select: { id: true, fullName: true, email: true } } } } } },
      activities: { orderBy: { occurredAt: "desc" }, take: 40, include: { opportunity: { select: { id: true, name: true } }, inquiry: { select: { id: true, subject: true } } } },
      tasks: { orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 30, include: { opportunity: { select: { id: true, name: true } }, inquiry: { select: { id: true, subject: true } } } },
      crmOpportunities: { orderBy: { updatedAt: "desc" }, include: { inquiry: { select: { id: true, subject: true, status: true } } } },
    },
  });
  if (!contact) return null;
  sortTasks(contact.tasks);
  return contact;
}

export async function listCrmOpportunities(scope: CrmUserScope, filters: CrmFilters = {}) {
  const q = nonEmpty(filters.q);
  const layer = layerFilter(filters.layer);
  const restricted = scope.canViewAll ? {} : { owners: { some: { userId: scope.userId } } };
  const companyWhere = { ...restricted, ...layer };
  const opportunities = await prisma.crmOpportunity.findMany({
    where: {
      officeId: scope.officeId,
      ...(Object.keys(companyWhere).length ? { company: companyWhere } : {}),
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
    orderBy: [{ nextActionAt: "asc" }, { updatedAt: "desc" }],
    take: 300,
  });
  return sortOpportunities(opportunities);
}

export async function getCrmOpportunity(scope: CrmUserScope, opportunityId: string) {
  const opportunity = await prisma.crmOpportunity.findFirst({
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
      tasks: { orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 30, include: { contact: { select: { id: true, fullName: true } }, inquiry: { select: { id: true, subject: true } } } },
    },
  });
  if (!opportunity) return null;
  sortTasks(opportunity.tasks);
  return opportunity;
}

export async function listCrmTasks(scope: CrmUserScope, filters: CrmFilters = {}) {
  const q = nonEmpty(filters.q);
  const tasks = await prisma.task.findMany({
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
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
  return sortTasks(tasks);
}
