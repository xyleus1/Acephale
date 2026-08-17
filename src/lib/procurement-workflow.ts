import "server-only";

import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { ProcurementRequestInput } from "@/lib/procurement-contract";

const uuidSchema = z.string().uuid();
const SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

type RawDatabase = {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type ProcurementDatabase = RawDatabase & {
  $transaction<T>(operation: (transaction: RawDatabase) => Promise<T>): Promise<T>;
};

type SessionIdentity = {
  userId: string;
  officeId: string;
};

type IdempotencyRow = {
  orderId: string | null;
  requestHash: string;
};

type OrderStatusRow = {
  orderId: string;
  status: string;
};

type BomRow = { id: string };
type CustomerRow = { id: string };

type OrderDetailRow = {
  id: string;
  status: string;
  progress: string | null;
  neededBy: Date | string | null;
  quantity: number | string;
  unit: string;
  material: string;
  specification: string | null;
  requestContext: unknown;
  approvalRequestedAt: Date | string | null;
  decisionSnapshot: unknown;
  vendors: unknown;
  updatedAt: Date | string;
};

type OrderListRow = Omit<OrderDetailRow, "requestContext" | "approvalRequestedAt" | "decisionSnapshot" | "vendors">;

export type ProcurementOrderVendor = {
  id: string;
  name: string;
  website: string | null;
  status: string;
  research: Record<string, unknown>;
  quote: Record<string, unknown> | null;
};

export type ProcurementOrderDetail = {
  id: string;
  status: string;
  progress: string | null;
  neededBy: string | null;
  quantity: number;
  unit: string;
  material: string;
  specification: string | null;
  requestContext: Record<string, unknown>;
  approvalRequestedAt: string | null;
  decisionSnapshot: Record<string, unknown> | null;
  vendors: ProcurementOrderVendor[];
  updatedAt: string;
};

export class ProcurementWorkflowError extends Error {
  constructor(
    message: string,
    public readonly code: "forbidden" | "not_found" | "conflict" | "configuration" | "unavailable",
  ) {
    super(message);
    this.name = "ProcurementWorkflowError";
  }
}

declare global {
  // eslint-disable-next-line no-var
  var procurementPrismaGlobal: PrismaClient | undefined;
}

function externalDatabaseUrl() {
  const value = process.env.WORKFLOW_DATABASE_URL?.trim();
  if (!value) {
    throw new ProcurementWorkflowError("The procurement workflow database is not configured.", "configuration");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProcurementWorkflowError("The procurement workflow database configuration is invalid.", "configuration");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new ProcurementWorkflowError("The procurement workflow database configuration is invalid.", "configuration");
  }
  if (decodeURIComponent(parsed.username) !== "dashboard_api") {
    throw new ProcurementWorkflowError("The procurement workflow database must use the dashboard_api role.", "configuration");
  }
  if (!SSL_MODES.has(parsed.searchParams.get("sslmode") ?? "")) {
    throw new ProcurementWorkflowError("The procurement workflow database must require SSL.", "configuration");
  }
  return value;
}

function externalDatabase(): ProcurementDatabase {
  const datasourceUrl = externalDatabaseUrl();
  const client = global.procurementPrismaGlobal ?? new PrismaClient({
    datasourceUrl,
    log: [],
  });
  if (process.env.NODE_ENV !== "production") global.procurementPrismaGlobal = client;
  return client as unknown as ProcurementDatabase;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isoTimestamp(value: Date | string | null) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function dateOnly(value: Date | string | null) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return isoTimestamp(value)?.slice(0, 10) ?? null;
}

function numberValue(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export function procurementRequestHash(input: ProcurementRequestInput) {
  const request = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "idempotencyKey"),
  );
  return createHash("sha256").update(JSON.stringify(canonicalize(request))).digest("hex");
}

export async function resolveProcurementCustomerId(session: SessionIdentity) {
  const account = await prisma.user.findFirst({
    where: { id: session.userId, officeId: session.officeId, isActive: true },
    select: { id: true },
  });
  if (!account) {
    throw new ProcurementWorkflowError("The authenticated account is no longer active.", "forbidden");
  }
  return procurementCustomerIdFromServerMetadata(session.officeId);
}

