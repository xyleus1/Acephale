import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  mergeSupplyPartsIntoSnapshot,
  normalizeSupplyCsvBundle,
  type NormalizedSupplyCsvBundle,
  type SupplyCsvBundle,
  type SupplyCsvColumnMappings,
  type SupplyCsvIssue,
} from "./csv-import";

export type SupplyAccessContext = {
  officeId: string;
  userId: string;
  role: string;
  canViewWholeOffice: boolean;
};

export class SupplyPersistenceError extends Error {
  constructor(
    message: string,
    public readonly code: "forbidden" | "not_found" | "invalid_input" | "conflict",
    public readonly issues: SupplyCsvIssue[] = [],
  ) {
    super(message);
    this.name = "SupplyPersistenceError";
  }
}

export async function currentSupplyAccessContext(context: SupplyAccessContext): Promise<SupplyAccessContext> {
  const user = await prisma.user.findFirst({
    where: { id: context.userId, officeId: context.officeId, isActive: true },
    select: { role: true, canViewWholeOffice: true },
  });
  if (!user) throw new SupplyPersistenceError("Your current user no longer has access to this office.", "forbidden");
  return { ...context, role: user.role, canViewWholeOffice: user.canViewWholeOffice };
}

function hasOfficeWideAccess(context: SupplyAccessContext) {
  if (context.role === "EMPLOYEE") return false;
  return context.canViewWholeOffice || context.role === "ADMIN" || context.role === "MANAGER";
}

function canCreateWorkspace(context: SupplyAccessContext) {
  return context.role !== "EMPLOYEE";
}

function workspaceAccessWhere(context: SupplyAccessContext, workspaceId?: string): Prisma.SupplyWorkspaceWhereInput {
  return {
    officeId: context.officeId,
    ...(workspaceId ? { id: workspaceId } : {}),
    status: "ACTIVE",
    ...(hasOfficeWideAccess(context)
      ? {}
      : {
          members: {
            some: { officeId: context.officeId, userId: context.userId, isActive: true },
          },
        }),
  };
}

export async function requireSupplyWorkspace(
  context: SupplyAccessContext,
  workspaceId: string,
  mode: "view" | "edit",
) {
  const workspace = await prisma.supplyWorkspace.findFirst({
    where: workspaceAccessWhere(context, workspaceId),
    include: {
      members: {
        where: { officeId: context.officeId, userId: context.userId, isActive: true },
        select: { role: true },
      },
    },
  });
  if (!workspace) throw new SupplyPersistenceError("Supply workspace not found.", "not_found");

  if (mode === "edit" && !hasOfficeWideAccess(context)) {
    const memberRole = workspace.members[0]?.role;
    if (context.role === "EMPLOYEE" || !memberRole || !["OWNER", "EDITOR"].includes(memberRole)) {
      throw new SupplyPersistenceError("You cannot edit this supply workspace.", "forbidden");
    }
  }
  return workspace;
}

export async function listSupplyWorkspaces(context: SupplyAccessContext) {
  // tenant-scope:ignore workspaceAccessWhere always includes context.officeId.
  return prisma.supplyWorkspace.findMany({
    where: {
      ...workspaceAccessWhere(context),
      OR: [
        { externalKey: null },
        { externalKey: { not: { startsWith: "system:" } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      companyId: true,
      externalKey: true,
      name: true,
      status: true,
      version: true,
      updatedAt: true,
      company: { select: { name: true, website: true } },
      mediaAssets: {
        where: { kind: "company_logo", isPrimary: true },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { url: true },
      },
      snapshots: {
        where: { status: "PUBLISHED" },
        orderBy: { version: "desc" },
        take: 1,
        select: {
          id: true,
          version: true,
          publishedAt: true,
          _count: { select: { items: true, locations: true, inventory: true, demands: true } },
        },
      },
    },
  });
}

export async function createSupplyWorkspace(
  context: SupplyAccessContext,
  input: { name: string; companyId?: string | null; externalKey?: string | null },
) {
  if (!canCreateWorkspace(context)) {
    throw new SupplyPersistenceError("Employees cannot create supply workspaces.", "forbidden");
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 160) {
    throw new SupplyPersistenceError("Workspace name must contain 2 to 160 characters.", "invalid_input");
  }

  if (input.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: input.companyId, officeId: context.officeId },
      select: { id: true },
    });
    if (!company) throw new SupplyPersistenceError("Company not found in this office.", "invalid_input");
  }

  return prisma.$transaction(async (tx) => {
    const companyId = input.companyId || null;

    return tx.supplyWorkspace.create({
      data: {
        officeId: context.officeId,
        companyId,
        createdByUserId: context.userId,
        externalKey: input.externalKey?.trim() || null,
        name,
        members: {
          create: {
            officeId: context.officeId,
            userId: context.userId,
            role: "OWNER",
          },
        },
      },
      include: { members: true },
    });
  });
}

