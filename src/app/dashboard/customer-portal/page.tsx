import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  grantCustomerPortalAccess,
  reviewCustomerPortalAction,
  revokeCustomerPortalAccess,
} from "./actions";
import styles from "./customer-portal-admin.module.css";

export const metadata = { title: "Customer Portal" };

function fmtDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function actionLabel(type: string) {
  if (type === "QUOTE_ACCEPTED") return "Quote accepted";
  if (type === "QUOTE_CHANGES_REQUESTED") return "Quote changes requested";
  if (type === "DOCUMENT_UPLOADED") return "Document uploaded";
  return type.replaceAll("_", " ").toLowerCase();
}

export default async function CustomerPortalAdminPage() {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "MANAGER") redirect("/dashboard");

  const [companies, memberships, customerActions] = await Promise.all([
    prisma.company.findMany({
      where: { officeId: session.officeId },
      select: {
        id: true,
        name: true,
        _count: { select: { jobs: true, inquiries: true } },
      },
      orderBy: { name: "asc" },
      take: 300,
    }),
    prisma.customerPortalMembership.findMany({
      where: { officeId: session.officeId, isActive: true },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            email: true,
            fullName: true,
            lastLoginAt: true,
          },
        },
        company: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.customerPortalAction.findMany({
      where: {
        officeId: session.officeId,
        status: { in: ["PENDING", "ACKNOWLEDGED"] },
      },
      select: {
        id: true,
        type: true,
        status: true,
        message: true,
        createdAt: true,
        company: { select: { name: true } },
        job: { select: { id: true, reference: true } },
        portalUser: { select: { email: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>External access control</div>
          <h1 className={styles.title}>Customer Portal</h1>
          <p className={styles.copy}>
            Grant company-scoped access, review customer responses, and control what leaves the operating system. Portal actions never book freight or advance a load automatically.
          </p>
        </div>
        <a className={`btn btn-secondary ${styles.portalLink}`} href="/portal" target="_blank" rel="noreferrer">
          Open sign-in page
        </a>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Grant customer access</h2>
          <span className={styles.count}>{memberships.length} active memberships</span>
        </div>
        <form className={styles.form} action={grantCustomerPortalAccess}>
          <select className={styles.select} name="companyId" required defaultValue="">
            <option value="" disabled>Choose company</option>
            {companies.map((company) => (
              <option value={company.id} key={company.id}>
                {company.name} ({company._count.jobs} loads, {company._count.inquiries} RFQs)
              </option>
            ))}
          </select>
          <input className={styles.input} name="fullName" placeholder="Customer name" />
          <input className={styles.input} name="email" type="email" placeholder="name@customer.com" required />
          <select className={styles.select} name="role" defaultValue="MEMBER">
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer</option>
            <option value="ADMIN">Customer admin</option>
          </select>
          <SubmitButton className="btn" pendingLabel="Granting...">Grant access</SubmitButton>
        </form>
        <div className={styles.inviteHint}>
          Access is passwordless. Send the customer {baseUrl || "your deployed app URL"}/portal and the sign-in email address. The code is delivered only to an active portal member.
        </div>
        <div className={styles.rows}>
          {memberships.length > 0 ? memberships.map((membership) => (
            <div className={styles.row} key={membership.id}>
              <div>
                <div className={styles.rowTitle}>{membership.user.fullName ?? membership.user.email}</div>
                <div className={styles.rowMeta}>{membership.user.email}</div>
              </div>
              <div>
                <div className={styles.rowTitle}>{membership.company.name}</div>
                <div className={styles.rowMeta}>
                  {membership.user.lastLoginAt ? `Last sign-in ${fmtDate(membership.user.lastLoginAt)}` : "Has not signed in"}
                </div>
                <span className={styles.badge}>{membership.role}</span>
              </div>
              <div className={styles.actions}>
                <a
                  className="btn btn-secondary btn-sm"
                  href={`/portal?office=${encodeURIComponent(session.officeId)}&email=${encodeURIComponent(membership.user.email)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Sign-in link
                </a>
                <form action={revokeCustomerPortalAccess.bind(null, membership.id)}>
                  <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Revoking...">Revoke</SubmitButton>
                </form>
              </div>
            </div>
          )) : <div className={styles.empty}>No customers have portal access yet.</div>}
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Customer action queue</h2>
            <span className={styles.count}>{customerActions.length} open</span>
          </div>
          <div className={styles.rows}>
            {customerActions.length > 0 ? customerActions.map((action) => (
              <div className={styles.row} key={action.id}>
                <div>
                  <div className={styles.rowTitle}>{actionLabel(action.type)}</div>
                  <div className={styles.rowMeta}>
                    {action.portalUser.fullName ?? action.portalUser.email} at {action.company.name}
                    {action.message ? `: ${action.message}` : ""}
                  </div>
                </div>
                <div>
                  {action.job ? (
                    <a className={styles.rowTitle} href={`/dashboard/jobs/${action.job.id}`}>
                      {action.job.reference}
                    </a>
                  ) : <span className={styles.rowTitle}>Company-level action</span>}
                  <div className={styles.rowMeta}>{fmtDate(action.createdAt)}</div>
                  <span className={styles.badge}>{action.status}</span>
                </div>
                <div className={styles.actions}>
                  {action.status === "PENDING" && (
                    <form action={reviewCustomerPortalAction.bind(null, action.id, "ACKNOWLEDGED")}>
                      <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="...">Acknowledge</SubmitButton>
                    </form>
                  )}
                  <form action={reviewCustomerPortalAction.bind(null, action.id, "RESOLVED")}>
                    <SubmitButton className="btn btn-sm" pendingLabel="...">Resolve</SubmitButton>
                  </form>
                  <form action={reviewCustomerPortalAction.bind(null, action.id, "REJECTED")}>
                    <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="...">Reject</SubmitButton>
                  </form>
                </div>
              </div>
            )) : <div className={styles.empty}>No customer actions need review.</div>}
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Operating contract</h2>
          </div>
          <div className={styles.inviteHint}>
            Email starts the conversation. The portal holds shared state and low-risk customer actions. Derya operators remain responsible for pricing approval, booking, document publication, exceptions, and shipment status.
          </div>
        </div>
      </div>
    </div>
  );
}