export function procurementCustomerIdFromServerMetadata(
  officeId: string,
  rawMapping = process.env.PROCUREMENT_CUSTOMER_MAP_JSON,
) {
  if (!rawMapping?.trim()) {
    throw new ProcurementWorkflowError("This account is not mapped to a procurement customer.", "configuration");
  }
  let mapping: unknown;
  try {
    mapping = JSON.parse(rawMapping);
  } catch {
    throw new ProcurementWorkflowError("The procurement customer mapping is invalid.", "configuration");
  }
  if (!isObject(mapping) || !Object.hasOwn(mapping, officeId)) {
    throw new ProcurementWorkflowError("This account is not mapped to a procurement customer.", "configuration");
  }
  const customerId = mapping[officeId];
  if (!uuidSchema.safeParse(customerId).success) {
    throw new ProcurementWorkflowError("The procurement customer mapping is invalid.", "configuration");
  }
  return customerId as string;
}

async function existingIdempotentOrder(
  transaction: RawDatabase,
  customerId: string,
  idempotencyKey: string,
  requestHash: string,
) {
  const rows = await transaction.$queryRawUnsafe<IdempotencyRow[]>(`
    SELECT
      order_id::text AS "orderId",
      request_hash AS "requestHash"
    FROM procurement_api_idempotency
    WHERE customer_id = $1::uuid
      AND idempotency_key = $2
  `, customerId, idempotencyKey);
  const existing = rows[0];
  if (!existing?.orderId) {
    throw new ProcurementWorkflowError("The prior submission has not completed. Retry shortly.", "conflict");
  }
  if (existing.requestHash !== requestHash) {
    throw new ProcurementWorkflowError("This idempotency key was already used for a different request.", "conflict");
  }
  const orders = await transaction.$queryRawUnsafe<OrderStatusRow[]>(`
    SELECT id::text AS "orderId", status
    FROM orders
    WHERE id = $1::uuid
      AND customer_id = $2::uuid
    LIMIT 1
  `, existing.orderId, customerId);
  if (!orders[0]) {
    throw new ProcurementWorkflowError("The prior procurement request is unavailable.", "conflict");
  }
  return { ...orders[0], created: false };
}

export async function createProcurementRequestInDatabase(
  database: ProcurementDatabase,
  customerId: string,
  input: ProcurementRequestInput,
) {
  if (!uuidSchema.safeParse(customerId).success) {
    throw new ProcurementWorkflowError("The procurement customer mapping is invalid.", "configuration");
  }
  if (!input.bomId && !input.material?.trim()) {
    throw new ProcurementWorkflowError("Material is required when creating a BOM.", "conflict");
  }
  const requestHash = procurementRequestHash(input);

  return database.$transaction(async (transaction) => {
    const customers = await transaction.$queryRawUnsafe<CustomerRow[]>(`
      SELECT id::text AS id
      FROM customers
      WHERE id = $1::uuid
      LIMIT 1
    `, customerId);
    if (!customers[0]) {
      throw new ProcurementWorkflowError("This account is not mapped to an active procurement customer.", "configuration");
    }

    const claim = await transaction.$queryRawUnsafe<IdempotencyRow[]>(`
      INSERT INTO procurement_api_idempotency (
        customer_id,
        idempotency_key,
        request_hash,
        order_id
      )
      VALUES ($1::uuid, $2, $3, NULL)
      ON CONFLICT (customer_id, idempotency_key) DO NOTHING
      RETURNING order_id::text AS "orderId", request_hash AS "requestHash"
    `, customerId, input.idempotencyKey, requestHash);

    if (!claim[0]) {
      return existingIdempotentOrder(transaction, customerId, input.idempotencyKey, requestHash);
    }

    let bomId = input.bomId;
    if (bomId) {
      const rows = await transaction.$queryRawUnsafe<BomRow[]>(`
        SELECT id::text AS id
        FROM bill_of_materials
        WHERE id = $1::uuid
          AND customer_id = $2::uuid
        LIMIT 1
      `, bomId, customerId);
      if (!rows[0]) {
        throw new ProcurementWorkflowError("The requested BOM was not found.", "not_found");
      }
    } else {
      const rows = await transaction.$queryRawUnsafe<BomRow[]>(`
        INSERT INTO bill_of_materials (
          customer_id,
          material,
          specification,
          procurement_preferences
        )
        VALUES ($1::uuid, $2, $3, $4::jsonb)
        RETURNING id::text AS id
      `, customerId, input.material, input.specification, JSON.stringify(input.lineItemPreferences));
      bomId = rows[0]?.id ?? null;
      if (!bomId) {
        throw new ProcurementWorkflowError("The procurement BOM could not be created.", "unavailable");
      }
    }

    const orders = await transaction.$queryRawUnsafe<OrderStatusRow[]>(`
      INSERT INTO orders (
        customer_id,
        bom_id,
        quantity,
        unit,
        needed_by,
        notes,
        request_context,
        status,
        progress
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3,
        $4,
        $5::date,
        $6,
        $7::jsonb,
        'new',
        'Order received from dashboard'
      )
      RETURNING id::text AS "orderId", status
    `,
    customerId,
    bomId,
    input.quantity,
    input.unit,
    input.neededBy,
    input.notes,
    JSON.stringify(input.requestContext));
    const order = orders[0];
    if (!order) {
      throw new ProcurementWorkflowError("The procurement request could not be created.", "unavailable");
    }

    const updated = await transaction.$executeRawUnsafe(`
      UPDATE procurement_api_idempotency
      SET order_id = $3::uuid,
          updated_at = now()
      WHERE customer_id = $1::uuid
        AND idempotency_key = $2
        AND request_hash = $4
    `, customerId, input.idempotencyKey, order.orderId, requestHash);
    if (updated !== 1) {
      throw new ProcurementWorkflowError("The procurement request could not be finalized.", "unavailable");
    }
    return { ...order, created: true };
  });
}

