import assert from "node:assert/strict";
import {
  campaignBlockers,
  campaignDefaultName,
  campaignRevisionHash,
  campaignRevisionMatches,
  campaignProgress,
  campaignRowEligible,
  campaignSampleRecipients,
  campaignSendCountsAsAttempt,
  renderCampaignEmail,
} from "../src/lib/outreach-campaign-copy";

const row = {
  status: "new",
  data: {
    company_name: "Baker House",
    country_name: "United Kingdom",
    segment_name: "Bakery",
    email_address: "buyer@baker-house.example",
  },
};

const rendered = renderCampaignEmail({
  subject: " Hello {{company}}\n",
  bodyTemplate: "Dear {{company}},\nWe serve {{country}}.\nReply STOP to opt out.",
  row: {
    company: row.data.company_name,
    country: row.data.country_name,
    email: row.data.email_address,
  },
});
assert.equal(rendered.subject, "Hello Baker House");
assert.ok(rendered.body.includes("Reply STOP to opt out."));
assert.ok(!rendered.body.includes("\u2014"));

assert.equal(campaignRowEligible({
  row,
  statuses: ["new", "reviewed"],
  countries: ["united kingdom"],
  segments: ["bakery"],
  emailField: "email_address",
  countryField: "country_name",
  segmentField: "segment_name",
}), true);
assert.equal(campaignRowEligible({
  row: { ...row, data: { ...row.data, email_address: "not-an-email" } },
  statuses: ["new"],
  emailField: "email_address",
}), false);
assert.deepEqual(campaignSampleRecipients({
  rows: Array.from({ length: 11 }, (_, index) => ({
    id: `record-${index}`,
    data: {
      email: `buyer-${index}@example.com`,
      company: `Company ${index}`,
      country: "United Kingdom",
    },
  })),
  emailField: "email",
}), Array.from({ length: 10 }, (_, index) => ({
  id: `record-${index}`,
  email: `buyer-${index}@example.com`,
  company: `Company ${index}`,
  country: "United Kingdom",
})));
const revisionInput = {
  subject: "Subject",
  bodyTemplate: "Reply STOP to opt out.",
  emailField: "email",
  rowStatuses: ["new"],
  filters: { countries: ["United Kingdom"] },
  dailyCap: 40,
  senderAccountId: "account-1",
  audienceRecordIds: ["record-1", "record-2"],
};
const revision = campaignRevisionHash(revisionInput);
assert.equal(campaignRevisionMatches(revision, revision), true);
assert.equal(campaignRevisionMatches(`${revision}-changed`, revision), false);
assert.equal(campaignDefaultName("Outreach: Wens", new Set()), "Outreach: Wens");
assert.equal(campaignDefaultName("Outreach: Wens", new Set(["Outreach: Wens", "Outreach: Wens (2)"])), "Outreach: Wens (3)");
assert.equal(campaignSendCountsAsAttempt("QUEUED"), false);
assert.equal(campaignSendCountsAsAttempt("SENT"), true);
assert.equal(campaignSendCountsAsAttempt("REJECTED"), true);
assert.equal(campaignSendCountsAsAttempt("UNKNOWN"), true);

assert.deepEqual(campaignBlockers({
  eligible: 0,
  mailboxesAvailable: 0,
  senderPinned: false,
  subject: "",
  bodyTemplate: "Hello",
  dailyCap: 201,
}), [
  "Subject is required.",
  "Body must contain an opt-out line.",
  "No mailbox is connected for sending.",
  "No eligible rows in this list.",
  "Daily cap must be between 1 and 200.",
]);
assert.deepEqual(campaignBlockers({
  eligible: 1,
  mailboxesAvailable: 1,
  senderPinned: false,
  subject: "Subject",
  bodyTemplate: "Reply STOP to opt out.",
  dailyCap: 40,
}), ["Select a sender mailbox."]);
assert.deepEqual(campaignProgress({ total: 2, sent: 4, rejected: 0, unknown: 0 }), {
  total: 2,
  sent: 4,
  rejected: 0,
  unknown: 0,
  remaining: 0,
});

console.log("Outreach campaign copy checks passed.");
