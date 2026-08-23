import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { requireSession } from "@/lib/auth";
import { decryptCustomerPassword } from "@/lib/customer-password-vault";
import { customerContactEmail, isRemovedCustomerUsername } from "@/lib/customer-portal-account";
import { resolveCustomerManagementOperator } from "@/lib/customer-portal-admin-auth";
import { prisma } from "@/lib/prisma";
import { SettingsHeader } from "../settings/settings-header";
import settingsStyles from "../settings/integrations/integrations-settings.module.css";
import {
  archiveCustomerCompany,
  createCustomerCompany,
  grantCustomerPortalAccess,
  removeCustomerPortalAccount,
  reviewCustomerPortalAction,
  updateCustomerCompany,
  updateCustomerPortalAccount,
  updateCustomerPortalMembership,
} from "./actions";
import { CustomerPasswordField } from "./customer-password-field";
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
  "account-created": "Customer account created.",
  "account-created-no-password": "Customer account created. Set a password before sign-in.",
  "account-removed": "Customer user removed. Sign-in and company access are disabled.",
  "account-exists": "That username or email already has a customer account. Edit the existing account instead.",
  "account-updated": "Customer account updated.",
  "access-updated": "Company access updated.",
  "company-created": "Company created.",
  "company-updated": "Company updated.",
  "company-archived": "Company archived and customer access revoked.",
  "confirm-company-archive": "Confirm the archive before deleting the company.",
  "confirm-account-remove": "Confirm removal before deleting the customer user.",
  "invalid-account": "Enter a valid username and contact email, or leave the contact email blank.",
  "invalid-password": "Password must contain 12 to 128 characters.",
  "invalid-access": "Choose a valid role and access status.",
  "invalid-company": "Enter a valid company name and public website.",
  "company-conflict": "Another active or archived company already uses that name or website.",
  "company-not-found": "Company workspace was not found.",
  "company-error": "Company could not be changed.",
  "account-not-found": "Customer account was not found.",
  "access-not-found": "Company access was not found.",
  "archived-company-access": "Archived companies cannot receive customer access.",
  "account-in-use": "That username or email belongs to another customer account.",
};

