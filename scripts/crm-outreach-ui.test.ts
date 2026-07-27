// Regression coverage for the CRM Outreach Desk route state.
// Run: npx tsx scripts/crm-outreach-ui.test.ts

import { crmViewHref, parseCrmView } from "../src/lib/crm-view";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

check("contacts are the default CRM view", parseCrmView(undefined) === "contacts");
check("unknown views fall back to contacts", parseCrmView("unknown") === "contacts");
check("daily outreach has a stable URL", crmViewHref("today") === "/dashboard/crm?view=today");
check("weekly outreach has a stable URL", crmViewHref("week") === "/dashboard/crm?view=week");
check("contacts keep the clean CRM URL", crmViewHref("contacts") === "/dashboard/crm");
check(
  "search survives an outreach view change",
  crmViewHref("today", "  Acme Freight  ") ===
    "/dashboard/crm?q=Acme+Freight&view=today",
);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}

console.log("crm-outreach-ui.test.ts passed");
