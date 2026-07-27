// Smoke test for the CRM contact-sheet vocabulary and serializer.
// Run: npx tsx scripts/crm-sheet.test.ts

import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_VALUES,
  CONTACT_CONTEXTS,
  CONTACT_CONTEXT_VALUES,
  CONTACT_IMPORTANCE_LEVELS,
  CONTACT_IMPORTANCE_VALUES,
  CONTACT_STATUSES,
  CONTACT_STATUS_VALUES,
  OUTREACH_CHANNEL_OPTIONS,
  OUTREACH_CHANNEL_VALUES,
  OUTREACH_ELIGIBLE_CATEGORY_VALUES,
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

check("contact statuses are unique", unique(CONTACT_STATUS_VALUES));
check("importance levels are unique", unique(CONTACT_IMPORTANCE_VALUES));
check("contact categories are unique", unique(CONTACT_CATEGORY_VALUES));
check("relationship contexts are unique", unique(CONTACT_CONTEXT_VALUES));
check("outreach channels are unique", unique(OUTREACH_CHANNEL_VALUES));

check(
  "categories match the outreach structure",
  JSON.stringify(CONTACT_CATEGORY_VALUES) ===
    JSON.stringify(["personally_important", "startup", "forwarder", "other"]),
);
check(
  "statuses include queue and completion",
  ["not_contacted", "queued", "reached_out", "replied", "follow_up", "active", "not_a_fit"]
    .every((value) => CONTACT_STATUS_VALUES.includes(value as never)),
);
check(
  "importance supports four deterministic levels",
  JSON.stringify(CONTACT_IMPORTANCE_VALUES) ===
    JSON.stringify(["critical", "high", "medium", "low"]),
);
check(
  "channels are Bookface, LinkedIn, and email",
  JSON.stringify(OUTREACH_CHANNEL_VALUES) ===
    JSON.stringify(["bookface", "linkedin", "email"]),
);
check(
  "forwarders stay data-only",
  !OUTREACH_ELIGIBLE_CATEGORY_VALUES.includes("forwarder" as never),
);
check(
  "every option has a human label",
  [
    ...CONTACT_STATUSES,
    ...CONTACT_IMPORTANCE_LEVELS,
    ...CONTACT_CATEGORIES,
    ...CONTACT_CONTEXTS,
    ...OUTREACH_CHANNEL_OPTIONS,
  ].every(([, label]) => label.trim().length > 0),
);

const touched = new Date("2026-07-01T10:00:00Z");
const row = toContactRow({
  id: "c1",
  fullName: "Ada Kaptan",
  companyId: "co1",
  status: "queued",
  importance: "critical",
  category: "startup",
  relationshipType: "founder",
  title: "CEO",
  outreachChannel: "bookface",
  email: "ada@example.com",
  linkedinUrl: "https://linkedin.com/in/ada",
  bookfaceUrl: "https://bookface.ycombinator.com/ada",
  phone: null,
  location: "San Francisco",
  notes: null,
  lastTouchAt: touched,
  company: { name: "Ada Freight" },
});

check("serializer maps fullName to name", row.name === "Ada Kaptan");
check("serializer maps company name", row.company === "Ada Freight");
check("serializer keeps requested category", row.category === "startup");
check("serializer keeps importance", row.importance === "critical");
check("serializer keeps outreach channel", row.outreachChannel === "bookface");
check("serializer converts lastTouchAt to ISO", row.lastTouchAt === touched.toISOString());

const untouched = toContactRow({
  id: "c2",
  fullName: "New Person",
  companyId: "co1",
  status: null,
  importance: "medium",
  category: null,
  relationshipType: "buyer",
  title: null,
  outreachChannel: null,
  email: null,
  linkedinUrl: null,
  bookfaceUrl: null,
  phone: null,
  location: null,
  notes: null,
  lastTouchAt: null,
  company: { name: "Ada Freight" },
});
check("serializer keeps null lastTouchAt null", untouched.lastTouchAt === null);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("crm-sheet.test.ts passed");
