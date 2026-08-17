import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { GUILD_SOURCING_LINES } from "./guild-sourcing-items";

const CUSTOMER_KEY = "guild2";
const CUSTOMER_NAME = "GUILD2";

export type ExternalSourcingRun = {
  id: string;
  status: "QUEUED" | "DISPATCHED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  createdAt: string;
  updatedAt: string;
  error: string | null;
};

export type Guild2WorkflowState = {
  configured: boolean;
  triggerConfigured: boolean;
  customer: { id: string; externalKey: string; name: string } | null;
  materialCount: number;
  latestRun: ExternalSourcingRun | null;
};

declare global {
  // eslint-disable-next-line no-var
  var externalWorkflowPrismaGlobal: PrismaClient | undefined;
}

function workflowClient() {
  const datasourceUrl = process.env.WORKFLOW_DATABASE_URL?.trim();
  if (!datasourceUrl) return null;
  const client = global.externalWorkflowPrismaGlobal ?? new PrismaClient({
    datasourceUrl,
    log: process.env.NODE_ENV === "development" ? ["error"] : [],
  });
  if (process.env.NODE_ENV !== "production") global.externalWorkflowPrismaGlobal = client;
  return client;
}

function customerId(officeId: string) {
  return `guild2_${createHash("sha256").update(officeId).digest("hex").slice(0, 24)}`;
}

function materialId(customer: string, item: string) {
  return `guild2_material_${createHash("sha256").update(`${customer}:${item}`).digest("hex").slice(0, 24)}`;
}

function cleanError(value: unknown) {
  const message = value instanceof Error ? value.message : "Workflow dispatch failed.";
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "database connection").slice(0, 500);
}

async function ensureTables(client: PrismaClient) {
  await client.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS derya`);
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS derya.customers (
      id text PRIMARY KEY,
      office_id text NOT NULL,
      external_key text NOT NULL,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (office_id, external_key)
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS derya.materials (
      id text PRIMARY KEY,
      customer_id text NOT NULL REFERENCES derya.customers(id) ON DELETE CASCADE,
      item_key text NOT NULL,
      name text NOT NULL,
      specification text NOT NULL,
      quantity numeric,
      unit text,
      requirement text NOT NULL,
      deliverable text NOT NULL,
      classification text NOT NULL,
      need_by_date date NOT NULL,
      delivery_location text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (customer_id, item_key)
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS derya.sourcing_runs (
      id text PRIMARY KEY,
      office_id text NOT NULL,
      customer_id text NOT NULL REFERENCES derya.customers(id) ON DELETE CASCADE,
      requested_by_user_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('QUEUED', 'DISPATCHED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
      input jsonb NOT NULL,
      result jsonb,
      error jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    )
  `);
  await client.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS sourcing_runs_one_active_customer
    ON derya.sourcing_runs (office_id, customer_id)
    WHERE status IN ('QUEUED', 'DISPATCHED', 'RUNNING')
  `);
}

async function seedGuild2(client: PrismaClient, officeId: string) {
  const preferredId = customerId(officeId);
  const customers = await client.$queryRaw<Array<{ id: string }>>`
    INSERT INTO derya.customers (id, office_id, external_key, name)
    VALUES (${preferredId}, ${officeId}, ${CUSTOMER_KEY}, ${CUSTOMER_NAME})
    ON CONFLICT (office_id, external_key) DO UPDATE
    SET name = EXCLUDED.name, updated_at = now()
    RETURNING id
  `;
  const id = customers[0]?.id;
  if (!id) throw new Error("GUILD2 could not be created.");
  for (const line of GUILD_SOURCING_LINES) {
    const itemKey = line.sku.replace(/^GUILD-/, "GUILD2-");
    await client.$executeRaw`
      INSERT INTO derya.materials (
        id, customer_id, item_key, name, specification, quantity, unit,
        requirement, deliverable, classification, need_by_date, delivery_location
      ) VALUES (
        ${materialId(id, itemKey)}, ${id}, ${itemKey}, ${line.name}, ${line.specification},
        ${line.quantity}, ${line.unit}, ${line.requirement}, ${line.deliverable},
        ${line.classification}, ${"2026-09-30"}::date, ${"Austin, TX, United States"}
      )
      ON CONFLICT (customer_id, item_key) DO UPDATE SET
        name = EXCLUDED.name,
        specification = EXCLUDED.specification,
        quantity = EXCLUDED.quantity,
        unit = EXCLUDED.unit,
        requirement = EXCLUDED.requirement,
        deliverable = EXCLUDED.deliverable,
        classification = EXCLUDED.classification,
        need_by_date = EXCLUDED.need_by_date,
        delivery_location = EXCLUDED.delivery_location,
        updated_at = now()
    `;
  }
  return { id, externalKey: CUSTOMER_KEY, name: CUSTOMER_NAME };
}

function runFromRow(row: Record<string, unknown> | undefined): ExternalSourcingRun | null {
  if (!row) return null;
  return {
    id: String(row.id),
    status: String(row.status) as ExternalSourcingRun["status"],
    createdAt: new Date(String(row.createdAt)).toISOString(),
    updatedAt: new Date(String(row.updatedAt)).toISOString(),
    error: row.error && typeof row.error === "object" && "message" in row.error
      ? String((row.error as { message?: unknown }).message ?? "Workflow failed.")
      : null,
  };
}

async function latestRun(client: PrismaClient, officeId: string, customer: string) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id, status, error, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM derya.sourcing_runs
    WHERE office_id = ${officeId} AND customer_id = ${customer}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return runFromRow(rows[0]);
}

export async function loadGuild2WorkflowState(officeId: string): Promise<Guild2WorkflowState> {
  const client = workflowClient();
  if (!client) return { configured: false, triggerConfigured: false, customer: null, materialCount: 0, latestRun: null };
  await ensureTables(client);
  const customer = await seedGuild2(client, officeId);
  const counts = await client.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM derya.materials WHERE customer_id = ${customer.id}
  `;
  return {
    configured: true,
    triggerConfigured: Boolean(process.env.WORKFLOW_AGENT_TRIGGER_URL?.trim()),
    customer,
    materialCount: Number(counts[0]?.count ?? 0),
    latestRun: await latestRun(client, officeId, customer.id),
  };
}

