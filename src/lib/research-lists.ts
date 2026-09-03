import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { safeHttpUrl } from "@/lib/leads-directory";
import { normalizeDedupeValue } from "@/lib/research-dedupe";
export { normalizeDedupeValue } from "@/lib/research-dedupe";

export const RESEARCH_PAGE_SIZE = 50;
export const RESEARCH_MAX_FIELDS = 40;
export const RESEARCH_MAX_LISTS = 50;
export const RESEARCH_MAX_ROWS = 2000;
export const RESEARCH_MAX_CELL_LENGTH = 2000;
export const RESEARCH_MAX_SEARCH_TEXT_LENGTH = 4000;
export const RESEARCH_MAX_EXPORT_ROWS = 10000;

export const RESEARCH_FIELD_TYPES = ["text", "url", "email", "number", "date"] as const;
export type ResearchFieldType = (typeof RESEARCH_FIELD_TYPES)[number];
export const RESEARCH_STATUSES = ["new", "reviewed", "rejected"] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export type ResearchField = {
  key: string;
  label: string;
  type: ResearchFieldType;
};

export type ResearchRecordData = Record<string, string | number | null>;
export type ResearchInputRow = Record<string, unknown>;
export type ParsedResearchRow = {
  row: ResearchInputRow;
  sourceRow: number;
};

export type ResearchListSummary = {
  id: string;
  officeId: string;
  projectId: string | null;
  slug: string;
  name: string;
  description: string | null;
  fields: ResearchField[];
  recordCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ResearchRecordRow = {
  id: string;
  dedupeKey: string | null;
  status: ResearchStatus;
  data: ResearchRecordData;
  sourceRefs: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

export function validateResearchStatus(value: unknown): ResearchStatus {
  if (typeof value === "string" && RESEARCH_STATUSES.includes(value as ResearchStatus)) {
    return value as ResearchStatus;
  }
  throw new Error("Status must be new, reviewed, or rejected.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isParsedResearchRow(value: ResearchInputRow | ParsedResearchRow): value is ParsedResearchRow {
  return isRecord(value.row) && typeof value.sourceRow === "number";
}

function cleanText(value: unknown, maxLength = RESEARCH_MAX_CELL_LENGTH): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function validateResearchFields(fields: unknown): ResearchField[] {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("At least one field is required.");
  }
  if (fields.length > RESEARCH_MAX_FIELDS) {
    throw new Error(`A list can have at most ${RESEARCH_MAX_FIELDS} fields.`);
  }

  const keys = new Set<string>();
  return fields.map((input, index) => {
    if (!isRecord(input)) throw new Error(`Field ${index + 1} is invalid.`);
    const key = cleanText(input.key, 80);
    const label = cleanText(input.label, 120);
    const type = cleanText(input.type || "text", 20).toLowerCase() as ResearchFieldType;
    if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(key)) {
      throw new Error(`Field ${index + 1} has an invalid key.`);
    }
    if (!label) throw new Error(`Field ${index + 1} needs a label.`);
    if (!RESEARCH_FIELD_TYPES.includes(type)) {
      throw new Error(`Field ${index + 1} has an invalid type.`);
    }
    if (keys.has(key)) throw new Error(`Duplicate field key: ${key}.`);
    keys.add(key);
    return { key, label, type };
  });
}

function fieldsFromJson(value: Prisma.JsonValue): ResearchField[] {
  return validateResearchFields(value);
}

export async function createResearchList(
  officeId: string,
  input: { name: string; slug?: string; description?: string; fields: unknown; projectId?: string | null },
): Promise<ResearchListSummary> {
  const name = cleanText(input.name, 160);
  if (!name) throw new Error("List name is required.");
  const fields = validateResearchFields(input.fields);
  const slug = slugify(input.slug || name);
  if (!slug) throw new Error("List slug is invalid.");
  if (input.projectId) {
    const project = await defaultPrisma.researchProject.findFirst({
      where: { id: input.projectId, officeId },
      select: { id: true },
    });
    if (!project) throw new Error("Research project is invalid.");
  }

  const [count, duplicate] = await Promise.all([
    defaultPrisma.researchList.count({ where: { officeId } }),
    defaultPrisma.researchList.findUnique({ where: { officeId_slug: { officeId, slug } } }),
  ]);
  if (count >= RESEARCH_MAX_LISTS) throw new Error(`An office can have at most ${RESEARCH_MAX_LISTS} lists.`);
  if (duplicate) throw new Error("A list with this slug already exists.");

  const list = await defaultPrisma.researchList.create({
    data: {
      officeId,
      slug,
      name,
      description: cleanText(input.description, 1000) || null,
      fields: fields as unknown as Prisma.InputJsonValue,
      projectId: input.projectId || null,
    },
    select: { id: true, officeId: true, projectId: true, slug: true, name: true, description: true, fields: true, createdAt: true, updatedAt: true, _count: { select: { records: true } } },
  });
  return { ...list, fields: fieldsFromJson(list.fields), recordCount: list._count.records };
}

export async function listResearchLists(officeId: string): Promise<ResearchListSummary[]> {
  const lists = await defaultPrisma.researchList.findMany({
    where: { officeId },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    select: { id: true, officeId: true, projectId: true, slug: true, name: true, description: true, fields: true, createdAt: true, updatedAt: true, _count: { select: { records: true } } },
  });
  return lists.map((list) => ({ ...list, fields: fieldsFromJson(list.fields), recordCount: list._count.records }));
}

async function loadList(officeId: string, slug: string, client: PrismaClient = defaultPrisma) {
  const list = await client.researchList.findUnique({
    where: { officeId_slug: { officeId, slug } },
    select: { id: true, officeId: true, projectId: true, slug: true, name: true, description: true, fields: true, createdAt: true, updatedAt: true },
  });
  if (!list) throw new Error("Research list not found.");
  return { ...list, fields: fieldsFromJson(list.fields) };
}

export async function assignResearchListProject(
  officeId: string,
  listId: string,
  projectId: string | null,
): Promise<ResearchListSummary> {
  const list = await defaultPrisma.researchList.findFirst({
    where: { id: listId, officeId },
    select: { id: true },
  });
  if (!list) throw new Error("Research list not found.");
  if (projectId) {
    const project = await defaultPrisma.researchProject.findFirst({
      where: { id: projectId, officeId },
      select: { id: true },
    });
    if (!project) throw new Error("Research project is invalid.");
  }
  const updated = await defaultPrisma.researchList.update({
    where: { id: listId },
    data: { projectId },
    select: { id: true, officeId: true, projectId: true, slug: true, name: true, description: true, fields: true, createdAt: true, updatedAt: true, _count: { select: { records: true } } },
  });
  return { ...updated, fields: fieldsFromJson(updated.fields), recordCount: updated._count.records };
}

function asData(value: Prisma.JsonValue): ResearchRecordData {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) =>
      item === null || typeof item === "string" || typeof item === "number",
    ),
  ) as ResearchRecordData;
}

