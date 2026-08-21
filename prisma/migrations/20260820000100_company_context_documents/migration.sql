BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Context now uses only CompanyDocument. Existing rows are flattened to their
-- company because the retired product, part, request, fact, and draft schema is
-- intentionally removed.
INSERT INTO "CompanyDocument" (
  "id", "officeId", "companyId", "name", "url", "docType",
  "uploadedByUserId", "createdAt"
)
SELECT
  'ctxfile_' || md5(document."id"),
  document."officeId",
  workspace."companyId",
  document."name",
  document."storageUrl",
  'company_context_file:' || document."contentHash" || ':' || document."mimeType" || ':' || document."sizeBytes",
  document."uploadedByUserId",
  document."createdAt"
FROM "SupplyContextDocument" AS document
JOIN "SupplyWorkspace" AS workspace ON workspace."id" = document."workspaceId"
WHERE workspace."companyId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

WITH parsed_documents AS (
  SELECT
    document.*,
    workspace."companyId",
    CASE
      WHEN document."processingState" = 'EXTRACTED' THEN 'READY'
      WHEN document."processingState" = 'UNSUPPORTED' THEN 'UNSUPPORTED'
      ELSE 'FAILED'
    END AS final_state,
    '<!-- context-processing' || E'\n' ||
      jsonb_build_object(
        'state', CASE
          WHEN document."processingState" = 'EXTRACTED' THEN 'READY'
          WHEN document."processingState" = 'UNSUPPORTED' THEN 'UNSUPPORTED'
          ELSE 'FAILED'
        END,
        'summary', NULL,
        'error', document."extractionError"
      )::text || E'\n-->\n' ||
      COALESCE(
        document."extractionText",
        '# ' || replace(replace(document."name", E'\n', ' '), '#', '') || E'\n\n' ||
          COALESCE(document."extractionError", 'Text extraction is not available for this file.')
      ) AS markdown
  FROM "SupplyContextDocument" AS document
  JOIN "SupplyWorkspace" AS workspace ON workspace."id" = document."workspaceId"
  WHERE workspace."companyId" IS NOT NULL
)
INSERT INTO "CompanyDocument" (
  "id", "officeId", "companyId", "name", "url", "docType",
  "uploadedByUserId", "createdAt"
)
SELECT
  'ctxmd_' || md5('ctxfile_' || parsed."id"),
  parsed."officeId",
  parsed."companyId",
  parsed."name" || '.md',
  'data:text/markdown;base64,' || encode(convert_to(parsed.markdown, 'UTF8'), 'base64'),
  'company_context_markdown:ctxfile_' || md5(parsed."id") || ':' || parsed.final_state,
  parsed."uploadedByUserId",
  parsed."createdAt"
FROM parsed_documents AS parsed
ON CONFLICT ("id") DO NOTHING;

WITH legacy_messages AS (
  SELECT
    message.*,
    workspace."companyId",
    message."body" || CASE
      WHEN message."citations" IS NULL THEN ''
      ELSE E'\n\n<!-- context-citations\n' || message."citations"::text || E'\n-->'
    END AS markdown
  FROM "SupplyContextMessage" AS message
  JOIN "SupplyWorkspace" AS workspace ON workspace."id" = message."workspaceId"
  WHERE workspace."companyId" IS NOT NULL
)
INSERT INTO "CompanyDocument" (
  "id", "officeId", "companyId", "name", "url", "docType",
  "uploadedByUserId", "createdAt"
)
SELECT
  'ctxmsg_' || md5(message."id"),
  message."officeId",
  message."companyId",
  CASE WHEN message."role" = 'AGENT' THEN 'Derya reply.md' ELSE 'Operator message.md' END,
  'data:text/markdown;base64,' || encode(convert_to(message.markdown, 'UTF8'), 'base64'),
  'company_context_message:' || CASE WHEN message."role" = 'AGENT' THEN 'AGENT' ELSE 'OPERATOR' END,
  message."createdByUserId",
  message."createdAt"
FROM legacy_messages AS message
ON CONFLICT ("id") DO NOTHING;

WITH legacy_facts AS (
  SELECT
    fact.*,
    workspace."companyId",
    '# Imported context fact' || E'\n\n' ||
      '- Key: ' || fact."key" || E'\n' ||
      '- Status: ' || fact."status" || E'\n' ||
      '- Source: ' || fact."proposedBy" || E'\n\n' ||
      '```json' || E'\n' || jsonb_pretty(fact."value") || E'\n```' AS markdown
  FROM "SupplyContextFact" AS fact
  JOIN "SupplyWorkspace" AS workspace ON workspace."id" = fact."workspaceId"
  WHERE workspace."companyId" IS NOT NULL
)
INSERT INTO "CompanyDocument" (
  "id", "officeId", "companyId", "name", "url", "docType",
  "uploadedByUserId", "createdAt"
)
SELECT
  'ctxfact_' || md5(fact."id"),
  fact."officeId",
  fact."companyId",
  'Imported context fact - ' || fact."key" || '.md',
  'data:text/markdown;base64,' || encode(convert_to(fact.markdown, 'UTF8'), 'base64'),
  'company_context_file:' || md5(fact."id") || ':text%2Fmarkdown:' || octet_length(fact.markdown),
  fact."reviewedByUserId",
  fact."createdAt"
