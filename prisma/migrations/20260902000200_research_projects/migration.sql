CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "companyId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ResearchList" ADD COLUMN "projectId" TEXT;

CREATE UNIQUE INDEX "ResearchProject_officeId_slug_key" ON "ResearchProject"("officeId", "slug");
CREATE UNIQUE INDEX "ResearchProject_id_officeId_key" ON "ResearchProject"("id", "officeId");
CREATE INDEX "ResearchProject_officeId_idx" ON "ResearchProject"("officeId");
CREATE INDEX "ResearchProject_officeId_companyId_idx" ON "ResearchProject"("officeId", "companyId");
CREATE INDEX "ResearchList_officeId_projectId_idx" ON "ResearchList"("officeId", "projectId");

ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchList" ADD CONSTRAINT "ResearchList_projectId_fkey"
  FOREIGN KEY ("projectId", "officeId") REFERENCES "ResearchProject"("id", "officeId") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ResearchProject" TO derya_app;
  END IF;
END $$;
