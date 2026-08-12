CREATE TABLE "ConnectorInstallation" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "adapterKey" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'OAUTH_CLIENT_CREDENTIALS',
    "secretRef" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "scheduleMinutes" INTEGER NOT NULL DEFAULT 60,
    "status" TEXT NOT NULL DEFAULT 'DISABLED',
    "currentCursor" JSONB,
    "lastTraceId" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "nextSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConnectorInstallation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SupplyImportRun"
    ADD COLUMN "connectorInstallationId" TEXT,
    ADD COLUMN "adapterVersion" TEXT,
    ADD COLUMN "inputCursor" JSONB,
    ADD COLUMN "outputCursor" JSONB,
    ADD COLUMN "recordCounts" JSONB,
    ADD COLUMN "traceId" TEXT,
    ADD COLUMN "errorCode" TEXT;

CREATE UNIQUE INDEX "ConnectorInstallation_workspaceId_adapterKey_key"
    ON "ConnectorInstallation"("workspaceId", "adapterKey");
CREATE INDEX "ConnectorInstallation_officeId_status_nextSyncAt_idx"
    ON "ConnectorInstallation"("officeId", "status", "nextSyncAt");
CREATE INDEX "ConnectorInstallation_officeId_workspaceId_updatedAt_idx"
    ON "ConnectorInstallation"("officeId", "workspaceId", "updatedAt");
CREATE INDEX "SupplyImportRun_connectorInstallationId_createdAt_idx"
    ON "SupplyImportRun"("connectorInstallationId", "createdAt");
CREATE INDEX "SupplyImportRun_traceId_idx" ON "SupplyImportRun"("traceId");

ALTER TABLE "ConnectorInstallation"
    ADD CONSTRAINT "ConnectorInstallation_officeId_fkey"
    FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConnectorInstallation"
    ADD CONSTRAINT "ConnectorInstallation_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConnectorInstallation"
    ADD CONSTRAINT "ConnectorInstallation_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyImportRun"
    ADD CONSTRAINT "SupplyImportRun_connectorInstallationId_fkey"
    FOREIGN KEY ("connectorInstallationId") REFERENCES "ConnectorInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConnectorInstallation"
    ADD CONSTRAINT "ConnectorInstallation_status_check"
    CHECK ("status" IN ('DISABLED', 'ACTIVE', 'RUNNING', 'FAILED')),
    ADD CONSTRAINT "ConnectorInstallation_auth_type_check"
    CHECK ("authType" = 'OAUTH_CLIENT_CREDENTIALS'),
    ADD CONSTRAINT "ConnectorInstallation_schedule_check"
    CHECK ("scheduleMinutes" BETWEEN 15 AND 10080);

CREATE TRIGGER "ConnectorInstallation_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "ConnectorInstallation"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyWorkspace', 'workspaceId');

CREATE TRIGGER "ConnectorInstallation_user_scope_guard"
BEFORE INSERT OR UPDATE ON "ConnectorInstallation"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('User', 'createdByUserId');

CREATE TRIGGER "SupplyImportRun_connector_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyImportRun"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('ConnectorInstallation', 'connectorInstallationId');
