import { Prisma, type PrismaClient } from "../../generated/world-client";

type MergeCounters = {
  matchedByLei: number;
  matchedByDomain: number;
  matchedByName: number;
  inserted: number;
  leftBehind: number;
};

type MatchCounts = {
  matchedByLei: bigint;
  matchedByDomain: bigint;
  matchedByName: bigint;
};

function sourceFilter(source?: string) {
  return source ? Prisma.sql`AND "source" = ${source}` : Prisma.empty;
}

function cursorFilter(afterId: string | null, lastId?: string | null) {
  return Prisma.sql`
    AND (${afterId}::text IS NULL OR "id" > ${afterId})
    ${lastId ? Prisma.sql`AND "id" <= ${lastId}` : Prisma.empty}
  `;
}

function matchCte(
  batchSize: number,
  source?: string,
  afterId: string | null = null,
  lastId: string | null = null,
) {
  return Prisma.sql`
    WITH batch AS MATERIALIZED (
      SELECT "id", "lei", "domain", "country", "nameNormalized", "nameMatchable"
      FROM "world_source_record"
      WHERE "merged" = false
        AND "companyId" IS NULL
        ${cursorFilter(afterId, lastId)}
        ${sourceFilter(source)}
      ORDER BY "id"
      ${lastId ? Prisma.empty : Prisma.sql`LIMIT ${batchSize}`}
    ),
    names AS MATERIALIZED (
      SELECT DISTINCT "country", "nameNormalized"
      FROM batch
      WHERE "nameMatchable" = true
        AND "country" IS NOT NULL
        AND "nameNormalized" <> ''
    ),
    batch_name_identifiers AS MATERIALIZED (
      SELECT
        "country",
        "nameNormalized",
        count(DISTINCT "lei") AS lei_n,
        count(DISTINCT "domain") AS domain_n,
        count(*) FILTER (
          WHERE "lei" IS NULL AND "domain" IS NULL
        ) AS plain_n,
        count(*) FILTER (
          WHERE "lei" IS NOT NULL OR "domain" IS NOT NULL
        ) AS keyed_n
      FROM batch
      WHERE "nameMatchable" = true
        AND "country" IS NOT NULL
        AND "nameNormalized" <> ''
      GROUP BY "country", "nameNormalized"
    ),
    name_candidates AS MATERIALIZED (
      SELECT
        c."country",
        c."nameNormalized",
        min(c."id") AS company_id,
        min(c."lei") AS company_lei,
        min(c."domain") AS company_domain,
        count(*) AS n
      FROM "world_company" c
      JOIN names
        ON names."country" = c."country"
        AND names."nameNormalized" = c."nameNormalized"
      WHERE c."nameMatchable" = true
        AND c."nameNormalized" <> ''
      GROUP BY c."country", c."nameNormalized"
      HAVING count(*) = 1
    ),
    candidate_source_identifiers AS MATERIALIZED (
      SELECT
        n."country",
        n."nameNormalized",
        counts.lei_n,
        counts.domain_n
      FROM name_candidates n
      JOIN batch_name_identifiers b
        ON b."country" = n."country"
        AND b."nameNormalized" = n."nameNormalized"
      CROSS JOIN LATERAL (
        SELECT
          count(DISTINCT r."lei") AS lei_n,
          count(DISTINCT r."domain") AS domain_n
        FROM "world_source_record" r
        WHERE r."country" = n."country"
          AND r."nameNormalized" = n."nameNormalized"
          AND r."nameMatchable" = true
          ${sourceFilter(source)}
      ) counts
      WHERE (
        (n.company_lei IS NULL AND n.company_domain IS NULL)
        AND b.keyed_n > 0
      )
      OR (
        (n.company_lei IS NOT NULL OR n.company_domain IS NOT NULL)
        AND b.plain_n > 0
      )
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
      JOIN batch_name_identifiers b
        ON b."country" = r."country"
        AND b."nameNormalized" = r."nameNormalized"
      LEFT JOIN candidate_source_identifiers s
        ON s."country" = r."country"
        AND s."nameNormalized" = r."nameNormalized"
      WHERE r."country" IS NOT NULL
        AND r."nameNormalized" <> ''
        AND r."nameMatchable" = true
        AND (r."lei" IS NULL OR b.lei_n <= 1)
        AND (r."domain" IS NULL OR b.domain_n <= 1)
        AND (
          r."lei" IS NULL
          OR n.company_lei IS NOT NULL
          OR n.company_domain IS NOT NULL
          OR s.lei_n <= 1
        )
        AND (
          r."domain" IS NULL
          OR n.company_domain IS NOT NULL
          OR n.company_lei IS NOT NULL
          OR s.domain_n <= 1
        )
        AND (
          r."lei" IS NOT NULL
          OR r."domain" IS NOT NULL
          OR (n.company_lei IS NULL AND n.company_domain IS NULL)
          OR (s.lei_n <= 1 AND s.domain_n <= 1)
        )
        AND (r."lei" IS NULL OR n.company_lei IS NULL OR n.company_lei = r."lei")
        AND (r."domain" IS NULL OR n.company_domain IS NULL OR n.company_domain = r."domain")
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

async function applyMatches(
  client: PrismaClient,
  batchSize: number,
  source?: string,
  afterId: string | null = null,
  lastId: string | null = null,
): Promise<MatchCounts> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      CREATE TEMP TABLE matched_batch ON COMMIT DROP AS
      ${matchCte(batchSize, source, afterId, lastId)}
      SELECT record_id, company_id, match_kind
      FROM matched
    `);
    await tx.$executeRawUnsafe("CREATE INDEX matched_batch_company_idx ON matched_batch (company_id)");
    await tx.$executeRawUnsafe("CREATE INDEX matched_batch_record_idx ON matched_batch (record_id)");
    await tx.$executeRawUnsafe("ANALYZE matched_batch");
    const counts = await tx.$queryRaw<MatchCounts[]>(Prisma.sql`
      SELECT
        count(*) FILTER (WHERE match_kind = 'lei') AS "matchedByLei",
        count(*) FILTER (WHERE match_kind = 'domain') AS "matchedByDomain",
        count(*) FILTER (WHERE match_kind = 'name') AS "matchedByName"
      FROM matched_batch
    `);
    const updateStatement = Prisma.sql`
      WITH aggregates AS (
        SELECT
          "company_id",
          count(*) AS source_count,
          bool_or(r."isManufacturer") AS has_manufacturer,
          bool_and(r."nameMatchable") AS all_name_matchable,
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
        FROM matched_batch m
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
      ),
      legal_ids_agg AS (
        SELECT
          m."company_id",
          jsonb_object_agg(item.key, item.value) AS merged_legal_ids
        FROM matched_batch m
        JOIN "world_source_record" r ON r."id" = m.record_id
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN jsonb_typeof(r."legalIds") = 'object' THEN r."legalIds" ELSE '{}'::jsonb END
        ) item
        GROUP BY m."company_id"
      ),
      matched_industry_companies AS MATERIALIZED (
        SELECT DISTINCT m."company_id"
        FROM matched_batch m
        JOIN "world_source_record" r ON r."id" = m.record_id
        WHERE jsonb_typeof(r."industryCodes") = 'object'
          AND r."industryCodes" <> '{}'::jsonb
      ),
      industry_code_sources AS MATERIALIZED (
        SELECT
          m."company_id",
          r."industryCodes" AS industry_codes
        FROM matched_batch m
        JOIN "world_source_record" r ON r."id" = m.record_id
        WHERE jsonb_typeof(r."industryCodes") = 'object'
          AND r."industryCodes" <> '{}'::jsonb
        UNION ALL
        SELECT
          mic."company_id",
          c."industryCodes" AS industry_codes
        FROM matched_industry_companies mic
        JOIN "world_company" c ON c."id" = mic."company_id"
        WHERE jsonb_typeof(c."industryCodes") = 'object'
          AND c."industryCodes" <> '{}'::jsonb
      ),
      industry_code_items AS MATERIALIZED (
        SELECT
          s."company_id",
          item.key,
          element.value AS item_value
        FROM industry_code_sources s
        CROSS JOIN LATERAL jsonb_each(
          s.industry_codes
        ) item
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(item.value) = 'array' THEN item.value
            ELSE jsonb_build_array(item.value)
          END
        ) element
      ),
      industry_code_arrays AS (
        SELECT
          "company_id",
          key,
          jsonb_agg(DISTINCT item_value ORDER BY item_value) AS values
        FROM industry_code_items
        GROUP BY "company_id", key
      ),
      industry_codes_agg AS (
        SELECT
          "company_id",
          jsonb_object_agg(key, values) AS merged_industry_codes
        FROM industry_code_arrays
        GROUP BY "company_id"
      ),
      evidence_agg AS (
        SELECT
          m."company_id",
          jsonb_agg(evidence) AS merged_evidence
        FROM matched_batch m
        JOIN "world_source_record" r ON r."id" = m.record_id
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(r."manufacturerEvidence") = 'array' THEN r."manufacturerEvidence" ELSE '[]'::jsonb END
        ) evidence
        GROUP BY m."company_id"
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
        "nameMatchable" = c."nameMatchable" AND a.all_name_matchable,
        "isManufacturer" = c."isManufacturer" OR a.has_manufacturer,
        "sourceCount" = c."sourceCount" + a.source_count,
        "legalIds" = (
          CASE WHEN jsonb_typeof(c."legalIds") = 'object' THEN c."legalIds" ELSE '{}'::jsonb END
        ) || COALESCE(la.merged_legal_ids, '{}'::jsonb),
        "industryCodes" = COALESCE(
          ica.merged_industry_codes,
          CASE WHEN jsonb_typeof(c."industryCodes") = 'object' THEN c."industryCodes" ELSE '{}'::jsonb END
        ),
        "manufacturerEvidence" = (
          CASE WHEN jsonb_typeof(c."manufacturerEvidence") = 'array' THEN c."manufacturerEvidence" ELSE '[]'::jsonb END
        ) || COALESCE(ea.merged_evidence, '[]'::jsonb)
      FROM unique_aggregates a
      LEFT JOIN legal_ids_agg la ON la."company_id" = a."company_id"
      LEFT JOIN industry_codes_agg ica ON ica."company_id" = a."company_id"
      LEFT JOIN evidence_agg ea ON ea."company_id" = a."company_id"
      WHERE c."id" = a."company_id"
    `;
    await tx.$executeRaw(updateStatement);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "world_source_record" r
      SET "companyId" = matched.company_id, "merged" = true
      FROM matched_batch matched
      WHERE r."id" = matched.record_id
    `);
    return counts[0] ?? { matchedByLei: 0n, matchedByDomain: 0n, matchedByName: 0n };
  }, { timeout: 600_000, maxWait: 60_000 });
}

async function insertUnmatched(
  client: PrismaClient,
  batchSize: number,
  source?: string,
  afterId: string | null = null,
  lastId: string | null = null,
) {
  const statement = Prisma.sql`
    WITH eligible AS MATERIALIZED (
      SELECT *
      FROM "world_source_record"
      WHERE "merged" = false
        AND "companyId" IS NULL
        ${cursorFilter(afterId, lastId)}
        ${sourceFilter(source)}
      ORDER BY "id"
      ${lastId ? Prisma.empty : Prisma.sql`LIMIT ${batchSize}`}
    ),
    by_lei AS MATERIALIZED (
      SELECT DISTINCT ON ("lei")
        gen_random_uuid()::text AS new_id, *
      FROM eligible
      WHERE "lei" IS NOT NULL
      ORDER BY "lei", "id"
    ),
    lei_name_counts AS MATERIALIZED (
      SELECT l."country", l."nameNormalized", count(*) AS n
      FROM by_lei l
      WHERE l."nameMatchable" = true
        AND l."nameNormalized" <> ''
      GROUP BY l."country", l."nameNormalized"
    ),
    eligible_domain_counts AS MATERIALIZED (
      SELECT
        "country",
        "nameNormalized",
        count(DISTINCT "domain") AS domain_n
      FROM eligible
      WHERE "domain" IS NOT NULL
        AND "lei" IS NULL
        AND "nameMatchable" = true
        AND "nameNormalized" <> ''
      GROUP BY "country", "nameNormalized"
    ),
    domain_deferred AS MATERIALIZED (
      SELECT e."id"
      FROM eligible e
      JOIN lei_name_counts lnc
        ON lnc."country" = e."country"
        AND lnc."nameNormalized" = e."nameNormalized"
        AND lnc.n = 1
      JOIN eligible_domain_counts edc
        ON edc."country" = e."country"
        AND edc."nameNormalized" = e."nameNormalized"
        AND edc.domain_n = 1
      WHERE e."domain" IS NOT NULL
        AND e."lei" IS NULL
        AND e."nameMatchable" = true
        AND NOT EXISTS (SELECT 1 FROM by_lei l WHERE l."domain" = e."domain")
        AND NOT EXISTS (
          SELECT 1
          FROM "world_company" w
          WHERE w."country" = e."country"
            AND w."nameNormalized" = e."nameNormalized"
            AND w."nameMatchable" = true
        )
    ),
    remaining_domain AS MATERIALIZED (
      SELECT DISTINCT ON (e."domain")
        gen_random_uuid()::text AS new_id, e.*
      FROM eligible e
      WHERE e."domain" IS NOT NULL
        AND e."lei" IS NULL
        AND NOT EXISTS (SELECT 1 FROM by_lei l WHERE l."domain" = e."domain")
        AND NOT EXISTS (SELECT 1 FROM domain_deferred d WHERE d."id" = e."id")
      ORDER BY e."domain", e."id"
    ),
    batch_name_counts AS MATERIALIZED (
      SELECT same_batch."country", same_batch."nameNormalized", count(*) AS n
      FROM (
        SELECT l."country", l."nameNormalized"
        FROM by_lei l
        WHERE l."nameMatchable" = true
          AND l."nameNormalized" <> ''
        UNION ALL
        SELECT d."country", d."nameNormalized"
        FROM remaining_domain d
        WHERE d."nameMatchable" = true
          AND d."nameNormalized" <> ''
      ) same_batch
      GROUP BY same_batch."country", same_batch."nameNormalized"
    ),
    name_deferred AS MATERIALIZED (
      SELECT e."id"
      FROM eligible e
      JOIN batch_name_counts b
        ON b."country" = e."country"
        AND b."nameNormalized" = e."nameNormalized"
        AND b.n = 1
      WHERE e."country" IS NOT NULL
        AND e."lei" IS NULL
        AND e."domain" IS NULL
        AND e."nameMatchable" = true
        AND e."nameNormalized" <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM "world_company" w
          WHERE w."country" = e."country"
            AND w."nameNormalized" = e."nameNormalized"
            AND w."nameMatchable" = true
        )
    ),
    remaining_name AS MATERIALIZED (
      SELECT DISTINCT ON (e."country", e."nameNormalized")
        gen_random_uuid()::text AS new_id, e.*
      FROM eligible e
      WHERE e."country" IS NOT NULL
        AND e."lei" IS NULL
        AND e."domain" IS NULL
        AND e."nameMatchable" = true
        AND e."nameNormalized" <> ''
        AND NOT EXISTS (SELECT 1 FROM name_deferred d WHERE d."id" = e."id")
      ORDER BY e."country", e."nameNormalized", e."id"
    ),
    no_key AS MATERIALIZED (
      SELECT gen_random_uuid()::text AS new_id, e.*
      FROM eligible e
      WHERE e."lei" IS NULL
        AND e."domain" IS NULL
        AND (e."nameMatchable" = false OR e."country" IS NULL OR e."nameNormalized" = '')
        AND NOT EXISTS (SELECT 1 FROM by_lei l WHERE l."id" = e."id")
        AND NOT EXISTS (SELECT 1 FROM remaining_domain d WHERE d."id" = e."id")
        AND NOT EXISTS (SELECT 1 FROM remaining_name n WHERE n."id" = e."id")
    ),
    name_linked AS MATERIALIZED (
      SELECT
        n."new_id" AS company_id,
        e."id" AS record_id
      FROM remaining_name n
      JOIN eligible e
        ON e."lei" IS NULL
        AND e."domain" IS NULL
        AND e."nameMatchable" = true
        AND e."country" = n."country"
        AND e."nameNormalized" = n."nameNormalized"
    ),
    name_scalar_aggregates AS (
      SELECT
        company_id,
        count(*) AS source_count,
        bool_or(r."isManufacturer") AS has_manufacturer,
        (array_agg(r."region" ORDER BY r."id") FILTER (WHERE r."region" IS NOT NULL))[1] AS first_region,
        (array_agg(r."city" ORDER BY r."id") FILTER (WHERE r."city" IS NOT NULL))[1] AS first_city,
        (array_agg(r."postalCode" ORDER BY r."id") FILTER (WHERE r."postalCode" IS NOT NULL))[1] AS first_postal_code,
        (array_agg(r."addressLine" ORDER BY r."id") FILTER (WHERE r."addressLine" IS NOT NULL))[1] AS first_address_line,
        (array_agg(r."sizeBand" ORDER BY r."id") FILTER (WHERE r."sizeBand" IS NOT NULL))[1] AS first_size_band,
        (array_agg(r."foundedYear" ORDER BY r."id") FILTER (WHERE r."foundedYear" IS NOT NULL))[1] AS first_founded_year,
        (array_agg(r."linkedinUrl" ORDER BY r."id") FILTER (WHERE r."linkedinUrl" IS NOT NULL))[1] AS first_linkedin_url,
        (array_agg(r."website" ORDER BY r."id") FILTER (WHERE r."website" IS NOT NULL))[1] AS first_website,
        (array_agg(r."entityStatus" ORDER BY r."id") FILTER (WHERE r."entityStatus" IS NOT NULL))[1] AS first_entity_status
      FROM name_linked n
      JOIN "world_source_record" r ON r."id" = n.record_id
      GROUP BY company_id
    ),
    legal_ids_agg AS (
      SELECT
        n.company_id,
        jsonb_object_agg(item.key, item.value) AS merged_legal_ids
      FROM name_linked n
      JOIN "world_source_record" r ON r."id" = n.record_id
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(r."legalIds") = 'object' THEN r."legalIds" ELSE '{}'::jsonb END
      ) item
      GROUP BY n.company_id
    ),
    industry_code_items AS (
      SELECT
        n.company_id,
        item.key,
        element.value AS item_value
      FROM name_linked n
      JOIN "world_source_record" r ON r."id" = n.record_id
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(r."industryCodes") = 'object' THEN r."industryCodes" ELSE '{}'::jsonb END
      ) item
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(item.value) = 'array' THEN item.value
          ELSE jsonb_build_array(item.value)
        END
      ) element
    ),
    industry_code_arrays AS (
      SELECT
        company_id,
        key,
        jsonb_agg(DISTINCT item_value ORDER BY item_value) AS values
      FROM industry_code_items
      GROUP BY company_id, key
    ),
    industry_codes_agg AS (
      SELECT
        company_id,
        jsonb_object_agg(key, values) AS merged_industry_codes
      FROM industry_code_arrays
      GROUP BY company_id
    ),
    evidence_agg AS (
      SELECT
        n.company_id,
        jsonb_agg(evidence) AS merged_manufacturer_evidence
      FROM name_linked n
      JOIN "world_source_record" r ON r."id" = n.record_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(r."manufacturerEvidence") = 'array' THEN r."manufacturerEvidence" ELSE '[]'::jsonb END
      ) evidence
      GROUP BY n.company_id
    ),
    name_aggregates AS (
      SELECT
        s.*,
        COALESCE(l.merged_legal_ids, '{}'::jsonb) AS merged_legal_ids,
        COALESCE(i.merged_industry_codes, '{}'::jsonb) AS merged_industry_codes,
        COALESCE(e.merged_manufacturer_evidence, '[]'::jsonb) AS merged_manufacturer_evidence
      FROM name_scalar_aggregates s
      LEFT JOIN legal_ids_agg l ON l.company_id = s.company_id
      LEFT JOIN industry_codes_agg i ON i.company_id = s.company_id
      LEFT JOIN evidence_agg e ON e.company_id = s.company_id
    ),
    chosen AS MATERIALIZED (
      SELECT * FROM by_lei
      UNION ALL SELECT * FROM remaining_domain
      UNION ALL SELECT * FROM remaining_name
      UNION ALL SELECT * FROM no_key
    ),
    chosen_with_counts AS MATERIALIZED (
      SELECT
        c.*,
        COALESCE(a.source_count, 1) AS merged_source_count,
        c."isManufacturer" OR COALESCE(a.has_manufacturer, false) AS merged_is_manufacturer,
        COALESCE(a.first_region, c."region") AS merged_region,
        COALESCE(a.first_city, c."city") AS merged_city,
        COALESCE(a.first_postal_code, c."postalCode") AS merged_postal_code,
        COALESCE(a.first_address_line, c."addressLine") AS merged_address_line,
        COALESCE(a.first_size_band, c."sizeBand") AS merged_size_band,
        COALESCE(a.first_founded_year, c."foundedYear") AS merged_founded_year,
        COALESCE(a.first_linkedin_url, c."linkedinUrl") AS merged_linkedin_url,
        COALESCE(a.first_website, c."website") AS merged_website,
        COALESCE(a.first_entity_status, c."entityStatus") AS merged_entity_status,
        COALESCE(a.merged_legal_ids, c."legalIds") AS merged_legal_ids,
        COALESCE(a.merged_industry_codes, c."industryCodes") AS merged_industry_codes,
        COALESCE(a.merged_manufacturer_evidence, c."manufacturerEvidence") AS merged_manufacturer_evidence
      FROM chosen c
      LEFT JOIN name_aggregates a ON a.company_id = c."new_id"
    ),
    links AS MATERIALIZED (
      SELECT "new_id" AS company_id, "id" AS record_id
      FROM by_lei
      UNION ALL
      SELECT "new_id", "id"
      FROM remaining_domain
      UNION ALL
      SELECT company_id, record_id
      FROM name_linked
      UNION ALL
      SELECT "new_id", "id"
      FROM no_key
    ),
    inserted AS (
      INSERT INTO "world_company" (
        "id", "canonicalName", "nameNormalized", "nameMatchable", "domain", "lei", "country", "region",
        "city", "postalCode", "addressLine", "legalIds", "industryCodes", "isManufacturer",
        "manufacturerEvidence", "sizeBand", "foundedYear", "linkedinUrl", "website",
        "entityStatus", "sourceCount", "createdAt", "updatedAt"
      )
      SELECT
        "new_id", "name", "nameNormalized", "nameMatchable", "domain", "lei", "country",
        merged_region, merged_city, merged_postal_code, merged_address_line,
        merged_legal_ids, merged_industry_codes, merged_is_manufacturer,
        merged_manufacturer_evidence, merged_size_band, merged_founded_year,
        merged_linkedin_url, merged_website, merged_entity_status, merged_source_count,
        now(), now()
      FROM chosen_with_counts
      RETURNING "id"
    ),
    linked AS (
      UPDATE "world_source_record" r
      SET "companyId" = links.company_id, "merged" = true
      FROM links
      JOIN inserted i ON i."id" = links.company_id
      WHERE r."id" = links.record_id
      RETURNING r."id"
    ),
    name_sibling_counts AS MATERIALIZED (
      SELECT count(*) - (SELECT count(*) FROM remaining_name) AS count
      FROM name_linked
    )
    SELECT count(*) AS inserted, max(name_sibling_counts.count) AS name_sibling_links
    FROM inserted
    CROSS JOIN name_sibling_counts
  `;
  if (batchSize >= 20_000) {
    return client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_nestloop = off");
      await tx.$executeRawUnsafe("SET LOCAL plan_cache_mode = force_custom_plan");
      return tx.$queryRaw<{ inserted: bigint; name_sibling_links: bigint }[]>(statement);
    }, { timeout: 600_000, maxWait: 60_000 });
  }
  return client.$queryRaw<{ inserted: bigint; name_sibling_links: bigint }[]>(statement);
}

/**
 * Two bounded sweeps; leftBehind is the number of pending rows at return,
 * callers re-run when > 0.
 */
export async function mergeSourceRecords(args: {
  client: PrismaClient;
  source?: string;
  batchSize?: number;
  onWindowSelected?: (window: { firstId: string; lastId: string }) => Promise<void>;
  onBeforeLeftBehindCount?: (window: { firstId: string; lastId: string }) => Promise<void>;
}): Promise<MergeCounters> {
  const batchSize = args.batchSize ?? 50_000;
  const counters: MergeCounters = {
    matchedByLei: 0,
    matchedByDomain: 0,
    matchedByName: 0,
    inserted: 0,
    leftBehind: 0,
  };
  let afterId: string | null = null;
  const hasPending = async () => {
    const pending = await args.client.$queryRaw<Array<{ found: number }>>(
      Prisma.sql`
        SELECT 1 AS found
        FROM "world_source_record"
        WHERE "merged" = false
          AND "companyId" IS NULL
          ${sourceFilter(args.source)}
        LIMIT 1
      `,
    );
    return pending.length > 0;
  };
  for (let pass = 0; pass < 2; pass += 1) {
    while (true) {
      const idWindows: Array<{ first_id: string | null; last_id: string | null }> =
        await args.client.$queryRaw(
          Prisma.sql`
            SELECT min("id") AS first_id, max("id") AS last_id
            FROM (
              SELECT "id"
              FROM "world_source_record"
              WHERE "merged" = false
                AND "companyId" IS NULL
                ${cursorFilter(afterId)}
                ${sourceFilter(args.source)}
              ORDER BY "id"
              LIMIT ${batchSize}
            ) b
          `,
        );
      const batchWindow = idWindows[0];
      if (!batchWindow?.first_id || !batchWindow.last_id) break;
      await args.onWindowSelected?.({
        firstId: batchWindow.first_id,
        lastId: batchWindow.last_id,
      });
      const first = await applyMatches(
        args.client,
        batchSize,
        args.source,
        afterId,
        batchWindow.last_id,
      );
      counters.matchedByLei += Number(first.matchedByLei);
      counters.matchedByDomain += Number(first.matchedByDomain);
      counters.matchedByName += Number(first.matchedByName);
      const inserted = await insertUnmatched(
        args.client,
        batchSize,
        args.source,
        afterId,
        batchWindow.last_id,
      );
      counters.inserted += Number(inserted[0]?.inserted ?? 0n);
      counters.matchedByName += Number(inserted[0]?.name_sibling_links ?? 0n);
      const second = await applyMatches(
        args.client,
        batchSize,
        args.source,
        afterId,
        batchWindow.last_id,
      );
      counters.matchedByLei += Number(second.matchedByLei);
      counters.matchedByDomain += Number(second.matchedByDomain);
      counters.matchedByName += Number(second.matchedByName);
      const countLeftBehind = async () => args.client.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT count(*) AS count
          FROM "world_source_record"
          WHERE "merged" = false
            AND "companyId" IS NULL
            ${cursorFilter(afterId, batchWindow.last_id)}
            ${sourceFilter(args.source)}
        `,
      );
      await args.onBeforeLeftBehindCount?.({
        firstId: batchWindow.first_id,
        lastId: batchWindow.last_id,
      });
      let leftBehind = await countLeftBehind();
      if (Number(leftBehind[0]?.count ?? 0n) > 0) {
        const retryFirst = await applyMatches(
          args.client,
          batchSize,
          args.source,
          afterId,
          batchWindow.last_id,
        );
        counters.matchedByLei += Number(retryFirst.matchedByLei);
        counters.matchedByDomain += Number(retryFirst.matchedByDomain);
        counters.matchedByName += Number(retryFirst.matchedByName);
        const retryInserted = await insertUnmatched(
          args.client,
          batchSize,
          args.source,
          afterId,
          batchWindow.last_id,
        );
        counters.inserted += Number(retryInserted[0]?.inserted ?? 0n);
        counters.matchedByName += Number(retryInserted[0]?.name_sibling_links ?? 0n);
        const retrySecond = await applyMatches(
          args.client,
          batchSize,
          args.source,
          afterId,
          batchWindow.last_id,
        );
        counters.matchedByLei += Number(retrySecond.matchedByLei);
        counters.matchedByDomain += Number(retrySecond.matchedByDomain);
        counters.matchedByName += Number(retrySecond.matchedByName);
        leftBehind = await countLeftBehind();
      }
      afterId = batchWindow.last_id;
    }
    if (pass === 0) {
      if (!(await hasPending())) break;
      afterId = null;
    }
  }
  const pending = await args.client.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`
      SELECT count(*) AS count
      FROM "world_source_record"
      WHERE "merged" = false
        AND "companyId" IS NULL
        ${sourceFilter(args.source)}
    `,
  );
  counters.leftBehind = Number(pending[0]?.count ?? 0n);
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
