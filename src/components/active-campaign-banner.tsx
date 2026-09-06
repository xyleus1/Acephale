import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listCampaignSummaries } from "@/lib/outreach-campaigns";
import { isSchemaNotReadyError, OUTREACH_SCHEMA_NOT_READY_MESSAGE } from "@/lib/outreach-readiness";
import { ActiveCampaignControls } from "@/components/active-campaign-controls";
import styles from "./active-campaign-banner.module.css";

export async function ActiveCampaignBanner() {
  const session = await requireSession();
  if (session.accessKind === "customer" || session.role === "EMPLOYEE") return null;
  let campaigns;
  try {
    campaigns = await listCampaignSummaries(session.officeId, ["ACTIVE", "PAUSED"]);
  } catch (error) {
    if (!isSchemaNotReadyError(error)) throw error;
    return (
      <section className={styles.banner} aria-label="Outreach campaigns">
        <div className={styles.heading}>Outreach campaigns</div>
        <div className={styles.value}>{OUTREACH_SCHEMA_NOT_READY_MESSAGE}</div>
      </section>
    );
  }
  if (campaigns.length === 0) return null;

  return (
    <section className={styles.banner} aria-label="Outreach campaigns">
      <div className={styles.heading}>Outreach campaigns</div>
      {campaigns.map((campaign) => (
        <div className={`${styles.row} ${campaign.status === "PAUSED" ? styles.paused : ""}`} key={campaign.id}>
          <div>
            <div className={styles.label}>Campaign</div>
            <div className={styles.value}>
              <Link
                href={campaign.list.projectId
                  ? `/dashboard/supply-os?materialsView=projects&project=prospecting:${campaign.list.projectId}${campaign.list.workspaceId ? `&workspace=${encodeURIComponent(campaign.list.workspaceId)}` : ""}`
                  : "/dashboard/supply-os?materialsView=projects"}
              >
                {campaign.name}
              </Link>
            </div>
          </div>
          <div>
            <div className={styles.label}>Status</div>
            <div className={styles.value}>{campaign.status.toLowerCase()}</div>
          </div>
          <div>
            <div className={styles.label}>List</div>
            <div className={styles.value}>
              <Link href={`/dashboard/research/${campaign.list.slug}`}>{campaign.list.name}</Link>
            </div>
          </div>
          <div>
            <div className={styles.label}>Sender</div>
            <div className={styles.value}>
              {campaign.senderRotation
                ? `Rotating across ${campaign.mailboxesAvailable} mailboxes, ${campaign.poolCapacityToday} sends available today`
                : campaign.senderEmail ?? "no mailbox connected"}
            </div>
          </div>
          <div>
            <div className={styles.label}>Auto-reply</div>
            <div className={styles.value}>
              {campaign.replyMode.toLowerCase()}, answered {campaign.autoReplies.sent}, needs you {campaign.autoReplies.escalated}
            </div>
            {campaign.autoReplyEscalations.length > 0 ? (
              <div className={styles.value}>
                {campaign.autoReplyEscalations.slice(0, 3).map((reply) => (
                  <div key={reply.threadId}>
                    {reply.intent.toLowerCase()} · {reply.reason ?? "needs review"}{reply.draft ? ` · ${reply.draft.slice(0, 120)}` : ""}
                    {" "}
                    <Link href={`/dashboard/supply-os?materialsView=messages&projectTab=messages${campaign.list.projectId ? `&project=prospecting:${campaign.list.projectId}` : ""}${campaign.list.workspaceId ? `&workspace=${encodeURIComponent(campaign.list.workspaceId)}` : ""}&threadId=${encodeURIComponent(reply.threadId)}`}>
                      Open thread
                    </Link>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <div className={styles.label}>Delivery</div>
            <div className={`${styles.value} ${styles.count}`}>
              {campaign.sent} / {campaign.total}, today {campaign.sentToday} / {campaign.dailyCap}
              <br />
              rejected {campaign.rejected}, replies {campaign.replies}
              {campaign.variants.length > 0 ? (
                <>
                  <br />
                  {campaign.variants.map((variant, index) => (
                    <span key={variant.key}>
                      {index > 0 ? " · " : ""}
                      {variant.key} {variant.sent} sent, {variant.replies} replies
                    </span>
                  ))}
                </>
              ) : null}
              <br />
              last attempt {campaign.lastRunAt ? campaign.lastRunAt.toLocaleString() : "not attempted"}
            </div>
            <ActiveCampaignControls
              campaignId={campaign.id}
              status={campaign.status === "PAUSED" ? "PAUSED" : "ACTIVE"}
              className={styles.controls}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
