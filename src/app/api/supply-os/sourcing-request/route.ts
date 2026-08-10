import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  analyzeSourcingRequest,
  SourcingIntakeError,
} from "@/lib/supply-os/sourcing-request";
import { ResearchRateLimiter } from "@/lib/supply-os/research";

export const runtime = "nodejs";
export const maxDuration = 60;

const limiter = new ResearchRateLimiter(30, 60 * 60 * 1_000);

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 24_000) {
    return NextResponse.json({ error: "Sourcing request is too large." }, { status: 413 });
  }
  if (!limiter.consume(`${session.officeId}:${session.userId}`)) {
    return NextResponse.json({ error: "Sourcing request rate limit reached." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  try {
    const result = await analyzeSourcingRequest(body);
    return NextResponse.json({ result }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    const known = error instanceof SourcingIntakeError ? error : null;
    const status = known?.code === "invalid_input" ? 400 : 503;
    return NextResponse.json({ error: known?.message ?? "Sourcing request analysis failed." }, { status });
  }
}