export function buildResearchSearchText(data: ResearchRecordData): string {
  return Object.values(data)
    .filter((value): value is string | number => value !== null)
    .map(String)
    .join(" ")
    .toLowerCase()
    .slice(0, RESEARCH_MAX_SEARCH_TEXT_LENGTH);
}

export function hasResearchValues(data: ResearchRecordData): boolean {
  return Object.values(data).some((value) => value !== null);
}

export function validateResearchRowValues(data: ResearchRecordData): void {
  if (!hasResearchValues(data)) {
    throw new Error("Row has no values for any list column.");
  }
}

export async function loadResearchList(
  officeId: string,
  slug: string,
  filters: { query?: string; status?: string; page?: number } = {},
  options: { client?: PrismaClient } = {},
) {
  const client = options.client ?? defaultPrisma;
  const list = await loadList(officeId, slug, client);
  const query = filters.query?.trim().toLowerCase();
  const status = filters.status?.trim();
  if (status && status !== "all") validateResearchStatus(status);
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const where: Prisma.ResearchRecordWhereInput = {
    officeId,
    listId: list.id,
    ...(query ? { searchText: { contains: query } } : {}),
    ...(status && status !== "all" ? { status } : {}),
  };
  const [total, records] = await client.$transaction([
    client.researchRecord.count({ where }),
    client.researchRecord.findMany({
      where,
      skip: (page - 1) * RESEARCH_PAGE_SIZE,
      take: RESEARCH_PAGE_SIZE,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, dedupeKey: true, status: true, data: true, sourceRefs: true, createdAt: true, updatedAt: true },
    }),
  ]);
  const rows = records.map((record) => ({
    ...record,
    status: validateResearchStatus(record.status),
    data: asData(record.data),
  }));
  return { ...list, rows, total, page, pageCount: Math.max(1, Math.ceil(total / RESEARCH_PAGE_SIZE)) };
}

