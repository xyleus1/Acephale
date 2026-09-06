import assert from "node:assert/strict";
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
  emailMessage: { findMany: async () => [] },
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
      { campaignId: "campaign-1", localThreadId: "thread-1" },
      { campaignId: "campaign-2", localThreadId: "thread-2" },
    ],
  },
  emailAccount: { findMany: async () => [{ email: "sender@example.com" }] },
  emailMessage: {
    findMany: async () => [
      { id: "inbound-1", threadId: "thread-1", fromEmail: "lead@example.com" },
      { id: "self-1", threadId: "thread-2", fromEmail: "sender@example.com" },
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
