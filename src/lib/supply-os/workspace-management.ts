import "server-only";

import { prisma } from "@/lib/prisma";
import { customerDomain, normalizeCustomerWebsite } from "./company-profile";
import type { NormalizedSupplyCsvBundle, SupplyItemInput, SupplyLocationInput } from "./csv-import";
import {
  latestPublishedSnapshotForParts,
  normalizedSupplySourceHash,
  publishSupplyImport,
  requireSupplyWorkspace,
  stageNormalizedSupplySnapshot,
  SupplyPersistenceError,
  type SupplyAccessContext,
} from "./persistence";

export const CUSTOMER_BASE_LOCATION_KEY = "customer-base";

export type CustomerBaseInput = {
  name: string;
  addressLine: string;
  city: string;
  region?: string | null;
  postalCode?: string | null;
  countryCode: string;
};

export type ManagedSupplyItemInput = {
  name: string;
  description?: string | null;
  manufacturer?: string | null;
  mpn?: string | null;
  unitOfMeasure: string;
  requestedQuantity?: number | null;
  requestedUnit?: string | null;
  supplierDeliverable?: string | null;
  deliveryLocation?: string | null;
  needByDate?: string | null;
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function normalizeCustomerBase(input: CustomerBaseInput): CustomerBaseInput {
  const normalized = {
    name: text(input.name, 160),
    addressLine: text(input.addressLine, 240),
    city: text(input.city, 120),
    region: text(input.region, 120) || null,
    postalCode: text(input.postalCode, 32) || null,
    countryCode: text(input.countryCode, 2).toUpperCase(),
  };
  if (!normalized.name || !normalized.addressLine || !normalized.city || !/^[A-Z]{2}$/.test(normalized.countryCode)) {
    throw new SupplyPersistenceError("Facility name, street address, city, and two-letter country code are required.", "invalid_input");
  }
  return normalized;
}

export function customerBaseIsReady(base: {
  name?: string | null;
  addressLine?: string | null;
  city?: string | null;
  countryCode?: string | null;
} | null | undefined) {
  return Boolean(base?.name?.trim() && base.addressLine?.trim() && base.city?.trim() && /^[A-Za-z]{2}$/.test(base.countryCode?.trim() ?? ""));
}

export function customerBaseHasManagedProvenance(sourceRefs: unknown) {
  return Array.isArray(sourceRefs) && sourceRefs.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const source = entry as Record<string, unknown>;
    return source.source === "CUSTOMER_MANAGED" && source.kind === "base";
  });
}

function emptySnapshot(): NormalizedSupplyCsvBundle {
  return {
    schemaVersion: 2,
    locations: [],
    items: [],
    bom: [],
    inventory: [],
    demand: [],
    purchaseOrders: [],
    supplierTerms: [],
    complianceRecords: [],
    issues: [],
    snapshotSupplierTerms: [],
    fccProfiles: [],
    mediaAssets: [],
    snapshotMetadata: { partsMergeBaseSnapshotId: null },
  };
}

async function publishManagedRevision(
  context: SupplyAccessContext,
  workspaceId: string,
  sourceName: string,
  normalized: NormalizedSupplyCsvBundle,
) {
  const hash = normalizedSupplySourceHash(normalized);
  const staged = await stageNormalizedSupplySnapshot({
    officeId: context.officeId,
    workspaceId,
    createdByUserId: context.userId,
    sourceName,
    adapter: "CUSTOMER_MANAGED",
    adapterVersion: "1",
    idempotencyNamespace: "customer-managed",
    hash,
    normalized,
  });
  return publishSupplyImport(context, staged.id);
}

function managedSource(context: SupplyAccessContext, kind: "base" | "item") {
  return [{ source: "CUSTOMER_MANAGED", kind, userId: context.userId, recordedAt: new Date().toISOString() }];
}

function appendManagedSource(existing: unknown, context: SupplyAccessContext, kind: "base" | "item") {
  return [...(Array.isArray(existing) ? existing : []), ...managedSource(context, kind)];
}

