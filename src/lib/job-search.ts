"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { prisma } from "./prisma";

export type JobSearchResult = {
  id: string;
  reference: string;
  status: string;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  customer: string | null;
};

export async function searchJobs(query: string): Promise<JobSearchResult[]> {
  const session = await requireSession();
  const q = query.trim();

  // SQLite (no `mode: insensitive`) — load and filter in memory
  const jobs = await prisma.job.findMany({
    where: { officeId: session.officeId },
    include: { company: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  if (!q) return jobs.slice(0, 12).map(toResult);

  const ql = q.toLowerCase();
  const matches = jobs.filter((j) => {
    const haystack = [
      j.reference,
      j.company?.name,
      j.origin,
      j.destination,
      j.mode,
      j.commodity,
      j.status,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(ql);
  });
  return matches.slice(0, 20).map(toResult);
}

function toResult(j: { id: string; reference: string; status: string; origin: string | null; destination: string | null; mode: string | null; company: { name: string } | null }): JobSearchResult {
  return {
    id: j.id,
    reference: j.reference,
    status: j.status,
    origin: j.origin,
    destination: j.destination,
    mode: j.mode,
    customer: j.company?.name ?? null,
  };
}

export async function focusJobAction(jobId: string): Promise<void> {
  const session = await requireSession();
  const exists = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: { id: true },
  });
  if (!exists) return;
  const c = await cookies();
  c.set("focus-job", jobId, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });
  revalidatePath("/dashboard");
}
