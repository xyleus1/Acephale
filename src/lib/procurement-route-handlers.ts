import "server-only";

import { z } from "zod";
import { procurementRequestSchema } from "@/lib/procurement-contract";
import type { procurementVendorConversation } from "@/lib/procurement-conversation";
import {
  ProcurementReplyDraftError,
} from "@/lib/procurement-reply-draft";
import type { draftProcurementSupplierReply } from "@/lib/procurement-reply-draft";
import type { sendProcurementSupplierReply } from "@/lib/procurement-reply-send";
import {
  getProcurementRequest,
  listProcurementRequests,
  ProcurementWorkflowError,
  retryProcurementWorkflowWake,
  resolveProcurementCustomerId,
  submitProcurementRequest,
} from "@/lib/procurement-workflow";
import { contextualizeProcurementRequest } from "@/lib/supply-os/procurement-company-context";
import { SupplyPersistenceError } from "@/lib/supply-os/persistence";

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const MAX_REQUEST_BYTES = 64_000;
const SOURCE_CAMPAIGN_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const SOURCE_WORKSPACE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type ProcurementRouteSession = {
  userId: string;
  officeId: string;
};

export type ProcurementRouteDependencies = {
  session: () => Promise<ProcurementRouteSession | null>;
  resolveCustomerId: typeof resolveProcurementCustomerId;
  submit: typeof submitProcurementRequest;
  list: typeof listProcurementRequests;
  contextualize?: typeof contextualizeProcurementRequest;
};

export type ProcurementDetailDependencies = {
  session: () => Promise<ProcurementRouteSession | null>;
  resolveCustomerId: typeof resolveProcurementCustomerId;
  getRequest: typeof getProcurementRequest;
};

export type ProcurementWakeDependencies = {
  session: () => Promise<ProcurementRouteSession | null>;
  resolveCustomerId: typeof resolveProcurementCustomerId;
  wake: typeof retryProcurementWorkflowWake;
};

export type ProcurementReplyDraftDependencies = {
  session: () => Promise<ProcurementRouteSession | null>;
  resolveCustomerId: typeof resolveProcurementCustomerId;
  getRequest: typeof getProcurementRequest;
  conversation: typeof procurementVendorConversation;
  draft: typeof draftProcurementSupplierReply;
};

type ProcurementReplySendSession = ProcurementRouteSession & {
  role: string;
  canViewWholeOffice: boolean;
};

export type ProcurementReplySendDependencies = {
  session: () => Promise<ProcurementReplySendSession | null>;
  resolveCustomerId: typeof resolveProcurementCustomerId;
  getRequest: typeof getProcurementRequest;
  conversation: typeof procurementVendorConversation;
  send: typeof sendProcurementSupplierReply;
};

const defaultRouteDependencies: ProcurementRouteDependencies = {
  session: async () => (await import("@/lib/auth")).getSession(),
  resolveCustomerId: resolveProcurementCustomerId,
  submit: submitProcurementRequest,
  list: listProcurementRequests,
  contextualize: contextualizeProcurementRequest,
};

const defaultDetailDependencies: ProcurementDetailDependencies = {
  session: async () => (await import("@/lib/auth")).getSession(),
  resolveCustomerId: resolveProcurementCustomerId,
  getRequest: getProcurementRequest,
};

const defaultWakeDependencies: ProcurementWakeDependencies = {
  session: async () => (await import("@/lib/auth")).getSession(),
  resolveCustomerId: resolveProcurementCustomerId,
  wake: retryProcurementWorkflowWake,
};

const defaultReplyDraftDependencies: ProcurementReplyDraftDependencies = {
  session: async () => (await import("@/lib/auth")).getSession(),
  resolveCustomerId: resolveProcurementCustomerId,
  getRequest: getProcurementRequest,
  conversation: async (args) => (await import("@/lib/procurement-conversation")).procurementVendorConversation(args),
  draft: async (args) => (await import("@/lib/procurement-reply-draft")).draftProcurementSupplierReply(args),
};

