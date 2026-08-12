import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveSupplyCsvTemplateRoute } from "@/lib/supply-os/csv-route-contract";

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { kind } = await context.params;
  const response = resolveSupplyCsvTemplateRoute(kind);
  if (response.kind === "json") {
    return NextResponse.json(response.body, { status: response.status });
  }
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
