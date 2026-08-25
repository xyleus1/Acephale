CREATE TABLE "ResearchList" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "fields" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResearchList_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResearchList_officeId_fkey"
    FOREIGN KEY ("officeId")
    REFERENCES "Office"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE "ResearchRecord" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "dedupeKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "data" JSONB NOT NULL,
  "searchText" TEXT NOT NULL DEFAULT '',
  "sourceRefs" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResearchRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResearchList_officeId_slug_key"
ON "ResearchList"("officeId", "slug");

CREATE UNIQUE INDEX "ResearchList_id_officeId_key"
ON "ResearchList"("id", "officeId");

ALTER TABLE "ResearchRecord"
ADD CONSTRAINT "ResearchRecord_listId_officeId_fkey"
  FOREIGN KEY ("listId", "officeId")
  REFERENCES "ResearchList"("id", "officeId")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE INDEX "ResearchList_officeId_idx"
ON "ResearchList"("officeId");

CREATE UNIQUE INDEX "ResearchRecord_listId_dedupeKey_key"
ON "ResearchRecord"("listId", "dedupeKey");

CREATE INDEX "ResearchRecord_officeId_listId_idx"
ON "ResearchRecord"("officeId", "listId");

CREATE INDEX "ResearchRecord_listId_status_idx"
ON "ResearchRecord"("listId", "status");
