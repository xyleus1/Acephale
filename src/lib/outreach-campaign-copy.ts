import { createHash } from "node:crypto";
import { stripEmDashes } from "@/lib/no-em-dash";

export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export function normalizeResearchListQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\s+\(\d+\)$/, "").trim();
}

export function campaignEmailFieldKey(
  fields: readonly { key: string; type: string }[],
  explicit?: string,
): string {
  const explicitKey = explicit?.trim();
  return explicitKey
    || fields.find((field) => field.type === "email")?.key
    || fields.find((field) => field.key === "email")?.key
    || fields.find((field) => /^[a-z0-9]+(?:_[a-z0-9]+)*_e-?mail$/.test(field.key.toLowerCase()))?.key
    || "email";
}

export function excludeContactedRecipients<T extends { id: string }>(input: {
  rows: readonly T[];
  recipientOf: (row: T) => string;
  contacted: ReadonlySet<string>;
}): T[] {
  const contacted = new Set([...input.contacted].map(normalizeCampaignRecipient));
  return input.rows.filter((row) => !contacted.has(normalizeCampaignRecipient(input.recipientOf(row))));
}

export const OUTREACH_CAMPAIGN_RECLAIM_MINUTES = 30;

export function outreachCampaignReclaimBefore(now: Date) {
  return new Date(now.getTime() - OUTREACH_CAMPAIGN_RECLAIM_MINUTES * 60_000);
}

export function outreachCampaignContactedWhere(input: {
  officeId: string;
  campaignId?: string | null;
  now: Date;
}) {
  return {
    officeId: input.officeId,
    ...(input.campaignId ? { campaignId: { not: input.campaignId } } : {}),
    OR: [
      { status: { in: ["SENT", "UNKNOWN"] } },
      {
        status: "QUEUED",
        createdAt: { gte: outreachCampaignReclaimBefore(input.now) },
        campaign: { status: { not: "CANCELLED" } },
      },
    ],
  };
}

function normalizeCampaignRecipient(value: string) {
  return value.trim().toLowerCase();
}

