import "server-only";

import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SupplyConnectorError,
  connectorRecord,
  type SupplyConnectorCursor,
} from "./connector-contract";
import { getSupplyConnectorAdapter } from "./connector-registry";
import {
  normalizedSupplySourceHash,
  publishSupplyImportForOffice,
  requireSupplyWorkspace,
  stageNormalizedSupplySnapshot,
  SupplyPersistenceError,
  type SupplyAccessContext,
} from "./persistence";

const STALE_LOCK_MS = 15 * 60 * 1_000;
const SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{2,127}$/;
const FORBIDDEN_CONFIG_KEY = /(secret|password|credential|access.?token|refresh.?token|client.?secret)/i;

export type CreateConnectorInstallationInput = {
  displayName: string;
  baseUrl: string;
  secretRef: string;
  adapterKey?: string;
  scheduleMinutes?: number;
  config?: Record<string, unknown>;
};

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== "string") throw new SupplyPersistenceError(`${label} is required.`, "invalid_input");
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new SupplyPersistenceError(`${label} must contain 1 to ${max} characters.`, "invalid_input");
  return normalized;
}

function safeConfig(value: unknown): Record<string, unknown> {
  const config = connectorRecord(value);
  const visit = (candidate: unknown, path: string) => {
    if (Array.isArray(candidate)) return candidate.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>)) {
      if (FORBIDDEN_CONFIG_KEY.test(key)) throw new SupplyPersistenceError(`${path}.${key} cannot contain credentials.`, "invalid_input");
      visit(child, `${path}.${key}`);
    }
  };
  visit(config, "Connector config");
  return config;
}

function httpsBaseUrl(value: unknown) {
  const raw = requiredText(value, "Base URL", 2_048);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("invalid");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    throw new SupplyPersistenceError("Base URL must be a clean HTTPS URL.", "invalid_input");
  }
}

function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function privateAddress(address: string) {
  if (isIP(address) === 4) return privateIpv4(address);
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("fc") || normalized.startsWith("fd");
  }
  return true;
}

async function assertPublicTarget(url: URL) {
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new SupplyConnectorError("MAPPING_INVALID", "Connector endpoints must use public hosts.");
  }
  if (isIP(hostname) && privateAddress(hostname)) throw new SupplyConnectorError("MAPPING_INVALID", "Connector endpoints cannot use private addresses.");
  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SupplyConnectorError("SOURCE_UNAVAILABLE", "A connector host could not be resolved.", true);
  }
  if (!records.length || records.some((record) => privateAddress(record.address))) {
    throw new SupplyConnectorError("MAPPING_INVALID", "Connector endpoints cannot resolve to private addresses.");
  }
}

async function assertConnectorTargets(baseUrl: string, config: Record<string, unknown>) {
  const base = new URL(baseUrl);
  const targets = new Map<string, URL>([[base.origin, base]]);
  const visit = (value: unknown) => {
    if (typeof value === "string" && (value.startsWith("/") || value.startsWith("https://"))) {
      const url = new URL(value, base);
      targets.set(url.origin, url);
      return;
    }
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(config);
  await Promise.all([...targets.values()].map(assertPublicTarget));
}

function connectorError(error: unknown) {
  if (error instanceof SupplyConnectorError) return error;
  if (error instanceof SupplyPersistenceError) return new SupplyConnectorError("VALIDATION_FAILED", error.message);
  return new SupplyConnectorError("SOURCE_UNAVAILABLE", "Connector synchronization failed.", true);
}

function cursorValue(value: Prisma.JsonValue | null): SupplyConnectorCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output: SupplyConnectorCursor = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || ["string", "number", "boolean"].includes(typeof entry)) output[key] = entry as string | number | boolean | null;
  }
  return output;
}