FROM legacy_facts AS fact
ON CONFLICT ("id") DO NOTHING;

WITH legacy_links AS (
  SELECT
    link.*,
    workspace."companyId",
    '# Imported context source' || E'\n\n' ||
      '- Type: ' || link."sourceType" || E'\n' ||
      '- Source ID: ' || link."sourceId" || E'\n' ||
      CASE WHEN link."label" IS NULL THEN '' ELSE '- Label: ' || link."label" || E'\n' END AS markdown
  FROM "SupplyContextSourceLink" AS link
  JOIN "SupplyWorkspace" AS workspace ON workspace."id" = link."workspaceId"
  WHERE workspace."companyId" IS NOT NULL
)
INSERT INTO "CompanyDocument" (
  "id", "officeId", "companyId", "name", "url", "docType",
  "uploadedByUserId", "createdAt"
)
SELECT
  'ctxlink_' || md5(link."id"),
  link."officeId",
  link."companyId",
  'Imported context source.md',
  'data:text/markdown;base64,' || encode(convert_to(link.markdown, 'UTF8'), 'base64'),
  'company_context_file:' || md5(link."id") || ':text%2Fmarkdown:' || octet_length(link.markdown),
  link."linkedByUserId",
  link."createdAt"
FROM legacy_links AS link
ON CONFLICT ("id") DO NOTHING;

WITH legacy_drafts AS (
  SELECT
    draft.*,
    workspace."companyId",
    '# Imported supplier draft' || E'\n\n' ||
      '- State: ' || draft."state" || E'\n' ||
      '- Recipient: ' || draft."recipient" || E'\n' ||
      '- Subject: ' || draft."subject" || E'\n\n' ||
      draft."body" AS markdown
  FROM "SupplyContextOutboundDraft" AS draft
  JOIN "SupplyWorkspace" AS workspace ON workspace."id" = draft."workspaceId"
  WHERE workspace."companyId" IS NOT NULL
)
INSERT INTO "CompanyDocument" (
  "id", "officeId", "companyId", "name", "url", "docType",
  "uploadedByUserId", "createdAt"
)
SELECT
  'ctxdraft_' || md5(draft."id"),
  draft."officeId",
  draft."companyId",
  'Imported supplier draft - ' || draft."subject" || '.md',
  'data:text/markdown;base64,' || encode(convert_to(draft.markdown, 'UTF8'), 'base64'),
  'company_context_file:' || md5(draft."id") || ':text%2Fmarkdown:' || octet_length(draft.markdown),
  draft."createdByUserId",
  draft."createdAt"
FROM legacy_drafts AS draft
ON CONFLICT ("id") DO NOTHING;

-- Imported facts, source links, and drafts are ordinary Markdown files. Pair
-- them with a READY parsed row so the agent can retrieve them without another
-- parsing pass.
INSERT INTO "CompanyDocument" (
  "id", "officeId", "companyId", "name", "url", "docType",
  "uploadedByUserId", "createdAt"
)
SELECT
  'ctxmd_' || md5(document."id"),
  document."officeId",
  document."companyId",
  document."name" || '.parsed.md',
  document."url",
  'company_context_markdown:' || document."id" || ':READY',
  document."uploadedByUserId",
  document."createdAt"
FROM "CompanyDocument" AS document
WHERE
  document."id" LIKE 'ctxfact_%'
  OR document."id" LIKE 'ctxlink_%'
  OR document."id" LIKE 'ctxdraft_%'
ON CONFLICT ("id") DO NOTHING;

CREATE INDEX IF NOT EXISTS "CompanyDocument_officeId_companyId_docType_createdAt_idx"
  ON "CompanyDocument"("officeId", "companyId", "docType", "createdAt");

-- The user explicitly retired these six Context tables. Drop children first.
-- An unexpected external dependency must stop this migration.
DROP TABLE IF EXISTS "SupplyContextOutboundDraft";
DROP TABLE IF EXISTS "SupplyContextSourceLink";
DROP TABLE IF EXISTS "SupplyContextFact";
DROP TABLE IF EXISTS "SupplyContextDocument";
DROP TABLE IF EXISTS "SupplyContextMessage";
DROP TABLE IF EXISTS "SupplyContextNode";

DROP FUNCTION IF EXISTS supply_context_message_immutable_guard();
DROP FUNCTION IF EXISTS supply_context_node_tree_guard();

COMMIT;
