import { createHash } from "node:crypto";

// Review helpers for approving one batch of outbound mail at a time instead of
// one recipient at a time. Everything here is pure so the outreach campaign
// planner and the bulk RFQ preview show the same kind of evidence.

export const BATCH_REVIEW_HEAD_SIZE = 3;
export const BATCH_REVIEW_SPOT_SIZE = 7;
export const BATCH_REVIEW_MAX_ITEMS = BATCH_REVIEW_HEAD_SIZE + BATCH_REVIEW_SPOT_SIZE;

export type SpotCheckPick<T> = {
  item: T;
  // Zero-based position inside the full batch, so a reviewer can see the sample
  // spans the audience rather than its first page.
  position: number;
  pick: "head" | "spot";
};

const ROLE_MAILBOXES = new Set([
  "info", "sales", "contact", "office", "hello", "mail", "admin", "support", "export",
  "import", "marketing", "enquiries", "enquiry", "inquiries", "inquiry", "orders", "order",
  "purchasing", "procurement", "team", "general", "webmaster", "postmaster", "noreply",
  "no-reply", "service", "customerservice", "reception", "accounts", "billing", "hr", "jobs",
  "careers", "press", "media", "privacy", "legal", "abuse", "security",
]);

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "hotmail.com",
  "hotmail.co.uk", "hotmail.fr", "hotmail.de", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mail.com", "gmx.com", "gmx.de", "gmx.net", "web.de", "yandex.com",
  "yandex.ru", "mail.ru", "protonmail.com", "proton.me", "zoho.com", "qq.com", "163.com", "126.com",
]);

