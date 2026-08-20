import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLatestEvent } from "@/lib/agent-events";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const event = await getLatestEvent();
    return NextResponse.json(
      { event },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Failed to load the latest dashboard event.", error);
    return NextResponse.json({ error: "Event lookup failed." }, { status: 500 });
  }
}
