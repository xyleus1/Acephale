import "server-only";

import { prisma } from "@/lib/prisma";

export type CanonicalItemIdentityRow = {
  id: string;
  companyId: string;
  name: string;
  sku: string | null;
  specification: string | null;
  manufacturer: string | null;
  partNumber: string | null;
  unit: string | null;
  updatedAt: Date;
};

export type SnapshotSupplyItemIdentityRow = {
  id: string;
  workspaceId: string;
  snapshotId: string;
  itemKey: string;
  externalId: string | null;
  sku: string | null;
  manufacturer: string | null;
  mpn: string | null;
  gtin: string | null;
  name: string;
  description: string | null;
  category: string | null;
  itemType: string;
  unitOfMeasure: string;
  metadata: unknown;
  sourceRefs: unknown;
  createdAt: Date;
};

type ApprovedItemAliasRow = {
  canonicalItemKey: string;
};

export type ItemIdentityResolution = {
  status: "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS";
  canonicalItem: CanonicalItemIdentityRow | null;
  supplyItem: SnapshotSupplyItemIdentityRow | null;
  method:
    | "ITEM_KEY_ONLY"
    | "EXPLICIT_SCOPED_ITEM_KEY"
    | "EXACT_CANONICAL_IDENTIFIER"
    | "APPROVED_ALIAS"
    | "NONE";
  reason: string;
  candidateItemKeys: string[];
};

export type ItemIdentityResolverDependencies = {
  findCanonicalItem(input: {
    officeId: string;
    companyId: string;
    itemId: string;
  }): Promise<CanonicalItemIdentityRow | null>;
  findApprovedAliases(input: {
    officeId: string;
    workspaceId: string;
    normalizedValues: string[];
  }): Promise<ApprovedItemAliasRow[]>;
  findSnapshotItems(input: {
    officeId: string;
    workspaceId: string;
    snapshotId: string;
    itemKeys: string[];
    identifiers: string[];
  }): Promise<SnapshotSupplyItemIdentityRow[]>;
};

const supplyItemIdentitySelect = {
  id: true,
  workspaceId: true,
  snapshotId: true,
  itemKey: true,
  externalId: true,
  sku: true,
  manufacturer: true,
  mpn: true,
  gtin: true,
  name: true,
  description: true,
  category: true,
  itemType: true,
  unitOfMeasure: true,
  metadata: true,
  sourceRefs: true,
  createdAt: true,
} as const;

const defaultDependencies: ItemIdentityResolverDependencies = {
  findCanonicalItem: ({ officeId, companyId, itemId }) => prisma.item.findFirst({
    where: { id: itemId, officeId, companyId },
    select: {
      id: true,
      companyId: true,
      name: true,
      sku: true,
      specification: true,
      manufacturer: true,
      partNumber: true,
      unit: true,
      updatedAt: true,
    },
  }),
  findApprovedAliases: ({ officeId, workspaceId, normalizedValues }) => (
    normalizedValues.length
      ? prisma.supplyItemAlias.findMany({
          where: {
            officeId,
            workspaceId,
            isActive: true,
            approvedAt: { not: null },
            normalizedValue: { in: normalizedValues },
          },
          orderBy: [{ canonicalItemKey: "asc" }, { id: "asc" }],
          take: 25,
          select: { canonicalItemKey: true },
        })
      : Promise.resolve([])
  ),
  findSnapshotItems: ({ officeId, workspaceId, snapshotId, itemKeys, identifiers }) => {
    const directIdentifierFilters = identifiers.flatMap((identifier) => ([
      { itemKey: { equals: identifier, mode: "insensitive" as const } },
      { externalId: { equals: identifier, mode: "insensitive" as const } },
      { sku: { equals: identifier, mode: "insensitive" as const } },
      { mpn: { equals: identifier, mode: "insensitive" as const } },
    ]));
    const exactKeyFilters = itemKeys.map((itemKey) => ({ itemKey }));
    const filters = [...exactKeyFilters, ...directIdentifierFilters];
    if (!filters.length) return Promise.resolve([]);
    return prisma.supplyItem.findMany({
      where: {
        officeId,
        workspaceId,
        snapshotId,
        OR: filters,
      },
      orderBy: [{ itemKey: "asc" }, { id: "asc" }],
      take: 26,
      select: supplyItemIdentitySelect,
    });
  },
};

