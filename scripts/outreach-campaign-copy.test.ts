import assert from "node:assert/strict";
import {
  campaignBlockers,
  campaignDefaultName,
  campaignDraftOnlyBlocker,
  campaignEmailFieldKey,
  excludeContactedRecipients,
  campaignActivationTransitionWhere,
  campaignFollowUpBlockers,
  campaignFollowUpDueAt,
  campaignFollowUpSubject,
  campaignPersonalizationMap,
  campaignReferencedFieldKeys,
  campaignMergeFieldCapBlocker,
  snapshotMergeFields,
  campaignReplyCounts,
  normalizeCampaignFollowUps,
  planCampaignFollowUps,
  campaignRevisionHash,
  campaignRevisionMatches,
  campaignProgress,
  campaignRowEligible,
  campaignSampleRecipients,
  campaignSendCountsAsAttempt,
  campaignSnapshotOutstandingRecordIds,
  dedupeRecipients,
  selectCampaignAudience,
  outreachCampaignContactedWhere,
  outreachCampaignReclaimBefore,
  normalizeResearchListQuery,
  asciiCampaignSenderDisplayName,
  buildCampaignFromHeader,
  renderCampaignEmail,
  campaignMergeFields,
  applyCampaignCopyEdit,
  mergeFieldsAvailable,
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
    email_address: "buyer@baker-house.eu",
  },
};

