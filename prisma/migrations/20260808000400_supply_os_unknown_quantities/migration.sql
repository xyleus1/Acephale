-- Missing inventory and scrap values are unknown, not zero. Planning code must
-- handle NULL explicitly instead of inventing availability or yield.
ALTER TABLE "SupplyBomLine"
  ALTER COLUMN "scrapRate" DROP DEFAULT,
  ALTER COLUMN "scrapRate" DROP NOT NULL;

ALTER TABLE "SupplyInventoryPosition"
  ALTER COLUMN "quantityOnHand" DROP NOT NULL,
  ALTER COLUMN "quantityAllocated" DROP DEFAULT,
  ALTER COLUMN "quantityAllocated" DROP NOT NULL,
  ALTER COLUMN "quantityInTransit" DROP DEFAULT,
  ALTER COLUMN "quantityInTransit" DROP NOT NULL,
  ALTER COLUMN "quantityOnOrder" DROP DEFAULT,
  ALTER COLUMN "quantityOnOrder" DROP NOT NULL;