export function coerceResearchValue(value: unknown, field: ResearchField): string | number | null {
  if (typeof value === "string" && value.length > RESEARCH_MAX_CELL_LENGTH) {
    throw new Error(`must be at most ${RESEARCH_MAX_CELL_LENGTH} characters`);
  }
  const text = cleanText(value);
  if (!text) return null;
  if (field.type === "text") return text;
  if (field.type === "url") {
    const safe = safeHttpUrl(text);
    if (!safe) throw new Error("must be an http or https URL");
    return safe;
  }
  if (field.type === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new Error("must be a valid email");
    return text.toLowerCase();
  }
  if (field.type === "number") {
    const number = typeof value === "number" ? value : Number(text);
    if (!Number.isFinite(number)) throw new Error("must be a number");
    return number;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new Error("must be a valid date");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function normalizeRow(row: ResearchInputRow, fields: ResearchField[]) {
  const data: ResearchRecordData = {};
  for (const field of fields) {
    data[field.key] = coerceResearchValue(row[field.key], field);
  }
  return data;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function upsertResearchRecords(
  officeId: string,
  slug: string,
  rows: Array<ResearchInputRow | ParsedResearchRow>,
  options: { dedupeField?: string; resetStatus?: boolean; client?: PrismaClient } = {},
) {
  if (!Array.isArray(rows) || rows.length > RESEARCH_MAX_ROWS) {
    throw new Error(`At most ${RESEARCH_MAX_ROWS} rows can be imported at once.`);
  }
  const client = options.client ?? defaultPrisma;
  const list = await loadList(officeId, slug, client);
  const fieldKeys = new Set(list.fields.map((field) => field.key));
  if (options.dedupeField && !fieldKeys.has(options.dedupeField)) {
    throw new Error("Dedupe field is not in the list definition.");
  }
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ row: number; error: string }> = [];
  const prepared: Array<{
    row: number;
    data: ResearchRecordData;
    dedupeKey: string | null;
    searchText: string;
  }> = [];

  for (const [index, input] of rows.entries()) {
    const row = isParsedResearchRow(input)
      ? input.row
      : input;
    const sourceRow = isParsedResearchRow(input) ? input.sourceRow : index + 1;
    if (!isRecord(row)) {
      skipped += 1;
      errors.push({ row: sourceRow, error: "Row must be an object." });
      continue;
    }
    try {
      const data = normalizeRow(row, list.fields);
      validateResearchRowValues(data);
      prepared.push({
        row: sourceRow,
        data,
        dedupeKey: options.dedupeField ? normalizeDedupeValue(data[options.dedupeField]) : null,
        searchText: buildResearchSearchText(data),
      });
    } catch (error) {
      skipped += 1;
      errors.push({ row: sourceRow, error: error instanceof Error ? error.message : "Row is invalid." });
    }
  }

  const deduped = prepared.filter((item) => item.dedupeKey);
  const withoutDedupe = prepared.filter((item) => !item.dedupeKey);
  const existingKeys = new Set<string>();
  if (deduped.length) {
    const existing = await client.researchRecord.findMany({
      where: { listId: list.id, dedupeKey: { in: deduped.map((item) => item.dedupeKey as string) } },
      select: { dedupeKey: true },
    });
    for (const item of existing) {
      if (item.dedupeKey) existingKeys.add(item.dedupeKey);
    }
  }

  for (const batch of chunks(deduped, 100)) {
    const operations = batch.map((item) => {
      const wasExisting = existingKeys.has(item.dedupeKey as string);
      existingKeys.add(item.dedupeKey as string);
      return {
        item,
        wasExisting,
        operation: client.researchRecord.upsert({
          where: { listId_dedupeKey: { listId: list.id, dedupeKey: item.dedupeKey as string } },
          create: {
            officeId,
            listId: list.id,
            dedupeKey: item.dedupeKey,
            status: "new",
            data: item.data as Prisma.InputJsonValue,
            searchText: item.searchText,
          },
          update: {
            ...(options.resetStatus ? { status: "new" } : {}),
            data: item.data as Prisma.InputJsonValue,
            searchText: item.searchText,
          },
        }),
      };
    });
    const results = await Promise.allSettled(operations.map((item) => item.operation));
    results.forEach((result, index) => {
      const item = operations[index]!;
      if (result.status === "fulfilled") {
        if (item.wasExisting) updated += 1;
        else created += 1;
      } else {
        skipped += 1;
        errors.push({
          row: item.item.row,
          error: result.reason instanceof Error ? result.reason.message : "Row could not be saved.",
        });
      }
    });
  }

  for (const batch of chunks(withoutDedupe, 100)) {
    const data = batch.map((item) => ({
      officeId,
      listId: list.id,
      dedupeKey: null,
      status: "new",
      data: item.data as Prisma.InputJsonValue,
      searchText: item.searchText,
    }));
    try {
      const result = await client.researchRecord.createMany({ data });
      created += result.count;
    } catch {
      const results = await Promise.allSettled(batch.map((item) => client.researchRecord.create({
        data: {
          officeId,
          listId: list.id,
          dedupeKey: null,
          status: "new",
          data: item.data as Prisma.InputJsonValue,
          searchText: item.searchText,
        },
      })));
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          created += 1;
        } else {
          skipped += 1;
          errors.push({
            row: batch[index]!.row,
            error: result.reason instanceof Error ? result.reason.message : "Row could not be saved.",
          });
        }
      });
    }
  }

  return { created, updated, skipped, errors: errors.slice(0, 50), errorRows: errors };
}