export function dedupeRecipients<T extends { id: string }>(input: {
  rows: readonly T[];
  recipientOf: (row: T) => string;
}): T[] {
  const seen = new Set<string>();
  return input.rows.filter((row) => {
    const recipient = normalizeCampaignRecipient(input.recipientOf(row));
    if (seen.has(recipient)) return false;
    seen.add(recipient);
    return true;
  });
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

export type CampaignVariant = {
  key: string;
  subject: string;
  bodyTemplate: string;
};

export function normalizeCampaignVariants(value: unknown): CampaignVariant[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    throw new Error("Campaign variants must be a non-empty array with at most 4 entries.");
  }
  const keys = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Campaign variant ${index + 1} must be an object.`);
    }
    const variant = item as Record<string, unknown>;
    const unexpectedKeys = Object.keys(variant).filter((key) => !["key", "subject", "bodyTemplate"].includes(key));
    if (unexpectedKeys.length > 0) {
      throw new Error(`Campaign variant ${index + 1} has unsupported fields.`);
    }
    if (typeof variant.key !== "string" || typeof variant.subject !== "string" || typeof variant.bodyTemplate !== "string") {
      throw new Error(`Campaign variant ${index + 1} requires key, subject, and bodyTemplate strings.`);
    }
    const normalized = {
      key: variant.key.trim(),
      subject: variant.subject.trim(),
      bodyTemplate: variant.bodyTemplate.trim(),
    };
    if (!normalized.key) throw new Error(`Campaign variant ${index + 1} key is required.`);
    if (normalized.key.length > 8) throw new Error(`Campaign variant ${index + 1} key must be at most 8 characters.`);
    if (keys.has(normalized.key)) throw new Error(`Campaign variant key "${normalized.key}" must be unique.`);
    keys.add(normalized.key);
    return normalized;
  });
}

export function storedCampaignVariants(value: unknown): CampaignVariant[] {
  try {
    return normalizeCampaignVariants(value) ?? [];
  } catch {
    return [];
  }
}

export function resolveCampaignOffice<T extends { id: string; name: string }>(input: {
  identifier: string;
  offices: readonly T[];
  slugify: (value: string) => string;
}): T {
  const identifier = input.identifier.toLowerCase();
  const matches = new Map<string, T>();
  for (const office of input.offices) {
    if (
      office.name.toLowerCase() === identifier
      || input.slugify(office.name) === input.slugify(input.identifier)
    ) {
      matches.set(office.id, office);
    }
  }
  if (matches.size > 1) throw new Error("Office identifier is ambiguous.");
  const office = matches.values().next().value;
  if (!office) throw new Error("Office not found.");
  return office;
}

export function selectCampaignVariant<T extends { key: string }>(input: {
  campaignId: string;
  recordId: string;
  variants: readonly T[];
}): T | null {
  if (input.variants.length === 0) return null;
  const digest = createHash("sha256").update(`${input.campaignId}:${input.recordId}`).digest();
  return input.variants[digest.readUInt32BE(0) % input.variants.length] ?? null;
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
  excludeEmails?: readonly string[];
}) {
  const data = rowData(input.row);
  const status = textValue(input.row.status || data.status).toLowerCase();
  if (!input.statuses.map((value) => value.toLowerCase()).includes(status)) return false;
  const email = textValue(data[input.emailField]);
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) return false;
  if (input.excludeEmails?.length && normalizeCampaignExcludeEmails(input.excludeEmails).includes(email.toLowerCase())) {
    return false;
  }
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

// Reviewer exclusions travel inside the campaign filters, so they take part in
// the revision hash and a greenlight after an exclusion cannot reach the row.
export function normalizeCampaignExcludeEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(item)),
  )].sort();
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
  blockedRecipients?: ReadonlySet<string>;
}) {
  const rowsById = new Map(input.rows.map((row) => [row.id, row]));
  const blockedRecipients = new Set([...input.blockedRecipients ?? []].map(normalizeCampaignRecipient));
  return input.audienceRecordIds.filter((recordId) => {
    const row = rowsById.get(recordId);
    const personalization = input.audiencePersonalization[recordId];
    const recipient = personalization && typeof personalization === "object" && !Array.isArray(personalization)
      ? normalizeCampaignRecipient(String((personalization as Record<string, unknown>).email ?? ""))
      : "";
    return campaignSnapshotRowSendable({
      row,
      statuses: input.statuses,
      personalization: input.audiencePersonalization[recordId],
    }) && !input.attemptedRecordIds.has(recordId)
      && !blockedRecipients.has(recipient);
  });
}

export const CAMPAIGN_FOLLOW_UP_MAX_STEPS = 3;
export const CAMPAIGN_FOLLOW_UP_MIN_WAIT_DAYS = 1;
export const CAMPAIGN_FOLLOW_UP_MAX_WAIT_DAYS = 30;
export const CAMPAIGN_FOLLOW_UP_STATUSES = ["QUEUED", "SENT", "REJECTED", "UNKNOWN", "SKIPPED"] as const;
export type CampaignFollowUpStatus = (typeof CAMPAIGN_FOLLOW_UP_STATUSES)[number];
export const CAMPAIGN_FOLLOW_UP_SKIP_REASONS = ["REPLIED", "BOUNCED", "SUPPRESSED"] as const;
export type CampaignFollowUpSkipReason = (typeof CAMPAIGN_FOLLOW_UP_SKIP_REASONS)[number];

export type CampaignFollowUpStep = {
  waitDays: number;
  subject: string | null;
  bodyTemplate: string;
};

export function normalizeCampaignFollowUps(value: unknown): CampaignFollowUpStep[] {
  if (!Array.isArray(value)) return [];
  const steps: CampaignFollowUpStep[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const object = item as Record<string, unknown>;
    const rawWait = object.waitDays ?? object.wait_days;
    const waitDays = typeof rawWait === "number" ? rawWait : Number(rawWait);
    const rawBody = object.bodyTemplate ?? object.body_template ?? object.body;
    const bodyTemplate = typeof rawBody === "string" ? stripEmDashes(rawBody).trim() : "";
    const rawSubject = object.subject;
    const subject = typeof rawSubject === "string" ? stripEmDashes(rawSubject).replace(/[\r\n\t]+/g, " ").trim() : "";
    if (!Number.isInteger(waitDays) || !bodyTemplate) continue;
    steps.push({ waitDays, subject: subject || null, bodyTemplate });
  }
  return steps;
}

export function campaignFollowUpBlockers(steps: readonly CampaignFollowUpStep[]) {
  const blockers: string[] = [];
  if (steps.length > CAMPAIGN_FOLLOW_UP_MAX_STEPS) {
    blockers.push(`At most ${CAMPAIGN_FOLLOW_UP_MAX_STEPS} follow-up steps are allowed.`);
  }
  steps.forEach((step, index) => {
    const label = `Follow-up ${index + 1}`;
    if (step.waitDays < CAMPAIGN_FOLLOW_UP_MIN_WAIT_DAYS || step.waitDays > CAMPAIGN_FOLLOW_UP_MAX_WAIT_DAYS) {
      blockers.push(`${label} must wait between ${CAMPAIGN_FOLLOW_UP_MIN_WAIT_DAYS} and ${CAMPAIGN_FOLLOW_UP_MAX_WAIT_DAYS} days.`);
    }
    if (!step.bodyTemplate.trim()) blockers.push(`${label} body is required.`);
    if (!/reply\s+(stop|no)|unsubscrib|opt out|opt-out/i.test(step.bodyTemplate)) {
      blockers.push(`${label} body must contain an opt-out line.`);
    }
  });
  return blockers;
}

export function campaignFollowUpSubject(step: CampaignFollowUpStep, initialSubject: string) {
  const base = step.subject?.trim() || initialSubject.trim();
  if (step.subject?.trim()) return base;
  return /^re:\s/i.test(base) ? base : `Re: ${base}`;
}

export function campaignFollowUpDueAt(previousSentAt: Date, waitDays: number) {
  return new Date(previousSentAt.getTime() + waitDays * 86_400_000);
}

export type CampaignFollowUpSequenceSend = {
  recordId: string;
  recipient: string;
  sentAt: Date | null;
  localThreadId: string | null;
  providerThreadId: string | null;
};

export type CampaignFollowUpSequenceRow = {
  recordId: string;
  step: number;
  status: string;
  sentAt: Date | null;
};

export type CampaignFollowUpCandidate = {
  recordId: string;
  recipient: string;
  step: number;
  dueAt: Date;
  previousSentAt: Date;
  localThreadId: string | null;
  providerThreadId: string | null;
};

export type CampaignFollowUpSkip = {
  recordId: string;
  recipient: string;
  step: number;
  reason: CampaignFollowUpSkipReason;
};

export function planCampaignFollowUps(input: {
  steps: readonly CampaignFollowUpStep[];
  sends: readonly CampaignFollowUpSequenceSend[];
  followUps: readonly CampaignFollowUpSequenceRow[];
  repliedThreadIds: ReadonlySet<string>;
  suppressedRecipients?: ReadonlySet<string>;
  bouncedRecipients?: ReadonlySet<string>;
  now: Date;
}): { due: CampaignFollowUpCandidate[]; skips: CampaignFollowUpSkip[]; outstanding: number } {
  const due: CampaignFollowUpCandidate[] = [];
  const skips: CampaignFollowUpSkip[] = [];
  let outstanding = 0;
  if (!input.steps.length) return { due, skips, outstanding };
  const rowsByRecord = new Map<string, CampaignFollowUpSequenceRow[]>();
  for (const row of input.followUps) {
    const list = rowsByRecord.get(row.recordId) ?? [];
    list.push(row);
    rowsByRecord.set(row.recordId, list);
  }
  const ordered = [...input.sends]
    .filter((send) => send.sentAt)
    .sort((a, b) => (a.sentAt as Date).getTime() - (b.sentAt as Date).getTime() || a.recordId.localeCompare(b.recordId));
  for (const send of ordered) {
    const rows = (rowsByRecord.get(send.recordId) ?? []).sort((a, b) => a.step - b.step);
    if (rows.some((row) => row.status === "SKIPPED" || row.status === "REJECTED" || row.status === "UNKNOWN")) continue;
    if (rows.some((row) => row.status === "QUEUED")) {
      outstanding += 1;
      continue;
    }
    const sent = rows.filter((row) => row.status === "SENT" && row.sentAt);
    const nextStep = sent.length + 1;
    if (nextStep > input.steps.length) continue;
    const recipient = send.recipient.trim().toLowerCase();
    const skipReason: CampaignFollowUpSkipReason | null = input.suppressedRecipients?.has(recipient)
      ? "SUPPRESSED"
      : input.bouncedRecipients?.has(recipient)
        ? "BOUNCED"
        : send.localThreadId && input.repliedThreadIds.has(send.localThreadId)
          ? "REPLIED"
          : null;
    if (skipReason) {
      skips.push({ recordId: send.recordId, recipient, step: nextStep, reason: skipReason });
      continue;
    }
    outstanding += 1;
    const previousSentAt = sent.at(-1)?.sentAt ?? (send.sentAt as Date);
    const dueAt = campaignFollowUpDueAt(previousSentAt, input.steps[nextStep - 1].waitDays);
    if (dueAt.getTime() > input.now.getTime()) continue;
    due.push({
      recordId: send.recordId,
      recipient,
      step: nextStep,
      dueAt,
      previousSentAt,
      localThreadId: send.localThreadId,
      providerThreadId: send.providerThreadId,
    });
  }
  return { due, skips, outstanding };
}

export function campaignRevisionHash(input: {
  subject: string;
  bodyTemplate: string;
  emailField: string;
  rowStatuses: readonly string[];
  filters: Record<string, unknown>;
  dailyCap: number;
  senderAccountId: string | null;
  senderRotation: boolean;
  senderDisplayName: string | null;
  variants: readonly CampaignVariant[] | null;
  audienceRecordIds: readonly string[];
  audiencePersonalization?: Record<string, CampaignPersonalization> | null;
  followUps?: readonly CampaignFollowUpStep[] | null;
}) {
  const personalization = input.audiencePersonalization
    && typeof input.audiencePersonalization === "object"
    && !Array.isArray(input.audiencePersonalization)
    ? input.audiencePersonalization
    : {};
  const sortedPersonalization = Object.fromEntries(
    Object.entries(personalization).sort(([left], [right]) => left.localeCompare(right)),
  );
  const variants = normalizeCampaignVariants(input.variants);
  return createHash("sha256").update(JSON.stringify({
    subject: input.subject,
    bodyTemplate: input.bodyTemplate,
    emailField: input.emailField,
    rowStatuses: [...input.rowStatuses],
    filters: input.filters,
    dailyCap: input.dailyCap,
    senderAccountId: input.senderAccountId,
    senderRotation: input.senderRotation,
    senderDisplayName: input.senderDisplayName,
    variants,
    audienceRecordIds: [...input.audienceRecordIds].sort(),
    audiencePersonalization: sortedPersonalization,
    ...(input.followUps?.length
      ? {
        followUps: input.followUps.map((step) => ({
          waitDays: step.waitDays,
          subject: step.subject,
          bodyTemplate: step.bodyTemplate,
        })),
      }
      : {}),
  })).digest("hex");
}

export function campaignRevisionMatches(expected: string | undefined, actual: string | null) {
  return Boolean(expected && actual && expected === actual);
}

export function campaignDraftOnlyBlocker(status: string | null | undefined) {
  if (!status || status === "DRAFT") return null;
  return `This campaign is ${status.toLowerCase()}, not a draft. Plan it again.`;
}

export function campaignActivationTransitionWhere(input: {
  officeId: string;
  campaignId: string;
  revisionHash: string | null;
}) {
  return {
    id: input.campaignId,
    officeId: input.officeId,
    status: "DRAFT" as const,
    revisionHash: input.revisionHash,
  };
}

export function campaignReplyCounts(input: {
  replies: readonly { threadId: string; count: number }[];
  threadToCampaign: ReadonlyMap<string, { campaignId: string; variantKey: string | null }>;
}) {
  const totals = new Map<string, number>();
  const variants = new Map<string, number>();
  for (const reply of input.replies) {
    const campaign = input.threadToCampaign.get(reply.threadId);
    if (!campaign) continue;
    totals.set(campaign.campaignId, (totals.get(campaign.campaignId) ?? 0) + reply.count);
    const variantId = `${campaign.campaignId}:${campaign.variantKey ?? ""}`;
    variants.set(variantId, (variants.get(variantId) ?? 0) + reply.count);
  }
  return { totals, variants };
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

/** Approval may only start a draft; every other status has already left the reviewable state. */
export function campaignStatusBlocker(status: string): string | null {
  if (status === "DRAFT") return null;
  return `This campaign is ${status.toLowerCase()}, not a draft, so approval cannot start it. Plan a new campaign.`;
}

export function campaignBlockers(input: {
  eligible: number;
  mailboxesAvailable: number;
  poolCapacityToday: number;
  senderPinned: boolean;
  senderRotation: boolean;
  subject: string;
  bodyTemplate: string;
  dailyCap: number;
  variants?: readonly CampaignVariant[] | null;
}) {
  const blockers: string[] = [];
  const copyBlockers = (subject: string, bodyTemplate: string, variantKey?: string) => {
    const prefix = variantKey ? `Variant ${variantKey} ` : "";
    const subjectLabel = variantKey ? "subject" : "Subject";
    const bodyLabel = variantKey ? "body" : "Body";
    if (!subject.trim()) blockers.push(`${prefix}${subjectLabel} is required.`);
    if (!bodyTemplate.trim()) blockers.push(`${prefix}${bodyLabel} is required.`);
    if (!/reply\s+(stop|no)|unsubscrib|opt out|opt-out/i.test(bodyTemplate)) {
      blockers.push(`${prefix}${bodyLabel} must contain an opt-out line.`);
    }
  };
  copyBlockers(input.subject, input.bodyTemplate);
  for (const variant of input.variants?.slice(1) ?? []) {
    copyBlockers(variant.subject, variant.bodyTemplate, variant.key);
  }
  if (input.senderRotation && input.senderPinned) {
    blockers.push("Pick either a sender mailbox or rotation, not both.");
  } else if (input.senderRotation && (input.mailboxesAvailable === 0 || input.poolCapacityToday <= 0)) {
    blockers.push("No mailbox in the shared pool has capacity today.");
  } else if (!input.senderRotation && input.mailboxesAvailable === 0) {
    blockers.push("No mailbox is connected for sending.");
  } else if (!input.senderRotation && !input.senderPinned) {
    blockers.push("Select a sender mailbox.");
  }
  if (input.eligible === 0) blockers.push("No eligible rows in this list.");
  const maxDailyCap = input.senderRotation ? 500 : 200;
  if (!Number.isInteger(input.dailyCap) || input.dailyCap < 1 || input.dailyCap > maxDailyCap) {
    blockers.push(`Daily cap must be between 1 and ${maxDailyCap}.`);
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
