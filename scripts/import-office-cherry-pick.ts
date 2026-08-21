import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

type AnyRow = Record<string, any>;
type IdMap = Map<string, string>;

const prisma = new PrismaClient();

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

function asArray(value: unknown): AnyRow[] {
  return Array.isArray(value) ? value as AnyRow[] : [];
}

function date(value: unknown) {
  return value ? new Date(String(value)) : undefined;
}

function nullableDate(value: unknown) {
  return value ? new Date(String(value)) : null;
}

function clean<T extends AnyRow>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;
}

function newPortalToken() {
  return randomBytes(32).toString("hex");
}

function metadataUrl(kind: string, oldId: string) {
  return `metadata-only://${kind}/${oldId}`;
}

function importedContextId(officeId: string, sourceId: string) {
  return `import_${createHash("sha256").update(`${officeId}:${sourceId}`).digest("hex")}`;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function resolveTargetOffice() {
  const officeId = process.env.TARGET_OFFICE_ID?.trim();
  const officeName = process.env.TARGET_OFFICE_NAME?.trim();
  if (!officeId && !officeName) throw new Error("Set TARGET_OFFICE_ID or TARGET_OFFICE_NAME.");
  const office = officeId
    ? await prisma.office.findUnique({ where: { id: officeId }, select: { id: true, name: true } })
    : await prisma.office.findUnique({ where: { name: officeName! }, select: { id: true, name: true } });
  if (!office) throw new Error("Target office was not found.");
  return office;
}

function withoutOldFields(row: AnyRow, oldKeys: string[]) {
  const copy = { ...row };
  for (const key of ["oldId", ...oldKeys]) delete copy[key];
  return clean(copy);
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required.");
  const importPath = requiredEnv("IMPORT_PATH");
  const dryRun = envBool("DRY_RUN", true);
  if (!dryRun && process.env.ALLOW_CHERRY_PICK_IMPORT !== "1") {
    throw new Error("Refusing write import. Set ALLOW_CHERRY_PICK_IMPORT=1 and DRY_RUN=false.");
  }

  const payload = JSON.parse(readFileSync(importPath, "utf8"));
  if (payload.version !== 1) throw new Error(`Unsupported import payload version: ${payload.version ?? "missing"}.`);
  const data = payload.data ?? {};
  const targetOffice = await resolveTargetOffice();

  const plannedCounts = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]));
  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      targetOffice,
      plannedCounts,
      note: "No rows were written. Set DRY_RUN=false and ALLOW_CHERRY_PICK_IMPORT=1 to import.",
    }, null, 2));
    return;
  }

  const companyMap: IdMap = new Map();
  const itemMap: IdMap = new Map();
  const supplierMap: IdMap = new Map();
  const inquiryMap: IdMap = new Map();
  const jobMap: IdMap = new Map();
  const forwarderMap: IdMap = new Map();
  const counts: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  const inc = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
  const skip = (key: string) => { skipped[key] = (skipped[key] ?? 0) + 1; };

  const sourceOffice = jsonObject(jsonObject(payload.source).office);
  const hasOfficePricingTarget = Object.prototype.hasOwnProperty.call(sourceOffice, "pricingTargetMarginPct");
  const legacyMarginTargets = asArray(data.marginProfiles)
    .map((row) => row.marginPercent)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const rawPricingTarget = hasOfficePricingTarget
    ? sourceOffice.pricingTargetMarginPct
    : legacyMarginTargets.length
      ? Math.min(...legacyMarginTargets)
      : undefined;
  if (rawPricingTarget !== undefined) {
    if (rawPricingTarget !== null && (typeof rawPricingTarget !== "number" || !Number.isFinite(rawPricingTarget))) {
      throw new Error("The exported Office pricing target is invalid.");
    }
    await prisma.office.update({
      where: { id: targetOffice.id },
      data: { pricingTargetMarginPct: rawPricingTarget as number | null },
    });
    inc("officePricingPolicy");
  }

  const users = await prisma.user.findMany({
    where: { officeId: targetOffice.id },
    select: { id: true, email: true, role: true },
  });
  const userByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));

  for (const row of asArray(data.companies)) {
    const name = String(row.name ?? "").trim();
    if (!name) { skip("companies"); continue; }
    const company = await prisma.company.upsert({
      where: { officeId_name: { officeId: targetOffice.id, name } },
      update: clean({
        status: row.status,
        class1: row.class1,
        class2: row.class2,
        product: row.product,
        lane: row.lane,
        direction: row.direction,
      }),
      create: clean({
        ...withoutOldFields(row, []),
        officeId: targetOffice.id,
        name,
        createdAt: date(row.createdAt),
        updatedAt: date(row.updatedAt),
      }),
      select: { id: true },
    });
    companyMap.set(String(row.oldId), company.id);
    inc("companies");
  }

  for (const row of asArray(data.items)) {
    const companyId = companyMap.get(String(row.oldCompanyId));
    const name = String(row.name ?? "").trim();
    if (!companyId || !name) { skip("items"); continue; }
    const existing = row.sku
      ? await prisma.item.findUnique({
        where: { companyId_sku: { companyId, sku: String(row.sku) } },
        select: { id: true },
      })
      : await prisma.item.findFirst({
        where: { officeId: targetOffice.id, companyId, name, specification: row.specification ?? null },
        select: { id: true },
      });
    const input = clean({
      ...withoutOldFields(row, ["oldCompanyId"]),
      officeId: targetOffice.id,
      companyId,
      workflowCustomerId: null,
      name,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    const item = existing
      ? await prisma.item.update({ where: { id: existing.id }, data: input, select: { id: true } })
      : await prisma.item.create({ data: input, select: { id: true } });
    itemMap.set(String(row.oldId), item.id);
    inc("items");
  }

  for (const row of asArray(data.suppliers)) {
    const name = String(row.name ?? "").trim();
    const normalizedName = String(row.normalizedName ?? name).trim().toLowerCase().replace(/\s+/g, " ");
    if (!name || !normalizedName) { skip("suppliers"); continue; }
    const supplier = await prisma.supplier.upsert({
      where: { officeId_normalizedName: { officeId: targetOffice.id, normalizedName } },
      update: clean({
        name,
        website: row.website ?? null,
        domain: row.domain ?? null,
        status: row.status,
        sourceRefs: row.sourceRefs ?? null,
      }),
      create: clean({
        ...withoutOldFields(row, []),
        officeId: targetOffice.id,
        name,
        normalizedName,
        createdAt: date(row.createdAt),
        updatedAt: date(row.updatedAt),
      }),
      select: { id: true },
    });
    supplierMap.set(String(row.oldId), supplier.id);
    inc("suppliers");
  }

  for (const row of asArray(data.companySuppliers)) {
    const companyId = companyMap.get(String(row.oldCompanyId));
    const supplierId = supplierMap.get(String(row.oldSupplierId));
    if (!companyId || !supplierId) { skip("companySuppliers"); continue; }
    await prisma.companySupplier.upsert({
      where: { companyId_supplierId: { companyId, supplierId } },
      update: clean({ status: row.status, notes: row.notes ?? null, sourceRefs: row.sourceRefs ?? null }),
      create: clean({
        ...withoutOldFields(row, ["oldCompanyId", "oldSupplierId"]),
        officeId: targetOffice.id,
        companyId,
        supplierId,
        createdAt: date(row.createdAt),
        updatedAt: date(row.updatedAt),
      }),
    });
    inc("companySuppliers");
  }

  for (const row of asArray(data.contacts)) {
    const companyId = companyMap.get(String(row.oldCompanyId));
    if (!companyId) { skip("contacts"); continue; }
    const existing = await prisma.contact.findFirst({
      where: {
        companyId,
        fullName: String(row.fullName ?? ""),
        email: row.email ?? null,
      },
      select: { id: true },
    });
    const input = clean({
      ...withoutOldFields(row, ["oldCompanyId"]),
      companyId,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
      approvedForInboxAt: nullableDate(row.approvedForInboxAt),
    });
    if (existing) await prisma.contact.update({ where: { id: existing.id }, data: input });
    else await prisma.contact.create({ data: input });
    inc("contacts");
  }

  for (const row of asArray(data.companyOwners)) {
    const companyId = companyMap.get(String(row.oldCompanyId));
    const ownerEmail = typeof row.ownerEmail === "string" ? row.ownerEmail.toLowerCase() : null;
    const user = ownerEmail ? userByEmail.get(ownerEmail) : null;
    if (!companyId || !user) { skip("companyOwners"); continue; }
    await prisma.companyOwner.upsert({
      where: { companyId_userId: { companyId, userId: user.id } },
      update: { isPrimary: Boolean(row.isPrimary) },
      create: { companyId, userId: user.id, isPrimary: Boolean(row.isPrimary), createdAt: date(row.createdAt) },
    });
    inc("companyOwners");
  }

  for (const row of asArray(data.activities)) {
    const companyId = companyMap.get(String(row.oldCompanyId));
    if (!companyId) { skip("activities"); continue; }
    const createdBy = typeof row.createdByEmail === "string" ? userByEmail.get(row.createdByEmail.toLowerCase()) : null;
    const existing = await prisma.activity.findFirst({
      where: {
        officeId: targetOffice.id,
        companyId,
        type: row.type,
        occurredAt: date(row.occurredAt),
        subject: row.subject ?? null,
      },
      select: { id: true },
    });
    const input = clean({
      ...withoutOldFields(row, ["oldCompanyId", "createdByEmail"]),
      officeId: targetOffice.id,
      companyId,
      createdByUserId: createdBy?.id ?? null,
      occurredAt: date(row.occurredAt),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    if (existing) await prisma.activity.update({ where: { id: existing.id }, data: input });
    else await prisma.activity.create({ data: input });
    inc("activities");
  }

  for (const row of asArray(data.quotes)) {
    const companyId = companyMap.get(String(row.oldCompanyId));
    if (!companyId) { skip("quotes"); continue; }
    const existing = await prisma.quote.findFirst({
      where: {
        officeId: targetOffice.id,
        companyId,
        quotedAt: date(row.quotedAt),
        origin: row.origin ?? null,
        destination: row.destination ?? null,
        mode: row.mode ?? null,
      },
      select: { id: true },
    });
    const input = clean({
      ...withoutOldFields(row, ["oldCompanyId"]),
      officeId: targetOffice.id,
      companyId,
      quotedAt: date(row.quotedAt),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    if (existing) await prisma.quote.update({ where: { id: existing.id }, data: input });
    else await prisma.quote.create({ data: input });
    inc("quotes");
  }

  for (const row of asArray(data.shipmentRecords)) {
    const companyId = companyMap.get(String(row.oldCompanyId));
    if (!companyId) { skip("shipmentRecords"); continue; }
    const existing = await prisma.shipmentRecord.findFirst({
      where: {
        officeId: targetOffice.id,
        companyId,
        reference: row.reference ?? null,
        shipmentDate: date(row.shipmentDate),
      },
      select: { id: true },
    });
    const input = clean({
      ...withoutOldFields(row, ["oldCompanyId"]),
      officeId: targetOffice.id,
      companyId,
      shipmentDate: date(row.shipmentDate) ?? new Date(),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    if (existing) await prisma.shipmentRecord.update({ where: { id: existing.id }, data: input });
    else await prisma.shipmentRecord.create({ data: input });
    inc("shipmentRecords");
  }

  for (const row of asArray(data.forwarders)) {
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!email) { skip("forwarders"); continue; }
    const forwarder = await prisma.forwarder.upsert({
      where: { officeId_email: { officeId: targetOffice.id, email } },
      update: clean({
        name: row.name,
        modeCoverage: row.modeCoverage,
        apiType: row.apiType,
        active: row.active,
        notes: row.notes,
      }),
      create: clean({
        ...withoutOldFields(row, []),
        officeId: targetOffice.id,
        email,
        createdAt: date(row.createdAt),
        updatedAt: date(row.updatedAt),
      }),
      select: { id: true },
    });
    forwarderMap.set(String(row.oldId), forwarder.id);
    inc("forwarders");
  }

  for (const row of asArray(data.laneRates)) {
    const existing = await prisma.laneRate.findFirst({
      where: {
        officeId: targetOffice.id,
        origin: row.origin,
        destination: row.destination,
        mode: row.mode,
        validFrom: date(row.validFrom),
      },
      select: { id: true },
    });
    const input = clean({
      ...withoutOldFields(row, []),
      officeId: targetOffice.id,
      validFrom: date(row.validFrom) ?? new Date(),
      validTo: nullableDate(row.validTo),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    if (existing) await prisma.laneRate.update({ where: { id: existing.id }, data: input });
    else await prisma.laneRate.create({ data: input });
    inc("laneRates");
  }

  for (const row of asArray(data.inquiries)) {
    const companyId = row.oldCompanyId ? companyMap.get(String(row.oldCompanyId)) ?? null : null;
    const existing = await prisma.inquiry.findFirst({
      where: {
        officeId: targetOffice.id,
        subject: String(row.subject ?? ""),
        fromEmail: row.fromEmail ?? null,
        receivedAt: date(row.receivedAt),
      },
      select: { id: true },
    });
    const input = clean({
      ...withoutOldFields(row, ["oldCompanyId"]),
      officeId: targetOffice.id,
      companyId,
      cargoReadyDate: nullableDate(row.cargoReadyDate),
      summaryCacheAt: nullableDate(row.summaryCacheAt),
      receivedAt: date(row.receivedAt) ?? new Date(),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    const inquiry = existing
      ? await prisma.inquiry.update({ where: { id: existing.id }, data: input, select: { id: true } })
      : await prisma.inquiry.create({ data: input, select: { id: true } });
    inquiryMap.set(String(row.oldId), inquiry.id);
    inc("inquiries");
  }

  for (const row of asArray(data.carrierQuotes)) {
    const inquiryId = inquiryMap.get(String(row.oldInquiryId));
    if (!inquiryId) { skip("carrierQuotes"); continue; }
    const existing = await prisma.carrierQuote.findFirst({
      where: {
        inquiryId,
        carrier: row.carrier,
        rateName: row.rateName ?? null,
        createdAt: date(row.createdAt),
      },
      select: { id: true },
    });
    const input = clean({
      ...withoutOldFields(row, ["oldInquiryId"]),
      inquiryId,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    if (existing) await prisma.carrierQuote.update({ where: { id: existing.id }, data: input });
    else await prisma.carrierQuote.create({ data: input });
    inc("carrierQuotes");
  }

  for (const row of asArray(data.jobs)) {
    const companyId = row.oldCompanyId ? companyMap.get(String(row.oldCompanyId)) ?? null : null;
    const inquiryId = row.oldInquiryId ? inquiryMap.get(String(row.oldInquiryId)) ?? null : null;
    const reference = String(row.reference ?? "").trim();
    if (!reference) { skip("jobs"); continue; }
    const existing = await prisma.job.findUnique({
      where: { officeId_reference: { officeId: targetOffice.id, reference } },
      select: { id: true, portalToken: true },
    });
    const input = clean({
      ...withoutOldFields(row, ["oldCompanyId", "oldInquiryId", "oldParentJobId", "hadPortalToken"]),
      officeId: targetOffice.id,
      companyId,
      inquiryId,
      reference,
      portalToken: existing?.portalToken ?? (row.hadPortalToken ? newPortalToken() : null),
      etd: nullableDate(row.etd),
      eta: nullableDate(row.eta),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    const job = existing
      ? await prisma.job.update({ where: { id: existing.id }, data: input, select: { id: true } })
      : await prisma.job.create({ data: input, select: { id: true } });
    jobMap.set(String(row.oldId), job.id);
    inc("jobs");
  }

  for (const row of asArray(data.jobs)) {
    const jobId = jobMap.get(String(row.oldId));
    const parentJobId = row.oldParentJobId ? jobMap.get(String(row.oldParentJobId)) ?? null : null;
    if (jobId && parentJobId) {
      await prisma.job.update({ where: { id: jobId }, data: { parentJobId } });
      inc("jobParentLinks");
    }
  }

  for (const row of asArray(data.milestones)) {
    const jobId = jobMap.get(String(row.oldJobId));
    if (!jobId) { skip("milestones"); continue; }
    const existing = await prisma.jobMilestone.findFirst({
      where: { jobId, type: row.type, plannedAt: nullableDate(row.plannedAt), actualAt: nullableDate(row.actualAt) },
      select: { id: true },
    });
    const input = clean({
      ...withoutOldFields(row, ["oldJobId"]),
      jobId,
      plannedAt: nullableDate(row.plannedAt),
      actualAt: nullableDate(row.actualAt),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    if (existing) await prisma.jobMilestone.update({ where: { id: existing.id }, data: input });
    else await prisma.jobMilestone.create({ data: input });
    inc("milestones");
  }

  for (const row of asArray(data.companyContext ?? data.companyDocuments)) {
    const companyId = companyMap.get(String(row.oldCompanyId));
    if (!companyId) { skip("companyContext"); continue; }
    const sourceId = String(row.oldId ?? "").trim();
    if (!sourceId) { skip("companyContext"); continue; }
    const itemId = row.oldItemId ? itemMap.get(String(row.oldItemId)) ?? null : null;
    if (row.oldItemId && !itemId) { skip("companyContext"); continue; }
    const uploadedBy = typeof row.uploadedByEmail === "string" ? userByEmail.get(row.uploadedByEmail.toLowerCase()) : null;
    const importId = importedContextId(targetOffice.id, sourceId);
    const sourceContentHash = typeof row.contentHash === "string" && row.contentHash.trim()
      ? row.contentHash.trim()
      : null;
    const existingByImportId = await prisma.companyContext.findUnique({
      where: { id: importId },
      select: { id: true, contentHash: true, storageUrl: true },
    });
    const existingByContent = !existingByImportId && sourceContentHash
      ? await prisma.companyContext.findFirst({
        where: { officeId: targetOffice.id, companyId, contentHash: sourceContentHash },
        select: { id: true, contentHash: true, storageUrl: true },
      })
      : null;
    const existing = existingByImportId ?? existingByContent;
    const hasLiveStorage = Boolean(
      existing?.storageUrl && !existing.storageUrl.startsWith("metadata-only://"),
    );
    if (existingByContent && hasLiveStorage) {
      inc("companyContext");
      continue;
    }
    const hasUnavailableStorage = Boolean(row.hadStorage || row.hadUrl);
    const importSource = {
      id: sourceId,
      contentHash: sourceContentHash,
      storageState: hasUnavailableStorage ? "metadata_only" : "none",
    };
    const input = clean({
      officeId: targetOffice.id,
      companyId,
      itemId,
      kind: row.kind ?? "DOCUMENT",
      name: row.name,
      description: row.description ?? null,
      storageUrl: hasLiveStorage
        ? existing?.storageUrl
        : hasUnavailableStorage
          ? metadataUrl("company-context", sourceId)
          : null,
      mimeType: row.mimeType ?? null,
      sizeBytes: row.sizeBytes ?? null,
      contentHash: hasLiveStorage ? existing?.contentHash : hasUnavailableStorage ? null : sourceContentHash,
      processingState: row.processingState ?? "READY",
      processingError: row.processingError ?? null,
      markdown: row.markdown ?? null,
      payload: { ...jsonObject(row.payload), importSource },
      createdByUserId: uploadedBy?.id ?? null,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    if (existing) await prisma.companyContext.update({ where: { id: existing.id }, data: input });
    else await prisma.companyContext.create({ data: { id: importId, ...input } });
    inc("companyContext");
  }

  for (const row of asArray(data.jobDocuments)) {
    const jobId = jobMap.get(String(row.oldJobId));
    if (!jobId) { skip("jobDocuments"); continue; }
    const uploadedBy = typeof row.uploadedByEmail === "string" ? userByEmail.get(row.uploadedByEmail.toLowerCase()) : null;
    const existing = await prisma.jobDocument.findFirst({
      where: { officeId: targetOffice.id, jobId, name: row.name, docType: row.docType },
      select: { id: true },
    });
    const input = clean({
      officeId: targetOffice.id,
      jobId,
      name: row.name,
      docType: row.docType,
      status: row.status,
      url: null,
      uploadedByUserId: uploadedBy?.id ?? null,
      aiSummary: row.aiSummary ?? null,
      aiFlags: row.aiFlags ?? null,
      aiKeyFields: row.aiKeyFields ?? null,
      aiAnalyzedAt: nullableDate(row.aiAnalyzedAt),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    if (existing) await prisma.jobDocument.update({ where: { id: existing.id }, data: input });
    else await prisma.jobDocument.create({ data: input });
    inc("jobDocuments");
  }

  for (const row of asArray(data.targetPriceHistory)) {
    const inquiryId = row.oldInquiryId ? inquiryMap.get(String(row.oldInquiryId)) ?? null : null;
    const jobId = row.oldJobId ? jobMap.get(String(row.oldJobId)) ?? null : null;
    if (!inquiryId && !jobId) { skip("targetPriceHistory"); continue; }
    const existing = await prisma.targetPriceHistory.findFirst({
      where: {
        officeId: targetOffice.id,
        inquiryId,
        jobId,
        amount: row.amount ?? null,
        currency: row.currency ?? null,
        status: row.status,
        createdAt: date(row.createdAt),
      },
      select: { id: true },
    });
    const input = clean({
      ...withoutOldFields(row, ["oldInquiryId", "oldJobId"]),
      officeId: targetOffice.id,
      inquiryId,
      jobId,
      createdByUserId: null,
      createdAt: date(row.createdAt),
    });
    if (existing) await prisma.targetPriceHistory.update({ where: { id: existing.id }, data: input });
    else await prisma.targetPriceHistory.create({ data: input });
    inc("targetPriceHistory");
  }

  for (const row of asArray(data.emailThreads)) {
    const jobId = row.oldJobId ? jobMap.get(String(row.oldJobId)) ?? null : null;
    const inquiryId = row.oldInquiryId ? inquiryMap.get(String(row.oldInquiryId)) ?? null : null;
    const existing = await prisma.emailThread.findFirst({
      where: { officeId: targetOffice.id, subject: row.subject, lastMessageAt: date(row.lastMessageAt) },
      select: { id: true },
    });
    const threadInput = clean({
      officeId: targetOffice.id,
      jobId,
      inquiryId,
      subject: row.subject,
      participants: row.participants ?? "[]",
      externalThreadId: null,
      autoLinkSkipReason: row.autoLinkSkipReason ?? null,
      supplierOffer: row.supplierOffer ?? null,
      supplierOfferAt: nullableDate(row.supplierOfferAt),
      hiddenAt: nullableDate(row.hiddenAt),
      snoozedUntil: nullableDate(row.snoozedUntil),
      lastMessageAt: date(row.lastMessageAt) ?? new Date(),
      messageCount: 0,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    });
    const thread = existing
      ? await prisma.emailThread.update({ where: { id: existing.id }, data: threadInput, select: { id: true } })
      : await prisma.emailThread.create({ data: threadInput, select: { id: true } });
    let messageCount = 0;
    for (const message of asArray(row.messages)) {
      const messageExists = await prisma.emailMessage.findFirst({
        where: { threadId: thread.id, sentAt: date(message.sentAt), fromEmail: message.fromEmail, subject: message.subject ?? null },
        select: { id: true },
      });
      const messageInput = clean({
        threadId: thread.id,
        accountId: null,
        externalId: null,
        gmailMessageId: null,
        direction: message.direction,
        fromEmail: message.fromEmail,
        fromName: message.fromName ?? null,
        toEmails: message.toEmails ?? "[]",
        ccEmails: message.ccEmails ?? null,
        subject: message.subject ?? null,
        bodyText: message.bodyText ?? null,
        bodyHtml: null,
        attachments: null,
        sentAt: date(message.sentAt) ?? new Date(),
        isRead: Boolean(message.isRead),
        classification: message.classification ?? null,
        classificationReason: message.classificationReason ?? null,
        classificationAt: nullableDate(message.classificationAt),
        createdAt: date(message.createdAt),
      });
      if (messageExists) await prisma.emailMessage.update({ where: { id: messageExists.id }, data: messageInput });
      else await prisma.emailMessage.create({ data: messageInput });
      messageCount += 1;
    }
    await prisma.emailThread.update({ where: { id: thread.id }, data: { messageCount } });
    inc("emailThreads");
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: false,
    targetOffice,
    imported: counts,
    skipped,
    sensitiveTablesSkipped: [
      "EmailAccount",
      "User.passwordHash",
      "sessions",
      "old Job.portalToken",
      "BackgroundJob",
      "Knowledge*/Memory*/AgentMemory",
      "MarketSignal*/MarketImpactReview/MarketSignalFeedback/MarketIngestionRun",
      "AgentProposal",
    ],
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
