import "dotenv/config";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

type JsonObject = Record<string, unknown>;

const EXPORT_VERSION = 1;

function envBool(name: string, defaultValue: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  return ["1", "true", "yes"].includes(raw);
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function prismaFor(url: string) {
  return new PrismaClient({
    datasources: { db: { url } },
  });
}

function redactConnectionMeta(url: string) {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      database: parsed.pathname.replace(/^\//, "") || null,
    };
  } catch {
    return { protocol: "unknown", host: "unknown", database: null };
  }
}

async function resolveOffice(prisma: PrismaClient) {
  const officeId = process.env.OLD_OFFICE_ID?.trim();
  const officeName = process.env.OLD_OFFICE_NAME?.trim();
  if (!officeId && !officeName) throw new Error("Set OLD_OFFICE_ID or OLD_OFFICE_NAME.");

  const office = officeId
    ? await prisma.office.findUnique({
      where: { id: officeId },
      select: { id: true, name: true, pricingTargetMarginPct: true },
    })
    : await prisma.office.findUnique({
      where: { name: officeName! },
      select: { id: true, name: true, pricingTargetMarginPct: true },
    });

  if (!office) throw new Error("Old office was not found.");
  return office;
}

function stripUndefined<T extends JsonObject>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;
}

function jsonObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

