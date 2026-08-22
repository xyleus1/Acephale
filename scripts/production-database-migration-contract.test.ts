import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflow = readFileSync(
  join(root, ".github/workflows/production-database-migration.yml"),
  "utf8",
);
const verification = readFileSync(
  join(
    root,
    "scripts/sql/production-verification/20260822000200_order_supplier_contact_compatibility.sql",
  ),
  "utf8",
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

assert.match(verification, /BEGIN READ ONLY;/);
assert.match(verification, /public\."_prisma_migrations"/);
assert.match(verification, /dashboard_api/);
assert.match(verification, /contact_email_count/);
assert.match(verification, /Strobels Supply/);
assert.doesNotMatch(
  verification,
  /^\s*(INSERT\s+INTO|UPDATE\s+["a-z]|DELETE\s+FROM|TRUNCATE\s+)/im,
  "production verification must remain read-only",
);

console.log("Production database migration contract passed.");