export async function startGuild2Workflow(input: { officeId: string; userId: string }) {
  const client = workflowClient();
  if (!client) throw new Error("WORKFLOW_DATABASE_URL is not configured.");
  const triggerUrl = process.env.WORKFLOW_AGENT_TRIGGER_URL?.trim();
  if (!triggerUrl) throw new Error("WORKFLOW_AGENT_TRIGGER_URL is not configured.");
  const state = await loadGuild2WorkflowState(input.officeId);
  if (!state.customer) throw new Error("GUILD2 could not be created.");
  const active = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id, status, error, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM derya.sourcing_runs
    WHERE office_id = ${input.officeId}
      AND customer_id = ${state.customer.id}
      AND status IN ('QUEUED', 'DISPATCHED', 'RUNNING')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (active[0]) return { run: runFromRow(active[0]), reused: true };

  const runId = randomUUID();
  const payload = {
    runId,
    customer: state.customer,
    materialTable: "derya.materials",
    runTable: "derya.sourcing_runs",
    materialCount: state.materialCount,
  };
  await client.$executeRaw`
    INSERT INTO derya.sourcing_runs (
      id, office_id, customer_id, requested_by_user_id, status, input
    ) VALUES (
      ${runId}, ${input.officeId}, ${state.customer.id}, ${input.userId}, 'QUEUED',
      ${JSON.stringify(payload)}::jsonb
    )
  `;

  try {
    const token = process.env.WORKFLOW_AGENT_TRIGGER_TOKEN?.trim();
    const response = await fetch(triggerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Workflow trigger returned HTTP ${response.status}.`);
    await client.$executeRaw`
      UPDATE derya.sourcing_runs SET status = 'DISPATCHED', updated_at = now()
      WHERE id = ${runId} AND office_id = ${input.officeId} AND status = 'QUEUED'
    `;
  } catch (error) {
    const message = cleanError(error);
    await client.$executeRaw`
      UPDATE derya.sourcing_runs
      SET status = 'FAILED', error = ${JSON.stringify({ message })}::jsonb,
          updated_at = now(), completed_at = now()
      WHERE id = ${runId} AND office_id = ${input.officeId} AND status = 'QUEUED'
    `;
    throw new Error(message);
  }
  return { run: await latestRun(client, input.officeId, state.customer.id), reused: false };
}
