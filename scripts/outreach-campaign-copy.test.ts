import assert from "node:assert/strict";
import {
  campaignBlockers,
  campaignDefaultName,
  campaignPersonalizationMap,
  campaignReplyCounts,
  campaignRevisionHash,
  campaignRevisionMatches,
  campaignProgress,
  campaignRowEligible,
  campaignSampleRecipients,
  campaignSendCountsAsAttempt,
  campaignSnapshotOutstandingRecordIds,
  normalizeResearchListQuery,
  asciiCampaignSenderDisplayName,
  buildCampaignFromHeader,
  renderCampaignEmail,
  resolveCampaignOffice,
  normalizeCampaignVariants,
  selectCampaignVariant,
  storedCampaignVariants,
} from "../src/lib/outreach-campaign-copy";
import {
  CAMPAIGN_APPLY_COMMAND,
  CAMPAIGN_GREENLIGHT_COMMAND,
} from "../src/lib/campaign-desk-scope";

const row = {
  status: "new",
  data: {
    company_name: "Baker House",
    country_name: "United Kingdom",
    segment_name: "Bakery",
    email_address: "buyer@baker-house.example",
  },
};

assert.equal(normalizeResearchListQuery("  Maneks   prospects  "), "Maneks prospects");
assert.equal(normalizeResearchListQuery("Maneks prospects (2046)"), "Maneks prospects");
assert.equal(normalizeResearchListQuery("  Wens\tpilot   primary (123)  "), "Wens pilot primary");
assert.equal(normalizeResearchListQuery("wens-pilot-primary (abc)"), "wens-pilot-primary (abc)");
assert.equal(buildCampaignFromHeader("addr@example.com", "Name"), '"Name" <addr@example.com>');
assert.equal(buildCampaignFromHeader("addr@example.com", 'Na"me\\Co'), '"NameCo" <addr@example.com>');
assert.equal(buildCampaignFromHeader("addr@example.com", "Wens Österreich"), "addr@example.com");
assert.equal(buildCampaignFromHeader("addr@example.com", ""), "addr@example.com");
assert.equal(buildCampaignFromHeader("addr@example.com", "   "), "addr@example.com");
assert.equal(asciiCampaignSenderDisplayName("Wens"), "Wens");
assert.equal(asciiCampaignSenderDisplayName("Wens Österreich"), null);
assert.equal(asciiCampaignSenderDisplayName(""), null);
assert.equal(asciiCampaignSenderDisplayName("   "), null);
assert.deepEqual(storedCampaignVariants({ malformed: true }), []);
const testOfficeSlugify = (value: string) => value.toLowerCase().replace(/\s+/g, "-");
assert.equal(resolveCampaignOffice({
  identifier: "Acme Foods",
  offices: [{ id: "office-1", name: "Acme Foods" }],
  slugify: testOfficeSlugify,
}).id, "office-1");
assert.throws(() => resolveCampaignOffice({
  identifier: "Acme Foods",
  offices: [
    { id: "office-1", name: "Acme Foods" },
    { id: "office-2", name: "acme-foods" },
  ],
  slugify: testOfficeSlugify,
}), /ambiguous/);
const replyCounts = campaignReplyCounts({
  threadToCampaign: new Map([
    ["thread-a", { campaignId: "campaign-1", variantKey: "A" }],
    ["thread-b", { campaignId: "campaign-1", variantKey: "B" }],
  ]),
  replies: [
    { threadId: "thread-a", count: 2 },
    { threadId: "thread-b", count: 3 },
  ],
});
assert.equal(replyCounts.totals.get("campaign-1"), 5);
assert.equal(replyCounts.variants.get("campaign-1:A"), 2);
assert.equal(replyCounts.variants.get("campaign-1:B"), 3);
assert.equal("apply abc123".match(CAMPAIGN_APPLY_COMMAND)?.[1], "abc123");
assert.equal("apply update abc123".match(CAMPAIGN_APPLY_COMMAND)?.[1], "abc123");
assert.equal(CAMPAIGN_GREENLIGHT_COMMAND.test("green light"), true);
assert.equal(CAMPAIGN_GREENLIGHT_COMMAND.test("approve it now"), true);
assert.equal(CAMPAIGN_GREENLIGHT_COMMAND.test("greenlighting"), false);

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
assert.deepEqual(renderCampaignEmail({
  subject: "Variant {{company}}",
  bodyTemplate: "Dear {{company}} in {{country}}. Reply STOP to opt out.",
  row: { data: { id: "record-1", email: "buyer@example.com", company: "Baker House", country: "GB" } },
}), {
  subject: "Variant Baker House",
  body: "Dear Baker House in GB. Reply STOP to opt out.",
});
const previewVariant = selectCampaignVariant({
  campaignId: "campaign-preview",
  recordId: "record-1",
  variants: [
    { key: "A", subject: "A {{company}}", bodyTemplate: "{{company}} in {{country}}. Reply STOP to opt out." },
    { key: "B", subject: "B {{company}}", bodyTemplate: "{{company}} in {{country}}. Reply STOP to opt out." },
  ],
});
assert.ok(previewVariant);
const previewEmail = renderCampaignEmail({
  subject: previewVariant.subject,
  bodyTemplate: previewVariant.bodyTemplate,
  row: { data: { id: "record-1", email: "buyer@example.com", company: "Baker House", country: "GB" } },
});
assert.ok(previewEmail.body.includes("Baker House in GB."));

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
  senderDisplayName: null,
  variants: null,
  audienceRecordIds: ["record-1", "record-2"],
  audiencePersonalization: {
    "record-1": { email: "one@example.com", company: "One", country: "UK" },
    "record-2": { email: "two@example.com", company: null, country: "DE" },
  },
};
const revision = campaignRevisionHash(revisionInput);
assert.equal(campaignRevisionMatches(revision, revision), true);
assert.equal(campaignRevisionMatches(`${revision}-changed`, revision), false);
assert.notEqual(campaignRevisionHash({
  ...revisionInput,
  audiencePersonalization: {
    ...revisionInput.audiencePersonalization,
    "record-1": { ...revisionInput.audiencePersonalization["record-1"], email: "changed@example.com" },
  },
}), revision);
assert.notEqual(campaignRevisionHash({
  ...revisionInput,
  variants: [{ key: "A", subject: "Changed", bodyTemplate: "Reply STOP to opt out." }],
}), revision);
assert.deepEqual(normalizeCampaignVariants([
  { key: " A ", subject: " Subject ", bodyTemplate: " Body " },
]), [{ key: "A", subject: "Subject", bodyTemplate: "Body" }]);
assert.throws(() => normalizeCampaignVariants([]), /non-empty array/);
assert.throws(() => normalizeCampaignVariants([
  { key: "A", subject: "One", bodyTemplate: "Body" },
  { key: "A", subject: "Two", bodyTemplate: "Body" },
]), /unique/);
const variantInput = {
  campaignId: "campaign-variants",
  variants: [{ key: "A" }, { key: "B" }],
};
assert.equal(selectCampaignVariant({ ...variantInput, recordId: "record-1" })?.key,
  selectCampaignVariant({ ...variantInput, recordId: "record-1" })?.key);