export async function getSupplyWorkspaceManagement(context: SupplyAccessContext, workspaceId: string) {
  await requireSupplyWorkspace(context, workspaceId, "view");
  const workspace = await prisma.supplyWorkspace.findFirst({
    where: { id: workspaceId, officeId: context.officeId, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      company: { select: { id: true, name: true, website: true } },
      snapshots: {
        where: { status: "PUBLISHED" },
        orderBy: { version: "desc" },
        take: 1,
        select: {
          version: true,
          locations: {
            where: { locationKey: CUSTOMER_BASE_LOCATION_KEY },
            take: 1,
            select: { name: true, addressLine: true, city: true, region: true, postalCode: true, countryCode: true, sourceRefs: true },
          },
        },
      },
    },
  });
  if (!workspace?.company) throw new SupplyPersistenceError("Company workspace not found.", "not_found");
  const baseRecord = workspace.snapshots[0]?.locations[0] ?? null;
  const base = baseRecord ? {
    name: baseRecord.name,
    addressLine: baseRecord.addressLine,
    city: baseRecord.city,
    region: baseRecord.region,
    postalCode: baseRecord.postalCode,
    countryCode: baseRecord.countryCode,
  } : null;
  return {
    workspaceId: workspace.id,
    companyName: workspace.company.name,
    website: workspace.company.website,
    snapshotVersion: workspace.snapshots[0]?.version ?? null,
    base,
    logisticsReady: customerBaseIsReady(base) && customerBaseHasManagedProvenance(baseRecord?.sourceRefs),
  };
}

export async function updateSupplyWorkspaceManagement(
  context: SupplyAccessContext,
  workspaceId: string,
  input: { base: CustomerBaseInput },
) {
  const workspace = await requireSupplyWorkspace(context, workspaceId, "edit");
  if (!workspace.companyId) throw new SupplyPersistenceError("This workspace is not linked to a company.", "conflict");
  const base = normalizeCustomerBase(input.base);
  const published = await latestPublishedSnapshotForParts(context, workspaceId);
  const normalized = published ?? emptySnapshot();
  const previousBase = normalized.locations.find((candidate) => candidate.locationKey === CUSTOMER_BASE_LOCATION_KEY);
  const location: SupplyLocationInput = {
    locationKey: CUSTOMER_BASE_LOCATION_KEY,
    name: base.name,
    kind: "FACTORY",
    addressLine: base.addressLine,
    city: base.city,
    region: base.region ?? undefined,
    postalCode: base.postalCode ?? undefined,
    countryCode: base.countryCode,
    sourceRefs: appendManagedSource(previousBase?.sourceRefs, context, "base"),
  };
  normalized.locations = [
    ...normalized.locations.filter((candidate) => candidate.locationKey !== CUSTOMER_BASE_LOCATION_KEY),
    location,
  ];
  await publishManagedRevision(context, workspaceId, "Customer logistics base", normalized);
  return getSupplyWorkspaceManagement(context, workspaceId);
}