export async function createConnectorInstallation(
  context: SupplyAccessContext,
  workspaceId: string,
  input: CreateConnectorInstallationInput,
) {
  await requireSupplyWorkspace(context, workspaceId, "edit");
  if (context.accessKind === "customer" || context.role !== "ADMIN") throw new SupplyPersistenceError("Only admins can configure client connectors.", "forbidden");
  const adapterKey = input.adapterKey?.trim() || "CUSTOM_REST_V1";
  const adapter = getSupplyConnectorAdapter(adapterKey);
  if (!adapter) throw new SupplyPersistenceError("Connector adapter is not supported.", "invalid_input");
  const secretRef = requiredText(input.secretRef, "Secret reference", 128);
  if (!SECRET_REF_PATTERN.test(secretRef)) throw new SupplyPersistenceError("Secret reference must be an uppercase deployment environment key.", "invalid_input");
  const scheduleMinutes = input.scheduleMinutes ?? 60;
  if (!Number.isInteger(scheduleMinutes) || scheduleMinutes < 15 || scheduleMinutes > 10_080) {
    throw new SupplyPersistenceError("Schedule must be between 15 minutes and 7 days.", "invalid_input");
  }
  const config = adapter.validateConfig(safeConfig(input.config ?? {}));
  try {
    return await prisma.connectorInstallation.create({
      data: {
        officeId: context.officeId,
        workspaceId,
        createdByUserId: context.userId,
        adapterKey,
        adapterVersion: adapter.version,
        displayName: requiredText(input.displayName, "Connector name", 160),
        baseUrl: httpsBaseUrl(input.baseUrl),
        secretRef,
        config: config as Prisma.InputJsonValue,
        scheduleMinutes,
        status: "DISABLED",
      },
      select: connectorSelection,
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      throw new SupplyPersistenceError("This workspace already has that connector adapter.", "conflict");
    }
    throw error;
  }
}

const connectorSelection = {
  id: true,
  workspaceId: true,
  adapterKey: true,
  adapterVersion: true,
  displayName: true,
  baseUrl: true,
  authType: true,
  scheduleMinutes: true,
  status: true,
  currentCursor: true,
  lastTraceId: true,
  lastErrorCode: true,
  lastErrorMessage: true,
  lastTestedAt: true,
  lastStartedAt: true,
  lastSucceededAt: true,
  lastFailedAt: true,
  nextSyncAt: true,
  createdAt: true,
  updatedAt: true,
  importRuns: {
    orderBy: { createdAt: "desc" as const },
    take: 5,
    select: { id: true, status: true, recordCounts: true, traceId: true, errorCode: true, lastError: true, createdAt: true, completedAt: true },
  },
} satisfies Prisma.ConnectorInstallationSelect;

export async function listConnectorInstallations(context: SupplyAccessContext, workspaceId: string) {
  await requireSupplyWorkspace(context, workspaceId, "view");
  return prisma.connectorInstallation.findMany({
    where: { officeId: context.officeId, workspaceId },
    orderBy: { createdAt: "asc" },
    select: connectorSelection,
  });
}

async function connectorForContext(context: SupplyAccessContext, connectorId: string, mode: "view" | "edit") {
  const installation = await prisma.connectorInstallation.findFirst({ where: { id: connectorId, officeId: context.officeId } });
  if (!installation) throw new SupplyPersistenceError("Connector not found.", "not_found");
  await requireSupplyWorkspace(context, installation.workspaceId, mode);
  return installation;
}

export async function testConnectorInstallation(context: SupplyAccessContext, connectorId: string) {
  const installation = await connectorForContext(context, connectorId, "edit");
  if (context.accessKind === "customer" || context.role !== "ADMIN") throw new SupplyPersistenceError("Only admins can test client connectors.", "forbidden");
  const adapter = getSupplyConnectorAdapter(installation.adapterKey);
  if (!adapter) throw new SupplyPersistenceError("Connector adapter is not supported.", "invalid_input");
  const traceId = randomUUID();
  const config = adapter.validateConfig(installation.config);
  try {
    await assertConnectorTargets(installation.baseUrl, config);
    const result = await adapter.testConnection({
      installationId: installation.id,
      baseUrl: installation.baseUrl,
      secretRef: installation.secretRef,
      config,
      inputCursor: cursorValue(installation.currentCursor),
      traceId,
    });
    await prisma.connectorInstallation.update({
      where: { id: installation.id, officeId: context.officeId },
      data: { lastTestedAt: new Date(), lastTraceId: traceId, lastErrorCode: null, lastErrorMessage: null },
    });
    return { ok: true, traceId, sourceVersion: result.sourceVersion };
  } catch (error) {
    const failure = connectorError(error);
    await prisma.connectorInstallation.update({
      where: { id: installation.id, officeId: context.officeId },
      data: { lastTestedAt: new Date(), lastTraceId: traceId, lastErrorCode: failure.code, lastErrorMessage: failure.message },
    });
    throw failure;
  }
}

export async function setConnectorEnabled(context: SupplyAccessContext, connectorId: string, enabled: boolean) {
  const installation = await connectorForContext(context, connectorId, "edit");
  if (context.accessKind === "customer" || context.role !== "ADMIN") throw new SupplyPersistenceError("Only admins can change connector status.", "forbidden");
  if (enabled && (!installation.lastTestedAt || installation.lastErrorCode)) {
    throw new SupplyPersistenceError("Pass a connection test before enabling scheduled sync.", "conflict");
  }
  return prisma.connectorInstallation.update({
    where: { id: installation.id, officeId: context.officeId },
    data: {
      status: enabled ? "ACTIVE" : "DISABLED",
      nextSyncAt: enabled ? new Date() : null,
      lastErrorCode: enabled ? null : installation.lastErrorCode,
      lastErrorMessage: enabled ? null : installation.lastErrorMessage,
    },
    select: connectorSelection,
  });
}

async function syncInstallation(args: {
  installationId: string;
  officeId: string;
  createdByUserId?: string | null;
}) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const locked = await prisma.connectorInstallation.updateMany({
    where: {
      id: args.installationId,
      officeId: args.officeId,
      OR: [
        { status: { in: ["ACTIVE", "FAILED"] } },
        { status: "RUNNING", lastStartedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "RUNNING", lastStartedAt: now, lastErrorCode: null, lastErrorMessage: null },
  });
  if (locked.count !== 1) throw new SupplyConnectorError("SYNC_IN_PROGRESS", "Connector sync is already running or disabled.");
  const installation = await prisma.connectorInstallation.findFirstOrThrow({ where: { id: args.installationId, officeId: args.officeId } });
  const traceId = randomUUID();
  const inputCursor = cursorValue(installation.currentCursor);
  try {
    const adapter = getSupplyConnectorAdapter(installation.adapterKey);
    if (!adapter) throw new SupplyConnectorError("MAPPING_INVALID", "Connector adapter is not supported.");
    const config = adapter.validateConfig(installation.config);
    await assertConnectorTargets(installation.baseUrl, config);
    const result = await adapter.pull({
      installationId: installation.id,
      baseUrl: installation.baseUrl,
      secretRef: installation.secretRef,
      config,
      inputCursor,
      traceId,
    });
    const hash = normalizedSupplySourceHash(result.normalized);
    const staged = await stageNormalizedSupplySnapshot({
      officeId: installation.officeId,
      workspaceId: installation.workspaceId,
      createdByUserId: args.createdByUserId ?? null,
      sourceName: installation.displayName,
      adapter: installation.adapterKey,
      adapterVersion: adapter.version,
      connectorInstallationId: installation.id,
      idempotencyNamespace: `connector:${installation.id}`,
      inputCursor: inputCursor as Prisma.InputJsonValue | null,
      outputCursor: result.outputCursor as Prisma.InputJsonValue | null,
      traceId,
      hash,
      normalized: result.normalized,
    });
    const published = await publishSupplyImportForOffice(installation.officeId, staged.id);
    const completedAt = new Date();
    await prisma.connectorInstallation.update({
      where: { id: installation.id, officeId: installation.officeId },
      data: {
        status: "ACTIVE",
        adapterVersion: adapter.version,
        ...(result.outputCursor ? { currentCursor: result.outputCursor as Prisma.InputJsonValue } : {}),
        lastTraceId: traceId,
        lastSucceededAt: completedAt,
        lastFailedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextSyncAt: new Date(completedAt.getTime() + installation.scheduleMinutes * 60_000),
      },
    });
    return { connectorId: installation.id, traceId, importRunId: published.id, snapshotId: published.snapshot?.id ?? null, status: "PUBLISHED" as const };
  } catch (error) {
    const failure = connectorError(error);
    const failedAt = new Date();
    const existingRun = await prisma.supplyImportRun.findFirst({
      where: { officeId: installation.officeId, connectorInstallationId: installation.id, traceId },
      select: { id: true, snapshot: { select: { id: true } } },
    });
    if (existingRun) {
      await prisma.supplyImportRun.update({
        where: { id: existingRun.id, officeId: installation.officeId },
        data: {
          ...(existingRun.snapshot ? {} : { status: "FAILED" }),
          errorCode: failure.code,
          lastError: failure.message,
          failedAt,
        },
      });
    } else {
      await prisma.supplyImportRun.create({
        data: {
          officeId: installation.officeId,
          workspaceId: installation.workspaceId,
          connectorInstallationId: installation.id,
          createdByUserId: args.createdByUserId ?? null,
          adapter: installation.adapterKey,
          adapterVersion: installation.adapterVersion,
          status: "FAILED",
          sourceName: installation.displayName,
          idempotencyKey: `connector-failure:${installation.id}:${traceId}`,
          ...(inputCursor ? { inputCursor: inputCursor as Prisma.InputJsonValue } : {}),
          traceId,
          errorCode: failure.code,
          lastError: failure.message,
          startedAt: installation.lastStartedAt ?? now,
          failedAt,
        },
      });
    }
    await prisma.connectorInstallation.update({
      where: { id: installation.id, officeId: installation.officeId },
      data: {
        status: "FAILED",
        lastTraceId: traceId,
        lastFailedAt: failedAt,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
        nextSyncAt: new Date(failedAt.getTime() + installation.scheduleMinutes * 60_000),
      },
    });
    throw failure;
  }
}

export async function syncConnectorInstallation(context: SupplyAccessContext, connectorId: string) {
  const installation = await connectorForContext(context, connectorId, "edit");
  if (installation.status === "DISABLED") throw new SupplyConnectorError("CONNECTOR_DISABLED", "Enable the connector before synchronizing it.");
  return syncInstallation({ installationId: installation.id, officeId: context.officeId, createdByUserId: context.userId });
}

export async function runDueConnectorSyncs(input: { limit?: number } = {}) {
  const limit = Math.min(25, Math.max(1, input.limit ?? 10));
  const due = await prisma.connectorInstallation.findMany({
    where: { status: { in: ["ACTIVE", "FAILED"] }, nextSyncAt: { lte: new Date() } },
    orderBy: { nextSyncAt: "asc" },
    take: limit,
    select: { id: true, officeId: true },
  });
  const results = [];
  for (const installation of due) {
    try {
      results.push({ ok: true, ...(await syncInstallation({ installationId: installation.id, officeId: installation.officeId })) });
    } catch (error) {
      const failure = connectorError(error);
      results.push({ ok: false, connectorId: installation.id, code: failure.code, error: failure.message });
    }
  }
  return { attempted: due.length, results };
}
