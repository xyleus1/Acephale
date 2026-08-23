import crypto from "node:crypto";

function digest(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function parseMessageReferences(value: string | null | undefined) {
  if (!value) return [];
  const bracketed = value.match(/<[^>]+>/g);
  return (bracketed?.length ? bracketed : value.split(/\s+/))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function imapMessageExternalId(accountId: string, messageId: string | null | undefined, source: Buffer) {
  return `imap:${accountId}:message:${digest(messageId?.trim() || source.toString("base64"))}`;
}

export function imapThreadExternalId(input: {
  accountId: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  subject?: string | null;
}) {
  const references = parseMessageReferences(input.references);
  const root = references[0]
    || input.inReplyTo?.trim()
    || input.messageId?.trim()
    || input.subject?.replace(/^\s*(re|fw|fwd)\s*:\s*/i, "").trim().toLowerCase()
    || "no-subject";
  return `imap:${input.accountId}:thread:${digest(root)}`;
}
