import assert from "node:assert/strict";
import {
  FREEMAIL_DOMAINS,
  extractDomain,
  extractEmailAddresses,
  isFreemailDomain,
  parseStoredEmailList,
  selectCounterpartyEmails,
} from "../src/lib/crm/email-touch";

// ── extractEmailAddresses ────────────────────────────────────────────────────
assert.deepEqual(
  extractEmailAddresses('"Doe, Jane" <Jane@Acme.com>, ops@acme.com'),
  ["jane@acme.com", "ops@acme.com"],
  "should extract, lowercase, and keep order from a raw To header",
);
assert.deepEqual(
  extractEmailAddresses("jane@acme.com, jane@acme.com"),
  ["jane@acme.com"],
  "should deduplicate",
);
assert.deepEqual(extractEmailAddresses("no address here"), []);
assert.deepEqual(extractEmailAddresses(""), []);

// ── extractDomain ────────────────────────────────────────────────────────────
assert.equal(extractDomain("Mert Uzun <Mert@UseDerya.com>"), "usederya.com");
assert.equal(extractDomain("sales@acme.co.uk"), "acme.co.uk");
assert.equal(extractDomain("not-an-email"), null);
assert.equal(extractDomain(""), null);

// ── freemail filtering ───────────────────────────────────────────────────────
for (const domain of ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "me.com", "mail.ru", "qq.com", "163.com"]) {
  assert.ok(FREEMAIL_DOMAINS.has(domain), `${domain} should be in FREEMAIL_DOMAINS`);
}
assert.ok(isFreemailDomain("gmail.com"));
assert.ok(isFreemailDomain("GMAIL.COM"), "freemail check should be case-insensitive");
assert.ok(isFreemailDomain(" yandex.ru "), "freemail check should trim");
assert.ok(!isFreemailDomain("usederya.com"));
assert.ok(!isFreemailDomain("maersk.com"));

// ── parseStoredEmailList ─────────────────────────────────────────────────────
assert.deepEqual(parseStoredEmailList('["a@b.com","c@d.com"]'), ["a@b.com", "c@d.com"]);
assert.deepEqual(parseStoredEmailList(null), []);
assert.deepEqual(parseStoredEmailList("plain@addr.com"), ["plain@addr.com"], "non-JSON falls back to raw value");

// ── counterparty selection ───────────────────────────────────────────────────
const officeEmails = ["Ops@UseDerya.com", "loads@usederya.com"];

// INBOUND → the sender.
assert.deepEqual(
  selectCounterpartyEmails({
    direction: "INBOUND",
    fromEmail: "Supplier Sales <Sales@Acme.com>",
    toEmails: ["ops@usederya.com"],
    officeEmails,
  }),
  ["sales@acme.com"],
);

// INBOUND from one of our own accounts (self/internal mail) → no counterparty.
assert.deepEqual(
  selectCounterpartyEmails({
    direction: "INBOUND",
    fromEmail: "ops@usederya.com",
    toEmails: ["loads@usederya.com"],
    officeEmails,
  }),
  [],
);

// OUTBOUND → recipients minus our own account addresses (case-insensitive).
assert.deepEqual(
  selectCounterpartyEmails({
    direction: "OUTBOUND",
    fromEmail: "ops@usederya.com",
    toEmails: ['"A Person" <a@acme.com>, OPS@usederya.com', "b@acme.com", "a@acme.com"],
    officeEmails,
  }),
  ["a@acme.com", "b@acme.com"],
  "outbound should exclude own accounts and dedupe",
);

// OUTBOUND where every recipient is one of ours → nothing to touch.
assert.deepEqual(
  selectCounterpartyEmails({
    direction: "OUTBOUND",
    fromEmail: "ops@usederya.com",
    toEmails: ["loads@usederya.com"],
    officeEmails,
  }),
  [],
);

console.log("crm-email-touch unit test passed");
