import { NextRequest, NextResponse } from "next/server";
import { executeDemoEmailTrigger } from "@/lib/demo-email-trigger";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { jobId?: unknown; token?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
  const token = typeof body?.token === "string" ? body.token : "";
  const response = await executeDemoEmailTrigger({ jobId, token });
  return NextResponse.json(response.body, { status: response.status });
}
