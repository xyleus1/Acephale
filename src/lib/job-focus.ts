"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";

export type FocusedJob = {
  id: string;
  reference: string;
  status: string;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  customerId: string | null;
  customerName: string | null;
  inquiryId: string | null;
};

export async function getFocusedJobId(): Promise<string | null> {
  const c = await cookies();
  return c.get("focus-job")?.value ?? null;
}

export async function getFocusedJob(officeId: string): Promise<FocusedJob | null> {
  const c = await cookies();
  const id = c.get("focus-job")?.value;
  if (!id) return null;

  const job = await prisma.job.findFirst({
    where: { id, officeId },
    select: {
      id: true, reference: true, status: true,
      origin: true, destination: true, mode: true,
      companyId: true,
      company: { select: { name: true } },
      inquiryId: true,
    },
  });

  if (!job) return null;

  return {
    id: job.id,
    reference: job.reference,
    status: job.status,
    origin: job.origin,
    destination: job.destination,
    mode: job.mode,
    customerId: job.companyId,
    customerName: job.company?.name ?? null,
    inquiryId: job.inquiryId,
  };
}

export async function clearFocusAction() {
  const c = await cookies();
  c.delete("focus-job");
  revalidatePath("/dashboard");
}
