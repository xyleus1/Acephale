import type { HealthCheck } from "@/lib/health-status";
import { COMMITTED_MIGRATIONS } from "@/lib/migration-manifest";
import { replyContextBlocker } from "@/lib/outreach-reply-context";

type ReadinessDb = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  outreachCampaign: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
  };
  outreachCampaignSend: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
  };
  outreachCampaignReply: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
  };
  emailMessage: {
    findMany(args: unknown): Promise<unknown[]>;
  };
  emailAccount: {
    findMany(args: unknown): Promise<unknown[]>;
  };
};

export const OUTREACH_SCHEMA_NOT_READY_MESSAGE =
  "Outreach schema is not migrated. Run the production database migration workflow.";

const AUTO_REPLY_CONTEXT_MESSAGE =
  "Auto-reply is on but the campaign has no reply context. Add pitch, offer, FAQs and limits, or set reply mode to OFF.";

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

export function isSchemaNotReadyError(error: unknown): boolean {
  return error instanceof Error
    && ((error as Error & { code?: string }).code === "P2021"
      || (error as Error & { code?: string }).code === "P2022");
}

export async function outreachSchemaChecks(db: ReadinessDb): Promise<HealthCheck[]> {
  const checks: Array<{ name: string; probe: () => Promise<unknown> }> = [
    {
      name: "outreach_campaign_schema",
      probe: () => db.outreachCampaign.findFirst({
        select: { id: true, replyMode: true, replyContext: true },
      }),
    },
    {
      name: "outreach_send_schema",
      probe: () => db.outreachCampaignSend.findFirst({
        select: { id: true, intro: true, renderedSubject: true, renderedBody: true },
      }),
    },
    {
      name: "outreach_reply_schema",
      probe: () => db.outreachCampaignReply.findFirst({
        select: { id: true, claimedAt: true, action: true },
      }),
    },
  ];
  return Promise.all(checks.map(async ({ name, probe }) => {
    try {
      await probe();
      return { name, ok: true, severity: "critical" as const };
    } catch (error) {
      return { name, ok: false, severity: "critical" as const, detail: errorDetail(error) };
    }
  }));
}

export async function pendingMigrationsCheck(db: ReadinessDb): Promise<HealthCheck> {
  try {
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    const appliedNames = new Set(applied.map((row) => row.migration_name));
    const missing = COMMITTED_MIGRATIONS.filter((name) => !appliedNames.has(name));
    return {
      name: "prisma_migrations_applied",
      ok: missing.length === 0,
      severity: "critical",
      ...(missing.length
        ? {
            detail: `missing=${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}; deployed code is ahead of the database, run the production migration workflow`,
          }
        : {}),
    };
  } catch (error) {
    return {
      name: "prisma_migrations_applied",
      ok: false,
      severity: "critical",
      detail: errorDetail(error),
    };
  }
}

export async function outreachReplyBacklog(
  db: ReadinessDb,
  now = new Date(),
) {
  const sends = await db.outreachCampaignSend.findMany({
    where: { status: "SENT", localThreadId: { not: null } },
    select: { campaignId: true, localThreadId: true },
    orderBy: { sentAt: "desc" },
    take: 2000,
  }) as Array<{ campaignId: string; localThreadId: string | null }>;
  const threadToCampaign = new Map(
    sends
      .filter((send) => send.localThreadId)
      .map((send) => [send.localThreadId as string, send.campaignId]),
  );
  if (!threadToCampaign.size) return { count: 0, byCampaign: new Map<string, number>() };
  const accounts = await db.emailAccount.findMany({ select: { email: true } }) as Array<{ email: string }>;
  const ownEmails = new Set(accounts.map((account) => account.email.trim().toLowerCase()));
  const inbound = await db.emailMessage.findMany({
    where: {
      direction: "INBOUND",
      sentAt: { lt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
      threadId: { in: [...threadToCampaign.keys()] },
    },
    select: { id: true, threadId: true, fromEmail: true },
  }) as Array<{ id: string; threadId: string; fromEmail: string }>;
  const candidateInbound = inbound.filter((message) => !ownEmails.has(message.fromEmail.trim().toLowerCase()));
  if (!candidateInbound.length) return { count: 0, byCampaign: new Map<string, number>() };
  const replies = await db.outreachCampaignReply.findMany({
    where: { inboundMessageId: { in: candidateInbound.map((message) => message.id) } },
    select: { inboundMessageId: true },
  }) as Array<{ inboundMessageId: string }>;
  const answered = new Set(replies.map((reply) => reply.inboundMessageId));
  const byCampaign = new Map<string, number>();
  for (const message of candidateInbound) {
    if (answered.has(message.id)) continue;
    const campaignId = threadToCampaign.get(message.threadId);
    if (campaignId) byCampaign.set(campaignId, (byCampaign.get(campaignId) ?? 0) + 1);
  }
  return {
    count: [...byCampaign.values()].reduce((total, count) => total + count, 0),
    byCampaign,
  };
}

export async function outreachPipelineChecks(
  db: ReadinessDb,
  now = new Date(),
): Promise<HealthCheck[]> {
  const cutoff = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const checks: HealthCheck[] = [];
  try {
    const campaigns = await db.outreachCampaign.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, officeId: true, lastRunAt: true, approvedAt: true, createdAt: true },
    }) as Array<{
      id: string;
      officeId: string;
      lastRunAt: Date | null;
      approvedAt: Date | null;
      createdAt: Date;
    }>;
    const stale = campaigns.filter((campaign) => {
      const activatedAt = campaign.approvedAt ?? campaign.createdAt;
      return activatedAt < cutoff && (!campaign.lastRunAt || campaign.lastRunAt < cutoff);
    });
    checks.push({
      name: "outreach_campaign_cron",
      ok: stale.length === 0,
      severity: "warning",
      ...(stale.length ? { detail: stale.slice(0, 5).map((campaign) => `${campaign.officeId}:${campaign.id}`).join(", ") } : {}),
    });
  } catch (error) {
    checks.push({ name: "outreach_campaign_cron", ok: false, severity: "warning", detail: errorDetail(error) });
  }
  try {
    const campaigns = await db.outreachCampaign.findMany({
      where: { status: { in: ["ACTIVE", "PAUSED"] } },
      select: { id: true, officeId: true, replyMode: true, replyContext: true },
    }) as Array<{ id: string; officeId: string; replyMode: string; replyContext: unknown }>;
    const missing = campaigns.filter((campaign) => replyContextBlocker(campaign.replyMode, campaign.replyContext));
    checks.push({
      name: "outreach_auto_reply_context",
      ok: missing.length === 0,
      severity: "warning",
      ...(missing.length ? { detail: missing.slice(0, 5).map((campaign) => `${campaign.officeId}:${campaign.id}`).join(", ") } : {}),
    });
  } catch (error) {
    checks.push({ name: "outreach_auto_reply_context", ok: false, severity: "warning", detail: errorDetail(error) });
  }
  try {
    const backlog = await outreachReplyBacklog(db, now);
    checks.push({
      name: "outreach_reply_backlog",
      ok: backlog.count === 0,
      severity: "warning",
      detail: `unanswered=${backlog.count}`,
    });
  } catch (error) {
    checks.push({ name: "outreach_reply_backlog", ok: false, severity: "warning", detail: errorDetail(error) });
  }
  return checks;
}

export { AUTO_REPLY_CONTEXT_MESSAGE };
