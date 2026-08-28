ALTER TABLE "LeadDiscovery"
  ADD COLUMN "usableContact" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LeadDiscovery"
  ALTER COLUMN "usableContact" DROP DEFAULT;
