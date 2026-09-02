import { createHash } from "node:crypto";
import { stripEmDashes } from "@/lib/no-em-dash";

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export function normalizeResearchListQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\s+\(\d+\)$/, "").trim();
}

export function normalizeCampaignSenderDisplayName(value: string | null | undefined): string | null {
  const cleaned = stripEmDashes(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/["\\]/g, "")
    .trim()
    .slice(0, 78)
    .trim();
  return cleaned || null;
}

export function asciiCampaignSenderDisplayName(value: string | null | undefined): string | null {
  const cleaned = normalizeCampaignSenderDisplayName(value);
  return cleaned && /^[\x00-\x7F]*$/.test(cleaned) ? cleaned : null;
}

export function buildCampaignFromHeader(address: string, displayName: string | null | undefined): string {
  const cleanAddress = stripEmDashes(address).replace(/[\r\n]+/g, " ").trim();
  const cleanDisplayName = asciiCampaignSenderDisplayName(displayName);
  return cleanDisplayName
    ? `"${cleanDisplayName}" <${cleanAddress}>`
    : cleanAddress;
}

type CampaignRow = Record<string, unknown> & {
  data?: Record<string, unknown>;
  status?: unknown;
};

export type CampaignPersonalization = {
  email: string;
  company: string | null;
  country: string | null;
};

function rowData(row: CampaignRow) {
  return row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : row;
}

function textValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function renderCampaignEmail(input: {
  subject: string;
  bodyTemplate: string;
  row: CampaignRow;
}) {
  const data = rowData(input.row);
  const replacements: Record<string, string> = {
    company: textValue(data.company),
    country: textValue(data.country),
    email: textValue(data.email),
  };
  const render = (value: string) => stripEmDashes(value.replace(/\{\{(company|country|email)\}\}/g, (_, key: string) => replacements[key] ?? ""));
  return {
    subject: render(input.subject).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim(),
    body: render(input.bodyTemplate),
  };
}

export function campaignRowEligible(input: {
  row: CampaignRow;
  statuses: readonly string[];
  countries?: readonly string[];
  segments?: readonly string[];
  emailField: string;
  countryField?: string;
  segmentField?: string;
}) {
  const data = rowData(input.row);
  const status = textValue(input.row.status || data.status).toLowerCase();
  if (!input.statuses.map((value) => value.toLowerCase()).includes(status)) return false;
  const email = textValue(data[input.emailField]);
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) return false;
  const countries = (input.countries ?? []).map((value) => value.toLowerCase());
  if (countries.length && !countries.includes(textValue(data[input.countryField ?? "country"]).toLowerCase())) {
    return false;
  }
  const segments = (input.segments ?? []).map((value) => value.toLowerCase());
  if (segments.length && !segments.includes(textValue(data[input.segmentField ?? "segment"]).toLowerCase())) {
    return false;
  }
  return true;
}

export function campaignSampleRecipients(input: {
  rows: readonly { id: string; data: Record<string, unknown> }[];
  emailField: string;
  companyField?: string;
  countryField?: string;
}) {
  const value = (data: Record<string, unknown>, key: string | undefined) => {
    const text = key ? String(data[key] ?? "").trim() : "";
    return text || null;
  };
  return input.rows.slice(0, 10).map((row) => ({
    id: row.id,
    email: String(row.data[input.emailField] ?? "").trim(),
    company: value(row.data, input.companyField ?? "company"),
    country: value(row.data, input.countryField ?? "country"),
  }));
}

export function campaignPersonalization(input: {
  data: Record<string, unknown>;
  emailField: string;
  companyField?: string;
  countryField?: string;
}): CampaignPersonalization {
  const value = (key: string | undefined) => {
    const text = key ? String(input.data[key] ?? "").trim() : "";
    return text || null;
  };
  return {
    email: value(input.emailField) ?? "",
    company: value(input.companyField ?? "company"),
    country: value(input.countryField ?? "country"),
  };
}

export function campaignPersonalizationMap(input: {
  rows: readonly { id: string; data: Record<string, unknown> }[];
  emailField: string;
  companyField?: string;
  countryField?: string;
}) {
  return Object.fromEntries(
    input.rows
      .map((row) => [row.id, campaignPersonalization({
        data: row.data,
        emailField: input.emailField,
        companyField: input.companyField,
        countryField: input.countryField,
      })] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function campaignSnapshotRowSendable(input: {
  row: { status?: unknown } | null | undefined;
  statuses: readonly string[];
  personalization: unknown;
}) {
  if (!input.row) return false;
  const status = textValue(input.row.status).toLowerCase();
  if (!input.statuses.some((value) => value.toLowerCase() === status)) return false;
  if (!input.personalization || typeof input.personalization !== "object" || Array.isArray(input.personalization)) {
    return false;
  }
  return typeof (input.personalization as Record<string, unknown>).email === "string";
}

export function campaignSnapshotOutstandingRecordIds(input: {
  rows: readonly { id: string; status?: unknown }[];
  audienceRecordIds: readonly string[];
  audiencePersonalization: Readonly<Record<string, unknown>>;
  statuses: readonly string[];
  attemptedRecordIds: ReadonlySet<string>;
}) {
  const rowsById = new Map(input.rows.map((row) => [row.id, row]));
  return input.audienceRecordIds.filter((recordId) => {
    const row = rowsById.get(recordId);
    return campaignSnapshotRowSendable({
      row,
      statuses: input.statuses,
      personalization: input.audiencePersonalization[recordId],
    }) && !input.attemptedRecordIds.has(recordId);
  });
}

export function campaignRevisionHash(input: {
  subject: string;
  bodyTemplate: string;
  emailField: string;
  rowStatuses: readonly string[];
  filters: Record<string, unknown>;
  dailyCap: number;
  senderAccountId: string | null;
  senderDisplayName: string | null;
  audienceRecordIds: readonly string[];
  audiencePersonalization?: Record<string, CampaignPersonalization> | null;
}) {
  const personalization = input.audiencePersonalization
    && typeof input.audiencePersonalization === "object"
    && !Array.isArray(input.audiencePersonalization)
    ? input.audiencePersonalization
    : {};
  const sortedPersonalization = Object.fromEntries(
    Object.entries(personalization).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash("sha256").update(JSON.stringify({
    subject: input.subject,
    bodyTemplate: input.bodyTemplate,
    emailField: input.emailField,
    rowStatuses: [...input.rowStatuses],
    filters: input.filters,
    dailyCap: input.dailyCap,
    senderAccountId: input.senderAccountId,
    senderDisplayName: input.senderDisplayName,
    audienceRecordIds: [...input.audienceRecordIds].sort(),
    audiencePersonalization: sortedPersonalization,
  })).digest("hex");
}

export function campaignRevisionMatches(expected: string | undefined, actual: string | null) {
  return Boolean(expected && actual && expected === actual);
}

export function campaignDefaultName(base: string, takenNames: ReadonlySet<string>) {
  if (!takenNames.has(base)) return base;
  let suffix = 2;
  while (takenNames.has(`${base} (${suffix})`)) suffix += 1;
  return `${base} (${suffix})`;
}

export function campaignSendCountsAsAttempt(status: string) {
  return status === "SENT" || status === "REJECTED" || status === "UNKNOWN";
}

export function campaignBlockers(input: {
  eligible: number;
  mailboxesAvailable: number;
  senderPinned: boolean;
  subject: string;
  bodyTemplate: string;
  dailyCap: number;
}) {
  const blockers: string[] = [];
  if (!input.subject.trim()) blockers.push("Subject is required.");
  if (!input.bodyTemplate.trim()) blockers.push("Body is required.");
  if (!/reply\s+(stop|no)|unsubscrib|opt out|opt-out/i.test(input.bodyTemplate)) {
    blockers.push("Body must contain an opt-out line.");
  }
  if (input.mailboxesAvailable === 0) {
    blockers.push("No mailbox is connected for sending.");
  } else if (!input.senderPinned) {
    blockers.push("Select a sender mailbox.");
  }
  if (input.eligible === 0) blockers.push("No eligible rows in this list.");
  if (!Number.isInteger(input.dailyCap) || input.dailyCap < 1 || input.dailyCap > 200) {
    blockers.push("Daily cap must be between 1 and 200.");
  }
  return blockers;
}

export function campaignProgress(input: {
  total: number;
  sent: number;
  rejected: number;
  unknown: number;
}) {
  return {
    total: input.total,
    sent: input.sent,
    rejected: input.rejected,
    unknown: input.unknown,
    remaining: Math.max(0, input.total - input.sent - input.rejected - input.unknown),
  };
}
