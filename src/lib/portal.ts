"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { createPortalToken } from "./portal-token";

// Generate (if missing) and return a magic-link portal token for a job. The
// resulting URL is /portal/<token> and is publicly readable - no login. The
// token is random, unique per job, and must never fall back to the job id.
export async function ensurePortalToken(jobId: string): Promise<{ ok: true; token: string; url: string } | { error: string }> {
  const session = await requireSession();
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: { id: true, portalToken: true },
  });
  if (!job) return { error: "Job not found" };
  let token = job.portalToken;
  if (!token) {
    token = createPortalToken();
    await prisma.job.update({ where: { id: jobId }, data: { portalToken: token } });
  }
  revalidatePath(`/dashboard/jobs/${jobId}`);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://derya-crm.vercel.app");
  return { ok: true, token, url: `${baseUrl}/portal/${token}` };
}

export async function rotatePortalToken(jobId: string): Promise<{ ok: true; token: string; url: string } | { error: string }> {
  const session = await requireSession();
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId: session.officeId }, select: { id: true } });
  if (!job) return { error: "Job not found" };
  const token = createPortalToken();
  await prisma.job.update({ where: { id: jobId }, data: { portalToken: token } });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://derya-crm.vercel.app");
  return { ok: true, token, url: `${baseUrl}/portal/${token}` };
}

export async function setNotifyCustomer(jobId: string, on: boolean): Promise<void> {
  const session = await requireSession();
  await prisma.job.updateMany({
    where: { id: jobId, officeId: session.officeId },
    data: { notifyCustomer: on },
  });
  revalidatePath(`/dashboard/jobs/${jobId}`);
}