async function main() {
  const oldDatabaseUrl = requiredEnv("OLD_DATABASE_URL");
  const exportPath = requiredEnv("EXPORT_PATH");
  const includeEmails = envBool("INCLUDE_EMAILS", false);
  const includeDocumentMetadata = envBool("INCLUDE_DOCUMENT_METADATA", true);
  const includeClosedJobs = envBool("INCLUDE_CLOSED_JOBS", false);
  const prisma = prismaFor(oldDatabaseUrl);

  try {
    const office = await resolveOffice(prisma);
    const closedStatuses = ["DELIVERED", "CANCELLED"];
    const jobWhere = includeClosedJobs
      ? { officeId: office.id }
      : { officeId: office.id, status: { notIn: closedStatuses as never[] } };

    const [
      companies,
      contacts,
      users,
      items,
      suppliers,
      companySuppliers,
      companyOwners,
      activities,
      quotes,
      shipmentRecords,
      inquiries,
      jobs,
      milestones,
      companyContext,
      jobDocuments,
      carrierQuotes,
      forwarders,
      laneRates,
      targetPriceHistory,
      emailThreads,
    ] = await Promise.all([
      prisma.company.findMany({ where: { officeId: office.id }, orderBy: { name: "asc" } }),
      prisma.contact.findMany({ where: { company: { officeId: office.id } }, orderBy: { createdAt: "asc" } }),
      prisma.user.findMany({
        where: { officeId: office.id },
        select: { id: true, email: true, fullName: true, role: true, isActive: true, canViewWholeOffice: true },
      }),
      prisma.item.findMany({ where: { officeId: office.id }, orderBy: { createdAt: "asc" } }),
      prisma.supplier.findMany({ where: { officeId: office.id }, orderBy: { name: "asc" } }),
      prisma.companySupplier.findMany({ where: { officeId: office.id }, orderBy: { createdAt: "asc" } }),
      prisma.companyOwner.findMany({ where: { company: { officeId: office.id } }, orderBy: { createdAt: "asc" } }),
      prisma.activity.findMany({ where: { officeId: office.id }, orderBy: { occurredAt: "asc" } }),
      prisma.quote.findMany({ where: { officeId: office.id }, orderBy: { quotedAt: "asc" } }),
      prisma.shipmentRecord.findMany({ where: { officeId: office.id }, orderBy: { shipmentDate: "asc" } }),
      prisma.inquiry.findMany({ where: { officeId: office.id }, orderBy: { receivedAt: "asc" } }),
      prisma.job.findMany({ where: jobWhere, orderBy: { createdAt: "asc" } }),
      prisma.jobMilestone.findMany({ where: { job: jobWhere }, orderBy: { createdAt: "asc" } }),
      includeDocumentMetadata
        ? prisma.companyContext.findMany({ where: { officeId: office.id }, orderBy: { createdAt: "asc" } })
        : Promise.resolve([]),
      includeDocumentMetadata
        ? prisma.jobDocument.findMany({ where: { officeId: office.id, job: jobWhere }, orderBy: { createdAt: "asc" } })
        : Promise.resolve([]),
      prisma.carrierQuote.findMany({ where: { inquiry: { officeId: office.id } }, orderBy: { createdAt: "asc" } }),
      prisma.forwarder.findMany({ where: { officeId: office.id }, orderBy: { name: "asc" } }),
      prisma.laneRate.findMany({ where: { officeId: office.id }, orderBy: { createdAt: "asc" } }),
      prisma.targetPriceHistory.findMany({ where: { officeId: office.id }, orderBy: { createdAt: "asc" } }),
      includeEmails
        ? prisma.emailThread.findMany({ where: { officeId: office.id }, include: { messages: true }, orderBy: { lastMessageAt: "asc" } })
        : Promise.resolve([]),
    ]);

    const userById = new Map(users.map((user) => [user.id, user]));
    const safeCompanyOwners = companyOwners.map((owner) => {
      const user = userById.get(owner.userId);
      return stripUndefined({
        oldId: owner.id,
        oldCompanyId: owner.companyId,
        ownerEmail: user?.email ?? null,
        ownerFullName: user?.fullName ?? null,
        ownerRole: user?.role ?? null,
        isPrimary: owner.isPrimary,
        createdAt: owner.createdAt,
      });
    });

    const safeActivities = activities.map((activity) => {
      const user = activity.createdByUserId ? userById.get(activity.createdByUserId) : null;
      return {
        ...activity,
        oldId: activity.id,
        oldCompanyId: activity.companyId,
        createdByUserId: undefined,
        createdByEmail: user?.email ?? null,
        id: undefined,
        officeId: undefined,
        companyId: undefined,
      };
    });

    const safeCompanyContext = companyContext.map((entry) => {
      const user = entry.createdByUserId ? userById.get(entry.createdByUserId) : null;
      const importSource = jsonObject(jsonObject(entry.payload).importSource);
      const importedContentHash = typeof importSource.contentHash === "string"
        ? importSource.contentHash.trim() || null
        : null;
      return {
        oldId: entry.id,
        oldCompanyId: entry.companyId,
        oldItemId: entry.itemId,
        kind: entry.kind,
        name: entry.name,
        description: entry.description,
        mimeType: entry.mimeType,
        sizeBytes: entry.sizeBytes,
        contentHash: entry.contentHash ?? importedContentHash,
        processingState: entry.processingState,
        processingError: entry.processingError,
        markdown: entry.markdown,
        payload: entry.payload,
        uploadedByEmail: user?.email ?? null,
        hadStorage: Boolean(entry.storageUrl),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
    });

    const safeJobDocuments = jobDocuments.map((doc) => {
      const user = doc.uploadedByUserId ? userById.get(doc.uploadedByUserId) : null;
      return {
        oldId: doc.id,
        oldJobId: doc.jobId,
        name: doc.name,
        docType: doc.docType,
        status: doc.status,
        uploadedByEmail: user?.email ?? null,
        hadUrl: Boolean(doc.url),
        aiSummary: doc.aiSummary,
        aiFlags: doc.aiFlags,
        aiKeyFields: doc.aiKeyFields,
        aiAnalyzedAt: doc.aiAnalyzedAt,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    });

    const safeEmailThreads = includeEmails
      ? emailThreads.map((thread) => ({
        oldId: thread.id,
        oldJobId: thread.jobId,
        oldInquiryId: thread.inquiryId,
        subject: thread.subject,
        participants: thread.participants,
        externalThreadIdPresent: Boolean(thread.externalThreadId),
        autoLinkSkipReason: thread.autoLinkSkipReason,
        supplierOffer: thread.supplierOffer,
        supplierOfferAt: thread.supplierOfferAt,
        hiddenAt: thread.hiddenAt,
        snoozedUntil: thread.snoozedUntil,
        lastMessageAt: thread.lastMessageAt,
        messageCount: thread.messageCount,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messages: thread.messages.map((message) => ({
          oldId: message.id,
          direction: message.direction,
          fromEmail: message.fromEmail,
          fromName: message.fromName,
          toEmails: message.toEmails,
          ccEmails: message.ccEmails,
          subject: message.subject,
          bodyText: message.bodyText,
          attachmentsMetadataPresent: Boolean(message.attachments),
          sentAt: message.sentAt,
          isRead: message.isRead,
          classification: message.classification,
          classificationReason: message.classificationReason,
          classificationAt: message.classificationAt,
          createdAt: message.createdAt,
        })),
      }))
      : [];

    const payload = {
      version: EXPORT_VERSION,
      generatedAt: new Date().toISOString(),
      source: {
        office,
        database: redactConnectionMeta(oldDatabaseUrl),
        includeEmails,
        includeDocumentMetadata,
        includeClosedJobs,
      },
      excludedTables: [
        "EmailAccount",
        "User.passwordHash",
        "crm_session cookies",
        "Job.portalToken",
        "BackgroundJob",
        "KnowledgeSource",
        "KnowledgeObject",
        "KnowledgeChunk",
        "EntityMention",
        "MemoryEvent",
        "AgentMemory",
        "MarketSignal",
        "MarketSignalLink",
        "MarketImpactReview",
        "MarketSignalFeedback",
        "MarketIngestionRun",
        "AgentProposal",
        "ForwarderRequestDraft",
      ],
      data: {
        companies: companies.map((row) => ({ ...row, oldId: row.id, id: undefined, officeId: undefined })),
        items: items.map((row) => ({
          ...row,
          oldId: row.id,
          oldCompanyId: row.companyId,
          id: undefined,
          officeId: undefined,
          companyId: undefined,
          workflowCustomerId: undefined,
        })),
        suppliers: suppliers.map((row) => ({ ...row, oldId: row.id, id: undefined, officeId: undefined })),
        companySuppliers: companySuppliers.map((row) => ({
          ...row,
          oldId: row.id,
          oldCompanyId: row.companyId,
          oldSupplierId: row.supplierId,
          id: undefined,
          officeId: undefined,
          companyId: undefined,
          supplierId: undefined,
        })),
        contacts: contacts.map((row) => ({ ...row, oldId: row.id, oldCompanyId: row.companyId, id: undefined, companyId: undefined })),
        companyOwners: safeCompanyOwners,
        activities: safeActivities,
        quotes: quotes.map((row) => ({ ...row, oldId: row.id, oldCompanyId: row.companyId, id: undefined, officeId: undefined, companyId: undefined })),
        shipmentRecords: shipmentRecords.map((row) => ({ ...row, oldId: row.id, oldCompanyId: row.companyId, id: undefined, officeId: undefined, companyId: undefined })),
        inquiries: inquiries.map((row) => ({ ...row, oldId: row.id, oldCompanyId: row.companyId, id: undefined, officeId: undefined, companyId: undefined })),
        jobs: jobs.map((row) => ({
          ...row,
          oldId: row.id,
          oldCompanyId: row.companyId,
          oldInquiryId: row.inquiryId,
          oldParentJobId: row.parentJobId,
          hadPortalToken: Boolean(row.portalToken),
          id: undefined,
          officeId: undefined,
          companyId: undefined,
          assignedToUserId: undefined,
          inquiryId: undefined,
          parentJobId: undefined,
          portalToken: undefined,
        })),
        milestones: milestones.map((row) => ({ ...row, oldId: row.id, oldJobId: row.jobId, id: undefined, jobId: undefined })),
        companyContext: safeCompanyContext,
        jobDocuments: safeJobDocuments,
        carrierQuotes: carrierQuotes.map((row) => ({ ...row, oldId: row.id, oldInquiryId: row.inquiryId, id: undefined, inquiryId: undefined })),
        forwarders: forwarders.map((row) => ({ ...row, oldId: row.id, id: undefined, officeId: undefined })),
        laneRates: laneRates.map((row) => ({ ...row, oldId: row.id, id: undefined, officeId: undefined })),
        targetPriceHistory: targetPriceHistory.map((row) => ({
          ...row,
          oldId: row.id,
          oldInquiryId: row.inquiryId,
          oldJobId: row.jobId,
          id: undefined,
          officeId: undefined,
          inquiryId: undefined,
          jobId: undefined,
          createdByUserId: undefined,
        })),
        emailThreads: safeEmailThreads,
      },
    };

    mkdirSync(dirname(exportPath), { recursive: true });
    writeFileSync(exportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const counts = Object.fromEntries(Object.entries(payload.data).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]));
    console.log(JSON.stringify({
      ok: true,
      exportPath,
      office,
      counts,
      includeEmails,
      includeDocumentMetadata,
      includeClosedJobs,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
