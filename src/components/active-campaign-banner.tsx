import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listCampaignSummaries } from "@/lib/outreach-campaigns";
import { ActiveCampaignControls } from "@/components/active-campaign-controls";
import styles from "./active-campaign-banner.module.css";

export async function ActiveCampaignBanner() {
  const session = await requireSession();
  if (session.accessKind === "customer" || session.role === "EMPLOYEE") return null;
  const campaigns = await listCampaignSummaries(session.officeId, ["ACTIVE", "PAUSED"]);
  if (campaigns.length === 0) return null;

  return (
    <section className={styles.banner} aria-label="Outreach campaigns">
      <div className={styles.heading}>Outreach campaigns</div>
      {campaigns.map((campaign) => (
        <div className={`${styles.row} ${campaign.status === "PAUSED" ? styles.paused : ""}`} key={campaign.id}>
          <div>
            <div className={styles.label}>Campaign</div>
            <div className={styles.value}>
              <Link href="/dashboard/supply-os?materialsView=outreach">{campaign.name}</Link>
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
            <div className={styles.value}>{campaign.senderEmail ?? "no mailbox connected"}</div>
          </div>
          <div>
            <div className={styles.label}>Delivery</div>
            <div className={`${styles.value} ${styles.count}`}>
              {campaign.sent} / {campaign.total}, today {campaign.sentToday} / {campaign.dailyCap}
              <br />
              rejected {campaign.rejected}, replies {campaign.replies}
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
