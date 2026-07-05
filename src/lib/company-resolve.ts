import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Find a company by free-typed name within the office (case-insensitive exact match).
export async function findCompanyIdByName(officeId: string, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = await prisma.company.findFirst({
    where: { officeId, name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true },
  });
  return existing?.id ?? null;
}

// Resolve a free-typed customer name to a Company id within the office.
// Matches case-insensitively on exact name; creates the company if new.
export async function resolveCompanyIdByName(officeId: string, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = await findCompanyIdByName(officeId, trimmed);
  if (existing) return existing;
  try {
    const created = await prisma.company.create({
      data: { officeId, name: trimmed },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // Concurrent create of the same name: the winner already exists, use it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await findCompanyIdByName(officeId, trimmed);
      if (winner) return winner;
    }
    throw error;
  }
}
