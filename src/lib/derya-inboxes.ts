export type DeryaLoadRfqInbox = {
  email: string;
  owner: string;
  role: string;
  label: string;
};

const DEFAULT_DERYA_LOAD_RFQ_INBOXES: DeryaLoadRfqInbox[] = [
  {
    email: "mert@usederya.com",
    owner: "Mert",
    role: "Founder / operator",
    label: "Mert load/RFQ inbox",
  },
  {
    email: "oguzhan@usederya.com",
    owner: "Oguzhan",
    role: "Operator",
    label: "Oguzhan load/RFQ inbox",
  },
];

const DEFAULT_DERYA_RFQ_SOURCE_EMAILS = [
  "rfq@usederya.com",
] as const;

function titleCaseLocalPart(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ") || email;
}

function fallbackInbox(email: string): DeryaLoadRfqInbox {
  const known = DEFAULT_DERYA_LOAD_RFQ_INBOXES.find((inbox) => inbox.email === email);
  if (known) return known;
  const owner = titleCaseLocalPart(email);
  return {
    email,
    owner,
    role: "Derya operator",
    label: `${owner} load/RFQ inbox`,
  };
}

export function parseDeryaLoadRfqInboxEnv(value: string | null | undefined): DeryaLoadRfqInbox[] {
  const configured = (value ?? "")
    .split(",")
    .map(normalizeEmailAddress)
    .filter((email) => email.includes("@"));

  const emails = configured.length > 0
    ? configured
    : DEFAULT_DERYA_LOAD_RFQ_INBOXES.map((inbox) => inbox.email);

  return [...new Set(emails)].map(fallbackInbox);
}

export const DERYA_LOAD_RFQ_INBOXES: DeryaLoadRfqInbox[] = parseDeryaLoadRfqInboxEnv(
  process.env.DERYA_LOAD_RFQ_INBOXES
);

export const DERYA_LOAD_RFQ_INBOX_EMAILS = DERYA_LOAD_RFQ_INBOXES.map((inbox) => inbox.email);

export function normalizeEmailAddress(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function parseDeryaRfqSourceEmailEnv(value: string | null | undefined): string[] {
  const configured = (value ?? "")
    .split(",")
    .map(normalizeEmailAddress)
    .filter((email) => email.includes("@"));

  const emails = configured.length > 0
    ? configured
    : [...DEFAULT_DERYA_RFQ_SOURCE_EMAILS];

  return [...new Set(emails)];
}

export const DERYA_RFQ_SOURCE_EMAILS = parseDeryaRfqSourceEmailEnv(
  process.env.DERYA_RFQ_SOURCE_EMAILS
);

export function isDeryaLoadRfqInbox(email: string | null | undefined): boolean {
  const normalized = normalizeEmailAddress(email);
  return DERYA_LOAD_RFQ_INBOX_EMAILS.includes(normalized);
}

export function isDeryaRfqSourceSender(email: string | null | undefined): boolean {
  const normalized = normalizeEmailAddress(email);
  return DERYA_RFQ_SOURCE_EMAILS.includes(normalized);
}

export function getDeryaLoadRfqInbox(email: string | null | undefined): DeryaLoadRfqInbox | null {
  const normalized = normalizeEmailAddress(email);
  return DERYA_LOAD_RFQ_INBOXES.find((inbox) => inbox.email === normalized) ?? null;
}

export function gmailConnectHrefForInbox(email: string): string {
  return `/api/auth/gmail/start?email=${encodeURIComponent(normalizeEmailAddress(email))}`;
}
