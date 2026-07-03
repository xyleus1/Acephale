"use server";

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
  return value ? new Date(value) : null;
}

function numberValue(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inList<T extends readonly string[]>(value: string | null, allowed: T, fallback: T[number]): T[number] {
  return value && allowed.includes(value) ? value as T[number] : fallback;
}

function tagsValue(value: string | null) {
  if (!value) return undefined;
  const tags = value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
  return tags.length ? tags : undefined;
}

async function scopedCompany(officeId: string, companyId: string) {
  return prisma.company.findFirst({ where: { id: companyId, officeId }, select: { id: true } });
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
  revalidatePath("/dashboard/customers");
  if (companyId) {
    revalidatePath(`/dashboard/crm/companies/${companyId}`);
    revalidatePath(`/dashboard/customers/${companyId}`);
  }
  if (contactId) revalidatePath(`/dashboard/crm/people/${contactId}`);
  if (opportunityId) revalidatePath(`/dashboard/crm/opportunities/${opportunityId}`);
}

export async function createCrmCompanyAction(formData: FormData) {
  const session = await requireSession();
  const name = text(formData, "name");
  if (!name) return;

  const company = await prisma.company.create({
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
  redirect(`/dashboard/crm/companies/${company.id}` as any);
}

export async function updateCrmCompanyAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  if (!companyId) return;
  const existing = await scopedCompany(session.officeId, companyId);
  if (!existing) return;

  await prisma.company.updateMany({
    where: { id: companyId, officeId: session.officeId },
    data: {
      domain: text(formData, "domain"),
      website: text(formData, "website"),
      linkedinUrl: text(formData, "linkedinUrl"),
      crmCategory: inList(text(formData, "crmCategory"), CRM_COMPANY_CATEGORIES, "customer"),
      crmStage: inList(text(formData, "crmStage"), CRM_COMPANY_STAGES, "new"),
      crmPriority: inList(text(formData, "crmPriority"), CRM_PRIORITIES, "medium"),
      relationshipStrength: inList(text(formData, "relationshipStrength"), CRM_RELATIONSHIP_STRENGTHS, "unknown"),
      crmSource: text(formData, "crmSource") ?? "manual",
      crmTags: tagsValue(text(formData, "tags")),
      crmNotes: text(formData, "crmNotes"),
      nextActionAt: dateValue(formData, "nextActionAt"),
    },
  });

  revalidateCrm(companyId);
}

export async function createCrmContactAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  const fullName = text(formData, "fullName");
  if (!companyId || !fullName) return;
  const company = await scopedCompany(session.officeId, companyId);
  if (!company) return;

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
}

export async function createCrmOpportunityAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  const name = text(formData, "name");
  if (!companyId || !name) return;
  const company = await scopedCompany(session.officeId, companyId);
  if (!company) return;

  const contact = await scopedContact(session.officeId, text(formData, "contactId"));
  const inquiry = await scopedInquiry(session.officeId, text(formData, "inquiryId"));

  const opportunity = await prisma.crmOpportunity.create({
    data: {
      officeId: session.officeId,
      companyId,
      contactId: contact?.companyId === companyId ? contact.id : null,
      inquiryId: inquiry?.companyId === companyId || !inquiry?.companyId ? inquiry?.id ?? null : null,
      name,
      type: inList(text(formData, "type"), CRM_OPPORTUNITY_TYPES, "customer_lead"),
      stage: inList(text(formData, "stage"), CRM_OPPORTUNITY_STAGES, "idea"),
      estimatedValue: numberValue(formData, "estimatedValue"),
      currency: text(formData, "currency") ?? "USD",
      likelihood: numberValue(formData, "likelihood"),
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
  redirect(`/dashboard/crm/opportunities/${opportunity.id}` as any);
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
  if (!companyId || !title) return;
  const company = await scopedCompany(session.officeId, companyId);
  if (!company) return;

  const contact = await scopedContact(session.officeId, text(formData, "contactId"));
  const opportunity = await scopedOpportunity(session.officeId, text(formData, "opportunityId"));
  const inquiry = await scopedInquiry(session.officeId, text(formData, "inquiryId"));

  await prisma.task.create({
    data: {
      officeId: session.officeId,
      companyId,
      contactId: contact?.companyId === companyId ? contact.id : null,
      opportunityId: opportunity?.companyId === companyId ? opportunity.id : null,
      inquiryId: inquiry?.companyId === companyId || !inquiry?.companyId ? inquiry?.id ?? null : null,
      title,
      details: text(formData, "details"),
      dueAt: dateValue(formData, "dueAt"),
      priority: inList(text(formData, "priority"), CRM_PRIORITIES, "medium"),
      source: text(formData, "source") ?? "manual",
      createdByUserId: session.userId,
    },
  });

  await prisma.company.update({
    where: { id: companyId },
    data: { nextActionAt: dateValue(formData, "dueAt") ?? undefined },
  });

  revalidateCrm(companyId, contact?.id, opportunity?.id);
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

export async function createCrmNoteAction(formData: FormData) {
  const session = await requireSession();
  const companyId = text(formData, "companyId");
  const subject = text(formData, "subject");
  const body = text(formData, "body");
  if (!companyId || (!subject && !body)) return;
  const company = await scopedCompany(session.officeId, companyId);
  if (!company) return;

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
}
