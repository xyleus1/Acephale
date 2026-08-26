import { NextRequest, NextResponse } from "next/server";
import { operatorSecretAuthorized } from "@/lib/admin-operator-secret";
import { procurementOrderIdError } from "@/lib/procurement-order-id";
import {
  linkProcurementRequestDocuments,
  previewProcurementRequestDocumentLink,
} from "@/lib/procurement-request-document-link";
import { SupplyPersistenceError } from "@/lib/supply-os/persistence";

export const maxDuration = 120;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function failure(error: unknown, message: string) {
  if (error instanceof SupplyPersistenceError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  console.error(message, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) return unauthorized();
  const orderId = req.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  const invalid = procurementOrderIdError(orderId);
  if (invalid) return badRequest(invalid);
  try {
    const preview = await previewProcurementRequestDocumentLink(orderId);
    if (!preview) return notFound();
    return NextResponse.json(preview);
  } catch (error) {
    return failure(error, "The request file preview failed.");
  }
}

export async function POST(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) return unauthorized();
  const payload = await req.json().catch(() => ({})) as { orderId?: unknown };
  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  const invalid = procurementOrderIdError(orderId);
  if (invalid) return badRequest(invalid);
  try {
    const result = await linkProcurementRequestDocuments(orderId);
    if (!result) return notFound();
    return NextResponse.json(result);
  } catch (error) {
    return failure(error, "The request file link failed.");
  }
}
