import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { enqueueBackgroundJob, runDueBackgroundJobs } from "@/lib/background-jobs";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import {
  parseSourcingCommand,
  planSourcingCommand,
  runSourcingCommand,
  SOURCING_COMMAND_CONFIRMATION,
  SOURCING_COMMAND_MAX_PER_CATEGORY,
  SOURCING_COMMAND_SLICE_BUDGET_MS,
} from "@/lib/procurement-sourcing-command";
import { type SupplierSourcingCategoryKey } from "@/lib/supply-os/supplier-sourcing-category";

export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORY_KEYS: readonly SupplierSourcingCategoryKey[] = ["pcba", "molded-foam"];

function categoryScope(value: unknown): SupplierSourcingCategoryKey | null {
  return typeof value === "string" && CATEGORY_KEYS.includes(value as SupplierSourcingCategoryKey)
    ? value as SupplierSourcingCategoryKey
    : null;
}

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
    category?: unknown;
    queue?: unknown;
    drain?: unknown;
  };
  // A full hundred per category outlives any request, so the operator can hand
  // the wave to the queue and then carry its slices forward from here instead of
  // waiting on the fifteen minute schedule.
  if (payload.drain === true) {
    const drained = await runDueBackgroundJobs({ limit: 1, onlyTypes: ["PROCUREMENT_SOURCING_WAVE"] })
      .catch(() => null);
    return NextResponse.json({
      drained: drained ?? { scanned: 0, completed: 0, failed: 0, retried: 0 },
    });
  }
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
  const category = categoryScope(payload.category);
  try {
    if (payload.queue === true) {
      const plan = await planSourcingCommand({ customerId, workspaceId });
      const scoped = category ? plan.filter((entry) => entry.category === category) : plan;
      if (!scoped.length) {
        return NextResponse.json({ error: "No sourcing request matches this scope." }, { status: 400 });
      }
      const order = await loadBulkRfqOrder(scoped[0].orderId);
      if (!order) {
        return NextResponse.json({ error: "No sourcing request matches this scope." }, { status: 400 });
      }
      const job = await enqueueBackgroundJob({
        officeId: order.officeId,
        type: "PROCUREMENT_SOURCING_WAVE",
        payload: {
          customerId,
          workspaceId,
          perCategory,
          category,
          send,
          confirmed,
          instruction: typeof payload.instruction === "string" ? payload.instruction.slice(0, 500) : "",
        },
        dedupeKey: workspaceId
          ? `procurement-sourcing-wave:${workspaceId}${category ? `:${category}` : ""}`
          : null,
        maxAttempts: 1,
      });
      return NextResponse.json({ queued: true, jobId: job.id, perCategory, send, category, plan: scoped });
    }
    return NextResponse.json(await runSourcingCommand({
      customerId,
      workspaceId,
      onlyCategory: category,
      budgetMs: SOURCING_COMMAND_SLICE_BUDGET_MS,
      intent: { perCategory, send, scope: "each-category" },
      confirmed,
    }));
  } catch {
    return NextResponse.json({ error: "The sourcing wave failed." }, { status: 500 });
  }
}
