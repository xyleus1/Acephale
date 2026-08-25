import crypto from "crypto";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/gmail-oauth";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const DEFAULT_LOGIN_CODE_SMTP_USER = "rfq@usederya.com";

export function loginCodeSmtpConfig() {
  return {
    user: process.env.RFQ_MAIL_USER ?? DEFAULT_LOGIN_CODE_SMTP_USER,
    appPassword: (process.env.RFQ_MAIL_APP_PASSWORD ?? "").replace(/\s+/g, ""),
  };
}

export function loginCodeSmtpConfigured() {
  return loginCodeSmtpConfig().appPassword.length >= 8;
}

// Internal deployment: founders + loadboard operators. Extend via the
// LOGIN_ALLOWED_EMAILS env var (comma-separated) without a code change.
const DEFAULT_ALLOWED_LOGIN_EMAILS = [
  "mert@usederya.com",
  "oguzhan@usederya.com",
  "atahan@usederya.com",
  "merve@usederya.com",
];

export function allowedLoginEmails(): string[] {
  const raw = process.env.LOGIN_ALLOWED_EMAILS;
  if (!raw) return DEFAULT_ALLOWED_LOGIN_EMAILS;
  const parsed = raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return parsed.length ? parsed : DEFAULT_ALLOWED_LOGIN_EMAILS;
}

// Customer offices (Maneks and later tenants) sign in with a username and a
// shared password instead of a personal mailbox, so their user rows carry a
// synthetic address in this reserved domain. Nothing is ever delivered to it:
// the email-code path refuses these identifiers, only the password path works.
export const USERNAME_LOGIN_DOMAIN = "office.derya.invalid";

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}$/;

export function isUsernameIdentifier(identifier: string) {
  const value = identifier.trim().toLowerCase();
  return !value.includes("@") && USERNAME_PATTERN.test(value);
}

export function usernameLoginEmail(username: string) {
  return `${username.trim().toLowerCase()}@${USERNAME_LOGIN_DOMAIN}`;
}

export function isUsernameLoginEmail(email: string) {
  return normalizeLoginEmail(email).endsWith(`@${USERNAME_LOGIN_DOMAIN}`);
}

// Turns whatever was typed into the sign-in box into the stored user email.
export function resolveLoginIdentifier(identifier: string) {
  const value = identifier.trim().toLowerCase();
  return isUsernameIdentifier(value) ? usernameLoginEmail(value) : value;
}

export function normalizeLoginEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isLoginEmailAllowed(email: string) {
  const value = normalizeLoginEmail(email);
  if (isUsernameLoginEmail(value)) {
    return USERNAME_PATTERN.test(value.slice(0, value.lastIndexOf("@")));
  }
  return allowedLoginEmails().includes(value);
}

function hashLoginCode(email: string, code: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing.");
  return crypto.createHmac("sha256", secret).update(`${normalizeLoginEmail(email)}:${code}`).digest("hex");
}

export function generateLoginCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export type RequestCodeResult =
  | { ok: true; sentVia: string }
  | { ok: false; error: "not_allowed" | "no_user" | "rate_limited" | "send_failed" };

async function pickSenderAccount(officeId: string, preferEmail: string) {
  const own = await prisma.emailAccount.findFirst({
    where: { officeId, email: preferEmail, provider: "GMAIL", isActive: true, sendEnabled: true },
  });
  if (own) return own;
  return prisma.emailAccount.findFirst({
    where: { officeId, provider: "GMAIL", isActive: true, sendEnabled: true },
    orderBy: [{ isDefaultSender: "desc" }, { createdAt: "asc" }],
  });
}

function encodeGmailRaw(raw: string) {
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Bare Gmail send: sign-in codes must not create EmailThread/EmailMessage
// rows or CRM touches, so this deliberately bypasses gmail-send.ts.
async function sendCodeEmail(accountId: string, from: string, to: string, code: string) {
  const token = await getValidAccessToken(accountId);
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: Derya sign-in code: ${code}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];
  const body = [
    `Your Derya sign-in code is: ${code}`,
    ``,
    `It expires in 10 minutes. If you did not request this, ignore this email.`,
  ].join("\r\n");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodeGmailRaw(headers.join("\r\n") + "\r\n\r\n" + body) }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gmail send failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}

