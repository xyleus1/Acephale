import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/auth";
import { customerPortalWorkspaceHref } from "@/lib/customer-portal-navigation";
import { prisma } from "@/lib/prisma";
import { SettingsHeader } from "../settings/settings-header";
import settingsStyles from "../settings/integrations/integrations-settings.module.css";
import {
  archiveCustomerCompany,
  createCustomerCompany,
  grantCustomerPortalAccess,
  reviewCustomerPortalAction,
  updateCustomerCompany,
  updateCustomerPortalAccount,
  updateCustomerPortalMembership,
} from "./actions";
import styles from "./customer-portal-admin.module.css";

export const metadata = { title: "Customer management" };

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

function roleLabel(role: string) {
  if (role === "ADMIN") return "Customer admin";
  if (role === "VIEWER") return "Viewer";
  return "Member";
}

const NOTICE_TEXT: Record<string, string> = {
  "account-updated": "Customer account updated.",
  "access-updated": "Company access updated.",
  "company-created": "Company created.",
  "company-updated": "Company updated.",
  "company-archived": "Company archived and customer access revoked.",
  "confirm-company-archive": "Confirm the archive before deleting the company.",
  "invalid-account": "Enter a valid customer email.",
  "invalid-access": "Choose a valid role and access status.",
  "invalid-company": "Enter a valid company name and public website.",
  "company-conflict": "Another active or archived company already uses that name or website.",
  "company-not-found": "Company workspace was not found.",
  "company-error": "Company could not be changed.",
  "account-not-found": "Customer account was not found.",
  "access-not-found": "Company access was not found.",
  "archived-company-access": "Archived companies cannot receive customer access.",
  "email-in-use": "That email already belongs to another customer account.",
};

