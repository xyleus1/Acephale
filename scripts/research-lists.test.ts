import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { csvCell } from "../src/lib/csv";
import {
  coerceResearchValue,
  buildResearchSearchText,
  hasResearchValues,
  normalizeDedupeValue,
  parseDelimitedRecords,
  rekeyResearchRecords,
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

// Re-keying rows that were stored under an email-derived or missing dedupeKey.

type FakeRecord = {
  id: string;
  officeId: string;
  listId: string;
  dedupeKey: string | null;
  status: string;
  data: Record<string, string | null>;
  createdAt: Date;
};
const legacyRows: FakeRecord[] = [
  // Written before company-keyed dedupe: keyed by the selected contact email.
  { id: "r1", officeId: "office-id", listId: "list-id", dedupeKey: "info@alpha.example", status: "reviewed", data: { company_name: "Alpha", website: "alpha.example" }, createdAt: new Date("2026-01-01") },
  // Written with no dedupe key at all.
  { id: "r2", officeId: "office-id", listId: "list-id", dedupeKey: null, status: "new", data: { company_name: "Beta", website: "beta.example" }, createdAt: new Date("2026-01-02") },
  // Already on the stable key: must be left alone.
  { id: "r3", officeId: "office-id", listId: "list-id", dedupeKey: "gamma.example", status: "new", data: { company_name: "Gamma", website: "gamma.example" }, createdAt: new Date("2026-01-03") },
  // Legacy duplicate of gamma: the stable key is taken, so it stays as is.
  { id: "r4", officeId: "office-id", listId: "list-id", dedupeKey: "sales@gamma.example", status: "new", data: { company_name: "Gamma", website: "gamma.example" }, createdAt: new Date("2026-01-04") },
  // Two legacy rows for the same domain: only the oldest is re-keyed.
  { id: "r5", officeId: "office-id", listId: "list-id", dedupeKey: "a@delta.example", status: "rejected", data: { company_name: "Delta", website: "delta.example" }, createdAt: new Date("2026-01-05") },
  { id: "r6", officeId: "office-id", listId: "list-id", dedupeKey: "b@delta.example", status: "new", data: { company_name: "Delta", website: "delta.example" }, createdAt: new Date("2026-01-06") },
  // Same domain in another office: never touched.
  { id: "r7", officeId: "other-office", listId: "other-list", dedupeKey: "info@alpha.example", status: "new", data: { company_name: "Alpha", website: "alpha.example" }, createdAt: new Date("2026-01-07") },
  // Stored as the bare domain while the batch carries a URL variant of it.
  { id: "r8", officeId: "office-id", listId: "list-id", dedupeKey: "hello@epsilon.example", status: "new", data: { company_name: "Epsilon", website: "epsilon.example" }, createdAt: new Date("2026-01-08") },
  // Stored with scheme, www, and mixed case; the batch carries the bare domain.
  { id: "r12", officeId: "office-id", listId: "list-id", dedupeKey: "info@kappa.example", status: "new", data: { company_name: "Kappa", website: "https://www.Kappa.Example/" }, createdAt: new Date("2026-01-12") },
  // Name-keyed rows whose stored spelling differs in case from the batch.
  { id: "r13", officeId: "office-id", listId: "list-id", dedupeKey: "info@lambda-steel.example", status: "reviewed", data: { company_name: "Lambda Steel GmbH", website: null }, createdAt: new Date("2026-01-13") },
  { id: "r14", officeId: "office-id", listId: "list-id", dedupeKey: null, status: "new", data: { company_name: "MU METALL AG", website: null }, createdAt: new Date("2026-01-14") },
  // Contains the batch name as a substring only: must not be re-keyed.
  { id: "r15", officeId: "office-id", listId: "list-id", dedupeKey: "info@lambda-steel-service.example", status: "new", data: { company_name: "Lambda Steel GmbH Service", website: null }, createdAt: new Date("2026-01-15") },
];
const updateCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
function matchesWhere(record: FakeRecord, where: Record<string, unknown>): boolean {
  if (where.officeId !== undefined && record.officeId !== where.officeId) return false;
  if (where.listId !== undefined && record.listId !== where.listId) return false;
  if (where.id !== undefined && record.id !== where.id) return false;
  if ("dedupeKey" in where) {
    const condition = where.dedupeKey as string | null | { in: string[] };
    if (condition === null || typeof condition === "string") {
      if (record.dedupeKey !== condition) return false;
    } else if (!condition.in.includes(record.dedupeKey ?? "")) {
      return false;
    }
  }
  if (Array.isArray(where.OR)) {
    const clauses = where.OR as Array<{ data: { path: string[]; string_contains: string; mode?: string } }>;
    if (
      !clauses.some((clause) => {
        const stored = record.data[clause.data.path[0]!];
        if (typeof stored !== "string") return false;
        return clause.data.mode === "insensitive"
          ? stored.toLowerCase().includes(clause.data.string_contains.toLowerCase())
          : stored.includes(clause.data.string_contains);
      })
    ) {
      return false;
    }
  }
  return true;
}
const rekeyPrisma = {
  researchList: { findUnique: fakePrisma.researchList.findUnique },
  researchRecord: {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      legacyRows
        .filter((record) => matchesWhere(record, where))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { dedupeKey: string } }) => {
      updateCalls.push({ where, data });
      const targets = legacyRows.filter((record) => matchesWhere(record, where));
      if (legacyRows.some((record) => record.listId === where.listId && record.dedupeKey === data.dedupeKey)) {
        const { Prisma } = await import("@prisma/client");
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
      }
      for (const record of targets) record.dedupeKey = data.dedupeKey;
      return { count: targets.length };
    },
  },
};
const rekeyed = await rekeyResearchRecords(
  "office-id",
  "test",
  "website",
  ["alpha.example", "beta.example", "gamma.example", "delta.example", "https://www.epsilon.example/", "kappa.example", "zeta.example", "", null],
  { client: rekeyPrisma as unknown as PrismaClient },
);
assert.equal(rekeyed.rekeyed, 5, "alpha, beta, delta (oldest), epsilon, and kappa move to the stable key");
const byId = new Map(legacyRows.map((record) => [record.id, record]));
assert.equal(byId.get("r1")?.dedupeKey, "alpha.example", "email-derived key moves to the domain key");
assert.equal(byId.get("r1")?.status, "reviewed", "status is untouched");
assert.equal(byId.get("r2")?.dedupeKey, "beta.example", "a null key moves to the domain key");
assert.equal(byId.get("r3")?.dedupeKey, "gamma.example");
assert.equal(byId.get("r4")?.dedupeKey, "sales@gamma.example", "a legacy duplicate keeps its key when the stable key is taken");
assert.equal(byId.get("r5")?.dedupeKey, "delta.example", "the oldest legacy row wins the stable key");
assert.equal(byId.get("r6")?.dedupeKey, "b@delta.example", "later legacy rows for the same domain keep their key");
assert.equal(byId.get("r7")?.dedupeKey, "info@alpha.example", "other offices are never touched");
assert.equal(byId.get("r8")?.dedupeKey, "epsilon.example", "a URL-shaped batch value is matched through its normalized key");
assert.equal(byId.get("r12")?.dedupeKey, "kappa.example", "a stored URL with scheme, www, and mixed case is matched through its normalized key");
assert.ok(
  updateCalls.every((call) => call.where.officeId === "office-id" && call.where.listId === "list-id" && typeof call.where.id === "string"),
  "every write is pinned to the office, list, and record id",
);
assert.ok(
  updateCalls.every((call) => "dedupeKey" in call.where),
  "every write is conditional on the key it read, so a concurrent re-key cannot be overwritten",
);
const repeat = await rekeyResearchRecords(
  "office-id",
  "test",
  "website",
  ["alpha.example", "beta.example", "gamma.example", "delta.example", "epsilon.example"],
  { client: rekeyPrisma as unknown as PrismaClient },
);
assert.equal(repeat.rekeyed, 0, "a second pass finds every stable key already claimed and writes nothing");

