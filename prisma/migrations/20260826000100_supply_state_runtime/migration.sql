BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE "SupplyStateProjection" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "scopeType" TEXT NOT NULL,
    "scopeRef" TEXT NOT NULL,
    "projectionType" TEXT NOT NULL,
    "compilerVersion" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "dependencyManifest" JSONB NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dirtyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyStateProjection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyStateRead" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "scopeType" TEXT NOT NULL,
    "scopeRef" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "compilerVersion" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "packet" JSONB NOT NULL,
    "packetHash" TEXT NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "dependencyManifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyStateRead_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SupplyCapabilityRun" ADD COLUMN "stateReadId" TEXT;
ALTER TABLE "SupplyDecision" ADD COLUMN "stateReadId" TEXT;
ALTER TABLE "SupplyExecutionTask" ADD COLUMN "stateReadId" TEXT;

CREATE UNIQUE INDEX "SupplyStateProjection_officeId_projectionType_scopeType_sco_key"
ON "SupplyStateProjection"("officeId", "projectionType", "scopeType", "scopeRef", "compilerVersion");
CREATE INDEX "SupplyStateProjection_officeId_projectionType_dirtyAt_idx"
ON "SupplyStateProjection"("officeId", "projectionType", "dirtyAt");
CREATE INDEX "SupplyStateProjection_officeId_workspaceId_scopeType_scopeR_idx"
ON "SupplyStateProjection"("officeId", "workspaceId", "scopeType", "scopeRef");

CREATE INDEX "SupplyStateRead_officeId_scopeType_scopeRef_createdAt_idx"
ON "SupplyStateRead"("officeId", "scopeType", "scopeRef", "createdAt");
CREATE INDEX "SupplyStateRead_officeId_workspaceId_createdAt_idx"
ON "SupplyStateRead"("officeId", "workspaceId", "createdAt");
CREATE INDEX "SupplyStateRead_packetHash_idx" ON "SupplyStateRead"("packetHash");

CREATE INDEX "SupplyCapabilityRun_stateReadId_idx" ON "SupplyCapabilityRun"("stateReadId");
CREATE INDEX "SupplyDecision_stateReadId_idx" ON "SupplyDecision"("stateReadId");
CREATE INDEX "SupplyExecutionTask_stateReadId_idx" ON "SupplyExecutionTask"("stateReadId");

