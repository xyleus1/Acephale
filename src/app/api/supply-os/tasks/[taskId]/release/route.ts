import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { releaseSupplyExecutionTask } from "@/lib/supply-os/execution";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { taskId } = await context.params;
  try {
    const task = await releaseSupplyExecutionTask(supplyAccessContext(session), taskId);
    return NextResponse.json({ task });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
