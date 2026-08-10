import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  AutomationChatError,
  draftAutomationWithGpt,
} from "@/lib/supply-os/automation-chat";
import { ResearchRateLimiter } from "@/lib/supply-os/research";

export const runtime = "nodejs";
export const maxDuration = 60;

const limiter = new ResearchRateLimiter(30, 60 * 60 * 1_000);

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 20_000) {
    return NextResponse.json({ error: "Automation instruction is too large." }, { status: 413 });
  }
  if (!limiter.consume(`${session.officeId}:${session.userId}`)) {
    return NextResponse.json({ error: "Workflow drafting rate limit reached." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  try {
    const result = await draftAutomationWithGpt(body);
    return NextResponse.json({ result }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    const known = error instanceof AutomationChatError ? error : null;
    const status = known?.code === "invalid_input" ? 400 : 503;
    return NextResponse.json({ error: known?.message ?? "Workflow drafting failed." }, { status });
  }
}