const defaultReplySendDependencies: ProcurementReplySendDependencies = {
  session: async () => (await import("@/lib/auth")).getSession(),
  resolveCustomerId: resolveProcurementCustomerId,
  getRequest: getProcurementRequest,
  conversation: async (args) => (await import("@/lib/procurement-conversation")).procurementVendorConversation(args),
  send: async (args) => (await import("@/lib/procurement-reply-send")).sendProcurementSupplierReply(args),
};

const procurementReplyDraftRequestSchema = z.object({
  sourceMessageId: z.string().trim().min(1).max(512),
}).strict();

const procurementReplySendRequestSchema = z.object({
  confirmed: z.literal(true),
  sourceMessageId: z.string().trim().min(1).max(512),
  recipient: z.string().trim().email().max(320),
  subject: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(8_000),
}).strict();

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

function replyDraftErrorResponse(error: unknown) {
  if (error instanceof ProcurementReplyDraftError) {
    const status = error.code === "conflict" || error.code === "configuration" ? 409 : 503;
    return Response.json({ error: error.message }, { status, headers: responseHeaders });
  }
  if (error instanceof ProcurementWorkflowError) return errorResponse(error);
  return Response.json({ error: "The supplier reply draft could not be generated." }, { status: 500, headers: responseHeaders });
}

