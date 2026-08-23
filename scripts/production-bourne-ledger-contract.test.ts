import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflow = readFileSync(
  join(root, ".github/workflows/production-bourne-ledger.yml"),
  "utf8",
);
const migration = readFileSync(
  join(root, "scripts/sql/bourne-procurement-communication-ledger.sql"),
  "utf8",
);
const verification = readFileSync(
  join(
    root,
    "scripts/sql/production-verification/bourne-procurement-communication-ledger.sql",
  ),
  "utf8",
);

assert.match(workflow, /^on:\n  workflow_dispatch:/m);
assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
assert.match(workflow, /permissions:\n  contents: read/);
assert.match(workflow, /group: production-database-migration/);
assert.match(workflow, /if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/);
assert.match(workflow, /environment:\n      name: Production/);
assert.match(workflow, /APPLY_BOURNE_COMMUNICATION_LEDGER/);
assert.match(workflow, /ep-summer-cake-audzi8ve\.c-10\.us-east-1\.aws\.neon\.tech/);
assert.match(workflow, /neondb\|neondb_owner/);
assert.match(workflow, /secrets\.WORKFLOW_DATABASE_OWNER_URL/);
assert.doesNotMatch(workflow, /echo[^\n]*WORKFLOW_DATABASE_OWNER_URL/);
assert.match(workflow, /--file=scripts\/sql\/bourne-procurement-communication-ledger\.sql/);
assert.match(workflow, /--file=scripts\/sql\/production-verification\/bourne-procurement-communication-ledger\.sql/);

assert.match(migration, /CREATE UNIQUE INDEX CONCURRENTLY/);
assert.match(migration, /CREATE INDEX CONCURRENTLY/);
assert.match(migration, /SET lock_timeout = '5s'/);
assert.match(migration, /bourne_supply_chain has unsafe role attributes or memberships/);

assert.match(verification, /BEGIN READ ONLY;/);
assert.match(verification, /procurement_communication_messages/);
assert.match(verification, /dashboard_api/);
assert.match(verification, /bourne_supply_chain/);
assert.match(verification, /derya_app/);
assert.doesNotMatch(
  verification,
  /^\s*(INSERT\s+INTO|UPDATE\s+["a-z]|DELETE\s+FROM|TRUNCATE\s+)/im,
);

console.log("Production Bourne ledger workflow contract passed.");
