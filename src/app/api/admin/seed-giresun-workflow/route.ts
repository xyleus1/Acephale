import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { runGiresunWorkflowSeed } from "../../../../../scripts/seed-giresun-workflow-load";

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    return NextResponse.json({ ok: false, error: "Only ADMIN users can seed the workflow load." }, { status: 403 });
  }

  const reset = req.nextUrl.searchParams.get("reset") === "1";
  const result = await runGiresunWorkflowSeed({
    apply: true,
    reset,
    createSeedInbox: true,
    officeId: session.officeId,
  });

  return NextResponse.json(result);
}
