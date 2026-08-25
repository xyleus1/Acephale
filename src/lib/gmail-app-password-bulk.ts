export const MAX_BULK_GMAIL_ACCOUNTS = 60;

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

const MAILBOX_HEADER = /^(mailbox|email|email[_\s-]?address|smtp[_\s-]?user)$/i;
const DISPLAY_NAME_HEADER = /^(display[_\s-]?name|name|sender[_\s-]?name|from[_\s-]?name)$/i;
const APP_PASSWORD_HEADER = /^(app[_\s-]?password|password|smtp[_\s-]?password)$/i;

function splitCells(line: string) {
  const delimiter = line.includes("\t") ? "\t" : line.includes("|") ? "|" : ",";
  return line.split(delimiter).map((cell) => cell.trim());
}

function headerColumns(line: string) {
  const cells = splitCells(line);
  const mailbox = cells.findIndex((cell) => MAILBOX_HEADER.test(cell));
  const appPassword = cells.findIndex((cell) => APP_PASSWORD_HEADER.test(cell));
  if (mailbox < 0 || appPassword < 0) return null;
  const displayName = cells.findIndex((cell) => DISPLAY_NAME_HEADER.test(cell));
  return { mailbox, displayName, appPassword };
}

function parseHeaderRows(
  input: string,
  columns: { mailbox: number; displayName: number; appPassword: number },
) {
  const rows: BulkGmailAccountInput[] = [];
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice(1)) {
    const cells = splitCells(line);
    rows.push({
      displayName: cleanName(columns.displayName >= 0 ? cells[columns.displayName] ?? "" : ""),
      email: String(cells[columns.mailbox] ?? "").trim().toLowerCase(),
      appPassword: normalizePassword(cells[columns.appPassword] ?? ""),
    });
  }
  return rows;
}

function parseDelimitedRows(input: string) {
  const rows: BulkGmailAccountInput[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = splitCells(line);
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
  if (value.length > 120_000) return { rows: [] as BulkGmailAccountInput[], errors: ["The account list is too large."] };

  const firstLine = value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  const columns = EMAIL_PATTERN.test(firstLine) ? null : headerColumns(firstLine);
  const rows = /^\s*display name\s*:/im.test(value) || /^\s*app password\s*:/im.test(value)
    ? parseAccountBlocks(value)
    : columns
      ? parseHeaderRows(value, columns)
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