export default async function CustomerPortalAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; company?: string }>;
}) {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "MANAGER") redirect("/dashboard");
  const query = await searchParams;
  const currentOperator = await resolveCustomerManagementOperator(session, ["ADMIN", "MANAGER"]);
  if (!currentOperator) redirect("/dashboard");
  const isAdmin = currentOperator.role === "ADMIN";

  const [companyRows, customerActions] = await Promise.all([
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
              select: {
                id: true,
                username: true,
                email: true,
                fullName: true,
                isActive: true,
                lastLoginAt: true,
                passwordUpdatedAt: true,
                passwordEncrypted: true,
                lockedUntil: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { name: "asc" },
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
  const activeCompanyId = companies.some((company) => company.id === query.company)
    ? query.company
    : companies[0]?.id;

  return (
    <main className={settingsStyles.page}>
      <SettingsHeader active="customers" isAdmin={isAdmin} />

      <div className={styles.page}>
        {query.notice && NOTICE_TEXT[query.notice] ? (
          <div className={styles.notice} role="status">{NOTICE_TEXT[query.notice]}</div>
        ) : null}

        <section className={styles.passwordNote}>
          <strong>{isAdmin ? "Admin account" : "Staff account"}</strong>
          <span>{currentOperator.email}</span>
          <span>Customer users below are separate accounts limited to their company.</span>
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
              const memberships = company.customerPortalMemberships.filter(
                (membership) => !isRemovedCustomerUsername(membership.user.username),
              );
              const activeAccounts = memberships.filter(
                (membership) => membership.isActive && membership.user.isActive,
              );
              return (
                <details className={styles.company} key={company.id} open={company.id === activeCompanyId}>
                  <summary className={styles.companySummary}>
                    <div>
                      <div className={styles.rowTitle}>{company.name}</div>
                      <div className={styles.rowMeta}>{company.website || "No website"}</div>
                    </div>
                    <span>{activeAccounts.length} active user{activeAccounts.length === 1 ? "" : "s"}, {company._count.jobs} loads, {company._count.inquiries} RFQs</span>
                  </summary>

                  <div className={styles.companyBody}>
                    <div className={styles.companyTools}>
                      <a
                        className="btn btn-secondary btn-sm"
                        href={`/dashboard/supply-os?previewWorkspace=${encodeURIComponent(company.workspaceId)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Preview
                      </a>
                      {isAdmin ? (
                        <details className={styles.editorInline}>
                          <summary>Edit company</summary>
                          <form className={styles.companyForm} action={updateCustomerCompany.bind(null, company.workspaceId)}>
                            <input type="hidden" name="companyId" value={company.id} />
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
                      {isAdmin ? <details className={styles.editorInline}>
                        <summary>Add user</summary>
                        <form className={styles.companyAccountForm} action={grantCustomerPortalAccess}>
                          <input type="hidden" name="companyId" value={company.id} />
                          <label className={styles.field}>
                            <span>Display name</span>
                            <input className={styles.input} name="fullName" defaultValue={company.name} autoComplete="name" />
                          </label>
                          <label className={styles.field}>
                            <span>Contact email (optional)</span>
                            <input className={styles.input} name="email" type="email" autoComplete="email" />
                          </label>
                          <label className={styles.field}>
                            <span>Username</span>
                            <input className={styles.input} name="username" minLength={3} maxLength={80} autoComplete="username" required />
                          </label>
                          <label className={styles.field}>
                            <span>Access</span>
                            <select className={styles.select} name="role" defaultValue="MEMBER">
                              <option value="MEMBER">Member</option>
                              <option value="VIEWER">Viewer</option>
                              <option value="ADMIN">Customer admin</option>
                            </select>
                          </label>
                          <div className={styles.passwordSaveRow}>
                            <CustomerPasswordField
                              label="Password"
                              help="Optional. Without a password, this user cannot sign in."
                            />
                            <SubmitButton className="btn btn-sm" pendingLabel="Adding...">Add user</SubmitButton>
                          </div>
                        </form>
                      </details> : null}
                      {isAdmin ? (
                        <details className={`${styles.editorInline} ${styles.dangerEditor}`}>
                          <summary>Delete</summary>
                          <form className={styles.archiveForm} action={archiveCustomerCompany.bind(null, company.workspaceId)}>
                            <input type="hidden" name="companyId" value={company.id} />
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
                    <section className={styles.companyUsers}>
                      <header className={styles.usersHeader}>
                        <h3>Users</h3>
                        <span>{memberships.length}</span>
                      </header>
                      {memberships.length > 0 ? memberships.map((membership) => {
                        const account = membership.user;
                        const password = isAdmin ? decryptCustomerPassword(account.passwordEncrypted) : null;
                        const passwordLabel = isAdmin ? password || "Not set" : "Hidden";
                        const contactEmail = customerContactEmail(account.email);
                        const accountActive = account.isActive && membership.isActive;
                        return (
                          <article className={styles.account} key={membership.id}>
                            <header className={styles.accountHeader}>
                              <div>
                                <div className={styles.rowTitle}>{account.fullName || company.name}</div>
                                <div className={styles.accountCredentials}>
                                  <span><strong>Username</strong> {account.username || "Not set"}</span>
                                  <span><strong>Password</strong> <code>{passwordLabel}</code></span>
                                  {contactEmail ? <span><strong>Contact</strong> {contactEmail}</span> : null}
                                </div>
                                <div className={styles.rowMeta}>
                                  {account.lastLoginAt ? `Last sign-in ${fmtDate(account.lastLoginAt)}` : "Has not signed in"}
                                  {account.lockedUntil && account.lockedUntil > new Date()
                                    ? `, locked until ${fmtDate(account.lockedUntil)}`
                                    : ""}
                                </div>
                              </div>
                              <div className={styles.accountActions}>
                                <span className={styles.badge}>{accountActive ? roleLabel(membership.role) : "Disabled"}</span>
                                {account.username && password && accountActive ? (
                                  <a
                                    className="btn btn-secondary btn-sm"
                                    href={`/portal?office=${encodeURIComponent(session.officeId)}&username=${encodeURIComponent(account.username)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Sign in
                                  </a>
                                ) : null}
                              </div>
                            </header>

                            {isAdmin ? (
                              <div className={styles.userControls}>
                                <details className={styles.editor} open={!password}>
                                  <summary>Edit user</summary>
                                  <form
                                    className={styles.accountForm}
                                    action={updateCustomerPortalAccount.bind(null, account.id, company.id)}
                                  >
                                    <label className={styles.field}>
                                      <span>Display name</span>
                                      <input className={styles.input} name="fullName" defaultValue={account.fullName || company.name} autoComplete="name" />
                                    </label>
                                    <label className={styles.field}>
                                      <span>Contact email (optional)</span>
                                      <input className={styles.input} name="email" type="email" defaultValue={contactEmail} autoComplete="email" />
                                    </label>
                                    <label className={styles.field}>
                                      <span>Username</span>
                                      <input className={styles.input} name="username" defaultValue={account.username ?? ""} minLength={3} maxLength={80} autoComplete="username" required />
                                    </label>
                                    <label className={styles.field}>
                                      <span>Status</span>
                                      <select className={styles.select} name="accountStatus" defaultValue={account.isActive ? "ACTIVE" : "DISABLED"}>
                                        <option value="ACTIVE">Active</option>
                                        <option value="DISABLED">Disabled</option>
                                      </select>
                                    </label>
                                    <div className={styles.passwordSaveRow}>
                                      <CustomerPasswordField label="New password (optional)" />
                                      <SubmitButton className="btn btn-sm" pendingLabel="Saving...">Save user</SubmitButton>
                                    </div>
                                  </form>
                                </details>

                                <form className={styles.accessControls} action={updateCustomerPortalMembership.bind(null, membership.id)}>
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
                                  <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Saving...">Save access</SubmitButton>
                                </form>

                                <details className={`${styles.editorInline} ${styles.dangerEditor}`}>
                                  <summary>Delete user</summary>
                                  <form
                                    className={styles.removeUserForm}
                                    action={removeCustomerPortalAccount.bind(null, account.id, company.id)}
                                  >
                                    <p>This deletes the user from every company, disables sign-in, and keeps audit history.</p>
                                    <label className={styles.confirmField}>
                                      <input type="checkbox" name="confirmRemove" value="REMOVE" required />
                                      Confirm removal
                                    </label>
                                    <SubmitButton className="btn btn-sm" pendingLabel="Deleting...">Delete user</SubmitButton>
                                  </form>
                                </details>
                              </div>
                            ) : null}
                          </article>
                        );
                      }) : <div className={styles.emptyCompact}>No customer users.</div>}
                    </section>
                  </div>
                </details>
              );
            })}
            {companies.length === 0 ? <div className={styles.empty}>No companies yet.</div> : null}
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
