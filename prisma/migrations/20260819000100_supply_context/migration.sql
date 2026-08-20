BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE "SupplyContextNode" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "parentId" TEXT,
  "contextKey" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT,
  "createdByPortalUserId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplyContextNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyContextMessage" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "citations" JSONB,
  "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
  "createdByUserId" TEXT,
  "createdByPortalUserId" TEXT,
  "publishedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplyContextMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyContextDocument" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "storageUrl" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "processingState" TEXT NOT NULL DEFAULT 'PENDING',
  "extractionText" TEXT,
  "extractionError" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
  "uploadedByUserId" TEXT,
  "uploadedByPortalUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplyContextDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyContextFact" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
  "evidence" JSONB NOT NULL,
  "proposedBy" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "supersedesFactId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplyContextFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyContextSourceLink" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "label" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
  "linkedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplyContextSourceLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplyContextOutboundDraft" (
  "id" TEXT NOT NULL,
  "officeId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "senderAccountId" TEXT,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "linkedThreadId" TEXT,
  "contextVersion" INTEGER NOT NULL,
  "contextHash" TEXT NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'DRAFT',
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "providerThreadId" TEXT,
  "sendError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplyContextOutboundDraft_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SupplyContextNode" (
  "id", "officeId", "workspaceId", "parentId", "contextKey", "scopeType",
  "name", "visibility", "version", "createdByUserId", "createdAt", "updatedAt"
)
SELECT
  'ctx_' || md5(workspace."id"), workspace."officeId", workspace."id", NULL,
  'company', 'COMPANY', workspace."name", 'SHARED', 1,
  workspace."createdByUserId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SupplyWorkspace" workspace
WHERE workspace."companyId" IS NOT NULL;

CREATE UNIQUE INDEX "SupplyContextNode_workspaceId_contextKey_key" ON "SupplyContextNode"("workspaceId", "contextKey");
CREATE INDEX "SupplyContextNode_officeId_workspaceId_parentId_archivedAt_idx" ON "SupplyContextNode"("officeId", "workspaceId", "parentId", "archivedAt");
CREATE INDEX "SupplyContextNode_officeId_workspaceId_scopeType_visibility_idx" ON "SupplyContextNode"("officeId", "workspaceId", "scopeType", "visibility");
CREATE INDEX "SupplyContextMessage_officeId_workspaceId_nodeId_createdAt_idx" ON "SupplyContextMessage"("officeId", "workspaceId", "nodeId", "createdAt");
CREATE INDEX "SupplyContextMessage_officeId_workspaceId_visibility_createdAt_idx" ON "SupplyContextMessage"("officeId", "workspaceId", "visibility", "createdAt");
CREATE UNIQUE INDEX "SupplyContextDocument_workspaceId_contentHash_key" ON "SupplyContextDocument"("workspaceId", "contentHash");
CREATE INDEX "SupplyContextDocument_officeId_workspaceId_nodeId_createdAt_idx" ON "SupplyContextDocument"("officeId", "workspaceId", "nodeId", "createdAt");
CREATE INDEX "SupplyContextDocument_officeId_workspaceId_visibility_processingState_idx" ON "SupplyContextDocument"("officeId", "workspaceId", "visibility", "processingState");
CREATE UNIQUE INDEX "SupplyContextFact_supersedesFactId_key" ON "SupplyContextFact"("supersedesFactId");
CREATE INDEX "SupplyContextFact_officeId_workspaceId_nodeId_key_status_idx" ON "SupplyContextFact"("officeId", "workspaceId", "nodeId", "key", "status");
CREATE INDEX "SupplyContextFact_officeId_workspaceId_visibility_status_idx" ON "SupplyContextFact"("officeId", "workspaceId", "visibility", "status");
CREATE UNIQUE INDEX "SupplyContextSourceLink_workspaceId_nodeId_sourceType_sourceId_key" ON "SupplyContextSourceLink"("workspaceId", "nodeId", "sourceType", "sourceId");
CREATE INDEX "SupplyContextSourceLink_officeId_workspaceId_nodeId_visibility_idx" ON "SupplyContextSourceLink"("officeId", "workspaceId", "nodeId", "visibility");
CREATE INDEX "SupplyContextSourceLink_officeId_sourceType_sourceId_idx" ON "SupplyContextSourceLink"("officeId", "sourceType", "sourceId");
CREATE UNIQUE INDEX "SupplyContextOutboundDraft_idempotencyKey_key" ON "SupplyContextOutboundDraft"("idempotencyKey");
CREATE INDEX "SupplyContextOutboundDraft_officeId_workspaceId_nodeId_createdAt_idx" ON "SupplyContextOutboundDraft"("officeId", "workspaceId", "nodeId", "createdAt");
CREATE INDEX "SupplyContextOutboundDraft_officeId_workspaceId_state_updatedAt_idx" ON "SupplyContextOutboundDraft"("officeId", "workspaceId", "state", "updatedAt");

ALTER TABLE "SupplyContextNode" ADD CONSTRAINT "SupplyContextNode_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextNode" ADD CONSTRAINT "SupplyContextNode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextNode" ADD CONSTRAINT "SupplyContextNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SupplyContextNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplyContextNode" ADD CONSTRAINT "SupplyContextNode_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyContextNode" ADD CONSTRAINT "SupplyContextNode_createdByPortalUserId_fkey" FOREIGN KEY ("createdByPortalUserId") REFERENCES "CustomerPortalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyContextMessage" ADD CONSTRAINT "SupplyContextMessage_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextMessage" ADD CONSTRAINT "SupplyContextMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextMessage" ADD CONSTRAINT "SupplyContextMessage_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SupplyContextNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextMessage" ADD CONSTRAINT "SupplyContextMessage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyContextMessage" ADD CONSTRAINT "SupplyContextMessage_createdByPortalUserId_fkey" FOREIGN KEY ("createdByPortalUserId") REFERENCES "CustomerPortalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyContextMessage" ADD CONSTRAINT "SupplyContextMessage_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyContextDocument" ADD CONSTRAINT "SupplyContextDocument_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextDocument" ADD CONSTRAINT "SupplyContextDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextDocument" ADD CONSTRAINT "SupplyContextDocument_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SupplyContextNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextDocument" ADD CONSTRAINT "SupplyContextDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyContextDocument" ADD CONSTRAINT "SupplyContextDocument_uploadedByPortalUserId_fkey" FOREIGN KEY ("uploadedByPortalUserId") REFERENCES "CustomerPortalUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyContextFact" ADD CONSTRAINT "SupplyContextFact_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextFact" ADD CONSTRAINT "SupplyContextFact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextFact" ADD CONSTRAINT "SupplyContextFact_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SupplyContextNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextFact" ADD CONSTRAINT "SupplyContextFact_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyContextFact" ADD CONSTRAINT "SupplyContextFact_supersedesFactId_fkey" FOREIGN KEY ("supersedesFactId") REFERENCES "SupplyContextFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyContextSourceLink" ADD CONSTRAINT "SupplyContextSourceLink_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextSourceLink" ADD CONSTRAINT "SupplyContextSourceLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextSourceLink" ADD CONSTRAINT "SupplyContextSourceLink_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SupplyContextNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextSourceLink" ADD CONSTRAINT "SupplyContextSourceLink_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplyContextOutboundDraft" ADD CONSTRAINT "SupplyContextOutboundDraft_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextOutboundDraft" ADD CONSTRAINT "SupplyContextOutboundDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "SupplyWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextOutboundDraft" ADD CONSTRAINT "SupplyContextOutboundDraft_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SupplyContextNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplyContextOutboundDraft" ADD CONSTRAINT "SupplyContextOutboundDraft_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplyContextOutboundDraft" ADD CONSTRAINT "SupplyContextOutboundDraft_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplyContextNode"
  ADD CONSTRAINT "SupplyContextNode_scopeType_check" CHECK ("scopeType" IN ('COMPANY', 'PRODUCT', 'PART', 'REQUEST')),
  ADD CONSTRAINT "SupplyContextNode_visibility_check" CHECK ("visibility" IN ('SHARED', 'INTERNAL')),
  ADD CONSTRAINT "SupplyContextNode_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "SupplyContextMessage"
  ADD CONSTRAINT "SupplyContextMessage_role_check" CHECK ("role" IN ('CUSTOMER', 'OPERATOR', 'AGENT', 'SYSTEM')),
  ADD CONSTRAINT "SupplyContextMessage_visibility_check" CHECK ("visibility" IN ('SHARED', 'INTERNAL'));
ALTER TABLE "SupplyContextDocument"
  ADD CONSTRAINT "SupplyContextDocument_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760),
  ADD CONSTRAINT "SupplyContextDocument_state_check" CHECK ("processingState" IN ('PENDING', 'EXTRACTED', 'UNSUPPORTED', 'FAILED')),
  ADD CONSTRAINT "SupplyContextDocument_visibility_check" CHECK ("visibility" IN ('SHARED', 'INTERNAL'));
ALTER TABLE "SupplyContextFact"
  ADD CONSTRAINT "SupplyContextFact_status_check" CHECK ("status" IN ('PROPOSED', 'CONFIRMED', 'REJECTED', 'SUPERSEDED')),
  ADD CONSTRAINT "SupplyContextFact_visibility_check" CHECK ("visibility" IN ('SHARED', 'INTERNAL')),
  ADD CONSTRAINT "SupplyContextFact_proposedBy_check" CHECK ("proposedBy" IN ('CUSTOMER', 'OPERATOR', 'AGENT', 'SYSTEM'));
ALTER TABLE "SupplyContextSourceLink"
  ADD CONSTRAINT "SupplyContextSourceLink_type_check" CHECK ("sourceType" IN ('MESSAGE', 'DOCUMENT', 'GMAIL_THREAD', 'WHATSAPP', 'JOB', 'INQUIRY', 'KNOWLEDGE_OBJECT')),
  ADD CONSTRAINT "SupplyContextSourceLink_visibility_check" CHECK ("visibility" IN ('SHARED', 'INTERNAL'));
ALTER TABLE "SupplyContextOutboundDraft"
  ADD CONSTRAINT "SupplyContextOutboundDraft_state_check" CHECK ("state" IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'SENDING', 'SENT', 'REJECTED', 'FAILED', 'DELIVERY_UNKNOWN'));

