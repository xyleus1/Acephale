import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeGoogleRedirectUri } from "@/lib/gmail-oauth";
import { classifyHealthChecks, type HealthCheck } from "@/lib/health-status";
import {
  outreachPipelineChecks,
  outreachSchemaChecks,
  pendingMigrationsCheck,
} from "@/lib/outreach-readiness";

// Health check. The DETAILED diagnostic (env inventory, model names, queue
// telemetry) is a pre-auth recon risk (F2), so it is gated behind CRON_SECRET.
// Unauthenticated callers get only a shallow liveness result.
function isDiagnosticAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided =
    req.headers.get("x-cron-secret") ??
    req.nextUrl.searchParams.get("secret") ??
    (req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const checks: HealthCheck[] = [];
  const env = {
    NODE_ENV: process.env.NODE_ENV ?? "unknown",
    VERCEL_ENV: process.env.VERCEL_ENV ?? "unknown",
    VERCEL_GIT_COMMIT_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
    AUTH_SECRET: !!process.env.AUTH_SECRET,
    DATABASE_URL: !!process.env.DATABASE_URL,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    EXA_API_KEY: !!process.env.EXA_API_KEY,
    SUPPLIER_RESEARCH_PROVIDER: process.env.EXA_API_KEY
      ? "EXA"
      : process.env.OPENAI_API_KEY ? "OPENAI" : "NONE",
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: normalizeGoogleRedirectUri(process.env.GOOGLE_REDIRECT_URI) ?? "unset",
    GOOGLE_REDIRECT_URI_HAS_ENV_KEY_PREFIX: !!process.env.GOOGLE_REDIRECT_URI?.trim().startsWith("GOOGLE_REDIRECT_URI="),
    CRON_SECRET: !!process.env.CRON_SECRET,
    WHATSAPP_VERIFY_TOKEN: !!process.env.WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_APP_SECRET: !!process.env.WHATSAPP_APP_SECRET,
    WHATSAPP_ACCESS_TOKEN: !!process.env.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_OFFICE_ID: !!process.env.WHATSAPP_OFFICE_ID,
    DERYA_GOOGLE_SHEET_ID: !!process.env.DERYA_GOOGLE_SHEET_ID,
    GOOGLE_SHEETS_API_KEY: !!process.env.GOOGLE_SHEETS_API_KEY,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  };

  try { await prisma.$queryRaw`SELECT 1`; checks.push({ name: "db_ping", ok: true, severity: "critical" }); }
  catch (e) { checks.push({ name: "db_ping", ok: false, severity: "critical", detail: msg(e) }); }

  try { await prisma.emailThread.findFirst({ select: { id: true, snoozedUntil: true, hiddenAt: true, awardedAt: true, supplierOffer: true, externalThreadId: true } }); checks.push({ name: "emailThread_recent_fields", ok: true, severity: "critical" }); }
  catch (e) { checks.push({ name: "emailThread_recent_fields", ok: false, severity: "critical", detail: msg(e) }); }

  try { await prisma.job.findFirst({ select: { id: true, parentJobId: true, portalToken: true, notifyCustomer: true, customerEmail: true } }); checks.push({ name: "job_recent_fields", ok: true, severity: "critical" }); }
  catch (e) { checks.push({ name: "job_recent_fields", ok: false, severity: "critical", detail: msg(e) }); }

  try { await prisma.jobDocument.findFirst({ select: { id: true, aiSummary: true, aiFlags: true, aiKeyFields: true, aiAnalyzedAt: true } }); checks.push({ name: "jobDocument_recent_fields", ok: true, severity: "critical" }); }
  catch (e) { checks.push({ name: "jobDocument_recent_fields", ok: false, severity: "critical", detail: msg(e) }); }

  try {
    await prisma.emailMessage.findFirst({
      where: { thread: { officeId: { not: "" } } },
      select: { id: true, gmailMessageId: true },
    });
    checks.push({ name: "emailMessage_gmailMessageId", ok: true, severity: "critical" });
  }
  catch (e) { checks.push({ name: "emailMessage_gmailMessageId", ok: false, severity: "critical", detail: msg(e) }); }

  try {
    await prisma.backgroundJob.findFirst({
      where: { officeId: { not: "" } },
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        runAfter: true,
        lockedAt: true,
        lastError: true,
      },
    });
    checks.push({ name: "backgroundJob_recent_fields", ok: true, severity: "critical" });
  } catch (e) {
    checks.push({ name: "backgroundJob_recent_fields", ok: false, severity: "critical", detail: msg(e) });
  }

  try {
    const staleRunningBefore = new Date(Date.now() - 30 * 60 * 1000);
    const [failed, staleRunning, queued] = await Promise.all([
      prisma.backgroundJob.count({ where: { status: "FAILED" } }),
      prisma.backgroundJob.count({ where: { status: "RUNNING", lockedAt: { lt: staleRunningBefore } } }),
      prisma.backgroundJob.count({ where: { status: "QUEUED" } }),
    ]);
    checks.push({
      name: "backgroundJob_backlog",
      ok: failed === 0 && staleRunning === 0,
      severity: "warning",
      detail: `queued=${queued}; failed=${failed}; staleRunning=${staleRunning}`,
    });
  } catch (e) {
    checks.push({ name: "backgroundJob_backlog", ok: false, severity: "warning", detail: msg(e) });
  }

  checks.push(...await outreachSchemaChecks(prisma));
  checks.push(await pendingMigrationsCheck(prisma));
  checks.push(...await outreachPipelineChecks(prisma, new Date()));

  const health = classifyHealthChecks(checks);
  // Unauthenticated callers get only liveness; the detailed diagnostic (env
  // inventory, model names, queue telemetry) requires the CRON_SECRET.
  if (!isDiagnosticAuthorized(req)) {
    return NextResponse.json(
      {
        ok: health.ok,
        status: health.status,
        timestamp: new Date().toISOString(),
      },
      { status: health.httpStatus },
    );
  }
  return NextResponse.json({
    ok: health.ok,
    status: health.status,
    timestamp: new Date().toISOString(),
    env,
    checks,
  }, { status: health.httpStatus });
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
}
