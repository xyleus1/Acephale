import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  createResearchList,
  extendResearchListFields,
  mergeResearchFields,
  RESEARCH_MAX_ROWS,
  slugify,
  upsertResearchRecords,
  validateResearchFields,
  type ResearchInputRow,
  type ResearchField,
} from "@/lib/research-lists";
import {
  boundedText,
  isOverLength,
  missingDedupeRows,
  readBoundedText,
  resolveDedupeField,
} from "@/lib/ops-input";
import { opsSecretAuthorized } from "@/lib/ops-secret";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type ResearchListBody = {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  fields?: unknown;
};

type ResearchImportBody = {
  officeName?: unknown;
  list?: unknown;
  rows?: unknown;
  dedupeField?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPrismaError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    || (error instanceof Error && error.constructor.name.startsWith("PrismaClient"));
}

export async function POST(request: NextRequest) {
  if (!opsSecretAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > 4_000_000) {
    return NextResponse.json({ error: "Import payload is too large." }, { status: 413 });
  }

  const text = await readBoundedText(request, 4_000_000);
  if (text === null) {
    return NextResponse.json({ error: "Import payload is too large." }, { status: 413 });
  }

  let body: ResearchImportBody | null;
  try {
    body = JSON.parse(text) as ResearchImportBody;
  } catch {
    body = null;
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Import payload is required." }, { status: 400 });
  }

  if (isOverLength(body.officeName, 80)) {
    return NextResponse.json({ error: "Office name must be at most 80 characters." }, { status: 400 });
  }
  const officeName = boundedText(body.officeName, 80);
  if (!officeName) {
    return NextResponse.json({ error: "Office name is required." }, { status: 400 });
  }

  if (!isRecord(body.list)) {
    return NextResponse.json({ error: "List definition is required." }, { status: 400 });
  }
  const listBody = body.list as ResearchListBody;
  if (typeof listBody.slug !== "string" || typeof listBody.name !== "string" || !Array.isArray(listBody.fields)) {
    return NextResponse.json({ error: "List slug, name, and fields are required." }, { status: 400 });
  }
  if (isOverLength(listBody.slug, 80)) {
    return NextResponse.json({ error: "List slug must be at most 80 characters." }, { status: 400 });
  }
  if (isOverLength(listBody.name, 160)) {
    return NextResponse.json({ error: "List name must be at most 160 characters." }, { status: 400 });
  }
  if (listBody.description !== undefined && typeof listBody.description === "string" && isOverLength(listBody.description, 1000)) {
    return NextResponse.json({ error: "List description must be at most 1000 characters." }, { status: 400 });
  }
  const slug = slugify(listBody.slug);
  if (!slug) {
    return NextResponse.json({ error: "List slug is invalid." }, { status: 400 });
  }
  const listName = listBody.name.trim();
  if (!listName) {
    return NextResponse.json({ error: "List name is required." }, { status: 400 });
  }
  if (listBody.description !== undefined && typeof listBody.description !== "string") {
    return NextResponse.json({ error: "List description must be text." }, { status: 400 });
  }
  const description = boundedText(listBody.description, 1000);
  let fields: ResearchField[];
  try {
    fields = validateResearchFields(listBody.fields);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "List fields are invalid.",
    }, { status: 400 });
  }

  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ error: "Rows are required." }, { status: 400 });
  }
  if (body.rows.length > RESEARCH_MAX_ROWS) {
    return NextResponse.json({ error: `At most ${RESEARCH_MAX_ROWS} rows can be imported at once.` }, { status: 400 });
  }
  if (isOverLength(body.dedupeField, 80)) {
    return NextResponse.json({ error: "Dedupe field must be at most 80 characters." }, { status: 400 });
  }
  const dedupeField = boundedText(body.dedupeField, 80);
  if (!dedupeField) {
    return NextResponse.json({
      error: "Dedupe field is required so imports can be retried safely.",
    }, { status: 400 });
  }

  try {
    const office = await prisma.office.findUnique({
      where: { name: officeName },
      select: { id: true, name: true },
    });
    if (!office) {
      return NextResponse.json({ error: "Office not found." }, { status: 404 });
    }

    let existingList = await prisma.researchList.findUnique({
      where: { officeId_slug: { officeId: office.id, slug } },
      select: { id: true, slug: true, fields: true },
    });
    if (!existingList) {
      resolveDedupeField(fields, dedupeField);
      const missingRows = missingDedupeRows(body.rows, dedupeField);
      if (missingRows.length > 0) {
        return NextResponse.json({
          error: "Every row needs a value for the dedupe field so imports can be retried safely.",
          rows: missingRows,
        }, { status: 400 });
      }
      try {
        await createResearchList(office.id, {
          name: listName,
          slug,
          description,
          fields,
        });
      } catch (error) {
        const racedList = await prisma.researchList.findUnique({
          where: { officeId_slug: { officeId: office.id, slug } },
          select: { id: true, slug: true, fields: true },
        });
        if (!racedList) throw error;
        existingList = racedList;
      }
    }
    let storedFields: ResearchField[];
    let addedFields: string[] = [];
    if (existingList) {
      const merged = mergeResearchFields(existingList.fields, fields);
      resolveDedupeField(merged.fields, dedupeField);
      const missingRows = missingDedupeRows(body.rows, dedupeField);
      if (missingRows.length > 0) {
        return NextResponse.json({
          error: "Every row needs a value for the dedupe field so imports can be retried safely.",
          rows: missingRows,
        }, { status: 400 });
      }
      const extended = await extendResearchListFields(office.id, existingList.id, fields);
      storedFields = extended.fields;
      addedFields = extended.addedFields;
    } else {
      storedFields = fields;
      resolveDedupeField(storedFields, dedupeField);
      const missingRows = missingDedupeRows(body.rows, dedupeField);
      if (missingRows.length > 0) {
        return NextResponse.json({
          error: "Every row needs a value for the dedupe field so imports can be retried safely.",
          rows: missingRows,
        }, { status: 400 });
      }
    }

    const result = await upsertResearchRecords(
      office.id,
      slug,
      body.rows as ResearchInputRow[],
      { dedupeField },
    );
    return NextResponse.json({
      office: { id: office.id, name: office.name },
      list: { slug },
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.slice(0, 50),
      addedFields,
    });
  } catch (error) {
    if (isPrismaError(error)) {
      console.error("Research import database error:", error);
      return NextResponse.json({ error: "Research import could not be processed." }, { status: 500 });
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Research import could not be processed.",
    }, { status: 400 });
  }
}
