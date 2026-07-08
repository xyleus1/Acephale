// Green API (hosted WhatsApp gateway) notification → Meta Cloud API webhook
// payload translation. Pure module: the adapter route feeds the result into
// the same ingestWhatsAppWebhook used by the official Meta webhook, so the
// rest of the app never knows which provider delivered the message.

export type GreenApiNotification = {
  typeWebhook?: string;
  instanceData?: { idInstance?: number; wid?: string; typeInstance?: string };
  timestamp?: number;
  idMessage?: string;
  senderData?: {
    chatId?: string;
    sender?: string;
    chatName?: string;
    senderName?: string;
    senderContactName?: string;
  };
  messageData?: {
    typeMessage?: string;
    textMessageData?: { textMessage?: string };
    extendedTextMessageData?: { text?: string };
  };
};

export type MetaShapedWebhookPayload = {
  entry: Array<{
    changes: Array<{
      value: {
        metadata: { phone_number_id: string; display_phone_number: string };
        contacts: Array<{ profile?: { name?: string }; wa_id: string }>;
        messages: Array<{
          id: string;
          from: string;
          timestamp: string;
          type: string;
          text?: { body: string };
        }>;
      };
    }>;
  }>;
};

// "905301743170@c.us" → "905301743170"; null for anything unusable.
export function greenApiJidDigits(jid: string | null | undefined): string | null {
  const digits = String(jid ?? "").split("@")[0].replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

// Translate one notification into the Meta webhook shape ingest expects.
// Returns null for notifications we deliberately don't ingest: non-inbound
// webhooks (status updates, state changes), group chats (inquiries are 1:1),
// and payloads missing the fields ingest requires.
export function greenApiToMetaPayload(
  notification: GreenApiNotification,
  ownNumberDigits: string | null,
): MetaShapedWebhookPayload | null {
  if (notification.typeWebhook !== "incomingMessageReceived") return null;

  const chatId = notification.senderData?.chatId ?? "";
  if (chatId.endsWith("@g.us")) return null;

  const from = greenApiJidDigits(notification.senderData?.sender ?? chatId);
  const own = ownNumberDigits ?? greenApiJidDigits(notification.instanceData?.wid);
  const idMessage = notification.idMessage;
  if (!from || !own || !idMessage) return null;

  const typeMessage = notification.messageData?.typeMessage ?? "unknown";
  const text =
    notification.messageData?.textMessageData?.textMessage ??
    notification.messageData?.extendedTextMessageData?.text;
  const hasText = typeof text === "string" && text.trim().length > 0;

  const name =
    notification.senderData?.senderContactName?.trim() ||
    notification.senderData?.senderName?.trim() ||
    notification.senderData?.chatName?.trim() ||
    undefined;

  const timestampSeconds = notification.timestamp;

  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: own, display_phone_number: own },
          contacts: [{ ...(name ? { profile: { name } } : {}), wa_id: from }],
          messages: [{
            id: idMessage,
            from,
            timestamp: String(
              typeof timestampSeconds === "number" && timestampSeconds > 0 ? timestampSeconds : 0,
            ),
            // ingest renders non-"text" types as "[Unsupported WhatsApp <type> message]",
            // which is exactly what we want for media until media ingest exists.
            type: hasText ? "text" : typeMessage,
            ...(hasText ? { text: { body: text } } : {}),
          }],
        },
      }],
    }],
  };
}
