-- Per-contact CRM category: high_value / carrier / shipper / forwarder
ALTER TABLE "Contact" ADD COLUMN "category" TEXT;

-- Backfill from the owning company's book category
UPDATE "Contact" c
SET "category" = CASE
  WHEN co."crmCategory" = 'carrier' THEN 'carrier'
  WHEN co."crmCategory" IN ('broker', 'customs_broker', 'freight_backend') THEN 'forwarder'
  WHEN co."crmCategory" IN ('customer', 'prospect') THEN 'shipper'
  ELSE NULL
END
FROM "Company" co
WHERE co."id" = c."companyId";

-- High-leverage and founder-network contacts count as high value regardless of company book
UPDATE "Contact"
SET "category" = 'high_value'
WHERE "leverageLevel" = 'very_high'
   OR "relationshipType" IN ('investor', 'advisor', 'founder_friend', 'yc_contact', 'connector');

CREATE INDEX "Contact_category_idx" ON "Contact"("category");
