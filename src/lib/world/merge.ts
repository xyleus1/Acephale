import { Prisma, type PrismaClient } from "../../generated/world-client";

type MergeCounters = {
  matchedByLei: number;
  matchedByDomain: number;
  matchedByName: number;
  inserted: number;
};

type MatchCounts = {
  matchedByLei: bigint;
  matchedByDomain: bigint;
  matchedByName: bigint;
};

function sourceFilter(source?: string) {
  return source ? Prisma.sql`AND "source" = ${source}` : Prisma.empty;
}

function matchCte(batchSize: number, source?: string) {
  return Prisma.sql`
    WITH batch AS (
      SELECT "id", "lei", "domain", "country", "nameNormalized"
      FROM "world_source_record"
      WHERE "merged" = false
        AND "companyId" IS NULL
        ${sourceFilter(source)}
      ORDER BY "id"
      LIMIT ${batchSize}
    ),
    name_candidates AS (
      SELECT c."country", c."nameNormalized", min(c."id") AS company_id, count(*) AS n
      FROM "world_company" c
      JOIN (
        SELECT DISTINCT "country", "nameNormalized"
        FROM batch
        WHERE "country" IS NOT NULL AND "nameNormalized" <> ''
      ) names
        ON names."country" = c."country"
        AND names."nameNormalized" = c."nameNormalized"
      WHERE c."nameNormalized" <> ''
      GROUP BY c."country", c."nameNormalized"
      HAVING count(*) = 1
    ),
    candidates AS (
      SELECT r."id" AS record_id, c."id" AS company_id, 1 AS match_priority, 'lei' AS match_kind
      FROM batch r
      JOIN "world_company" c ON r."lei" IS NOT NULL AND c."lei" = r."lei"
      UNION ALL
      SELECT r."id", c."id", 2, 'domain'
      FROM batch r
      JOIN "world_company" c ON r."domain" IS NOT NULL AND c."domain" = r."domain"
      WHERE NOT EXISTS (
        SELECT 1 FROM "world_company" c_lei
        WHERE r."lei" IS NOT NULL AND c_lei."lei" = r."lei"
      )
      UNION ALL
      SELECT r."id", n.company_id, 3, 'name'
      FROM batch r
      JOIN name_candidates n
        ON n."country" = r."country"
        AND n."nameNormalized" = r."nameNormalized"
      WHERE r."country" IS NOT NULL
        AND r."nameNormalized" <> ''
        AND NOT EXISTS (
          SELECT 1 FROM "world_company" c_lei
          WHERE r."lei" IS NOT NULL AND c_lei."lei" = r."lei"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "world_company" c_domain
          WHERE r."domain" IS NOT NULL AND c_domain."domain" = r."domain"
        )
    ),
    matched AS (
      SELECT
        DISTINCT ON (record_id)
        record_id, company_id, match_kind
      FROM candidates
      ORDER BY record_id, match_priority
    )
  `;
}