export function normalizeItemIdentityValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function exactCanonicalIdentityMatch(
  canonicalItem: CanonicalItemIdentityRow,
  supplyItem: SnapshotSupplyItemIdentityRow,
) {
  const canonicalSku = normalizeItemIdentityValue(canonicalItem.sku);
  const canonicalPart = normalizeItemIdentityValue(canonicalItem.partNumber);
  const snapshotSkuIdentifiers = [
    supplyItem.itemKey,
    supplyItem.externalId,
    supplyItem.sku,
  ].map(normalizeItemIdentityValue).filter(Boolean);
  if (canonicalSku && snapshotSkuIdentifiers.includes(canonicalSku)) return true;
  if (canonicalPart && [supplyItem.itemKey, supplyItem.externalId]
    .map(normalizeItemIdentityValue).filter(Boolean).includes(canonicalPart)) return true;
  const canonicalManufacturer = normalizeItemIdentityValue(canonicalItem.manufacturer);
  const snapshotManufacturer = normalizeItemIdentityValue(supplyItem.manufacturer);
  return Boolean(
    canonicalPart
    && canonicalManufacturer
    && canonicalManufacturer === snapshotManufacturer
    && canonicalPart === normalizeItemIdentityValue(supplyItem.mpn),
  );
}

/**
 * Public itemId values always identify app-owned Item rows. Snapshot-owned
 * SupplyItem ids are never accepted as public item ids. Mapping is either an
 * explicit scoped itemKey, a unique exact identifier, or an approved alias.
 * Similar names and ambiguous exact matches fail closed.
 */
