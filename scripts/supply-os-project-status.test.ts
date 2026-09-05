import assert from "node:assert/strict";
import test from "node:test";

import {
  campaignsForProspectingProject,
  isPositiveReply,
  reduceProspectingProjectStatus,
  reduceSourcingProjectStatus,
  sourcingThreadFacts,
  storedQuoteGoalFromJobs,
} from "../src/lib/supply-os/project-status";
import { OTHER_PROJECT } from "../src/lib/supply-os/prospect-project";

test("positive reply heuristic accepts useful supplier intent", () => {
  assert.equal(isPositiveReply("We are interested. Let's schedule a call."), true);
  assert.equal(isPositiveReply("Yes, please send your availability."), true);
  assert.equal(isPositiveReply("Quote is attached."), true);
});

test("positive reply heuristic rejects negative intent", () => {
  assert.equal(isPositiveReply("We are interested, but not interested in this service."), false);
  assert.equal(isPositiveReply("No thanks, please remove me."), false);
  assert.equal(isPositiveReply("unsubscribe"), false);
});

test("sourcing quote goal matches the source workspace", () => {
  const campaign = {
    classKey: "specialist",
    label: "Specialist",
    targetGoodCompanies: 200,
    contactsPerCompany: 2,
    quoteGoal: 8,
    reasons: ["test"],
  };
  assert.equal(storedQuoteGoalFromJobs([
    { payload: { workspaceId: "workspace-a", campaign } },
  ], "workspace-a"), 8);
  assert.equal(storedQuoteGoalFromJobs([
    { payload: { workspaceId: "workspace-a", campaign } },
  ], "workspace-b"), null);
});

test("Other lists status only includes campaigns without a project", () => {
  const campaigns = [
    { list: { projectId: null }, id: "other" },
    { list: { projectId: "project-a" }, id: "project" },
  ];
  assert.deepEqual(
    campaignsForProspectingProject(campaigns, OTHER_PROJECT).map((campaign) => campaign.id),
    ["other"],
  );
});

test("sourcing reducer reports persisted progress and replies", () => {
  const facts = reduceSourcingProjectStatus({
    key: "order-id",
    progress: { vendors: 4, contacted: 3, quoted: 2 },
    facts: {
      material: "steel parts",
      quantity: 100,
      unit: "pcs",
      neededBy: null,
      specification: null,
      destination: null,
      documentNames: [],
    },
    goal: 3,
    threads: [
      {
        threadId: "thread-1",
        latestMessageDirection: "INBOUND",
        latestHumanInboundAt: new Date(),
        latestHumanInboundSubject: "Re: RFQ",
        latestHumanInboundBody: "Happy to quote",
        latestOutboundAt: null,
      },
      {
        threadId: "thread-2",
        latestMessageDirection: "OUTBOUND",
        latestHumanInboundAt: new Date(),
        latestHumanInboundSubject: "Re: RFQ",
        latestHumanInboundBody: "Thanks",
        latestOutboundAt: new Date(),
      },
    ],
  });
  assert.deepEqual(facts, {
    kind: "sourcing",
    key: "order-id",
    leads: 4,
    mailsSent: 3,
    replies: 2,
    activeThreads: 2,
    succeeded: 2,
    successLabel: "quotes in",
    goal: 3,
    escalations: 0,
    escalatedThreadIds: [],
  });
});

test("sourcing reducer marks bounce, wrong recipient, and unanswered commercial questions", () => {
  const replyFacts = {
    material: "steel parts",
    quantity: 100,
    unit: "pcs",
    neededBy: null,
    specification: null,
    destination: null,
    documentNames: [],
  };
  const thread = (threadId: string, subject: string, body: string) => ({
    threadId,
    latestMessageDirection: "INBOUND" as const,
    latestHumanInboundAt: "2026-09-08T10:00:00.000Z",
    latestHumanInboundSubject: subject,
    latestHumanInboundBody: body,
    latestOutboundAt: null,
  });
  const facts = reduceSourcingProjectStatus({
    key: "order-id",
    progress: { vendors: 1, contacted: 1, quoted: 0 },
    facts: replyFacts,
    threads: [
      thread("bounce", "Delivery failure", "Delivery to the following recipient failed."),
      thread("wrong", "Wrong contact", "Please contact the right department."),
      thread("commercial", "Re: RFQ", "What is your target price?"),
      thread("answerable", "Re: RFQ", "What quantity do you need?"),
    ],
  });
  assert.equal(facts.escalations, 3);
  assert.deepEqual(facts.escalatedThreadIds, ["bounce", "wrong", "commercial"]);
});

