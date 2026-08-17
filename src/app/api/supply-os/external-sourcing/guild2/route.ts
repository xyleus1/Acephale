import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  loadGuild2WorkflowState,
  startGuild2Workflow,
} from "@/lib/supply-os/external-sourcing-workflow";

export const runtime = "nodejs";
export const maxDuration = 30;

const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (!body || !["ensure", "run"].includes(String(body.action))) {
    return NextResponse.json({ error: "A valid workflow action is required." }, { status: 400, headers: HEADERS });
  }
  try {
    if (body.action === "ensure") {
      return NextResponse.json(await loadGuild2WorkflowState(session.officeId), { headers: HEADERS });
    }
    return NextResponse.json(
      await startGuild2Workflow({ officeId: session.officeId, userId: session.userId }),
      { status: 202, headers: HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The workflow could not be started.";
    const configurationError = message.includes("not configured");
    return NextResponse.json({ error: message }, { status: configurationError ? 503 : 502, headers: HEADERS });
  }
}