export async function resolveSnapshotItemIdentity(args: {
  officeId: string;
  companyId: string;
  workspaceId: string;
  snapshotId: string;
  itemId?: string | null;
  itemKey?: string | null;
  canonicalItem?: CanonicalItemIdentityRow | null;
}, dependencies: ItemIdentityResolverDependencies = defaultDependencies): Promise<ItemIdentityResolution> {
  const requestedItemId = args.itemId?.trim() || null;
  const requestedItemKey = args.itemKey?.trim() || null;
  const canonicalItem = requestedItemId
    ? ("canonicalItem" in args ? args.canonicalItem ?? null : await dependencies.findCanonicalItem({
        officeId: args.officeId,
        companyId: args.companyId,
        itemId: requestedItemId,
      }))
    : null;
  if (requestedItemId && !canonicalItem) {
    return {
      status: "UNRESOLVED",
      canonicalItem: null,
      supplyItem: null,
      method: "NONE",
      reason: "The canonical item is missing or outside the requested office and company.",
      candidateItemKeys: [],
    };
  }

  if (requestedItemKey) {
    const exactRows = await dependencies.findSnapshotItems({
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      snapshotId: args.snapshotId,
      itemKeys: [requestedItemKey],
      identifiers: [],
    });
    const matches = exactRows.filter((row) => row.itemKey === requestedItemKey);
    if (matches.length !== 1) {
      return {
        status: matches.length ? "AMBIGUOUS" : "UNRESOLVED",
        canonicalItem,
        supplyItem: null,
        method: "NONE",
        reason: matches.length
          ? "The scoped item key resolved to more than one current snapshot item."
          : "The scoped item key is absent from the current published snapshot.",
        candidateItemKeys: [...new Set(matches.map((row) => row.itemKey))].sort(),
      };
    }
    if (canonicalItem && !exactCanonicalIdentityMatch(canonicalItem, matches[0]!)) {
      const normalizedValues = uniqueNonEmpty([
        normalizeItemIdentityValue(canonicalItem.sku),
        normalizeItemIdentityValue(canonicalItem.partNumber),
        normalizeItemIdentityValue(canonicalItem.name),
      ]);
      const aliases = await dependencies.findApprovedAliases({
        officeId: args.officeId,
        workspaceId: args.workspaceId,
        normalizedValues,
      });
      if (!aliases.some((alias) => alias.canonicalItemKey === requestedItemKey)) {
        return {
          status: "UNRESOLVED",
          canonicalItem,
          supplyItem: null,
          method: "NONE",
          reason: "The scoped snapshot item key does not match a canonical identifier or active approved alias.",
          candidateItemKeys: [requestedItemKey],
        };
      }
      return {
        status: "RESOLVED",
        canonicalItem,
        supplyItem: matches[0]!,
        method: "APPROVED_ALIAS",
        reason: "An active approved workspace alias verifies the explicit canonical-to-snapshot item mapping.",
        candidateItemKeys: [requestedItemKey],
      };
    }
    return {
      status: "RESOLVED",
      canonicalItem,
      supplyItem: matches[0]!,
      method: canonicalItem ? "EXPLICIT_SCOPED_ITEM_KEY" : "ITEM_KEY_ONLY",
      reason: canonicalItem
        ? "The explicit snapshot item key matches an exact canonical item identifier."
        : "The caller supplied an exact workspace and snapshot item key.",
      candidateItemKeys: [matches[0]!.itemKey],
    };
  }

  if (!canonicalItem) {
    return {
      status: "UNRESOLVED",
      canonicalItem: null,
      supplyItem: null,
      method: "NONE",
      reason: "An item identity was not supplied.",
      candidateItemKeys: [],
    };
  }

  const identifiers = uniqueNonEmpty([canonicalItem.sku, canonicalItem.partNumber]);
  const normalizedValues = uniqueNonEmpty([
    ...identifiers.map(normalizeItemIdentityValue),
    normalizeItemIdentityValue(canonicalItem.name),
  ]);
  const aliases = await dependencies.findApprovedAliases({
    officeId: args.officeId,
    workspaceId: args.workspaceId,
    normalizedValues,
  });
  const aliasKeys = uniqueNonEmpty(aliases.map((alias) => alias.canonicalItemKey));
  const candidates = await dependencies.findSnapshotItems({
    officeId: args.officeId,
    workspaceId: args.workspaceId,
    snapshotId: args.snapshotId,
    itemKeys: aliasKeys,
    identifiers,
  });
  const aliasKeySet = new Set(aliasKeys);
  const matches = candidates.filter((candidate) => (
    aliasKeySet.has(candidate.itemKey) || exactCanonicalIdentityMatch(canonicalItem, candidate)
  ));
  const uniqueMatches = [...new Map(matches.map((candidate) => [candidate.id, candidate])).values()];
  if (uniqueMatches.length !== 1) {
    return {
      status: uniqueMatches.length ? "AMBIGUOUS" : "UNRESOLVED",
      canonicalItem,
      supplyItem: null,
      method: "NONE",
      reason: uniqueMatches.length
        ? "Canonical item identifiers resolve to multiple current snapshot items."
        : "No exact identifier or approved alias maps the canonical item to the current snapshot.",
      candidateItemKeys: [...new Set(uniqueMatches.map((row) => row.itemKey))].sort(),
    };
  }
  const supplyItem = uniqueMatches[0]!;
  return {
    status: "RESOLVED",
    canonicalItem,
    supplyItem,
    method: aliasKeySet.has(supplyItem.itemKey) && !exactCanonicalIdentityMatch(canonicalItem, supplyItem)
      ? "APPROVED_ALIAS"
      : "EXACT_CANONICAL_IDENTIFIER",
    reason: aliasKeySet.has(supplyItem.itemKey) && !exactCanonicalIdentityMatch(canonicalItem, supplyItem)
      ? "An active approved workspace alias maps the canonical item to the snapshot item key."
      : "A unique exact canonical identifier maps to the snapshot item.",
    candidateItemKeys: [supplyItem.itemKey],
  };
}
