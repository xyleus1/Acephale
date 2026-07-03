"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import {
  CRM_COMPANY_CATEGORIES,
  CRM_COMPANY_STAGES,
  CRM_CONTACT_TYPES,
  CRM_LEVERAGE_LEVELS,
  CRM_OPPORTUNITY_STAGES,
  CRM_OPPORTUNITY_TYPES,
  CRM_PRIORITIES,
  CRM_RELATIONSHIP_STRENGTHS,
} from "@/lib/crm/types";

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function dateValue(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function numberValue(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentValue(formData: FormData, key: string) {
  const parsed = numberValue(formData, key);
  if (parsed == null) return null;
  return Math.round(Math.min(100, Math.max(0, parsed)));
}

function inList<T extends readonly string[]>(value: string | null, allowed: T, fallback: T[number]): T[number] {
  return value && allowed.includes(value) ? value as T[number] : fallback;
}

function tagsValue(value: string | null) {
  if (!value) return undefined;
  const tags = value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
  return tags.length ? tags : undefined;
}

function returnPath(formData: FormData, fallback: string) {
  const value = text(formData, "returnTo");
  return value && value.startsWith("/dashboard") && !value.includes("//") ? value : fallback;
}

function redirectWith(path: string, key: "notice" | "error", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${key}=${encodeURIComponent(message)}` as any);
}

async function scopedCompany(officeId: string, companyId: string) {
  return prisma.company.findFirst({
    where: { id: companyId, officeId },
    select: { id: true, nextActionAt: true },
  });
}

async function scopedContact(officeId: string, contactId: string | null) {
  if (!contactId) return null;
  return prisma.contact.findFirst({
    where: { id: contactId, company: { officeId } },
    select: { id: true, companyId: true },
  });
}

async function scopedOpportunity(officeId: string, opportunityId: string | null) {
  if (!opportunityId) return null;
  return prisma.crmOpportunity.findFirst({
    where: { id: opportunityId, officeId },
    select: { id: true, companyId: true },
  });
}

async function scopedInquiry(officeId: string, inquiryId: string | null) {
  if (!inquiryId) return null;
  return prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId },
    select: { id: true, companyId: true, subject: true },
  });
}

function revalidateCrm(companyId?: string | null, contactId?: string | null, opportunityId?: string | null) {
  revalidatePath("/dashboard/crm");
  revalidatePath("/dashboard/crm/companies");
  revalidatePath("/dashboard/crm/people");
  revalidatePath("/dashboard/crm/opportunities");
  revalidatePath("/dashboard/crm/tasks");
  if (companyId) revalidatePath(`/dashboard/crm/companies/${companyId}`);
  if (contactId) revalidatePath(`/dashboard/crm/people/${contactId}`);
  if (opportunityId) revalidatePath(`/dashboard/crm/opportunities/${opportunityId}`);
}

export async function createCrmCompanyAction(formData: FormData) {
  const session = await requireSession();
  const back = returnPath(formData, "/dashboard/crm/companies");
  const name = text(formData, "name");
  if (!name) redirectWith(back, "error", "Company name is required.");

  let company;
  try {
    company = await prisma.company.create({
      data: {
        officeId: session.officeId,
        name,
        status: "UNTOUCHED",
        domain: text(formData, "domain"),
        website: text(formData, "website"),
        linkedinUrl: text(formData, "linkedinUrl"),
        crmCategory: inList(text(formData, "crmCategory"), CRM_COMPANY_CATEGORIES, "prospect"),
        crmStage: inList(text(formData, "crmStage"), CRM_COMPANY_STAGES, "new"),
        crmPriority: inList(text(formData, "crmPriority"), CRM_PRIORITIES, "medium"),
        relationshipStrength: inList(text(formData, "relationshipStrength"), CRM_RELATIONSHIP_STRENGTHS, "unknown"),
        crmSource: text(formData, "crmSource") ?? "manual",
        crmTags: tagsValue(text(formData, "tags")),
        crmNotes: text(formData, "crmNotes"),
        nextActionAt: dateValue(formData, "nextActionAt"),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirectWith(back, "error", `A company named "${name}" already exists in this office.`);
    }
    throw error;
  }

  await prisma.companyOwner.create({
    data: { companyId: company.id, userId: session.userId, isPrimary: true },
  });
  await prisma.activity.create({
    data: {
      officeId: session.officeId,
      companyId: company.id,
      type: "NOTE",
      subject: "Relationship record created",
      body: "Created inside Derya CRM. Internal only.",
      source: "manual",
      createdByUserId: session.userId,
    },
  });

  revalidateCrm(company.id);
  redirectWith(`/dashboard/crm/companies/${company.id}`, "notice", "Relationship created.");
}

export async function updateCrmCompanyAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  if (!companyId) return;
  const back = returnPath(formData, `/dashboard/crm/companies/${companyId}`);
  const existing = await prisma.company.findFirst({
    where: { id: companyId, officeId: session.officeId },
    select: { crmCategory: true, crmStage: true, crmPriority: true, relationshipStrength: true },
  });
  if (!existing) redirectWith("/dashboard/crm/companies", "error", "Company not found.");

  await prisma.company.updateMany({
    where: { id: companyId, officeId: session.officeId },
    data: {
      domain: text(formData, "domain"),
      website: text(formData, "website"),
      linkedinUrl: text(formData, "linkedinUrl"),
      crmCategory: inList(text(formData, "crmCategory"), CRM_COMPANY_CATEGORIES, (existing.crmCategory ?? "prospect") as (typeof CRM_COMPANY_CATEGORIES)[number]),
      crmStage: inList(text(formData, "crmStage"), CRM_COMPANY_STAGES, (existing.crmStage ?? "new") as (typeof CRM_COMPANY_STAGES)[number]),
      crmPriority: inList(text(formData, "crmPriority"), CRM_PRIORITIES, (existing.crmPriority ?? "medium") as (typeof CRM_PRIORITIES)[number]),
      relationshipStrength: inList(text(formData, "relationshipStrength"), CRM_RELATIONSHIP_STRENGTHS, (existing.relationshipStrength ?? "unknown") as (typeof CRM_RELATIONSHIP_STRENGTHS)[number]),
      crmSource: text(formData, "crmSource") ?? "manual",
      crmTags: tagsValue(text(formData, "tags")),
      crmNotes: text(formData, "crmNotes"),
      nextActionAt: dateValue(formData, "nextActionAt"),
    },
  });

  revalidateCrm(companyId);
  redirectWith(back, "notice", "Profile saved.");
}

export async function createCrmContactAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  const fullName = text(formData, "fullName");
  const back = returnPath(formData, companyId ? `/dashboard/crm/companies/${companyId}` : "/dashboard/crm/people");
  if (!companyId) redirectWith(back, "error", "Pick a company for this contact.");
  if (!fullName) redirectWith(back, "error", "Contact name is required.");
  const company = await scopedCompany(session.officeId, companyId);
  if (!company) redirectWith(back, "error", "Company not found.");

  const contact = await prisma.contact.create({
    data: {
      companyId,
      fullName,
      title: text(formData, "title"),
      email: text(formData, "email"),
      phone: text(formData, "phone"),
      linkedinUrl: text(formData, "linkedinUrl"),
      location: text(formData, "location"),
      relationshipType: inList(text(formData, "relationshipType"), CRM_CONTACT_TYPES, "buyer"),
      leverageLevel: inList(text(formData, "leverageLevel"), CRM_LEVERAGE_LEVELS, "medium"),
      relationshipStrength: inList(text(formData, "relationshipStrength"), CRM_RELATIONSHIP_STRENGTHS, "unknown"),
      ownerLabel: text(formData, "ownerLabel"),
      tags: tagsValue(text(formData, "tags")),
      notes: text(formData, "notes"),
      nextActionAt: dateValue(formData, "nextActionAt"),
    },
  });

  await prisma.activity.create({
    data: {
      officeId: session.officeId,
      companyId,
      contactId: contact.id,
      type: "NOTE",
      subject: `Contact added: ${contact.fullName}`,
      body: "Created inside Derya CRM. Internal only.",
      source: "manual",
      createdByUserId: session.userId,
    },
  });

  revalidateCrm(companyId, contact.id);
  redirectWith(back, "notice", `Contact ${contact.fullName} added.`);
}

export async function updateCrmContactAction(formData: FormData) {
  const session = await requireSession();
  const contactId = text(formData, "contactId");
  if (!contactId) return;
  const back = returnPath(formData, `/dashboard/crm/people/${contactId}`);
  const contact = await scopedContact(session.officeId, contactId);
  if (!contact) redirectWith("/dashboard/crm/people", "error", "Contact not found.");

  const fullName = text(formData, "fullName");
  await prisma.contact.updateMany({
    where: { id: contact.id, company: { officeId: session.officeId } },
    data: {
      ...(fullName ? { fullName } : {}),
      title: text(formData, "title"),
      email: text(formData, "email"),
      phone: text(formData, "phone"),
      linkedinUrl: text(formData, "linkedinUrl"),
      location: text(formData, "location"),
      relationshipType: inList(text(formData, "relationshipType"), CRM_CONTACT_TYPES, "buyer"),
      leverageLevel: inList(text(formData, "leverageLevel"), CRM_LEVERAGE_LEVELS, "medium"),
      relationshipStrength: inList(text(formData, "relationshipStrength"), CRM_RELATIONSHIP_STRENGTHS, "unknown"),
      tags: tagsValue(text(formData, "tags")),
      notes: text(formData, "notes"),
      nextActionAt: dateValue(formData, "nextActionAt"),
    },
  });

  revalidateCrm(contact.companyId, contact.id);
  redirectWith(back, "notice", "Contact saved.");
}

export async function toggleCrmContactInboxAction(formData: FormData) {
  const session = await requireSession();
  const contactId = text(formData, "contactId");
  if (!contactId) return;
  const approved = text(formData, "approved") === "true";
  const contact = await scopedContact(session.officeId, contactId);
  if (!contact) return;

  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      isApprovedForInbox: approved,
      approvedForInboxAt: approved ? new Date() : null,
    },
  });

  revalidateCrm(contact.companyId, contact.id);
  revalidatePath("/dashboard/inbox");
}

export async function createCrmOpportunityAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  const name = text(formData, "name");
  const back = returnPath(formData, companyId ? `/dashboard/crm/companies/${companyId}` : "/dashboard/crm/opportunities");
  if (!companyId) redirectWith(back, "error", "Pick a company for this opportunity.");
  if (!name) redirectWith(back, "error", "Opportunity name is required.");
  const company = await scopedCompany(session.officeId, companyId);
  if (!company) redirectWith(back, "error", "Company not found.");

  const contact = await scopedContact(session.officeId, text(formData, "contactId"));
  const inquiry = await scopedInquiry(session.officeId, text(formData, "inquiryId"));
  const linkedInquiryId = inquiry?.companyId === companyId || !inquiry?.companyId ? inquiry?.id ?? null : null;
  const linkedThreads = linkedInquiryId
    ? await prisma.emailThread.findMany({ where: { inquiryId: linkedInquiryId, officeId: session.officeId }, select: { id: true }, take: 3 })
    : [];
  const sourceRefs = linkedInquiryId
    ? [`rfq:${linkedInquiryId}`, ...linkedThreads.map((thread) => `email_thread:${thread.id}`)]
    : undefined;

  const opportunity = await prisma.crmOpportunity.create({
    data: {
      officeId: session.officeId,
      companyId,
      contactId: contact?.companyId === companyId ? contact.id : null,
      inquiryId: linkedInquiryId,
      sourceRefs,
      name,
      type: inList(text(formData, "type"), CRM_OPPORTUNITY_TYPES, "customer_lead"),
      stage: inList(text(formData, "stage"), CRM_OPPORTUNITY_STAGES, "idea"),
      estimatedValue: numberValue(formData, "estimatedValue"),
      currency: text(formData, "currency") ?? "USD",
      likelihood: percentValue(formData, "likelihood"),
      priority: inList(text(formData, "priority"), CRM_PRIORITIES, "medium"),
      nextAction: text(formData, "nextAction"),
      nextActionAt: dateValue(formData, "nextActionAt"),
      source: text(formData, "source") ?? (inquiry ? "rfq" : "manual"),
      notes: text(formData, "notes"),
      createdByUserId: session.userId,
    },
  });

  await prisma.activity.create({
    data: {
      officeId: session.officeId,
      companyId,
      contactId: opportunity.contactId,
      inquiryId: opportunity.inquiryId,
      opportunityId: opportunity.id,
      type: opportunity.inquiryId ? "RFQ" : "NOTE",
      subject: `Opportunity created: ${opportunity.name}`,
      body: opportunity.notes ?? "Created inside Derya CRM. Internal only.",
      source: opportunity.source,
      createdByUserId: session.userId,
    },
  });

  revalidateCrm(companyId, opportunity.contactId, opportunity.id);
  redirectWith(`/dashboard/crm/opportunities/${opportunity.id}`, "notice", "Opportunity created.");
}

export async function updateCrmOpportunityAction(formData: FormData) {
  const session = await requireSession();
  const opportunityId = text(formData, "opportunityId");
  if (!opportunityId) return;
  const back = returnPath(formData, `/dashboard/crm/opportunities/${opportunityId}`);
  const existing = await prisma.crmOpportunity.findFirst({
    where: { id: opportunityId, officeId: session.officeId },
    select: { id: true, companyId: true, stage: true },
  });
  if (!existing) redirectWith("/dashboard/crm/opportunities", "error", "Opportunity not found.");

  const name = text(formData, "name");
  const stage = inList(text(formData, "stage"), CRM_OPPORTUNITY_STAGES, (existing.stage ?? "idea") as (typeof CRM_OPPORTUNITY_STAGES)[number]);
  await prisma.crmOpportunity.update({
    where: { id: existing.id },
    data: {
      ...(name ? { name } : {}),
      type: inList(text(formData, "type"), CRM_OPPORTUNITY_TYPES, "customer_lead"),
      stage,
      estimatedValue: numberValue(formData, "estimatedValue"),
      currency: text(formData, "currency") ?? "USD",
      likelihood: percentValue(formData, "likelihood"),
      priority: inList(text(formData, "priority"), CRM_PRIORITIES, "medium"),
      nextAction: text(formData, "nextAction"),
      nextActionAt: dateValue(formData, "nextActionAt"),
      notes: text(formData, "notes"),
    },
  });

  if (stage !== existing.stage) {
    await prisma.activity.create({
      data: {
        officeId: session.officeId,
        companyId: existing.companyId,
        opportunityId: existing.id,
        type: "NOTE",
        subject: `Opportunity stage updated to ${stage}`,
        source: "manual",
        createdByUserId: session.userId,
      },
    });
  }

  revalidateCrm(existing.companyId, null, existing.id);
  redirectWith(back, "notice", "Opportunity saved.");
}

export async function updateCrmOpportunityStageAction(formData: FormData) {
  const session = await requireSession();
  const opportunityId = text(formData, "opportunityId");
  if (!opportunityId) return;
  const stage = inList(text(formData, "stage"), CRM_OPPORTUNITY_STAGES, "idea");
  const existing = await scopedOpportunity(session.officeId, opportunityId);
  if (!existing) return;

  await prisma.crmOpportunity.update({
    where: { id: opportunityId },
    data: { stage },
  });

  await prisma.activity.create({
    data: {
      officeId: session.officeId,
      companyId: existing.companyId,
      opportunityId,
      type: "NOTE",
      subject: `Opportunity stage updated to ${stage}`,
      source: "manual",
      createdByUserId: session.userId,
    },
  });

  revalidateCrm(existing.companyId, null, opportunityId);
}

export async function createCrmTaskAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  const title = text(formData, "title");
  const back = returnPath(formData, companyId ? `/dashboard/crm/companies/${companyId}` : "/dashboard/crm/tasks");
  if (!companyId) redirectWith(back, "error", "Pick a company for this follow-up.");
  if (!title) redirectWith(back, "error", "Follow-up title is required.");
  const company = await scopedCompany(session.officeId, companyId);
  if (!company) redirectWith(back, "error", "Company not found.");

  const contact = await scopedContact(session.officeId, text(formData, "contactId"));
  const opportunity = await scopedOpportunity(session.officeId, text(formData, "opportunityId"));
  const inquiry = await scopedInquiry(session.officeId, text(formData, "inquiryId"));
  const dueAt = dateValue(formData, "dueAt");

  await prisma.task.create({
    data: {
      officeId: session.officeId,
      companyId,
      contactId: contact?.companyId === companyId ? contact.id : null,
      opportunityId: opportunity?.companyId === companyId ? opportunity.id : null,
      inquiryId: inquiry?.companyId === companyId || !inquiry?.companyId ? inquiry?.id ?? null : null,
      title,
      details: text(formData, "details"),
      dueAt,
      priority: inList(text(formData, "priority"), CRM_PRIORITIES, "medium"),
      source: text(formData, "source") ?? "manual",
      createdByUserId: session.userId,
    },
  });

  // Only pull the company's next action earlier; a far-future task must not
  // push out a nearer commitment.
  if (dueAt && (!company.nextActionAt || dueAt < company.nextActionAt)) {
    await prisma.company.updateMany({
      where: { id: companyId, officeId: session.officeId },
      data: { nextActionAt: dueAt },
    });
  }

  revalidateCrm(companyId, contact?.id, opportunity?.id);
  redirectWith(back, "notice", "Follow-up created.");
}

export async function completeCrmTaskAction(formData: FormData) {
  const session = await requireSession();
  const taskId = text(formData, "taskId");
  if (!taskId) return;

  const task = await prisma.task.findFirst({
    where: { id: taskId, officeId: session.officeId },
    select: { id: true, companyId: true, contactId: true, opportunityId: true },
  });
  if (!task) return;

  await prisma.task.update({ where: { id: task.id }, data: { status: "DONE" } });
  revalidateCrm(task.companyId, task.contactId, task.opportunityId);
}

export async function reopenCrmTaskAction(formData: FormData) {
  const session = await requireSession();
  const taskId = text(formData, "taskId");
  if (!taskId) return;

  const task = await prisma.task.findFirst({
    where: { id: taskId, officeId: session.officeId },
    select: { id: true, companyId: true, contactId: true, opportunityId: true },
  });
  if (!task) return;

  await prisma.task.update({ where: { id: task.id }, data: { status: "OPEN" } });
  revalidateCrm(task.companyId, task.contactId, task.opportunityId);
}

export async function createCrmNoteAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  const subject = text(formData, "subject");
  const body = text(formData, "body");
  const back = returnPath(formData, companyId ? `/dashboard/crm/companies/${companyId}` : "/dashboard/crm");
  if (!companyId) redirectWith(back, "error", "Pick a company for this note.");
  if (!subject && !body) redirectWith(back, "error", "Write a subject or body for the note.");
  const company = await scopedCompany(session.officeId, companyId);
  if (!company) redirectWith(back, "error", "Company not found.");

  const contact = await scopedContact(session.officeId, text(formData, "contactId"));
  const opportunity = await scopedOpportunity(session.officeId, text(formData, "opportunityId"));
  const inquiry = await scopedInquiry(session.officeId, text(formData, "inquiryId"));
  const occurredAt = dateValue(formData, "occurredAt") ?? new Date();

  await prisma.activity.create({
    data: {
      officeId: session.officeId,
      companyId,
      contactId: contact?.companyId === companyId ? contact.id : null,
      opportunityId: opportunity?.companyId === companyId ? opportunity.id : null,
      inquiryId: inquiry?.companyId === companyId || !inquiry?.companyId ? inquiry?.id ?? null : null,
      type: "NOTE",
      occurredAt,
      subject,
      body,
      source: text(formData, "source") ?? "manual",
      createdByUserId: session.userId,
    },
  });

  await prisma.company.updateMany({ where: { id: companyId, officeId: session.officeId }, data: { lastTouchAt: occurredAt } });
  if (contact?.companyId === companyId) {
    await prisma.contact.updateMany({
      where: { id: contact.id, company: { officeId: session.officeId } },
      data: { lastTouchAt: occurredAt },
    });
  }

  revalidateCrm(companyId, contact?.id, opportunity?.id);
  redirectWith(back, "notice", "Note saved.");
}

export async function addCrmCompanyDocumentAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  if (!companyId) return;
  const back = returnPath(formData, `/dashboard/crm/companies/${companyId}`);
  const name = text(formData, "name");
  const url = text(formData, "url");
  if (!name || !url) redirectWith(back, "error", "Document name and URL are required.");
  const company = await scopedCompany(session.officeId, companyId);
  if (!company) redirectWith(back, "error", "Company not found.");

  await prisma.companyDocument.create({
    data: {
      officeId: session.officeId,
      companyId,
      name,
      url,
      docType: text(formData, "docType") ?? "other",
      uploadedByUserId: session.userId,
    },
  });

  revalidateCrm(companyId);
  redirectWith(back, "notice", "Document linked.");
}

export async function deleteCrmCompanyDocumentAction(formData: FormData) {
  const session = await requireSession();
  const documentId = text(formData, "documentId");
  const companyId = text(formData, "companyId");
  if (!documentId) return;

  await prisma.companyDocument.deleteMany({ where: { id: documentId, officeId: session.officeId } });
  revalidateCrm(companyId);
}

export async function dismissCrmSuggestionAction(formData: FormData) {
  const session = await requireSession();
  const key = text(formData, "key");
  if (!key) return;

  // Persisted dismissal doubles as the audit record for agent-suggested CRM
  // items; the command center filters suggestions against these rows.
  await prisma.agentProposal.create({
    data: {
      officeId: session.officeId,
      userId: session.userId,
      kind: "CRM_SUGGESTION",
      status: "DISCARDED",
      payload: {
        entity: "crm",
        key,
        title: text(formData, "title"),
        rationale: text(formData, "rationale"),
        href: text(formData, "href"),
      },
      sourceType: "CRM_HEURISTIC",
      sourcePreview: text(formData, "title"),
      reviewedByUserId: session.userId,
      reviewedAt: new Date(),
      reviewDecision: "DISMISSED",
    },
  });

  revalidatePath("/dashboard/crm");
}

export async function updateCrmOwnersAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  if (!companyId) return;
  const back = returnPath(formData, `/dashboard/crm/companies/${companyId}`);
  const company = await scopedCompany(session.officeId, companyId);
  if (!company) redirectWith(back, "error", "Company not found.");

  const requestedOwnerIds = formData.getAll("ownerIds").map((value) => String(value));
  const validUsers = await prisma.user.findMany({
    where: { id: { in: requestedOwnerIds }, officeId: session.officeId, isActive: true },
    select: { id: true },
  });
  const ownerIds = validUsers.map((user) => user.id);
  const primaryOwnerIdRaw = text(formData, "primaryOwnerId") ?? "";

  const existing = await prisma.companyOwner.findMany({
    where: { companyId, company: { officeId: session.officeId } },
    select: { userId: true },
  });
  const existingSet = new Set(existing.map((owner) => owner.userId));
  const nextSet = new Set(ownerIds);
  const removed = existing.filter((owner) => !nextSet.has(owner.userId)).map((owner) => owner.userId);
  const added = ownerIds.filter((id) => !existingSet.has(id));

  await prisma.companyOwner.deleteMany({
    where: { companyId, company: { officeId: session.officeId }, userId: { in: removed } },
  });
  for (const userId of added) {
    await prisma.companyOwner.upsert({
      where: { companyId_userId: { companyId, userId } },
      update: {},
      create: { companyId, userId, isPrimary: false },
    });
  }
  if (ownerIds.length > 0) {
    const primaryOwnerId = ownerIds.includes(primaryOwnerIdRaw) ? primaryOwnerIdRaw : ownerIds[0];
    await prisma.companyOwner.updateMany({
      where: { companyId, company: { officeId: session.officeId } },
      data: { isPrimary: false },
    });
    await prisma.companyOwner.updateMany({
      where: { companyId, company: { officeId: session.officeId }, userId: primaryOwnerId },
      data: { isPrimary: true },
    });
  }

  revalidateCrm(companyId);
  redirectWith(back, "notice", "Owners updated.");
}