CREATE TRIGGER "SupplyContextNode_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextNode" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyContextMessage_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextMessage" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyContextDocument_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextDocument" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyContextFact_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextFact" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyContextSourceLink_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextSourceLink" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();
CREATE TRIGGER "SupplyContextOutboundDraft_workspace_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextOutboundDraft" FOR EACH ROW EXECUTE FUNCTION supply_assert_workspace_scope();

CREATE TRIGGER "SupplyContextNode_parent_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextNode" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyContextNode', 'parentId');
CREATE TRIGGER "SupplyContextMessage_node_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextMessage" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyContextNode', 'nodeId');
CREATE TRIGGER "SupplyContextDocument_node_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextDocument" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyContextNode', 'nodeId');
CREATE TRIGGER "SupplyContextFact_node_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextFact" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyContextNode', 'nodeId');
CREATE TRIGGER "SupplyContextFact_supersedes_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextFact" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyContextFact', 'supersedesFactId');
CREATE TRIGGER "SupplyContextSourceLink_node_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextSourceLink" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyContextNode', 'nodeId');
CREATE TRIGGER "SupplyContextOutboundDraft_node_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextOutboundDraft" FOR EACH ROW EXECUTE FUNCTION supply_assert_reference_scope('SupplyContextNode', 'nodeId');

