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
import { Icon } from "@/components/icon";
import { SyncDeryaInboxesButton } from "@/components/sync-derya-inboxes-button";
import { DERYA_LOAD_RFQ_INBOX_EMAILS, DERYA_RFQ_SOURCE_EMAILS, gmailConnectHrefForInbox, isDeryaRfqSourceSender } from "@/lib/derya-inboxes";
import { LOAD_RFQ_RELATED_CLASSIFICATIONS, primaryEmailWorkflowLabel } from "@/lib/email-workflow-labels";
import { inquiryStatusBadgeCls, inquiryStatusLabel, openInquiryStatusFilter } from "@/lib/inquiry-status";
import { applyInboxAgentProposalAction, discardInboxAgentProposalAction } from "./actions";
import { displayParty, whatsAppAccountLabel } from "@/lib/whatsapp-display";
import { whatsAppSendConfigured } from "@/lib/whatsapp";

export const metadata = { title: "Inbox" };

const FILTERS = [
  { key: "",                  label: "Active"          },  // default - excludes hidden + snoozed
  { key: "_TODAY",            label: "Today"           },
  { key: "_DEMO",             label: "Demo"            },
  { key: "_LOAD_RFQ",         label: "Load/RFQ"        },
  { key: "_APPROVED_CONTACTS", label: "Approved contacts" },
  { key: "_NEEDS_REPLY",      label: "Awaiting reply"  },
  { key: "_UNLINKED",         label: "Unlinked"        },
  { key: "_LINKED",           label: "Linked to a load"},
  { key: "_SNOOZED",          label: "Snoozed"         },
  { key: "_HIDDEN",           label: "Hidden"          },
  { key: "_ALL",              label: "All"             },
] as const;

const MAIL_PROVIDERS = ["GMAIL", "OUTLOOK", "IMAP"] as const;

const CHANNELS = [
  { key: "", label: "All channels" },
  { key: "mail", label: "Mail" },
  { key: "whatsapp", label: "WhatsApp" },
] as const;

const INBOX_TODAY_TIME_ZONE = process.env.DERYA_INBOX_TIME_ZONE || "America/Los_Angeles";

type ChannelFilter = typeof CHANNELS[number]["key"];

function normalizeChannel(value: string | undefined): ChannelFilter {
  return value === "mail" || value === "whatsapp" ? value : "";
}

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

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function zonedTimeToUtc(input: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number }, timeZone: string) {
  const utcGuess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour ?? 0, input.minute ?? 0, input.second ?? 0));
  const asZoned = zonedParts(utcGuess, timeZone);
  const zonedAsUtc = Date.UTC(asZoned.year, asZoned.month - 1, asZoned.day, asZoned.hour, asZoned.minute, asZoned.second);
  const offsetMs = zonedAsUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - offsetMs);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function todayRange(timeZone: string) {
  const now = new Date();
  const parts = zonedParts(now, timeZone);
  const start = zonedTimeToUtc({ year: parts.year, month: parts.month, day: parts.day }, timeZone);
  const nextDayParts = zonedParts(addUtcDays(start, 1), timeZone);
  const end = zonedTimeToUtc({ year: nextDayParts.year, month: nextDayParts.month, day: nextDayParts.day }, timeZone);
  return { start, end };
}

const KIND_META: Record<string, { label: string; cls: string }> = {
  RFQ:             { label: "RFQ",            cls: "kind-rfq" },
  CARRIER_REPLY:   { label: "Forwarder reply", cls: "kind-carrier" },
  CUSTOMER_REPLY:  { label: "Customer reply", cls: "kind-customer" },
  RELATED_NOTE:    { label: "Related",        cls: "kind-related" },
  OTHER:           { label: "Other",          cls: "kind-other" },
  UNCLASSIFIED:    { label: "Unclassified",   cls: "kind-unclassified" },
};

