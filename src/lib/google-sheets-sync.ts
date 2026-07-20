"use server";

import crypto from "crypto";
import type { JobStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { createWithFileReference } from "./references";
import { metaLeadsSources, type MetaLeadsSource } from "./meta-leads";
import { autoReplyToUsLeads } from "./lead-auto-reply";
import { ingestKnowledgeObject } from "./memory/ingest-object";
import { recordMemoryEvent } from "./memory/record-event";

const DEFAULT_SPREADSHEET_ID = "1CFmfSdFJKOCThss5xzglHb5GihPRlK3pRxLCmpuFUHg";
const DEFAULT_REQUESTS_TAB = "06/2026 Talepler";
const DEFAULT_OPERATIONS_TAB = "Operasyonlar";
const DEFAULT_REQUESTS_GID = "0";
const DEFAULT_OPERATIONS_GID = "883687961";

type LeadCounts = { created: number; updated: number; skipped: number };

type SyncSummary = {
  ok: true;
  spreadsheetId: string;
  requests: { created: number; updated: number; skipped: number };
  operations: { created: number; updated: number; skipped: number; companiesCreated: number };
  leads: LeadCounts;
  leadsUs: LeadCounts;
  autoReplies: { sent: number; skipped: number; failed: number };
  warnings: string[];
};

type Money = { amount: number | null; currency: string | null };

function sheetsConfig() {
  return {
    spreadsheetId: process.env.DERYA_GOOGLE_SHEET_ID ?? DEFAULT_SPREADSHEET_ID,
    requestsTab: process.env.DERYA_GOOGLE_SHEET_REQUESTS_TAB ?? DEFAULT_REQUESTS_TAB,
    operationsTab: process.env.DERYA_GOOGLE_SHEET_OPERATIONS_TAB ?? DEFAULT_OPERATIONS_TAB,
    requestsGid: process.env.DERYA_GOOGLE_SHEET_REQUESTS_GID ?? DEFAULT_REQUESTS_GID,
    operationsGid: process.env.DERYA_GOOGLE_SHEET_OPERATIONS_GID ?? DEFAULT_OPERATIONS_GID,
  };
}

function memoryPayloadDigest(payload: Record<string, unknown>) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

async function getServiceAccountToken(): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const privateKey = rawKey.replace(/\\n/g, "\n");
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Google service account token failed: ${res.status} ${body.slice(0, 240)}`);
  const json = JSON.parse(body) as { access_token?: string };
  if (!json.access_token) throw new Error("Google service account token response had no access_token.");
  return json.access_token;
}

function csvParse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

async function fetchValuesFromCsv(spreadsheetId: string, gid: string): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  const res = await fetch(url, { headers: { Accept: "text/csv" } });
  const text = await res.text();
  if (!res.ok || /^<!doctype html/i.test(text.trim())) {
    throw new Error("Google Sheet is not publicly readable. Add a service account or API key, or publish the sheet for CSV export.");
  }
  return csvParse(text);
}

async function fetchValues(args: {
  spreadsheetId: string;
  tab: string;
  range: string;
  gid: string;
}): Promise<string[][]> {
  const token = await getServiceAccountToken();
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;

  if (token || apiKey) {
    const a1 = `'${args.tab.replace(/'/g, "''")}'!${args.range}`;
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheetId}/values/${encodeURIComponent(a1)}`);
    if (apiKey && !token) url.searchParams.set("key", apiKey);
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Google Sheets read failed: ${res.status} ${text.slice(0, 240)}`);
    const json = JSON.parse(text) as { values?: string[][] };
    return json.values ?? [];
  }

  return fetchValuesFromCsv(args.spreadsheetId, args.gid);
}

function clean(value: unknown): string | null {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
}

function normalizeCurrency(currency: string | null): string | null {
  if (!currency) return null;
  const c = currency.trim().toUpperCase();
  if (["TL", "TRY"].includes(c)) return "TRY";
  if (["USD", "$"].includes(c)) return "USD";
  if (["EUR", "EURO", "€"].includes(c)) return "EUR";
  if (["GBP", "£"].includes(c)) return "GBP";
  return c.slice(0, 8);
}