function replySendErrorResponse(error: unknown) {
  if (error instanceof SupplyPersistenceError) {
    const status = error.code === "forbidden"
      ? 403
      : error.code === "not_found"
        ? 404
        : error.code === "conflict"
          ? 409
          : 400;
    return Response.json({ error: error.message }, { status, headers: responseHeaders });
  }
  if (error instanceof ProcurementWorkflowError) return errorResponse(error);
  return Response.json({ error: "The supplier reply could not be sent." }, { status: 500, headers: responseHeaders });
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
    const contextualized = await (dependencies.contextualize ?? contextualizeProcurementRequest)({
      session,
      input: parsed.data,
    });
    const customerId = await dependencies.resolveCustomerId(session);
    const order = await dependencies.submit(customerId, contextualized);
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
  options: {
    sourceCampaign?: string | null;
    sourceWorkspaceId?: string | null;
    sourceCompanyName?: string | null;
    activeOnly?: boolean;
  } = {},
) {
  const session = await dependencies.session();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  const sourceCampaign = options.sourceCampaign?.trim() || undefined;
  if (sourceCampaign && !SOURCE_CAMPAIGN_PATTERN.test(sourceCampaign)) {
    return Response.json({ error: "Invalid procurement source campaign." }, { status: 400, headers: responseHeaders });
  }
  const sourceWorkspaceId = options.sourceWorkspaceId?.trim() || undefined;
  if (sourceWorkspaceId && !SOURCE_WORKSPACE_PATTERN.test(sourceWorkspaceId)) {
    return Response.json({ error: "Invalid procurement source workspace." }, { status: 400, headers: responseHeaders });
  }
  const sourceCompanyName = options.sourceCompanyName?.trim() || undefined;
  if (sourceCompanyName && (sourceCompanyName.length > 200 || /[\u0000-\u001f\u007f]/.test(sourceCompanyName))) {
    return Response.json({ error: "Invalid procurement source company." }, { status: 400, headers: responseHeaders });
  }
  try {
    const customerId = await dependencies.resolveCustomerId(session);
    const requests = await dependencies.list(customerId, 50, sourceCampaign, {
      sourceWorkspaceId,
      sourceCompanyName,
      activeOnly: options.activeOnly === true,
    });
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

export async function handleProcurementWake(
  orderId: string,
  dependencies: ProcurementWakeDependencies = defaultWakeDependencies,
) {
  const session = await dependencies.session();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  try {
    const customerId = await dependencies.resolveCustomerId(session);
    const result = await dependencies.wake(customerId, orderId);
    if (result.claimed && !result.workflowWakeRequested) {
      return Response.json({
        error: "The sourcing workflow did not accept the start request. The saved order is safe. Retry after 30 seconds.",
        workflowWakeRequested: false,
      }, { status: 503, headers: responseHeaders });
    }
    return Response.json({
      workflowWakeRequested: result.workflowWakeRequested,
      message: result.claimed ? "Processing requested" : "Request is already processing or was recently requested",
    }, { status: result.claimed ? 202 : 200, headers: responseHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleProcurementReplyDraft(
  request: Request,
  orderId: string,
  vendorId: string,
  dependencies: ProcurementReplyDraftDependencies = defaultReplyDraftDependencies,
) {
  const session = await dependencies.session();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });

  const requestBody = await readRequestJson(request);
  if (requestBody.tooLarge) {
    return Response.json({ error: "The reply draft request is too large." }, { status: 413, headers: responseHeaders });
  }
  const parsedInput = procurementReplyDraftRequestSchema.safeParse(requestBody.body);
  if (!parsedInput.success) {
    return Response.json({ error: "The displayed supplier message is required." }, { status: 400, headers: responseHeaders });
  }

  try {
    const customerId = await dependencies.resolveCustomerId(session);
    const [order, conversation] = await Promise.all([
      dependencies.getRequest(customerId, orderId),
      dependencies.conversation({
        officeId: session.officeId,
        customerId,
        orderId,
        vendorId,
      }),
    ]);
    const vendor = order?.vendors.find((candidate) => candidate.id === vendorId) ?? null;
    if (!order || !vendor) {
      return Response.json({ error: "Supplier conversation not found." }, { status: 404, headers: responseHeaders });
    }
    const draft = await dependencies.draft({
      order,
      vendor,
      conversation,
      expectedSourceMessageId: parsedInput.data.sourceMessageId,
    });
    return Response.json({ draft }, { headers: responseHeaders });
  } catch (error) {
    return replyDraftErrorResponse(error);
  }
}

export async function handleProcurementReplySend(
  request: Request,
  orderId: string,
  vendorId: string,
  dependencies: ProcurementReplySendDependencies = defaultReplySendDependencies,
) {
  const session = await dependencies.session();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });

  const requestBody = await readRequestJson(request);
  if (requestBody.tooLarge) {
    return Response.json({ error: "The supplier reply is too large." }, { status: 413, headers: responseHeaders });
  }
  const parsedInput = procurementReplySendRequestSchema.safeParse(requestBody.body);
  if (!parsedInput.success) {
    return Response.json({ error: "Confirm the exact recipient, subject, and reply before sending." }, { status: 400, headers: responseHeaders });
  }

  try {
    const customerId = await dependencies.resolveCustomerId(session);
    const [order, conversation] = await Promise.all([
      dependencies.getRequest(customerId, orderId),
      dependencies.conversation({
        officeId: session.officeId,
        customerId,
        orderId,
        vendorId,
      }),
    ]);
    const vendor = order?.vendors.find((candidate) => candidate.id === vendorId) ?? null;
    if (!order || !vendor) {
      return Response.json({ error: "Supplier conversation not found." }, { status: 404, headers: responseHeaders });
    }
    const delivery = await dependencies.send({
      context: {
        officeId: session.officeId,
        userId: session.userId,
        role: session.role,
        canViewWholeOffice: session.canViewWholeOffice,
      },
      customerId,
      order,
      vendor,
      conversation,
      input: {
        sourceMessageId: parsedInput.data.sourceMessageId,
        recipient: parsedInput.data.recipient,
        subject: parsedInput.data.subject,
        body: parsedInput.data.body,
      },
    });
    return Response.json({ delivery }, { headers: responseHeaders });
  } catch (error) {
    return replySendErrorResponse(error);
  }
}
