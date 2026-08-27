import { NextResponse } from "next/server";
import { runDueBackgroundJobs } from "@/lib/background-jobs";
import { listAutopilotOrderIds, runProcurementAutopilot } from "@/lib/procurement-autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

// The scheduled pass keeps every live sourcing request moving between operator
// commands. Sending stays off here: the loop drafts, triages and reports, and
// an operator confirms delivery through the admin command.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json({ error: "Cron secret is not configured." }, { status: 503, headers: responseHeaders });
  }
  const authorization = request.headers.get("authorization");
  const suppliedSecret = request.headers.get("x-cron-secret")
    ?? (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
  if (suppliedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  }
  try {
    // A sourcing wave asked for from the context chat runs in slices, so this
    // pass carries it forward instead of leaving it for the hourly job sweep.
    const waves = await runDueBackgroundJobs({ limit: 2, onlyTypes: ["PROCUREMENT_SOURCING_WAVE"] })
      .catch(() => null);
    const orderIds = await listAutopilotOrderIds();
    const runs = [];
    let failed = 0;
    for (const orderId of orderIds) {
      try {
        const run = await runProcurementAutopilot({ orderId, autoSend: false });
        if (run) {
          runs.push({
            orderId: run.orderId,
            material: run.material,
            stage: run.stage,
            quotes: run.quotes,
            drafted: run.drafted,
            escalations: run.escalations.length,
          });
        }
      } catch (error) {
        failed += 1;
        console.error("procurement autopilot request failed", orderId, error);
      }
    }
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      sourcingWaves: waves?.scanned ?? 0,
      requests: runs.length,
      failed,
      runs,
    }, { headers: responseHeaders });
  } catch (error) {
    console.error("procurement autopilot cron failed", error);
    return NextResponse.json({ error: "The sourcing autopilot pass failed." }, { status: 503, headers: responseHeaders });
  }
}
