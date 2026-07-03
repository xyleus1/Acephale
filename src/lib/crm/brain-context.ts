import "server-only";
import { prisma } from "@/lib/prisma";
import { getOperationalBrainContext } from "@/lib/brain-ops/query";
import { getCustomerDossier } from "@/lib/memory/customer-dossier";

export type CrmBrainContextInput = {
  officeId: string;
  companyId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  inquiryId?: string | null;
};

export type CrmBrainContext = {
  entityLabel: string;
  sourceState: "linked" | "partial" | "missing";
  summary: string;
  facts: Array<{ claim: string; sourceType: string; sourceTitle: string | null; occurredAt: string | null }>;
  sourceRefs: Array<{ label: string; value: string }>;
  gaps: string[];
  suggestedNextAction: string;
  approvalGate: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function refsFromJson(value: unknown, prefix: string) {
  const raw = Array.isArray(value)
    ? value
    : Object.entries(record(value)).map(([key, val]) => `${key}:${String(val)}`);
  return raw
    .map((item, index) => typeof item === "string" ? { label: `${prefix} ${index + 1}`, value: item } : null)
    .filter((item): item is { label: string; value: string } => !!item);
}

function compactFacts(facts: Array<{ claim?: string | null; source?: { source_type?: string | null; title?: string | null; occurred_at?: string | null } | null }>) {
  return facts.slice(0, 8).map((fact) => ({
    claim: fact.claim?.trim() || "Brain fact",
    sourceType: fact.source?.source_type ?? "memory",
    sourceTitle: fact.source?.title ?? null,
    occurredAt: fact.source?.occurred_at ?? null,
  }));
}

export async function getCrmBrainContext(input: CrmBrainContextInput): Promise<CrmBrainContext> {
  const [company, contact, opportunity, inquiry] = await Promise.all([
    input.companyId
      ? prisma.company.findFirst({
          where: { id: input.companyId, officeId: input.officeId },
          select: { id: true, name: true, sourceRefs: true, brainSlug: true, crmSource: true, crmNotes: true, nextActionAt: true },
        })
      : null,
    input.contactId
      ? prisma.contact.findFirst({
          where: { id: input.contactId, company: { officeId: input.officeId } },
          select: { id: true, fullName: true, email: true, companyId: true, sourceRefs: true, brainSlug: true, notes: true, nextActionAt: true },
        })
      : null,
    input.opportunityId
      ? prisma.crmOpportunity.findFirst({
          where: { id: input.opportunityId, officeId: input.officeId },
          select: { id: true, name: true, companyId: true, contactId: true, inquiryId: true, sourceRefs: true, brainSlug: true, notes: true, nextAction: true, nextActionAt: true },
        })
      : null,
    input.inquiryId
      ? prisma.inquiry.findFirst({
          where: { id: input.inquiryId, officeId: input.officeId },
          select: { id: true, subject: true, companyId: true, fromEmail: true, fromCompany: true, origin: true, destination: true, mode: true },
        })
      : null,
  ]);

  const companyId = company?.id ?? opportunity?.companyId ?? contact?.companyId ?? inquiry?.companyId ?? null;
  const entityLabel = opportunity?.name ?? contact?.fullName ?? company?.name ?? inquiry?.subject ?? "CRM entity";
  const query = [entityLabel, inquiry?.fromEmail, inquiry?.fromCompany, inquiry?.origin, inquiry?.destination, inquiry?.mode].filter(Boolean).join(" ");

  const [dossier, operationalFacts] = await Promise.all([
    companyId ? getCustomerDossier({ officeId: input.officeId, companyId, limit: 8 }).catch(() => null) : null,
    getOperationalBrainContext({
      officeId: input.officeId,
      companyId,
      inquiryId: opportunity?.inquiryId ?? inquiry?.id ?? null,
      query,
      limit: 8,
    }).catch(() => []),
  ]);

  const sourceRefs = [
    ...(company?.brainSlug ? [{ label: "Company brain slug", value: company.brainSlug }] : []),
    ...(contact?.brainSlug ? [{ label: "Contact brain slug", value: contact.brainSlug }] : []),
    ...(opportunity?.brainSlug ? [{ label: "Opportunity brain slug", value: opportunity.brainSlug }] : []),
    ...refsFromJson(company?.sourceRefs, "Company source"),
    ...refsFromJson(contact?.sourceRefs, "Contact source"),
    ...refsFromJson(opportunity?.sourceRefs, "Opportunity source"),
  ].slice(0, 12);

  const facts = compactFacts(operationalFacts);
  const foundDossier = !!dossier && "found" in dossier && dossier.found === true;
  const sourceState: CrmBrainContext["sourceState"] = facts.length > 0 || sourceRefs.length > 0
    ? "linked"
    : foundDossier
      ? "partial"
      : "missing";

  const gaps = [
    ...(companyId ? [] : ["No company/account link yet."]),
    ...(sourceRefs.length ? [] : ["No explicit brain source slug or source refs on this CRM entity."]),
    ...(facts.length ? [] : ["No retrieved CRM brain facts for this context yet."]),
    ...(company?.nextActionAt || contact?.nextActionAt || opportunity?.nextActionAt ? [] : ["No next action date recorded."]),
  ];

  const suggestedNextAction = opportunity?.nextAction
    ?? (inquiry ? "Use RFQ context to confirm owner, company, next action, and whether follow-up is internal draft-only." : null)
    ?? (gaps.length ? "Add source refs, a next action, or an internal note before asking the agent to act." : "Ask the agent for a relationship summary or draft-only follow-up.");

  return {
    entityLabel,
    sourceState,
    summary: sourceState === "linked"
      ? "Source-linked CRM context is available from Derya memory and operational records."
      : sourceState === "partial"
        ? "CRM records exist, but explicit source slugs are still thin."
        : "No live GBrain retrieval is enabled here yet. This panel is using local CRM/RFQ memory only.",
    facts,
    sourceRefs,
    gaps,
    suggestedNextAction,
    approvalGate: "Internal-only. Drafts and suggestions require human approval before any external email, Slack, booking, tender, or quote action.",
  };
}
