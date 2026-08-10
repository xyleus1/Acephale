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

function sourceHash(normalized: NormalizedSupplyCsvBundle) {
  const { issues: _issues, ...canonical } = normalized;
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function persistNormalizedSnapshot(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  sourceName: string;
  hash: string;
  normalized: NormalizedSupplyCsvBundle;
}) {
  const { context, workspaceId, sourceName, hash, normalized } = args;
  const idempotencyKey = `csv:${workspaceId}:${hash}`;
  const existing = await prisma.supplyImportRun.findFirst({
    where: { officeId: context.officeId, idempotencyKey },
    include: { snapshot: true },
  });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const aggregate = await tx.supplySnapshot.aggregate({
      where: { officeId: context.officeId, workspaceId },
      _max: { version: true },
    });
    const version = (aggregate._max.version ?? 0) + 1;
    const importRun = await tx.supplyImportRun.create({
      data: {
        officeId: context.officeId,
        workspaceId,
        createdByUserId: context.userId,
        adapter: "CSV",
        status: "READY",
        sourceName,
        sourceHash: hash,
        idempotencyKey,
        startedAt: new Date(),
        validation: {
          schemaVersion: 1,
          counts: {
            locations: normalized.locations.length,
            items: normalized.items.length,
            bom: normalized.bom.length,
            inventory: normalized.inventory.length,
            demand: normalized.demand.length,
            purchaseOrders: normalized.purchaseOrders.length,
            supplierTerms: normalized.supplierTerms.length,
            complianceRecords: normalized.complianceRecords.length,
          },
        },
      },
    });
    const snapshot = await tx.supplySnapshot.create({
      data: {
        officeId: context.officeId,
        workspaceId,
        importRunId: importRun.id,
        createdByUserId: context.userId,
        version,
        status: "DRAFT",
        sourceHash: hash,
        metadata: {
          sourceName,
          adapter: "CSV",
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
          officeId: context.officeId,
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
          sourceRefs: [{ source: "CSV", sourceName }],
        },
      });
      locationIds.set(location.locationKey, created.id);
    }

    const itemIds = new Map<string, string>();
    for (const item of normalized.items) {
      const created = await tx.supplyItem.create({
        data: {
          officeId: context.officeId,
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
          sourceRefs: [{ source: "CSV", sourceName }],
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
          officeId: context.officeId,
          workspaceId,
          snapshotId: snapshot.id,
          productItemId,
          revision: "1",
          sourceSystem: "CSV",
          sourceRefs: [{ source: "CSV", sourceName }],
        },
      });
      for (const [index, line] of lines.entries()) {
        if (line.quantity === null) continue;
        const componentItemId = itemIds.get(line.componentItemKey);
        if (!componentItemId) continue;
        await tx.supplyBomLine.create({
          data: {
            officeId: context.officeId,
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
            sourceRefs: [{ source: "CSV", sourceName }],
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
          officeId: context.officeId,
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
          sourceRefs: [{ source: "CSV", sourceName }],
        },
      });
    }

    for (const demand of normalized.demand) {
      if (demand.quantity === null) continue;
      const itemId = itemIds.get(demand.itemKey);
      if (!itemId) continue;
      await tx.supplyDemand.create({
        data: {
          officeId: context.officeId,
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
          sourceRefs: [{ source: "CSV", sourceName }],
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
  const hash = sourceHash(normalized);
  return persistNormalizedSnapshot({
    context,
    workspaceId,
    sourceName: input.sourceName?.trim() || "Supply OS CSV import",
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
        officeId: context.officeId,
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
