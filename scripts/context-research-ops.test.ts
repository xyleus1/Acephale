import assert from "node:assert/strict";
import {
  auditResearchRows,
  intersectApprovedPurge,
  normalizeResearchOperation,
  operationFromRow,
  orderRequalificationRows,
  remainingRequalificationRows,
  rowsCreatedAfterPurge,
  renderResearchAudit,
  renderResearchStatus,
  rowEvidenceUrls,
  selectProjectList,
  selectPurgeRows,
} from "@/lib/supply-os/context-research-ops";

const row = (id: string, data: Record<string, unknown>, createdAt = new Date(`2025-01-${String(Number(id) + 1).padStart(2, "0")}T00:00:00.000Z`)) => ({
  id,
  data,
  sourceRefs: null,
  status: "new",
  createdAt,
});

assert.equal(normalizeResearchOperation({ kind: "unknown", projectName: "x", regions: [], note: "" }), null);
const normalized = normalizeResearchOperation({
  kind: "audit",
  projectName: "  Scrap suppliers  ",
  regions: Array.from({ length: 25 }, (_, index) => ` Region ${index} ${"x".repeat(120)} `),
  note: ` ${"note ".repeat(100)} `,
});
assert.ok(normalized);
assert.equal(normalized.projectName, "Scrap suppliers");
assert.equal(normalized.regions.length, 20);
assert.equal(normalized.regions[0]?.length, 100);
assert.equal(normalized.note.length, 300);
const operationCreatedAt = new Date("2025-01-01T00:00:00.000Z");
const operation = operationFromRow({
  id: "a",
  createdAt: operationCreatedAt,
  payload: {
    schemaVersion: 1,
    type: "research_operation",
    status: "FAILED",
    kind: "requalify",
    projectId: "project",
    projectName: "Project",
    listId: "list",
    listSlug: "list",
    regions: [],
    note: "",
    preview: [],
    result: [],
    requestMessageId: "message",
    requestBody: "",
    requestCreatedAt: operationCreatedAt.toISOString(),
    threadId: null,
    runningStartedAt: null,
    lastError: "failed",
    workspaceId: "workspace",
    id: "zzz",
    createdAt: "2024-01-01T00:00:00.000Z",
    stale: true,
  },
});
assert.equal(operation?.id, "a");
assert.ok(operation?.createdAt instanceof Date);
assert.equal(operation?.createdAt.valueOf(), operationCreatedAt.valueOf());
assert.equal(operation?.stale, false);

