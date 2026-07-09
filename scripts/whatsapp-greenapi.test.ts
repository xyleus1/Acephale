import assert from "node:assert/strict";
import { greenApiJidDigits, greenApiToMetaPayload } from "../src/lib/whatsapp-greenapi";

// JID → digits normalization.
assert.equal(greenApiJidDigits("905301743170@c.us"), "905301743170");
assert.equal(greenApiJidDigits("962798185729@c.us"), "962798185729");
assert.equal(greenApiJidDigits("123@c.us"), null, "too-short JIDs are unusable");
assert.equal(greenApiJidDigits(null), null);

const base = {
  typeWebhook: "incomingMessageReceived",
  instanceData: { idInstance: 7103000000, wid: "905301743170@c.us", typeInstance: "whatsapp" },
  timestamp: 1783330521,
  idMessage: "F7AEC1B7086ECDC7E6E45923F5EDB825",
  senderData: {
    chatId: "905321112233@c.us",
    sender: "905321112233@c.us",
    chatName: "Hikmet",
    senderName: "Hikmet",
    senderContactName: "Hikmet Aydın",
  },
};

// Plain text message translates into the Meta webhook shape ingest expects.
{
  const payload = greenApiToMetaPayload(
    { ...base, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "Merhaba, gazbeton için fiyat alabilir miyim?" } } },
    null,
  );
  assert(payload, "text message must translate");
  const value = payload.entry[0].changes[0].value;
  assert.equal(value.metadata.phone_number_id, "905301743170", "own number from instance wid");
  assert.equal(value.contacts[0].wa_id, "905321112233");
  assert.equal(value.contacts[0].profile?.name, "Hikmet Aydın", "prefers senderContactName");
  const msg = value.messages[0];
  assert.equal(msg.id, base.idMessage);
  assert.equal(msg.from, "905321112233");
  assert.equal(msg.timestamp, "1783330521");
  assert.equal(msg.type, "text");
  assert.equal(msg.text?.body, "Merhaba, gazbeton için fiyat alabilir miyim?");
}

// extendedTextMessage carries its body in a different field.
{
  const payload = greenApiToMetaPayload(
    { ...base, messageData: { typeMessage: "extendedTextMessage", extendedTextMessageData: { text: "Giresun - İstanbul 20 ton" } } },
    null,
  );
  assert.equal(payload?.entry[0].changes[0].value.messages[0].text?.body, "Giresun - İstanbul 20 ton");
}

// An explicit own-number (env) wins over the instance wid.
{
  const payload = greenApiToMetaPayload(
    { ...base, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "test" } } },
    "905309999999",
  );
  assert.equal(payload?.entry[0].changes[0].value.metadata.phone_number_id, "905309999999");
}

// Media messages keep the provider type so ingest stores its unsupported-type placeholder.
{
  const payload = greenApiToMetaPayload(
    { ...base, messageData: { typeMessage: "imageMessage" } },
    null,
  );
  const msg = payload?.entry[0].changes[0].value.messages[0];
  assert.equal(msg?.type, "imageMessage");
  assert.equal(msg?.text, undefined);
}

// Group chats, status webhooks, and junk are ignored (null → 200 ack, no ingest).
assert.equal(
  greenApiToMetaPayload(
    { ...base, senderData: { ...base.senderData, chatId: "905321112233-1581234048@g.us" }, messageData: { typeMessage: "textMessage", textMessageData: { textMessage: "x" } } },
    null,
  ),
  null,
  "group chats are skipped",
);
assert.equal(greenApiToMetaPayload({ ...base, typeWebhook: "outgoingMessageStatus" }, null), null);
assert.equal(greenApiToMetaPayload({ ...base, idMessage: undefined }, null), null);
assert.equal(greenApiToMetaPayload({}, null), null);

console.log("whatsapp-greenapi tests passed");