export default async function CustomerPortalAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "MANAGER") redirect("/dashboard");
  const query = await searchParams;
  const isAdmin = session.role === "ADMIN";

  const [companyRows, customerAccounts, customerActions] = await Promise.all([
    prisma.company.findMany({
      where: {
        officeId: session.officeId,
        crmStage: { not: "archived" },
        supplyWorkspaces: {
          some: { officeId: session.officeId, status: "ACTIVE" },
        },
      },
      select: {
        id: true,
        name: true,
        website: true,
        _count: { select: { jobs: true, inquiries: true } },
        supplyWorkspaces: {
          where: { officeId: session.officeId, status: "ACTIVE" },
          select: { id: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        customerPortalMemberships: {
          where: { officeId: session.officeId },
          select: {
            id: true,
            role: true,
            isActive: true,
            user: {
              select: { id: true, email: true, fullName: true, isActive: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { name: "asc" },
      take: 300,
    }),
    prisma.customerPortalUser.findMany({
      where: {
        officeId: session.officeId,
        memberships: { some: { officeId: session.officeId } },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        memberships: {
          where: { officeId: session.officeId },
          select: {
            id: true,
            role: true,
            isActive: true,
            company: {
              select: {
                id: true,
                name: true,
                crmStage: true,
                supplyWorkspaces: {
                  where: { officeId: session.officeId, status: "ACTIVE" },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
          orderBy: { company: { name: "asc" } },
        },
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

  const companies = companyRows.flatMap((company) => {
    const workspace = company.supplyWorkspaces[0];
    return workspace ? [{ ...company, workspaceId: workspace.id }] : [];
  });
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const portalUrl = `${baseUrl}/portal`;
  const previewCompany = companies.find((company) => company._count.jobs > 0) ?? companies[0];
  const activeMembershipCount = customerAccounts.reduce(
    (count, account) => count + (account.isActive
      ? account.memberships.filter((membership) => (
        membership.isActive
        && membership.company.crmStage !== "archived"
        && membership.company.supplyWorkspaces.length > 0
      )).length
      : 0),
    0,
  );

  return (
    <main className={settingsStyles.page}>
      <SettingsHeader active="customers" isAdmin={isAdmin} />

      <div className={styles.page}>
        {query.notice && NOTICE_TEXT[query.notice] ? (
          <div className={styles.notice} role="status">{NOTICE_TEXT[query.notice]}</div>
        ) : null}

        <section className={styles.passwordlessNote}>
          <strong>Passwordless customer login</strong>
          <span>No password exists to view or reset. Customers receive a six-digit code at their approved email.</span>
        </section>

        <section className={`${styles.card} ${styles.previewCard}`}>
          <div className={styles.previewCopy}>
            <h2>Customer preview</h2>
            <p>Customer actions are disabled in preview.</p>
          </div>
          {previewCompany ? (
            <form className={styles.previewForm} action="/portal/workspace" method="get" target="_blank">
              <input type="hidden" name="preview" value="1" />
              <label htmlFor="preview-company">Company</label>
              <select className={styles.select} id="preview-company" name="company" required defaultValue={previewCompany.id}>
                {companies.map((company) => (
                  <option value={company.id} key={company.id}>
                    {company.name} ({company._count.jobs} loads, {company._count.inquiries} RFQs)
                  </option>
                ))}
              </select>
              <button className="btn" type="submit">View as customer</button>
            </form>
          ) : (
            <div className={styles.previewEmpty}>Create a company before opening a customer preview.</div>
          )}
        </section>

        <section className={styles.card}>
          <header className={styles.cardHeader}>
            <h2>Companies</h2>
            <span className={styles.count}>{companies.length}</span>
          </header>
          {isAdmin ? (
            <form className={styles.companyCreateForm} action={createCustomerCompany}>
              <label className={styles.field}>
                <span>Company name</span>
                <input className={styles.input} name="name" minLength={2} maxLength={160} required />
              </label>
              <label className={styles.field}>
                <span>Website</span>
                <input className={styles.input} name="website" type="url" maxLength={500} placeholder="https://customer.com" />
              </label>
              <SubmitButton className="btn" pendingLabel="Adding...">Add company</SubmitButton>
            </form>
          ) : null}
          <div className={styles.companyRows}>
            {companies.map((company) => {
              const activeAccounts = company.customerPortalMemberships.filter(
                (membership) => membership.isActive && membership.user.isActive,
              );
              return (
                <section className={styles.company} key={company.id}>
                  <header className={styles.companyHeader}>
                    <div>
                      <div className={styles.rowTitle}>{company.name}</div>
                      <div className={styles.rowMeta}>{company.website || "No website"}</div>
                      <div className={styles.rowMeta}>
                        {activeAccounts.length} active account{activeAccounts.length === 1 ? "" : "s"}, {company._count.jobs} loads, {company._count.inquiries} RFQs
                      </div>
                    </div>
                    <div className={styles.companyTools}>
                      {isAdmin ? (
                        <details className={styles.editorInline}>
                          <summary>Edit</summary>
                          <form className={styles.companyForm} action={updateCustomerCompany.bind(null, company.workspaceId)}>
                            <label className={styles.field}>
                              <span>Company name</span>
                              <input className={styles.input} name="name" defaultValue={company.name} minLength={2} maxLength={160} required />
                            </label>
                            <label className={styles.field}>
                              <span>Website</span>
                              <input className={styles.input} name="website" type="url" defaultValue={company.website ?? ""} maxLength={500} />
                            </label>
                            <SubmitButton className="btn btn-sm" pendingLabel="Saving...">Save company</SubmitButton>
                          </form>
                        </details>
                      ) : null}
                      <details className={styles.editorInline}>
                        <summary>Add account</summary>
                        <form className={styles.companyAccountForm} action={grantCustomerPortalAccess}>
                          <input type="hidden" name="companyId" value={company.id} />
                          <label className={styles.field}>
                            <span>Name</span>
                            <input className={styles.input} name="fullName" autoComplete="name" />
                          </label>
                          <label className={styles.field}>
                            <span>Email</span>
                            <input className={styles.input} name="email" type="email" autoComplete="email" required />
                          </label>
                          <label className={styles.field}>
                            <span>Access</span>
                            <select className={styles.select} name="role" defaultValue="MEMBER">
                              <option value="MEMBER">Member</option>
                              <option value="VIEWER">Viewer</option>
                              <option value="ADMIN">Customer admin</option>
                            </select>
                          </label>
                          <SubmitButton className="btn btn-sm" pendingLabel="Adding...">Add account</SubmitButton>
                        </form>
                      </details>
                      {isAdmin ? (
                        <details className={`${styles.editorInline} ${styles.dangerEditor}`}>
                          <summary>Delete</summary>
                          <form className={styles.archiveForm} action={archiveCustomerCompany.bind(null, company.workspaceId)}>
                            <p>This archives the company, removes it from the dashboard, and revokes customer access. Freight history stays in the database.</p>
                            <label className={styles.confirmField}>
                              <input type="checkbox" name="confirmArchive" value="ARCHIVE" required />
                              Confirm archive
                            </label>
                            <SubmitButton className="btn btn-sm" pendingLabel="Deleting...">Delete company</SubmitButton>
                          </form>
                        </details>
                      ) : null}
                    </div>
                  </header>
                  <div className={styles.companyAccounts}>
                    {company.customerPortalMemberships.length > 0 ? company.customerPortalMemberships.map((membership) => (
                      <div className={styles.companyAccount} key={membership.id}>
                        <span>{membership.user.fullName ?? membership.user.email}</span>
                        <small>{membership.user.email}</small>
                        <small>{membership.user.isActive && membership.isActive ? roleLabel(membership.role) : "Disabled"}</small>
                      </div>
                    )) : <div className={styles.emptyCompact}>No customer accounts.</div>}
                  </div>
                </section>
              );
            })}
            {companies.length === 0 ? <div className={styles.empty}>No companies yet.</div> : null}
          </div>
        </section>

        <section className={styles.card}>
          <header className={styles.cardHeader}>
            <h2>Customer accounts</h2>
            <span className={styles.count}>{customerAccounts.length} accounts, {activeMembershipCount} active access</span>
          </header>
          <div className={styles.inviteHint}>
            Customer sign-in: <a href={portalUrl} target="_blank" rel="noreferrer">{portalUrl || "/portal"}</a>. Codes only go to active accounts with active company access.
          </div>
          <div className={styles.accounts}>
            {customerAccounts.length > 0 ? customerAccounts.map((account) => (
              <section className={styles.account} key={account.id}>
                <div className={styles.accountHeader}>
                  <div>
                    <div className={styles.rowTitle}>{account.fullName ?? account.email}</div>
                    <div className={styles.rowMeta}>{account.email}</div>
                    <div className={styles.rowMeta}>
                      {account.lastLoginAt ? `Last sign-in ${fmtDate(account.lastLoginAt)}` : "Has not signed in"}
                    </div>
                  </div>
                  <div className={styles.accountActions}>
                    <span className={styles.badge}>{account.isActive ? "Active" : "Disabled"}</span>
                    {account.isActive && account.memberships.some((membership) => (
                      membership.isActive
                      && membership.company.crmStage !== "archived"
                      && membership.company.supplyWorkspaces.length > 0
                    )) ? (
                      <a
                        className="btn btn-secondary btn-sm"
                        href={`/portal?office=${encodeURIComponent(session.officeId)}&email=${encodeURIComponent(account.email)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Customer sign-in
                      </a>
                    ) : null}
                  </div>
                </div>

                <details className={styles.editor}>
                  <summary>Edit account</summary>
                  <form className={styles.accountForm} action={updateCustomerPortalAccount.bind(null, account.id)}>
                    <label className={styles.field}>
                      <span>Customer name</span>
                      <input className={styles.input} name="fullName" defaultValue={account.fullName ?? ""} autoComplete="name" />
                    </label>
                    <label className={styles.field}>
                      <span>Email</span>
                      <input className={styles.input} name="email" type="email" defaultValue={account.email} autoComplete="email" required />
                    </label>
                    <label className={styles.field}>
                      <span>Account status</span>
                      <select className={styles.select} name="accountStatus" defaultValue={account.isActive ? "ACTIVE" : "DISABLED"}>
                        <option value="ACTIVE">Active</option>
                        <option value="DISABLED">Disabled</option>
                      </select>
                    </label>
                    <SubmitButton className="btn btn-sm" pendingLabel="Saving...">Save account</SubmitButton>
                  </form>
                </details>

                <div className={styles.accessList}>
                  <div className={styles.accessHeading}>Company access</div>
                  {account.memberships.map((membership) => {
                    const companyIsActive = membership.company.crmStage !== "archived"
                      && membership.company.supplyWorkspaces.length > 0;
                    return (
                      <form
                        className={styles.accessRow}
                        action={updateCustomerPortalMembership.bind(null, membership.id)}
                        key={membership.id}
                      >
                      <div>
                        <div className={styles.rowTitle}>{membership.company.name}</div>
                        <div className={styles.rowMeta}>
                          {!companyIsActive
                            ? "Company archived"
                            : membership.isActive
                              ? roleLabel(membership.role)
                              : "Access disabled"}
                        </div>
                      </div>
                      {companyIsActive ? (
                        <>
                          <label className={styles.compactField}>
                            <span>Role</span>
                            <select className={styles.select} name="role" defaultValue={membership.role}>
                              <option value="MEMBER">Member</option>
                              <option value="VIEWER">Viewer</option>
                              <option value="ADMIN">Customer admin</option>
                            </select>
                          </label>
                          <label className={styles.compactField}>
                            <span>Access</span>
                            <select className={styles.select} name="accessStatus" defaultValue={membership.isActive ? "ACTIVE" : "DISABLED"}>
                              <option value="ACTIVE">Active</option>
                              <option value="DISABLED">Disabled</option>
                            </select>
                          </label>
                          <div className={styles.actions}>
                            <a
                              className="btn btn-secondary btn-sm"
                              href={customerPortalWorkspaceHref(membership.company.id, true)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Preview
                            </a>
                            <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Saving...">Save access</SubmitButton>
                          </div>
                        </>
                      ) : <div className={styles.rowMeta}>Access is permanently revoked.</div>}
                      </form>
                    );
                  })}
                </div>
              </section>
            )) : <div className={styles.empty}>No customer accounts yet.</div>}
          </div>
        </section>

        <div className={styles.grid}>
          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <h2>Customer action queue</h2>
              <span className={styles.count}>{customerActions.length} open</span>
            </header>
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
                    {action.status === "PENDING" ? (
                      <form action={reviewCustomerPortalAction.bind(null, action.id, "ACKNOWLEDGED")}>
                        <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="...">Acknowledge</SubmitButton>
                      </form>
                    ) : null}
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
          </section>

          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <h2>Customer permissions</h2>
            </header>
            <div className={styles.inviteHint}>
              Customers can view shipment status and approved documents, upload requested files, reply to quotes, and submit scoped procurement requests. Derya staff still control supplier contact, pricing, bookings, publication, and spend.
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
