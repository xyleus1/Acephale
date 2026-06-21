import Link from "next/link";
import { revalidatePath } from "next/cache";
import { QuoteResult } from "@prisma/client";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Icon } from "@/components/icon";

const STATUS_LABELS: Record<string, string> = {
  UNTOUCHED: "New",
  IN_PROGRESS: "Talking",
  WORKED: "Active",
  LOST: "Lost",
};

const DOC_LABELS: Record<string, string> = {
  contract: "Contract",
  invoice: "Invoice",
  proposal: "Proposal",
  customs: "Customs",
  other: "Other",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function toneClass(value: string) {
  return value.toLowerCase().replace(/_/g, "-");
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  const { companyId } = await params;
  const canViewAll = session.role === "ADMIN" || session.role === "MANAGER" || session.canViewWholeOffice;
  const canManageOwners = session.role === "ADMIN" || session.role === "MANAGER";

  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      officeId: session.officeId,
      ...(canViewAll ? {} : { owners: { some: { userId: session.userId } } }),
    },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      owners: { include: { user: true } },
      activities: { orderBy: { occurredAt: "desc" }, take: 30, include: { createdBy: { select: { fullName: true } } } },
      quotes: { orderBy: { quotedAt: "desc" }, take: 30 },
      shipments: { orderBy: { shipmentDate: "desc" }, take: 20 },
      documents: { orderBy: { createdAt: "desc" } },
      tasks: { orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 20 },
      riskAlerts: { where: { isOpen: true }, orderBy: { createdAt: "desc" }, take: 5 },
      jobs: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!company) notFound();

  const users = await prisma.user.findMany({
    where: { officeId: session.officeId, isActive: true },
    orderBy: { fullName: "asc" },
  });

  async function addQuoteAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const origin = String(formData.get("origin") ?? "").trim() || null;
    const destination = String(formData.get("destination") ?? "").trim() || null;
    const mode = String(formData.get("mode") ?? "").trim() || null;
    const valueRaw = String(formData.get("value") ?? "").trim();
    const value = valueRaw ? Number(valueRaw) : null;
    const currency = String(formData.get("currency") ?? "USD").trim() || null;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    await prisma.quote.create({
      data: {
        officeId: s.officeId,
        companyId: cid,
        result: "PENDING",
        origin,
        destination,
        mode,
        value: Number.isFinite(value) ? value : null,
        currency,
        notes,
      },
    });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard/activity");
  }

  async function resolveQuoteAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const quoteId = String(formData.get("quoteId") ?? "");
    const result = String(formData.get("result") ?? "") as QuoteResult;
    const lostReason = result === "LOST" ? String(formData.get("lostReason") ?? "").trim() || null : null;
    if (!quoteId || !["WON", "LOST"].includes(result)) return;
    await prisma.quote.updateMany({ where: { id: quoteId, officeId: s.officeId }, data: { result, lostReason } });
    revalidatePath(`/dashboard/customers/${companyId}`);
    revalidatePath("/dashboard/activity");
  }

  async function addContactAction(formData: FormData) {
    "use server";
    const cid = String(formData.get("companyId"));
    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim() || null;
    const phone = String(formData.get("phone") ?? "").trim() || null;
    const title = String(formData.get("title") ?? "").trim() || null;
    if (!fullName) return;
    await prisma.contact.create({ data: { companyId: cid, fullName, email, phone, title } });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard/inbox");
  }

  async function toggleInboxApprovedContactAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const contactId = String(formData.get("contactId") ?? "");
    const approved = String(formData.get("approved") ?? "") === "true";
    if (!contactId) return;
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, company: { officeId: s.officeId } },
      select: { id: true, companyId: true },
    });
    if (!contact) return;
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        isApprovedForInbox: approved,
        approvedForInboxAt: approved ? new Date() : null,
      },
    });
    revalidatePath(`/dashboard/customers/${contact.companyId}`);
    revalidatePath("/dashboard/inbox");
  }

  async function addDocumentAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const name = String(formData.get("name") ?? "").trim();
    const url = String(formData.get("url") ?? "").trim();
    const docType = String(formData.get("docType") ?? "other").trim() || "other";
    if (!name || !url) return;
    await prisma.companyDocument.create({
      data: { officeId: s.officeId, companyId: cid, name, url, docType, uploadedByUserId: s.userId },
    });
    revalidatePath(`/dashboard/customers/${cid}`);
  }

  async function deleteDocumentAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const docId = String(formData.get("docId") ?? "");
    await prisma.companyDocument.deleteMany({ where: { id: docId, officeId: s.officeId } });
    revalidatePath(`/dashboard/customers/${companyId}`);
  }

  async function addTaskAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const title = String(formData.get("title") ?? "").trim();
    const dueAtRaw = String(formData.get("dueAt") ?? "").trim();
    const assignedToUserId = String(formData.get("assignedToUserId") ?? "").trim() || null;
    const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
    if (!title) return;
    await prisma.task.create({ data: { officeId: s.officeId, companyId: cid, title, dueAt, assignedToUserId, createdByUserId: s.userId } });
    revalidatePath(`/dashboard/customers/${cid}`);
    revalidatePath("/dashboard");
  }

  async function updateTaskStatusAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const taskId = String(formData.get("taskId") ?? "");
    await prisma.task.updateMany({ where: { id: taskId, officeId: s.officeId }, data: { status: "DONE" } });
    revalidatePath(`/dashboard/customers/${companyId}`);
    revalidatePath("/dashboard");
  }

  async function updateCompanyDetailsAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const class1 = String(formData.get("class1") ?? "").trim() || null;
    const class2 = String(formData.get("class2") ?? "").trim() || null;
    const product = String(formData.get("product") ?? "").trim() || null;
    const lane = String(formData.get("lane") ?? "").trim() || null;
    const direction = String(formData.get("direction") ?? "").trim() || null;
    await prisma.company.update({ where: { id: cid, officeId: s.officeId }, data: { class1, class2, product, lane, direction } });
    revalidatePath(`/dashboard/customers/${cid}`);
  }

  async function updateOwnersAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const cid = String(formData.get("companyId"));
    const company = await prisma.company.findFirst({
      where: { id: cid, officeId: s.officeId },
      select: { id: true },
    });
    if (!company) return;
    const requestedOwnerIds = formData.getAll("ownerIds").map((v) => String(v));
    const validUsers = await prisma.user.findMany({
      where: { id: { in: requestedOwnerIds }, officeId: s.officeId, isActive: true },
      select: { id: true },
    });
    const ownerIds = validUsers.map((u) => u.id);
    const primaryOwnerIdRaw = String(formData.get("primaryOwnerId") ?? "").trim();
    const existing = await prisma.companyOwner.findMany({
      where: { companyId: cid, company: { officeId: s.officeId } },
      select: { userId: true },
    });
    const existingSet = new Set(existing.map((x) => x.userId));
    const nextSet = new Set(ownerIds);
    const removed = existing.filter((x) => !nextSet.has(x.userId)).map((x) => x.userId);
    const added = ownerIds.filter((x) => !existingSet.has(x));
    await prisma.companyOwner.deleteMany({
      where: { companyId: cid, company: { officeId: s.officeId }, userId: { in: removed } },
    });
    for (const [idx, userId] of added.entries()) {
      await prisma.companyOwner.upsert({
        where: { companyId_userId: { companyId: cid, userId } },
        update: {},
        create: { companyId: cid, userId, isPrimary: idx === 0 && !existingSet.has(userId) },
      });
    }
    if (ownerIds.length > 0) {
      const primaryOwnerId = ownerIds.includes(primaryOwnerIdRaw) ? primaryOwnerIdRaw : ownerIds[0];
      await prisma.companyOwner.updateMany({
        where: { companyId: cid, company: { officeId: s.officeId } },
        data: { isPrimary: false },
      });
      await prisma.companyOwner.updateMany({
        where: { companyId: cid, company: { officeId: s.officeId }, userId: primaryOwnerId },
        data: { isPrimary: true },
      });
    }
    revalidatePath(`/dashboard/customers/${cid}`);
  }

  const lastActivity = company.activities[0]?.occurredAt ?? null;
  const openTasks = company.tasks.filter((task) => task.status === "OPEN");
  const fmtShort = (date: Date | string) => new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  const propRow = (label: string, value: string | null | undefined) =>
    value ? (
      <div key={label} className="customer-fact-row">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    ) : null;

  const sectionHeader = (title: string, count: number, action?: ReactNode) => (
    <div className="customer-section-header">
      <div className="customer-section-title-row">
        <span className="customer-section-title">{title}</span>
        <span className="customer-section-count">{count}</span>
      </div>
      {action}
    </div>
  );

  const addSummary = (label: string) => (
    <summary className="customer-add-summary">
      <Icon name="plus" size={12} />
      {label}
    </summary>
  );

  const reminderForm = (
    <form action={addTaskAction} className="field customer-form-stack">
      <input type="hidden" name="companyId" value={company.id} />
      <input name="title" placeholder="What needs to be done?" required />
      <input type="date" name="dueAt" />
      <select name="assignedToUserId" defaultValue="">
        <option value="">Assign to...</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>{user.fullName}</option>
        ))}
      </select>
      <button type="submit">Save</button>
    </form>
  );

  return (
    <div className="customer-detail">
      <div className="record-back-row">
        <Link href="/dashboard/customers" className="customer-back-link">
          <Icon name="chevron-left" size={14} />
          Customers
        </Link>
      </div>

      <div className="record-hero">
        <div className="record-hero-top">
          <div className="record-hero-main">
            <div className="record-eyebrow">
              <h1 className="record-title customer-record-title">{company.name}</h1>
              <span className={`customer-status status-${toneClass(company.status)}`}>
                {STATUS_LABELS[company.status] ?? company.status}
              </span>
              {company.riskAlerts.length > 0 && <span className="customer-risk-pill">Risk</span>}
            </div>
            <div className="record-chip-row">
              {company.owners.map((owner) => (
                <span key={owner.userId} className="record-chip">
                  {owner.user.fullName}{owner.isPrimary ? " - primary" : ""}
                </span>
              ))}
              {lastActivity ? (
                <span className="record-chip">Last contact {fmtShort(lastActivity)}</span>
              ) : (
                <span className="record-chip danger">Never contacted</span>
              )}
            </div>
          </div>
          <div className="record-actions">
            {[
              { value: company.jobs.length, label: "Jobs" },
              { value: company.quotes.length, label: "Shipments" },
              { value: company.contacts.length, label: "Contacts" },
              { value: company.activities.length, label: "Activities" },
              { value: company.documents.length, label: "Docs" },
              { value: openTasks.length, label: "Open tasks", danger: true },
            ].map((stat) => (
              <span key={stat.label} className={`record-chip${stat.danger && stat.value > 0 ? " danger" : ""}`}>
                {stat.value} {stat.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="record-panel customer-quicklog-panel">
        <a href="/dashboard/inbox" className="btn btn-secondary">
          Open inbox
        </a>
      </div>

      <div className="record-rail-grid customer-workspace">
        <aside className="record-rail">
          <div className="record-panel">
            <div className="record-card-header">
              <span className="record-card-title">About</span>
            </div>
            <div className="customer-panel-body compact">
              {propRow("Freight", company.product)}
              {propRow("Direction", company.direction)}
              {propRow("Region", company.lane)}
              {propRow("Class 1", company.class1)}
              {propRow("Class 2", company.class2)}
              {!company.product && !company.direction && !company.lane && <p className="customer-empty">No details set.</p>}
            </div>
            <details className="customer-details">
              <summary>Edit details</summary>
              <div className="customer-details-body">
                <form action={updateCompanyDetailsAction} className="field customer-form-stack">
                  <input type="hidden" name="companyId" value={company.id} />
                  <select name="class1" defaultValue={company.class1 ?? ""}>
                    <option value="">Class 1</option>
                    <option value="Passive">Passive</option>
                    <option value="Potential">Potential</option>
                    <option value="Active">Active</option>
                  </select>
                  <select name="class2" defaultValue={company.class2 ?? ""}>
                    <option value="">Class 2</option>
                    {["A", "B", "C", "D", "E"].map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                  <select name="product" defaultValue={company.product ?? ""}>
                    <option value="">Freight type</option>
                    <option value="Sea">Sea</option>
                    <option value="Air">Air</option>
                    <option value="Road">Road</option>
                    <option value="LTL">LTL</option>
                    <option value="Project">Project</option>
                  </select>
                  <select name="direction" defaultValue={company.direction ?? ""}>
                    <option value="">Direction</option>
                    <option value="Import">Import</option>
                    <option value="Export">Export</option>
                    <option value="Both">Both</option>
                  </select>
                  <input name="lane" placeholder="Region" defaultValue={company.lane ?? ""} />
                  <button type="submit">Save</button>
                </form>
              </div>
            </details>
          </div>

          <div className="record-panel">
            <div className="record-card-header">
              <span className="record-card-title">Account owners</span>
            </div>
            <div className="customer-owner-list">
              {company.owners.map((owner) => (
                <div key={owner.userId} className="customer-owner-row">
                  <div className="customer-avatar">{initials(owner.user.fullName)}</div>
                  <div className="customer-owner-copy">
                    <strong>{owner.user.fullName}</strong>
                    {owner.isPrimary && <span>Primary</span>}
                  </div>
                </div>
              ))}
            </div>
            {canManageOwners && (
              <details className="customer-details">
                <summary>Manage owners</summary>
                <div className="customer-details-body">
                  <form action={updateOwnersAction} className="field customer-form-stack">
                    <input type="hidden" name="companyId" value={company.id} />
                    <select name="ownerIds" multiple size={Math.min(4, users.length)} defaultValue={company.owners.map((owner) => owner.userId)}>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>{user.fullName}</option>
                      ))}
                    </select>
                    <select name="primaryOwnerId" defaultValue={company.owners.find((owner) => owner.isPrimary)?.userId ?? ""}>
                      <option value="">Primary owner...</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>{user.fullName}</option>
                      ))}
                    </select>
                    <button type="submit">Update</button>
                  </form>
                </div>
              </details>
            )}
          </div>

          {openTasks.length > 0 ? (
            <div className="record-panel customer-reminders">
              <div className="record-card-header">
                <span className="record-card-title danger">Open reminders</span>
              </div>
              <div className="customer-task-list">
                {openTasks.map((task) => {
                  const isOverdue = task.dueAt && new Date(task.dueAt) < new Date();
                  return (
                    <div key={task.id} className="customer-task-row">
                      <form action={updateTaskStatusAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <button
                          type="submit"
                          title="Mark done"
                          className={`customer-task-check${isOverdue ? " overdue" : ""}`}
                        />
                      </form>
                      <div className="customer-task-copy">
                        <strong className={isOverdue ? "overdue" : ""}>{task.title}</strong>
                        {task.dueAt && <span>{fmtShort(task.dueAt)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <details className="customer-details">
                <summary>Set reminder</summary>
                <div className="customer-details-body">{reminderForm}</div>
              </details>
            </div>
          ) : (
            <details className="record-panel customer-reminder-empty customer-details">
              <summary>Set reminder</summary>
              <div className="customer-details-body">{reminderForm}</div>
            </details>
          )}
        </aside>

        <main className="customer-main">
          <section className="customer-section" id="quotes">
            {sectionHeader(
              "Shipments",
              company.quotes.length,
              <details className="customer-add-menu">
                {addSummary("New quote")}
                <div className="customer-popover-card wide">
                  <form action={addQuoteAction} className="field customer-form-stack">
                    <input type="hidden" name="companyId" value={company.id} />
                    <div className="customer-form-grid two">
                      <input name="origin" placeholder="From" />
                      <input name="destination" placeholder="To" />
                    </div>
                    <select name="mode" defaultValue="">
                      <option value="">Freight mode</option>
                      <option value="AIR">Air</option>
                      <option value="SEA-FCL">Sea FCL</option>
                      <option value="SEA-LCL">Sea LCL</option>
                      <option value="ROAD">Road</option>
                      <option value="COURIER">Courier</option>
                    </select>
                    <div className="customer-form-grid amount">
                      <input name="value" type="number" step="0.01" placeholder="Amount" />
                      <input name="currency" defaultValue="USD" />
                    </div>
                    <input name="notes" placeholder="Notes" />
                    <button type="submit">Save quote</button>
                  </form>
                </div>
              </details>
            )}
            {company.quotes.length === 0 ? (
              <p className="customer-empty">No shipment quotes yet.</p>
            ) : (
              <div className="customer-card-list">
                {company.quotes.map((quote) => (
                  <div key={quote.id} className={`customer-quote-card result-${toneClass(quote.result)}`}>
                    <div className="customer-quote-top">
                      <div className="customer-route">
                        {quote.origin && quote.destination ? (
                          <>
                            {quote.origin} <span>to</span> {quote.destination}
                          </>
                        ) : (
                          <span>Route not set</span>
                        )}
                      </div>
                      <div className="customer-meta-row">
                        <span>{fmtShort(quote.quotedAt)}</span>
                        <span className={`customer-result result-${toneClass(quote.result)}`}>{quote.result}</span>
                      </div>
                    </div>
                    <div className="customer-quote-meta">
                      {quote.mode && <span className="customer-tag">{quote.mode}</span>}
                      {quote.value && <strong>{quote.value.toLocaleString()} {quote.currency ?? ""}</strong>}
                      {quote.notes && <span>{quote.notes}</span>}
                      {quote.lostReason && <em>Lost: {quote.lostReason}</em>}
                    </div>
                    {quote.result === "PENDING" && (
                      <div className="customer-resolution-row">
                        <span>Resolve</span>
                        <form action={resolveQuoteAction} className="customer-resolution-form">
                          <input type="hidden" name="quoteId" value={quote.id} />
                          <select name="lostReason" defaultValue="">
                            <option value="">Lost reason</option>
                            <option value="Price">Price</option>
                            <option value="Competitor">Competitor</option>
                            <option value="No volume">No volume</option>
                            <option value="Wrong lane">Wrong lane</option>
                            <option value="No response">No response</option>
                            <option value="Other">Other</option>
                          </select>
                          <button name="result" value="WON" type="submit">Won</button>
                          <button name="result" value="LOST" type="submit" className="danger">Lost</button>
                        </form>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {company.jobs.length > 0 && (
            <section className="customer-section">
              {sectionHeader("Jobs", company.jobs.length)}
              <div className="customer-row-list">
                {company.jobs.map((job) => (
                  <Link key={job.id} href={`/dashboard/jobs/${job.id}`} className="customer-job-row">
                    <div className="customer-row-main">
                      <div className="customer-job-head">
                        <span>{job.reference}</span>
                        {job.mode && <em>{job.mode}</em>}
                      </div>
                      <div className="customer-row-sub">
                        {job.origin && job.destination ? `${job.origin} to ${job.destination}` : "Route TBD"}
                      </div>
                    </div>
                    <span className="customer-job-status">{job.status.replace("_", " ")}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="customer-section">
            {sectionHeader(
              "Contacts",
              company.contacts.length,
              <details className="customer-add-menu">
                {addSummary("Add")}
                <div className="customer-popover-card">
                  <form action={addContactAction} className="field customer-form-stack">
                    <input type="hidden" name="companyId" value={company.id} />
                    <input name="fullName" required placeholder="Full name" />
                    <input name="title" placeholder="Job title" />
                    <input name="email" type="email" placeholder="Email" />
                    <input name="phone" placeholder="Phone" />
                    <button type="submit">Add contact</button>
                  </form>
                </div>
              </details>
            )}
            {company.contacts.length === 0 ? (
              <p className="customer-empty">No contacts added yet.</p>
            ) : (
              <div className="customer-card-list">
                {company.contacts.map((contact) => (
                  <div key={contact.id} className="customer-contact-card">
                    <div className="customer-avatar large">{initials(contact.fullName)}</div>
                    <div className="customer-row-main">
                      <strong>{contact.fullName}</strong>
                      {contact.title && <span>{contact.title}</span>}
                    </div>
                    <div className="customer-contact-links">
                      {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
                      {contact.phone && <span>{contact.phone}</span>}
                    </div>
                    {contact.email && (
                      <form action={toggleInboxApprovedContactAction} className="customer-inline-form">
                        <input type="hidden" name="contactId" value={contact.id} />
                        <input type="hidden" name="approved" value={contact.isApprovedForInbox ? "false" : "true"} />
                        <button type="submit" className="btn btn-secondary btn-sm">
                          {contact.isApprovedForInbox ? "Approved for inbox" : "Approve for inbox"}
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="customer-section">
            {sectionHeader(
              "Documents",
              company.documents.length,
              <details className="customer-add-menu">
                {addSummary("Attach")}
                <div className="customer-popover-card">
                  <form action={addDocumentAction} className="field customer-form-stack">
                    <input type="hidden" name="companyId" value={company.id} />
                    <input name="name" required placeholder="Document name" />
                    <input name="url" type="url" required placeholder="Link" />
                    <select name="docType" defaultValue="other">
                      <option value="contract">Contract</option>
                      <option value="invoice">Invoice</option>
                      <option value="proposal">Proposal</option>
                      <option value="customs">Customs docs</option>
                      <option value="other">Other</option>
                    </select>
                    <button type="submit">Attach</button>
                  </form>
                </div>
              </details>
            )}
            {company.documents.length === 0 ? (
              <p className="customer-empty">No documents attached yet.</p>
            ) : (
              <div className="customer-card-list">
                {company.documents.map((doc) => (
                  <div key={doc.id} className="customer-document-row">
                    <Icon name="file" size={16} />
                    <div className="customer-row-main">
                      <a href={doc.url} target="_blank" rel="noreferrer">{doc.name}</a>
                      {doc.docType && <span>{DOC_LABELS[doc.docType] ?? doc.docType}</span>}
                    </div>
                    <span className="customer-document-date">{fmtShort(doc.createdAt)}</span>
                    <form action={deleteDocumentAction}>
                      <input type="hidden" name="docId" value={doc.id} />
                      <button type="submit" title="Remove" className="customer-icon-action">
                        <Icon name="x" size={14} />
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </section>

        </main>
      </div>
    </div>
  );
}
