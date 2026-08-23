import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflow = readFileSync(
  join(root, ".github/workflows/production-database-migration.yml"),
  "utf8",
);
const verificationDirectory = join(root, "scripts/sql/production-verification");
const verifications = new Map(
  readdirSync(verificationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => [name, readFileSync(join(verificationDirectory, name), "utf8")]),
);
const supplierVerification = verifications.get(
  "20260822000200_order_supplier_contact_compatibility.sql",
);
const customerContextVerification = verifications.get(
  "20260822000300_customer_portal_context_access.sql",
);
const workspaceRelinkMigration = readFileSync(
  join(
    root,
    "prisma/migrations/20260822000500_procurement_workspace_context_relink/migration.sql",
  ),
  "utf8",
);
const workspaceRelinkVerification = verifications.get(
  "20260822000500_procurement_workspace_context_relink.sql",
);
const emailAccountVerification = verifications.get(
  "20260822000400_email_account_sending_config.sql",
);
const customerPasswordVerification = verifications.get(
  "20260822000600_customer_portal_password_auth.sql",
);
const gmailAppPasswordVerification = verifications.get(
  "20260822000700_gmail_app_password_accounts.sql",
);

assert.match(workflow, /^on:\n  workflow_dispatch:/m, "production migration must be manually dispatched");
assert.doesNotMatch(
  workflow,
  /^  (push|pull_request|schedule):/m,
  "production migration must not run from push, pull request, or a schedule",
);
assert.match(workflow, /permissions:\n  contents: read/, "workflow token must remain read-only");
assert.match(workflow, /if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/);
assert.match(workflow, /environment:\n      name: Production/);
assert.match(workflow, /APPLY_PRODUCTION_MIGRATION/);
assert.match(workflow, /\^\[0-9\]\{14\}_\[a-z0-9_\]\+\$/);
assert.match(workflow, /requested migration must be the latest migration on main/i);
assert.match(workflow, /secrets\.WORKFLOW_DATABASE_OWNER_URL/);
assert.doesNotMatch(workflow, /echo[^\n]*WORKFLOW_DATABASE_OWNER_URL/);
const installStep = workflow.match(/- name: Install locked dependencies[\s\S]*?run: npm ci/)?.[0];
assert.ok(installStep, "locked dependency installation step is missing");
assert.match(installStep, /DATABASE_URL: postgresql:\/\/unused:unused@127\.0\.0\.1:9\/unused/);
assert.doesNotMatch(
  installStep,
  /WORKFLOW_DATABASE_OWNER_URL|secrets\.WORKFLOW_DATABASE_OWNER_URL/,
  "dependency lifecycle scripts must not receive the production owner credential",
);
assert.match(workflow, /ep-summer-cake-audzi8ve\.c-10\.us-east-1\.aws\.neon\.tech/);
assert.match(workflow, /neondb\|neondb_owner/);
assert.match(workflow, /npm run deploy:migrations/);
assert.match(workflow, /scripts\/sql\/production-verification\/\$REQUESTED_MIGRATION_ID\.sql/);

assert.ok(supplierVerification, "supplier production verification is missing");
assert.ok(customerContextVerification, "customer Context production verification is missing");
assert.ok(workspaceRelinkVerification, "workspace relink production verification is missing");
assert.ok(emailAccountVerification, "email account production verification is missing");
assert.ok(customerPasswordVerification, "customer password production verification is missing");
assert.ok(gmailAppPasswordVerification, "Gmail app-password production verification is missing");
for (const [name, verification] of verifications) {
  assert.match(verification, /BEGIN READ ONLY;/, `${name} must use a read-only transaction`);
  if (/^[0-9]{14}_[a-z0-9_]+\.sql$/.test(name)) {
    assert.match(
      verification,
      /public\."_prisma_migrations"/,
      `${name} must verify the migration ledger`,
    );
  }
  assert.doesNotMatch(
    verification,
    /^\s*(INSERT\s+INTO|UPDATE\s+["a-z]|DELETE\s+FROM|TRUNCATE\s+)/im,
    `${name} must remain read-only`,
  );
}
assert.match(supplierVerification, /dashboard_api/);
assert.match(supplierVerification, /contact_email_count/);
assert.match(supplierVerification, /Strobels Supply/);
assert.match(customerContextVerification, /createdByPortalUserId/);
assert.match(customerContextVerification, /customerVisible/);
assert.match(customerContextVerification, /company_context_scope_guard/);
assert.match(workspaceRelinkMigration, /legacy_workspace_id/);
assert.match(workspaceRelinkMigration, /Derya Supply OS/);
assert.match(workspaceRelinkMigration, /\{source,campaign\}'.*= 'CUSTOM'/);
assert.match(workspaceRelinkMigration, /active_workspace_count = 1/);
assert.match(workspaceRelinkMigration, /original_workspace\.id IS NULL/);
assert.match(workspaceRelinkMigration, /required procurement workspace schema is missing/);
assert.match(workspaceRelinkMigration, /SET LOCAL lock_timeout = '5s'/);
assert.match(workspaceRelinkMigration, /SET LOCAL statement_timeout = '30s'/);
assert.doesNotMatch(workspaceRelinkMigration, /SET\s+updated_at\s*=/i);
assert.doesNotMatch(workspaceRelinkMigration, /procurement_communication_messages/);
assert.match(workspaceRelinkVerification, /24cb31bd-d974-4040-939c-cd8e76dd8967/);
assert.match(workspaceRelinkVerification, /e3f6cacc-ca34-4d01-a787-c09da6805bce/);
assert.match(workspaceRelinkVerification, /cmt1rgth70006rn8tvneq4dha/);
assert.match(workspaceRelinkVerification, /cmszhzq3c0003l804g5qf9yv8/);
assert.match(workspaceRelinkVerification, /ledger_count <> 9/);
assert.match(workspaceRelinkVerification, /outbound_count <> 7/);
assert.match(workspaceRelinkVerification, /inbound_count <> 2/);
assert.match(workspaceRelinkVerification, /c01a827c-e736-475e-a085-e7e665035af9/);
assert.match(workspaceRelinkVerification, /2026-08-19 09:04:33\+00/);
assert.match(workspaceRelinkVerification, /2026-08-19 17:15:20\+00/);
assert.match(workspaceRelinkVerification, /bay_area_outbound_count <> 1/);
assert.match(workspaceRelinkVerification, /bay_area_inbound_count <> 1/);
assert.match(emailAccountVerification, /sendEnabled/);
assert.match(emailAccountVerification, /isDefaultSender/);
assert.match(emailAccountVerification, /EmailAccount_officeId_default_sender_key/);
assert.match(customerPasswordVerification, /CustomerPortalUser_password_state_check/);
assert.match(customerPasswordVerification, /accounts_with_password/);
assert.match(customerPasswordVerification, /accounts_requiring_password/);
assert.match(customerPasswordVerification, /locked_accounts/);
assert.match(customerPasswordVerification, /CustomerPortalLoginThrottle_attempt_count_check/);
assert.match(customerPasswordVerification, /CustomerPortalLoginThrottle_expiresAt_idx/);
assert.match(customerPasswordVerification, /login_throttle_rows/);
assert.match(customerPasswordVerification, /derya application role cannot use the customer login throttle/);
assert.match(gmailAppPasswordVerification, /credentialSecret/);
assert.match(gmailAppPasswordVerification, /enc:v1:/);
assert.match(gmailAppPasswordVerification, /rfcMessageId/);
assert.match(gmailAppPasswordVerification, /GMAIL_APP_PASSWORD/);

console.log("Production database migration contract passed.");
