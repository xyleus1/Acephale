import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  parseStoredExaRetrievalCapture,
  validateExaPublicListingReceipts,
  validateExaPublicSupplierLeadReceipts,
  type ExaSupplierResearchInput,
} from "./exa-supplier-research";
import { requireSupplyWorkspace, type SupplyAccessContext } from "./persistence";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function text(value: unknown, max = 1_000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function url(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizedName(value: unknown) {
  return text(value, 180).normalize("NFKC").toLocaleLowerCase("und").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function websiteDomain(value: unknown) {
  const website = url(value);
  return website ? new URL(website).hostname.replace(/^www\./, "").toLowerCase() : null;
}

export function supplySupplierKey(candidate: JsonRecord) {
  const country = text(record(candidate.country).value, 120).toLowerCase();
  const name = normalizedName(candidate.companyName);
  if (!name) return "";
  return digest({ name, country }).slice(0, 40);
}

export function supplySupplierKeyWithDomainConflict(args: {
  baseKey: string;
  incomingDomain: string | null;
  existingDomain: string | null;
}) {
  if (!args.baseKey || !args.incomingDomain || !args.existingDomain || args.incomingDomain === args.existingDomain) return args.baseKey;
  return digest({ baseKey: args.baseKey, domain: args.incomingDomain }).slice(0, 40);
}

export async function recordSupplyResearchKnowledge(args: {
  tx: Prisma.TransactionClient;
  context: SupplyAccessContext;
  workspaceId: string;
  runId: string;
  input: unknown;
  output: unknown;
}) {
  const capturedAt = new Date();
  const input = record(args.input);
  const customerFactValue = {
    componentItemKey: text(input.componentItemKey, 180),
    componentName: text(input.componentName, 240),
    manufacturer: text(input.manufacturer, 180) || null,
    mpn: text(input.mpn, 180) || null,
    specification: text(input.specification, 1_000) || null,
    requestedQuantity: typeof input.requestedQuantity === "number" ? input.requestedQuantity : null,
    requestedUnit: text(input.requestedUnit, 80) || null,
    sourceRegion: text(input.sourceRegion, 180) || null,
    deliveryLocation: text(input.deliveryLocation, 240) || null,
    needByDate: text(input.needByDate, 10) || null,
  };
  const customerFactHash = digest({ subjectType: "CUSTOMER", subjectRef: args.workspaceId, factType: "SOURCING_NEED", value: customerFactValue });
  await args.tx.supplyProfileFact.createMany({
    data: [{
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      capabilityRunId: args.runId,
      createdByUserId: args.context.userId,
      subjectType: "CUSTOMER",
      subjectRef: args.workspaceId,
      factType: "SOURCING_NEED",
      value: inputJson(customerFactValue),
      sourceType: "OPERATOR_INPUT",
      contentHash: customerFactHash,
      observedAt: capturedAt,
    }],
    skipDuplicates: true,
  });

  const candidates = Array.isArray(record(args.output).candidates) ? record(args.output).candidates as unknown[] : [];
  const retrieval = parseStoredExaRetrievalCapture(record(args.output).retrieval);
  const receiptInput: ExaSupplierResearchInput = {
    officeId: args.context.officeId,
    workspaceId: args.workspaceId,
    componentItemKey: customerFactValue.componentItemKey,
    componentName: customerFactValue.componentName,
    manufacturer: customerFactValue.manufacturer ?? undefined,
    mpn: customerFactValue.mpn ?? undefined,
    specification: customerFactValue.specification ?? undefined,
    requestedQuantity: customerFactValue.requestedQuantity ?? undefined,
    requestedUnit: customerFactValue.requestedUnit ?? undefined,
    sourceRegion: customerFactValue.sourceRegion ?? undefined,
    deliveryLocation: customerFactValue.deliveryLocation ?? undefined,
    needByDate: customerFactValue.needByDate ?? undefined,
  };
  // Never trust the detached receipt array in stored output. Rebuild receipts
  // from the exact run input and bounded raw retrieval capture at persistence.
  const publicListingReceipts = retrieval ? validateExaPublicListingReceipts(receiptInput, retrieval) : [];
  const publicSupplierLeadReceipts = retrieval ? validateExaPublicSupplierLeadReceipts(receiptInput, retrieval) : [];
  const storedLeadReceipts = Array.isArray(record(args.output).publicSupplierLeadReceipts)
    ? record(args.output).publicSupplierLeadReceipts as unknown[]
    : [];
  for (const candidateValue of candidates) {
    const candidate = record(candidateValue);
    const name = text(candidate.companyName, 180);
    if (!name) continue;
    const candidateId = text(candidate.id, 220);
    const candidateSourceUrls = Array.isArray(candidate.sourceUrls)
      ? candidate.sourceUrls.map(url).filter((value): value is string => Boolean(value))
      : [];
    const candidateRoles = Array.isArray(candidate.roles) ? candidate.roles.map((role) => text(role, 40)).filter(Boolean) : [];
    const capability = record(candidate.productCapability);
    const capabilitySources = Array.isArray(capability.sources) ? capability.sources.map(record) : [];
    const leadReceipt = candidate.status === "REVIEW_REQUIRED" ? publicSupplierLeadReceipts.find((receipt) => storedLeadReceipts.some((storedValue) => {
      const stored = record(storedValue);
      return stored.candidateId === candidateId
        && stored.receiptHash === receipt.receiptHash
        && stored.sourceUrl === receipt.sourceUrl
        && stored.itemKey === receipt.itemKey;
    }) && candidateSourceUrls.includes(receipt.sourceUrl)
      && normalizedName(receipt.companyName) === normalizedName(name)
      && websiteDomain(candidate.website) === websiteDomain(receipt.website)
      && candidateRoles.includes(receipt.role)
      && capability.state === "SUPPORTED"
      && text(capability.value, 1_000) === receipt.productCapability
      && capabilitySources.some((source) => source.url === receipt.sourceUrl)) : undefined;
    const listingReceipts = publicListingReceipts.filter((receipt) => (
      receipt.itemKey === customerFactValue.componentItemKey
      && candidateSourceUrls.includes(receipt.sourceUrl)
      && candidates.filter((otherValue) => {
        const other = record(otherValue);
        return Array.isArray(other.sourceUrls) && other.sourceUrls.some((source) => source === receipt.sourceUrl);
      }).length === 1
    ));
    if (!leadReceipt && !listingReceipts.length) continue;
    const baseKey = supplySupplierKey(candidate);
    if (!baseKey) continue;
    const website = url(candidate.website);
    const incomingDomain = websiteDomain(website);
    // Only a server-rebuilt supplier lead receipt may expand durable roles.
    // Search-only and detached model claims never enter the supplier universe.
    const roles = leadReceipt ? [leadReceipt.role] : [];
    const baseProfile = await args.tx.supplySupplierProfile.findUnique({
      where: { workspaceId_supplierKey: { workspaceId: args.workspaceId, supplierKey: baseKey } },
      select: { website: true, websiteDomain: true, roles: true },
    });
    const key = supplySupplierKeyWithDomainConflict({
      baseKey,
      incomingDomain,
      existingDomain: baseProfile?.websiteDomain ?? null,
    });
    const existingProfile = key === baseKey ? baseProfile : await args.tx.supplySupplierProfile.findUnique({
      where: { workspaceId_supplierKey: { workspaceId: args.workspaceId, supplierKey: key } },
      select: { website: true, websiteDomain: true, roles: true },
    });
    const existingRoles = Array.isArray(existingProfile?.roles)
      ? existingProfile.roles.map((role) => text(role, 40)).filter(Boolean)
      : [];
    const mergedRoles = [...new Set([...existingRoles, ...roles])].sort();
    const profile = await args.tx.supplySupplierProfile.upsert({
      where: { workspaceId_supplierKey: { workspaceId: args.workspaceId, supplierKey: key } },
      update: {
        companyName: name,
        normalizedName: normalizedName(name),
        website: website ?? existingProfile?.website,
        websiteDomain: incomingDomain ?? existingProfile?.websiteDomain,
        roles: mergedRoles,
        lastResearchRunId: args.runId,
        lastSeenAt: capturedAt,
      },
      create: {
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        supplierKey: key,
        normalizedName: normalizedName(name),
        companyName: name,
        website,
        websiteDomain: incomingDomain,
        roles,
        lastResearchRunId: args.runId,
        firstSeenAt: capturedAt,
        lastSeenAt: capturedAt,
      },
      select: { id: true, supplierKey: true },
    });

    const candidateSource = website ?? (Array.isArray(candidate.sourceUrls) ? candidate.sourceUrls.map(url).find(Boolean) ?? null : null);
    const supplierFactValue = {
      companyName: name,
      website,
      roles,
      country: record(candidate.country),
      facility: record(candidate.facility),
      productCapability: record(candidate.productCapability),
      cautions: Array.isArray(candidate.cautions) ? candidate.cautions.map((value) => text(value, 400)).filter(Boolean) : [],
      researchRunId: args.runId,
    };
    await args.tx.supplyProfileFact.createMany({
      data: [{
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        capabilityRunId: args.runId,
        subjectType: "SUPPLIER",
        subjectRef: profile.supplierKey,
        factType: "PUBLIC_DISCOVERY",
        value: inputJson(supplierFactValue),
        sourceType: "PUBLIC_WEB",
        sourceUri: candidateSource,
        contentHash: digest({ subjectType: "SUPPLIER", subjectRef: profile.supplierKey, factType: "PUBLIC_DISCOVERY", value: supplierFactValue }),
        observedAt: capturedAt,
      }],
      skipDuplicates: true,
    });

    for (const receipt of listingReceipts) {
      const evidenceKey = `managed-public-listing:${receipt.receiptHash}`;
      const existingEvidence = await args.tx.supplyEvidence.findUnique({
        where: { workspaceId_evidenceKey: { workspaceId: args.workspaceId, evidenceKey } },
        select: { id: true },
      });
      const evidence = existingEvidence ?? await args.tx.supplyEvidence.create({
        data: {
          officeId: args.context.officeId,
          workspaceId: args.workspaceId,
          capabilityRunId: args.runId,
          evidenceKey,
          kind: "PUBLIC_LISTING_RECEIPT",
          sourceType: "MANAGED_PUBLIC_RETRIEVAL",
          sourceUri: receipt.sourceUrl,
          sourceRecordId: receipt.contentsRequestId,
          sourceVersion: receipt.contentsResponseHash,
          title: receipt.sourceTitle ?? `Public listing for ${receipt.itemIdentity}`,
          excerpt: receipt.evidenceExcerpt,
          payload: inputJson(receipt),
          contentHash: receipt.receiptHash,
          confidence: new Prisma.Decimal(1),
          observedAt: new Date(receipt.retrievedAt),
        },
        select: { id: true },
      });
      await args.tx.supplyPriceObservation.createMany({
        data: [{
          officeId: args.context.officeId,
          workspaceId: args.workspaceId,
          supplierProfileId: profile.id,
          capabilityRunId: args.runId,
          evidenceId: evidence.id,
          itemKey: receipt.itemKey,
          observationType: "PUBLIC_LIST_PRICE",
          amount: new Prisma.Decimal(receipt.amount.toString()),
          currency: receipt.currency,
          unitOfMeasure: receipt.unitOfMeasure,
          sourceUrl: receipt.sourceUrl,
          sourceLabel: receipt.sourceTitle,
          contentHash: receipt.receiptHash,
          observedAt: new Date(receipt.retrievedAt),
        }],
        skipDuplicates: true,
      });
    }
  }
}

export async function supplyIntelligenceProfile(context: SupplyAccessContext, workspaceId: string) {
  const workspace = await requireSupplyWorkspace(context, workspaceId, "view");
  const customerFactWhere = { officeId: context.officeId, workspaceId, subjectType: "CUSTOMER" } as const;
  const activeSupplierWhere = { officeId: context.officeId, workspaceId, status: { not: "ARCHIVED" } } as const;
  const [facts, suppliers, factCount, supplierCount] = await Promise.all([
    prisma.supplyProfileFact.findMany({
      where: customerFactWhere,
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, factType: true, value: true, sourceType: true, observedAt: true, capturedAt: true },
    }),
    prisma.supplySupplierProfile.findMany({
      where: activeSupplierWhere,
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        supplierKey: true,
        companyName: true,
        website: true,
        roles: true,
        status: true,
        firstSeenAt: true,
        lastSeenAt: true,
        priceObservations: {
          orderBy: [{ observedAt: "desc" }, { id: "desc" }],
          take: 5,
          select: { id: true, itemKey: true, observationType: true, amount: true, currency: true, unitOfMeasure: true, minimumQuantity: true, sourceUrl: true, sourceLabel: true, observedAt: true, validUntil: true },
        },
      },
    }),
    prisma.supplyProfileFact.count({ where: customerFactWhere }),
    prisma.supplySupplierProfile.count({ where: activeSupplierWhere }),
  ]);
  return {
    customer: {
      workspaceId,
      workspaceName: workspace.name,
      companyId: workspace.companyId,
      factCount,
      facts,
    },
    supplierCount,
    suppliers,
  };
}