ALTER TABLE "SupplyStateProjection"
ADD CONSTRAINT "SupplyStateProjection_officeId_fkey"
FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyStateProjection"
ADD CONSTRAINT "SupplyStateProjection_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyStateRead"
ADD CONSTRAINT "SupplyStateRead_officeId_fkey"
FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyStateRead"
ADD CONSTRAINT "SupplyStateRead_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyCapabilityRun"
ADD CONSTRAINT "SupplyCapabilityRun_stateReadId_fkey"
FOREIGN KEY ("stateReadId") REFERENCES "SupplyStateRead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyDecision"
ADD CONSTRAINT "SupplyDecision_stateReadId_fkey"
FOREIGN KEY ("stateReadId") REFERENCES "SupplyStateRead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyExecutionTask"
ADD CONSTRAINT "SupplyExecutionTask_stateReadId_fkey"
FOREIGN KEY ("stateReadId") REFERENCES "SupplyStateRead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplyStateProjection"
ADD CONSTRAINT "SupplyStateProjection_scope_type_check"
CHECK ("scopeType" IN ('company', 'procurement_request', 'supplier', 'item', 'workspace')),
ADD CONSTRAINT "SupplyStateProjection_projection_type_check"
CHECK ("projectionType" IN (
    'company_context_v1',
    'procurement_request_v1',
    'supplier_relationship_v1',
    'item_supply_v1',
    'workspace_supply_v1'
)),
ADD CONSTRAINT "SupplyStateProjection_scope_ref_check"
CHECK (char_length("scopeRef") BETWEEN 1 AND 2000),
ADD CONSTRAINT "SupplyStateProjection_compiler_version_check"
CHECK (char_length("compilerVersion") BETWEEN 1 AND 120),
ADD CONSTRAINT "SupplyStateProjection_source_fingerprint_check"
CHECK ("sourceFingerprint" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "SupplyStateProjection_payload_hash_check"
CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "SupplyStateProjection_json_shape_check"
CHECK (
    jsonb_typeof("payload") = 'object'
    AND jsonb_typeof("evidenceRefs") = 'array'
    AND jsonb_typeof("dependencyManifest") = 'array'
    AND jsonb_array_length("evidenceRefs") <= 240
    AND jsonb_array_length("dependencyManifest") <= 320
);

ALTER TABLE "SupplyStateRead"
ADD CONSTRAINT "SupplyStateRead_scope_type_check"
CHECK ("scopeType" IN ('company', 'procurement_request', 'supplier', 'item', 'workspace')),
ADD CONSTRAINT "SupplyStateRead_scope_ref_check"
CHECK (char_length("scopeRef") BETWEEN 1 AND 2000),
ADD CONSTRAINT "SupplyStateRead_objective_check"
CHECK (char_length("objective") BETWEEN 1 AND 4000),
ADD CONSTRAINT "SupplyStateRead_compiler_version_check"
CHECK (char_length("compilerVersion") BETWEEN 1 AND 120),
ADD CONSTRAINT "SupplyStateRead_source_fingerprint_check"
CHECK ("sourceFingerprint" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "SupplyStateRead_packet_hash_check"
CHECK ("packetHash" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "SupplyStateRead_json_shape_check"
CHECK (
    jsonb_typeof("packet") = 'object'
    AND jsonb_typeof("evidenceRefs") = 'array'
    AND jsonb_typeof("dependencyManifest") = 'array'
    AND jsonb_array_length("evidenceRefs") <= 240
    AND jsonb_array_length("dependencyManifest") <= 320
    AND pg_column_size("packet") <= 262144
    AND "packet"->>'compilerVersion' = "compilerVersion"
    AND "packet"->>'objective' = "objective"
    AND "packet"->>'sourceFingerprint' = "sourceFingerprint"
    AND "packet"->>'packetHash' = "packetHash"
    AND "packet"#>>'{scope,officeId}' = "officeId"
    AND "packet"#>>'{scope,type}' = "scopeType"
    AND "packet"->'evidenceRefs' = "evidenceRefs"
    AND "packet"->'dependencies' = "dependencyManifest"
);

CREATE FUNCTION supply_state_assert_optional_workspace_scope()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."workspaceId" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "SupplyWorkspace"
        WHERE "id" = NEW."workspaceId"
          AND "officeId" = NEW."officeId"
    ) THEN
        RAISE EXCEPTION 'Supply state workspace and office scope do not match';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyStateProjection_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyStateProjection"
FOR EACH ROW EXECUTE FUNCTION supply_state_assert_optional_workspace_scope();
CREATE TRIGGER "SupplyStateRead_workspace_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyStateRead"
FOR EACH ROW EXECUTE FUNCTION supply_state_assert_optional_workspace_scope();

CREATE TRIGGER "SupplyCapabilityRun_state_read_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyCapabilityRun"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyStateRead', 'stateReadId');
CREATE TRIGGER "SupplyDecision_state_read_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyDecision"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyStateRead', 'stateReadId');
CREATE TRIGGER "SupplyExecutionTask_state_read_scope_guard"
BEFORE INSERT OR UPDATE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyStateRead', 'stateReadId');

CREATE FUNCTION supply_state_prevent_read_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'Supply state reads are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyStateRead_immutable_guard"
BEFORE UPDATE OR DELETE ON "SupplyStateRead"
FOR EACH ROW EXECUTE FUNCTION supply_state_prevent_read_mutation();

CREATE FUNCTION supply_state_prevent_reference_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."stateReadId" IS DISTINCT FROM NEW."stateReadId" THEN
        IF NEW."stateReadId" IS NULL AND pg_trigger_depth() > 1 THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Supply state read references are immutable after insert';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyCapabilityRun_state_read_immutable_guard"
BEFORE UPDATE ON "SupplyCapabilityRun"
FOR EACH ROW EXECUTE FUNCTION supply_state_prevent_reference_mutation();
CREATE TRIGGER "SupplyDecision_state_read_immutable_guard"
BEFORE UPDATE ON "SupplyDecision"
FOR EACH ROW EXECUTE FUNCTION supply_state_prevent_reference_mutation();
CREATE TRIGGER "SupplyExecutionTask_state_read_immutable_guard"
BEFORE UPDATE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_state_prevent_reference_mutation();

-- These control tables are the shared write seam for generic execution,
-- supplier communication, purchase-order communication, and follow-up flows.
-- A projection is only a cache, so invalidation failures are contained and
-- can never roll back the canonical write that caused them.
CREATE FUNCTION supply_state_invalidate_workspace_control_projection()
RETURNS TRIGGER AS $$
DECLARE
    scoped_office_id TEXT;
    scoped_workspace_id TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        scoped_office_id := OLD."officeId";
        scoped_workspace_id := OLD."workspaceId";
    ELSE
        scoped_office_id := NEW."officeId";
        scoped_workspace_id := NEW."workspaceId";
    END IF;

    BEGIN
        IF scoped_workspace_id IS NOT NULL THEN
            UPDATE "SupplyStateProjection"
            SET "dirtyAt" = COALESCE("dirtyAt", CURRENT_TIMESTAMP),
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE "officeId" = scoped_office_id
              AND "workspaceId" = scoped_workspace_id
              AND "scopeType" = 'workspace'
              AND "projectionType" = 'workspace_supply_v1'
              AND "dirtyAt" IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SupplyDecision_state_projection_invalidate"
AFTER INSERT OR UPDATE OR DELETE ON "SupplyDecision"
FOR EACH ROW EXECUTE FUNCTION supply_state_invalidate_workspace_control_projection();
CREATE TRIGGER "SupplyApproval_state_projection_invalidate"
AFTER INSERT OR UPDATE OR DELETE ON "SupplyApproval"
FOR EACH ROW EXECUTE FUNCTION supply_state_invalidate_workspace_control_projection();
CREATE TRIGGER "SupplyExecutionTask_state_projection_invalidate"
AFTER INSERT OR UPDATE OR DELETE ON "SupplyExecutionTask"
FOR EACH ROW EXECUTE FUNCTION supply_state_invalidate_workspace_control_projection();
CREATE TRIGGER "SupplyExecutionEvent_state_projection_invalidate"
AFTER INSERT OR UPDATE OR DELETE ON "SupplyExecutionEvent"
FOR EACH ROW EXECUTE FUNCTION supply_state_invalidate_workspace_control_projection();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'derya_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SupplyStateProjection" TO derya_app;
    GRANT SELECT, INSERT ON "SupplyStateRead" TO derya_app;
    REVOKE UPDATE, DELETE ON "SupplyStateRead" FROM derya_app;
  END IF;
END
$$;

COMMIT;
