// Regression coverage for the CRM Outreach Desk route state.
// Run: npx tsx scripts/crm-outreach-ui.test.ts

import {
  crmContactsHref,
  outreachViewHref,
  parseCrmView,
  parseOutreachView,
} from "../src/lib/crm-view";

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
check("daily outreach is the default Outreach view", parseOutreachView(undefined) === "today");
check("weekly outreach parses explicitly", parseOutreachView("week") === "week");
check("unknown outreach views fall back to today", parseOutreachView("unknown") === "today");
check("daily outreach has a clean top-level URL", outreachViewHref("today") === "/dashboard/outreach");
check(
  "weekly outreach has a stable top-level URL",
  outreachViewHref("week") === "/dashboard/outreach?view=week",
);
check("contacts keep the clean CRM URL", crmContactsHref() === "/dashboard/crm");
check(
  "search survives an outreach view change",
  outreachViewHref("week", "  Acme Freight  ") ===
    "/dashboard/outreach?q=Acme+Freight&view=week",
);
check(
  "search survives a return to CRM contacts",
  crmContactsHref("  Acme Freight  ") === "/dashboard/crm?q=Acme+Freight",
);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}

console.log("crm-outreach-ui.test.ts passed");
