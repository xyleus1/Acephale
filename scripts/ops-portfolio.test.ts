import assert from "node:assert/strict";
import {
  buildOpsPortfolioReport,
  findOpsPortfolioMatches,
  type OpsPortfolioOfficeInput,
} from "@/lib/ops-portfolio";

const emptyOffice: OpsPortfolioOfficeInput = {
  office: { id: "office-1", name: "North", createdAt: "2026-09-11T00:00:00.000Z" },
  companies: [],
  companiesTotal: 0,
  workflowAccounts: [],
  researchLists: [],
  campaigns: [],
  emailThreads: { total: 0, inbound: 0, outbound: 0 },
  procurement: [],
};

const report = buildOpsPortfolioReport({
  generatedAt: "2026-09-11T12:00:00.000Z",
  offices: [emptyOffice],
});
assert.equal(report.offices.length, 1);
assert.equal(report.offices[0]?.name, "North");
assert.deepEqual(report.offices[0]?.companies, []);

const aggregationOffice: OpsPortfolioOfficeInput = {
  ...emptyOffice,
  companies: [{ id: "company-1", name: "Hypnodreamz" }],
  companiesTotal: 1,
  campaigns: [{
    id: "campaign-1",
    name: "September",
    status: "ACTIVE",
    replyMode: "AUTO",
    listId: "list-1",
    sends: { total: 5, sent: 4, rejected: 1 },
    followUps: { total: 3, sent: 2, skipped: 1 },
    replies: {
      threads: 3,
      answered: 2,
      awaitingAnswer: 1,
      autoReplies: 1,
      bounces: 1,
      optOuts: 0,
      complaints: 0,
    },
    autoReplyLedger: { sent: 1, escalated: 1, suppressed: 0, skipped: 1, failed: 0 },
  }],
  emailThreads: { total: 7, inbound: 4, outbound: 3 },
};
const aggregated = buildOpsPortfolioReport({
  generatedAt: "2026-09-11T12:00:00.000Z",
  offices: [aggregationOffice],
});
assert.equal(aggregated.offices[0]?.companiesTotal, 1);
assert.deepEqual(aggregated.offices[0]?.campaigns[0]?.sends, { total: 5, sent: 4, rejected: 1 });
assert.equal(aggregated.offices[0]?.campaigns[0]?.replies.awaitingAnswer, 1);
assert.equal(aggregated.offices[0]?.campaigns[0]?.autoReplyLedger.skipped, 1);

const matches = findOpsPortfolioMatches("dream", [
  { kind: "company", officeId: "office-1", officeName: "North", id: "company-1", name: "Hypnodreamz" },
  { kind: "campaign", officeId: "office-1", officeName: "North", id: "campaign-1", name: "September" },
]);
assert.deepEqual(matches.map((match) => match.id), ["company-1"]);
console.log("Ops portfolio checks passed.");
