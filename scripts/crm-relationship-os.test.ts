import assert from "node:assert/strict";
import {
  CRM_COMPANY_CATEGORIES,
  CRM_COMPANY_STAGES,
  CRM_OPPORTUNITY_STAGES,
  CRM_PRIORITIES,
  crmLabel,
  priorityTone,
  stageTone,
} from "../src/lib/crm/types";
import { crmCompanyScope } from "../src/lib/crm/scope";

function assertUnique(name: string, values: readonly string[]) {
  assert.equal(new Set(values).size, values.length, `${name} should not contain duplicate values`);
}

assertUnique("CRM_COMPANY_CATEGORIES", CRM_COMPANY_CATEGORIES);
assertUnique("CRM_COMPANY_STAGES", CRM_COMPANY_STAGES);
assertUnique("CRM_OPPORTUNITY_STAGES", CRM_OPPORTUNITY_STAGES);
assertUnique("CRM_PRIORITIES", CRM_PRIORITIES);

assert.equal(crmLabel("active_conversation"), "Active conversation");
assert.equal(priorityTone("critical"), "danger");
assert.equal(priorityTone("high"), "warn");
assert.equal(stageTone("customer"), "good");
assert.equal(stageTone("lost"), "danger");

assert.deepEqual(
  crmCompanyScope({ officeId: "office_1", userId: "user_1", canViewAll: true }),
  { officeId: "office_1" },
);

assert.deepEqual(
  crmCompanyScope({ officeId: "office_1", userId: "user_1", canViewAll: false }),
  { officeId: "office_1", owners: { some: { userId: "user_1" } } },
);

console.log("crm-relationship-os smoke test passed");
