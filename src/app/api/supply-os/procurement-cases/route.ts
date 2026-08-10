import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import {
  listProcurementCases,
  saveProcurementSelection,
  type ProcurementSelectionInput,
} from "@/lib/supply-os/procurement-case-persistence";

export const runtime = "nodejs";

function text(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function optionalUrl(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function selection(value: unknown): ProcurementSelectionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sourceClass = row.sourceClass;
  const priceType = row.priceType;
  const deliveryType = row.deliveryType;
  const quality = row.quality;
  const sourceUrl = optionalUrl(row.sourceUrl);
  const price = row.price === null ? null : typeof row.price === "number" && Number.isFinite(row.price) && row.price >= 0 ? row.price : undefined;
  const currency = row.currency === null ? null : typeof row.currency === "string" && /^[A-Z]{3}$/.test(row.currency) ? row.currency : undefined;
  const deliveryDate = row.deliveryDate === null ? null : text(row.deliveryDate, 80) ?? undefined;
  const minimumOrderQuantity = row.minimumOrderQuantity === null
    ? null
    : typeof row.minimumOrderQuantity === "number" && Number.isFinite(row.minimumOrderQuantity) && row.minimumOrderQuantity >= 0
      ? row.minimumOrderQuantity
      : undefined;
  const id = text(row.id, 220);
  const name = text(row.name, 220);
  if (!id || !name || sourceUrl === undefined || price === undefined || currency === undefined || deliveryDate === undefined || minimumOrderQuantity === undefined) return null;
  if (!(["Official", "Trusted", "New"] as const).includes(sourceClass as never)) return null;
  if (!(["Modeled", "Sourced", "Unknown"] as const).includes(priceType as never)) return null;
  if (!(["Modeled", "Sourced", "Unknown"] as const).includes(deliveryType as never)) return null;
  if (!(["Strong", "Conditional", "Unverified"] as const).includes(quality as never)) return null;
  return {
    id,
    name,
    sourceClass: sourceClass as ProcurementSelectionInput["sourceClass"],
    sourceUrl,
    price,
    currency,
    minimumOrderQuantity,
    priceType: priceType as ProcurementSelectionInput["priceType"],
    deliveryDate,
    deliveryType: deliveryType as ProcurementSelectionInput["deliveryType"],
    quality: quality as ProcurementSelectionInput["quality"],
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const cases = await listProcurementCases(supplyAccessContext(session));
    return NextResponse.json({ cases }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const researchRunId = text(body?.researchRunId, 220);
  const selected = selection(body?.selection);
  if (!researchRunId || !selected) {
    return NextResponse.json({ error: "A valid research run and supplier option are required." }, { status: 400 });
  }
  try {
    const procurementCase = await saveProcurementSelection({
      context: supplyAccessContext(session),
      researchRunId,
      selection: selected,
    });
    return NextResponse.json({ procurementCase }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
