import assert from "node:assert/strict";
import {
  displayParty,
  formatPhoneDigits,
  isWhatsAppAddress,
  whatsAppAccountLabel,
  whatsAppAddressDigits,
  whatsAppPartyLabel,
} from "../src/lib/whatsapp-display";

assert.equal(isWhatsAppAddress("whatsapp:905321112233"), true);
assert.equal(isWhatsAppAddress("lead@example.com"), false);
assert.equal(isWhatsAppAddress(null), false);

assert.equal(whatsAppAddressDigits("whatsapp:905321112233"), "905321112233");
assert.equal(whatsAppAddressDigits("whatsapp:12"), null);
assert.equal(whatsAppAddressDigits("lead@example.com"), null);

// Turkish numbers get the 3-3-2-2 national grouping; others a generic one.
assert.equal(formatPhoneDigits("905321112233"), "+90 532 111 22 33");
assert.equal(formatPhoneDigits("962798185729"), "+962 798 185 729");
assert.equal(formatPhoneDigits("1234"), null);
assert.equal(formatPhoneDigits(null), null);

// Name wins, formatted phone second, raw string last.
assert.equal(whatsAppPartyLabel("whatsapp:905321112233", "Hikmet Aydın"), "Hikmet Aydın");
assert.equal(whatsAppPartyLabel("whatsapp:905321112233", "  "), "+90 532 111 22 33");
assert.equal(whatsAppPartyLabel("whatsapp:12", null), "whatsapp:12");

// displayParty leaves email senders untouched, humanizes WhatsApp ones.
assert.equal(displayParty("lead@example.com", null), "lead@example.com");
assert.equal(displayParty("lead@example.com", "Jane"), "Jane");
assert.equal(displayParty("whatsapp:905321112233", null), "+90 532 111 22 33");
assert.equal(displayParty("whatsapp:905321112233", "Hikmet"), "Hikmet");
assert.equal(displayParty(null), "");

// Receiving-account labels: dialable numbers get formatted; opaque Green API
// instance ids fall back to a plain label rather than a fake phone.
assert.equal(whatsAppAccountLabel("whatsapp:905301743170"), "WhatsApp · +90 530 174 31 70");
assert.equal(whatsAppAccountLabel("mert@usederya.com"), "mert@usederya.com");
assert.equal(whatsAppAccountLabel("whatsapp:71"), "WhatsApp Business");

console.log("whatsapp-display tests passed");
