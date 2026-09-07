CREATE INDEX CONCURRENTLY "world_source_record_pending_idx" ON "world_source_record" ("id") WHERE "merged" = false AND "companyId" IS NULL;