function stableFraction(seed: string, index: number) {
  const digest = createHash("sha256").update(`${seed}:${index}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

// The first few items plus a seeded spread across the rest. The same seed and
// batch always give the same sample, so the reviewed rows are the ones the
// approval hash pins, and a different seed shows different rows next time.
export function spotCheckSample<T>(
  items: readonly T[],
  input: { seed: string; head?: number; spot?: number },
): SpotCheckPick<T>[] {
  const head = Math.max(0, input.head ?? BATCH_REVIEW_HEAD_SIZE);
  const spot = Math.max(0, input.spot ?? BATCH_REVIEW_SPOT_SIZE);
  const picks: SpotCheckPick<T>[] = [];
  const taken = new Set<number>();
  for (let index = 0; index < Math.min(head, items.length); index++) {
    picks.push({ item: items[index], position: index, pick: "head" });
    taken.add(index);
  }
  const remaining = items.length - taken.size;
  if (remaining <= 0 || spot === 0) return picks;
  const wanted = Math.min(spot, remaining);
  const span = remaining / wanted;
  for (let slot = 0; slot < wanted; slot++) {
    const offset = Math.floor(slot * span + stableFraction(input.seed, slot) * span);
    let position = head + Math.min(offset, remaining - 1);
    while (taken.has(position)) position = position + 1 < items.length ? position + 1 : head;
    taken.add(position);
    picks.push({ item: items[position], position, pick: "spot" });
  }
  return picks.sort((left, right) => left.position - right.position);
}

export type RecipientQualitySummary = {
  total: number;
  uniqueDomains: number;
  // Domains that appear more than once, largest first. Twenty mails to one
  // company usually means the list needs review before anything is sent.
  repeatedDomains: Array<{ domain: string; count: number }>;
  roleAddresses: number;
  freeMailAddresses: number;
  duplicateAddresses: number;
  invalidAddresses: number;
  countries: Array<{ country: string; count: number }>;
  warnings: string[];
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isRoleAddress(email: string) {
  const local = normalizeEmail(email).split("@")[0] ?? "";
  const base = local.split("+")[0] ?? local;
  // sales.team@ and info-de@ are still role mailboxes; jane.doe@ is not.
  return ROLE_MAILBOXES.has(base)
    || ROLE_MAILBOXES.has(base.replace(/[._-]/g, ""))
    || ROLE_MAILBOXES.has(base.split(/[._-]/)[0] ?? "");
}

export function isFreeMailAddress(email: string) {
  const domain = normalizeEmail(email).split("@")[1] ?? "";
  return FREE_MAIL_DOMAINS.has(domain);
}

export function summarizeRecipientQuality(
  recipients: readonly { email: string; country?: string | null }[],
): RecipientQualitySummary {
  const seen = new Set<string>();
  const domains = new Map<string, number>();
  const countries = new Map<string, number>();
  let roleAddresses = 0;
  let freeMailAddresses = 0;
  let duplicateAddresses = 0;
  let invalidAddresses = 0;
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient.email);
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) {
      invalidAddresses += 1;
      continue;
    }
    if (seen.has(email)) duplicateAddresses += 1;
    seen.add(email);
    const domain = email.split("@")[1] ?? "";
    domains.set(domain, (domains.get(domain) ?? 0) + 1);
    if (isRoleAddress(email)) roleAddresses += 1;
    if (isFreeMailAddress(email)) freeMailAddresses += 1;
    const country = recipient.country?.trim() || "unknown";
    countries.set(country, (countries.get(country) ?? 0) + 1);
  }
  const byCount = <K extends string>(map: Map<K, number>) =>
    [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const repeatedDomains = byCount(domains)
    .filter(([, count]) => count > 1)
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));
  const total = recipients.length;
  const warnings: string[] = [];
  const share = (count: number) => (total ? Math.round((count / total) * 100) : 0);
  const heaviest = repeatedDomains[0];
  if (heaviest && total >= 5 && heaviest.count / total >= 0.2) {
    warnings.push(`${heaviest.count} of ${total} recipients share the domain ${heaviest.domain}.`);
  }
  if (total >= 5 && roleAddresses / total >= 0.5) {
    warnings.push(`${share(roleAddresses)}% are role mailboxes (info@, sales@, ...), not named contacts.`);
  }
  if (duplicateAddresses > 0) {
    warnings.push(`${duplicateAddresses} address${duplicateAddresses === 1 ? " appears" : "es appear"} more than once.`);
  }
  if (invalidAddresses > 0) {
    warnings.push(`${invalidAddresses} address${invalidAddresses === 1 ? " is" : "es are"} not valid email syntax.`);
  }
  if (total >= 5 && freeMailAddresses / total >= 0.3) {
    warnings.push(`${share(freeMailAddresses)}% use free mail providers.`);
  }
  return {
    total,
    uniqueDomains: domains.size,
    repeatedDomains,
    roleAddresses,
    freeMailAddresses,
    duplicateAddresses,
    invalidAddresses,
    countries: byCount(countries).slice(0, 10).map(([country, count]) => ({ country, count })),
    warnings,
  };
}

export function recipientQualityLines(summary: RecipientQualitySummary) {
  const lines = [
    `Audience quality: ${summary.total} recipients across ${summary.uniqueDomains} domains, ${summary.roleAddresses} role mailboxes, ${summary.freeMailAddresses} free-mail addresses.`,
  ];
  if (summary.countries.length > 0) {
    lines.push(`Countries: ${summary.countries.map((entry) => `${entry.country} ${entry.count}`).join(", ")}.`);
  }
  if (summary.repeatedDomains.length > 0) {
    lines.push(`Repeated domains: ${summary.repeatedDomains.map((entry) => `${entry.domain} x${entry.count}`).join(", ")}.`);
  }
  for (const warning of summary.warnings) lines.push(`Warning: ${warning}`);
  return lines;
}

// Pins the exact recipient set a reviewer approved. Order independent, so two
// previews of the same audience agree even if the rows were listed differently.
export function batchRecipientHash(entries: readonly { id: string; email: string }[]) {
  const keys = entries.map((entry) => `${entry.id}:${normalizeEmail(entry.email)}`).sort();
  return createHash("sha256").update(JSON.stringify(keys)).digest("hex");
}

export function spotCheckLabel(pick: Pick<SpotCheckPick<unknown>, "pick" | "position">, total: number) {
  return `${pick.pick === "head" ? "Row" : "Spot check, row"} ${pick.position + 1} of ${total}`;
}
