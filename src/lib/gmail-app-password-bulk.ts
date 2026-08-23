export const MAX_BULK_GMAIL_ACCOUNTS = 10;

export type BulkGmailAccountInput = {
  displayName: string;
  email: string;
  appPassword: string;
};

const EMAIL_PATTERN = /^[^\s@,;:\"<>()[\]]+@[^\s@,;:\"<>()[\]]+\.[A-Za-z]{2,}$/;

function cleanName(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 120);
}

function normalizePassword(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function isPassword(value: string) {
  return /^[A-Za-z0-9]{16}$/.test(normalizePassword(value));
}

function parseAccountBlocks(input: string) {
  const rows: BulkGmailAccountInput[] = [];
  let current: Partial<BulkGmailAccountInput> | null = null;

  const finish = () => {
    if (!current) return;
    rows.push({
      displayName: cleanName(current.displayName ?? ""),
      email: String(current.email ?? "").trim().toLowerCase(),
      appPassword: normalizePassword(current.appPassword ?? ""),
    });
    current = null;
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (EMAIL_PATTERN.test(line)) {
      finish();
      current = { email: line.toLowerCase() };
      continue;
    }
    if (!current) continue;
    const match = line.match(/^([^:]+)\s*:\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "display name") current.displayName = value;
    if (key === "app password") current.appPassword = value;
  }
  finish();
  return rows;
}

function parseDelimitedRows(input: string) {
  const rows: BulkGmailAccountInput[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const delimiter = line.includes("\t") ? "\t" : line.includes("|") ? "|" : ",";
    const cells = line.split(delimiter).map((cell) => cell.trim());
    if (cells.some((cell) => /^email$/i.test(cell)) && cells.some((cell) => /password/i.test(cell))) continue;
    if (cells.length < 3) {
      rows.push({ displayName: "", email: "", appPassword: "" });
      continue;
    }
    const emailIndex = cells.findIndex((cell) => EMAIL_PATTERN.test(cell));
    if (emailIndex < 0) {
      rows.push({ displayName: "", email: "", appPassword: "" });
      continue;
    }
    const appPassword = normalizePassword(cells[cells.length - 1]);
    const displayName = cleanName(cells.find((_, index) => index !== emailIndex && index !== cells.length - 1) ?? "");
    rows.push({ displayName, email: cells[emailIndex].toLowerCase(), appPassword });
  }
  return rows;
}

export function parseGmailAppPasswordBulkInput(input: string) {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return { rows: [] as BulkGmailAccountInput[], errors: ["Paste at least one account."] };
  if (value.length > 30_000) return { rows: [] as BulkGmailAccountInput[], errors: ["The account list is too large."] };

  const rows = /^\s*display name\s*:/im.test(value) || /^\s*app password\s*:/im.test(value)
    ? parseAccountBlocks(value)
    : parseDelimitedRows(value);
  const errors: string[] = [];
  if (rows.length > MAX_BULK_GMAIL_ACCOUNTS) {
    errors.push(`Add no more than ${MAX_BULK_GMAIL_ACCOUNTS} accounts in one batch.`);
  }
  const seen = new Set<string>();
  rows.slice(0, MAX_BULK_GMAIL_ACCOUNTS).forEach((row, index) => {
    const label = `Row ${index + 1}`;
    if (!row.displayName) errors.push(`${label}: display name is required.`);
    if (!EMAIL_PATTERN.test(row.email)) errors.push(`${label}: enter a valid email address.`);
    if (!isPassword(row.appPassword)) errors.push(`${label}: enter a 16-character Gmail app password.`);
    if (row.email && seen.has(row.email)) errors.push(`${label}: duplicate email address.`);
    if (row.email) seen.add(row.email);
  });
  return { rows: rows.slice(0, MAX_BULK_GMAIL_ACCOUNTS), errors };
}
