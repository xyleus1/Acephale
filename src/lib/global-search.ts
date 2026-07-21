"use server";

// Office-wide search behind the ⌘K palette: loads, RFQs, companies, contacts
// and email threads in one query. Everything is officeId-scoped; companies and
// contacts additionally respect ownership visibility (same rule as
// /dashboard/search). Results carry their navigation target so the palette
// stays a dumb renderer.

import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { inquiryStatusLabel } from "./inquiry-status";
import { displayParty } from "./whatsapp-display";

export type GlobalSearchGroup = "loads" | "rfqs" | "companies" | "contacts" | "threads";

export type GlobalSearchResult = {
  group: GlobalSearchGroup;
  id: string;
  // Mono chip at the left of the row (reference); null hides it.
  ref: string | null;
  title: string;
  detail: string | null;
  status: string | null;
  href: string;
};

const JOB_STATUS_LABEL: Record<string, string> = {
  PROPOSED: "Proposed",
  INQUIRY: "RFQ",
  QUOTED: "Pricing",
  BOOKED: "Booked",
  IN_TRANSIT: "En Route",
  CUSTOMS: "En Route",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

function lane(origin: string | null, destination: string | null, mode: string | null): string | null {
  const route = origin && destination ? `${origin} → ${destination}` : origin ?? destination;
  if (!route) return mode;
  return mode ? `${route} · ${mode}` : route;
}

export async function globalSearch(query: string): Promise<GlobalSearchResult[]> {
  const session = await requireSession();
  const officeId = session.officeId;
  const q = query.trim().slice(0, 120);

  const canViewAll =
    session.role === "ADMIN" ||
    session.role === "MANAGER" ||
    session.canViewWholeOffice;
  const companyScope = canViewAll
    ? { officeId }
    : { officeId, owners: { some: { userId: session.userId } } };

  type JobRow = {
    id: string; reference: string; status: string;
    origin: string | null; destination: string | null; mode: string | null;
    company: { name: string } | null;
  };
  const jobResult = (j: JobRow): GlobalSearchResult => ({
    group: "loads",
    id: j.id,
    ref: j.reference,
    title: j.company?.name ?? "No customer",
    detail: lane(j.origin, j.destination, j.mode),
    status: JOB_STATUS_LABEL[j.status] ?? j.status,
    href: `/dashboard/jobs/${j.id}`,
  });

  type InquiryRow = {
    id: string; reference: string | null; subject: string; status: string;
    fromCompany: string | null; fromEmail: string | null;
    origin: string | null; destination: string | null; mode: string | null;
  };
  const inquiryResult = (i: InquiryRow): GlobalSearchResult => ({
    group: "rfqs",
    id: i.id,
    ref: i.reference,
    title: i.subject,
    detail: lane(i.origin, i.destination, i.mode) ?? i.fromCompany ?? i.fromEmail,
    status: inquiryStatusLabel(i.status),
    href: `/dashboard/rfq/${i.id}`,
  });

  const jobSelect = {
    id: true, reference: true, status: true, origin: true, destination: true,
    mode: true, company: { select: { name: true } },
  } as const;
  const inquirySelect = {
    id: true, reference: true, subject: true, status: true, fromCompany: true,
    fromEmail: true, origin: true, destination: true, mode: true,
  } as const;

  // Empty query = the launcher view: most recently touched work.
  if (!q) {
    const [jobs, inquiries] = await Promise.all([
      prisma.job.findMany({
        where: { officeId },
        select: jobSelect,
        orderBy: { updatedAt: "desc" },
        take: 6,
      }),
      prisma.inquiry.findMany({
        where: { officeId },
        select: inquirySelect,
        orderBy: { receivedAt: "desc" },
        take: 5,
      }),
    ]);
    return [...jobs.map(jobResult), ...inquiries.map(inquiryResult)];
  }

  const contains = { contains: q, mode: "insensitive" as const };
  // Pasting a phone number ("+90 532 111 22 33") should find the WhatsApp
  // thread/RFQ even though the stored address is "whatsapp:905321112233".
  const queryDigits = q.replace(/\D/g, "");
  const digitsContains = queryDigits.length >= 7 ? { contains: queryDigits } : null;

  const [jobs, inquiries, companies, contacts, threads, phoneContactCandidates] = await Promise.all([
    prisma.job.findMany({
      where: {
        officeId,
        OR: [
          { reference: contains },
          { origin: contains },
          { destination: contains },
          { commodity: contains },
          { company: { name: contains } },
        ],
      },
      select: jobSelect,
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    prisma.inquiry.findMany({
      where: {
        officeId,
        OR: [
          { reference: contains },
          { subject: contains },
          { fromCompany: contains },
          { fromEmail: contains },
          { origin: contains },
          { destination: contains },
          { commodity: contains },
          ...(digitsContains ? [{ fromEmail: digitsContains }] : []),
        ],
      },
      select: inquirySelect,
      orderBy: { receivedAt: "desc" },
      take: 6,
    }),
    prisma.company.findMany({
      where: { ...companyScope, name: contains },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 4,
    }),
    prisma.contact.findMany({
      where: {
        company: companyScope,
        OR: [{ fullName: contains }, { email: contains }],
      },
      select: { id: true, fullName: true, email: true, company: { select: { name: true } } },
      take: 4,
    }),
    prisma.emailThread.findMany({
      where: {
        officeId,
        hiddenAt: null,
        OR: [
          { subject: contains },
          { messages: { some: { OR: [
            { fromEmail: contains },
            { fromName: contains },
            ...(digitsContains ? [{ fromEmail: digitsContains }] : []),
          ] } } },
        ],
      },
      select: {
        id: true, subject: true, lastMessageAt: true, messageCount: true,
        messages: {
          orderBy: { sentAt: "desc" as const },
          take: 1,
          select: { fromEmail: true, fromName: true, account: { select: { provider: true } } },
        },
      },
      orderBy: { lastMessageAt: "desc" },
      take: 4,
    }),
    // Contact.phone is free text in operator formats - digit-match in JS when
    // the query looks like a phone number.
    digitsContains
      ? prisma.contact.findMany({
          where: { company: companyScope, phone: { not: null } },
          select: { id: true, fullName: true, email: true, phone: true, company: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
          take: 500,
        })
      : Promise.resolve([]),
  ]);

  const phoneContacts = phoneContactCandidates
    .filter((c) => (c.phone ?? "").replace(/\D/g, "").includes(queryDigits))
    .filter((c) => !contacts.some((existing) => existing.id === c.id))
    .slice(0, 4);

  return [
    ...jobs.map(jobResult),
    ...inquiries.map(inquiryResult),
    // No company/contact detail routes exist - deep-link into the CRM sheet's
    // own search, the same way /dashboard/search results do.
    ...companies.map((c) => ({
      group: "companies" as const,
      id: c.id,
      ref: null,
      title: c.name,
      detail: null,
      status: null,
      href: `/dashboard/crm?q=${encodeURIComponent(c.name)}`,
    })),
    ...contacts.map((c) => ({
      group: "contacts" as const,
      id: c.id,
      ref: null,
      title: c.fullName,
      detail: c.email ?? c.company?.name ?? null,
      status: null,
      href: `/dashboard/crm?q=${encodeURIComponent(c.fullName)}`,
    })),
    ...phoneContacts.map((c) => ({
      group: "contacts" as const,
      id: c.id,
      ref: null,
      title: c.fullName,
      detail: c.phone ?? c.company?.name ?? null,
      status: null,
      href: `/dashboard/crm?q=${encodeURIComponent(c.fullName)}`,
    })),
    ...threads.map((t) => {
      const last = t.messages[0];
      const isWhatsApp = last?.account?.provider === "WHATSAPP";
      const sender = last ? displayParty(last.fromEmail, last.fromName) : null;
      const channelParam = isWhatsApp ? "&channel=whatsapp" : "";
      return {
        group: "threads" as const,
        id: t.id,
        ref: null,
        title: t.subject,
        detail: `${sender ? `${sender} · ` : ""}${t.messageCount} message${t.messageCount === 1 ? "" : "s"} · ${t.lastMessageAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
        status: isWhatsApp ? "WhatsApp" : "Email",
        href: `/dashboard/inbox?q=${encodeURIComponent(t.subject.slice(0, 80))}${channelParam}`,
      };
    }),
  ];
}