assert.equal(normalizeResearchListQuery("  Maneks   prospects  "), "Maneks prospects");
assert.equal(normalizeResearchListQuery("Maneks prospects (2046)"), "Maneks prospects");
assert.equal(normalizeResearchListQuery("  Wens\tpilot   primary (123)  "), "Wens pilot primary");
assert.equal(normalizeResearchListQuery("wens-pilot-primary (abc)"), "wens-pilot-primary (abc)");
assert.equal(buildCampaignFromHeader("addr@buyerco.com", "Name"), '"Name" <addr@buyerco.com>');
assert.equal(buildCampaignFromHeader("addr@buyerco.com", 'Na"me\\Co'), '"NameCo" <addr@buyerco.com>');
assert.equal(buildCampaignFromHeader("addr@buyerco.com", "Wens Österreich"), "addr@buyerco.com");
assert.equal(buildCampaignFromHeader("addr@buyerco.com", ""), "addr@buyerco.com");
assert.equal(buildCampaignFromHeader("addr@buyerco.com", "   "), "addr@buyerco.com");
assert.equal(asciiCampaignSenderDisplayName("Wens"), "Wens");
assert.equal(asciiCampaignSenderDisplayName("Wens Österreich"), null);
assert.equal(asciiCampaignSenderDisplayName(""), null);
assert.equal(asciiCampaignSenderDisplayName("   "), null);
assert.deepEqual(storedCampaignVariants({ malformed: true }), []);
assert.equal(campaignDraftOnlyBlocker("DRAFT"), null);
assert.equal(campaignEmailFieldKey([{ key: "other", type: "text" }], " explicit "), "explicit");
assert.equal(campaignEmailFieldKey([{ key: "typed", type: "email" }]), "typed");
assert.equal(campaignEmailFieldKey([
  { key: "primary_email", type: "text" },
  { key: "email_type", type: "text" },
]), "primary_email");
assert.equal(campaignEmailFieldKey([
  { key: "email_type", type: "text" },
  { key: "email", type: "text" },
]), "email");
assert.equal(campaignEmailFieldKey([
  { key: "company", type: "text" },
  { key: "primary_email", type: "text" },
]), "primary_email");
assert.equal(campaignEmailFieldKey([
  { key: "email_verdict", type: "text" },
  { key: "email_confidence", type: "text" },
  { key: "primary_email", type: "text" },
]), "primary_email");
assert.equal(campaignEmailFieldKey([
  { key: "email_type", type: "text" },
  { key: "email_status", type: "text" },
]), "email");
assert.equal(campaignEmailFieldKey([{ key: "company", type: "text" }]), "email");
assert.equal(
  campaignDraftOnlyBlocker("CANCELLED"),
  "This campaign is cancelled, not a draft. Plan it again.",
);
assert.equal(
  campaignDraftOnlyBlocker("COMPLETED"),
  "This campaign is completed, not a draft. Plan it again.",
);
assert.deepEqual(campaignActivationTransitionWhere({
  officeId: "office-1",
  campaignId: "campaign-1",
  revisionHash: "revision-1",
}), {
  id: "campaign-1",
  officeId: "office-1",
  status: "DRAFT",
  revisionHash: "revision-1",
});
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
  row: { data: { id: "record-1", email: "buyer@buyerco.com", company: "Baker House", country: "GB" } },
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
  row: { data: { id: "record-1", email: "buyer@buyerco.com", company: "Baker House", country: "GB" } },
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
      email: `buyer-${index}@buyerco.com`,
      company: `Company ${index}`,
      country: "United Kingdom",
    },
  })),
  emailField: "email",
}), Array.from({ length: 10 }, (_, index) => ({
  id: `record-${index}`,
  email: `buyer-${index}@buyerco.com`,
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
  senderRotation: false,
  senderDisplayName: null,
  variants: null,
  audienceRecordIds: ["record-1", "record-2"],
  audiencePersonalization: {
    "record-1": { email: "one@buyerco.com", company: "One", country: "UK" },
    "record-2": { email: "two@buyerco.com", company: null, country: "DE" },
  },
};
const revision = campaignRevisionHash(revisionInput);
assert.equal(campaignRevisionMatches(revision, revision), true);
assert.equal(campaignRevisionMatches(`${revision}-changed`, revision), false);
assert.notEqual(campaignRevisionHash({
  ...revisionInput,
  audiencePersonalization: {
    ...revisionInput.audiencePersonalization,
    "record-1": { ...revisionInput.audiencePersonalization["record-1"], email: "changed@buyerco.com" },
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
assert.notEqual(campaignRevisionHash({
  ...revisionInput,
  senderRotation: true,
}), revision);
assert.deepEqual(campaignPersonalizationMap({
  rows: [{
    id: "record-1",
    data: { email_address: "one@buyerco.com", company_name: "One", country_name: "UK" },
  }],
  emailField: "email_address",
  companyField: "company_name",
  countryField: "country_name",
}), {
    "record-1": {
      email: "one@buyerco.com",
      company: "One",
      country: "UK",
      fields: {
        company: "One",
        country: "UK",
        email: "one@buyerco.com",
        "field:email_address": "one@buyerco.com",
        "field:company_name": "One",
        "field:country_name": "UK",
      },
    },
});
assert.deepEqual(campaignMergeFields({
  data: {
    email_address: "hello@example.com",
    company_name: "Baker House",
    contact_name: "Jane Smith",
    town: "Bath",
    county: "Somerset",
    postcode: "BA1 1AA",
    website: "https://www.baker-house.example/path",
    segment: "tea_room",
    google_rating: 4.8,
    google_reviews: 123,
  },
  emailField: "email_address",
  companyField: "company_name",
}), {
  company: "Baker House",
  country: "",
  email: "hello@example.com",
  first_name: "Jane",
  name: "Jane Smith",
  town: "Bath",
  county: "Somerset",
  postcode: "BA1 1AA",
  location: "Bath, Somerset",
  website: "baker-house.example",
  segment: "tea_room",
  segment_label: "tea room",
  rating: "4.8",
  reviews: "123",
  ai_intro: "",
  "field:email_address": "hello@example.com",
  "field:company_name": "Baker House",
  "field:contact_name": "Jane Smith",
  "field:town": "Bath",
  "field:county": "Somerset",
  "field:postcode": "BA1 1AA",
  "field:website": "https://www.baker-house.example/path",
  "field:segment": "tea_room",
  "field:google_rating": "4.8",
  "field:google_reviews": "123",
});
const businessNameOnlyFields = campaignMergeFields({
  data: { name: "Acme Ltd", email: "buyer@acme.example" },
  emailField: "email",
});
assert.equal(businessNameOnlyFields.first_name, "");
assert.equal(businessNameOnlyFields.name, "");
const prefixedFieldFields = campaignMergeFields({
  data: { "field:some_custom": "Snapshot value" },
  emailField: "email",
});
assert.equal(prefixedFieldFields["field:some_custom"], "Snapshot value");
assert.equal(prefixedFieldFields["field:field:some_custom"], undefined);
const lateFields = Object.fromEntries(
  [...Array(45)].map((_, index) => [`field:custom_${index}`, `value-${index}`]),
);
lateFields["field:zz"] = "late value";
assert.equal(snapshotMergeFields(lateFields, ["field:zz"])["field:zz"], "late value");
const aliasFieldsWithCustomCap = Object.fromEntries(
  [...Array(40)].map((_, index) => [`field:custom_${index}`, `value-${index}`]),
);
aliasFieldsWithCustomCap.first_name = "Jane";
aliasFieldsWithCustomCap.town = "Bath";
const aliasFieldsSnapshot = snapshotMergeFields(aliasFieldsWithCustomCap);
assert.equal(aliasFieldsSnapshot.first_name, "Jane");
assert.equal(aliasFieldsSnapshot.town, "Bath");
assert.equal(
  Object.keys(aliasFieldsSnapshot).filter((key) => key.startsWith("field:")).length,
  40,
);
assert.deepEqual(campaignReferencedFieldKeys(["{{field:one|{{field:two}}}}"]), ["field:one", "field:two"]);
assert.equal(
  campaignMergeFieldCapBlocker([...Array(41)].map((_, index) => `{{field:custom_${index}}}`)),
  "Campaign references more than 40 custom merge fields.",
);
const variantBaseEdit = applyCampaignCopyEdit({
  subject: "Old subject",
  bodyTemplate: "Old body",
  storedVariants: [{ key: "old", subject: "Old subject", bodyTemplate: "Old body" }],
  suppliedVariants: [{ key: "new", subject: "New subject", bodyTemplate: "New body" }],
  variantsProvided: true,
});
assert.equal(variantBaseEdit.subject, "New subject");
assert.equal(variantBaseEdit.bodyTemplate, "New body");
const directBaseEdit = applyCampaignCopyEdit({
  subject: "Old subject",
  bodyTemplate: "Old body",
  storedVariants: [
    { key: "old", subject: "Old subject", bodyTemplate: "Old body" },
    { key: "other", subject: "Other subject", bodyTemplate: "Other body" },
  ],
  suppliedSubject: "Edited subject",
  suppliedBodyTemplate: "Edited body",
  variantsProvided: false,
});
assert.deepEqual(directBaseEdit.variants, [
  { key: "old", subject: "Edited subject", bodyTemplate: "Edited body" },
  { key: "other", subject: "Other subject", bodyTemplate: "Other body" },
]);
assert.equal(campaignActivationTransitionWhere({
  officeId: "office-1",
  campaignId: "campaign-1",
  revisionHash: "revision-1",
  status: "PAUSED",
}).status, "PAUSED");
assert.deepEqual(mergeFieldsAvailable({
  "record-1": {
    email: "one@example.com",
    company: "One",
    country: "UK",
    fields: { email: "one@example.com", company: "One" },
  },
  "record-2": {
    email: "two@example.com",
    company: null,
    country: null,
    fields: { email: "two@example.com" },
  },
  "record-3": {
    email: "three@example.com",
    company: "Three",
    country: null,
  },
}), ["email", "company"]);
const nestedRow = { data: { company: "Baker House", email: "x@example.com" } };
assert.equal(renderCampaignEmail({
  subject: "",
  bodyTemplate: "Hi {{first_name|{{company}} team}},",
  row: nestedRow,
}).body, "Hi Baker House team,");
assert.equal(renderCampaignEmail({
  subject: "",
  bodyTemplate: "{{ai_intro|... across {{county|the South of England}}.}}",
  row: nestedRow,
}).body, "... across the South of England.");
assert.equal(campaignBlockers({
  eligible: 1,
  mailboxesAvailable: 1,
  poolCapacityToday: 1,
  senderPinned: true,
  senderRotation: false,
  subject: "Hi {{unknown}}",
  bodyTemplate: "Reply STOP to opt out.",
  dailyCap: 1,
})[0], "Unknown merge field {{unknown}}");
assert.doesNotThrow(() => campaignRevisionHash({
  ...revisionInput,
  audiencePersonalization: null,
}));
assert.deepEqual(campaignSnapshotOutstandingRecordIds({
  rows: [{ id: "rejected", status: "rejected" }],
  audienceRecordIds: ["rejected"],
  audiencePersonalization: {
    rejected: { email: "rejected@buyerco.com" },
  },
  statuses: ["new"],
  attemptedRecordIds: new Set(),
}), []);
const contactedWhereNow = new Date("2026-09-03T12:00:00.000Z");
assert.deepEqual(outreachCampaignContactedWhere({
  officeId: "office-1",
  campaignId: "campaign-1",
  now: contactedWhereNow,
}), {
  officeId: "office-1",
  campaignId: { not: "campaign-1" },
  OR: [
    { status: { in: ["SENT", "UNKNOWN"] } },
    {
      status: "QUEUED",
      createdAt: { gte: outreachCampaignReclaimBefore(contactedWhereNow) },
      campaign: { status: { not: "CANCELLED" } },
    },
  ],
});
assert.deepEqual(campaignSnapshotOutstandingRecordIds({
  rows: [{ id: "queued", status: "new" }],
  audienceRecordIds: ["queued"],
  audiencePersonalization: {
    queued: { email: "queued@buyerco.com" },
  },
  statuses: ["new"],
  attemptedRecordIds: new Set(),
}), ["queued"]);
assert.deepEqual(dedupeRecipients({
  rows: [
    { id: "first", email: " Buyer@BuyerCo.com " },
    { id: "second", email: "buyer@buyerco.com" },
    { id: "third", email: "other@buyerco.com" },
  ],
  recipientOf: (item) => item.email,
}), [
  { id: "first", email: " Buyer@BuyerCo.com " },
  { id: "third", email: "other@buyerco.com" },
]);
assert.deepEqual(campaignSnapshotOutstandingRecordIds({
  rows: [{ id: "blocked", status: "new" }],
  audienceRecordIds: ["blocked"],
  audiencePersonalization: {
    blocked: { email: "blocked@buyerco.com" },
  },
  statuses: ["new"],
  attemptedRecordIds: new Set(),
  blockedRecipients: new Set([" BLOCKED@BUYERCO.COM ".trim().toLowerCase()]),
}), []);
assert.equal(campaignDefaultName("Outreach: Wens", new Set()), "Outreach: Wens");
assert.equal(campaignDefaultName("Outreach: Wens", new Set(["Outreach: Wens", "Outreach: Wens (2)"])), "Outreach: Wens (3)");
assert.equal(campaignSendCountsAsAttempt("QUEUED"), false);
assert.equal(campaignSendCountsAsAttempt("SENT"), true);
assert.equal(campaignSendCountsAsAttempt("REJECTED"), true);
assert.equal(campaignSendCountsAsAttempt("UNKNOWN"), true);

assert.deepEqual(campaignBlockers({
  eligible: 0,
  mailboxesAvailable: 0,
  poolCapacityToday: 0,
  senderPinned: false,
  senderRotation: false,
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
  poolCapacityToday: 30,
  senderPinned: false,
  senderRotation: false,
  subject: "Subject",
  bodyTemplate: "Reply STOP to opt out.",
  dailyCap: 40,
}), ["Select a sender mailbox."]);
assert.deepEqual(campaignBlockers({
  eligible: 1,
  mailboxesAvailable: 1,
  poolCapacityToday: 30,
  senderPinned: true,
  senderRotation: false,
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
  poolCapacityToday: 30,
  senderPinned: true,
  senderRotation: false,
  subject: "A",
  bodyTemplate: "A body. Reply STOP to opt out.",
  dailyCap: 40,
  variants: [
    { key: "A", subject: "A", bodyTemplate: "A body. Reply STOP to opt out." },
    { key: "B", subject: "B", bodyTemplate: "B body. Reply STOP to opt out." },
  ],
}), []);
assert.deepEqual(campaignBlockers({
  eligible: 1,
  mailboxesAvailable: 1,
  poolCapacityToday: 30,
  senderPinned: true,
  senderRotation: true,
  subject: "A",
  bodyTemplate: "A body. Reply STOP to opt out.",
  dailyCap: 40,
}), ["Pick either a sender mailbox or rotation, not both."]);
assert.deepEqual(campaignBlockers({
  eligible: 1,
  mailboxesAvailable: 0,
  poolCapacityToday: 0,
  senderPinned: false,
  senderRotation: true,
  subject: "A",
  bodyTemplate: "A body. Reply STOP to opt out.",
  dailyCap: 40,
}), ["No mailbox in the shared pool has capacity today."]);
assert.deepEqual(campaignBlockers({
  eligible: 1,
  mailboxesAvailable: 1,
  poolCapacityToday: 30,
  senderPinned: false,
  senderRotation: true,
  subject: "A",
  bodyTemplate: "A body. Reply STOP to opt out.",
  dailyCap: 500,
}), []);
assert.deepEqual(campaignBlockers({
  eligible: 1,
  mailboxesAvailable: 1,
  poolCapacityToday: 30,
  senderPinned: false,
  senderRotation: true,
  subject: "A",
  bodyTemplate: "A body. Reply STOP to opt out.",
  dailyCap: 501,
}), ["Daily cap must be between 1 and 500."]);
assert.deepEqual(excludeContactedRecipients({
  rows: [
    { id: "one", email: " First@BuyerCo.com " },
    { id: "two", email: "second@buyerco.com" },
    { id: "three", email: "third@buyerco.com" },
  ],
  recipientOf: (row) => row.email,
  contacted: new Set(["first@buyerco.com", " THIRD@buyerco.com "].map((email) => email.trim().toLowerCase())),
}), [{ id: "two", email: "second@buyerco.com" }]);

// Office suppression and already-contacted rows leave the audience before the
// same-domain cap, so a suppressed or contacted address never consumes one of
// the domain's slots that a later valid address on the same domain needs.
{
  const buyerRow = (id: string, email: string) => ({ id, status: "new", data: { email, website: "https://buyerco.com" } });
  const audience = selectCampaignAudience({
    records: [
      buyerRow("suppressed", "bounced@buyerco.com"),
      buyerRow("contacted", "reached@buyerco.com"),
      buyerRow("dup", "Reached@BuyerCo.com"),
      buyerRow("placeholder", "someone@example.com"),
      buyerRow("one", "one@buyerco.com"),
      buyerRow("two", "two@buyerco.com"),
      buyerRow("three", "three@buyerco.com"),
      buyerRow("four", "four@buyerco.com"),
    ],
    statuses: ["new"],
    emailField: "email",
    suppressed: new Set(["bounced@buyerco.com"]),
    contacted: new Set(["reached@buyerco.com"]),
  });
  assert.deepEqual(audience.eligible.map((row) => row.id), ["one", "two", "three"], "the first three valid, unsuppressed, uncontacted addresses fill the domain cap");
  assert.equal(audience.suppressed, 1);
  assert.equal(audience.contacted, 2, "contacted matching is case-insensitive");
  assert.deepEqual(audience.pruned.reasons, [
    { reason: "DOMAIN_CONCENTRATION", count: 1 },
    { reason: "PLACEHOLDER_ADDRESS", count: 1 },
  ]);
  assert.deepEqual(audience.pruned.examples, ["someone@example.com", "four@buyerco.com"], "only the fourth valid address is over the cap");

  // Malformed dot-atom or domain-label addresses are pruned at planning, and a
  // real mailbox provider or organisation domain is not mistaken for a
  // placeholder.
  const syntaxAudience = selectCampaignAudience({
    records: [
      buyerRow("leading-dot", ".ops@buyerco.com"),
      buyerRow("double-dot", "ops..team@buyerco.com"),
      buyerRow("hyphen-label", "ops@-buyerco.com"),
      buyerRow("empty-label", "ops@buyerco..com"),
      { id: "provider", status: "new", data: { email: "buyer@email.com", website: "https://email.com" } },
      { id: "org", status: "new", data: { email: "team@w3.org", website: "https://w3.org" } },
    ],
    statuses: ["new"],
    emailField: "email",
    suppressed: new Set(),
    contacted: new Set(),
  });
  assert.deepEqual(syntaxAudience.eligible.map((row) => row.id), ["provider", "org"]);
  assert.deepEqual(syntaxAudience.pruned.reasons, [{ reason: "INVALID_SYNTAX", count: 4 }]);
}
assert.deepEqual(campaignProgress({ total: 2, sent: 4, rejected: 0, unknown: 0 }), {
  total: 2,
  sent: 4,
  rejected: 0,
  unknown: 0,
  remaining: 0,
});

const followUps = normalizeCampaignFollowUps([
  { wait_days: 3, body: "Still interested? Reply STOP to opt out." },
  { waitDays: "5", subject: "Quick nudge \u2014 {{company}}", bodyTemplate: "Last check. Reply STOP to opt out." },
  { waitDays: 2 },
  "junk",
]);
assert.deepEqual(followUps, [
  { waitDays: 3, subject: null, bodyTemplate: "Still interested? Reply STOP to opt out." },
  { waitDays: 5, subject: "Quick nudge - {{company}}", bodyTemplate: "Last check. Reply STOP to opt out." },
]);
assert.deepEqual(normalizeCampaignFollowUps(null), []);
assert.deepEqual(campaignFollowUpBlockers(followUps), []);
assert.deepEqual(campaignFollowUpBlockers([
  { waitDays: 0, subject: null, bodyTemplate: "Just checking in." },
  { waitDays: 31, subject: null, bodyTemplate: "Reply STOP to opt out." },
  { waitDays: 2, subject: null, bodyTemplate: "Reply STOP to opt out." },
  { waitDays: 2, subject: null, bodyTemplate: "Reply STOP to opt out." },
]), [
  "At most 3 follow-up steps are allowed.",
  "Follow-up 1 must wait between 1 and 30 days.",
  "Follow-up 1 body must contain an opt-out line.",
  "Follow-up 2 must wait between 1 and 30 days.",
]);
assert.equal(campaignFollowUpSubject({ waitDays: 1, subject: null, bodyTemplate: "x" }, "Hello Baker House"), "Re: Hello Baker House");
assert.equal(campaignFollowUpSubject({ waitDays: 1, subject: null, bodyTemplate: "x" }, "Re: Hello"), "Re: Hello");
assert.equal(campaignFollowUpSubject({ waitDays: 1, subject: "Custom", bodyTemplate: "x" }, "Hello"), "Custom");
assert.equal(campaignFollowUpDueAt(new Date("2026-01-01T00:00:00Z"), 3).toISOString(), "2026-01-04T00:00:00.000Z");
assert.notEqual(
  campaignRevisionHash({ ...revisionInput, followUps: [] }),
  campaignRevisionHash({ ...revisionInput, followUps }),
);

const sequenceSteps = [
  { waitDays: 3, subject: null, bodyTemplate: "One. Reply STOP to opt out." },
  { waitDays: 4, subject: null, bodyTemplate: "Two. Reply STOP to opt out." },
];
const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset, 9));
const sends = [
  { recordId: "r-late", recipient: "Late@BuyerCo.com", sentAt: day(0), localThreadId: "t-late", providerThreadId: "p-late" },
  { recordId: "r-early", recipient: "early@buyerco.com", sentAt: day(-4), localThreadId: "t-early", providerThreadId: "p-early" },
  { recordId: "r-replied", recipient: "replied@buyerco.com", sentAt: day(-6), localThreadId: "t-replied", providerThreadId: null },
  { recordId: "r-bounced", recipient: "bounced@buyerco.com", sentAt: day(-6), localThreadId: "t-bounced", providerThreadId: null },
  { recordId: "r-suppressed", recipient: "gone@buyerco.com", sentAt: day(-6), localThreadId: null, providerThreadId: null },
  { recordId: "r-queued", recipient: "queued@buyerco.com", sentAt: day(-6), localThreadId: "t-queued", providerThreadId: null },
  { recordId: "r-rejected", recipient: "rejected@buyerco.com", sentAt: day(-9), localThreadId: "t-rejected", providerThreadId: null },
  { recordId: "r-step2", recipient: "step2@buyerco.com", sentAt: day(-9), localThreadId: "t-step2", providerThreadId: "p-step2" },
  { recordId: "r-done", recipient: "done@buyerco.com", sentAt: day(-20), localThreadId: "t-done", providerThreadId: null },
  { recordId: "r-unsent", recipient: "unsent@buyerco.com", sentAt: null, localThreadId: null, providerThreadId: null },
];
const plan = planCampaignFollowUps({
  steps: sequenceSteps,
  sends,
  followUps: [
    { recordId: "r-queued", step: 1, status: "QUEUED", sentAt: null },
    { recordId: "r-rejected", step: 1, status: "REJECTED", sentAt: null },
    { recordId: "r-step2", step: 1, status: "SENT", sentAt: day(-5) },
    { recordId: "r-done", step: 1, status: "SENT", sentAt: day(-15) },
    { recordId: "r-done", step: 2, status: "SENT", sentAt: day(-10) },
  ],
  repliedThreadIds: new Set(["t-replied"]),
  bouncedRecipients: new Set(["bounced@buyerco.com"]),
  suppressedRecipients: new Set(["gone@buyerco.com"]),
  now: day(0),
});
assert.deepEqual(plan.due.map((item) => [item.recordId, item.step, item.dueAt.toISOString(), item.providerThreadId]), [
  ["r-step2", 2, day(-1).toISOString(), "p-step2"],
  ["r-early", 1, day(-1).toISOString(), "p-early"],
]);
assert.deepEqual(plan.skips, [
  { recordId: "r-bounced", recipient: "bounced@buyerco.com", step: 1, reason: "BOUNCED" },
  { recordId: "r-replied", recipient: "replied@buyerco.com", step: 1, reason: "REPLIED" },
  { recordId: "r-suppressed", recipient: "gone@buyerco.com", step: 1, reason: "SUPPRESSED" },
]);
assert.equal(plan.outstanding, 4, "queued, step2, early, and late (not yet due) sequences remain outstanding");
assert.deepEqual(planCampaignFollowUps({ steps: [], sends, followUps: [], repliedThreadIds: new Set(), now: day(0) }), {
  due: [],
  skips: [],
  outstanding: 0,
});

console.log("Outreach campaign copy checks passed.");