export function normalizedSupplySourceHash(normalized: NormalizedSupplyCsvBundle) {
  const { issues: _issues, ...withoutIssues } = normalized;
  const sorted = <T>(rows: T[]) => [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const canonical = {
    ...withoutIssues,
    locations: sorted(withoutIssues.locations),
    items: sorted(withoutIssues.items),
    bom: sorted(withoutIssues.bom),
    inventory: sorted(withoutIssues.inventory),
    demand: sorted(withoutIssues.demand),
    purchaseOrders: sorted(withoutIssues.purchaseOrders),
    supplierTerms: sorted(withoutIssues.supplierTerms),
    complianceRecords: sorted(withoutIssues.complianceRecords),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function jsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sourceRefsInput(value: unknown, sourceName: string): Prisma.InputJsonValue {
  return jsonInput(value) ?? [{ source: "CSV", sourceName }];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function partsRequest(value: unknown): NormalizedSupplyCsvBundle["items"][number]["request"] {
  const request = jsonRecord(value);
  if (request?.source !== "PARTS_CSV") return undefined;
  return {
    source: "PARTS_CSV",
    rawQuantity: typeof request.rawQuantity === "string" ? request.rawQuantity : null,
    quantity: typeof request.quantity === "number" ? request.quantity : null,
    unitOfMeasure: typeof request.unitOfMeasure === "string" ? request.unitOfMeasure : null,
    supplierDeliverable: typeof request.supplierDeliverable === "string" ? request.supplierDeliverable : null,
    deliveryLocation: typeof request.deliveryLocation === "string" ? request.deliveryLocation : null,
    needByDate: typeof request.needByDate === "string" ? request.needByDate : null,
  };
}

async function latestPublishedSnapshotForParts(
  context: SupplyAccessContext,
  workspaceId: string,
): Promise<NormalizedSupplyCsvBundle | null> {
  const snapshot = await prisma.supplySnapshot.findFirst({
    where: { officeId: context.officeId, workspaceId, status: "PUBLISHED" },
    orderBy: { version: "desc" },
    include: {
      locations: true,
      items: true,
      bomVersions: { include: { lines: true } },
      inventory: true,
      demands: true,
      supplierTerms: true,
      fccProfiles: true,
      mediaAssets: true,
    },
  });
  if (!snapshot) return null;

  const itemKeyById = new Map(snapshot.items.map((item) => [item.id, item.itemKey]));
  const locationKeyById = new Map(snapshot.locations.map((location) => [location.id, location.locationKey]));
  const requireItemKey = (itemId: string, owner: string) => {
    const itemKey = itemKeyById.get(itemId);
    if (!itemKey) throw new SupplyPersistenceError(`${owner} references an item outside the published snapshot.`, "conflict");
    return itemKey;
  };
  const requireLocationKey = (locationId: string, owner: string) => {
    const locationKey = locationKeyById.get(locationId);
    if (!locationKey) throw new SupplyPersistenceError(`${owner} references a location outside the published snapshot.`, "conflict");
    return locationKey;
  };
  const snapshotMetadata = jsonRecord(snapshot.metadata);

  return {
    schemaVersion: 2,
    locations: snapshot.locations.map((location) => ({
      locationKey: location.locationKey,
      externalId: location.externalId ?? undefined,
      name: location.name,
      kind: location.kind,
      addressLine: location.addressLine ?? undefined,
      city: location.city ?? undefined,
      region: location.region ?? undefined,
      postalCode: location.postalCode ?? undefined,
      countryCode: location.countryCode ?? undefined,
      latitude: location.latitude === null ? undefined : location.latitude.toString(),
      longitude: location.longitude === null ? undefined : location.longitude.toString(),
      timezone: location.timezone ?? undefined,
      sourceRefs: location.sourceRefs ?? [],
    })),
    items: snapshot.items.map((item) => {
      const metadata = jsonRecord(item.metadata);
      return {
        itemKey: item.itemKey,
        externalId: item.externalId ?? undefined,
        sku: item.sku ?? undefined,
        manufacturer: item.manufacturer ?? undefined,
        mpn: item.mpn ?? undefined,
        gtin: item.gtin ?? undefined,
        approvedAliases: stringArray(metadata?.approvedAliases),
        name: item.name,
        description: item.description ?? undefined,
        category: item.category ?? undefined,
        itemType: item.itemType,
        unitOfMeasure: item.unitOfMeasure,
        complianceTags: stringArray(metadata?.complianceTags),
        metadata: item.metadata ?? undefined,
        sourceRefs: item.sourceRefs ?? [],
        request: partsRequest(metadata?.request),
      };
    }),
    bom: snapshot.bomVersions.flatMap((version) => version.lines.map((line) => ({
      parentItemKey: requireItemKey(line.parentItemId, "BOM line"),
      componentItemKey: requireItemKey(line.componentItemId, "BOM line"),
      quantity: line.quantity.toString(),
      unitOfMeasure: line.unitOfMeasure,
      scrapRate: line.scrapRate?.toString() ?? null,
      isOptional: line.isOptional,
      alternativeGroup: line.alternativeGroup ?? undefined,
      revision: version.revision,
      bomStatus: version.status,
      sourceSystem: version.sourceSystem ?? undefined,
      bomExternalId: version.externalId ?? undefined,
      effectiveAt: version.effectiveAt?.toISOString(),
      lineNumber: line.lineNumber,
      bomSourceRefs: version.sourceRefs ?? [],
      sourceRefs: line.sourceRefs ?? [],
    }))),
    inventory: snapshot.inventory.map((position) => ({
      positionKey: position.positionKey,
      itemKey: requireItemKey(position.itemId, "Inventory position"),
      locationKey: requireLocationKey(position.locationId, "Inventory position"),
      lotNumber: position.lotNumber ?? undefined,
      unitOfMeasure: position.unitOfMeasure,
      quantityOnHand: position.quantityOnHand?.toString() ?? null,
      quantityAllocated: position.quantityAllocated?.toString() ?? null,
      quantityInTransit: position.quantityInTransit?.toString() ?? null,
      quantityOnOrder: position.quantityOnOrder?.toString() ?? null,
      expectedReceiptAt: position.expectedReceiptAt?.toISOString(),
      asOf: position.asOf.toISOString(),
      sourceRefs: position.sourceRefs ?? [],
    })),
    demand: snapshot.demands.map((demand) => ({
      demandKey: demand.demandKey,
      itemKey: requireItemKey(demand.itemId, "Demand"),
      locationKey: demand.locationId ? requireLocationKey(demand.locationId, "Demand") : undefined,
      sourceType: demand.sourceType,
      externalId: demand.externalId ?? undefined,
      quantity: demand.quantity.toString(),
      unitOfMeasure: demand.unitOfMeasure,
      dueAt: demand.dueAt.toISOString(),
      priority: demand.priority,
      status: demand.status,
      sourceRefs: demand.sourceRefs ?? [],
    })),
    purchaseOrders: Array.isArray(snapshotMetadata?.purchaseOrders)
      ? snapshotMetadata.purchaseOrders as NormalizedSupplyCsvBundle["purchaseOrders"]
      : [],
    supplierTerms: Array.isArray(snapshotMetadata?.supplierTerms)
      ? snapshotMetadata.supplierTerms as NormalizedSupplyCsvBundle["supplierTerms"]
      : [],
    complianceRecords: Array.isArray(snapshotMetadata?.complianceRecords)
      ? snapshotMetadata.complianceRecords as NormalizedSupplyCsvBundle["complianceRecords"]
      : [],
    issues: [],
    snapshotMetadata: {
      ...(snapshotMetadata ?? {}),
      partsMergeBaseSnapshotId: snapshot.id,
    },
    snapshotSupplierTerms: snapshot.supplierTerms.map((term) => ({
      termKey: term.termKey,
      itemKey: requireItemKey(term.itemId, "Supplier term"),
      facilityKey: term.facilityId ? requireLocationKey(term.facilityId, "Supplier term") : undefined,
      supplierKey: term.supplierKey,
      supplierName: term.supplierName,
      isCurrent: term.isCurrent,
      unitOfMeasure: term.unitOfMeasure,
      currency: term.currency ?? undefined,
      unitPrice: term.unitPrice?.toString() ?? null,
      modeledFreightPerUnit: term.modeledFreightPerUnit?.toString() ?? null,
      evidencedDutyPerUnit: term.evidencedDutyPerUnit?.toString() ?? null,
      dutyEvidenceRefs: term.dutyEvidenceRefs ?? undefined,
      leadTimeMinDays: term.leadTimeMinDays,
      leadTimeMaxDays: term.leadTimeMaxDays,
      availableQuantity: term.availableQuantity?.toString() ?? null,
      availableAt: term.availableAt?.toISOString(),
      evidenceRefs: term.evidenceRefs ?? undefined,
      sourceRefs: term.sourceRefs ?? undefined,
    })),
    fccProfiles: snapshot.fccProfiles.map((profile) => ({
      itemKey: requireItemKey(profile.itemId, "FCC profile"),
      moduleAuthorization: profile.moduleAuthorization,
      moduleAuthorizationEvidenceRefs: profile.moduleAuthorizationEvidenceRefs ?? undefined,
      hostIntegrationConstraints: profile.hostIntegrationConstraints ?? undefined,
      labeling: profile.labeling,
      labelingEvidenceRefs: profile.labelingEvidenceRefs ?? undefined,
      rfExposure: profile.rfExposure,
      rfExposureEvidenceRefs: profile.rfExposureEvidenceRefs ?? undefined,
      testing: profile.testing,
      testingEvidenceRefs: profile.testingEvidenceRefs ?? undefined,
      testingGaps: profile.testingGaps ?? undefined,
      reviewRequirements: profile.reviewRequirements ?? undefined,
      blockedReasons: profile.blockedReasons ?? undefined,
      sourceRefs: profile.sourceRefs ?? undefined,
    })),
    mediaAssets: snapshot.mediaAssets.map((asset) => {
      const itemKey = asset.itemId ? requireItemKey(asset.itemId, "Media asset") : undefined;
      const locationKey = asset.locationId ? requireLocationKey(asset.locationId, "Media asset") : undefined;
      return {
        mediaKey: asset.id,
        itemKey,
        locationKey,
        kind: asset.kind,
        url: asset.url,
        sourceUrl: asset.sourceUrl,
        sourcePageUrl: asset.sourcePageUrl ?? undefined,
        creator: asset.creator ?? undefined,
        license: asset.license ?? undefined,
        attribution: asset.attribution ?? undefined,
        contentHash: asset.contentHash ?? undefined,
        width: asset.width ?? undefined,
        height: asset.height ?? undefined,
        isPrimary: asset.isPrimary,
        capturedAt: asset.capturedAt?.toISOString(),
      };
    }),
  };
}

export async function stageNormalizedSupplySnapshot(args: {
  officeId: string;
  workspaceId: string;
  createdByUserId?: string | null;
  sourceName: string;
  adapter: string;
  adapterVersion?: string | null;
  connectorInstallationId?: string | null;
  idempotencyNamespace: string;
  inputCursor?: Prisma.InputJsonValue | null;
  outputCursor?: Prisma.InputJsonValue | null;
  traceId?: string | null;
  hash: string;
  normalized: NormalizedSupplyCsvBundle;
}) {
  const {
    officeId,
    workspaceId,
    createdByUserId,
    sourceName,
    adapter,
    adapterVersion,
    connectorInstallationId,
    idempotencyNamespace,
    inputCursor,
    outputCursor,
    traceId,
    hash,
    normalized,
  } = args;
  const idempotencyKey = `${idempotencyNamespace}:${workspaceId}:${hash}`;
  const recordCounts = {
    locations: normalized.locations.length,
    items: normalized.items.length,
    bom: normalized.bom.length,
    inventory: normalized.inventory.length,
    demand: normalized.demand.length,
    purchaseOrders: normalized.purchaseOrders.length,
    supplierTerms: normalized.supplierTerms.length,
    complianceRecords: normalized.complianceRecords.length,
  };
  const sourceRef = {
    source: adapter,
    sourceName,
    ...(connectorInstallationId ? { connectorInstallationId } : {}),
    ...(traceId ? { traceId } : {}),
  };
  const existing = await prisma.supplyImportRun.findFirst({
    where: { officeId, idempotencyKey },
    include: { snapshot: true },
  });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ advisoryLock: string }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`supply-import:${officeId}:${workspaceId}`}, 0))::text AS "advisoryLock"
    `;
    const transactionExisting = await tx.supplyImportRun.findFirst({
      where: { officeId, idempotencyKey },
      include: { snapshot: true },
    });
    if (transactionExisting) return transactionExisting;
    const aggregate = await tx.supplySnapshot.aggregate({
      where: { officeId, workspaceId },
      _max: { version: true },
    });
    const version = (aggregate._max.version ?? 0) + 1;
    const importRun = await tx.supplyImportRun.create({
      data: {
        officeId,
        workspaceId,
        connectorInstallationId: connectorInstallationId ?? null,
        createdByUserId: createdByUserId ?? null,
        adapter,
        adapterVersion: adapterVersion ?? null,
        status: "READY",
        sourceName,
        sourceHash: hash,
        idempotencyKey,
        startedAt: new Date(),
        validation: { schemaVersion: normalized.schemaVersion, counts: recordCounts },
        inputCursor: inputCursor ?? undefined,
        outputCursor: outputCursor ?? undefined,
        recordCounts,
        traceId: traceId ?? null,
      },
    });
    const snapshot = await tx.supplySnapshot.create({
      data: {
        officeId,
        workspaceId,
        importRunId: importRun.id,
        createdByUserId: createdByUserId ?? null,
        version,
        status: "DRAFT",
        sourceHash: hash,
        metadata: {
          ...(jsonRecord(normalized.snapshotMetadata) ?? {}),
          sourceName,
          adapter,
          adapterVersion: adapterVersion ?? null,
          connectorInstallationId: connectorInstallationId ?? null,
          traceId: traceId ?? null,
          normalizedSchemaVersion: normalized.schemaVersion,
          purchaseOrders: normalized.purchaseOrders,
          supplierTerms: normalized.supplierTerms,
          complianceRecords: normalized.complianceRecords,
        },
      },
    });

    const locationIds = new Map<string, string>();
    for (const location of normalized.locations) {
      const created = await tx.supplyLocation.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          locationKey: location.locationKey,
          externalId: location.externalId,
          name: location.name,
          kind: location.kind,
          addressLine: location.addressLine,
          city: location.city,
          region: location.region,
          postalCode: location.postalCode,
          countryCode: location.countryCode,
          latitude: location.latitude,
          longitude: location.longitude,
          timezone: location.timezone,
          sourceRefs: jsonInput(location.sourceRefs) ?? [sourceRef],
        },
      });
      locationIds.set(location.locationKey, created.id);
    }

    const itemIds = new Map<string, string>();
    for (const item of normalized.items) {
      const created = await tx.supplyItem.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          itemKey: item.itemKey,
          externalId: item.externalId,
          sku: item.sku,
          manufacturer: item.manufacturer,
          mpn: item.mpn,
          gtin: item.gtin,
          name: item.name,
          description: item.description,
          category: item.category,
          itemType: item.itemType,
          unitOfMeasure: item.unitOfMeasure,
          metadata: {
            ...(jsonRecord(item.metadata) ?? {}),
            approvedAliases: item.approvedAliases,
            complianceTags: item.complianceTags,
            ...(item.request ? { request: item.request } : {}),
          },
          sourceRefs: jsonInput(item.sourceRefs) ?? [sourceRef],
        },
      });
      itemIds.set(item.itemKey, created.id);
    }

    const bomByParent = new Map<string, typeof normalized.bom>();
    for (const line of normalized.bom) {
      const versionKey = `${line.parentItemKey}\0${line.revision ?? "1"}`;
      const lines = bomByParent.get(versionKey) ?? [];
      lines.push(line);
      bomByParent.set(versionKey, lines);
    }
    for (const [versionKey, lines] of bomByParent) {
      const parentItemKey = versionKey.split("\0")[0]!;
      const productItemId = itemIds.get(parentItemKey);
      if (!productItemId) continue;
      const versionDetails = lines[0]!;
      const bomVersion = await tx.supplyBomVersion.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          productItemId,
          revision: versionDetails.revision ?? "1",
          status: versionDetails.bomStatus ?? "ACTIVE",
          sourceSystem: versionDetails.sourceSystem ?? adapter,
          externalId: versionDetails.bomExternalId,
          effectiveAt: versionDetails.effectiveAt ? new Date(versionDetails.effectiveAt) : undefined,
          sourceRefs: jsonInput(versionDetails.bomSourceRefs) ?? [sourceRef],
        },
      });
      const usedLineNumbers = new Set(lines.flatMap((line) => line.lineNumber === undefined ? [] : [line.lineNumber]));
      let nextLineNumber = 1;
      for (const line of lines) {
        if (line.quantity === null) continue;
        const componentItemId = itemIds.get(line.componentItemKey);
        if (!componentItemId) continue;
        let lineNumber = line.lineNumber;
        if (lineNumber === undefined) {
          while (usedLineNumbers.has(nextLineNumber)) nextLineNumber += 1;
          lineNumber = nextLineNumber;
          usedLineNumbers.add(lineNumber);
          nextLineNumber += 1;
        }
        await tx.supplyBomLine.create({
          data: {
            officeId,
            workspaceId,
            snapshotId: snapshot.id,
            bomVersionId: bomVersion.id,
            parentItemId: productItemId,
            componentItemId,
            lineNumber,
            quantity: line.quantity,
            unitOfMeasure: line.unitOfMeasure,
            scrapRate: line.scrapRate,
            isOptional: line.isOptional,
            alternativeGroup: line.alternativeGroup,
            sourceRefs: jsonInput(line.sourceRefs) ?? [sourceRef],
          },
        });
      }
    }

    for (const position of normalized.inventory) {
      const itemId = itemIds.get(position.itemKey);
      const locationId = locationIds.get(position.locationKey);
      if (!itemId || !locationId) continue;
      await tx.supplyInventoryPosition.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          positionKey: position.positionKey,
          itemId,
          locationId,
          lotNumber: position.lotNumber,
          unitOfMeasure: position.unitOfMeasure,
          quantityOnHand: position.quantityOnHand,
          quantityAllocated: position.quantityAllocated,
          quantityInTransit: position.quantityInTransit,
          quantityOnOrder: position.quantityOnOrder,
          expectedReceiptAt: position.expectedReceiptAt ? new Date(position.expectedReceiptAt) : undefined,
          asOf: new Date(position.asOf),
          sourceRefs: jsonInput(position.sourceRefs) ?? [sourceRef],
        },
      });
    }

    for (const demand of normalized.demand) {
      if (demand.quantity === null) continue;
      const itemId = itemIds.get(demand.itemKey);
      if (!itemId) continue;
      await tx.supplyDemand.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          demandKey: demand.demandKey,
          itemId,
          locationId: demand.locationKey ? locationIds.get(demand.locationKey) : undefined,
          sourceType: demand.sourceType,
          externalId: demand.externalId,
          quantity: demand.quantity,
          unitOfMeasure: demand.unitOfMeasure,
          dueAt: new Date(demand.dueAt),
          status: demand.status ?? "OPEN",
          priority: demand.priority ?? undefined,
          sourceRefs: jsonInput(demand.sourceRefs) ?? [sourceRef],
        },
      });
    }

    const mappedItemId = (itemKey: string, owner: string) => {
      const itemId = itemIds.get(itemKey);
      if (!itemId) throw new SupplyPersistenceError(`${owner} references missing item ${itemKey}.`, "conflict");
      return itemId;
    };
    const mappedLocationId = (locationKey: string, owner: string) => {
      const locationId = locationIds.get(locationKey);
      if (!locationId) throw new SupplyPersistenceError(`${owner} references missing location ${locationKey}.`, "conflict");
      return locationId;
    };

    const clonedTermKeys = new Set((normalized.snapshotSupplierTerms ?? []).map((term) => term.termKey));
    for (const term of normalized.supplierTerms.filter((candidate) => !clonedTermKeys.has(candidate.termKey))) {
      await tx.supplySupplierTerm.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          termKey: term.termKey,
          itemId: mappedItemId(term.itemKey, "Supplier term"),
          facilityId: term.facility ? mappedLocationId(term.facility, "Supplier term") : undefined,
          supplierKey: term.supplierName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || term.termKey,
          supplierName: term.supplierName,
          isCurrent: term.isCurrent ?? false,
          unitOfMeasure: normalized.items.find((item) => item.itemKey === term.itemKey)?.unitOfMeasure ?? "EA",
          currency: term.currency ?? null,
          unitPrice: term.price,
          leadTimeMinDays: term.leadTimeDays,
          leadTimeMaxDays: term.leadTimeDays,
          availableQuantity: term.availableQuantity ?? null,
          availableAt: term.availableAt ? new Date(term.availableAt) : null,
          evidenceRefs: term.evidenceUrl ? [{ sourceUri: term.evidenceUrl, observedAt: term.observedAt ?? null }] : undefined,
          sourceRefs: [sourceRef],
        },
      });
    }

    for (const term of normalized.snapshotSupplierTerms ?? []) {
      await tx.supplySupplierTerm.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          termKey: term.termKey,
          itemId: mappedItemId(term.itemKey, "Supplier term"),
          facilityId: term.facilityKey ? mappedLocationId(term.facilityKey, "Supplier term") : undefined,
          supplierKey: term.supplierKey,
          supplierName: term.supplierName,
          isCurrent: term.isCurrent,
          unitOfMeasure: term.unitOfMeasure,
          currency: term.currency,
          unitPrice: term.unitPrice,
          modeledFreightPerUnit: term.modeledFreightPerUnit,
          evidencedDutyPerUnit: term.evidencedDutyPerUnit,
          dutyEvidenceRefs: jsonInput(term.dutyEvidenceRefs),
          leadTimeMinDays: term.leadTimeMinDays,
          leadTimeMaxDays: term.leadTimeMaxDays,
          availableQuantity: term.availableQuantity,
          availableAt: term.availableAt ? new Date(term.availableAt) : undefined,
          evidenceRefs: jsonInput(term.evidenceRefs),
          sourceRefs: jsonInput(term.sourceRefs) ?? [sourceRef],
        },
      });
    }

    for (const profile of normalized.fccProfiles ?? []) {
      await tx.supplyFccProfile.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          itemId: mappedItemId(profile.itemKey, "FCC profile"),
          moduleAuthorization: profile.moduleAuthorization,
          moduleAuthorizationEvidenceRefs: jsonInput(profile.moduleAuthorizationEvidenceRefs),
          hostIntegrationConstraints: jsonInput(profile.hostIntegrationConstraints),
          labeling: profile.labeling,
          labelingEvidenceRefs: jsonInput(profile.labelingEvidenceRefs),
          rfExposure: profile.rfExposure,
          rfExposureEvidenceRefs: jsonInput(profile.rfExposureEvidenceRefs),
          testing: profile.testing,
          testingEvidenceRefs: jsonInput(profile.testingEvidenceRefs),
          testingGaps: jsonInput(profile.testingGaps),
          reviewRequirements: jsonInput(profile.reviewRequirements),
          blockedReasons: jsonInput(profile.blockedReasons),
          sourceRefs: jsonInput(profile.sourceRefs) ?? [sourceRef],
        },
      });
    }

    for (const asset of normalized.mediaAssets ?? []) {
      await tx.supplyMediaAsset.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          itemId: asset.itemKey ? mappedItemId(asset.itemKey, "Media asset") : undefined,
          locationId: asset.locationKey ? mappedLocationId(asset.locationKey, "Media asset") : undefined,
          kind: asset.kind,
          url: asset.url,
          sourceUrl: asset.sourceUrl,
          sourcePageUrl: asset.sourcePageUrl,
          creator: asset.creator,
          license: asset.license,
          attribution: asset.attribution,
          contentHash: asset.contentHash,
          width: asset.width,
          height: asset.height,
          isPrimary: asset.isPrimary,
          capturedAt: asset.capturedAt ? new Date(asset.capturedAt) : undefined,
        },
      });
    }

    return tx.supplyImportRun.findUniqueOrThrow({
      where: { id: importRun.id },
      include: { snapshot: true },
    });
  }, { maxWait: 5_000, timeout: 45_000 });
}

export async function stageSupplyCsvImport(
  context: SupplyAccessContext,
  workspaceId: string,
  input: {
    mode?: "FULL_SNAPSHOT" | "PARTS_CSV";
    sourceName?: string | null;
    files: SupplyCsvBundle;
    columnMappings?: SupplyCsvColumnMappings;
    now?: Date;
  },
) {
  await requireSupplyWorkspace(context, workspaceId, "edit");
  let normalized = normalizeSupplyCsvBundle(input.files, {
    columnMappings: input.columnMappings,
    now: input.now,
  });
  const errors = normalized.issues.filter((issue) => issue.severity === "error");
  if (errors.length) {
    throw new SupplyPersistenceError("CSV validation failed.", "invalid_input", normalized.issues);
  }
  const partsListImport = input.mode === "PARTS_CSV";
  if (partsListImport && normalized.items.some((item) => item.request?.source !== "PARTS_CSV")) {
    throw new SupplyPersistenceError("Parts imports may contain only PARTS_CSV items.", "invalid_input");
  }
  if (!normalized.items.length || (!normalized.locations.length && !partsListImport)) {
    throw new SupplyPersistenceError("Locations and items CSV files are required for a full snapshot.", "invalid_input");
  }
  const sourceName = input.sourceName?.trim() || "Supply OS CSV import";
  if (partsListImport) {
    const published = await latestPublishedSnapshotForParts(context, workspaceId);
    if (published) {
      normalized = mergeSupplyPartsIntoSnapshot(published, normalized, sourceName);
    } else {
      normalized.snapshotMetadata = { partsMergeBaseSnapshotId: null };
    }
  }
  const hash = normalizedSupplySourceHash(normalized);
  return stageNormalizedSupplySnapshot({
    officeId: context.officeId,
    workspaceId,
    createdByUserId: context.userId,
    sourceName,
    adapter: "CSV",
    idempotencyNamespace: "csv",
    hash,
    normalized,
  });
}

export async function publishSupplyImport(context: SupplyAccessContext, importRunId: string) {
  const importRun = await prisma.supplyImportRun.findFirst({
    where: { id: importRunId, officeId: context.officeId },
    include: { snapshot: true },
  });
  if (!importRun?.snapshot) throw new SupplyPersistenceError("Supply import not found.", "not_found");
  await requireSupplyWorkspace(context, importRun.workspaceId, "edit");
  return publishSupplyImportForOffice(context.officeId, importRunId);
}

export async function publishSupplyImportForOffice(officeId: string, importRunId: string) {
  const importRun = await prisma.supplyImportRun.findFirst({
    where: { id: importRunId, officeId },
    include: { snapshot: true },
  });
  if (!importRun?.snapshot) throw new SupplyPersistenceError("Supply import not found.", "not_found");
  if (importRun.status === "PUBLISHED" && importRun.snapshot.status === "PUBLISHED") return importRun;
  if (importRun.status !== "READY" || importRun.snapshot.status !== "DRAFT") {
    throw new SupplyPersistenceError("Only a validated draft import can be published.", "conflict");
  }

  const publishedAt = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ advisoryLock: string }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`supply-import:${officeId}:${importRun.workspaceId}`}, 0))::text AS "advisoryLock"
    `;
    const lockedImport = await tx.supplyImportRun.findFirst({
      where: { id: importRunId, officeId },
      include: { snapshot: true },
    });
    if (!lockedImport?.snapshot) throw new SupplyPersistenceError("Supply import not found.", "not_found");
    if (lockedImport.status === "PUBLISHED" && lockedImport.snapshot.status === "PUBLISHED") return lockedImport;
    if (lockedImport.status !== "READY" || lockedImport.snapshot.status !== "DRAFT") {
      throw new SupplyPersistenceError("Only a validated draft import can be published.", "conflict");
    }
    const draftMetadata = jsonRecord(lockedImport.snapshot.metadata);
    const partsMergeDraft = Boolean(draftMetadata && Object.prototype.hasOwnProperty.call(draftMetadata, "partsMergeBaseSnapshotId"));
    if (partsMergeDraft) {
      const partsMergeBaseSnapshotId = typeof draftMetadata?.partsMergeBaseSnapshotId === "string"
        ? draftMetadata.partsMergeBaseSnapshotId
        : null;
      const latestPublished = await tx.supplySnapshot.findFirst({
        where: { officeId, workspaceId: lockedImport.workspaceId, status: "PUBLISHED" },
        orderBy: { version: "desc" },
        select: { id: true },
      });
      if ((latestPublished?.id ?? null) !== partsMergeBaseSnapshotId) {
        throw new SupplyPersistenceError("A newer snapshot was published after this parts import was staged. Stage the parts CSV again.", "conflict");
      }
    }
    await tx.supplySnapshot.update({
      where: { id: lockedImport.snapshot.id },
      data: { status: "PUBLISHED", publishedAt },
    });
    const published = await tx.supplyImportRun.update({
      where: { id: lockedImport.id },
      data: { status: "PUBLISHED", completedAt: publishedAt },
      include: { snapshot: true },
    });
    await tx.supplyApproval.updateMany({
      where: {
        officeId,
        workspaceId: lockedImport.workspaceId,
        status: "PENDING",
        OR: [
          { decision: { snapshotId: { not: lockedImport.snapshot.id } } },
          { executionTask: { snapshotId: { not: lockedImport.snapshot.id } } },
        ],
      },
      data: {
        status: "EXPIRED",
        decidedAt: publishedAt,
        decisionNote: "A newer supply snapshot was published before this approval was decided.",
      },
    });
    await tx.supplyWorkspace.update({
      where: { id: lockedImport.workspaceId },
      data: { version: { increment: 1 } },
    });
    return published;
  });
}

export async function getSupplyWorkspace(context: SupplyAccessContext, workspaceId: string) {
  await requireSupplyWorkspace(context, workspaceId, "view");
  return prisma.supplyWorkspace.findFirstOrThrow({
    where: { id: workspaceId, officeId: context.officeId },
    include: {
      company: { select: { id: true, name: true, website: true } },
      members: { where: { isActive: true }, select: { userId: true, role: true } },
      snapshots: {
        where: { status: "PUBLISHED" },
        orderBy: { version: "desc" },
        take: 1,
        include: {
          locations: true,
          items: true,
          bomVersions: { include: { lines: true } },
          inventory: true,
          demands: true,
          mediaAssets: true,
        },
      },
      importRuns: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, status: true, sourceName: true, sourceHash: true, validation: true, createdAt: true, completedAt: true },
      },
    },
  });
}
