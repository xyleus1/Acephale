import assert from "node:assert/strict";
import {
  emailWorkflowLabelKeys,
  isLoadRfqRelatedClassification,
  isLoadRfqRelatedThread,
  primaryEmailWorkflowLabel,
} from "../src/lib/email-workflow-labels";
import {
  DERYA_LOAD_RFQ_INBOX_EMAILS,
  DERYA_RFQ_SOURCE_EMAILS,
  getDeryaLoadRfqInbox,
  isDeryaLoadRfqInbox,
  isDeryaRfqSourceSender,
  parseDeryaLoadRfqInboxEnv,
  parseDeryaRfqSourceEmailEnv,
} from "../src/lib/derya-inboxes";

assert(DERYA_LOAD_RFQ_INBOX_EMAILS.includes("mert@usederya.com"));
assert(DERYA_LOAD_RFQ_INBOX_EMAILS.includes("oguzhan@usederya.com"));
assert(DERYA_RFQ_SOURCE_EMAILS.includes("rfq@usederya.com"));
assert.equal(isDeryaLoadRfqInbox("MERT@USEDERYA.COM"), true);
assert.equal(isDeryaLoadRfqInbox("ops@example.com"), false);
assert.equal(isDeryaRfqSourceSender("RFQ@USEDERYA.COM"), true);
assert.equal(isDeryaRfqSourceSender("calendar@usederya.com"), false);
assert.equal(getDeryaLoadRfqInbox("oguzhan@usederya.com")?.owner, "Oguzhan");
assert.deepEqual(
  parseDeryaLoadRfqInboxEnv("mert@usederya.com, ops@usederya.com, MERT@USEDERYA.COM").map((inbox) => ({
    email: inbox.email,
    owner: inbox.owner,
  })),
  [
    { email: "mert@usederya.com", owner: "Mert" },
    { email: "ops@usederya.com", owner: "Ops" },
  ],
);
assert.deepEqual(
  parseDeryaRfqSourceEmailEnv("rfq@usederya.com, freight@usederya.com, RFQ@USEDERYA.COM"),
  ["rfq@usederya.com", "freight@usederya.com"],
);

assert.equal(isLoadRfqRelatedClassification("RFQ"), true);
assert.equal(isLoadRfqRelatedClassification("RELATED_NOTE"), true);
assert.equal(isLoadRfqRelatedClassification("OTHER"), false);
assert.equal(isLoadRfqRelatedThread({ classifications: ["OTHER"], jobId: "job_1" }), true);
assert.equal(isLoadRfqRelatedThread({ classifications: ["OTHER"], jobId: null, inquiryId: null }), false);

assert.equal(primaryEmailWorkflowLabel({ kind: "RFQ" }).label, "load/rfq");
assert.equal(primaryEmailWorkflowLabel({ kind: "CARRIER_REPLY" }).label, "load/forwarder");
assert.equal(primaryEmailWorkflowLabel({ kind: "CUSTOMER_REPLY", jobId: "job_1" }).label, "load/customer");
assert.equal(primaryEmailWorkflowLabel({ kind: "OTHER", jobId: "job_1" }).label, "load/linked");
assert.equal(primaryEmailWorkflowLabel({ kind: null }).label, "mail/unclassified");
assert.deepEqual(emailWorkflowLabelKeys({ kind: "RFQ", inquiryId: "inq_1" }), ["load_rfq", "load_related"]);

console.log("email-workflow-labels ok");