// Company-name fallback keys: stored and incoming spellings differ only in case.
const byName = await rekeyResearchRecords(
  "office-id",
  "test",
  "company_name",
  ["LAMBDA STEEL GMBH", "lambda steel gmbh", "Lambda Steel GmbH ", "Mu Metall AG"],
  { client: rekeyPrisma as unknown as PrismaClient },
);
assert.equal(byName.rekeyed, 2, "one write per normalized name even when the batch spells it several ways");
assert.equal(byId.get("r13")?.dedupeKey, "lambda steel gmbh", "a differently cased stored name is re-keyed");
assert.equal(byId.get("r13")?.status, "reviewed");
assert.equal(byId.get("r14")?.dedupeKey, "mu metall ag", "an upper-case stored name with a null key is re-keyed");
assert.equal(byId.get("r15")?.dedupeKey, "info@lambda-steel-service.example", "a name that merely contains the batch name is not re-keyed");

// A concurrent writer claiming the key between the read and the write is tolerated.
legacyRows.push({ id: "r9", officeId: "office-id", listId: "list-id", dedupeKey: "old@theta.example", status: "new", data: { company_name: "Theta", website: "theta.example" }, createdAt: new Date("2026-01-09") });
const racingPrisma = {
  researchList: rekeyPrisma.researchList,
  researchRecord: {
    findMany: async (args: { where: Record<string, unknown> }) => {
      const result = await rekeyPrisma.researchRecord.findMany(args);
      if (Array.isArray(args.where.OR)) {
        legacyRows.push({ id: "r10", officeId: "office-id", listId: "list-id", dedupeKey: "theta.example", status: "new", data: { company_name: "Theta", website: "theta.example" }, createdAt: new Date("2026-01-10") });
      }
      return result;
    },
    updateMany: rekeyPrisma.researchRecord.updateMany,
  },
};
const raced = await rekeyResearchRecords("office-id", "test", "website", ["theta.example"], {
  client: racingPrisma as unknown as PrismaClient,
});
assert.equal(raced.rekeyed, 0, "losing the race to a concurrent writer is not an error");
assert.equal(legacyRows.find((record) => record.id === "r9")?.dedupeKey, "old@theta.example");
const brokenPrisma = {
  researchList: rekeyPrisma.researchList,
  researchRecord: {
    findMany: rekeyPrisma.researchRecord.findMany,
    updateMany: async () => {
      throw new Error("connection lost");
    },
  },
};
legacyRows.push({ id: "r11", officeId: "office-id", listId: "list-id", dedupeKey: "old@iota.example", status: "new", data: { company_name: "Iota", website: "iota.example" }, createdAt: new Date("2026-01-11") });
await assert.rejects(
  rekeyResearchRecords("office-id", "test", "website", ["iota.example"], { client: brokenPrisma as unknown as PrismaClient }),
  /connection lost/,
  "only unique-key races are swallowed; real database failures surface",
);
await assert.rejects(
  rekeyResearchRecords("office-id", "test", "missing_field", ["iota.example"], { client: rekeyPrisma as unknown as PrismaClient }),
  /not in the list definition/,
);

assert.equal(csvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
assert.equal(csvCell("hello, world"), '"hello, world"');
assert.equal(csvCell('say "hi"'), '"say ""hi"""');

console.log("research-lists: all assertions passed");
}

void main();
