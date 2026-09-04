CREATE TABLE "ProcurementConversationTask" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementConversationTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcurementConversationTask_officeId_orderId_vendorId_key"
  ON "ProcurementConversationTask"("officeId", "orderId", "vendorId");
CREATE INDEX "ProcurementConversationTask_officeId_settledAt_nextAttemptAt_idx"
  ON "ProcurementConversationTask"("officeId", "settledAt", "nextAttemptAt");
CREATE INDEX "ProcurementConversationTask_orderId_settledAt_idx"
  ON "ProcurementConversationTask"("orderId", "settledAt");

ALTER TABLE "ProcurementConversationTask" ADD CONSTRAINT "ProcurementConversationTask_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ProcurementConversationTask" TO derya_app;
  END IF;
END $$;
