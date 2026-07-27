import "server-only";

import { prisma } from "@/lib/prisma";
import { toContactRow } from "@/lib/contact-fields";

export async function loadCrmWorkspaceData(officeId: string) {
  const [contacts, companies] = await Promise.all([
    prisma.contact.findMany({
      where: { company: { officeId } },
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
      where: { officeId },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 1500,
    }),
  ]);

  return {
    rows: contacts.map(toContactRow),
    companies: companies.map((company) => company.name),
  };
}
