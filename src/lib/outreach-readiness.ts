import type { HealthCheck } from "@/lib/health-status";
import {
  classifyDeliveryFeedback,
  DELIVERY_FEEDBACK_CLASSIFICATION,
} from "@/lib/email-delivery-feedback";
import { COMMITTED_MIGRATIONS } from "@/lib/migration-manifest";
import { AUTO_REPLY_CLAIM_TIMEOUT_MS } from "@/lib/outreach-campaign-auto-reply";
import { isHumanReplyMessage } from "@/lib/outreach-campaign-copy";
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
  emailThread: {
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
    const message = errorDetail(error);
    return {
      name: "prisma_migrations_applied",
      ok: false,
      severity: "critical",
      detail: message.toLowerCase().includes("permission denied")
        ? "app role cannot read _prisma_migrations, apply migration 20260907000100_grant_prisma_migrations_read via the production migration workflow"
        : message,
    };
  }
}

export async function outreachReplyBacklog(
  db: ReadinessDb,
  now = new Date(),
) {
  const sends: Array<{ id: string; campaignId: string; localThreadId: string | null; senderEmail: string | null }> = [];
  let cursor: string | undefined;
  while (true) {
    const batch = await db.outreachCampaignSend.findMany({
      where: { status: "SENT", localThreadId: { not: null } },
      select: { id: true, campaignId: true, localThreadId: true, senderEmail: true },
      orderBy: { id: "asc" },
      take: 2000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }) as Array<{ id: string; campaignId: string; localThreadId: string | null; senderEmail: string | null }>;
    sends.push(...batch);
    if (batch.length < 2000) break;
    cursor = batch[batch.length - 1]?.id;
    if (!cursor) break;
  }
  const threadToCampaign = new Map<string, { campaignId: string; senderEmails: string[] }>();
  for (const send of sends) {
    if (!send.localThreadId) continue;
    const existing = threadToCampaign.get(send.localThreadId);
    if (existing) {
      if (send.senderEmail) existing.senderEmails.push(send.senderEmail);
    } else {
      threadToCampaign.set(send.localThreadId, {
        campaignId: send.campaignId,
        senderEmails: send.senderEmail ? [send.senderEmail] : [],
      });
    }
  }
  if (!threadToCampaign.size) return { count: 0, byCampaign: new Map<string, number>() };
  const accounts = await db.emailAccount.findMany({ select: { email: true } }) as Array<{ email: string }>;
  const ownEmails = new Set(accounts.map((account) => account.email.trim().toLowerCase()));
  const threadIds = [...threadToCampaign.keys()];
  const byCampaign = new Map<string, number>();
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  for (let index = 0; index < threadIds.length; index += 500) {
    const chunk = threadIds.slice(index, index + 500);
    const threads = await db.emailThread.findMany({
      where: { id: { in: chunk } },
      select: {
        id: true,
        subject: true,
        messages: {
          orderBy: { sentAt: "desc" },
          take: 10,
          where: {
            deliveryKind: null,
            OR: [
              { classification: null },
              { classification: { not: DELIVERY_FEEDBACK_CLASSIFICATION } },
            ],
          },
          select: {
            id: true,
            direction: true,
            fromEmail: true,
            subject: true,
            bodyText: true,
            sentAt: true,
            deliveryKind: true,
            classification: true,
          },
        },
      },
    }) as Array<{
      id: string;
      subject: string;
      messages: Array<{
        id: string;
        direction: string;
        fromEmail: string;
        subject: string | null;
        bodyText: string | null;
        sentAt: Date;
        deliveryKind: string | null;
        classification: string | null;
      }>;
    }>;
    const candidates = threads.flatMap((thread) => {
      const sendInfo = threadToCampaign.get(thread.id);
      if (!sendInfo) return [];
      const ownAddresses = [...ownEmails, ...sendInfo.senderEmails.map((email) => email.trim().toLowerCase())];
      const decisive = thread.messages.find((message) => {
        if (message.direction === "OUTBOUND") return true;
        if (
          message.direction !== "INBOUND"
          || ownAddresses.includes(message.fromEmail.trim().toLowerCase())
          || !isHumanReplyMessage(message)
        ) {
          return false;
        }
        const feedback = classifyDeliveryFeedback({
          subject: message.subject ?? thread.subject,
          fromEmail: message.fromEmail,
          bodyText: message.bodyText ?? "",
          headers: [],
          ownAddresses,
        });
        return !feedback || feedback.kind === "OPT_OUT";
      });
      if (!decisive || decisive.direction === "OUTBOUND" || decisive.sentAt >= cutoff) return [];
      return [{ id: decisive.id, campaignId: sendInfo.campaignId }];
    });
    if (!candidates.length) continue;
    const replies = await db.outreachCampaignReply.findMany({
      where: { inboundMessageId: { in: candidates.map((candidate) => candidate.id) } },
      select: { inboundMessageId: true, action: true, claimedAt: true, pendingAt: true },
    }) as Array<{
      inboundMessageId: string;
      action: string;
      claimedAt: Date | null;
      pendingAt: Date | null;
    }>;
    const repliesByInbound = new Map(replies.map((reply) => [reply.inboundMessageId, reply]));
    for (const candidate of candidates) {
      const reply = repliesByInbound.get(candidate.id);
      const handled = reply && (
        reply.action === "SENT"
        || reply.action === "SUPPRESSED"
        || (
          reply.action === "CLAIMED"
          || reply.action === "PENDING"
          || reply.action === "RECONCILING"
        ) && (() => {
          const timestamp = reply.action === "PENDING"
            ? reply.pendingAt
            : reply.claimedAt ?? reply.pendingAt;
          return Boolean(timestamp)
            && now.getTime() - (timestamp as Date).getTime() < AUTO_REPLY_CLAIM_TIMEOUT_MS;
        })()
      );
      if (!handled) {
        byCampaign.set(candidate.campaignId, (byCampaign.get(candidate.campaignId) ?? 0) + 1);
      }
    }
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
