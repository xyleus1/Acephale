import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { toContactRow } from "@/lib/contact-fields";
import { ContactSheet } from "@/components/contact-sheet";

type SearchParams = Promise<{ q?: string }>;

export default async function CrmPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const { q } = await searchParams;

  const [contacts, companies] = await Promise.all([
    prisma.contact.findMany({
      where: { company: { officeId: session.officeId } },
      select: {
        id: true,
        fullName: true,
        companyId: true,
        category: true,
        status: true,
        relationshipStrength: true,
        email: true,
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
    <ContactSheet
      initialRows={rows}
      companies={companies.map((c) => c.name)}
      initialQuery={q ?? ""}
    />
  );
}
