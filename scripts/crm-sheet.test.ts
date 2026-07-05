// Smoke test for the CRM contact-sheet vocabulary and serializer.
// Run: npx tsx scripts/crm-sheet.test.ts

import {
  CONTACT_STATUSES,
  CONTACT_STATUS_VALUES,
  CONTACT_TYPES,
  CONTACT_TYPE_VALUES,
  RELATIONSHIP_LEVELS,
  RELATIONSHIP_LEVEL_VALUES,
  toContactRow,
} from "../src/lib/contact-fields";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

check("contact types are unique", unique(CONTACT_TYPE_VALUES));
check("contact statuses are unique", unique(CONTACT_STATUS_VALUES));
check("relationship levels are unique", unique(RELATIONSHIP_LEVEL_VALUES));

check(
  "types match the agreed sheet vocabulary",
  JSON.stringify(CONTACT_TYPE_VALUES) ===
    JSON.stringify(["customer", "potential_customer", "logistics_contact", "high_value", "other"])
);
check(
  "statuses match the agreed sheet vocabulary",
  JSON.stringify(CONTACT_STATUS_VALUES) ===
    JSON.stringify(["not_contacted", "contacted", "in_talks", "active", "cold"])
);
check(
  "relationship levels reuse the existing relationshipStrength values",
  JSON.stringify(RELATIONSHIP_LEVEL_VALUES) === JSON.stringify(["unknown", "weak", "warm", "strong", "trusted"])
);

check(
  "every option has a human label",
  [...CONTACT_TYPES, ...CONTACT_STATUSES, ...RELATIONSHIP_LEVELS].every(([, label]) => label.trim().length > 0)
);

const touched = new Date("2026-07-01T10:00:00Z");
const row = toContactRow({
  id: "c1",
  fullName: "Ada Kaptan",
  companyId: "co1",
  category: "customer",
  status: "active",
  relationshipStrength: "strong",
  email: "ada@example.com",
  phone: null,
  location: "Giresun",
  notes: null,
  lastTouchAt: touched,
  company: { name: "Avlia Home" },
});

check("serializer maps fullName -> name", row.name === "Ada Kaptan");
check("serializer maps company name", row.company === "Avlia Home");
check("serializer maps category -> type", row.type === "customer");
check("serializer converts lastTouchAt to ISO", row.lastTouchAt === touched.toISOString());

const untouched = toContactRow({
  id: "c2",
  fullName: "New Person",
  companyId: "co1",
  category: null,
  status: null,
  relationshipStrength: "unknown",
  email: null,
  phone: null,
  location: null,
  notes: null,
  lastTouchAt: null,
  company: { name: "Avlia Home" },
});
check("serializer keeps null lastTouchAt null", untouched.lastTouchAt === null);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("crm-sheet.test.ts passed");
