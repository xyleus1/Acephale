import { NextResponse } from "next/server";
import { procurementResearchMode } from "@/lib/procurement-research-mode";
import { runProcurementResearchCronCycle } from "@/lib/procurement-research-cron";
import { sharedSecretMatches } from "@/lib/procurement-research-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  if (!sharedSecretMatches(suppliedSecret, cronSecret)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: responseHeaders },
    );
  }
  if (procurementResearchMode() === "bourne") {
    return NextResponse.json(
      { disabled: true, mode: "bourne" },
      { status: 200, headers: responseHeaders },
    );
  }
  const result = await runProcurementResearchCronCycle();
  const status = result.enqueueError && result.drainError ? 503 : 200;
  return NextResponse.json(
    { ranAt: new Date().toISOString(), mode: "derya", ...result },
    { status, headers: responseHeaders },
  );
}
