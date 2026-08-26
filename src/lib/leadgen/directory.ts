import type { FetchedPage } from "./harvest";
import {
  COMPANY_SUFFIX_PATTERN,
  EMAIL_PATTERN,
  extractCity,
  extractCompanyName,
  extractEmails,
  extractPhones,
  htmlToText,
  normalizeTurkish,
  registrableDomain,
  PHONE_PATTERN,
} from "./extract";

export type DirectoryRow = {
  companyName: string;
  domain: string | null;
  emails: string[];
  phones: string[];
  city: string | null;
  rawLine: string;
  sourceUrl: string;
  rowIndex: number;
  needsResolution: boolean;
};

export type DirectoryParseOptions = {
  regions?: readonly string[];
  repeatedLineThreshold?: number;
  minRows?: number;
  densityThreshold?: number;
  maxRows?: number;
};

export type DirectoryParseResult = {
  rows: DirectoryRow[];
  skipped: number;
  kind: "pdf" | "html_table" | "delimited";
  looksLikeDirectory: boolean;
};

const HEADER_SYNONYMS: Record<keyof Pick<DirectoryRow, "companyName" | "emails" | "phones" | "city" | "domain">, readonly string[]> = {
  companyName: ["company", "firma", "unvan", "ünvan", "empresa", "компания", "name", "company name"],
  emails: ["email", "e-mail", "e posta", "e-posta", "correo", "почта", "mail"],
  phones: ["phone", "telefon", "telephone", "tel", "telefono", "teléfono", "телефон"],
  city: ["city", "il", "şehir", "ciudad", "город", "location"],
  domain: ["website", "web", "site", "url", "domain", "homepage"],
};
const NON_COMPANY_WORDS = new Set([
  "chamber", "company", "directory", "member", "members", "list", "page", "footer",
  "header", "association", "catalog", "contact", "email", "phone", "website",
]);
const MARKETING_WORDS = new Set([
  "overview", "market", "brochure", "introduction", "welcome", "products", "services",
]);

function cleanCell(value: string) {
  return htmlToText(value).replace(/\s+/g, " ").trim();
}

