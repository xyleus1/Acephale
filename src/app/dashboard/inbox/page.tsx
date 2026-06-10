import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReclassifyButton } from "@/components/reclassify-button";
import { CreateInquiryButton } from "@/components/create-inquiry-button";
import { ThreadAccordion } from "@/components/thread-accordion";
import { MergeDuplicatesButton } from "@/components/merge-duplicates-button";
import { InboxQuickReply } from "@/components/inbox-quick-reply";
import { HideThreadButton } from "@/components/hide-thread-button";
import { SnoozeThreadButton } from "@/components/snooze-thread-button";
import { BulkCheckbox } from "@/components/bulk-checkbox";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { LoadFilterPicker } from "@/components/load-filter-picker";
import { RfqRowActions } from "@/components/rfq-row-actions";
import { SeedDemoButton } from "@/components/seed-demo-button";

const FILTERS = [
  { key: "",                  label: "Active"          },  // default — excludes hidden + snoozed
  { key: "_NEEDS_REPLY",      label: "Awaiting reply"  },
  { key: "_UNLINKED",         label: "Unlinked"        },
  { key: "_LINKED",           label: "Linked to a load"},
  { key: "_SNOOZED",          label: "Snoozed"         },
  { key: "_HIDDEN",           label: "Hidden"          },
  { key: "_ALL",              label: "All"             },
] as const;

function timeAgo(d: Date) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const KIND_META: Record<string, { fg: string; bg: string; bd: string; label: string }> = {
  RFQ:             { fg: "var(--brand)",   bg: "var(--brand-light)",  bd: "var(--brand-border)",  label: "RFQ" },
  CARRIER_REPLY:   { fg: "var(--brand)",   bg: "var(--brand-light)",  bd: "var(--brand-border)",  label: "Carrier reply" },
  CUSTOMER_REPLY:  { fg: "var(--brand)",   bg: "var(--brand-light)",  bd: "var(--brand-border)",  label: "Customer reply" },
  RELATED_NOTE:    { fg: "var(--text)",    bg: "var(--surface-3)",    bd: "var(--border-strong)", label: "Related" },
  OTHER:           { fg: "var(--text-3)",  bg: "var(--surface-3)",    bd: "var(--border)",        label: "Other" },
  UNCLASSIFIED:    { fg: "var(--danger)",  bg: "var(--danger-bg)",    bd: "var(--danger-border)", label: "Unclassified" },
};

