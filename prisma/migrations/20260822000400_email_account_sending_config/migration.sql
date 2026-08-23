ALTER TABLE "EmailAccount"
ADD COLUMN "sendEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isDefaultSender" BOOLEAN NOT NULL DEFAULT false;

-- Preserve existing connected Gmail sending behavior. Newly connected
-- accounts remain send-disabled until an administrator enables them.
UPDATE "EmailAccount"
SET "sendEnabled" = true
WHERE "provider" = 'GMAIL'
  AND "isActive" = true
  AND "refreshToken" IS NOT NULL;

-- Give each office at most one deterministic default among its existing,
-- active Gmail senders. The application maintains this invariant afterward.
WITH ranked_senders AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "officeId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS sender_rank
  FROM "EmailAccount"
  WHERE "provider" = 'GMAIL'
    AND "isActive" = true
    AND "sendEnabled" = true
)
UPDATE "EmailAccount" AS account
SET "isDefaultSender" = true
FROM ranked_senders
WHERE account."id" = ranked_senders."id"
  AND ranked_senders.sender_rank = 1;

CREATE UNIQUE INDEX "EmailAccount_officeId_default_sender_key"
ON "EmailAccount"("officeId")
WHERE "isDefaultSender" = true;
