import "server-only";

import { NextResponse } from "next/server";
import {
  getProcurementRequest,
  type ProcurementOrderDetail,
} from "@/lib/procurement-workflow";
import type { SupplierResearchResult } from "@/lib/supply-os/research";
import {
  procurementOfficeCustomerMappings,
  procurementOrderResearchTask,
  procurementOrderWorkspaceId,
  procurementResearchAccessContext,
} from "@/lib/procurement-research-bridge";
import { procurementResearchMode } from "@/lib/procurement-research-mode";
import { projectProcurementResearchShortlist } from "@/lib/procurement-research-shortlist";
import {
  findSucceededSourcingResearchRunByComponentItemKey,
} from "@/lib/supply-os/sourcing-research-persistence";
import { sharedSecretMatches } from "@/lib/procurement-research-security";

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

type ShortlistRouteDependencies = {
  mode: typeof procurementResearchMode;
  mappings: typeof procurementOfficeCustomerMappings;
  getOrder: typeof getProcurementRequest;
  resolveAccess: typeof procurementResearchAccessContext;
  findRun: typeof findSucceededSourcingResearchRunByComponentItemKey;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isSupplierResearchResult(value: unknown): value is SupplierResearchResult {
  const result = record(value);
  if (!Array.isArray(result.candidates) || !Array.isArray(result.sources) || !Array.isArray(result.warnings)) {
    return false;
  }
  if (!result.sources.every((source) => {
    const item = record(source);
    return typeof item.url === "string" && typeof item.sourceType === "string";
  })) {
    return false;
  }
  return result.candidates.every((candidate) => {
    const item = record(candidate);
    return typeof item.companyName === "string"
      && (typeof item.website === "string" || item.website === null)
      && Array.isArray(item.roles)
      && Array.isArray(item.sourceUrls)
      && item.sourceUrls.every((url) => typeof url === "string")
      && ["price", "currency", "minimumOrderQuantity", "leadTimeDays"].every((key) => {
        const envelope = record(item[key]);
        return typeof envelope.state === "string" && Array.isArray(envelope.sources);
      });
  });
}

const defaultDependencies: ShortlistRouteDependencies = {
  mode: procurementResearchMode,
  mappings: procurementOfficeCustomerMappings,
  getOrder: getProcurementRequest,
  resolveAccess: procurementResearchAccessContext,
  findRun: findSucceededSourcingResearchRunByComponentItemKey,
};

export async function procurementResearchShortlistResponse(
  request: Request,
  orderId: string,
  dependencies: ShortlistRouteDependencies = defaultDependencies,
) {
  const sharedSecret = process.env.PROCUREMENT_RESEARCH_SHARED_SECRET?.trim();
  if (!sharedSecret) {
    return NextResponse.json({ error: "Research shared secret is not configured." }, {
      status: 503,
      headers: responseHeaders,
    });
  }
  if (dependencies.mode() === "bourne") {
    return NextResponse.json({ error: "Derya procurement research is disabled." }, {
      status: 503,
      headers: responseHeaders,
    });
  }
  const authorization = request.headers.get("authorization");
  const suppliedSecret = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
  if (!sharedSecretMatches(suppliedSecret, sharedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return NextResponse.json({ error: "Procurement request not found." }, {
      status: 404,
      headers: responseHeaders,
    });
  }
  try {
    let order: ProcurementOrderDetail | null = null;
    let officeId: string | null = null;
    for (const mapping of dependencies.mappings()) {
      const candidate = await dependencies.getOrder(mapping.customerId, orderId);
      if (candidate) {
        order = candidate;
        officeId = mapping.officeId;
        break;
      }
    }
    if (!order || !officeId) {
      return NextResponse.json({ error: "Procurement request not found." }, {
        status: 404,
        headers: responseHeaders,
      });
    }
    const workspaceId = procurementOrderWorkspaceId(order.requestContext);
    if (!workspaceId) {
      return NextResponse.json({ error: "Supplier shortlist not found." }, {
        status: 404,
        headers: responseHeaders,
      });
    }
    const context = await dependencies.resolveAccess(officeId);
    const task = procurementOrderResearchTask(order);
    const run = await dependencies.findRun(context, task.componentItemKey, workspaceId);
    if (!run || !run.output || !task.componentName || !isSupplierResearchResult(run.output)) {
      return NextResponse.json({ error: "Supplier shortlist not found." }, {
        status: 404,
        headers: responseHeaders,
      });
    }
    return NextResponse.json(
      projectProcurementResearchShortlist(task, run.output),
      { status: 200, headers: responseHeaders },
    );
  } catch {
    return NextResponse.json({ error: "Supplier shortlist is unavailable." }, {
      status: 503,
      headers: responseHeaders,
    });
  }
}
