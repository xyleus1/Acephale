-- Contact sheet rebuild: per-contact status + remap category to the new type set
-- (customer / potential_customer / logistics_contact / high_value / other)
ALTER TABLE "Contact" ADD COLUMN "status" TEXT;

-- Remap legacy category values (high_value / carrier / shipper / forwarder)
-- using the owning company's book category where it is more precise.
UPDATE "Contact" c
SET "category" = CASE
  WHEN c."category" = 'high_value' THEN 'high_value'
  WHEN co."crmCategory" = 'customer' THEN 'customer'
  WHEN co."crmCategory" = 'prospect' THEN 'potential_customer'
  WHEN c."category" IN ('carrier', 'forwarder') THEN 'logistics_contact'
  WHEN co."crmCategory" IN ('carrier', 'broker', 'customs_broker', 'freight_backend') THEN 'logistics_contact'
  ELSE c."category"
END
FROM "Company" co
WHERE co."id" = c."companyId";

-- Any leftover legacy values become customers (shipper was the catch-all backfill)
UPDATE "Contact" SET "category" = 'customer' WHERE "category" IN ('shipper', 'carrier', 'forwarder');

-- Seed status from touch history so the sheet starts populated
UPDATE "Contact"
SET "status" = CASE WHEN "lastTouchAt" IS NOT NULL THEN 'contacted' ELSE 'not_contacted' END
WHERE "status" IS NULL;
