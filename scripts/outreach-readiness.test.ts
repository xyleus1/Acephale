import assert from "node:assert/strict";
import { DELIVERY_FEEDBACK_CLASSIFICATION } from "@/lib/email-delivery-feedback";
import { COMMITTED_MIGRATIONS } from "@/lib/migration-manifest";
import {
  outreachPipelineChecks,
  outreachReplyBacklog,
  outreachSchemaChecks,
  pendingMigrationsCheck,
} from "@/lib/outreach-readiness";
import { replyContextBlocker } from "@/lib/outreach-reply-context";

const now = new Date("2026-09-10T12:00:00.000Z");
const baseDb = {
  $queryRaw: async () => COMMITTED_MIGRATIONS.map((migration_name) => ({ migration_name })),
  outreachCampaign: {
    findFirst: async () => null,
    findMany: async () => [],
  },
  outreachCampaignSend: {
    findFirst: async () => null,
    findMany: async () => [],
  },
  outreachCampaignReply: {
    findFirst: async () => null,
    findMany: async () => [],
  },
  emailThread: { findMany: async () => [] },
  emailAccount: { findMany: async () => [] },
};

async function main() {
  const applied = await pendingMigrationsCheck(baseDb);
  assert.equal(applied.ok, true);

const missing = await pendingMigrationsCheck({
  ...baseDb,
  $queryRaw: async () => COMMITTED_MIGRATIONS.slice(0, -1).map((migration_name) => ({ migration_name })),
});
assert.equal(missing.ok, false);
assert.match(missing.detail ?? "", /deployed code is ahead of the database/);

const permissionDenied = await pendingMigrationsCheck({
  ...baseDb,
  $queryRaw: async () => { throw new Error("permission denied for table _prisma_migrations"); },
});
assert.equal(permissionDenied.ok, false);
assert.equal(permissionDenied.detail, "app role cannot read _prisma_migrations, apply migration 20260907000100_grant_prisma_migrations_read via the production migration workflow");

assert.equal(replyContextBlocker("AUTO", null), "Auto-reply is on but the campaign has no reply context. Add pitch, offer, FAQs and limits, or set reply mode to OFF.");
assert.equal(replyContextBlocker("OFF", null), null);
assert.equal(replyContextBlocker("AUTO", { pitch: "A clear offer" }), null);

const pipeline = await outreachPipelineChecks({
  ...baseDb,
  outreachCampaign: {
    ...baseDb.outreachCampaign,
    findMany: async ({ where }: { where: { status: unknown } }) => {
      if (where.status === "ACTIVE") {
        return [{
          id: "stale",
          officeId: "office-1",
          lastRunAt: null,
          approvedAt: new Date("2026-09-01T00:00:00.000Z"),
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
        }];
      }
      return [{ id: "missing-context", officeId: "office-1", replyMode: "AUTO", replyContext: null }];
    },
  },
});
assert.equal(pipeline.find((check) => check.name === "outreach_campaign_cron")?.ok, false);
assert.equal(pipeline.find((check) => check.name === "outreach_auto_reply_context")?.ok, false);

const backlog = await outreachReplyBacklog({
  ...baseDb,
  outreachCampaignSend: {
    findFirst: async () => null,
    findMany: async () => [
      { id: "send-1", campaignId: "campaign-1", localThreadId: "thread-1", senderEmail: "sender@example.com" },
      { id: "send-2", campaignId: "campaign-2", localThreadId: "thread-2", senderEmail: "sender@example.com" },
    ],
  },
  emailAccount: { findMany: async () => [{ email: "sender@example.com" }] },
  emailThread: {
    findMany: async () => [
      {
        id: "thread-1",
        subject: "Hello",
        messages: [{
          id: "inbound-1",
          direction: "INBOUND",
          fromEmail: "lead@example.com",
          subject: null,
          bodyText: "A human reply",
          sentAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
          deliveryKind: null,
          classification: null,
        }],
      },
      {
        id: "thread-2",
        subject: "Hello",
        messages: [{
          id: "self-1",
          direction: "INBOUND",
          fromEmail: "sender@example.com",
          subject: null,
          bodyText: "Mailbox copy",
          sentAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
          deliveryKind: null,
          classification: null,
        }],
      },
    ],
  },
  outreachCampaignReply: {
    findFirst: async () => null,
    findMany: async () => [],
  },
}, now);
assert.equal(backlog.count, 1);
assert.equal(backlog.byCampaign.get("campaign-1"), 1);
assert.equal(backlog.byCampaign.has("campaign-2"), false);

const backlogDb = (
  messages: Record<string, unknown>[],
  replies: Array<{
    inboundMessageId: string;
    action: string;
    claimedAt?: Date | null;
    pendingAt?: Date | null;
  }> = [],
) => ({
  ...baseDb,
  outreachCampaignSend: {
    findFirst: async () => null,
    findMany: async () => [{
      id: "send-1",
      campaignId: "campaign-1",
      localThreadId: "thread-1",
      senderEmail: "sender@example.com",
    }],
  },
  emailAccount: { findMany: async () => [{ email: "connected@example.com" }] },
  emailThread: {
    findMany: async ({ select }: {
      select?: { messages?: { where?: { deliveryKind?: null; OR?: Array<{ classification?: null | { not?: string } }> } } };
    } = {}) => [{
      id: "thread-1",
      subject: "Hello",
      messages: (() => {
        const where = select.messages?.where;
        if (!where) return messages;
        assert.deepEqual(where.OR, [
          { classification: null },
          { classification: { not: DELIVERY_FEEDBACK_CLASSIFICATION } },
        ], "nested message filter must keep unclassified rows");
        return messages.filter((message) =>
          message.deliveryKind === where.deliveryKind
          && message.classification !== DELIVERY_FEEDBACK_CLASSIFICATION,
        );
      })(),
    }],
  },
  outreachCampaignReply: {
    findFirst: async () => null,
    findMany: async () => replies,
  },
});
const oldInbound = {
  id: "inbound-1",
  direction: "INBOUND",
  fromEmail: "lead@example.com",
  subject: null,
  bodyText: "A human reply",
  sentAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
  deliveryKind: null,
  classification: null,
};
const bounce = await outreachReplyBacklog(backlogDb([{
  ...oldInbound,
  deliveryKind: "BOUNCE",
}]), now);
assert.equal(bounce.count, 0);
const outboundLatest = await outreachReplyBacklog(backlogDb([{
  ...oldInbound,
  direction: "OUTBOUND",
}]), now);
assert.equal(outboundLatest.count, 0);
const connectedInbound = await outreachReplyBacklog(backlogDb([{
  ...oldInbound,
  fromEmail: "connected@example.com",
}]), now);
assert.equal(connectedInbound.count, 0);
const countedInbound = await outreachReplyBacklog(backlogDb([oldInbound]), now);
assert.equal(countedInbound.count, 1);
assert.equal(countedInbound.byCampaign.get("campaign-1"), 1);
const answeredInbound = await outreachReplyBacklog(backlogDb([oldInbound], [{
  inboundMessageId: "inbound-1",
  action: "SENT",
}]), now);
assert.equal(answeredInbound.count, 0);
const laterBounce = await outreachReplyBacklog(backlogDb([
  { ...oldInbound, deliveryKind: "BOUNCE", sentAt: new Date(now.getTime() - 60 * 60 * 1000) },
  oldInbound,
]), now);
assert.equal(laterBounce.count, 1);
const manyLaterBounces = await outreachReplyBacklog(backlogDb([
  ...Array.from({ length: 12 }, (_, index) => ({
    ...oldInbound,
    id: `bounce-${index}`,
    deliveryKind: "BOUNCE",
    sentAt: new Date(now.getTime() - (index + 1) * 10 * 60 * 1000),
  })),
  oldInbound,
]), now);
assert.equal(manyLaterBounces.count, 1);
const laterOutbound = await outreachReplyBacklog(backlogDb([
  { ...oldInbound, direction: "OUTBOUND", sentAt: new Date(now.getTime() - 60 * 60 * 1000) },
  oldInbound,
]), now);
assert.equal(laterOutbound.count, 0);
const escalated = await outreachReplyBacklog(backlogDb([oldInbound], [{
  inboundMessageId: "inbound-1",
  action: "ESCALATED",
}]), now);
assert.equal(escalated.count, 1);
const suppressed = await outreachReplyBacklog(backlogDb([oldInbound], [{
  inboundMessageId: "inbound-1",
  action: "SUPPRESSED",
}]), now);
assert.equal(suppressed.count, 0);
const freshClaimed = await outreachReplyBacklog(backlogDb([oldInbound], [{
  inboundMessageId: "inbound-1",
  action: "CLAIMED",
  claimedAt: new Date(now.getTime() - 10 * 60 * 1000),
}]), now);
assert.equal(freshClaimed.count, 0);
const staleClaimed = await outreachReplyBacklog(backlogDb([oldInbound], [{
  inboundMessageId: "inbound-1",
  action: "CLAIMED",
  claimedAt: new Date(now.getTime() - 31 * 60 * 1000),
}]), now);
assert.equal(staleClaimed.count, 1);

const throwing = await outreachSchemaChecks({
  ...baseDb,
  outreachCampaign: {
    ...baseDb.outreachCampaign,
    findFirst: async () => { throw new Error("missing column"); },
  },
});
assert.equal(throwing.find((check) => check.name === "outreach_campaign_schema")?.ok, false);
assert.equal(throwing.filter((check) => check.ok).length, 2);

  console.log("outreach readiness checks verified");
}

void main();