export async function createProcurementRequest(customerId: string, input: ProcurementRequestInput) {
  try {
    return await createProcurementRequestInDatabase(externalDatabase(), customerId, input);
  } catch (error) {
    if (error instanceof ProcurementWorkflowError) throw error;
    throw new ProcurementWorkflowError("The procurement workflow database is unavailable.", "unavailable");
  }
}

function normalizeVendor(value: unknown): ProcurementOrderVendor | null {
  if (!isObject(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : "Unknown supplier",
    website: safeWebsite(value.website),
    status: typeof value.status === "string" ? value.status : "unknown",
    research: isObject(value.research) ? value.research : {},
    quote: isObject(value.quote) ? value.quote : null,
  };
}

function safeWebsite(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeOrder(row: OrderDetailRow): ProcurementOrderDetail {
  const vendors = Array.isArray(row.vendors) ? row.vendors.map(normalizeVendor).filter(Boolean) : [];
  return {
    id: row.id,
    status: row.status,
    progress: row.progress,
    neededBy: dateOnly(row.neededBy),
    quantity: numberValue(row.quantity),
    unit: row.unit,
    material: row.material,
    specification: row.specification,
    requestContext: isObject(row.requestContext) ? row.requestContext : {},
    approvalRequestedAt: isoTimestamp(row.approvalRequestedAt),
    decisionSnapshot: isObject(row.decisionSnapshot) ? row.decisionSnapshot : null,
    vendors: vendors as ProcurementOrderVendor[],
    updatedAt: isoTimestamp(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

export async function getProcurementRequestFromDatabase(
  database: RawDatabase,
  customerId: string,
  orderId: string,
) {
  if (!uuidSchema.safeParse(orderId).success) {
    throw new ProcurementWorkflowError("Procurement request not found.", "not_found");
  }
  try {
    const rows = await database.$queryRawUnsafe<OrderDetailRow[]>(`
      SELECT
        orders.id::text AS id,
        orders.status,
        orders.progress,
        orders.needed_by AS "neededBy",
        orders.quantity,
        orders.unit,
        bill_of_materials.material,
        bill_of_materials.specification,
        orders.request_context AS "requestContext",
        orders.approval_requested_at AS "approvalRequestedAt",
        orders.decision_snapshot AS "decisionSnapshot",
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', order_vendors.id::text,
              'name', COALESCE(
                to_jsonb(order_vendors)->>'name',
                to_jsonb(order_vendors)->>'vendor_name',
                to_jsonb(order_vendors)->>'supplier_name',
                to_jsonb(order_vendors)->'identity'->>'name'
              ),
              'website', COALESCE(
                to_jsonb(order_vendors)->>'website',
                to_jsonb(order_vendors)->>'vendor_website',
                to_jsonb(order_vendors)->'identity'->>'website'
              ),
              'status', COALESCE(to_jsonb(order_vendors)->>'status', 'unknown'),
              'research', COALESCE(
                to_jsonb(order_vendors)->'research',
                to_jsonb(order_vendors)->'evidence',
                '{}'::jsonb
              ),
              'quote', to_jsonb(order_vendors)->'quote'
            )
            ORDER BY order_vendors.id
          ) FILTER (WHERE order_vendors.id IS NOT NULL),
          '[]'::jsonb
        ) AS vendors,
        orders.updated_at AS "updatedAt"
      FROM orders
      JOIN bill_of_materials
        ON bill_of_materials.id = orders.bom_id
        AND bill_of_materials.customer_id = orders.customer_id
      LEFT JOIN order_vendors
        ON order_vendors.order_id = orders.id
      WHERE orders.id = $1::uuid
        AND orders.customer_id = $2::uuid
      GROUP BY orders.id, bill_of_materials.id
      LIMIT 1
    `, orderId, customerId);
    return rows[0] ? normalizeOrder(rows[0]) : null;
  } catch (error) {
    if (error instanceof ProcurementWorkflowError) throw error;
    throw new ProcurementWorkflowError("The procurement workflow database is unavailable.", "unavailable");
  }
}

export async function getProcurementRequest(customerId: string, orderId: string) {
  return getProcurementRequestFromDatabase(externalDatabase(), customerId, orderId);
}

export async function listProcurementRequestsFromDatabase(
  database: RawDatabase,
  customerId: string,
  limit = 25,
) {
  try {
    const rows = await database.$queryRawUnsafe<OrderListRow[]>(`
      SELECT
        orders.id::text AS id,
        orders.status,
        orders.progress,
        orders.needed_by AS "neededBy",
        orders.quantity,
        orders.unit,
        bill_of_materials.material,
        bill_of_materials.specification,
        orders.updated_at AS "updatedAt"
      FROM orders
      JOIN bill_of_materials
        ON bill_of_materials.id = orders.bom_id
        AND bill_of_materials.customer_id = orders.customer_id
      WHERE orders.customer_id = $1::uuid
      ORDER BY orders.updated_at DESC, orders.id DESC
      LIMIT $2
    `, customerId, Math.min(Math.max(limit, 1), 50));
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      progress: row.progress,
      neededBy: dateOnly(row.neededBy),
      quantity: numberValue(row.quantity),
      unit: row.unit,
      material: row.material,
      specification: row.specification,
      updatedAt: isoTimestamp(row.updatedAt) ?? new Date(0).toISOString(),
    }));
  } catch (error) {
    if (error instanceof ProcurementWorkflowError) throw error;
    throw new ProcurementWorkflowError("The procurement workflow database is unavailable.", "unavailable");
  }
}

export async function listProcurementRequests(customerId: string, limit = 25) {
  return listProcurementRequestsFromDatabase(externalDatabase(), customerId, limit);
}

export async function requestBourneWorkflowWake(
  payload: { orderId: string; customerId: string },
  fetchImplementation: typeof fetch = fetch,
) {
  const webhookUrl = process.env.BOURNE_WORKFLOW_WEBHOOK_URL?.trim();
  if (!webhookUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    console.warn("Bourne workflow wake request skipped because its server configuration is invalid.");
    return false;
  }
  if (parsed.protocol !== "https:") {
    console.warn("Bourne workflow wake request skipped because HTTPS is required.");
    return false;
  }

  try {
    const response = await fetchImplementation(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "procurement.request.created",
        orderId: payload.orderId,
        customerId: payload.customerId,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      console.warn("Bourne workflow wake request returned an unsuccessful response after the order was committed.", {
        orderId: payload.orderId,
        status: response.status,
      });
    }
  } catch {
    console.warn("Bourne workflow wake request failed after the order was committed.", {
      orderId: payload.orderId,
    });
  }
  return true;
}

export async function submitProcurementRequest(
  customerId: string,
  input: ProcurementRequestInput,
  dependencies?: { database?: ProcurementDatabase; fetchImplementation?: typeof fetch },
) {
  const order = dependencies?.database
    ? await createProcurementRequestInDatabase(dependencies.database, customerId, input)
    : await createProcurementRequest(customerId, input);
  const workflowWakeRequested = order.created
    ? await requestBourneWorkflowWake(
        { orderId: order.orderId, customerId },
        dependencies?.fetchImplementation,
      )
    : false;
  return { ...order, workflowWakeRequested };
}