CREATE TRIGGER "SupplyContextNode_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextNode" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('createdByUserId');
CREATE TRIGGER "SupplyContextNode_portal_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextNode" FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('CustomerPortalUser', 'createdByPortalUserId');
CREATE TRIGGER "SupplyContextMessage_created_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextMessage" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('createdByUserId');
CREATE TRIGGER "SupplyContextMessage_published_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextMessage" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('publishedByUserId');
CREATE TRIGGER "SupplyContextMessage_portal_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextMessage" FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('CustomerPortalUser', 'createdByPortalUserId');
CREATE TRIGGER "SupplyContextDocument_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextDocument" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('uploadedByUserId');
CREATE TRIGGER "SupplyContextDocument_portal_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextDocument" FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('CustomerPortalUser', 'uploadedByPortalUserId');
CREATE TRIGGER "SupplyContextFact_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextFact" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('reviewedByUserId');
CREATE TRIGGER "SupplyContextSourceLink_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextSourceLink" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('linkedByUserId');
CREATE TRIGGER "SupplyContextOutboundDraft_created_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextOutboundDraft" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('createdByUserId');
CREATE TRIGGER "SupplyContextOutboundDraft_reviewed_user_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextOutboundDraft" FOR EACH ROW EXECUTE FUNCTION supply_assert_user_office_scope('reviewedByUserId');
CREATE TRIGGER "SupplyContextOutboundDraft_account_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextOutboundDraft" FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('EmailAccount', 'senderAccountId');
CREATE TRIGGER "SupplyContextOutboundDraft_thread_scope_guard" BEFORE INSERT OR UPDATE ON "SupplyContextOutboundDraft" FOR EACH ROW EXECUTE FUNCTION supply_assert_office_reference('EmailThread', 'linkedThreadId');

