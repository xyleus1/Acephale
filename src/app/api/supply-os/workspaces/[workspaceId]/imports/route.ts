import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  executeSupplyCsvImportRoute,
  type SupplyCsvImportRouteResponse,
} from "@/lib/supply-os/csv-route-contract";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { stageSupplyCsvImport } from "@/lib/supply-os/persistence";

export const runtime = "nodejs";
export const maxDuration = 60;

function routeResponse(response: SupplyCsvImportRouteResponse) {
  return NextResponse.json(response.body, { status: response.status });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  const accessContext = supplyAccessContext(session);
  const response = await executeSupplyCsvImportRoute({
    contentLength: request.headers.get("content-length"),
    context: accessContext,
    workspaceId,
    dependencies: {
      readBody: () => request.json(),
      stage: stageSupplyCsvImport,
      persistenceFailure: async (error) => {
        const errorResponse = supplyErrorResponse(error);
        return {
          status: errorResponse.status,
          body: await errorResponse.json() as Record<string, unknown>,
        };
      },
    },
  });
  return routeResponse(response);
}
