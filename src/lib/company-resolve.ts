import { prisma } from "./prisma";

// Resolve a free-typed customer name to a Company id within the office.
// Matches case-insensitively on exact name; creates the company if new.
export async function resolveCompanyIdByName(officeId: string, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = await prisma.company.findFirst({
    where: { officeId, name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.company.create({
    data: { officeId, name: trimmed },
    select: { id: true },
  });
  return created.id;
}