function parseCsv(text: string): Array<{ values: string[]; sourceRow: number }> {
  const rows: Array<{ values: string[]; sourceRow: number }> = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowStartLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim())) rows.push({ values: row, sourceRow: rowStartLine });
      row = [];
      cell = "";
      line += 1;
      rowStartLine = line;
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((item) => item.trim())) rows.push({ values: row, sourceRow: rowStartLine });
  }
  return rows;
}

function filterJsonRows(values: unknown[], sourceRows: number[], fields: ResearchField[]) {
  const allowed = new Set(fields.map((field) => field.key));
  return {
    rows: values
      .map((value, index) => ({
        row: isRecord(value)
          ? Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)))
          : {},
        sourceRow: sourceRows[index]!,
      }))
      .filter((value) => Object.keys(value.row).length > 0),
    errors: values.flatMap((value, index) =>
      isRecord(value) ? [] : [{ row: sourceRows[index]!, error: "JSON row must be an object." }],
    ),
  };
}

export function parseDelimitedRecords(text: string, fields: ResearchField[]) {
  const input = text.trim();
  if (!input) {
    return {
      rows: [] as ParsedResearchRow[],
      errors: [] as Array<{ row: number; error: string }>,
    };
  }

  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) return filterJsonRows(parsed, parsed.map((_, index) => index + 1), fields);
    if (isRecord(parsed)) return filterJsonRows([parsed], [1], fields);
    return { rows: [], errors: [{ row: 1, error: "Invalid JSON or JSONL." }] };
  } catch {
    if (input.startsWith("[") || input.startsWith("{")) {
      const values: unknown[] = [];
      const sourceRows: number[] = [];
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        try {
          values.push(JSON.parse(line));
          sourceRows.push(index + 1);
        } catch {
          return { rows: [], errors: [{ row: index + 1, error: "Invalid JSON or JSONL." }] };
        }
      }
      return filterJsonRows(values, sourceRows, fields);
    }
  }

  const parsed = parseCsv(text);
  if (!parsed.length) return { rows: [], errors: [] };
  const allowed = new Set(fields.map((field) => field.key));
  const headers = parsed[0]!.values.map((header) => header.trim().toLowerCase());
  const rows: ParsedResearchRow[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  parsed.slice(1).forEach(({ values, sourceRow }) => {
    if (values.length > headers.length) {
      errors.push({ row: sourceRow, error: "Too many columns." });
      return;
    }
    const row: ResearchInputRow = {};
    headers.forEach((header, column) => {
      if (allowed.has(header)) row[header] = values[column] ?? "";
    });
    rows.push({ row, sourceRow });
  });
  return { rows, errors };
}

export async function exportResearchRecords(
  officeId: string,
  slug: string,
  filters: { query?: string; status?: string } = {},
) {
  const list = await loadList(officeId, slug);
  const result = await loadAllMatchingRecords(officeId, list.id, filters);
  const records = result.rows.map((record) => ({ ...record, data: asData(record.data) }));
  return { ...list, rows: records, truncated: result.total > RESEARCH_MAX_EXPORT_ROWS };
}

async function loadAllMatchingRecords(officeId: string, listId: string, filters: { query?: string; status?: string }) {
  const query = filters.query?.trim().toLowerCase();
  const status = filters.status?.trim();
  if (status && status !== "all") validateResearchStatus(status);
  const where: Prisma.ResearchRecordWhereInput = {
    officeId,
    listId,
    ...(query ? { searchText: { contains: query } } : {}),
    ...(status && status !== "all" ? { status } : {}),
  };
  const [total, records] = await defaultPrisma.$transaction([
    defaultPrisma.researchRecord.count({ where }),
    defaultPrisma.researchRecord.findMany({
      where,
      take: RESEARCH_MAX_EXPORT_ROWS,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, dedupeKey: true, status: true, data: true, sourceRefs: true, createdAt: true, updatedAt: true },
    }),
  ]);
  return { rows: records, total };
}