CREATE FUNCTION supply_context_node_tree_guard()
RETURNS TRIGGER AS $$
DECLARE parent_scope TEXT;
DECLARE parent_visibility TEXT;
BEGIN
  IF NEW."scopeType" = 'COMPANY' THEN
    IF NEW."parentId" IS NOT NULL OR NEW."contextKey" <> 'company' OR NEW."visibility" <> 'SHARED' THEN
      RAISE EXCEPTION 'Company context must be the shared root';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."parentId" IS NULL THEN RAISE EXCEPTION 'Non-company context requires a parent'; END IF;
  SELECT "scopeType", "visibility" INTO parent_scope, parent_visibility FROM "SupplyContextNode" WHERE "id" = NEW."parentId";
  IF NOT (
    (parent_scope = 'COMPANY' AND NEW."scopeType" IN ('PRODUCT', 'REQUEST')) OR
    (parent_scope = 'PRODUCT' AND NEW."scopeType" IN ('PART', 'REQUEST')) OR
    (parent_scope = 'PART' AND NEW."scopeType" = 'REQUEST')
  ) THEN RAISE EXCEPTION 'Invalid Supply Context hierarchy'; END IF;
  IF parent_visibility = 'INTERNAL' AND NEW."visibility" = 'SHARED' THEN
    RAISE EXCEPTION 'Shared context cannot inherit from an internal parent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SupplyContextNode_tree_guard" BEFORE INSERT OR UPDATE ON "SupplyContextNode" FOR EACH ROW EXECUTE FUNCTION supply_context_node_tree_guard();

CREATE FUNCTION supply_context_message_immutable_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() <= 1 THEN RAISE EXCEPTION 'Supply Context messages are append-only'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."officeId" IS DISTINCT FROM NEW."officeId"
    OR OLD."workspaceId" IS DISTINCT FROM NEW."workspaceId"
    OR OLD."nodeId" IS DISTINCT FROM NEW."nodeId"
    OR OLD."role" IS DISTINCT FROM NEW."role"
    OR OLD."body" IS DISTINCT FROM NEW."body"
    OR OLD."citations" IS DISTINCT FROM NEW."citations"
    OR OLD."createdByUserId" IS DISTINCT FROM NEW."createdByUserId"
    OR OLD."createdByPortalUserId" IS DISTINCT FROM NEW."createdByPortalUserId"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'Supply Context message content is append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SupplyContextMessage_immutable_guard" BEFORE UPDATE OR DELETE ON "SupplyContextMessage" FOR EACH ROW EXECUTE FUNCTION supply_context_message_immutable_guard();

COMMIT;