async function applyMatches(client: PrismaClient, batchSize: number, source?: string): Promise<MatchCounts> {
  return client.$transaction(async (tx) => {
    const counts = await tx.$queryRaw<MatchCounts[]>(Prisma.sql`
      ${matchCte(batchSize, source)}
      SELECT
        count(*) FILTER (WHERE match_kind = 'lei') AS "matchedByLei",
        count(*) FILTER (WHERE match_kind = 'domain') AS "matchedByDomain",
        count(*) FILTER (WHERE match_kind = 'name') AS "matchedByName"
      FROM matched
    `);
    await tx.$executeRaw(Prisma.sql`
      ${matchCte(batchSize, source)}
      , aggregates AS (
        SELECT
          "company_id",
          count(*) AS source_count,
          bool_or(r."isManufacturer") AS has_manufacturer,
          (array_agg(r."lei" ORDER BY r."id") FILTER (WHERE r."lei" IS NOT NULL))[1] AS first_lei,
          (array_agg(r."domain" ORDER BY r."id") FILTER (WHERE r."domain" IS NOT NULL))[1] AS first_domain,
          (array_agg(r."name" ORDER BY r."id"))[1] AS first_name,
          (array_agg(r."country" ORDER BY r."id"))[1] AS first_country,
          (array_agg(r."region" ORDER BY r."id"))[1] AS first_region,
          (array_agg(r."city" ORDER BY r."id"))[1] AS first_city,
          (array_agg(r."postalCode" ORDER BY r."id"))[1] AS first_postal_code,
          (array_agg(r."addressLine" ORDER BY r."id"))[1] AS first_address_line,
          (array_agg(r."sizeBand" ORDER BY r."id"))[1] AS first_size_band,
          (array_agg(r."foundedYear" ORDER BY r."id"))[1] AS first_founded_year,
          (array_agg(r."linkedinUrl" ORDER BY r."id"))[1] AS first_linkedin_url,
          (array_agg(r."website" ORDER BY r."id"))[1] AS first_website,
          (array_agg(r."entityStatus" ORDER BY r."id"))[1] AS first_entity_status
        FROM matched m
        JOIN "world_source_record" r ON r."id" = m.record_id
        GROUP BY "company_id"
      ),
      unique_aggregates AS (
        SELECT
          a.*,
          CASE
            WHEN a.first_lei IS NOT NULL
              AND count(*) FILTER (WHERE a.first_lei IS NOT NULL) OVER (PARTITION BY a.first_lei) = 1
            THEN a.first_lei
          END AS unique_lei,
          CASE
            WHEN a.first_domain IS NOT NULL
              AND count(*) FILTER (WHERE a.first_domain IS NOT NULL) OVER (PARTITION BY a.first_domain) = 1
            THEN a.first_domain
          END AS unique_domain
        FROM aggregates a
      )
      UPDATE "world_company" c
      SET
        "lei" = CASE
          WHEN c."lei" IS NULL
            AND a.unique_lei IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "world_company" o
              WHERE o."lei" = a.unique_lei AND o."id" <> c."id"
            )
          THEN a.unique_lei
          ELSE c."lei"
        END,
        "domain" = CASE
          WHEN c."domain" IS NULL
            AND a.unique_domain IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "world_company" o
              WHERE o."domain" = a.unique_domain AND o."id" <> c."id"
            )
          THEN a.unique_domain
          ELSE c."domain"
        END,
        "canonicalName" = COALESCE(c."canonicalName", a.first_name),
        "country" = COALESCE(c."country", a.first_country),
        "region" = COALESCE(c."region", a.first_region),
        "city" = COALESCE(c."city", a.first_city),
        "postalCode" = COALESCE(c."postalCode", a.first_postal_code),
        "addressLine" = COALESCE(c."addressLine", a.first_address_line),
        "sizeBand" = COALESCE(c."sizeBand", a.first_size_band),
        "foundedYear" = COALESCE(c."foundedYear", a.first_founded_year),
        "linkedinUrl" = COALESCE(c."linkedinUrl", a.first_linkedin_url),
        "website" = COALESCE(c."website", a.first_website),
        "entityStatus" = COALESCE(c."entityStatus", a.first_entity_status),
        "isManufacturer" = c."isManufacturer" OR a.has_manufacturer,
        "sourceCount" = c."sourceCount" + a.source_count,
        "legalIds" = (
          CASE WHEN jsonb_typeof(c."legalIds") = 'object' THEN c."legalIds" ELSE '{}'::jsonb END
        ) || COALESCE((
          SELECT jsonb_object_agg(item.key, item.value)
          FROM matched m2
          JOIN "world_source_record" r2 ON r2."id" = m2.record_id
          CROSS JOIN LATERAL jsonb_each(
            CASE WHEN jsonb_typeof(r2."legalIds") = 'object' THEN r2."legalIds" ELSE '{}'::jsonb END
          ) item
          WHERE m2."company_id" = c."id"
        ), '{}'::jsonb),
        "industryCodes" = (
          CASE WHEN jsonb_typeof(c."industryCodes") = 'object' THEN c."industryCodes" ELSE '{}'::jsonb END
        ) || COALESCE((
          SELECT jsonb_object_agg(item.key, item.value)
          FROM matched m2
          JOIN "world_source_record" r2 ON r2."id" = m2.record_id
          CROSS JOIN LATERAL jsonb_each(
            CASE WHEN jsonb_typeof(r2."industryCodes") = 'object' THEN r2."industryCodes" ELSE '{}'::jsonb END
          ) item
          WHERE m2."company_id" = c."id"
        ), '{}'::jsonb),
        "manufacturerEvidence" = (
          CASE WHEN jsonb_typeof(c."manufacturerEvidence") = 'array' THEN c."manufacturerEvidence" ELSE '[]'::jsonb END
        ) || COALESCE((
          SELECT jsonb_agg(evidence)
          FROM matched m2
          JOIN "world_source_record" r2 ON r2."id" = m2.record_id
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(r2."manufacturerEvidence") = 'array' THEN r2."manufacturerEvidence" ELSE '[]'::jsonb END
          ) evidence
          WHERE m2."company_id" = c."id"
        ), '[]'::jsonb)
      FROM unique_aggregates a
      WHERE c."id" = a."company_id"
    `);
    await tx.$executeRaw(Prisma.sql`
      ${matchCte(batchSize, source)}
      UPDATE "world_source_record" r
      SET "companyId" = matched.company_id, "merged" = true
      FROM matched
      WHERE r."id" = matched.record_id
    `);
    return counts[0] ?? { matchedByLei: 0n, matchedByDomain: 0n, matchedByName: 0n };
  });
}

