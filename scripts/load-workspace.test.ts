import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLoadWorkspaceModel } from "../src/lib/load-workspace";

const model = buildLoadWorkspaceModel({
  reference: "OM-O1-AUG2026-SHA-LAX",
  status: "QUOTED",
  origin: "Shanghai, China",
  destination: "Irvine, CA, USA",
  mode: "SEA-FCL",
  commodity: "2 prototype Model O1 Coupe EVs",
  containerCount: 1,
  containerType: "40HC",
  quantity: 2,
  quantityUnit: "UNITS",
  weight: null,
  dangerousGoods: "YES",
  cargoReadyDate: "2026-08-27",
  etd: null,
  eta: null,
  incoterms: null,
  customsBy: "UNKNOWN",
  declaredValue: null,
  declaredValueCurrency: null,
  parsedData: JSON.stringify({
    loadDossier: {
      facts: [{
        key: "intendedUse",
        label: "Intended use",
        value: "Demo/show vehicle, return to China",
        state: "source_stated",
        evidence: "July 23 email",
        group: "trade",
      }],
      conflicts: [{
        title: "Packaging method conflicts",
        detail: "One message says bare factory supply; another requests wrapping and foam.",
        evidence: "June 22 and July 23 emails",
      }],
    },
  }),
  tasks: [{
    id: "task-1",
    title: "Obtain whole-vehicle MSDS",
    details: "Required before carrier DG acceptance can be confirmed.",
    priority: "critical",
    status: "OPEN",
  }],
  documents: [{
    id: "doc-1",
    name: "Whole-vehicle MSDS",
    status: "PENDING",
    docType: "OTHER",
  }],
  marketReviews: [],
  threadCount: 1,
  messageCount: 5,
});

assert.equal(model.primaryAction?.title, "Obtain whole-vehicle MSDS");
assert.equal(model.evidence.messageCount, 5);
assert.ok(model.facts.some((fact) => fact.key === "intendedUse" && fact.state === "source_stated"));
assert.ok(model.issues.some((issue) => issue.id === "dg-document-gate"));
assert.ok(model.issues.some((issue) => issue.title === "Packaging method conflicts"));
assert.ok(model.readiness.missing > 0);

const operatorTruth = buildLoadWorkspaceModel({
  reference: "OPERATOR-TRUTH",
  status: "INQUIRY",
  origin: "Shanghai, China",
  destination: "Irvine, CA, USA",
  mode: "SEA-LCL",
  commodity: "Prototype vehicle parts",
  quantity: 2,
  quantityUnit: "UNITS",
  weight: 1_500,
  dangerousGoods: "NO",
  cargoReadyDate: "2026-08-27",
  etd: "2026-09-01",
  eta: "2026-09-21",
  incoterms: "DAP",
  customsBy: "US",
  declaredValue: 125_000,
  declaredValueCurrency: "USD",
  parsedData: JSON.stringify({
    loadDossier: {
      facts: [
        {
          key: "incoterm",
          label: "Incoterm",
          value: "",
          state: "missing",
          group: "trade",
        },
        {
          key: "commercial_value",
          label: "Commercial value",
          value: "",
          state: "missing",
          group: "trade",
        },
        {
          key: "intended_use",
          label: "Intended use",
          value: "Demo vehicle",
          state: "confirmed",
          group: "trade",
        },
      ],
      conflicts: [{
        title: "Source conflict",
        detail: "Two source messages disagree.",
      }],
    },
  }),
  tasks: [],
  documents: [],
  marketReviews: [],
  threadCount: 1,
  messageCount: 2,
});

assert.deepEqual(
  operatorTruth.facts.find((fact) => fact.key === "incoterms"),
  {
    key: "incoterms",
    label: "Incoterm",
    value: "DAP",
    state: "recorded",
    group: "trade",
  }
);
assert.equal(
  operatorTruth.facts.find((fact) => fact.key === "declaredValue")?.value,
  "USD 125,000"
);
assert.equal(
  operatorTruth.facts.find((fact) => fact.key === "intended_use")?.state,
  "source_stated"
);
assert.equal(operatorTruth.readiness.missing, 0);
assert.equal(operatorTruth.readiness.label, "needs_inputs");

const jobPage = readFileSync(
  "src/app/dashboard/jobs/[jobId]/page.tsx",
  "utf8"
);
assert.ok(
  jobPage.includes("prisma.inquiry.findFirst") &&
    jobPage.includes("id: job.inquiryId") &&
    jobPage.includes("officeId: session.officeId"),
  "the load workspace must resolve its source inquiry inside the active office"
);
assert.ok(
  jobPage.includes("take: 8") &&
    jobPage.includes("take: 50") &&
    jobPage.includes("events.slice(0, 120)"),
  "the load conversation query and rendered activity feed must stay bounded"
);

const loadIntelPage = readFileSync(
  "src/app/dashboard/intel/load/page.tsx",
  "utf8"
);
assert.ok(
  loadIntelPage.includes("prisma.inquiry.findFirst") &&
    loadIntelPage.includes("prisma.company.findFirst") &&
    loadIntelPage.match(/officeId: session\.officeId/g)?.length === 3,
  "the Intel bridge must resolve the job, inquiry, and company inside the active office"
);

const intelligencePage = readFileSync(
  "src/app/dashboard/intelligence/page.tsx",
  "utf8"
);
assert.ok(
  intelligencePage.includes("linkedReviewTargets") &&
    intelligencePage.includes("OR: linkedReviewTargets") &&
    intelligencePage.includes('name="jobId"'),
  "the linked market-review view must preserve and apply its load filter"
);

console.log("load workspace model tests passed");
