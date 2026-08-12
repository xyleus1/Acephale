import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
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

  return prisma.supplyWorkspace.create({
    data: {
      officeId: context.officeId,
      companyId: input.companyId || null,
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
          sourceRefs: [sourceRef],
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
            approvedAliases: item.approvedAliases,
            complianceTags: item.complianceTags,
          },
          sourceRefs: [sourceRef],
        },
      });
      itemIds.set(item.itemKey, created.id);
    }

    const bomByParent = new Map<string, typeof normalized.bom>();
    for (const line of normalized.bom) {
      const lines = bomByParent.get(line.parentItemKey) ?? [];
      lines.push(line);
      bomByParent.set(line.parentItemKey, lines);
    }
    for (const [parentItemKey, lines] of bomByParent) {
      const productItemId = itemIds.get(parentItemKey);
      if (!productItemId) continue;
      const bomVersion = await tx.supplyBomVersion.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          productItemId,
          revision: "1",
          sourceSystem: adapter,
          sourceRefs: [sourceRef],
        },
      });
      for (const [index, line] of lines.entries()) {
        if (line.quantity === null) continue;
        const componentItemId = itemIds.get(line.componentItemKey);
        if (!componentItemId) continue;
        await tx.supplyBomLine.create({
          data: {
            officeId,
            workspaceId,
            snapshotId: snapshot.id,
            bomVersionId: bomVersion.id,
            parentItemId: productItemId,
            componentItemId,
            lineNumber: index + 1,
            quantity: line.quantity,
            unitOfMeasure: line.unitOfMeasure,
            scrapRate: line.scrapRate,
            isOptional: line.isOptional,
            alternativeGroup: line.alternativeGroup,
            sourceRefs: [sourceRef],
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
          asOf: new Date(position.asOf),
          sourceRefs: [sourceRef],
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
          priority: demand.priority ?? undefined,
          sourceRefs: [sourceRef],
        },
      });
    }

    for (const term of normalized.supplierTerms) {
      const itemId = itemIds.get(term.itemKey);
      if (!itemId) continue;
      const facilityId = term.facility ? locationIds.get(term.facility) : undefined;
      await tx.supplySupplierTerm.create({
        data: {
          officeId,
          workspaceId,
          snapshotId: snapshot.id,
          termKey: term.termKey,
          itemId,
          facilityId,
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

    return tx.supplyImportRun.findUniqueOrThrow({
      where: { id: importRun.id },
      include: { snapshot: true },
    });
  });
}

export async function stageSupplyCsvImport(
  context: SupplyAccessContext,
  workspaceId: string,
  input: {
    sourceName?: string | null;
    files: SupplyCsvBundle;
    columnMappings?: SupplyCsvColumnMappings;
    now?: Date;
  },
) {
  await requireSupplyWorkspace(context, workspaceId, "edit");
  const normalized = normalizeSupplyCsvBundle(input.files, {
    columnMappings: input.columnMappings,
    now: input.now,
  });
  const errors = normalized.issues.filter((issue) => issue.severity === "error");
  if (errors.length) {
    throw new SupplyPersistenceError("CSV validation failed.", "invalid_input", normalized.issues);
  }
  if (!normalized.locations.length || !normalized.items.length) {
    throw new SupplyPersistenceError("Locations and items CSV files are required.", "invalid_input");
  }
  const hash = normalizedSupplySourceHash(normalized);
  return stageNormalizedSupplySnapshot({
    officeId: context.officeId,
    workspaceId,
    createdByUserId: context.userId,
    sourceName: input.sourceName?.trim() || "Supply OS CSV import",
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
    await tx.supplySnapshot.update({
      where: { id: importRun.snapshot!.id },
      data: { status: "PUBLISHED", publishedAt },
    });
    const published = await tx.supplyImportRun.update({
      where: { id: importRun.id },
      data: { status: "PUBLISHED", completedAt: publishedAt },
      include: { snapshot: true },
    });
    await tx.supplyApproval.updateMany({
      where: {
        officeId,
        workspaceId: importRun.workspaceId,
        status: "PENDING",
        OR: [
          { decision: { snapshotId: { not: importRun.snapshot!.id } } },
          { executionTask: { snapshotId: { not: importRun.snapshot!.id } } },
        ],
      },
      data: {
        status: "EXPIRED",
        decidedAt: publishedAt,
        decisionNote: "A newer supply snapshot was published before this approval was decided.",
      },
    });
    await tx.supplyWorkspace.update({
      where: { id: importRun.workspaceId },
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