function normalizedHeader(value: string) {
  return normalizeTurkish(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function headerField(value: string): keyof typeof HEADER_SYNONYMS | null {
  const normalized = normalizedHeader(value);
  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    if (synonyms.some((synonym) => normalized === normalizedHeader(synonym) || normalized.includes(normalizedHeader(synonym)))) {
      return field as keyof typeof HEADER_SYNONYMS;
    }
  }
  return null;
}

function domainFromValue(value: string) {
  const email = extractEmails(value)[0];
  const url = /(https?:\/\/[^\s<>"',;]+|www\.[^\s<>"',;]+|(?:[a-z0-9-]+\.)+[a-z]{2,24})/i.exec(value)?.[0];
  const raw = email?.split("@")[1] ?? url;
  return raw ? registrableDomain(raw) : null;
}

function looksLikeCompanyName(value: string) {
  const name = cleanCell(value);
  if (name.length < 3 || /^\d+$/.test(name)) return false;
  const words = name.toLowerCase().split(/\s+/).map((word) => word.replace(/[^\p{L}]/gu, "")).filter(Boolean);
  if (words.some((word) => MARKETING_WORDS.has(word))) return false;
  if (COMPANY_SUFFIX_PATTERN.test(name)) return true;
  return words.length >= 2
    && words.some((word) => !NON_COMPANY_WORDS.has(word))
    && /\p{L}/u.test(name);
}

function repeatedLines(text: string, threshold: number) {
  const counts = new Map<string, number>();
  for (const line of text.split(/\r?\n/).map((item) => cleanCell(item)).filter(Boolean)) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > threshold).map(([line]) => line));
}

function rowFromCells(
  cells: readonly string[],
  fieldIndexes: Partial<Record<keyof typeof HEADER_SYNONYMS, number>>,
  page: FetchedPage,
  rowIndex: number,
  regions: readonly string[],
) {
  const companyValue = cells[fieldIndexes.companyName ?? 0] ?? "";
  let companyName = cleanCell(companyValue);
  const rawLine = cells.map(cleanCell).join(" | ");
  const emails = extractEmails(cells.join(" "));
  const phones = extractPhones(cells.join(" "));
  const domainValue = cells[fieldIndexes.domain ?? -1] ?? "";
  const domain = domainFromValue(domainValue) ?? domainFromValue(cells.join(" "));
  if (!looksLikeCompanyName(companyName) && !emails.length && !phones.length && !domain) return null;
  if (!looksLikeCompanyName(companyName)) companyName = extractCompanyName("", cells.join(" "), domain ?? "directory");
  const cityValue = cells[fieldIndexes.city ?? -1] ?? "";
  const city = cleanCell(cityValue) || extractCity(rawLine, regions);
  return { companyName, domain, emails, phones, city: city || null, rawLine, sourceUrl: page.url, rowIndex, needsResolution: !domain };
}

function parseDelimitedRows(page: FetchedPage, regions: readonly string[]) {
  const lines = page.body.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { rows: [], hasHeader: false };
  const delimiter = lines[0]!.includes("\t") ? "\t" : lines[0]!.includes(";") ? ";" : ",";
  const cells = lines.map((line) => line.split(delimiter).map(cleanCell));
  const headers = cells[0]!;
  const mapped = headers.map(headerField);
  const fieldIndexes: Partial<Record<keyof typeof HEADER_SYNONYMS, number>> = {};
  mapped.forEach((field, index) => { if (field && fieldIndexes[field] === undefined) fieldIndexes[field] = index; });
  const hasHeader = Object.keys(fieldIndexes).length > 0;
  const indexes = hasHeader ? fieldIndexes : { companyName: 0, emails: 1, phones: 2, city: 3, domain: 4 };
  const data = hasHeader ? cells.slice(1) : cells;
  return {
    rows: data.map((row, index) => rowFromCells(row, indexes, page, index + 1, regions)).filter((row): row is DirectoryRow => Boolean(row)),
    hasHeader,
  };
}

function parseHtmlTableRows(page: FetchedPage, regions: readonly string[]) {
  const rows: DirectoryRow[] = [];
  let rowCount = 0;
  const tableMatches = page.body.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi);
  for (const tableMatch of tableMatches) {
    const tableRows = [...(tableMatch[1] ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
      [...(match[1] ?? "").matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cleanCell(cell[1] ?? "")),
    ).filter((row) => row.length > 0);
    if (tableRows.length < 2) continue;
    const mapped = tableRows[0]!.map(headerField);
    const fieldIndexes: Partial<Record<keyof typeof HEADER_SYNONYMS, number>> = {};
    mapped.forEach((field, index) => { if (field && fieldIndexes[field] === undefined) fieldIndexes[field] = index; });
    const indexes = Object.keys(fieldIndexes).length ? fieldIndexes : { companyName: 0, emails: 1, phones: 2, city: 3, domain: 4 };
    tableRows.slice(1).forEach((row) => {
      rowCount += 1;
      const parsed = rowFromCells(row, indexes, page, rowCount, regions);
      if (parsed) rows.push(parsed);
    });
  }
  return { rows, rowCount };
}

function parsePdfRows(page: FetchedPage, regions: readonly string[], threshold: number) {
  const repeated = repeatedLines(page.body, threshold);
  const rows: DirectoryRow[] = [];
  for (const [index, line] of page.body.split(/\r?\n/).entries()) {
    const rawLine = cleanCell(line);
    if (!rawLine || repeated.has(rawLine)) continue;
    const emails = extractEmails(rawLine);
    const phones = extractPhones(rawLine);
    const domain = domainFromValue(rawLine);
    const withoutContacts = rawLine.replace(EMAIL_PATTERN, " ").replace(PHONE_PATTERN, " ");
    const companyPart = withoutContacts
      .replace(/^\s*(?:\d+\s+)+/, "")
      .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/^[|;,:\-\s]+|[|;,:\-\s]+$/g, "");
    const city = extractCity(companyPart, regions);
    const companyWithoutCity = city && new RegExp(`\\s${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(companyPart)
      ? companyPart.slice(0, -city.length).trim()
      : companyPart;
    const plausibleName = looksLikeCompanyName(companyWithoutCity);
    if (!plausibleName && !emails.length && !phones.length && !domain) continue;
    const companyName = plausibleName ? companyWithoutCity : extractCompanyName("", rawLine, domain ?? "directory");
    rows.push({
      companyName,
      domain,
      emails,
      phones,
      city: city ?? extractCity(rawLine, regions),
      rawLine,
      sourceUrl: page.url,
      rowIndex: index + 1,
      needsResolution: !domain,
    });
  }
  return rows;
}

function dedupeRows(rows: readonly DirectoryRow[]) {
  const seen = new Set<string>();
  const output: DirectoryRow[] = [];
  for (const row of rows) {
    const key = row.domain ?? normalizeTurkish(row.companyName).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

export function parseDirectoryDocument(page: FetchedPage, options: DirectoryParseOptions = {}): DirectoryParseResult {
  const regions = options.regions ?? [];
  const threshold = options.repeatedLineThreshold ?? 2;
  const hasTable = !page.isPdf && /<table\b/i.test(page.body);
  const hasDelimitedSyntax = page.contentType.includes("csv")
    || page.contentType.includes("tab-separated")
    || /^[^<\r\n]+(?:,|;|\t)[^<\r\n]+$/m.test(page.body);
  const isPlainText = !page.isPdf && !hasTable && page.contentType.includes("text/plain") && !hasDelimitedSyntax;
  const isDelimited = !page.isPdf && !hasTable && (hasDelimitedSyntax || isPlainText);
  const kind = page.isPdf ? "pdf" : hasTable ? "html_table" : "delimited";
  const htmlRows = hasTable ? parseHtmlTableRows(page, regions) : null;
  const delimitedRows = isDelimited && !page.isPdf && !isPlainText ? parseDelimitedRows(page, regions) : null;
  const rows = page.isPdf || isPlainText
    ? parsePdfRows(page, regions, threshold)
    : htmlRows ? htmlRows.rows : delimitedRows?.rows ?? [];
  const deduped = dedupeRows(rows).slice(0, options.maxRows ?? 5000);
  const minRows = options.minRows ?? 2;
  const densityThreshold = options.densityThreshold ?? 0.02;
  const lineCount = page.body.split(/\r?\n/).filter((line) => line.trim()).length;
  const denominator = kind === "html_table"
    ? Math.max(1, htmlRows?.rowCount ?? 0)
    : Math.max(1, kind === "delimited" && delimitedRows?.hasHeader !== false ? lineCount - 1 : lineCount);
  const looksLikeDirectory = deduped.length >= minRows && deduped.length / denominator >= densityThreshold;
  return {
    rows: looksLikeDirectory ? deduped : [],
    skipped: Math.max(0, lineCount - deduped.length) + (looksLikeDirectory ? 0 : deduped.length),
    kind,
    looksLikeDirectory,
  };
}