const rows = [
  row("1", { company_name: "TradeIndia", website: "https://tradeindia.com", country: "India", fit_score: 85, fit_verdict: "not_target", evidence_urls: ["https://tradeindia.com/about"] }),
  row("2", { company_name: "Acme Steel", website: "https://acme-steel.example", country: "India", fit_score: 75, fit_verdict: "target", email: "sales@acme.example", evidence_urls: "https://acme.example\nhttps://acme.example/about" }),
  row("3", { company_name: "Acme Steel 2", website: "https://acme-steel.example", country: "India", fit_score: 40 }),
  row("4", { company_name: "North", website: "https://north.example", country: "Vietnam", fit_score: 55, fit_verdict: "unverified", phone: "+84 12345" }),
  row("5", { company_name: "South", website: "https://south.example", country: "Vietnam", fit_score: 65 }),
  row("6", { company_name: "East", website: "https://east.example", country: "Turkey", fit_score: 70, fit_verdict: "target" }),
  row("7", { company_name: "West", website: "https://west.example", country: "Turkey" }),
  row("8", { company_name: "Alpha", website: "https://alpha.example", country: "UK", fit_score: 49 }),
  row("9", { company_name: "Beta", website: "https://beta.example", country: "UK", fit_score: 50, fit_verdict: "target" }),
  row("10", { company_name: "Gamma", website: "https://gamma.example", country: "Germany", fit_score: 80, email: "g@gamma.example" }),
  row("11", { company_name: "Delta", website: "https://delta.example", country: "Germany", fit_score: 10, fit_verdict: "not_target" }),
  row("12", { company_name: "Home | Delta", website: "https://delta-two.example", country: "Germany", fit_score: 75 }),
];
assert.deepEqual(rowEvidenceUrls(rows[0]!.data, null), ["https://tradeindia.com/about"]);
assert.deepEqual(rowEvidenceUrls(rows[1]!.data, null), ["https://acme.example", "https://acme.example/about"]);
const audit = auditResearchRows(rows);
assert.equal(audit.total, 12);
assert.equal(audit.fit.belowFloor, 3);
assert.equal(audit.ruleNonCompanies.length, 1);
assert.equal(audit.duplicates.length, 1);
assert.equal(audit.duplicates[0]?.keepId, "2");
assert.ok(audit.nameArtifacts >= 1);
const selectedPurgeRows = selectPurgeRows(rows);
const approvedPurge = intersectApprovedPurge(selectedPurgeRows, [selectedPurgeRows[0]!.id, "added-after-preview"]);
assert.deepEqual(approvedPurge.rows, [selectedPurgeRows[0]]);
assert.equal(approvedPurge.skipped, selectedPurgeRows.length);
const sameReasonPurge = intersectApprovedPurge(
  [selectedPurgeRows[0]!],
  [selectedPurgeRows[0]!.id],
  { [selectedPurgeRows[0]!.id]: selectedPurgeRows[0]!.reason },
);
assert.deepEqual(sameReasonPurge.rows, [selectedPurgeRows[0]]);
assert.equal(sameReasonPurge.skipped, 0);
const changedReasonPurge = intersectApprovedPurge(
  [selectedPurgeRows[0]!],
  [selectedPurgeRows[0]!.id],
  { [selectedPurgeRows[0]!.id]: selectedPurgeRows[0]!.reason === "duplicate" ? "non_company" : "duplicate" },
);
assert.deepEqual(changedReasonPurge.rows, []);
assert.equal(changedReasonPurge.skipped, 1);
assert.match(renderResearchAudit("Scrap suppliers", audit, selectedPurgeRows.length).join("\n"), new RegExp(`Purge would remove ${selectedPurgeRows.length} rows`));
assert.equal(remainingRequalificationRows(rows, false, 2), 5);
assert.equal(remainingRequalificationRows(rows, true, 2), rows.length - 2);
const requalificationRows = [
  row("30", { fit_verdict: "target", fit_screened_at: "2025-01-03T00:00:00.000Z" }),
  row("31", { fit_verdict: "target", fit_screened_at: "2025-01-02T00:00:00.000Z" }),
  row("32", { fit_verdict: "target" }),
  row("33", {}, new Date("2025-01-04T00:00:00.000Z")),
  row("34", { fit_verdict: "unverified", fit_screened_at: "2025-01-01T00:00:00.000Z" }, new Date("2025-01-01T00:00:00.000Z")),
  row("35", { fit_verdict: "not_target" }, new Date("2025-01-06T00:00:00.000Z")),
];
assert.deepEqual(orderRequalificationRows(requalificationRows, true).map((entry) => entry.id), ["32", "33", "35", "34", "31", "30"]);
assert.deepEqual(orderRequalificationRows(requalificationRows, false).map((entry) => entry.id), ["33", "34"]);
assert.equal(remainingRequalificationRows(requalificationRows, false, 1), 1);
assert.equal(rowsCreatedAfterPurge(100, 12), 12);
assert.equal(rowsCreatedAfterPurge(8, 12), 8);

const purge = selectPurgeRows([
  row("20", { company_name: "TradeIndia", website: "https://tradeindia.com", fit_score: 40 }),
  row("21", { company_name: "TradeIndia copy", website: "https://tradeindia.com", fit_score: 80 }),
]);
assert.equal(purge.find((item) => item.id === "21")?.reason, "non_company");
assert.equal(selectPurgeRows(rows).length, selectedPurgeRows.length);
assert.equal(
  selectProjectList([
    { id: "larger", slug: "larger", name: "Larger", recordCount: 3 },
    { id: "smaller", slug: "smaller", name: "Smaller", recordCount: 1 },
  ])?.slug,
  "larger",
);
assert.equal(
  selectProjectList([
    { id: "z", slug: "z", name: "Z", recordCount: 2 },
    { id: "a", slug: "a", name: "A", recordCount: 2 },
  ])?.slug,
  "a",
);

const job = {
  id: "job",
  status: "RUNNING" as const,
  exhausted: false,
  autoContinue: true,
  lastError: null,
  lastBackgroundRunAt: null,
  createdAt: new Date(),
  draft: { rowTarget: 100, regions: ["India"] },
  stats: {
    rowsCreated: 10,
    queriesUsed: 2,
    pagesFetched: 3,
    qualification: { evaluated: 0, accepted: 0, rejected: {}, fallback: 0 },
  },
} as never;
assert.match(renderResearchStatus({ projectName: "Scrap suppliers", list: { name: "Main", recordCount: 12 }, jobs: [job] }).join("\n"), /running in background/);

console.log("context research operations: all assertions passed");
