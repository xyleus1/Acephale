import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    error: "Legacy supplier research campaigns are disabled. Create procurement requests instead.",
  }, { status: 410, headers: RESPONSE_HEADERS });
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    error: "Legacy supplier research campaigns are disabled. Create procurement requests instead.",
  }, { status: 410, headers: RESPONSE_HEADERS });
}