test("sourcing reducer does not escalate answered or answerable questions", () => {
  const facts = reduceSourcingProjectStatus({
    key: "order-id",
    progress: { vendors: 1, contacted: 1, quoted: 0 },
    facts: {
      material: "steel parts",
      quantity: 100,
      unit: "pcs",
      neededBy: null,
      specification: null,
      destination: null,
      documentNames: [],
    },
    threads: [
      {
        threadId: "answered",
        latestMessageDirection: "OUTBOUND",
        latestHumanInboundAt: "2026-09-08T10:00:00.000Z",
        latestHumanInboundSubject: "Re: RFQ",
        latestHumanInboundBody: "What quantity do you need?",
        latestOutboundAt: "2026-09-08T11:00:00.000Z",
      },
      {
        threadId: "answerable",
        latestMessageDirection: "INBOUND",
        latestHumanInboundAt: "2026-09-08T10:00:00.000Z",
        latestHumanInboundSubject: "Re: RFQ",
        latestHumanInboundBody: "What quantity do you need?",
        latestOutboundAt: null,
      },
    ],
  });
  assert.equal(facts.escalations, 0);
  assert.deepEqual(facts.escalatedThreadIds, []);
});

test("sourcing triage keeps actionable questions beside absence notices", () => {
  const messages = (body: string, id: string, subject = "Re: RFQ") => [{
    id,
    threadId: id,
    direction: "INBOUND",
    fromEmail: "supplier@example.com",
    fromName: null,
    toEmails: ["sourcing@example.com"],
    ccEmails: [],
    subject,
    body,
    sentAt: "2026-09-08T10:00:00.000Z",
    accountEmail: "sourcing@example.com",
    externalThreadId: null,
  }];
  const threadFacts = sourcingThreadFacts([
    ...messages("I am away next week but can you confirm the delivery incoterms? Also, what is your target price?", "actionable"),
    ...messages("I am away next week and will return Monday.", "notice", "Out of office: Re: RFQ"),
  ]);
  const replyFacts = {
    material: "steel parts",
    quantity: 100,
    unit: "pcs",
    neededBy: null,
    specification: null,
    destination: null,
    documentNames: [],
  };
  const actionable = reduceSourcingProjectStatus({
    key: "order-id",
    progress: { vendors: 2, contacted: 2, quoted: 0 },
    facts: replyFacts,
    threads: threadFacts.filter((thread) => thread.threadId === "actionable"),
  });
  assert.deepEqual(actionable.escalatedThreadIds, ["actionable"]);
  assert.deepEqual(
    threadFacts.find((thread) => thread.threadId === "notice")?.latestInboundAt ?? null,
    null,
  );
});

test("prospecting reducer aggregates campaigns and positive replies", () => {
  const facts = reduceProspectingProjectStatus({
    key: "project-id",
    campaigns: [
      { total: 10, sent: 4, followUpsSent: 1 },
      { total: 5, sent: 2, followUpsSent: 0 },
    ],
    replies: [
      { body: "Let's meet next week", active: true },
      { body: "No thanks", active: false },
    ],
  });
  assert.deepEqual(facts, {
    kind: "prospecting",
    key: "project-id",
    leads: 15,
    mailsSent: 7,
    replies: 2,
    activeThreads: 1,
    succeeded: 1,
    successLabel: "positive replies",
    goal: null,
    escalations: 0,
    escalatedThreadIds: [],
  });
});