function dominantKind(messages: { direction: string; classification: string | null }[]): string {
  const inbound = messages.filter((m) => m.direction === "INBOUND");
  if (inbound.length === 0) return "OTHER";
  const counts: Record<string, number> = {};
  for (const m of inbound) {
    const k = m.classification ?? "UNCLASSIFIED";
    counts[k] = (counts[k] ?? 0) + 1;
  }
  // Priority: RFQ > CARRIER_REPLY > CUSTOMER_REPLY > RELATED_NOTE > UNCLASSIFIED > OTHER
  for (const k of ["RFQ", "CARRIER_REPLY", "CUSTOMER_REPLY", "RELATED_NOTE", "UNCLASSIFIED", "OTHER"]) {
    if (counts[k] && counts[k] > 0) return k;
  }
  return "OTHER";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; account?: string; view?: string; q?: string; job?: string; inquiry?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const filter = sp.filter ?? "";
  const accountFilter = sp.account ?? "";
  const view = sp.view === "loads" ? "loads" : sp.view === "rfqs" ? "rfqs" : "threads";
  const searchQuery = (sp.q ?? "").trim();
  const jobFilter = sp.job?.trim() || "";
  const inquiryFilter = sp.inquiry?.trim() || "";

  const accounts = await prisma.emailAccount.findMany({
    where: { officeId: session.officeId, isActive: true },
    orderBy: { createdAt: "desc" },
  });

  // Threads with messages, plus their linked job/inquiry
  const where: any = { officeId: session.officeId };
  const now = new Date();
  // Default ("Active") excludes hidden + currently-snoozed threads. Other filters opt-in.
  if (filter === "_HIDDEN") {
    where.hiddenAt = { not: null };
  } else if (filter === "_SNOOZED") {
    where.snoozedUntil = { gt: now };
  } else if (filter === "_ALL") {
    // no hidden/snoozed filter
  } else {
    where.hiddenAt = null;
    where.AND = [
      { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    ];
    if (filter === "_UNLINKED") {
      where.jobId = null;
      where.inquiryId = null;
    } else if (filter === "_LINKED") {
      where.AND.push({ OR: [{ jobId: { not: null } }, { inquiryId: { not: null } }] });
    }
  }
  // Only show threads from active (non-paused) accounts.
  where.messages = {
    some: {
      account: { isActive: true },
      ...(accountFilter ? { accountId: accountFilter } : {}),
    },
  };
  // Load-based filter: scope to a specific job (and its linked inquiry threads)
  // or a specific inquiry directly. Overrides the linked/unlinked filter
  // because if you're filtering to a load, you implicitly want all of its threads.
  let focusedLoad: { kind: "job" | "inquiry"; id: string; label: string; sublabel: string; threadIds: string[] } | null = null;
  if (jobFilter) {
    const job = await prisma.job.findFirst({
      where: { id: jobFilter, officeId: session.officeId },
      select: {
        id: true, reference: true, type: true, status: true,
        company: { select: { name: true } },
        inquiryId: true,
        emailThreads: { select: { id: true } },
        inquiry: { select: { emailThreads: { select: { id: true } } } },
      },
    });
    if (job) {
      const ids = new Set<string>([
        ...job.emailThreads.map((t) => t.id),
        ...(job.inquiry?.emailThreads.map((t) => t.id) ?? []),
      ]);
      focusedLoad = {
        kind: "job", id: job.id,
        label: `${job.reference} · ${job.company?.name ?? "no customer"}`,
        sublabel: `${job.type === "SOURCING" ? "Procurement" : "Forwarding"} · ${job.status}`,
        threadIds: [...ids],
      };
    }
  } else if (inquiryFilter) {
    const inq = await prisma.inquiry.findFirst({
      where: { id: inquiryFilter, officeId: session.officeId },
      select: {
        id: true, subject: true, type: true, status: true,
        emailThreads: { select: { id: true } },
      },
    });
    if (inq) {
      focusedLoad = {
        kind: "inquiry", id: inq.id,
        label: inq.subject,
        sublabel: `${inq.type === "SOURCING" ? "Procurement RFQ" : "Forwarding RFQ"} · ${inq.status}`,
        threadIds: inq.emailThreads.map((t) => t.id),
      };
    }
  }
  if (focusedLoad) {
    where.AND = where.AND ?? [];
    where.AND.push({ id: { in: focusedLoad.threadIds.length ? focusedLoad.threadIds : ["__none__"] } });
    // When focused on a load, show hidden + snoozed threads too — operator wants
    // the complete picture for this deal regardless of triage state.
    delete where.hiddenAt;
    where.AND = where.AND.filter((c: any) => !c.OR || !c.OR.some((o: any) => "snoozedUntil" in o));
  }

  if (searchQuery) {
    where.AND = where.AND ?? [];
    where.AND.push({ OR: [
      { subject: { contains: searchQuery, mode: "insensitive" } },
      { messages: { some: {
        OR: [
          { bodyText: { contains: searchQuery, mode: "insensitive" } },
          { subject:  { contains: searchQuery, mode: "insensitive" } },
          { fromEmail:{ contains: searchQuery, mode: "insensitive" } },
          { fromName: { contains: searchQuery, mode: "insensitive" } },
        ],
      } } },
    ] });
  }

  let threads = await prisma.emailThread.findMany({
    where,
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      job: { select: { id: true, reference: true, type: true, company: { select: { name: true } } } },
      inquiry: { select: { id: true, subject: true, type: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: filter === "_NEEDS_REPLY" ? 200 : 80,
  });

  if (filter === "_NEEDS_REPLY") {
    // Last message is INBOUND and there's no OUTBOUND message after it.
    threads = threads.filter((t) => {
      const last = t.messages[t.messages.length - 1];
      return last && last.direction === "INBOUND";
    }).slice(0, 80);
  }

  // Counts for the filter chips (scoped to active accounts, like the thread list)
  const fromActiveAccount = { messages: { some: { account: { isActive: true } } } };
  const activeFilter = { hiddenAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }], ...fromActiveAccount };
  const [totalActive, totalUnlinked, totalLinked, totalSnoozed, totalHidden, totalAll] = await Promise.all([
    prisma.emailThread.count({ where: { officeId: session.officeId, ...activeFilter } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, ...activeFilter, jobId: null, inquiryId: null } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, AND: [activeFilter, { OR: [{ jobId: { not: null } }, { inquiryId: { not: null } }] }] } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, snoozedUntil: { gt: now }, ...fromActiveAccount } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, hiddenAt: { not: null }, ...fromActiveAccount } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, ...fromActiveAccount } }),
  ]);
  // "Awaiting reply" count is approximate: pull last messages directly via raw count of latest-inbound.
  // Cheap heuristic: same query as fetched threads.
  const totalNeedsReply = (await prisma.emailThread.findMany({
    where: { officeId: session.officeId, hiddenAt: null, ...fromActiveAccount },
    include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
    take: 500,
  })).filter((t) => t.messages[0]?.direction === "INBOUND").length;

  function countFor(key: string): number {
    if (!key) return totalActive;
    if (key === "_NEEDS_REPLY") return totalNeedsReply;
    if (key === "_UNLINKED") return totalUnlinked;
    if (key === "_LINKED") return totalLinked;
    if (key === "_SNOOZED") return totalSnoozed;
    if (key === "_HIDDEN") return totalHidden;
    if (key === "_ALL") return totalAll;
    return 0;
  }

  // RFQs view: structured inquiry list (replaces the standalone /dashboard/rfq page).
  const rfqs = view === "rfqs" ? await prisma.inquiry.findMany({
    where: { officeId: session.officeId },
    include: {
      company: { select: { id: true, name: true } },
      job: { select: { id: true, reference: true, status: true } },
      _count: { select: { emailThreads: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 100,
  }) : [];

  // Active jobs available as merge targets (excluding PROPOSED — those are
  // RFQs themselves, not active loads).
  const activeJobsForMerge = view === "rfqs" ? (await prisma.job.findMany({
    where: { officeId: session.officeId, status: { notIn: ["PROPOSED", "DELIVERED", "CANCELLED"] } },
    select: { id: true, reference: true, type: true, company: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 80,
  })).map((j) => ({ id: j.id, reference: j.reference, type: j.type, customer: j.company?.name ?? null })) : [];

  // Open inquiries shown in the bulk-action "Link to load" picker.
  const openInquiriesForBulk = (await prisma.inquiry.findMany({
    where: { officeId: session.officeId, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] } },
    select: { id: true, subject: true, type: true },
    orderBy: { receivedAt: "desc" },
    take: 50,
  })).map((i) => ({ id: i.id, subject: i.subject, type: i.type }));

  // For the "loads" view, group threads under their linked job/inquiry.
  type LoadGroup = {
    key: string;
    type: "JOB" | "INQUIRY" | "UNLINKED";
    title: string;
    subtitle: string;
    href: string | null;
    threads: typeof threads;
  };
  const loadGroups: LoadGroup[] = [];
  if (view === "loads") {
    const map = new Map<string, LoadGroup>();
    for (const t of threads) {
      let key = "unlinked";
      let group: LoadGroup;
      if (t.job) {
        key = `job:${t.job.id}`;
        group = map.get(key) ?? {
          key, type: "JOB",
          title: `${t.job.reference} · ${t.job.company?.name ?? "no customer"}`,
          subtitle: t.job.type === "SOURCING" ? "Procurement" : "Forwarding",
          href: `/dashboard/jobs/${t.job.id}`,
          threads: [],
        };
      } else if (t.inquiry) {
        key = `inq:${t.inquiry.id}`;
        group = map.get(key) ?? {
          key, type: "INQUIRY",
          title: t.inquiry.subject,
          subtitle: t.inquiry.type === "SOURCING" ? "Procurement RFQ" : "Forwarding RFQ",
          href: `/dashboard/rfq/${t.inquiry.id}`,
          threads: [],
        };
      } else {
        group = map.get(key) ?? {
          key, type: "UNLINKED",
          title: "Unlinked threads",
          subtitle: "Not yet attached to a load",
          href: null,
          threads: [],
        };
      }
      group.threads.push(t);
      map.set(key, group);
    }
    // Order: unlinked first if any, then by most recent thread inside.
    loadGroups.push(...[...map.values()].sort((a, b) => {
      if (a.type === "UNLINKED") return 1;
      if (b.type === "UNLINKED") return -1;
      const aLast = a.threads[0]?.lastMessageAt?.getTime?.() ?? 0;
      const bLast = b.threads[0]?.lastMessageAt?.getTime?.() ?? 0;
      return bLast - aLast;
    }));
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-subtitle">
            Synced emails grouped by thread. AI links each thread to a load when it can.
            For threads it didn&apos;t link, click <em>Create Inquiry from this thread</em> to spin up
            a load using all the messages as context.
          </p>
        </div>
        <LoadFilterPicker
          activeJobId={jobFilter || null}
          activeInquiryId={inquiryFilter || null}
          openJobs={await prisma.job.findMany({
            where: { officeId: session.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
            select: { id: true, reference: true, type: true, company: { select: { name: true } } },
            orderBy: { updatedAt: "desc" },
            take: 100,
          }).then((jobs) => jobs.map((j) => ({ id: j.id, reference: j.reference, type: j.type, customer: j.company?.name ?? null })))}
          unlinkedInquiries={await prisma.inquiry.findMany({
            where: { officeId: session.officeId, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] }, job: null },
            select: { id: true, subject: true, type: true },
            orderBy: { receivedAt: "desc" },
            take: 60,
          })}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <SeedDemoButton />
          <MergeDuplicatesButton />
          <ReclassifyButton onlyUnclassified={false} />
          <a href="/dashboard/settings/email" className="btn btn-secondary" style={{ fontSize: 13, textDecoration: "none" }}>
            Manage inboxes
          </a>
        </div>
      </div>

      {accounts.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          <a href="/dashboard/inbox" style={chipStyle(!accountFilter)}>All inboxes</a>
          {accounts.map((a) => (
            <a key={a.id} href={`/dashboard/inbox?account=${a.id}${filter ? `&filter=${filter}` : ""}`} style={chipStyle(accountFilter === a.id)}>{a.email}</a>
          ))}
        </div>
      )}

      <form method="get" action="/dashboard/inbox" style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
        {filter && <input type="hidden" name="filter" value={filter} />}
        {accountFilter && <input type="hidden" name="account" value={accountFilter} />}
        {view === "loads" && <input type="hidden" name="view" value="loads" />}
        <div style={{ position: "relative", flex: 1, maxWidth: 480 }}>
          <input
            type="search"
            name="q"
            defaultValue={searchQuery}
            placeholder="Search subjects, bodies, senders…"
            style={{
              width: "100%", padding: "8px 12px 8px 32px",
              border: "1px solid var(--border)", borderRadius: 4,
              fontSize: 13, background: "var(--surface)",
              outline: "none",
            }}
          />
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
        </div>
        {searchQuery && (
          <a href={`/dashboard/inbox${filter ? `?filter=${filter}` : ""}`} style={{ fontSize: 12, color: "var(--text-3)", textDecoration: "none" }}>Clear</a>
        )}
      </form>
      {searchQuery && (
        <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
          Searching for <strong style={{ color: "var(--text)" }}>{searchQuery}</strong> · {threads.length} match{threads.length === 1 ? "" : "es"}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {FILTERS.map((f) => {
          const accountQs = accountFilter ? `&account=${accountFilter}` : "";
          const viewQs = view === "loads" ? "&view=loads" : "";
          const isActive = filter === f.key;
          return (
            <a
              key={f.key}
              href={`/dashboard/inbox?${f.key ? `filter=${f.key}` : ""}${accountQs}${viewQs}`.replace(/^\?&/, "?").replace(/\?$/, "")}
              style={chipStyle(isActive, "dark")}
            >
              {f.label}
              <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: isActive ? "rgba(255,255,255,0.2)" : "var(--surface-3)", color: isActive ? "#fff" : "var(--text-3)", marginLeft: 6 }}>
                {countFor(f.key)}
              </span>
            </a>
          );
        })}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center", padding: 2, borderRadius: 4, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          {[
            { key: "threads", label: "Threads" },
            { key: "loads",   label: "By load" },
            { key: "rfqs",    label: "RFQs" },
          ].map((v) => {
            const isActive = view === v.key;
            const filterQs = filter ? `filter=${filter}` : "";
            const accountQs = accountFilter ? `&account=${accountFilter}` : "";
            const viewQs = v.key === "threads" ? "" : `&view=${v.key}`;
            return (
              <a
                key={v.key}
                href={`/dashboard/inbox?${filterQs}${accountQs}${viewQs}`.replace(/\?&/, "?").replace(/\?$/, "")}
                style={{
                  fontSize: 11.5, fontWeight: 600, padding: "4px 9px", borderRadius: 3,
                  background: isActive ? "var(--surface)" : "transparent",
                  color: isActive ? "var(--text)" : "var(--text-3)",
                  textDecoration: "none",
                  border: isActive ? "1px solid var(--border)" : "1px solid transparent",
                }}
              >{v.label}</a>
            );
          })}
        </div>
      </div>

      {focusedLoad && (
        <div style={{
          padding: "10px 14px", marginBottom: 12, borderRadius: 6,
          background: "var(--brand-light)", border: "1px solid var(--brand-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--brand)" }}>
              Filtered to load
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {focusedLoad.label}
              <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {focusedLoad.sublabel}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              {focusedLoad.threadIds.length} thread{focusedLoad.threadIds.length === 1 ? "" : "s"} attached · including hidden + snoozed
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <a href={focusedLoad.kind === "job" ? `/dashboard/jobs/${focusedLoad.id}` : `/dashboard/rfq/${focusedLoad.id}`}
               className="btn btn-secondary btn-sm" style={{ fontSize: 12, textDecoration: "none" }}>
              Open {focusedLoad.kind === "job" ? "job" : "RFQ"}
            </a>
            <a href="/dashboard/inbox" className="btn btn-secondary btn-sm" style={{ fontSize: 12, textDecoration: "none" }}>
              Clear filter
            </a>
          </div>
        </div>
      )}

      <BulkActionBar inquiries={openInquiriesForBulk} />

      {view === "rfqs" ? (
        <RfqListView rfqs={rfqs} activeJobs={activeJobsForMerge} />
      ) : threads.length === 0 ? (
        <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
          {accounts.length === 0 ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No inboxes connected</div>
              <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}>
                Connect a Gmail inbox to start syncing emails.
              </p>
              <a href="/dashboard/settings/email" className="btn" style={{ display: "inline-block", textDecoration: "none" }}>
                Go to email settings
              </a>
            </>
          ) : searchQuery ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No matches for &quot;{searchQuery}&quot;</div>
              <p style={{ fontSize: 13, color: "var(--text-3)" }}>
                Try a sender domain, a commodity name, or a port. Search covers subjects, bodies, and senders.
              </p>
            </>
          ) : filter === "_NEEDS_REPLY" ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Inbox zero on replies</div>
              <p style={{ fontSize: 13, color: "var(--text-3)" }}>
                Every active thread has an outbound reply after the last inbound message. Nice work.
              </p>
            </>
          ) : filter === "_HIDDEN" ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No hidden threads</div>
              <p style={{ fontSize: 13, color: "var(--text-3)" }}>
                Hidden threads are ones you (or AI) marked as not freight-related. They still sync, they just stay out of the way.
              </p>
            </>
          ) : filter === "_SNOOZED" ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No snoozed threads</div>
              <p style={{ fontSize: 13, color: "var(--text-3)" }}>
                Snooze a thread from the row to make it disappear until later (4h / tomorrow / next Monday).
              </p>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Inbox is calm</div>
              <p style={{ fontSize: 13, color: "var(--text-3)" }}>
                {totalSnoozed > 0 ? `${totalSnoozed} thread${totalSnoozed === 1 ? "" : "s"} snoozed. ` : ""}
                {totalHidden > 0 ? `${totalHidden} hidden as not freight-related. ` : ""}
                Click <strong>Sync now</strong> in <a href="/dashboard/settings/email" style={{ color: "var(--brand)" }}>Email Settings</a> to pull fresh mail manually, or wait — the platform auto-syncs every 15 minutes.
              </p>
            </>
          )}
        </div>
      ) : view === "loads" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {loadGroups.map((g) => (
            <div key={g.key} className="card" style={{ overflow: "hidden", borderLeft: g.type === "UNLINKED" ? "3px solid transparent" : "3px solid var(--brand)" }}>
              <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                    {g.href ? (
                      <a href={g.href} style={{ color: "var(--text)", textDecoration: "none" }}>{g.title} →</a>
                    ) : g.title}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                    {g.subtitle} · {g.threads.length} thread{g.threads.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {g.threads.map((t) => {
                  const last = t.messages[t.messages.length - 1];
                  return (
                    <div key={t.id} style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <BulkCheckbox threadId={t.id} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.subject}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                          {t.messages.length} msg · {timeAgo(t.lastMessageAt)}{last ? ` · last from ${last.fromName ?? last.fromEmail}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "inline-flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                        <InboxQuickReply threadId={t.id} threadSubject={t.subject} />
                        <SnoozeThreadButton threadId={t.id} snoozedUntil={t.snoozedUntil ? t.snoozedUntil.toISOString() : null} />
                        <HideThreadButton threadId={t.id} hidden={!!t.hiddenAt} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {threads.map((t) => {
            const linked = t.job || t.inquiry;
            const kind = dominantKind(t.messages);
            const meta = KIND_META[kind] ?? KIND_META.OTHER;
            const last = t.messages[t.messages.length - 1];
            const inboundCount = t.messages.filter((m) => m.direction === "INBOUND").length;
            const outboundCount = t.messages.length - inboundCount;
            const lastReason = [...t.messages].reverse().find((m) => m.classificationReason)?.classificationReason;

            return (
              <div key={t.id} className="card" style={{ overflow: "hidden", borderLeft: linked ? "3px solid var(--brand)" : "3px solid transparent" }}>
                <div style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                    <BulkCheckbox threadId={t.id} />
                    <span style={{
                      display: "inline-flex", fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                      background: meta.bg, color: meta.fg, border: `1px solid ${meta.bd}`,
                      textTransform: "uppercase", letterSpacing: "0.06em",
                    }}>{meta.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.subject || "(no subject)"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {t.messages.length} msg{t.messages.length === 1 ? "" : "s"}
                      {inboundCount > 0 && outboundCount > 0 ? ` · ${inboundCount} in / ${outboundCount} out` : ""}
                      {" · "}
                      {timeAgo(t.lastMessageAt)}
                    </span>
                  </div>

                  {/* Linked-to / not-linked row */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {t.job ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <a href={`/dashboard/jobs/${t.job.id}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>
                            → {t.job.reference} {t.job.company?.name ? `· ${t.job.company.name}` : ""}
                            <TypeBadge type={t.job.type} />
                          </a>
                          <a
                            href={`/dashboard/inbox?job=${t.job.id}`}
                            title="Show only this load's emails"
                            style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "none", padding: "2px 5px", border: "1px solid var(--border)", borderRadius: 3 }}
                          >
                            See all
                          </a>
                        </span>
                      ) : t.inquiry ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <a href={`/dashboard/rfq/${t.inquiry.id}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>
                            → {t.inquiry.subject}
                            <TypeBadge type={t.inquiry.type} />
                          </a>
                          <a
                            href={`/dashboard/inbox?inquiry=${t.inquiry.id}`}
                            title="Show only this inquiry's emails"
                            style={{ fontSize: 11, color: "var(--text-3)", textDecoration: "none", padding: "2px 5px", border: "1px solid var(--border)", borderRadius: 3 }}
                          >
                            See all
                          </a>
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-3)", fontStyle: "italic" }}>
                          Not linked to any load
                        </span>
                      )}
                    </div>
                    <div style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <InboxQuickReply threadId={t.id} threadSubject={t.subject} />
                      {!linked && (
                        <CreateInquiryButton threadId={t.id} />
                      )}
                      <SnoozeThreadButton threadId={t.id} snoozedUntil={t.snoozedUntil ? t.snoozedUntil.toISOString() : null} />
                      <HideThreadButton threadId={t.id} hidden={!!t.hiddenAt} />
                    </div>
                  </div>

                  {/* Last message preview + AI reason */}
                  {last && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
                        Latest: {last.fromName ?? last.fromEmail} · {timeAgo(last.sentAt)}
                      </div>
                      {last.bodyText && (
                        <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {last.bodyText.slice(0, 280).replace(/\s+/g, " ").trim()}
                        </div>
                      )}
                      {lastReason && (
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 6, fontStyle: "italic" }}>
                          AI: {lastReason}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Expandable messages */}
                <ThreadAccordion threadId={t.id} messageCount={t.messages.length} messages={t.messages.map((m) => {
                  let attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];
                  if (m.attachments) {
                    try { attachments = JSON.parse(m.attachments); } catch { attachments = []; }
                  }
                  return {
                    id: m.id,
                    direction: m.direction,
                    fromName: m.fromName,
                    fromEmail: m.fromEmail,
                    subject: m.subject,
                    bodyText: m.bodyText,
                    sentAt: m.sentAt.toISOString(),
                    classification: m.classification,
                    gmailMessageId: m.gmailMessageId,
                    attachments,
                  };
                })} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const isSourcing = type === "SOURCING";
  return (
    <span style={{
      marginLeft: 6, fontSize: 9, fontWeight: 700,
      padding: "1px 5px", borderRadius: 3,
      background: isSourcing ? "var(--surface-3)" : "var(--brand-light)",
      color: isSourcing ? "var(--text-2)" : "var(--brand)",
      border: `1px solid ${isSourcing ? "var(--border-strong)" : "var(--brand-border)"}`,
      textTransform: "uppercase", letterSpacing: "0.06em",
    }}>{isSourcing ? "SOURCING" : "FORWARDING"}</span>
  );
}

type RfqRow = {
  id: string;
  subject: string;
  type: string;
  status: string;
  fromEmail: string | null;
  fromCompany: string | null;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  receivedAt: Date;
  company: { id: string; name: string } | null;
  job: { id: string; reference: string; status: string } | null;
  _count: { emailThreads: number };
};

const RFQ_STATUS_META: Record<string, { label: string; cls: string }> = {
  INGESTED: { label: "New",    cls: "badge-info" },
  PARSED:   { label: "Parsed", cls: "badge-neutral" },
  PRICED:   { label: "Priced", cls: "badge-warn" },
  QUOTED:   { label: "Quoted", cls: "badge-good" },
  WON:      { label: "Won",    cls: "badge-good" },
  LOST:     { label: "Lost",   cls: "badge-danger" },
};

function RfqListView({ rfqs, activeJobs }: { rfqs: RfqRow[]; activeJobs: { id: string; reference: string; type: string; customer: string | null }[] }) {
  if (rfqs.length === 0) {
    return (
      <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>No RFQs yet</div>
        <p style={{ fontSize: 13, color: "var(--text-3)" }}>
          RFQs are created from email threads (manually or by the AI auto-link). Switch to Threads view to see incoming mail.
        </p>
      </div>
    );
  }
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--surface-2)", color: "var(--text-3)", textAlign: "left" }}>
            <th style={thStyle}>Subject</th>
            <th style={thStyle}>Customer / sender</th>
            <th style={thStyle}>Route</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Job</th>
            <th style={thStyle}>Threads</th>
            <th style={thStyle}>Received</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rfqs.map((r) => {
            const sm = RFQ_STATUS_META[r.status] ?? { label: r.status, cls: "badge-neutral" };
            return (
              <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={tdStyle}>
                  <a href={`/dashboard/rfq/${r.id}`} style={{ color: "var(--text)", textDecoration: "none", fontWeight: 600 }}>
                    {r.subject}
                  </a>
                </td>
                <td style={tdStyle}>
                  <div style={{ color: "var(--text)" }}>{r.company?.name ?? r.fromCompany ?? "—"}</div>
                  {r.fromEmail && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{r.fromEmail}</div>}
                </td>
                <td style={tdStyle}>
                  {r.origin || r.destination ? (
                    <span style={{ color: "var(--text-2)" }}>{r.origin ?? "?"} → {r.destination ?? "?"}</span>
                  ) : <span style={{ color: "var(--text-3)" }}>—</span>}
                  {r.mode && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{r.mode}</div>}
                </td>
                <td style={tdStyle}><TypeBadge type={r.type} /></td>
                <td style={tdStyle}><span className={`badge ${sm.cls}`}>{sm.label}</span></td>
                <td style={tdStyle}>
                  {r.job ? (
                    <a href={`/dashboard/jobs/${r.job.id}`} style={{ color: "var(--brand)", textDecoration: "none", fontSize: 12, fontWeight: 600 }}>
                      {r.job.reference}
                    </a>
                  ) : <span style={{ color: "var(--text-3)" }}>—</span>}
                </td>
                <td style={tdStyle}>
                  {r._count.emailThreads > 0 ? (
                    <a href={`/dashboard/inbox?inquiry=${r.id}`} style={{ color: "var(--brand)", textDecoration: "none", fontSize: 12 }}>
                      {r._count.emailThreads}
                    </a>
                  ) : <span style={{ color: "var(--text-3)" }}>0</span>}
                </td>
                <td style={{ ...tdStyle, fontSize: 11.5, color: "var(--text-3)" }}>
                  {new Date(r.receivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </td>
                <td style={tdStyle}>
                  {r.job && r.job.status !== "PROPOSED" ? (
                    <span style={{ fontSize: 10.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Already a job
                    </span>
                  ) : (
                    <RfqRowActions
                      inquiryId={r.id}
                      jobLinked={!!r.job && r.job.status !== "PROPOSED"}
                      activeJobs={activeJobs}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" };
const tdStyle: React.CSSProperties = { padding: "12px 14px", verticalAlign: "top" };

function chipStyle(active: boolean, variant: "default" | "dark" = "default"): React.CSSProperties {
  const dark = variant === "dark";
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "5px 12px", borderRadius: 4, fontSize: 12, fontWeight: 500,
    background: active ? (dark ? "var(--text)" : "var(--brand)") : "var(--surface)",
    color: active ? "#fff" : "var(--text-2)",
    border: "1px solid", borderColor: active ? (dark ? "var(--text)" : "var(--brand)") : "var(--border)",
    textDecoration: "none",
  };
}
