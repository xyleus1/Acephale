-- Freight file number on Inquiry (e.g. DRY26070001), carried onto the converted Job.
ALTER TABLE "Inquiry" ADD COLUMN "reference" TEXT;

-- Unique per office; Postgres allows multiple NULLs so unnumbered rows are fine.
CREATE UNIQUE INDEX "Inquiry_officeId_reference_key" ON "Inquiry"("officeId", "reference");
