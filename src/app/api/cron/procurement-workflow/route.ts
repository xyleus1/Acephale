import { NextResponse } from "next/server";
import { reconcileProcurementWorkflowWakes } from "@/lib/procurement-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Cron secret is not configured." },
      { status: 503, headers: responseHeaders },
    );
  }
  const authorization = request.headers.get("authorization");
  const suppliedSecret = request.headers.get("x-cron-secret")
    ?? (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
  if (suppliedSecret !== cronSecret) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: responseHeaders },
    );
  }

  try {
    const result = await reconcileProcurementWorkflowWakes();
    const status = result.failed > 0 ? 503 : 200;
    if (result.failed > 0) {
      console.warn("Procurement wake reconciliation completed with failed deliveries.", result);
    }
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      ...result,
      healthy: result.failed === 0,
    }, { status, headers: responseHeaders });
  } catch {
    console.warn("Procurement wake reconciliation could not inspect durable orders.");
    return NextResponse.json(
      { error: "Procurement wake reconciliation failed." },
      { status: 503, headers: responseHeaders },
    );
  }
}
