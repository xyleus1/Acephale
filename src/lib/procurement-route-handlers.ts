import "server-only";

import { procurementRequestSchema } from "@/lib/procurement-contract";
import {
  getProcurementRequest,
  listProcurementRequests,
  ProcurementWorkflowError,
  resolveProcurementCustomerId,
  submitProcurementRequest,
} from "@/lib/procurement-workflow";

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const MAX_REQUEST_BYTES = 64_000;

type ProcurementRouteSession = {
  userId: string;
  officeId: string;
};

export type ProcurementRouteDependencies = {
  session: () => Promise<ProcurementRouteSession | null>;
  resolveCustomerId: typeof resolveProcurementCustomerId;
  submit: typeof submitProcurementRequest;
  list: typeof listProcurementRequests;
};

export type ProcurementDetailDependencies = {
  session: () => Promise<ProcurementRouteSession | null>;
  resolveCustomerId: typeof resolveProcurementCustomerId;
  getRequest: typeof getProcurementRequest;
};

const defaultRouteDependencies: ProcurementRouteDependencies = {
  session: async () => (await import("@/lib/auth")).getSession(),
  resolveCustomerId: resolveProcurementCustomerId,
  submit: submitProcurementRequest,
  list: listProcurementRequests,
};

const defaultDetailDependencies: ProcurementDetailDependencies = {
  session: async () => (await import("@/lib/auth")).getSession(),
  resolveCustomerId: resolveProcurementCustomerId,
  getRequest: getProcurementRequest,
};

function errorResponse(error: unknown) {
  if (!(error instanceof ProcurementWorkflowError)) {
    return Response.json({ error: "Procurement request failed." }, { status: 500, headers: responseHeaders });
  }
  const status = error.code === "forbidden"
    ? 403
    : error.code === "not_found"
      ? 404
      : error.code === "conflict" || error.code === "configuration"
        ? 409
        : 503;
  return Response.json({ error: error.message }, { status, headers: responseHeaders });
}

async function readRequestJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return { tooLarge: true, body: null };
  }

  if (!request.body) return { tooLarge: false, body: null };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return { tooLarge: true, body: null };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { tooLarge: false, body: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { tooLarge: false, body: null };
  }
}

export async function handleProcurementPost(
  request: Request,
  dependencies: ProcurementRouteDependencies = defaultRouteDependencies,
) {
  const session = await dependencies.session();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });

  const requestBody = await readRequestJson(request);
  if (requestBody.tooLarge) {
    return Response.json({ error: "Procurement request is too large." }, { status: 413, headers: responseHeaders });
  }

  const parsed = procurementRequestSchema.safeParse(requestBody.body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Procurement request JSON is invalid." },
      { status: 400, headers: responseHeaders },
    );
  }

  try {
    const customerId = await dependencies.resolveCustomerId(session);
    const order = await dependencies.submit(customerId, parsed.data);
    return Response.json({
      orderId: order.orderId,
      status: order.status,
      workflowWakeRequested: order.workflowWakeRequested,
      message: order.created ? "Request accepted" : "Existing request returned",
    }, { status: order.created ? 201 : 200, headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleProcurementList(
  dependencies: ProcurementRouteDependencies = defaultRouteDependencies,
) {
  const session = await dependencies.session();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  try {
    const customerId = await dependencies.resolveCustomerId(session);
    const requests = await dependencies.list(customerId);
    return Response.json({ requests }, { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleProcurementDetail(
  orderId: string,
  dependencies: ProcurementDetailDependencies = defaultDetailDependencies,
) {
  const session = await dependencies.session();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });

  try {
    const customerId = await dependencies.resolveCustomerId(session);
    const order = await dependencies.getRequest(customerId, orderId);
    if (!order) {
      return Response.json({ error: "Procurement request not found." }, { status: 404, headers: responseHeaders });
    }
    return Response.json(order, { headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