assert.equal(selectCampaignVariant({ ...variantInput, recordId: "record-1", variants: [] }), null);
const assignments = Array.from({ length: 200 }, (_, index) => selectCampaignVariant({
  ...variantInput,
  recordId: `record-${index}`,
})?.key);
assert.ok(assignments.filter((key) => key === "A").length >= 60);
assert.ok(assignments.filter((key) => key === "B").length >= 60);
assert.notEqual(campaignRevisionHash({
  ...revisionInput,
  senderDisplayName: "Wens",
}), revision);
assert.deepEqual(campaignPersonalizationMap({
  rows: [{
    id: "record-1",
    data: { email_address: "one@example.com", company_name: "One", country_name: "UK" },
  }],
  emailField: "email_address",
  companyField: "company_name",
  countryField: "country_name",
}), {
  "record-1": { email: "one@example.com", company: "One", country: "UK" },
});
assert.doesNotThrow(() => campaignRevisionHash({
  ...revisionInput,
  audiencePersonalization: null,
}));
assert.deepEqual(campaignSnapshotOutstandingRecordIds({
  rows: [{ id: "rejected", status: "rejected" }],
  audienceRecordIds: ["rejected"],
  audiencePersonalization: {
    rejected: { email: "rejected@example.com" },
  },
  statuses: ["new"],
  attemptedRecordIds: new Set(),
}), []);
assert.deepEqual(campaignSnapshotOutstandingRecordIds({
  rows: [{ id: "queued", status: "new" }],
  audienceRecordIds: ["queued"],
  audiencePersonalization: {
    queued: { email: "queued@example.com" },
  },
  statuses: ["new"],
  attemptedRecordIds: new Set(),
}), ["queued"]);
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
assert.deepEqual(campaignBlockers({
  eligible: 1,
  mailboxesAvailable: 1,
  senderPinned: true,
  subject: "A",
  bodyTemplate: "A body. Reply STOP to opt out.",
  dailyCap: 40,
  variants: [
    { key: "A", subject: "A", bodyTemplate: "A body. Reply STOP to opt out." },
    { key: "B", subject: "B", bodyTemplate: "B body." },
  ],
}), ["Variant B body must contain an opt-out line."]);
assert.deepEqual(campaignBlockers({
  eligible: 1,
  mailboxesAvailable: 1,
  senderPinned: true,
  subject: "A",
  bodyTemplate: "A body. Reply STOP to opt out.",
  dailyCap: 40,
  variants: [
    { key: "A", subject: "A", bodyTemplate: "A body. Reply STOP to opt out." },
    { key: "B", subject: "B", bodyTemplate: "B body. Reply STOP to opt out." },
  ],
}), []);
assert.deepEqual(campaignProgress({ total: 2, sent: 4, rejected: 0, unknown: 0 }), {
  total: 2,
  sent: 4,
  rejected: 0,
  unknown: 0,
  remaining: 0,
});

console.log("Outreach campaign copy checks passed.");
