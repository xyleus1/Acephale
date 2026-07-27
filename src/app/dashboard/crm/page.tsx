import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { toContactRow } from "@/lib/contact-fields";
import { prepareOutreachWorkspace } from "@/lib/crm-outreach-plan";
import { ContactSheet } from "@/components/contact-sheet";

export const metadata = { title: "CRM" };

type SearchParams = Promise<{ q?: string }>;

export default async function CrmPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const { q: rawQ } = await searchParams;
  const q = typeof rawQ === "string" ? rawQ : "";
  const now = new Date();
  const planItems = await prepareOutreachWorkspace(session.officeId, now);

  const [contacts, companies] = await Promise.all([
    prisma.contact.findMany({
      where: { company: { officeId: session.officeId } },
      select: {
        id: true,
        fullName: true,
        companyId: true,
        status: true,
        importance: true,
        category: true,
        relationshipType: true,
        title: true,
        outreachChannel: true,
        email: true,
        linkedinUrl: true,
        bookfaceUrl: true,
        phone: true,
        location: true,
        notes: true,
        lastTouchAt: true,
        company: { select: { name: true } },
      },
      orderBy: [{ lastTouchAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 2000,
    }),
    prisma.company.findMany({
      where: { officeId: session.officeId },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 1500,
    }),
  ]);

  const rows = contacts.map(toContactRow);

  return (
    // Keyed by the query: ContactSheet seeds its filter from initialQuery once,
    // so a same-route ?q= navigation (⌘K company/contact pick while already on
    // the CRM) must remount it to actually apply the new search.
    <ContactSheet
      key={q}
      initialRows={rows}
      companies={companies.map((c) => c.name)}
      initialQuery={q}
      initialPlan={planItems}
    />
  );
}