function parseMoney(value: unknown, fallbackCurrency?: string | null): Money {
  const raw = clean(value);
  if (!raw) return { amount: null, currency: normalizeCurrency(fallbackCurrency ?? null) };

  // No leading \b: budgets like "3000euro" have no boundary between digit and letter.
  const currencyMatch = raw.match(/(USD|EURO?|TRY|TL|GBP)\b|[$€£]/i);
  const numberMatch = raw.match(/-?\d[\d.,]*/);
  if (!numberMatch) return { amount: null, currency: normalizeCurrency(currencyMatch?.[0] ?? fallbackCurrency ?? null) };

  let normalized = numberMatch[0];
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");
  if (hasComma && hasDot) {
    normalized = normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (hasComma) {
    const parts = normalized.split(",");
    normalized = parts[1]?.length === 3 ? normalized.replace(/,/g, "") : normalized.replace(",", ".");
  }

  let amount = Number(normalized);
  // "3k" / "8-14k" style budgets: apply the thousands suffix (to the range's
  // low end — the first number is what got matched).
  if (Number.isFinite(amount) && /\d\s*k\b/i.test(raw)) amount *= 1000;
  return {
    amount: Number.isFinite(amount) ? amount : null,
    currency: normalizeCurrency(currencyMatch?.[0] ?? fallbackCurrency ?? null),
  };
}

function parseDate(value: unknown): Date | null {
  const raw = clean(value);
  if (!raw) return null;
  const parts = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (parts) {
    const year = Number(parts[3].length === 2 ? `20${parts[3]}` : parts[3]);
    const month = Number(parts[2]) - 1;
    const day = Number(parts[1]);
    const d = new Date(Date.UTC(year, month, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapRequestStatus(status: string | null) {
  const s = (status ?? "").toLocaleUpperCase("tr-TR");
  if (s.includes("OPERASYON")) return "WON";
  if (s.includes("TEKLİF") || s.includes("TEKLIF") || s.includes("FIYAT VER")) return "QUOTED";
  if (s.includes("FIYAT ALINMADI")) return "INGESTED";
  return "PARSED";
}

function mapOperationStatus(status: string | null): JobStatus {
  const s = (status ?? "").toLocaleUpperCase("tr-TR");
  if (s.includes("TESLİM") || s.includes("TESLIM") || s.includes("DELIVER")) return "DELIVERED";
  if (s.includes("YOLDA") || s.includes("ETA") || s.includes("ÇIKIŞ") || s.includes("CIKIS")) return "IN_TRANSIT";
  if (s.includes("BEKLEN")) return "BOOKED";
  return "BOOKED";
}

function mapMode(mode: string | null) {
  const s = (mode ?? "").toLocaleUpperCase("tr-TR");
  if (s.includes("KARA") || s.includes("ROAD") || s.includes("TRUCK")) return "ROAD";
  if (s.includes("HAVA") || s.includes("AIR")) return "AIR";
  if (s.includes("LCL")) return "SEA-LCL";
  if (s.includes("FCL") || s.includes("DENİZ") || s.includes("DENIZ") || s.includes("SEA")) return "SEA-FCL";
  return clean(mode);
}

function splitRoute(route: string | null): { origin: string | null; destination: string | null } {
  if (!route) return { origin: null, destination: null };
  const parts = route.split(/\s*[-–→]\s*/).map((p) => clean(p)).filter(Boolean) as string[];
  return { origin: parts[0] ?? null, destination: parts[1] ?? null };
}

function notes(lines: Array<[string, string | null]>) {
  return lines
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n") || null;
}

async function syncRequestRows(officeId: string, rows: string[][]) {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 1;
    const request = clean(row[0]);
    const origin = clean(row[3]);
    const destination = clean(row[4]);
    const cargoNotes = clean(row[5]);
    if (!request && !origin && !destination && !cargoNotes) {
      skipped++;
      continue;
    }

    const sourceKey = `sheet:requests:${rowNumber}`;
    const target = parseMoney(row[2]);
    const agentQuote = clean(row[8]);
    const andelogQuote = clean(row[9]);
    const margin = clean(row[10]);
    const status = mapRequestStatus(clean(row[6]));
    const receivedAt = parseDate(row[1]) ?? new Date();
    const routeSubject = [origin, destination].filter(Boolean).join(" -> ");
    const subject = request ?? (routeSubject || `Sheet request ${rowNumber}`);
    const parsedData = JSON.stringify({
      source: "google-sheet",
      sourceKey,
      tab: DEFAULT_REQUESTS_TAB,
      rowNumber,
      status: clean(row[6]),
      finalStatus: clean(row[7]),
      agentQuote,
      andelogQuote,
      margin,
    });

    const existing = await prisma.inquiry.findFirst({
      where: { officeId, parsedData: { contains: `"sourceKey":"${sourceKey}"` } },
      select: { id: true },
    });

    const data = {
      subject,
      origin,
      destination,
      commodity: cargoNotes ?? request,
      type: "FORWARDING",
      status,
      targetPrice: target.amount,
      targetCurrency: target.currency,
      targetPriceStatus: target.amount ? "PROVIDED" : "UNKNOWN",
      targetPriceSource: target.amount ? "Google Sheet target price" : null,
      rawEmailBody: notes([
        ["Request", request],
        ["Cargo / notes", cargoNotes],
        ["Status", clean(row[6])],
        ["Final status", clean(row[7])],
        ["Agent quote", agentQuote],
        ["Andelog quote", andelogQuote],
        ["Margin", margin],
      ]),
      parsedData,
      notes: notes([
        ["Imported from", `${DEFAULT_REQUESTS_TAB} row ${rowNumber}`],
        ["Status", clean(row[6])],
        ["Final status", clean(row[7])],
        ["Agent quote", agentQuote],
        ["Andelog quote", andelogQuote],
        ["Margin", margin],
      ]),
      receivedAt,
    };

    const eventType = existing ? "google_sheets.inquiry.updated" : "google_sheets.inquiry.created";
    const saved = existing
      ? await prisma.inquiry.update({ where: { id: existing.id }, data })
      : await createWithFileReference(
          officeId,
          (reference) => prisma.inquiry.create({ data: { officeId, reference, ...data } }),
          receivedAt
        );
    const sourceExternalId = `google_sheets:request:${sourceKey}`;
    const payload = {
      inquiryId: saved.id,
      sourceKey,
      rowNumber,
      tab: DEFAULT_REQUESTS_TAB,
      spreadsheetId: sheetsConfig().spreadsheetId,
      subject,
      origin,
      destination,
      status,
      targetPrice: target.amount,
      targetCurrency: target.currency,
      operation: existing ? "update" : "create",
    };
    const memoryObject = await ingestKnowledgeObject({
      officeId,
      sourceType: "GOOGLE_SHEETS",
      sourceExternalId,
      sourceLabel: DEFAULT_REQUESTS_TAB,
      sourceMetadata: { spreadsheetId: sheetsConfig().spreadsheetId, tab: DEFAULT_REQUESTS_TAB },
      canonicalType: "rfq",
      title: subject,
      text: [subject, origin, destination, cargoNotes, data.notes].filter(Boolean).join("\n"),
      entityType: "inquiry",
      entityId: saved.id,
      inquiryId: saved.id,
      occurredAt: saved.updatedAt,
      payload,
      provenance: {
        source: "google_sheets",
        operation: existing ? "sync_request_row_update" : "sync_request_row_create",
        path: "src/lib/google-sheets-sync.ts",
        function: "syncRequestRows",
        sourceRecordId: saved.id,
        sourceExternalId: sourceKey,
      },
    }).catch(() => null);
    await recordMemoryEvent({
      officeId,
      sourceType: "GOOGLE_SHEETS",
      sourceExternalId,
      sourceLabel: DEFAULT_REQUESTS_TAB,
      sourceMetadata: { spreadsheetId: sheetsConfig().spreadsheetId, tab: DEFAULT_REQUESTS_TAB },
      objectId: memoryObject?.id ?? null,
      eventType,
      entityType: "inquiry",
      entityId: saved.id,
      occurredAt: saved.updatedAt,
      payloadVersion: 1,
      payload,
      provenance: {
        source: "google_sheets",
        operation: existing ? "sync_request_row_update" : "sync_request_row_create",
        path: "src/lib/google-sheets-sync.ts",
        function: "syncRequestRows",
        sourceRecordId: saved.id,
        sourceExternalId: sourceKey,
      },
      idempotencyKey: `google_sheets:request:${sourceKey}:${saved.id}:${existing ? "updated" : "created"}:${memoryPayloadDigest(payload)}`,
    }).catch(() => null);

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  return { created, updated, skipped };
}

async function syncOperationRows(officeId: string, rows: string[][]) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let companiesCreated = 0;

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 1;
    const reference = clean(row[0]);
    const customerName = clean(row[1]);
    const operation = clean(row[2]);
    if (!reference || !customerName) {
      skipped++;
      continue;
    }

    const companyBefore = await prisma.company.findUnique({
      where: { officeId_name: { officeId, name: customerName } },
      select: { id: true },
    });
    const company = await prisma.company.upsert({
      where: { officeId_name: { officeId, name: customerName } },
      update: { status: "WORKED" },
      create: { officeId, name: customerName, status: "WORKED" },
      select: { id: true },
    });
    if (!companyBefore) companiesCreated++;

    const purchase = parseMoney(row[6], clean(row[7]));
    const sale = parseMoney(row[8], clean(row[9]) ?? purchase.currency);
    const route = splitRoute(operation);
    const existing = await prisma.job.findUnique({
      where: { officeId_reference: { officeId, reference } },
      select: { id: true, notes: true },
    });
    // Only overwrite jobs this sheet created itself (marked "Imported from:"
    // in notes). A sheet row whose reference happens to match an app-created
    // load must never clobber the operator's data.
    if (existing && !(existing.notes ?? "").includes("Imported from:")) {
      skipped++;
      continue;
    }

    const data = {
      companyId: company.id,
      reference,
      title: operation,
      status: mapOperationStatus(clean(row[14])),
      type: "FORWARDING",
      mode: mapMode(clean(row[3])),
      origin: route.origin,
      destination: route.destination,
      commodity: clean(row[4]),
      revenue: sale.amount,
      cost: purchase.amount,
      currency: sale.currency ?? purchase.currency ?? "USD",
      notes: notes([
        ["Imported from", `${DEFAULT_OPERATIONS_TAB} row ${rowNumber}`],
        ["Agent", clean(row[5])],
        ["Purchase cost", clean(row[6])],
        ["Sales price", clean(row[8])],
        ["Margin", clean(row[10])],
        ["Margin rate", clean(row[11])],
        ["Payment status", clean(row[12])],
        ["Payment date", clean(row[13])],
        ["Operation status", clean(row[14])],
        ["Remarks", clean(row[15])],
      ]),
    };

    const eventType = existing ? "google_sheets.job.updated" : "google_sheets.job.created";
    const saved = existing
      ? await prisma.job.update({ where: { id: existing.id }, data })
      : await prisma.job.create({ data: { officeId, ...data } });
    const sourceExternalId = `google_sheets:operation:${reference}`;
    const payload = {
      jobId: saved.id,
      reference,
      rowNumber,
      tab: DEFAULT_OPERATIONS_TAB,
      spreadsheetId: sheetsConfig().spreadsheetId,
      customerName,
      operation,
      status: saved.status,
      revenue: saved.revenue,
      cost: saved.cost,
      currency: saved.currency,
      syncOperation: existing ? "update" : "create",
    };
    const memoryObject = await ingestKnowledgeObject({
      officeId,
      sourceType: "GOOGLE_SHEETS",
      sourceExternalId,
      sourceLabel: DEFAULT_OPERATIONS_TAB,
      sourceMetadata: { spreadsheetId: sheetsConfig().spreadsheetId, tab: DEFAULT_OPERATIONS_TAB },
      canonicalType: "job",
      title: saved.title ?? saved.reference,
      text: [saved.reference, saved.title, customerName, saved.origin, saved.destination, saved.mode, saved.commodity, saved.notes].filter(Boolean).join("\n"),
      entityType: "job",
      entityId: saved.id,
      companyId: saved.companyId,
      inquiryId: saved.inquiryId,
      jobId: saved.id,
      occurredAt: saved.updatedAt,
      payload,
      provenance: {
        source: "google_sheets",
        operation: existing ? "sync_operation_row_update" : "sync_operation_row_create",
        path: "src/lib/google-sheets-sync.ts",
        function: "syncOperationRows",
        sourceRecordId: saved.id,
        sourceExternalId: reference,
      },
    }).catch(() => null);
    await recordMemoryEvent({
      officeId,
      sourceType: "GOOGLE_SHEETS",
      sourceExternalId,
      sourceLabel: DEFAULT_OPERATIONS_TAB,
      sourceMetadata: { spreadsheetId: sheetsConfig().spreadsheetId, tab: DEFAULT_OPERATIONS_TAB },
      objectId: memoryObject?.id ?? null,
      eventType,
      entityType: "job",
      entityId: saved.id,
      occurredAt: saved.updatedAt,
      payloadVersion: 1,
      payload,
      provenance: {
        source: "google_sheets",
        operation: existing ? "sync_operation_row_update" : "sync_operation_row_create",
        path: "src/lib/google-sheets-sync.ts",
        function: "syncOperationRows",
        sourceRecordId: saved.id,
        sourceExternalId: reference,
      },
      idempotencyKey: `google_sheets:operation:${reference}:${saved.id}:${existing ? "updated" : "created"}:${memoryPayloadDigest(payload)}`,
    }).catch(() => null);

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  return { created, updated, skipped, companiesCreated };
}

// Meta Lead Ads answers use underscores for spaces (e.g. "hayır,_bireysel_gönderi").
function pretty(value: unknown): string | null {
  return clean(String(value ?? "").replace(/_/g, " "));
}

async function syncMetaLeadRows(officeId: string, rows: string[][], source: MetaLeadsSource) {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const dataRows = rows[0]?.[0]?.trim() === "id" ? rows.slice(1) : rows;
  for (const row of dataRows) {
    const sourceKey = clean(row[0]);
    if (!sourceKey) {
      skipped++;
      continue;
    }

    const receivedAt = parseDate(row[1]) ?? new Date();
    const adName = clean(row[3]);
    const campaignName = clean(row[7]);
    const formName = clean(row[9]);
    const organic = clean(row[10]) === "true";
    const platform = clean(row[11]);
    const commercial = pretty(row[12]);
    const shipmentType = pretty(row[13]);
    const loadInfo = pretty(row[14]);
    const timing = pretty(row[15]);
    const transportPref = pretty(row[16]);
    const existingQuote = pretty(row[17]);
    const budgetRaw = clean(row[18]);
    const origin = clean(row[19]);
    const destination = clean(row[20]);
    const commodity = clean(row[21]);
    const email = clean(row[22]);
    const fullName = clean(row[23]);
    const phone = clean(row[24])?.replace(/^p:/, "") ?? null;
    const companyRaw = clean(row[25]);
    const companyName = companyRaw && companyRaw !== "." ? companyRaw : null;
    const jobTitle = clean(row[26]);
    const leadStatus = clean(row[28]);

    // The size answers tell us when a lead is container freight — mark it so
    // downstream drafts price it as FCL instead of asking for box dimensions.
    const sizeText = `${shipmentType ?? ""} ${loadInfo ?? ""}`.toLocaleLowerCase("en-US");
    const containerType = /container|konteyner/.test(sizeText)
      ? /40/.test(sizeText) ? "40FT" : /20/.test(sizeText) ? "20FT" : "CONTAINER"
      : null;

    // Lead forms are free text; people paste phone numbers into the budget
    // field. Anything outside a sane freight budget is noise, not a price.
    const budgetParsed = parseMoney(budgetRaw, "USD");
    const budget = budgetParsed.amount != null && budgetParsed.amount > 0 && budgetParsed.amount <= 1_000_000
      ? budgetParsed
      : { amount: null, currency: null };
    const platformLabel = platform === "ig" ? "Instagram" : platform === "fb" ? "Facebook" : platform ?? "Meta";
    const route = [origin, destination].filter(Boolean).join(" → ");
    const subject = (
      `${source.subjectPrefix}: ${commodity ?? shipmentType ?? "shipment"}${route ? ` — ${route}` : ""}`
    ).slice(0, 160);

    const existing = await prisma.inquiry.findFirst({
      where: { officeId, parsedData: { contains: `"sourceKey":"${sourceKey}"` } },
      select: { id: true, status: true, parsedData: true },
    });

    // Send stamps live in parsedData; a resync rewrite must not erase them.
    let existingStamps: Record<string, unknown> = {};
    if (existing?.parsedData) {
      try {
        const prev = JSON.parse(existing.parsedData);
        if (prev && typeof prev === "object") {
          if (prev.deskForwardedAt) existingStamps.deskForwardedAt = prev.deskForwardedAt;
          if (prev.confirmationSentAt) existingStamps.confirmationSentAt = prev.confirmationSentAt;
          if (prev.infoRequestSentAt) existingStamps.infoRequestSentAt = prev.infoRequestSentAt;
          if (prev.whatsappSentAt) existingStamps.whatsappSentAt = prev.whatsappSentAt;
          if (prev.autoRepliedAt) existingStamps.autoRepliedAt = prev.autoRepliedAt;
          if (prev.scopeAskedAt) existingStamps.scopeAskedAt = prev.scopeAskedAt;
        }
      } catch {
        existingStamps = {};
      }
    }

    const parsedData = JSON.stringify({
      source: "meta-leads",
      market: source.market,
      sourceKey,
      platform,
      organic,
      adName,
      campaignName,
      formName,
      leadStatus,
      budget: budgetRaw,
      fullName,
      phone,
      jobTitle,
      answers: { commercial, shipmentType, loadInfo, timing, transportPref, existingQuote },
      ...existingStamps,
    });

    const leadBody = notes([
      ["Lead", sourceKey],
      ["Market", source.market],
      ["Platform", organic ? `${platformLabel} (organic)` : platformLabel],
      ["Campaign", campaignName],
      ["Ad", adName],
      ["Form", formName],
      ["Name", fullName],
      ["Phone", phone],
      ["Company", companyName],
      ["Job title", jobTitle],
      ["Commercial shipment", commercial],
      ["Shipment type", shipmentType],
      ["Load info", loadInfo],
      ["Timing", timing],
      ["Transport preference", transportPref],
      ["Existing quote", existingQuote],
      ["Budget", budgetRaw],
      ["Origin", origin],
      ["Destination", destination],
      ["Commodity", commodity],
      ["Lead status", leadStatus],
    ]);

    const data = {
      subject,
      fromEmail: email,
      fromCompany: companyName ?? fullName,
      origin,
      destination,
      commodity,
      containerType,
      containerCount: containerType ? 1 : null,
      type: "FORWARDING",
      status: "INGESTED",
      targetPrice: budget.amount,
      targetCurrency: budget.amount != null ? budget.currency ?? "USD" : null,
      targetPriceStatus: budget.amount != null ? "PROVIDED" : "UNKNOWN",
      targetPriceSource: budget.amount != null ? "Meta lead form budget" : null,
      rawEmailBody: leadBody,
      parsedData,
      notes: leadBody,
      receivedAt,
    };

    const eventType = existing ? "meta_leads.inquiry.updated" : "meta_leads.inquiry.created";
    // Operators advance lead RFQs in-app; a resync must not reset their status.
    const saved = existing
      ? await prisma.inquiry.update({ where: { id: existing.id }, data: { ...data, status: existing.status } })
      : await createWithFileReference(
          officeId,
          (reference) => prisma.inquiry.create({ data: { officeId, reference, ...data } }),
          receivedAt
        );

    const sourceExternalId = `meta_leads:${sourceKey}`;
    const payload = {
      inquiryId: saved.id,
      sourceKey,
      market: source.market,
      spreadsheetId: source.spreadsheetId,
      tab: source.tab,
      subject,
      platform,
      campaignName,
      origin,
      destination,
      targetPrice: budget.amount,
      targetCurrency: budget.currency,
      operation: existing ? "update" : "create",
    };
    const memoryObject = await ingestKnowledgeObject({
      officeId,
      sourceType: "GOOGLE_SHEETS",
      sourceExternalId,
      sourceLabel: source.sourceLabel,
      sourceMetadata: { spreadsheetId: source.spreadsheetId, tab: source.tab, market: source.market },
      canonicalType: "rfq",
      title: subject,
      text: [subject, leadBody].filter(Boolean).join("\n"),
      entityType: "inquiry",
      entityId: saved.id,
      inquiryId: saved.id,
      occurredAt: saved.updatedAt,
      payload,
      provenance: {
        source: "google_sheets",
        operation: existing ? "sync_meta_lead_row_update" : "sync_meta_lead_row_create",
        path: "src/lib/google-sheets-sync.ts",
        function: "syncMetaLeadRows",
        sourceRecordId: saved.id,
        sourceExternalId: sourceKey,
      },
    }).catch(() => null);
    await recordMemoryEvent({
      officeId,
      sourceType: "GOOGLE_SHEETS",
      sourceExternalId,
      sourceLabel: source.sourceLabel,
      sourceMetadata: { spreadsheetId: source.spreadsheetId, tab: source.tab, market: source.market },
      objectId: memoryObject?.id ?? null,
      eventType,
      entityType: "inquiry",
      entityId: saved.id,
      occurredAt: saved.updatedAt,
      payloadVersion: 1,
      payload,
      provenance: {
        source: "google_sheets",
        operation: existing ? "sync_meta_lead_row_update" : "sync_meta_lead_row_create",
        path: "src/lib/google-sheets-sync.ts",
        function: "syncMetaLeadRows",
        sourceRecordId: saved.id,
        sourceExternalId: sourceKey,
      },
      idempotencyKey: `meta_leads:${sourceKey}:${saved.id}:${existing ? "updated" : "created"}:${memoryPayloadDigest(payload)}`,
    }).catch(() => null);

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  return { created, updated, skipped };
}

export async function syncDeryaGoogleSheet(): Promise<SyncSummary | { error: string }> {
  const session = await requireSession();
  return syncDeryaGoogleSheetForOffice(session.officeId);
}

export async function syncDeryaGoogleSheetForOffice(officeId: string): Promise<SyncSummary | { error: string }> {
  const config = sheetsConfig();
  const warnings: string[] = [];
  let requests = { created: 0, updated: 0, skipped: 0 };
  let operations = { created: 0, updated: 0, skipped: 0, companiesCreated: 0 };
  const leadCounts: Record<MetaLeadsSource["market"], LeadCounts> = {
    TR: { created: 0, updated: 0, skipped: 0 },
    US: { created: 0, updated: 0, skipped: 0 },
  };
  let anySucceeded = false;

  // The deal sheet (Talepler/Operasyonlar) and the Meta lead sheets are
  // independent sources; one being unreadable must not block the others.
  try {
    const [requestRows, operationRows] = await Promise.all([
      fetchValues({
        spreadsheetId: config.spreadsheetId,
        tab: config.requestsTab,
        range: "A1:K998",
        gid: config.requestsGid,
      }),
      fetchValues({
        spreadsheetId: config.spreadsheetId,
        tab: config.operationsTab,
        range: "A1:P987",
        gid: config.operationsGid,
      }),
    ]);

    requests = await syncRequestRows(officeId, requestRows);
    operations = await syncOperationRows(officeId, operationRows);
    anySucceeded = true;
  } catch (e) {
    warnings.push(`Deal sheet: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const source of metaLeadsSources()) {
    try {
      const leadRows = await fetchValues({
        spreadsheetId: source.spreadsheetId,
        tab: source.tab,
        range: "A1:AC998",
        gid: source.gid,
      });
      leadCounts[source.market] = await syncMetaLeadRows(officeId, leadRows, source);
      // An empty read is indistinguishable from a wrong tab/gid (a header-only
      // tab reads "successfully" as zero rows) — say so instead of silence.
      const counts = leadCounts[source.market];
      if (counts.created + counts.updated + counts.skipped === 0) {
        warnings.push(`${source.market} lead sheet: no data rows found — check the tab/gid configuration.`);
      }
      anySucceeded = true;
    } catch (e) {
      warnings.push(`${source.market} lead sheet: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!anySucceeded) {
    return { error: warnings.join(" | ") };
  }

  // First-touch automation for freshly-synced US leads (GOOD tier only) —
  // never allowed to fail the sync itself.
  let autoReplies = { sent: 0, skipped: 0, failed: 0 };
  try {
    const auto = await autoReplyToUsLeads(officeId);
    autoReplies = { sent: auto.sent, skipped: auto.skipped, failed: auto.failed };
    warnings.push(...auto.warnings);
  } catch (e) {
    warnings.push(`Auto-reply: ${e instanceof Error ? e.message : String(e)}`);
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/pricing");
  revalidatePath("/dashboard/settings/email");

  return {
    ok: true,
    spreadsheetId: config.spreadsheetId,
    requests,
    operations,
    leads: leadCounts.TR,
    leadsUs: leadCounts.US,
    autoReplies,
    warnings,
  };
}
