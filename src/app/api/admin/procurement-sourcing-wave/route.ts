import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  parseSourcingCommand,
  planSourcingCommand,
  runSourcingCommand,
  SOURCING_COMMAND_CONFIRMATION,
  SOURCING_COMMAND_MAX_PER_CATEGORY,
} from "@/lib/procurement-sourcing-command";

export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function operatorSecret(req: NextRequest) {
  const headerAuth = req.headers.get("authorization");
  return req.headers.get("x-cron-secret")
    ?? req.nextUrl.searchParams.get("secret")
    ?? (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null);
}

function sameSecret(expected: string, supplied: string) {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right);
}

function authorized(req: NextRequest) {
  const supplied = operatorSecret(req);
  if (!supplied) return false;
  const expected = [process.env.PROCUREMENT_BULK_RFQ_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value.length >= 16));
  return expected.some((value) => sameSecret(value, supplied));
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return unauthorized();
  const customerId = req.nextUrl.searchParams.get("customerId")?.trim() ?? "";
  if (!UUID_PATTERN.test(customerId)) {
    return NextResponse.json({ error: "customerId is required." }, { status: 400 });
  }
  const workspaceId = req.nextUrl.searchParams.get("workspaceId")?.trim() || null;
  const instruction = req.nextUrl.searchParams.get("instruction");
  try {
    return NextResponse.json({
      intent: instruction === null ? null : parseSourcingCommand(instruction),
      confirmation: SOURCING_COMMAND_CONFIRMATION,
      maxPerCategory: SOURCING_COMMAND_MAX_PER_CATEGORY,
      plan: await planSourcingCommand({ customerId, workspaceId }),
    });
  } catch {
    return NextResponse.json({ error: "The sourcing plan could not be built." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return unauthorized();
  const payload = await req.json().catch(() => ({})) as {
    customerId?: unknown;
    workspaceId?: unknown;
    instruction?: unknown;
    perCategory?: unknown;
    send?: unknown;
    confirm?: unknown;
  };
  const customerId = typeof payload.customerId === "string" ? payload.customerId.trim() : "";
  if (!UUID_PATTERN.test(customerId)) {
    return NextResponse.json({ error: "customerId is required." }, { status: 400 });
  }
  const workspaceId = typeof payload.workspaceId === "string" && payload.workspaceId.trim()
    ? payload.workspaceId.trim()
    : null;
  const parsed = parseSourcingCommand(payload.instruction);
  const perCategory = typeof payload.perCategory === "number" && Number.isFinite(payload.perCategory)
    ? Math.min(SOURCING_COMMAND_MAX_PER_CATEGORY, Math.max(1, Math.trunc(payload.perCategory)))
    : parsed?.perCategory;
  if (!perCategory) {
    return NextResponse.json(
      { error: "Say how many suppliers to find per category, for example: find 100 more in each category and send." },
      { status: 400 },
    );
  }
  const send = typeof payload.send === "boolean" ? payload.send : Boolean(parsed?.send);
  const confirmed = payload.confirm === SOURCING_COMMAND_CONFIRMATION;
  if (send && !confirmed) {
    return NextResponse.json({ error: "This send needs an explicit confirmation." }, { status: 400 });
  }
  try {
    return NextResponse.json(await runSourcingCommand({
      customerId,
      workspaceId,
      intent: { perCategory, send, scope: "each-category" },
      confirmed,
    }));
  } catch {
    return NextResponse.json({ error: "The sourcing wave failed." }, { status: 500 });
  }
}
