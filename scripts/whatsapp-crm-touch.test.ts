import assert from "node:assert/strict";
import {
  normalizeWhatsAppCounterparty,
  phoneMatchesWaDigits,
  selectCounterpartyEmails,
} from "../src/lib/crm/email-touch";

// WhatsApp counterparty normalization.
assert.equal(normalizeWhatsAppCounterparty("whatsapp:905321112233"), "whatsapp:905321112233");
assert.equal(normalizeWhatsAppCounterparty("WhatsApp:+90 532 111 22 33"), "whatsapp:905321112233");
assert.equal(normalizeWhatsAppCounterparty("whatsapp:12"), null);
assert.equal(normalizeWhatsAppCounterparty("lead@example.com"), null);
assert.equal(normalizeWhatsAppCounterparty(null), null);

// Phone ↔ WhatsApp digit matching across operator formats.
assert.equal(phoneMatchesWaDigits("+90 532 111 22 33", "905321112233"), true);
assert.equal(phoneMatchesWaDigits("0532 111 22 33", "905321112233"), true, "TR local format normalizes");
assert.equal(phoneMatchesWaDigits("532 111 22 33", "905321112233"), true);
assert.equal(phoneMatchesWaDigits("00 90 532 111 22 33", "905321112233"), true);
assert.equal(phoneMatchesWaDigits("0532 111 22 34", "905321112233"), false, "different number");
assert.equal(phoneMatchesWaDigits("+962 79 818 5729", "905321112233"), false);
assert.equal(phoneMatchesWaDigits(null, "905321112233"), false);
assert.equal(phoneMatchesWaDigits("0532 111 22 33", "12345"), false, "short digits never match");
// Full international numbers must match exactly - no suffix shortcut that
// could cross country codes or swallow extension junk.
assert.equal(phoneMatchesWaDigits("+44 532 111 22 33", "905321112233"), false, "same national suffix, different country");
assert.equal(phoneMatchesWaDigits("+90 532 111 22 33 dahili 99", "905321112233"), false, "extension digits break the number");

// Counterparty selection passes WhatsApp addresses through and still
// excludes the office's own channel account.
{
  const out = selectCounterpartyEmails({
    direction: "INBOUND",
    fromEmail: "whatsapp:905321112233",
    toEmails: ["whatsapp:710722677362"],
    officeEmails: ["whatsapp:710722677362", "rfq@usederya.com"],
  });
  assert.deepEqual(out, ["whatsapp:905321112233"]);
}
{
  const out = selectCounterpartyEmails({
    direction: "OUTBOUND",
    fromEmail: "whatsapp:710722677362",
    toEmails: ["whatsapp:905321112233"],
    officeEmails: ["whatsapp:710722677362"],
  });
  assert.deepEqual(out, ["whatsapp:905321112233"]);
}
// Email behavior unchanged.
{
  const out = selectCounterpartyEmails({
    direction: "INBOUND",
    fromEmail: '"Jane" <jane@acme.com>',
    toEmails: [],
    officeEmails: ["rfq@usederya.com"],
  });
  assert.deepEqual(out, ["jane@acme.com"]);
}

console.log("whatsapp-crm-touch tests passed");