async function sendCodeEmailWithSmtp(to: string, code: string) {
  const config = loginCodeSmtpConfig();
  if (!loginCodeSmtpConfigured()) {
    throw new Error("Login code SMTP is not configured.");
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
  });
  await transporter.sendMail({
    from: config.user,
    to,
    subject: `Derya sign-in code: ${code}`,
    text: [
      `Your Derya sign-in code is: ${code}`,
      "",
      "It expires in 10 minutes. If you did not request this, ignore this email.",
    ].join("\r\n"),
  });
}

export async function requestLoginCode(rawEmail: string): Promise<RequestCodeResult> {
  const email = normalizeLoginEmail(rawEmail);
  if (isUsernameLoginEmail(email)) return { ok: false, error: "not_allowed" };
  if (!isLoginEmailAllowed(email)) return { ok: false, error: "not_allowed" };

  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    select: { id: true, officeId: true },
  });
  if (!user) return { ok: false, error: "no_user" };

  const windowStart = new Date(Date.now() - REQUEST_WINDOW_MS);
  const recent = await prisma.loginCode.count({ where: { email, createdAt: { gte: windowStart } } });
  if (recent >= MAX_REQUESTS_PER_WINDOW) return { ok: false, error: "rate_limited" };

  const sender = await pickSenderAccount(user.officeId, email);
  const code = generateLoginCode();
  let sentVia: string | null = null;

  // Send BEFORE persisting: a failed send must not burn a rate-limit slot or
  // invalidate a code the user may still be holding from a prior request.
  if (sender) {
    try {
      await sendCodeEmail(sender.id, sender.email, email, code);
      sentVia = sender.email;
    } catch (error) {
      console.warn("login code Gmail send failed", error);
    }
  }

  // A fresh database may have the internal user but no connected office
  // mailbox yet. The existing RFQ SMTP desk is the bootstrap fallback so an
  // allowlisted operator can sign in and reconnect Gmail.
  if (!sentVia && loginCodeSmtpConfigured()) {
    try {
      await sendCodeEmailWithSmtp(email, code);
      sentVia = loginCodeSmtpConfig().user;
    } catch (error) {
      console.warn("login code SMTP send failed", error);
    }
  }

  if (!sentVia) {
    console.warn("login code delivery unavailable", {
      hasOfficeGmailSender: Boolean(sender),
      hasSmtpFallback: loginCodeSmtpConfigured(),
    });
    return { ok: false, error: "send_failed" };
  }

  // Delivered: now invalidate outstanding codes and store the new one.
  await prisma.loginCode.updateMany({
    where: { email, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await prisma.loginCode.create({
    data: {
      email,
      codeHash: hashLoginCode(email, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  return { ok: true, sentVia };
}

export type VerifyCodeResult = { ok: true; email: string } | { ok: false; error: "invalid" };

export async function verifyLoginCode(rawEmail: string, rawCode: string): Promise<VerifyCodeResult> {
  const email = normalizeLoginEmail(rawEmail);
  const code = rawCode.trim();
  if (isUsernameLoginEmail(email)) return { ok: false, error: "invalid" };
  if (!isLoginEmailAllowed(email) || !/^\d{6}$/.test(code)) return { ok: false, error: "invalid" };

  const record = await prisma.loginCode.findFirst({
    where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return { ok: false, error: "invalid" };

  // Atomically claim one of the allowed attempts. Concurrent submits each
  // consume a distinct slot, so the 5-guess ceiling holds under a burst
  // instead of every parallel request reading attempts=0 and passing.
  const claimed = await prisma.loginCode.updateMany({
    where: { id: record.id, consumedAt: null, attempts: { lt: MAX_VERIFY_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { ok: false, error: "invalid" };

  const expected = Buffer.from(record.codeHash, "hex");
  const actual = Buffer.from(hashLoginCode(email, code), "hex");
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matches) {
    // The attempt was already counted atomically above.
    return { ok: false, error: "invalid" };
  }

  // Single-use: consume atomically so a replayed submit cannot log in twice.
  const consumed = await prisma.loginCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) return { ok: false, error: "invalid" };

  return { ok: true, email };
}
