import "server-only";

import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import {
  validateOutboundAttachments,
  type OutboundEmailAttachment,
} from "@/lib/outbound-email-attachments";
import { decryptSecret, isEncryptedSecret } from "@/lib/security/crypto";

export const GMAIL_APP_PASSWORD_PROVIDER = "GMAIL_APP_PASSWORD";

const GMAIL_SMTP_HOST = "smtp.gmail.com";
const GMAIL_SMTP_PORT = 587;
const GMAIL_IMAP_HOST = "imap.gmail.com";
const GMAIL_IMAP_PORT = 993;

type StoredGmailAppPasswordAccount = {
  email: string;
  displayName?: string | null;
  credentialSecret?: string | null;
};

type GmailAppPasswordCredentials = {
  email: string;
  displayName?: string | null;
  appPassword: string;
};

export function normalizeGmailAppPassword(value: string) {
  return value.replace(/\s+/g, "").trim();
}

export function isValidGmailAppPassword(value: string) {
  return /^[A-Za-z0-9]{16}$/.test(normalizeGmailAppPassword(value));
}

export function readGmailAppPasswordAccount(account: StoredGmailAppPasswordAccount): GmailAppPasswordCredentials {
  if (!account.credentialSecret || !isEncryptedSecret(account.credentialSecret)) {
    throw new Error("This account has no encrypted app password. Add the account again.");
  }
  const appPassword = decryptSecret(account.credentialSecret);
  if (!isValidGmailAppPassword(appPassword)) {
    throw new Error("This account has an invalid app password. Add the account again.");
  }
  return {
    email: account.email,
    displayName: account.displayName,
    appPassword: normalizeGmailAppPassword(appPassword),
  };
}

function smtpTransport(credentials: GmailAppPasswordCredentials) {
  return nodemailer.createTransport({
    host: GMAIL_SMTP_HOST,
    port: GMAIL_SMTP_PORT,
    secure: false,
    requireTLS: true,
    auth: { user: credentials.email, pass: credentials.appPassword },
    tls: { minVersion: "TLSv1.2", servername: GMAIL_SMTP_HOST },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

export function gmailImapClient(credentials: GmailAppPasswordCredentials, verifyOnly = false) {
  return new ImapFlow({
    host: GMAIL_IMAP_HOST,
    port: GMAIL_IMAP_PORT,
    secure: true,
    auth: { user: credentials.email, pass: credentials.appPassword },
    tls: { minVersion: "TLSv1.2", servername: GMAIL_IMAP_HOST },
    logger: false,
    verifyOnly,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    maxLineLength: 256 * 1024,
    maxLiteralSize: 3 * 1024 * 1024,
    maxResponseSize: 4 * 1024 * 1024,
  });
}

function safeConnectionError(service: "SMTP" | "IMAP", caught: unknown) {
  const error = caught as { code?: unknown; responseCode?: unknown; authenticationFailed?: unknown };
  const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
  const responseCode = typeof error?.responseCode === "number" ? error.responseCode : 0;
  if (error?.authenticationFailed || responseCode === 535 || /AUTH|CREDENTIAL|LOGIN/.test(code)) {
    return `${service} authentication failed. Generate a fresh Gmail app password and try again.`;
  }
  if (/TIMEOUT|ETIMEDOUT/.test(code)) return `${service} connection timed out.`;
  if (/CERT|TLS/.test(code)) return `${service} secure connection failed.`;
  return `${service} connection failed.`;
}

export async function verifyGmailAppPasswordConnection(input: GmailAppPasswordCredentials) {
  const credentials = {
    ...input,
    email: input.email.trim().toLowerCase(),
    appPassword: normalizeGmailAppPassword(input.appPassword),
  };

  const transporter = smtpTransport(credentials);
  try {
    await transporter.verify();
  } catch (caught) {
    return { ok: false as const, error: safeConnectionError("SMTP", caught) };
  } finally {
    transporter.close();
  }

  const client = gmailImapClient(credentials, true);
  try {
    await client.connect();
    return { ok: true as const };
  } catch (caught) {
    return { ok: false as const, error: safeConnectionError("IMAP", caught) };
  } finally {
    if (client.usable) await client.logout().catch(() => undefined);
    else client.close();
  }
}

export async function sendGmailAppPasswordMail(input: {
  account: StoredGmailAppPasswordAccount;
  to: string;
  subject: string;
  text: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  from?: { name: string; address: string };
  attachments?: readonly OutboundEmailAttachment[];
}) {
  const credentials = readGmailAppPasswordAccount(input.account);
  const attachments = input.attachments?.length ? validateOutboundAttachments(input.attachments) : [];
  const transporter = smtpTransport(credentials);
  try {
    const info = await transporter.sendMail({
      from: input.from ?? (credentials.displayName
        ? { name: credentials.displayName, address: credentials.email }
        : credentials.email),
      to: input.to,
      subject: input.subject,
      text: input.text,
      messageId: input.messageId ?? undefined,
      inReplyTo: input.inReplyTo ?? undefined,
      references: input.references?.length ? input.references : undefined,
      attachments: attachments.length
        ? attachments.map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            content: attachment.bytes,
          }))
        : undefined,
    });
    return { ok: true as const, messageId: String(info.messageId || "") };
  } catch (caught) {
    return { ok: false as const, error: safeConnectionError("SMTP", caught) };
  } finally {
    transporter.close();
  }
}
