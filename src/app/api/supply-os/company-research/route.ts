import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  researchCompany,
  SupplyCompanyResearchError,
} from "@/lib/supply-os-company-research";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { query?: unknown } | null;
  if (typeof body?.query !== "string" || body.query.trim().length < 2 || body.query.length > 4_000) {
    return NextResponse.json({ error: "Add a company name, website, or operating description." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      try {
        const research = await researchCompany(body.query as string, (event) => send({ type: "progress", event }));
        send({ type: "progress", event: {
          id: "dashboard",
          label: "Building the customer dashboard",
          detail: "Mapping supply, movement, customs, and delivery workstreams",
          status: "complete",
        } });
        send({ type: "result", research });
      } catch (error) {
        const known = error instanceof SupplyCompanyResearchError ? error : null;
        send({
          type: "error",
          code: known?.code ?? "research_unavailable",
          message: known?.message ?? "Company research could not complete. Add the company website or build from your description.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
