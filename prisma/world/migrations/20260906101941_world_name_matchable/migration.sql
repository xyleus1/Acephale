ALTER TABLE "world_company"
ADD COLUMN "nameMatchable" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "world_source_record"
ADD COLUMN "nameMatchable" BOOLEAN NOT NULL DEFAULT true;
