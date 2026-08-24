import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "scripts/provision-supply-customer-portal.ts"), "utf8");

assert.match(source, /ALLOW_SUPPLY_CUSTOMER_PROVISIONING/);
assert.match(source, /WORKFLOW_DATABASE_URL/);
assert.match(source, /SUPPLY_PROVISION_OFFICE_ID/);
assert.match(source, /SUPPLY_PROVISION_COMPANY_NAME/);
assert.match(source, /SUPPLY_PROVISION_USERNAME/);
assert.match(source, /SUPPLY_PROVISION_PASSWORD/);
assert.match(source, /SUPPLY_PROVISION_ROLE/);
assert.match(source, /SUPPLY_PROVISION_OPERATOR_EMAIL/);
assert.match(source, /SUPPLY_PROVISION_OPERATOR_NAME/);
assert.match(source, /SUPPLY_PROVISION_CREATE_OPERATOR/);
assert.match(source, /SUPPLY_PROVISION_VAULT_SECRET/);
assert.doesNotMatch(source, /requiredEnv\("AUTH_SECRET"\)/);
assert.match(source, /createSupplyCustomerWorkspace/);
assert.match(source, /grantSupplyCustomerPortalAccess/);
assert.match(source, /randomBytes\(32\)/);
assert.doesNotMatch(source, /customer-portal-managed/);
assert.match(source, /has no active internal ADMIN/);
assert.match(source, /existingUser: "reset"/);
assert.match(source, /officeId: office\.id/);
assert.match(source, /workspaceId: workspaceResult\.workspace\.id/);
assert.match(source, /companyId: workspaceResult\.company\.id/);
assert.match(source, /portalUserId: portal\.userId/);
assert.match(source, /encrypted portal password is decryptable only with the same/);
assert.doesNotMatch(source, /console\.log[\s\S]{0,120}(password|authSecret)/i, "credential values must not be printed");
assert.match(source, /console\.log\(JSON\.stringify\(\{/);

console.log("Supply OS provisioning script checks passed.");