function dominantKind(messages: { direction: string; classification: string | null; fromEmail?: string | null }[]): string {
  const inbound = messages.filter((m) => m.direction === "INBOUND");
  if (inbound.length === 0) return "OTHER";
  if (inbound.some((m) => isDeryaRfqSourceSender(m.fromEmail))) return "RFQ";
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

function channelBadge(account: { provider: string; email: string } | null | undefined) {
  if (!account) return { label: "Unknown", cls: "unknown" };
  if (account.provider === "WHATSAPP") return { label: "WhatsApp", cls: "whatsapp" };
  if (account.provider === "GMAIL") return { label: "Gmail", cls: "mail" };
  if (account.provider === "OUTLOOK") return { label: "Outlook", cls: "mail" };
  if (account.provider === "IMAP") return { label: "IMAP", cls: "mail" };
  return { label: account.provider, cls: "unknown" };
}

function threadSourceMeta(messages: { account?: { provider: string; email: string } | null; fromEmail: string; fromName: string | null }[]) {
  const last = messages[messages.length - 1];
  const account = last?.account ?? messages.find((m) => m.account)?.account ?? null;
  const badge = channelBadge(account);
  return {
    ...badge,
    accountLabel: account ? whatsAppAccountLabel(account.email) : "unknown source",
  };
}

function threadCriticality(thread: {
  hiddenAt?: Date | null;
  snoozedUntil?: Date | null;
  jobId?: string | null;
  inquiryId?: string | null;
  lastMessageAt: Date;
  messages: { direction: string; classification: string | null; sentAt: Date; account?: { provider: string } | null }[];
}) {
  const last = thread.messages[thread.messages.length - 1];
  const kind = dominantKind(thread.messages);
  let score = 20;

  if (last?.direction === "INBOUND") score += 30;
  if (kind === "RFQ") score += 28;
  if (kind === "CUSTOMER_REPLY") score += 22;
  if (kind === "CARRIER_REPLY") score += 18;
  if (!thread.jobId && !thread.inquiryId) score += 10;
  if (kind === "OTHER") score -= 35;
  if (thread.hiddenAt) score -= 80;
  if (thread.snoozedUntil && thread.snoozedUntil > new Date()) score -= 60;

  // Chat latency expectations differ from email: an unanswered WhatsApp goes
  // stale in hours, not days.
  const isWhatsAppThread = thread.messages.some((m) => m.account?.provider === "WHATSAPP");
  const [staleSoon, staleBad] = isWhatsAppThread ? [2, 12] : [24, 72];
  const hoursOld = (Date.now() - thread.lastMessageAt.getTime()) / 3_600_000;
  if (last?.direction === "INBOUND" && hoursOld >= staleSoon) score += 12;
  if (last?.direction === "INBOUND" && hoursOld >= staleBad) score += 10;

  if (score >= 80) return { label: "Critical", cls: "critical", score };
  if (score >= 58) return { label: "High", cls: "high", score };
  if (score >= 28) return { label: "Normal", cls: "normal", score };
  return { label: "Low", cls: "low", score };
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; account?: string; channel?: string; view?: string; q?: string; job?: string; inquiry?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const filter = sp.filter ?? "";
  const accountFilter = sp.account ?? "";
  const channel = normalizeChannel(sp.channel);
  const view = sp.view === "loads" ? "loads" : sp.view === "rfqs" ? "rfqs" : "threads";
  const searchQuery = (sp.q ?? "").trim();
  const jobFilter = sp.job?.trim() || "";
  const inquiryFilter = sp.inquiry?.trim() || "";

  const [accounts, approvedContacts] = await Promise.all([
    prisma.emailAccount.findMany({
      where: { officeId: session.officeId, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.contact.findMany({
      where: {
        email: { not: null },
        company: { officeId: session.officeId },
        OR: [
          { isApprovedForInbox: true },
          { company: { status: { in: ["IN_PROGRESS", "WORKED"] } } },
        ],
      },
      select: { email: true },
      take: 500,
    }),
  ]);
  const waComposerEnabled = whatsAppSendConfigured();
  const approvedContactEmails = [...new Set(approvedContacts
    .map((c) => c.email?.trim().toLowerCase())
    .filter((email): email is string => !!email))];
  const connectedDeryaInboxEmails = new Set(accounts
    .filter((account) => account.provider === "GMAIL")
    .map((account) => account.email.toLowerCase())
    .filter((email) => DERYA_LOAD_RFQ_INBOX_EMAILS.includes(email)));
  const missingDeryaInboxEmails = DERYA_LOAD_RFQ_INBOX_EMAILS.filter((email) => !connectedDeryaInboxEmails.has(email));

  function messageScope(args: { channel?: ChannelFilter; accountId?: string } = {}) {
    const scopedChannel = args.channel ?? channel;
    const scopedAccountId = args.accountId ?? accountFilter;
    const account: any = { isActive: true };
    if (scopedAccountId) account.id = scopedAccountId;
    if (scopedChannel === "mail") account.provider = { in: [...MAIL_PROVIDERS] };
    if (scopedChannel === "whatsapp") account.provider = "WHATSAPP";
    return { messages: { some: { account } } };
  }

  function inboxHref(overrides: Partial<Record<"filter" | "account" | "channel" | "view" | "q", string | null>>) {
    const next = {
      filter: overrides.filter === undefined ? filter : overrides.filter,
      account: overrides.account === undefined ? accountFilter : overrides.account,
      channel: overrides.channel === undefined ? channel : overrides.channel,
      view: overrides.view === undefined ? (view === "threads" ? "" : view) : overrides.view,
      q: overrides.q === undefined ? searchQuery : overrides.q,
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return `/dashboard/inbox${qs ? `?${qs}` : ""}`;
  }

  // Threads with messages, plus their linked job/inquiry
  const where: any = { officeId: session.officeId };
  const now = new Date();
  const inboxToday = todayRange(INBOX_TODAY_TIME_ZONE);
  const todayThreadWhere = {
    lastMessageAt: {
      gte: inboxToday.start,
      lt: inboxToday.end,
    },
  };
  const todayInquiryWhere = {
    OR: [
      { receivedAt: { gte: inboxToday.start, lt: inboxToday.end } },
      { emailThreads: { some: todayThreadWhere } },
    ],
  };
  const rfqSourceMessageWhere = {
    direction: "INBOUND" as const,
    OR: DERYA_RFQ_SOURCE_EMAILS.map((email) => ({
      fromEmail: { equals: email, mode: "insensitive" as const },
    })),
  };
  const loadRfqRelatedWhere = {
    OR: [
      { jobId: { not: null } },
      { inquiryId: { not: null } },
      { messages: { some: { direction: "INBOUND" as const, classification: { in: [...LOAD_RFQ_RELATED_CLASSIFICATIONS] } } } },
      { messages: { some: rfqSourceMessageWhere } },
    ],
  };
  const demoThreadWhere = {
    OR: [
      { externalThreadId: { startsWith: "demo:" } },
      { subject: { startsWith: "DEMO" } },
      { job: { notes: { contains: "[VIDEO_DEMO_LOAD]" } } },
      { job: { company: { name: { startsWith: "DEMO ·" } } } },
      { inquiry: { notes: { contains: "[VIDEO_DEMO_LOAD]" } } },
      { inquiry: { subject: { startsWith: "DEMO" } } },
      { inquiry: { company: { name: { startsWith: "DEMO ·" } } } },
    ],
  };
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
    } else if (filter === "_TODAY") {
      where.AND.push(todayThreadWhere);
    } else if (filter === "_DEMO") {
      where.AND.push(demoThreadWhere);
    } else if (filter === "_LOAD_RFQ") {
      where.AND.push(loadRfqRelatedWhere);
    } else if (filter === "_APPROVED_CONTACTS") {
      where.AND.push({
        messages: {
          some: {
            direction: "INBOUND",
            fromEmail: { in: approvedContactEmails.length ? approvedContactEmails : ["__none__"] },
          },
        },
      });
    }
  }
  // Only show threads from active (non-paused) accounts.
  where.messages = messageScope().messages;
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
    // When focused on a load, show hidden + snoozed threads too - operator wants
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

  const threadInclude = {
    messages: {
      orderBy: { sentAt: "asc" as const },
      include: { account: { select: { id: true, email: true, provider: true } } },
    },
    job: { select: { id: true, reference: true, type: true, company: { select: { name: true } } } },
    inquiry: { select: { id: true, subject: true, type: true } },
  };

  let threads = await prisma.emailThread.findMany({
    where,
    include: threadInclude,
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
  threads = [...threads].sort((a, b) => {
    const diff = threadCriticality(b).score - threadCriticality(a).score;
    return diff || b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
  });

  // Counts for the filter chips (scoped to active accounts/channel, like the thread list)
  const fromActiveAccount = messageScope();
  const allChannelsAccountScope = messageScope({ channel: "" });
  const activeFilter = { hiddenAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }], ...fromActiveAccount };
  const activeAllChannelsFilter = { hiddenAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }], ...allChannelsAccountScope };
  const activeMailFilter = { hiddenAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }], ...messageScope({ channel: "mail" }) };
  const activeWhatsAppFilter = { hiddenAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }], ...messageScope({ channel: "whatsapp" }) };
  const approvedContactFilter: any = {
    messages: {
      some: {
        direction: "INBOUND",
        fromEmail: { in: approvedContactEmails.length ? approvedContactEmails : ["__none__"] },
      },
    },
  };
  const todayRfqCountWhere: any = { officeId: session.officeId, AND: [todayInquiryWhere] };
  if (accountFilter || channel) {
    todayRfqCountWhere.AND.push({ emailThreads: { some: messageScope() } });
  }
  const [totalActive, totalAllChannelsActive, totalMail, totalWhatsApp, totalToday, totalTodayRfqs, totalDemo, totalLoadRfq, totalApprovedContacts, totalUnlinked, totalLinked, totalSnoozed, totalHidden, totalAll, todayThreads] = await Promise.all([
    prisma.emailThread.count({ where: { officeId: session.officeId, ...activeFilter } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, ...activeAllChannelsFilter } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, ...activeMailFilter } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, ...activeWhatsAppFilter } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, AND: [activeFilter, todayThreadWhere] } }),
    prisma.inquiry.count({ where: todayRfqCountWhere }),
    prisma.emailThread.count({ where: { officeId: session.officeId, AND: [activeFilter, demoThreadWhere] } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, AND: [activeFilter, loadRfqRelatedWhere] } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, AND: [activeFilter, approvedContactFilter] } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, ...activeFilter, jobId: null, inquiryId: null } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, AND: [activeFilter, { OR: [{ jobId: { not: null } }, { inquiryId: { not: null } }] }] } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, snoozedUntil: { gt: now }, ...fromActiveAccount } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, hiddenAt: { not: null }, ...fromActiveAccount } }),
    prisma.emailThread.count({ where: { officeId: session.officeId, ...fromActiveAccount } }),
    prisma.emailThread.findMany({
      where: { officeId: session.officeId, AND: [activeFilter, todayThreadWhere] },
      include: threadInclude,
      orderBy: { lastMessageAt: "desc" },
      take: 8,
    }),
  ]);
  // "Awaiting reply" count is approximate: pull last messages directly via raw count of latest-inbound.
  // Cheap heuristic: same query as fetched threads.
  const totalNeedsReply = (await prisma.emailThread.findMany({
    where: { officeId: session.officeId, hiddenAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }], ...fromActiveAccount },
    include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
    take: 500,
  })).filter((t) => t.messages[0]?.direction === "INBOUND").length;

  function countFor(key: string): number {
    if (!key) return totalActive;
    if (key === "_TODAY") return totalToday;
    if (key === "_DEMO") return totalDemo;
    if (key === "_LOAD_RFQ") return totalLoadRfq;
    if (key === "_APPROVED_CONTACTS") return totalApprovedContacts;
    if (key === "_NEEDS_REPLY") return totalNeedsReply;
    if (key === "_UNLINKED") return totalUnlinked;
    if (key === "_LINKED") return totalLinked;
    if (key === "_SNOOZED") return totalSnoozed;
    if (key === "_HIDDEN") return totalHidden;
    if (key === "_ALL") return totalAll;
    return 0;
  }

  function channelCountFor(key: ChannelFilter): number {
    if (key === "mail") return totalMail;
    if (key === "whatsapp") return totalWhatsApp;
    return totalAllChannelsActive;
  }

  const rfqWhere: any = { officeId: session.officeId };
  const rfqAnd: any[] = [];
  if (filter === "_TODAY") {
    rfqAnd.push(todayInquiryWhere);
  } else if (filter === "_DEMO") {
    rfqAnd.push({
      OR: [
        { notes: { contains: "[VIDEO_DEMO_LOAD]" } },
        { subject: { startsWith: "DEMO" } },
        { company: { name: { startsWith: "DEMO ·" } } },
        { emailThreads: { some: demoThreadWhere } },
      ],
    });
  } else if (filter === "_LINKED") {
    rfqAnd.push({ job: { isNot: null } });
  } else if (filter === "_UNLINKED") {
    rfqAnd.push({ job: null });
  }
  if (searchQuery) {
    rfqAnd.push({
      OR: [
        { subject: { contains: searchQuery, mode: "insensitive" } },
        { fromEmail: { contains: searchQuery, mode: "insensitive" } },
        { fromCompany: { contains: searchQuery, mode: "insensitive" } },
        { origin: { contains: searchQuery, mode: "insensitive" } },
        { destination: { contains: searchQuery, mode: "insensitive" } },
        { commodity: { contains: searchQuery, mode: "insensitive" } },
        { notes: { contains: searchQuery, mode: "insensitive" } },
        { emailThreads: { some: { messages: { some: {
          OR: [
            { bodyText: { contains: searchQuery, mode: "insensitive" } },
            { subject: { contains: searchQuery, mode: "insensitive" } },
            { fromEmail: { contains: searchQuery, mode: "insensitive" } },
            { fromName: { contains: searchQuery, mode: "insensitive" } },
          ],
        } } } } },
      ],
    });
  }
  if (accountFilter || channel) {
    rfqAnd.push({ emailThreads: { some: messageScope() } });
  }
  if (rfqAnd.length > 0) rfqWhere.AND = rfqAnd;

  // RFQs view: structured inquiry list (replaces the standalone /dashboard/rfq page).
  const rfqs = view === "rfqs" ? await prisma.inquiry.findMany({
    where: rfqWhere,
    include: {
      company: { select: { id: true, name: true } },
      job: { select: { id: true, reference: true, status: true } },
      _count: { select: { emailThreads: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 100,
  }) : [];

  // Active jobs available as merge targets (excluding PROPOSED - those are
  // RFQs themselves, not active loads).
  const activeJobsForMerge = view === "rfqs" ? (await prisma.job.findMany({
    where: { officeId: session.officeId, status: { notIn: ["PROPOSED", "DELIVERED", "CANCELLED"] } },
    select: { id: true, reference: true, type: true, company: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 80,
  })).map((j) => ({ id: j.id, reference: j.reference, type: j.type, customer: j.company?.name ?? null })) : [];

  // Open inquiries shown in the bulk-action "Link to load" picker.
  const openInquiriesForBulk = (await prisma.inquiry.findMany({
    where: { officeId: session.officeId, status: openInquiryStatusFilter() },
    select: { id: true, subject: true, type: true },
    orderBy: { receivedAt: "desc" },
    take: 50,
  })).map((i) => ({ id: i.id, subject: i.subject, type: i.type }));

  const bulkProposals = (await prisma.agentProposal.findMany({
    where: {
      officeId: session.officeId,
      status: "PENDING",
      jobId: null,
      inquiryId: null,
    },
    select: {
      id: true,
      kind: true,
      sourceType: true,
      sourcePreview: true,
      payload: true,
      toolTrace: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  })).filter((proposal) => asRecord(proposal.payload).entity === "bulk");

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
    <div className="inbox-page">
      <div className="page-header page-header-roomy">
        <div>
          <h1 className="page-title">Inbox</h1>
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
            where: { officeId: session.officeId, status: openInquiryStatusFilter(), job: null },
            select: { id: true, subject: true, type: true },
            orderBy: { receivedAt: "desc" },
            take: 60,
          })}
        />
        <div className="page-actions">
          <SyncDeryaInboxesButton disabled={connectedDeryaInboxEmails.size === 0} />
          <MergeDuplicatesButton />
          <ReclassifyButton onlyUnclassified={false} />
          <a href="/dashboard/settings/email" className="btn btn-secondary">
            Manage inboxes
          </a>
        </div>
      </div>

      {view === "threads" && !filter && !searchQuery && !focusedLoad && totalToday > 0 && (
        <section className="today-inbox-panel">
          <div className="today-inbox-head">
            <div>
              <div className="today-inbox-eyebrow">Today</div>
              <h2>Received today</h2>
            </div>
            <div className="today-inbox-actions">
              <a href={inboxHref({ filter: "_TODAY", view: null })} className="btn btn-secondary btn-sm">
                Threads {totalToday}
              </a>
              <a href={inboxHref({ filter: "_TODAY", view: "rfqs" })} className="btn btn-sm">
                RFQs {totalTodayRfqs}
              </a>
            </div>
          </div>
          <div className="today-inbox-list">
            {todayThreads.map((t) => {
              const kind = dominantKind(t.messages);
              const workflow = primaryEmailWorkflowLabel({
                kind,
                jobId: t.job?.id ?? null,
                inquiryId: t.inquiry?.id ?? null,
              });
              const source = threadSourceMeta(t.messages);
              const last = t.messages[t.messages.length - 1];
              const href = t.job
                ? `/dashboard/jobs/${t.job.id}`
                : t.inquiry
                  ? `/dashboard/rfq/${t.inquiry.id}`
                  : inboxHref({ filter: "_TODAY" });
              return (
                <a key={t.id} href={href} className="today-inbox-row">
                  <span className={`inbox-workflow-label ${workflow.className}`}>{workflow.label}</span>
                  <span className={`inbox-source-badge ${source.cls}`} title={source.accountLabel}>{source.label}</span>
                  <span className="today-inbox-subject">{t.subject || "(no subject)"}</span>
                  <span className="today-inbox-meta">
                    {timeAgo(t.lastMessageAt)}
                    {last ? ` · ${displayParty(last.fromEmail, last.fromName)}` : ""}
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {accounts.length > 0 && (
        <div className="chip-row channel-chip-row">
          {CHANNELS.map((c) => (
            <a
              key={c.key || "all"}
              href={inboxHref({ channel: c.key, account: null })}
              className={`filter-chip${!accountFilter && channel === c.key ? " active" : ""}`}
            >
              {c.label}
              <span className="filter-chip-count">{channelCountFor(c.key)}</span>
            </a>
          ))}
          <span className="chip-row-divider" />
          <a href={inboxHref({ account: null })} className={`filter-chip${!accountFilter ? " active" : ""}`}>All inboxes</a>
          {accounts.map((a) => {
            const badge = channelBadge(a);
            return (
              <a
                key={a.id}
                href={inboxHref({ account: a.id, channel: null })}
                className={`filter-chip source-chip ${badge.cls}${accountFilter === a.id ? " active" : ""}`}
              >
                <span className={`inbox-channel-dot ${badge.cls}`} />
                {whatsAppAccountLabel(a.email)}
              </a>
            );
          })}
        </div>
      )}

      {missingDeryaInboxEmails.length > 0 && (
        <div className="inbox-source-warning">
          <div>
            <strong>Derya load/RFQ inbox incomplete</strong>
            <span>Missing active Gmail access for {missingDeryaInboxEmails.join(", ")}.</span>
          </div>
          <div className="inbox-source-warning-actions">
            {missingDeryaInboxEmails.map((email) => (
              <a key={email} href={gmailConnectHrefForInbox(email)} className="btn btn-secondary btn-sm">
                Connect {email}
              </a>
            ))}
          </div>
        </div>
      )}

      <form method="get" action="/dashboard/inbox" className="inbox-search-form">
        {filter && <input type="hidden" name="filter" value={filter} />}
        {accountFilter && <input type="hidden" name="account" value={accountFilter} />}
        {channel && <input type="hidden" name="channel" value={channel} />}
        {view !== "threads" && <input type="hidden" name="view" value={view} />}
        <div className="inbox-search-wrap">
          <input
            type="search"
            name="q"
            defaultValue={searchQuery}
            placeholder="Search subjects, bodies, senders…"
            className="inbox-search-input"
          />
          <span className="inbox-search-icon">
            <Icon name="search" size={14} />
          </span>
        </div>
        {searchQuery && (
          <a href={inboxHref({ q: null })} className="inbox-clear-link">Clear</a>
        )}
      </form>
      {searchQuery && (
        <div className="inbox-result-note">
          Searching for <strong>{searchQuery}</strong> · {view === "rfqs" ? rfqs.length : threads.length} match{(view === "rfqs" ? rfqs.length : threads.length) === 1 ? "" : "es"}
        </div>
      )}

      <div className="chip-row">
        {FILTERS.map((f) => {
          const isActive = filter === f.key;
          return (
            <a
              key={f.key}
              href={inboxHref({ filter: f.key })}
              className={`filter-chip dark${isActive ? " active" : ""}`}
            >
              {f.label}
              <span className="filter-chip-count">
                {countFor(f.key)}
              </span>
            </a>
          );
        })}
        <div className="view-switcher">
          {[
            { key: "threads", label: "Threads" },
            { key: "loads",   label: "By load" },
            { key: "rfqs",    label: "RFQs" },
          ].map((v) => {
            const isActive = view === v.key;
            return (
              <a
                key={v.key}
                href={inboxHref({ view: v.key === "threads" ? null : v.key })}
                className={`view-switcher-tab${isActive ? " active" : ""}`}
              >{v.label}</a>
            );
          })}
        </div>
      </div>

      {focusedLoad && (
        <div className="focus-banner">
          <div className="focus-banner-main">
            <div className="focus-banner-eyebrow">
              Filtered to load
            </div>
            <div className="focus-banner-title">
              {focusedLoad.label}
              <span className="focus-banner-type">
                {focusedLoad.sublabel}
              </span>
            </div>
            <div className="focus-banner-meta">
              {focusedLoad.threadIds.length} thread{focusedLoad.threadIds.length === 1 ? "" : "s"} attached · including hidden + snoozed
            </div>
          </div>
          <div className="focus-banner-actions">
            <a href={focusedLoad.kind === "job" ? `/dashboard/jobs/${focusedLoad.id}` : `/dashboard/rfq/${focusedLoad.id}`}
               className="btn btn-secondary btn-sm">
              Open {focusedLoad.kind === "job" ? "job" : "RFQ"}
            </a>
            <a href="/dashboard/inbox" className="btn btn-secondary btn-sm">
              Clear filter
            </a>
          </div>
        </div>
      )}

      <InboxBulkProposalPanel proposals={bulkProposals} />

      <BulkActionBar inquiries={openInquiriesForBulk} />

      {view === "rfqs" ? (
        <RfqListView rfqs={rfqs} activeJobs={activeJobsForMerge} />
      ) : threads.length === 0 ? (
        <div className="card empty-state-card">
          {accounts.length === 0 ? (
            <>
              <div className="empty-state-title">No inboxes connected</div>
              <p className="empty-state-copy">
                Connect a Gmail inbox or configure WhatsApp to start syncing customer channels.
              </p>
              <a href="/dashboard/settings/email" className="btn empty-state-action">
                Go to channel settings
              </a>
            </>
          ) : searchQuery ? (
            <>
              <div className="empty-state-title">No matches for &quot;{searchQuery}&quot;</div>
              <p className="empty-state-copy">
                Try a sender domain, a commodity name, or a port. Search covers subjects, bodies, and senders.
              </p>
            </>
          ) : filter === "_NEEDS_REPLY" ? (
            <>
              <div className="empty-state-title">No replies due</div>
              <p className="empty-state-copy">
                Every active thread has an outbound reply after its latest inbound message.
              </p>
            </>
          ) : filter === "_HIDDEN" ? (
            <>
              <div className="empty-state-title">No hidden threads</div>
              <p className="empty-state-copy">
                Hidden threads remain synced and are excluded from the active inbox.
              </p>
            </>
          ) : filter === "_SNOOZED" ? (
            <>
              <div className="empty-state-title">No snoozed threads</div>
              <p className="empty-state-copy">
                Snooze a thread from the row to make it disappear until later (4h / tomorrow / next Monday).
              </p>
            </>
          ) : (
            <>
              <div className="empty-state-title">Inbox is calm</div>
              <p className="empty-state-copy">
                {totalSnoozed > 0 ? `${totalSnoozed} thread${totalSnoozed === 1 ? "" : "s"} snoozed. ` : ""}
                {totalHidden > 0 ? `${totalHidden} hidden as not freight-related. ` : ""}
                Click <strong>Sync now</strong> in <a href="/dashboard/settings/email" className="data-link">Channel Settings</a> to pull fresh mail manually, or wait - mail auto-syncs every 15 minutes and WhatsApp arrives instantly.
              </p>
            </>
          )}
        </div>
      ) : view === "loads" ? (
        <div className="inbox-stack roomy">
          {loadGroups.map((g) => (
            <div key={g.key} className={`card inbox-group-card${g.type === "UNLINKED" ? "" : " linked"}`}>
              <div className="inbox-group-header">
                <div className="inbox-group-main">
                  <div className="inbox-group-title">
                    {g.href ? (
                      <a href={g.href} className="inbox-group-link">{g.title} →</a>
                    ) : g.title}
                  </div>
                  <div className="inbox-group-meta">
                    {g.subtitle} · {g.threads.length} thread{g.threads.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="inbox-row-list">
                {g.threads.map((t) => {
                  const last = t.messages[t.messages.length - 1];
                  const workflow = primaryEmailWorkflowLabel({
                    kind: dominantKind(t.messages),
                    jobId: t.job?.id ?? null,
                    inquiryId: t.inquiry?.id ?? null,
                  });
                  const priority = threadCriticality(t);
                  const source = threadSourceMeta(t.messages);
                  return (
                    <div key={t.id} className="inbox-thread-row">
                      <BulkCheckbox threadId={t.id} />
                      <div className="inbox-thread-main">
                        <div className="inbox-thread-title">
                          {t.subject}
                        </div>
                        <div className="inbox-thread-meta">
                          <span className={`inbox-priority-badge ${priority.cls}`}>{priority.label}</span>
                          <span className={`inbox-workflow-label ${workflow.className}`}>{workflow.label}</span>
                          <span className={`inbox-source-badge ${source.cls}`} title={source.accountLabel}>{source.label}</span>
                          {t.messages.length} msg · {timeAgo(t.lastMessageAt)}{last ? ` · last from ${displayParty(last.fromEmail, last.fromName)}` : ""}
                        </div>
                      </div>
                      <div className="inbox-row-actions">
                        <InboxQuickReply threadId={t.id} threadSubject={t.subject} channel={source.cls === "whatsapp" ? "whatsapp" : "email"} composerEnabled={waComposerEnabled} />
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
        <div className="inbox-stack">
          {threads.map((t) => {
            const linked = t.job || t.inquiry;
            const kind = dominantKind(t.messages);
            const meta = KIND_META[kind] ?? KIND_META.OTHER;
            const workflow = primaryEmailWorkflowLabel({
              kind,
              jobId: t.job?.id ?? null,
              inquiryId: t.inquiry?.id ?? null,
            });
            const last = t.messages[t.messages.length - 1];
            const priority = threadCriticality(t);
            const source = threadSourceMeta(t.messages);
            const threadChannel = source.cls === "whatsapp" ? ("whatsapp" as const) : ("email" as const);
            // Unread is WhatsApp-only: isRead was never written for historical
            // Gmail messages and email reply paths don't clear it, so an
            // unscoped dot would flood every email thread on rollout.
            const hasUnread = threadChannel === "whatsapp" && t.messages.some((m) => m.direction === "INBOUND" && !m.isRead);
            const inboundCount = t.messages.filter((m) => m.direction === "INBOUND").length;
            const outboundCount = t.messages.length - inboundCount;
            const lastReason = [...t.messages].reverse().find((m) => m.classificationReason)?.classificationReason;

            return (
              <div key={t.id} className={`card inbox-thread-card${linked ? " linked" : ""}`}>
                <div className="inbox-thread-inner">
                  <div className="inbox-thread-top">
                    <BulkCheckbox threadId={t.id} />
                    <span className={`inbox-kind-badge ${meta.cls}`}>{meta.label}</span>
                    <span className={`inbox-workflow-label ${workflow.className}`}>{workflow.label}</span>
                    <span className={`inbox-priority-badge ${priority.cls}`}>{priority.label}</span>
                    <span className={`inbox-source-badge ${source.cls}`} title={source.accountLabel}>{source.label}</span>
                    {hasUnread && <span className="inbox-unread-dot" title="Unread messages" />}
                    <span className={`inbox-thread-subject${hasUnread ? " inbox-thread-subject-unread" : ""}`}>
                      {t.subject || "(no subject)"}
                    </span>
                    <span className="inbox-thread-counts">
                      {t.messages.length} msg{t.messages.length === 1 ? "" : "s"}
                      {inboundCount > 0 && outboundCount > 0 ? ` · ${inboundCount} in / ${outboundCount} out` : ""}
                      {" · "}
                      {timeAgo(t.lastMessageAt)}
                    </span>
                  </div>

                  {/* Linked-to / not-linked row */}
                  <div className="inbox-linked-row">
                    <div className="inbox-linked-targets">
                      {t.job ? (
                        <span className="inbox-linked-target">
                          <a href={`/dashboard/jobs/${t.job.id}`} className="inbox-load-link">
                            → {t.job.reference} {t.job.company?.name ? `· ${t.job.company.name}` : ""}
                            <TypeBadge type={t.job.type} />
                          </a>
                          <a
                            href={`/dashboard/inbox?job=${t.job.id}`}
                            title="Show only this load's emails"
                            className="inbox-see-all"
                          >
                            See all
                          </a>
                        </span>
                      ) : t.inquiry ? (
                        <span className="inbox-linked-target">
                          <a href={`/dashboard/rfq/${t.inquiry.id}`} className="inbox-load-link">
                            → {t.inquiry.subject}
                            <TypeBadge type={t.inquiry.type} />
                          </a>
                          <a
                            href={`/dashboard/inbox?inquiry=${t.inquiry.id}`}
                            title="Show only this inquiry's emails"
                            className="inbox-see-all"
                          >
                            See all
                          </a>
                        </span>
                      ) : (
                        <span className="inbox-unlinked">
                          Not linked to any load
                        </span>
                      )}
                    </div>
                    <div className="inbox-row-actions">
                      <InboxQuickReply threadId={t.id} threadSubject={t.subject} channel={threadChannel} composerEnabled={waComposerEnabled} />
                      {!linked && (
                        <CreateInquiryButton threadId={t.id} />
                      )}
                      <SnoozeThreadButton threadId={t.id} snoozedUntil={t.snoozedUntil ? t.snoozedUntil.toISOString() : null} />
                      <HideThreadButton threadId={t.id} hidden={!!t.hiddenAt} />
                    </div>
                  </div>

                  {/* Last message preview + classification reason */}
                  {last && (
                    <div className="inbox-preview">
                      <div className="inbox-preview-meta">
                        Latest: {displayParty(last.fromEmail, last.fromName)} · {source.accountLabel} · {timeAgo(last.sentAt)}
                      </div>
                      {last.bodyText && (
                        <div className="inbox-preview-body">
                          {last.bodyText.slice(0, 280).replace(/\s+/g, " ").trim()}
                        </div>
                      )}
                      {lastReason && (
                        <div className="inbox-ai-note">
                          Classification: {lastReason}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Expandable messages */}
                <ThreadAccordion threadId={t.id} channel={threadChannel} hasUnread={hasUnread} messageCount={t.messages.length} messages={t.messages.map((m) => {
                  let attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];
                  if (m.attachments) {
                    try { attachments = JSON.parse(m.attachments); } catch { attachments = []; }
                  }
                  const messageWorkflow = primaryEmailWorkflowLabel({
                    kind: m.classification,
                    jobId: t.job?.id ?? null,
                    inquiryId: t.inquiry?.id ?? null,
                  });
                  return {
                    id: m.id,
                    direction: m.direction,
                    fromName: m.fromName,
                    fromEmail: m.fromEmail,
                    subject: m.subject,
                    bodyText: m.bodyText,
                    sentAt: m.sentAt.toISOString(),
                    classification: m.classification,
                    workflowLabel: messageWorkflow.label,
                    workflowLabelClass: messageWorkflow.className,
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
    <span className={`type-badge${isSourcing ? " sourcing" : ""}`}>{isSourcing ? "Sourcing" : "Forwarding"}</span>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)) : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function textValue(value: unknown, fallback = "-") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return value.toLocaleString();
  return fallback;
}

type InboxBulkProposal = {
  id: string;
  kind: string;
  sourceType: string | null;
  sourcePreview: string | null;
  payload: unknown;
  toolTrace: unknown;
  createdAt: Date;
};

function InboxBulkProposalPanel({ proposals }: { proposals: InboxBulkProposal[] }) {
  if (proposals.length === 0) return null;

  return (
    <div className="card inbox-review-card">
      <div className="inbox-review-head">
        <div>
          <div className="record-section-title">Pending bulk reviews</div>
          <div className="record-section-note">
            Apply these only after checking the exact records. The agent has not changed anything yet.
          </div>
        </div>
        <span className="inbox-review-count">{proposals.length}</span>
      </div>
      <div className="inbox-review-list">
        {proposals.map((proposal) => {
          const payload = asRecord(proposal.payload);
          const actionInput = asRecord(payload.actionInput);
          const action = textValue(payload.action, "BULK_ACTION");
          const actionLabel = textValue(payload.actionLabel, proposal.kind);
          const actionDetails = asStringArray(payload.actionDetails);
          const reviewItems = asRecordArray(payload.reviewItems);
          const clusters = asRecordArray(actionInput.clusters);
          return (
            <div key={proposal.id} className="inbox-review-item">
              <div className="inbox-review-title-row">
                <div>
                  <strong>{actionLabel}</strong>
                  <div className="inbox-review-meta">
                    {proposal.kind} · {proposal.sourceType ?? "SOURCE_UNKNOWN"} · {timeAgo(proposal.createdAt)} · {proposal.id.slice(0, 8)}
                  </div>
                </div>
                <div className="inbox-review-actions">
                  <form action={applyInboxAgentProposalAction.bind(null, proposal.id)}>
                    <button className="btn btn-sm" type="submit">Apply</button>
                  </form>
                  <form action={discardInboxAgentProposalAction.bind(null, proposal.id)}>
                    <button className="btn btn-secondary btn-sm" type="submit">Discard</button>
                  </form>
                </div>
              </div>

              {actionDetails.length > 0 && (
                <ul className="inbox-review-detail-list">
                  {actionDetails.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
              )}

              {action === "DEDUP_INQUIRIES" && clusters.length > 0 ? (
                <div className="inbox-review-clusters">
                  {clusters.slice(0, 6).map((cluster, index) => {
                    const keeper = asRecord(cluster.keeper);
                    const losers = asRecordArray(cluster.losers);
                    return (
                      <div key={`${proposal.id}-cluster-${index}`} className="inbox-review-cluster">
                        <div className="inbox-review-cluster-title">
                          Keep: {textValue(keeper.title)}
                        </div>
                        <div className="inbox-review-cluster-meta">
                          {textValue(cluster.reason, "Duplicate cluster")} · remove {losers.length}
                        </div>
                        {losers.map((loser) => (
                          <div key={textValue(loser.id)} className="inbox-review-row compact">
                            <span>{textValue(loser.title)}</span>
                            <span>{textValue(loser.meta)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {clusters.length > 6 && <div className="inbox-review-more">+{clusters.length - 6} more cluster{clusters.length - 6 === 1 ? "" : "s"}</div>}
                </div>
              ) : (
                <div className="inbox-review-rows">
                  {reviewItems.slice(0, 10).map((item) => (
                    <div key={textValue(item.id, `${proposal.id}-${textValue(item.title)}`)} className="inbox-review-row">
                      <span>{textValue(item.title)}</span>
                      <span>{textValue(item.meta)}</span>
                      {textValue(item.detail, "") && <em>{textValue(item.detail, "")}</em>}
                    </div>
                  ))}
                  {reviewItems.length > 10 && <div className="inbox-review-more">+{reviewItems.length - 10} more record{reviewItems.length - 10 === 1 ? "" : "s"}</div>}
                </div>
              )}

              {proposal.sourcePreview && (
                <details className="agent-proposal-source">
                  <summary>Source</summary>
                  <pre>{proposal.sourcePreview}</pre>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
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

function RfqListView({ rfqs, activeJobs }: { rfqs: RfqRow[]; activeJobs: { id: string; reference: string; type: string; customer: string | null }[] }) {
  if (rfqs.length === 0) {
    return (
      <div className="card empty-state-card">
        <div className="empty-state-title">No RFQs yet</div>
        <p className="empty-state-copy">
          RFQs are created manually or auto-linked from email threads. Switch to Threads view to see incoming mail.
        </p>
      </div>
    );
  }
  return (
    <div className="card table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Customer / sender</th>
            <th>Route</th>
            <th>Type</th>
            <th>Status</th>
            <th>Job</th>
            <th className="numeric">Threads</th>
            <th>Received</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rfqs.map((r) => {
            const sm = { label: inquiryStatusLabel(r.status), cls: inquiryStatusBadgeCls(r.status) };
            return (
              <tr key={r.id} className="data-row">
                <td>
                  <a href={`/dashboard/rfq/${r.id}`} className="data-cell-strong">
                    {r.subject}
                  </a>
                </td>
                <td>
                  <div>{r.company?.name ?? r.fromCompany ?? "-"}</div>
                  {r.fromEmail && <div className="data-subline">{displayParty(r.fromEmail)}</div>}
                </td>
                <td>
                  {r.origin || r.destination ? (
                    <span>{r.origin ?? "?"} → {r.destination ?? "?"}</span>
                  ) : <span className="data-muted">-</span>}
                  {r.mode && <div className="data-subline">{r.mode}</div>}
                </td>
                <td><TypeBadge type={r.type} /></td>
                <td><span className={`badge ${sm.cls}`}>{sm.label}</span></td>
                <td>
                  {r.job ? (
                    <a href={`/dashboard/jobs/${r.job.id}`} className="data-link">
                      {r.job.reference}
                    </a>
                  ) : <span className="data-muted">-</span>}
                </td>
                <td className="numeric">
                  {r._count.emailThreads > 0 ? (
                    <a href={`/dashboard/inbox?inquiry=${r.id}`} className="data-link">
                      {r._count.emailThreads}
                    </a>
                  ) : <span className="data-muted">0</span>}
                </td>
                <td className="data-muted">
                  {new Date(r.receivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </td>
                <td>
                  {r.job && r.job.status !== "PROPOSED" ? (
                    <span className="data-action-note">Already a job</span>
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
