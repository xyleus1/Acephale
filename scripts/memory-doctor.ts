import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  CANONICAL_MEMORY_TYPES,
  MEMORY_SOURCE_TYPES,
  getCanonicalTypeLabel,
  isAllowedCanonicalType,
  isAllowedSourceType,
  isLegacyCanonicalType,
  normalizeCanonicalType,
  normalizeSourceType,
} from "../src/lib/memory/canonical-types";

type Row = Record<string, unknown>;

function argValue(name: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function num(value: unknown) {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function printSection(title: string) {
  console.log(`\n## ${title}`);
}

function printTable(rows: Row[], columns: string[]) {
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  const widths = columns.map((column) => Math.max(
    column.length,
    ...rows.map((row) => String(row[column] ?? "").length),
  ));
  const line = columns.map((column, index) => String(column).padEnd(widths[index])).join("  ");
  console.log(line);
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(columns.map((column, index) => String(row[column] ?? "").padEnd(widths[index])).join("  "));
  }
}

function compactIds(ids: unknown) {
  if (!Array.isArray(ids)) return "";
  return ids.slice(0, 5).join(", ");
}

async function main() {
  const officeId = argValue("office");
  const whereOffice = officeId ? { officeId } : {};
  const companyOfficeSql = officeId ? Prisma.sql`WHERE c."officeId" = ${officeId}` : Prisma.empty;
  const jobOfficeSql = officeId ? Prisma.sql`WHERE j."officeId" = ${officeId}` : Prisma.empty;
  const chunkOfficeSql = officeId ? Prisma.sql`WHERE kc."officeId" = ${officeId}` : Prisma.empty;
  const andObjectOfficeSql = officeId ? Prisma.sql`AND ko."officeId" = ${officeId}` : Prisma.empty;
  const andEventOfficeSql = officeId ? Prisma.sql`AND "officeId" = ${officeId}` : Prisma.empty;
  const andMentionOfficeSql = officeId ? Prisma.sql`AND em."officeId" = ${officeId}` : Prisma.empty;
  const objectWhereOfficeSql = officeId ? Prisma.sql`WHERE "officeId" = ${officeId}` : Prisma.empty;
  const eventWhereOfficeSql = officeId ? Prisma.sql`WHERE "officeId" = ${officeId}` : Prisma.empty;

  const [
    objectCounts,
    eventCounts,
    chunkCounts,
    mentionCounts,
    objectsLinkedToCompany,
    objectsLinkedToJob,
    oldestEvent,
    newestEvent,
    topCustomers,
    topJobs,
  ] = await Promise.all([
    prisma.knowledgeObject.groupBy({
      by: ["sourceType", "canonicalType"],
      where: whereOffice,
      _count: { _all: true },
      orderBy: [{ sourceType: "asc" }, { canonicalType: "asc" }],
    }),
    prisma.memoryEvent.groupBy({
      by: ["eventType"],
      where: whereOffice,
      _count: { _all: true },
      orderBy: { eventType: "asc" },
    }),
    prisma.knowledgeChunk.groupBy({
      by: ["officeId"],
      where: whereOffice,
      _count: { _all: true },
    }),
    prisma.entityMention.groupBy({
      by: ["entityType"],
      where: whereOffice,
      _count: { _all: true },
      orderBy: { entityType: "asc" },
    }),
    prisma.knowledgeObject.count({ where: { ...whereOffice, companyId: { not: null } } }),
    prisma.knowledgeObject.count({ where: { ...whereOffice, jobId: { not: null } } }),
    prisma.memoryEvent.findFirst({ where: whereOffice, orderBy: { occurredAt: "asc" }, select: { id: true, occurredAt: true, eventType: true } }),
    prisma.memoryEvent.findFirst({ where: whereOffice, orderBy: { occurredAt: "desc" }, select: { id: true, occurredAt: true, eventType: true } }),
    prisma.$queryRaw<Row[]>`
      SELECT c."id", c."name", count(ko."id")::int AS "objects"
      FROM "Company" c
      JOIN "KnowledgeObject" ko ON ko."companyId" = c."id"
      ${companyOfficeSql}
      GROUP BY c."id", c."name"
      ORDER BY count(ko."id") DESC, c."name" ASC
      LIMIT 20
    `.catch(() => []),
    prisma.$queryRaw<Row[]>`
      SELECT j."id", j."reference", coalesce(j."title", '') AS "title", count(ko."id")::int AS "objects"
      FROM "Job" j
      JOIN "KnowledgeObject" ko ON ko."jobId" = j."id"
      ${jobOfficeSql}
      GROUP BY j."id", j."reference", j."title"
      ORDER BY count(ko."id") DESC, j."updatedAt" DESC
      LIMIT 20
    `.catch(() => []),
  ]);

  const [
    chunksBySource,
    orphanedObjects,
    missingOfficeEvents,
    missingProvenanceEvents,
    duplicateByExternalId,
    duplicateByHash,
    creationMixObjects,
    creationMixEvents,
    topOrphanedSourceTypes,
    objectsWithChunksNoMentions,
    missingEntityReferences,
  ] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT ko."sourceType", count(kc."id")::int AS "chunks"
      FROM "KnowledgeChunk" kc
      JOIN "KnowledgeObject" ko ON ko."id" = kc."objectId"
      ${chunkOfficeSql}
      GROUP BY ko."sourceType"
      ORDER BY count(kc."id") DESC, ko."sourceType" ASC
    `.catch(() => []),
    prisma.$queryRaw<Row[]>`
      SELECT count(ko."id")::int AS "count"
      FROM "KnowledgeObject" ko
      LEFT JOIN "EntityMention" em ON em."objectId" = ko."id"
      WHERE em."id" IS NULL
      ${andObjectOfficeSql}
    `.catch(() => [{ count: 0 }]),
    prisma.$queryRaw<Row[]>`
      SELECT count(*)::int AS "count" FROM "MemoryEvent" WHERE "officeId" IS NULL
    `.catch(() => [{ count: 0 }]),
    prisma.$queryRaw<Row[]>`
      SELECT count(*)::int AS "count"
      FROM "MemoryEvent"
      WHERE ("provenance" IS NULL OR "provenance"::text IN ('null', '{}'))
      ${andEventOfficeSql}
    `.catch(() => [{ count: 0 }]),
    prisma.$queryRaw<Row[]>`
      SELECT "officeId", "sourceType", "sourceExternalId", count(*)::int AS "count", array_agg("id" ORDER BY "createdAt" DESC) AS "ids"
      FROM "KnowledgeObject"
      WHERE "sourceExternalId" IS NOT NULL
      ${andEventOfficeSql}
      GROUP BY "officeId", "sourceType", "sourceExternalId"
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 20
    `.catch(() => []),
    prisma.$queryRaw<Row[]>`
      SELECT "officeId", "contentHash", count(*)::int AS "count", array_agg("id" ORDER BY "createdAt" DESC) AS "ids"
      FROM "KnowledgeObject"
      WHERE "contentHash" IS NOT NULL
      ${andEventOfficeSql}
      GROUP BY "officeId", "contentHash"
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 20
    `.catch(() => []),
    prisma.$queryRaw<Row[]>`
      SELECT
        CASE
          WHEN "provenance"->>'source' = 'company_brain_backfill' OR coalesce("provenance"->>'operation', '') LIKE 'backfill_%' THEN 'backfill'
          ELSE 'live'
        END AS "origin",
        count(*)::int AS "objects"
      FROM "KnowledgeObject"
      ${objectWhereOfficeSql}
      GROUP BY 1
      ORDER BY 1
    `.catch(() => []),
    prisma.$queryRaw<Row[]>`
      SELECT
        CASE
          WHEN coalesce("idempotencyKey", '') LIKE 'backfill:%' OR "provenance"->>'source' = 'company_brain_backfill' OR coalesce("provenance"->>'operation', '') LIKE 'backfill_%' THEN 'backfill'
          ELSE 'live'
        END AS "origin",
        count(*)::int AS "events"
      FROM "MemoryEvent"
      ${eventWhereOfficeSql}
      GROUP BY 1
      ORDER BY 1
    `.catch(() => []),
    prisma.$queryRaw<Row[]>`
      SELECT ko."sourceType", ko."canonicalType", count(ko."id")::int AS "objects"
      FROM "KnowledgeObject" ko
      LEFT JOIN "EntityMention" em ON em."objectId" = ko."id"
      WHERE em."id" IS NULL
      ${andObjectOfficeSql}
      GROUP BY ko."sourceType", ko."canonicalType"
      ORDER BY count(ko."id") DESC, ko."sourceType" ASC, ko."canonicalType" ASC
      LIMIT 20
    `.catch(() => []),
    prisma.$queryRaw<Row[]>`
      SELECT count(DISTINCT ko."id")::int AS "count"
      FROM "KnowledgeObject" ko
      JOIN "KnowledgeChunk" kc ON kc."objectId" = ko."id"
      LEFT JOIN "EntityMention" em ON em."objectId" = ko."id"
      WHERE em."id" IS NULL
      ${andObjectOfficeSql}
    `.catch(() => [{ count: 0 }]),
    prisma.$queryRaw<Row[]>`
      SELECT em."entityType", count(em."id")::int AS "mentions"
      FROM "EntityMention" em
      LEFT JOIN "Company" c ON em."entityType" = 'company' AND c."id" = em."entityId"
      LEFT JOIN "Job" j ON em."entityType" = 'job' AND j."id" = em."entityId"
      LEFT JOIN "Inquiry" i ON em."entityType" = 'inquiry' AND i."id" = em."entityId"
      LEFT JOIN "Contact" ct ON em."entityType" = 'contact' AND ct."id" = em."entityId"
      LEFT JOIN "EmailThread" et ON em."entityType" = 'email_thread' AND et."id" = em."entityId"
      LEFT JOIN "EmailMessage" msg ON em."entityType" = 'email_message' AND msg."id" = em."entityId"
      LEFT JOIN "JobDocument" jd ON em."entityType" = 'job_document' AND jd."id" = em."entityId"
      LEFT JOIN "StrategyAssessment" sa ON em."entityType" = 'strategy_assessment' AND sa."id" = em."entityId"
      LEFT JOIN "AgentProposal" ap ON em."entityType" = 'agent_proposal' AND ap."id" = em."entityId"
      WHERE (
        (em."entityType" = 'company' AND c."id" IS NULL) OR
        (em."entityType" = 'job' AND j."id" IS NULL) OR
        (em."entityType" = 'inquiry' AND i."id" IS NULL) OR
        (em."entityType" = 'contact' AND ct."id" IS NULL) OR
        (em."entityType" = 'email_thread' AND et."id" IS NULL) OR
        (em."entityType" = 'email_message' AND msg."id" IS NULL) OR
        (em."entityType" = 'job_document' AND jd."id" IS NULL) OR
        (em."entityType" = 'strategy_assessment' AND sa."id" IS NULL) OR
        (em."entityType" = 'agent_proposal' AND ap."id" IS NULL)
      )
      ${andMentionOfficeSql}
      GROUP BY em."entityType"
      ORDER BY count(em."id") DESC, em."entityType" ASC
    `.catch(() => []),
  ]);

  const canonicalDistribution = objectCounts.reduce((map, row) => {
    const key = row.canonicalType;
    map.set(key, (map.get(key) ?? 0) + row._count._all);
    return map;
  }, new Map<string, number>());
  const sourceDistribution = objectCounts.reduce((map, row) => {
    const key = row.sourceType;
    map.set(key, (map.get(key) ?? 0) + row._count._all);
    return map;
  }, new Map<string, number>());
  const canonicalQualityRows = [...canonicalDistribution.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([canonicalType, count]) => {
      const normalized = normalizeCanonicalType(canonicalType);
      const allowed = isAllowedCanonicalType(canonicalType);
      const legacy = isLegacyCanonicalType(canonicalType);
      return {
        canonicalType,
        normalized,
        label: getCanonicalTypeLabel(canonicalType),
        status: legacy ? "legacy" : allowed ? "allowed" : "unknown",
        count,
      };
    });
  const sourceQualityRows = [...sourceDistribution.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sourceType, count]) => {
      const normalized = normalizeSourceType(sourceType);
      return {
        sourceType,
        normalized,
        status: isAllowedSourceType(sourceType) ? "allowed" : "unknown",
        count,
      };
    });
  const totalObjects = objectCounts.reduce((sum, row) => sum + row._count._all, 0);
  const totalChunks = chunksBySource.reduce((sum, row) => sum + num(row.chunks), 0);
  const totalDuplicateExternalIds = duplicateByExternalId.reduce((sum, row) => sum + num(row.count), 0);
  const totalDuplicateHashes = duplicateByHash.reduce((sum, row) => sum + num(row.count), 0);
  const unknownCanonicalCount = canonicalQualityRows.filter((row) => row.status === "unknown").reduce((sum, row) => sum + Number(row.count), 0);
  const legacyCanonicalCount = canonicalQualityRows.filter((row) => row.status === "legacy").reduce((sum, row) => sum + Number(row.count), 0);

  console.log("Company Brain Memory Doctor");
  console.log(`Scope: ${officeId ?? "all offices"}`);
  console.log(`Generated: ${new Date().toISOString()}`);

  printSection("KnowledgeObjects by source/canonical type");
  printTable(objectCounts.map((row) => ({
    sourceType: row.sourceType,
    canonicalType: row.canonicalType,
    count: row._count._all,
  })), ["sourceType", "canonicalType", "count"]);

  printSection("Canonical type quality");
  printTable(canonicalQualityRows, ["canonicalType", "normalized", "label", "status", "count"]);

  printSection("Unknown canonical types");
  printTable(canonicalQualityRows.filter((row) => row.status === "unknown"), ["canonicalType", "normalized", "count"]);

  printSection("Legacy canonical types");
  printTable(canonicalQualityRows.filter((row) => row.status === "legacy"), ["canonicalType", "normalized", "count"]);

  printSection("Source type distribution");
  printTable(sourceQualityRows, ["sourceType", "normalized", "status", "count"]);

  printSection("MemoryEvents by event type");
  printTable(eventCounts.map((row) => ({ eventType: row.eventType, count: row._count._all })), ["eventType", "count"]);

  printSection("KnowledgeChunks by source type");
  printTable(chunksBySource, ["sourceType", "chunks"]);
  if (chunksBySource.length === 0 && chunkCounts.length > 0) {
    printTable(chunkCounts.map((row) => ({ officeId: row.officeId, chunks: row._count._all })), ["officeId", "chunks"]);
  }

  printSection("EntityMentions by entity type");
  printTable(mentionCounts.map((row) => ({ entityType: row.entityType, count: row._count._all })), ["entityType", "count"]);

  printSection("Link health");
  printTable([
    { metric: "objects linked to Company", value: objectsLinkedToCompany },
    { metric: "objects linked to Job", value: objectsLinkedToJob },
    { metric: "orphaned objects with no entity mention", value: num(orphanedObjects[0]?.count) },
    { metric: "objects with chunks but no entity mention", value: num(objectsWithChunksNoMentions[0]?.count) },
    { metric: "events missing officeId", value: num(missingOfficeEvents[0]?.count) },
    { metric: "events missing provenance", value: num(missingProvenanceEvents[0]?.count) },
  ], ["metric", "value"]);

  printSection("Top orphaned source/canonical types");
  printTable(topOrphanedSourceTypes, ["sourceType", "canonicalType", "objects"]);

  printSection("EntityMentions pointing to missing entities");
  printTable(missingEntityReferences, ["entityType", "mentions"]);

  printSection("Duplicate KnowledgeObjects by sourceExternalId");
  printTable(duplicateByExternalId.map((row) => ({
    officeId: row.officeId,
    sourceType: row.sourceType,
    sourceExternalId: row.sourceExternalId,
    count: row.count,
    ids: compactIds(row.ids),
  })), ["officeId", "sourceType", "sourceExternalId", "count", "ids"]);

  printSection("Duplicate KnowledgeObjects by contentHash");
  printTable(duplicateByHash.map((row) => ({
    officeId: row.officeId,
    contentHash: String(row.contentHash ?? "").slice(0, 16),
    count: row.count,
    ids: compactIds(row.ids),
  })), ["officeId", "contentHash", "count", "ids"]);

  printSection("Backfill vs live");
  printTable(creationMixObjects, ["origin", "objects"]);
  printTable(creationMixEvents, ["origin", "events"]);

  printSection("MemoryEvent time range");
  printTable([
    { edge: "oldest", eventType: oldestEvent?.eventType ?? "(none)", timestamp: oldestEvent?.occurredAt?.toISOString() ?? "" },
    { edge: "newest", eventType: newestEvent?.eventType ?? "(none)", timestamp: newestEvent?.occurredAt?.toISOString() ?? "" },
  ], ["edge", "eventType", "timestamp"]);

  printSection("Top 20 customers by memory volume");
  printTable(topCustomers, ["id", "name", "objects"]);

  printSection("Top 20 jobs by memory volume");
  printTable(topJobs, ["id", "reference", "title", "objects"]);

  printSection("Search index readiness");
  printTable([
    { metric: "allowed canonical taxonomy size", value: CANONICAL_MEMORY_TYPES.length },
    { metric: "allowed source taxonomy size", value: MEMORY_SOURCE_TYPES.length },
    { metric: "total KnowledgeObjects", value: totalObjects },
    { metric: "total KnowledgeChunks", value: totalChunks },
    { metric: "unknown canonical rows", value: unknownCanonicalCount },
    { metric: "legacy canonical rows", value: legacyCanonicalCount },
    { metric: "events missing provenance", value: num(missingProvenanceEvents[0]?.count) },
    { metric: "duplicate source ids", value: totalDuplicateExternalIds },
    { metric: "duplicate content hashes", value: totalDuplicateHashes },
  ], ["metric", "value"]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