export async function updateSupplyWorkspaceWebsite(
  context: SupplyAccessContext,
  workspaceId: string,
  input: { website?: string | null },
) {
  await requireSupplyWorkspace(context, workspaceId, "edit");
  const rawWebsite = input.website?.trim() || null;
  const website = normalizeCustomerWebsite(rawWebsite);
  if (rawWebsite && !website) throw new SupplyPersistenceError("Enter a public company website.", "invalid_input");
  const domain = website ? customerDomain(website) : null;
  const externalKey = domain ? `company:${domain}` : null;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${`customer-workspace-settings:${context.officeId}:${workspaceId}`}, 0))
    `;
    const workspace = await tx.supplyWorkspace.findFirst({
      where: { id: workspaceId, officeId: context.officeId, status: "ACTIVE" },
      select: { id: true, companyId: true },
    });
    if (!workspace?.companyId) throw new SupplyPersistenceError("Company workspace not found.", "not_found");
    const [companyConflict, workspaceConflict] = await Promise.all([
      domain
        ? tx.company.findFirst({
            where: { officeId: context.officeId, id: { not: workspace.companyId }, domain: { equals: domain, mode: "insensitive" } },
            select: { id: true },
          })
        : null,
      externalKey
        ? tx.supplyWorkspace.findFirst({
            where: { officeId: context.officeId, id: { not: workspace.id }, externalKey },
            select: { id: true },
          })
        : null,
    ]);
    if (companyConflict || workspaceConflict) {
      throw new SupplyPersistenceError("Another company already uses that website.", "conflict");
    }
    await tx.company.updateMany({
      where: { id: workspace.companyId, officeId: context.officeId },
      data: { website, domain },
    });
    await tx.supplyWorkspace.updateMany({
      where: { id: workspace.id, officeId: context.officeId },
      data: { externalKey, version: { increment: 1 } },
    });
  });
  return getSupplyWorkspaceManagement(context, workspaceId);
}

function normalizeManagedItem(input: ManagedSupplyItemInput) {
  const name = text(input.name, 200);
  const unitOfMeasure = text(input.unitOfMeasure, 24).toUpperCase();
  const requestedQuantity = input.requestedQuantity === null || input.requestedQuantity === undefined
    ? null
    : Number(input.requestedQuantity);
  if (!name || !unitOfMeasure) throw new SupplyPersistenceError("Item name and unit are required.", "invalid_input");
  if (requestedQuantity !== null && (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0)) {
    throw new SupplyPersistenceError("Requested quantity must be greater than zero.", "invalid_input");
  }
  const needByDate = text(input.needByDate, 10) || null;
  if (needByDate && !validCalendarDate(needByDate)) {
    throw new SupplyPersistenceError("Need-by date must use YYYY-MM-DD.", "invalid_input");
  }
  return {
    name,
    description: text(input.description, 2_000) || null,
    manufacturer: text(input.manufacturer, 160) || null,
    mpn: text(input.mpn, 160) || null,
    unitOfMeasure,
    requestedQuantity,
    requestedUnit: text(input.requestedUnit, 24).toUpperCase() || unitOfMeasure,
    supplierDeliverable: text(input.supplierDeliverable, 1_000) || null,
    deliveryLocation: text(input.deliveryLocation, 240) || null,
    needByDate,
  };
}

export async function updateManagedSupplyItem(
  context: SupplyAccessContext,
  workspaceId: string,
  itemKey: string,
  input: ManagedSupplyItemInput,
) {
  await requireSupplyWorkspace(context, workspaceId, "edit");
  const normalized = await latestPublishedSnapshotForParts(context, workspaceId);
  if (!normalized) throw new SupplyPersistenceError("Published sourcing item not found.", "not_found");
  const index = normalized.items.findIndex((item) => item.itemKey === itemKey);
  if (index < 0) throw new SupplyPersistenceError("Published sourcing item not found.", "not_found");
  const update = normalizeManagedItem(input);
  const current = normalized.items[index]!;
  const item: SupplyItemInput = {
    ...current,
    name: update.name,
    description: update.description ?? undefined,
    manufacturer: update.manufacturer ?? undefined,
    mpn: update.mpn ?? undefined,
    unitOfMeasure: update.unitOfMeasure,
    sourceRefs: appendManagedSource(current.sourceRefs, context, "item"),
    request: {
      source: "PARTS_CSV",
      rawQuantity: update.requestedQuantity === null ? null : String(update.requestedQuantity),
      quantity: update.requestedQuantity,
      unitOfMeasure: update.requestedUnit,
      supplierDeliverable: update.supplierDeliverable,
      deliveryLocation: update.deliveryLocation,
      needByDate: update.needByDate,
    },
  };
  normalized.items[index] = item;
  await publishManagedRevision(context, workspaceId, `Sourcing item updated: ${item.name}`, normalized);
  return { itemKey, deleted: false };
}

export function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

export async function deleteManagedSupplyItem(
  context: SupplyAccessContext,
  workspaceId: string,
  itemKey: string,
) {
  await requireSupplyWorkspace(context, workspaceId, "edit");
  const normalized = await latestPublishedSnapshotForParts(context, workspaceId);
  if (!normalized?.items.some((item) => item.itemKey === itemKey)) {
    throw new SupplyPersistenceError("Published sourcing item not found.", "not_found");
  }
  const revised = removeSupplyItemFromSnapshot(normalized, itemKey);
  await publishManagedRevision(context, workspaceId, `Sourcing item removed: ${itemKey}`, revised);
  return { itemKey, deleted: true };
}

export function removeSupplyItemFromSnapshot(normalized: NormalizedSupplyCsvBundle, itemKey: string) {
  return {
    ...normalized,
    items: normalized.items.filter((item) => item.itemKey !== itemKey),
    bom: normalized.bom.filter((line) => line.parentItemKey !== itemKey && line.componentItemKey !== itemKey),
    inventory: normalized.inventory.filter((position) => position.itemKey !== itemKey),
    demand: normalized.demand.filter((demand) => demand.itemKey !== itemKey),
    purchaseOrders: normalized.purchaseOrders.filter((order) => order.itemKey !== itemKey),
    supplierTerms: normalized.supplierTerms.filter((term) => term.itemKey !== itemKey),
    complianceRecords: normalized.complianceRecords.filter((record) => record.itemKey !== itemKey),
    snapshotSupplierTerms: normalized.snapshotSupplierTerms?.filter((term) => term.itemKey !== itemKey),
    fccProfiles: normalized.fccProfiles?.filter((profile) => profile.itemKey !== itemKey),
    mediaAssets: normalized.mediaAssets?.filter((asset) => asset.itemKey !== itemKey),
  } satisfies NormalizedSupplyCsvBundle;
}