async function insertUnmatched(client: PrismaClient, batchSize: number, source?: string) {
  return client.$queryRaw<{ inserted: bigint }[]>(Prisma.sql`
    WITH eligible AS MATERIALIZED (
      SELECT *
      FROM "world_source_record"
      WHERE "merged" = false
        AND "companyId" IS NULL
        ${sourceFilter(source)}
      ORDER BY "id"
      LIMIT ${batchSize}
    ),
    by_lei AS MATERIALIZED (
      SELECT DISTINCT ON ("lei")
        gen_random_uuid()::text AS new_id, *
      FROM eligible
      WHERE "lei" IS NOT NULL
      ORDER BY "lei", "id"
    ),
    remaining_domain AS MATERIALIZED (
      SELECT DISTINCT ON ("domain")
        gen_random_uuid()::text AS new_id, *
      FROM eligible e
      WHERE "domain" IS NOT NULL
        AND e."lei" IS NULL
        AND NOT EXISTS (SELECT 1 FROM by_lei l WHERE l."domain" = e."domain")
        AND NOT EXISTS (
          SELECT 1 FROM by_lei l
          WHERE l."country" = e."country"
            AND l."nameNormalized" <> ''
            AND l."nameNormalized" = e."nameNormalized"
        )
      ORDER BY "domain", "id"
    ),
    remaining_name AS MATERIALIZED (
      SELECT DISTINCT ON ("country", "nameNormalized")
        gen_random_uuid()::text AS new_id, *
      FROM eligible e
      WHERE "country" IS NOT NULL
        AND e."lei" IS NULL
        AND e."domain" IS NULL
        AND e."nameNormalized" <> ''
        AND NOT EXISTS (
          SELECT 1 FROM by_lei l
          WHERE l."country" = e."country"
            AND l."nameNormalized" <> ''
            AND l."nameNormalized" = e."nameNormalized"
        )
        AND NOT EXISTS (
          SELECT 1 FROM remaining_domain d
          WHERE d."country" = e."country" AND d."nameNormalized" = e."nameNormalized"
        )
      ORDER BY "country", "nameNormalized", "id"
    ),
    no_key AS MATERIALIZED (
      SELECT gen_random_uuid()::text AS new_id, e.*
      FROM eligible e
      WHERE e."lei" IS NULL
        AND e."domain" IS NULL
        AND (e."country" IS NULL OR e."nameNormalized" = '')
        AND NOT EXISTS (SELECT 1 FROM by_lei l WHERE l."id" = e."id")
        AND NOT EXISTS (SELECT 1 FROM remaining_domain d WHERE d."id" = e."id")
        AND NOT EXISTS (SELECT 1 FROM remaining_name n WHERE n."id" = e."id")
    ),
    chosen AS MATERIALIZED (
      SELECT * FROM by_lei
      UNION ALL SELECT * FROM remaining_domain
      UNION ALL SELECT * FROM remaining_name
      UNION ALL SELECT * FROM no_key
    ),
    inserted AS (
      INSERT INTO "world_company" (
        "id", "canonicalName", "nameNormalized", "domain", "lei", "country", "region",
        "city", "postalCode", "addressLine", "legalIds", "industryCodes", "isManufacturer",
        "manufacturerEvidence", "sizeBand", "foundedYear", "linkedinUrl", "website",
        "entityStatus", "sourceCount", "createdAt", "updatedAt"
      )
      SELECT
        "new_id", "name", "nameNormalized", "domain", "lei", "country", "region",
        "city", "postalCode", "addressLine", "legalIds", "industryCodes", "isManufacturer",
        "manufacturerEvidence", "sizeBand", "foundedYear", "linkedinUrl", "website",
        "entityStatus", 1, now(), now()
      FROM chosen
      RETURNING "id"
    ),
    linked AS (
      UPDATE "world_source_record" r
      SET "companyId" = c."new_id", "merged" = true
      FROM chosen c
      JOIN inserted i ON i."id" = c."new_id"
      WHERE r."id" = c."id"
      RETURNING r."id"
    )
    SELECT count(*) AS inserted FROM inserted
  `);
}

export async function mergeSourceRecords(args: {
  client: PrismaClient;
  source?: string;
  batchSize?: number;
}): Promise<MergeCounters> {
  const batchSize = args.batchSize ?? 50_000;
  const counters: MergeCounters = { matchedByLei: 0, matchedByDomain: 0, matchedByName: 0, inserted: 0 };
  while (true) {
    const pending = await args.client.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "world_source_record"
      WHERE "merged" = false
        AND "companyId" IS NULL
        ${sourceFilter(args.source)}
      ORDER BY "id"
      LIMIT 1
    `);
    if (!pending.length) break;
    const first = await applyMatches(args.client, batchSize, args.source);
    counters.matchedByLei += Number(first.matchedByLei);
    counters.matchedByDomain += Number(first.matchedByDomain);
    counters.matchedByName += Number(first.matchedByName);
    const inserted = await insertUnmatched(args.client, batchSize, args.source);
    counters.inserted += Number(inserted[0]?.inserted ?? 0n);
    const second = await applyMatches(args.client, batchSize, args.source);
    counters.matchedByLei += Number(second.matchedByLei);
    counters.matchedByDomain += Number(second.matchedByDomain);
    counters.matchedByName += Number(second.matchedByName);
  }
  await args.client.$executeRaw(Prisma.sql`
    UPDATE "world_load_run" run
    SET "rowsMerged" = (
      SELECT count(*)
      FROM "world_source_record" record
      WHERE record."loadRunId" = run."id"
        AND record."merged" = true
    )
    WHERE ${args.source ? Prisma.sql`run."source" = ${args.source}` : Prisma.sql`TRUE`}
  `);
  return counters;
}
