import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { csvCell } from "../src/lib/csv";
import {
  coerceResearchValue,
  buildResearchSearchText,
  hasResearchValues,
  normalizeDedupeValue,
  parseDelimitedRecords,
  upsertResearchRecords,
  validateResearchRowValues,
  validateResearchStatus,
  validateResearchFields,
} from "../src/lib/research-lists";

async function main() {
const fields = validateResearchFields([
  { key: "company_name", label: "Company", type: "text" },
  { key: "website", label: "Website", type: "url" },
  { key: "contact_email", label: "Email", type: "email" },
  { key: "headcount", label: "Headcount", type: "number" },
  { key: "founded_on", label: "Founded", type: "date" },
]);

assert.throws(() => validateResearchFields([{ key: "Bad Key", label: "Bad" }]), /invalid key/);
assert.throws(() => validateResearchFields([{ key: "Bad_Key", label: "Bad" }]), /invalid key/);
assert.throws(() => validateResearchFields([{ key: "a", label: "A" }, { key: "a", label: "Again" }]), /Duplicate/);
assert.throws(() => validateResearchFields(Array.from({ length: 41 }, (_, index) => ({ key: `field_${index}`, label: "Field" }))), /at most 40/);

const csv = parseDelimitedRecords(
  'company_name,website,unknown\n"Acme, Inc.","https://acme.example",ignored\n',
  fields,
);
assert.equal(csv.rows.length, 1);
assert.equal(csv.rows[0]?.row.company_name, "Acme, Inc.");
assert.equal(csv.rows[0]?.row.website, "https://acme.example");
assert.equal("unknown" in (csv.rows[0]?.row ?? {}), false);
assert.equal(csv.rows[0]?.sourceRow, 2);
assert.equal(csv.errors.length, 0);

const json = parseDelimitedRecords(
  '[{"company_name":"One","unknown":"drop"},{"company_name":"Two"}]',
  fields,
);
assert.equal(json.rows.length, 2);
assert.equal(json.rows[0]?.row.company_name, "One");
assert.equal("unknown" in (json.rows[0]?.row ?? {}), false);

const prettyObject = parseDelimitedRecords(
  '{\n  "company_name": "Pretty object"\n}',
  fields,
);
assert.equal(prettyObject.rows[0]?.row.company_name, "Pretty object");

const prettyArray = parseDelimitedRecords(
  '[\n  {"company_name": "Pretty one"},\n  {"company_name": "Pretty two"}\n]',
  fields,
);
assert.equal(prettyArray.rows.length, 2);
assert.equal(prettyArray.rows[1]?.row.company_name, "Pretty two");

const jsonl = parseDelimitedRecords(
  '{"company_name":"One"}\n\n{"company_name":"Two"}',
  fields,
);
assert.equal(jsonl.rows.length, 2);
assert.equal(jsonl.rows[0]?.sourceRow, 1);
assert.equal(jsonl.rows[1]?.sourceRow, 3);

const droppedCsv = parseDelimitedRecords(
  "company_name,headcount\nDropped,10,extra\nLater,not-a-number\n",
  fields,
);
assert.equal(droppedCsv.errors[0]?.row, 2);
const fakePrisma = {
  researchList: {
    findUnique: async () => ({
      id: "list-id",
      officeId: "office-id",
      slug: "test",
      name: "Test",
      description: null,
      fields,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  researchRecord: {
    findMany: async () => [],
    createMany: async () => ({ count: 0 }),
  },
};
const droppedCsvResult = await upsertResearchRecords(
  "office-id",
  "test",
  droppedCsv.rows,
  { client: fakePrisma as unknown as PrismaClient },
);
assert.equal(droppedCsvResult.errors[0]?.row, 3);
assert.match(droppedCsvResult.errors[0]?.error ?? "", /must be a number/);

const saveFailureCsv = parseDelimitedRecords(
  "company_name,headcount\nDropped,10,extra\nLater,10\n",
  fields,
);
const saveFailurePrisma = {
  researchList: {
    findUnique: fakePrisma.researchList.findUnique,
  },
  researchRecord: {
    createMany: async () => {
      throw new Error("batch write failed");
    },
    create: async () => {
      throw new Error("single-row write failed");
    },
  },
};
const saveFailureResult = await upsertResearchRecords(
  "office-id",
  "test",
  saveFailureCsv.rows,
  { client: saveFailurePrisma as unknown as PrismaClient },
);
assert.equal(saveFailureResult.errors[0]?.row, 3);
assert.match(saveFailureResult.errors[0]?.error ?? "", /single-row write failed/);

assert.equal(normalizeDedupeValue(" HTTPS://WWW.Example.com/ "), "example.com");
assert.equal(normalizeDedupeValue("  Contact@Example.com "), "contact@example.com");
assert.equal(normalizeDedupeValue(""), null);

assert.equal(coerceResearchValue("hello", fields[0]!), "hello");
assert.equal(coerceResearchValue("42", fields[3]!), 42);
assert.equal(coerceResearchValue("2026-08-25", fields[4]!), "2026-08-25");
assert.equal(coerceResearchValue("08/25/2026", fields[4]!), "2026-08-25");
assert.throws(() => coerceResearchValue("not-a-date", fields[4]!), /must be a valid date/);
assert.equal(coerceResearchValue("2026-08-25T12:00:00Z", fields[4]!), "2026-08-25");
assert.equal(coerceResearchValue("person@example.com", fields[2]!), "person@example.com");
assert.throws(() => coerceResearchValue("not-a-number", fields[3]!));
assert.throws(() => coerceResearchValue("not-an-email", fields[2]!));
assert.throws(() => coerceResearchValue("javascript:alert(1)", fields[1]!));
assert.throws(() => coerceResearchValue("x".repeat(2001), fields[0]!), /at most 2000/);

const searchText = buildResearchSearchText({
  company_name: "ACME",
  website: "https://example.com",
  contact_email: null,
  headcount: 42,
  founded_on: "2026-08-25",
});
assert.equal(searchText, "acme https://example.com 42 2026-08-25");
assert.doesNotThrow(() =>
  buildResearchSearchText({
    company_name: "X".repeat(5000),
    website: "Y".repeat(5000),
  }),
);
assert.equal(
  buildResearchSearchText({
    company_name: "X".repeat(5000),
    website: "Y".repeat(5000),
  }).length,
  4000,
);
assert.equal(hasResearchValues({ company_name: null, website: null }), false);
assert.equal(hasResearchValues({ company_name: "Acme", website: null }), true);
assert.throws(
  () => validateResearchRowValues({ company_name: null, website: null }),
  /no values for any list column/,
);
assert.doesNotThrow(() => validateResearchRowValues({ company_name: "Acme", website: null }));
assert.equal(validateResearchStatus("new"), "new");
assert.equal(validateResearchStatus("reviewed"), "reviewed");
assert.equal(validateResearchStatus("rejected"), "rejected");
assert.throws(() => validateResearchStatus("queued"), /new, reviewed, or rejected/);

assert.equal(csvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
assert.equal(csvCell("hello, world"), '"hello, world"');
assert.equal(csvCell('say "hi"'), '"say ""hi"""');

console.log("research-lists: all assertions passed");
}

void main();
